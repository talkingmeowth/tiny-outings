/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { googlePlacesJson } from './lib/google-places-client.js';
import { officialWebsiteUrl } from './lib/activity-import-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activity_google_places_validation.generated.sql');
const outputAudit = join(root, 'data', 'activity_google_places_validation.generated.json');
const fieldMask = [
  'id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri', 'websiteUri',
  'businessStatus', 'rating', 'userRatingCount', 'primaryType',
].join(',');
const searchFieldMask = fieldMask.split(',').map((field) => `places.${field}`).join(',');
const stopWords = new Set([
  'activity', 'baby', 'babies', 'children', 'child', 'class', 'club', 'event', 'family',
  'for', 'from', 'london', 'parents', 'play', 'session', 'stay', 'the', 'with', 'young',
]);

function readDotEnv(name) {
  try {
    return Object.fromEntries(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      }));
  } catch {
    return {};
  }
}

const env = { ...readDotEnv('.env.local'), ...process.env };
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;
const googleApiKey = env.GOOGLE_PLACES_API_KEY || env.GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY;
const requestedLimit = Number(process.argv.find((argument) => argument.startsWith('--limit='))?.split('=')[1] || 0);
const forceAll = process.argv.includes('--full');

function sql(value) {
  return value == null || value === '' ? 'null' : `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function clean(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function meaningfulTokens(value) {
  return [...new Set(clean(value).split(' ').filter((token) => token.length > 3 && !stopWords.has(token)))];
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.replace(/\s/g, '').toUpperCase() || null;
}

function londonCoordinate(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= 51.25 && latitude <= 51.75 && longitude >= -0.60 && longitude <= 0.40;
}

function venueHint(activity) {
  const explicitVenue = String(activity.activity_name || '').match(/\bat\s+(.+)$/i)?.[1];
  return explicitVenue || activity.address || activity.activity_name;
}

function isPlausiblePlace(activity, place) {
  if (!place?.id || !londonCoordinate(place.location)) return false;
  const expectedPostcode = postcode(activity.address || activity.postcode);
  const returnedPostcode = postcode(place.formattedAddress);
  if (expectedPostcode && returnedPostcode && expectedPostcode !== returnedPostcode) return false;

  const wanted = meaningfulTokens(`${venueHint(activity)} ${activity.address || ''}`);
  const returned = clean(`${place.displayName?.text || ''} ${place.formattedAddress || ''}`);
  const nameTokens = meaningfulTokens(venueHint(activity));
  const matchedName = nameTokens.filter((token) => returned.includes(token)).length;
  const matchedAny = wanted.filter((token) => returned.includes(token)).length;
  return matchedName >= 1 || matchedAny >= 2;
}

function sqlNumeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 'null';
}

async function fetchActivities() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  const rows = [];
  const select = 'activity_id,activity_name,address,postcode,lat,long,website,google_link,google_place_id,google_place_uri,source_name,data_source';
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select,
      public_listing_status: 'eq.published',
      archive: 'eq.false',
      order: 'activity_id.asc',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/activities?${params}`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
    });
    if (!response.ok) throw new Error(`Could not load activities: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function googleRequest(url, { fieldMask: requestedFieldMask = fieldMask, ...options } = {}) {
  const body = await googlePlacesJson(url, googleApiKey, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: {
      'X-Goog-FieldMask': requestedFieldMask,
      ...(options.headers || {}),
    },
  });
  return { ok: true, body };
}

async function getPlace(placeId) {
  if (!placeId) return null;
  const resource = String(placeId).startsWith('places/')
    ? String(placeId)
    : `places/${encodeURIComponent(placeId)}`;
  const result = await googleRequest(`https://places.googleapis.com/v1/${resource}?languageCode=en-GB&regionCode=GB`);
  return result.ok ? result.body : null;
}

async function findPlace(activity) {
  const query = `${venueHint(activity)}, ${activity.address || 'London'}, London`;
  const result = await googleRequest('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    fieldMask: searchFieldMask,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 5,
      languageCode: 'en-GB',
      regionCode: 'GB',
      locationBias: { circle: { center: { latitude: 51.5072, longitude: -0.1276 }, radius: 35000 } },
    }),
  });
  if (!result.ok) return { place: null, error: `${result.status} ${result.body}` };
  return { place: (result.body.places || []).find((place) => isPlausiblePlace(activity, place)) || null, error: null };
}

function valuesForPlace(activity, place) {
  return {
    activityId: activity.activity_id,
    address: place.formattedAddress || activity.address,
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
    placeId: place.id,
    placeUri: place.googleMapsUri,
    website: officialWebsiteUrl(place.websiteUri),
    rating: place.rating ?? null,
    reviews: place.userRatingCount ?? null,
    primaryType: place.primaryType || null,
  };
}

async function validateActivity(activity) {
  const direct = await getPlace(activity.google_place_id);
  if (direct && isPlausiblePlace(activity, direct)) {
    if (direct.businessStatus === 'CLOSED_PERMANENTLY') {
      return { activity, action: 'archive-permanently-closed', source: 'stored-place-id', place: direct };
    }
    return { activity, action: 'update', source: 'stored-place-id', place: direct };
  }

  const resolved = await findPlace(activity);
  if (!resolved.place) {
    return {
      activity,
      action: 'unresolved',
      source: direct ? 'stored-place-id-mismatch' : 'missing-or-invalid-place-id',
      error: resolved.error,
    };
  }
  if (resolved.place.businessStatus === 'CLOSED_PERMANENTLY') {
    // A text match is not strong enough to archive a listing; avoid false
    // removals and leave it unresolved for the next source refresh.
    return { activity, action: 'unresolved-closed-match', source: 'text-search', place: resolved.place };
  }
  return { activity, action: 'update', source: 'text-search', place: resolved.place };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function buildSql(updates, archives) {
  const updateSql = updates.length
    ? `with verified_places (activity_id, address, lat, long, google_place_id, google_place_uri, website, google_rating, google_user_rating_count, google_primary_type) as (
  values
    ${updates.map((row) => {
      const values = valuesForPlace(row.activity, row.place);
      return `(${sql(values.activityId)}::uuid, ${sql(values.address)}::text, ${sqlNumeric(values.latitude)}::numeric, ${sqlNumeric(values.longitude)}::numeric, ${sql(values.placeId)}::text, ${sql(values.placeUri)}::text, ${sql(values.website)}::text, ${sqlNumeric(values.rating)}::numeric, ${Number.isFinite(Number(values.reviews)) ? Number(values.reviews) : 'null'}::integer, ${sql(values.primaryType)}::text)`;
    }).join(',\n    ')}
)
update public.activities as activity
set
  address = coalesce(verified_places.address, activity.address),
  lat = verified_places.lat,
  long = verified_places.long,
  google_place_id = verified_places.google_place_id,
  google_place_uri = verified_places.google_place_uri,
  google_link = verified_places.google_place_uri,
  website = coalesce(activity.website, verified_places.website),
  google_rating = coalesce(verified_places.google_rating, activity.google_rating),
  google_user_rating_count = coalesce(verified_places.google_user_rating_count, activity.google_user_rating_count),
  google_primary_type = coalesce(verified_places.google_primary_type, activity.google_primary_type),
  updated_at = now()
from verified_places
where activity.activity_id = verified_places.activity_id;
`
    : '-- No valid Google Place updates found.\n';
  const archiveSql = archives.length
    ? `\n-- Google confirmed these stored Place records as permanently closed.
update public.activities
set archive = true,
    public_listing_status = 'archived',
    updated_at = now()
where activity_id in (${archives.map((row) => `${sql(row.activity.activity_id)}::uuid`).join(', ')});
`
    : '';
  return `-- Generated by scripts/validate-google-places-records.js
-- Each update is based on a current Google Places record whose name/address
-- matches the activity. Permanently closed stored Place records are archived.
\n${updateSql}${archiveSql}`;
}

async function main() {
  if (!googleApiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.');
  const activities = await fetchActivities();
  const targets = (forceAll
    ? activities
    : activities.filter((activity) => !activity.google_place_id || !activity.google_place_uri))
    .slice(0, requestedLimit || undefined);
  console.log(`Validating ${targets.length} of ${activities.length} active activities against Google Places.`);
  const results = await mapWithConcurrency(targets, 5, validateActivity);
  const updates = results.filter((result) => result.action === 'update');
  const archives = results.filter((result) => result.action === 'archive-permanently-closed');
  const summary = results.reduce((counts, result) => ({ ...counts, [result.action]: (counts[result.action] || 0) + 1 }), {});

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(updates, archives));
  writeFileSync(outputAudit, JSON.stringify({
    generated_at: new Date().toISOString(),
    full_validation: forceAll,
    active_activity_count: activities.length,
    target_count: targets.length,
    summary,
    results: results.map((result) => ({
      activity_id: result.activity.activity_id,
      activity_name: result.activity.activity_name,
      source_name: result.activity.source_name,
      action: result.action,
      match_source: result.source,
      place_id: result.place?.id || null,
      place_name: result.place?.displayName?.text || null,
      place_address: result.place?.formattedAddress || null,
      business_status: result.place?.businessStatus || null,
      error: result.error || null,
    })),
  }, null, 2) + '\n');
  console.log(`Google Place validation generated ${updates.length} repairs and ${archives.length} permanent-closure archives.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
