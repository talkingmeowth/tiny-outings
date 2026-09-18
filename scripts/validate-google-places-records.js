/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { googlePlacesJson } from './lib/google-places-client.js';
import { officialWebsiteUrl } from './lib/activity-import-policy.js';
import { loadActiveActivities } from './lib/active-activity-reader.js';
import { googlePlaceSearchUrl, isCoordinateOnlyGoogleUrl, isPlausiblePlace, isPlausibleSearchPlace, nameMatches, needsGoogleSearchFallback } from './lib/google-place-identity.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputTag = process.argv.find((argument) => argument.startsWith('--output-tag='))?.split('=')[1] || '';
if (outputTag && !/^[a-z0-9_-]{1,40}$/i.test(outputTag)) throw new Error('Invalid output tag.');
const outputSuffix = outputTag ? `.${outputTag}` : '';
const outputSql = join(root, 'supabase', 'seed', `activity_google_places_validation${outputSuffix}.generated.sql`);
const outputAudit = join(root, 'data', `activity_google_places_validation${outputSuffix}.generated.json`);
const fieldMask = [
  'id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri', 'websiteUri',
  'businessStatus', 'rating', 'userRatingCount', 'primaryType',
].join(',');
const searchFieldMask = fieldMask.split(',').map((field) => `places.${field}`).join(',');
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
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const googleApiKey = env.GOOGLE_PLACES_API_KEY || env.GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY;
const requestedLimit = Number(process.argv.find((argument) => argument.startsWith('--limit='))?.split('=')[1] || 0);
const forceAll = process.argv.includes('--full');
const linksOnly = process.argv.includes('--links-only');
const noFallback = process.argv.includes('--no-fallback');
const sourceFilter = process.argv.find((argument) => argument.startsWith('--source='))?.slice('--source='.length);
const activityIdFilter = process.argv.find((argument) => argument.startsWith('--activity-id='))?.slice('--activity-id='.length);
const unresolvedOnly = process.argv.includes('--unresolved');
const missingIdOnly = process.argv.includes('--missing-id');
const withIdOnly = process.argv.includes('--with-id');
const suspectCached = process.argv.includes('--suspect-cached');
const streetCached = process.argv.includes('--street-cached');
const fallbackAuditTag = process.argv.find((argument) => argument.startsWith('--fallback-from-audit='))?.slice('--fallback-from-audit='.length);
if (fallbackAuditTag && !/^[a-z0-9_-]{1,40}$/i.test(fallbackAuditTag)) throw new Error('Invalid fallback audit tag.');
const staleAfterDays = Math.max(0, Number(process.argv.find((argument) => argument.startsWith('--stale-after-days='))?.split('=')[1] || 14));

function sql(value) {
  return value == null || value === '' ? 'null' : `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function venueHint(activity) {
  const explicitVenue = String(activity.activity_name || '').match(/\bat\s+(.+)$/i)?.[1];
  return explicitVenue || activity.address || activity.activity_name;
}

function sqlNumeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 'null';
}

async function fetchActivities() {
  const columns = [
    'activity_id', 'activity_name', 'address', 'postcode', 'lat', 'long', 'website', 'google_link',
    'google_place_id', 'google_place_uri', 'source_name', 'data_source', 'google_place_checked_at',
    'google_place_check_status', 'category',
  ];
  return loadActiveActivities({ root, supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, columns });
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
  const query = `${activity.activity_name || venueHint(activity)}, ${activity.address || 'London'}`;
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
  if (!result.ok) return { place: null, candidates: [], error: `${result.status} ${result.body}` };
  const candidates = result.body.places || [];
  return { place: candidates.find((place) => isPlausibleSearchPlace(activity, place)) || null,
    candidates, error: null };
}

function valuesForPlace(activity, place) {
  return {
    activityId: activity.activity_id,
    address: place.formattedAddress || activity.address,
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
    placeId: place.id,
    placeUri: place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.activity_name || activity.address || 'London')}&query_place_id=${encodeURIComponent(place.id)}`,
    website: officialWebsiteUrl(place.websiteUri),
    rating: place.rating ?? null,
    reviews: place.userRatingCount ?? null,
    primaryType: place.primaryType || null,
  };
}

async function validateActivity(activity) {
  try {
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
        directPlace: direct || null,
        searchCandidates: resolved.candidates || [],
        error: resolved.error,
      };
    }
    if (resolved.place.businessStatus === 'CLOSED_PERMANENTLY') {
      // A text match is not strong enough to archive a listing; avoid false
      // removals and leave it unresolved for the next source refresh.
      return { activity, action: 'unresolved-closed-match', source: 'text-search', place: resolved.place };
    }
    return { activity, action: 'update', source: 'text-search', place: resolved.place };
  } catch (error) {
    // Quota, timeout, and upstream failures are audit results, never evidence
    // that a venue closed.
    return { activity, action: 'request-error', source: 'google-places', error: error.message };
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;
  let completed = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
      completed += 1;
      if (completed % 100 === 0 || completed === items.length) {
        console.log(`Google Places validation: ${completed}/${items.length} checked.`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function buildSql(updates, archives, results) {
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
  ${linksOnly ? '' : `address = coalesce(verified_places.address, activity.address),
  lat = verified_places.lat,
  long = verified_places.long,
  `}google_place_id = verified_places.google_place_id,
  google_place_uri = verified_places.google_place_uri,
  google_link = verified_places.google_place_uri,
  ${linksOnly ? '' : `website = coalesce(activity.website, verified_places.website),
  google_rating = coalesce(verified_places.google_rating, activity.google_rating),
  google_user_rating_count = coalesce(verified_places.google_user_rating_count, activity.google_user_rating_count),
  google_primary_type = coalesce(verified_places.google_primary_type, activity.google_primary_type),
  `}updated_at = now()
from verified_places
where activity.activity_id = verified_places.activity_id;
`
    : '-- No valid Google Place updates found.\n';
  const checkSql = results.length
    ? `\nwith place_checks (activity_id, check_status, business_status) as (
  values
    ${results.map((row) => `(${sql(row.activity.activity_id)}::uuid, ${sql(row.action)}::text, ${sql(row.place?.businessStatus)}::text)`).join(',\n    ')}
)
update public.activities as activity
set google_place_checked_at = now(),
    google_place_check_status = place_checks.check_status,
    google_business_status = coalesce(place_checks.business_status, activity.google_business_status),
    updated_at = now()
from place_checks
where activity.activity_id = place_checks.activity_id;
`
    : '';
  const archiveSql = archives.length
    ? `\n-- Google confirmed these stored Place records as permanently closed.
update public.activities
set archive_previous_listing_status = case when public_listing_status in ('draft', 'published') then public_listing_status else archive_previous_listing_status end,
    archive = true,
    public_listing_status = 'archived',
    archive_reason = 'Stale listing: Google Places marks the identity-matched venue permanently closed',
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
where activity_id in (${archives.map((row) => `${sql(row.activity.activity_id)}::uuid`).join(', ')});
`
    : '';
  return `-- Generated by scripts/validate-google-places-records.js
-- Each update is based on a current Google Places record whose name/address
-- matches the activity. Permanently closed stored Place records are archived.
\n${updateSql}${noFallback ? '-- Search fallbacks deferred for review.\n' : buildFallbackSql(results)}${buildCoordinateFallbackSql(results)}${checkSql}${archiveSql}`;
}

function buildCoordinateFallbackSql(results) {
  const fallbacks = results.filter((row) => row.activity
    && !row.activity.google_place_id
    && ['unresolved', 'unresolved-closed-match'].includes(row.action)
    && (isCoordinateOnlyGoogleUrl(row.activity.google_place_uri)
      || isCoordinateOnlyGoogleUrl(row.activity.google_link)));
  if (!fallbacks.length) return '-- No coordinate-only links require a named search.\n';
  return `-- A coordinate pin hides the identity of the place; search by the
-- listing name and address where no verified Google Place exists.
with named_searches (activity_id, search_url) as (
  values
    ${fallbacks.map((row) => `(${sql(row.activity.activity_id)}::uuid, ${sql(googlePlaceSearchUrl(row.activity))}::text)`).join(',\n    ')}
)
update public.activities as activity
set google_place_uri = named_searches.search_url,
    google_link = named_searches.search_url,
    updated_at = now()
from named_searches
where activity.activity_id = named_searches.activity_id
  and activity.google_place_id is null
  and activity.archive = false;
`;
}

function buildFallbackSql(results) {
  const fallbacks = results.filter((row) => needsGoogleSearchFallback(row.activity, row.directPlace, row.action));
  if (!fallbacks.length) return '-- No unverified direct Place pins require a search fallback.\n';
  return `-- When a stored Place cannot be verified as this activity or venue,
-- show a named Maps search rather than claiming an unverified direct pin.
with fallback_links (activity_id, old_place_id, search_url) as (
  values
    ${fallbacks.map((row) => `(${sql(row.activity.activity_id)}::uuid, ${sql(row.activity.google_place_id)}::text, ${sql(googlePlaceSearchUrl(row.activity))}::text)`).join(',\n    ')}
)
update public.activities as activity
set google_place_id = null,
    google_place_uri = fallback_links.search_url,
    google_link = fallback_links.search_url,
    updated_at = now()
from fallback_links
where activity.activity_id = fallback_links.activity_id
  and activity.google_place_id is not distinct from fallback_links.old_place_id
  and activity.archive = false;
`;
}

async function main() {
  if (!googleApiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.');
  const activities = await fetchActivities();
  if (fallbackAuditTag) {
    const audit = JSON.parse(readFileSync(join(root, 'data', `activity_google_places_validation.${fallbackAuditTag}.generated.json`), 'utf8'));
    const byId = new Map(activities.filter((activity) =>
      activity.google_place_check_status === 'unresolved')
      .map((activity) => [activity.activity_id, activity]));
    const results = audit.results.map((row) => ({
      activity: byId.get(row.activity_id), action: row.action,
      directPlace: row.rejected_stored_place_name ? {
        displayName: { text: row.rejected_stored_place_name },
        primaryType: row.rejected_stored_place_type,
        location: row.rejected_stored_place_location,
      } : null,
    }));
    const fallbackSql = buildFallbackSql(results);
    mkdirSync(dirname(outputSql), { recursive: true });
    writeFileSync(outputSql, fallbackSql);
    console.log(`Generated search fallbacks from ${fallbackAuditTag}: ${results.filter((row) =>
      needsGoogleSearchFallback(row.activity, row.directPlace, row.action)).length}.`);
    return;
  }
  const cutoff = Date.now() - staleAfterDays * 24 * 60 * 60 * 1000;
  const cachedResults = suspectCached || streetCached
    ? JSON.parse(readFileSync(join(root, 'data', 'activity_google_places_validation.generated.json'), 'utf8')).results : null;
  const cachedSuspects = cachedResults ? new Set(cachedResults
    .filter((row) => row.action === 'update' && (
      (suspectCached && /Google Places|Museums London/i.test(row.source_name || '')
        && !nameMatches({ activity_name: row.activity_name }, { displayName: { text: row.place_name } }))
      || (streetCached && /\b(road|street|grove|avenue|lane|drive|square|terrace|place|rd|st|ave)$/i.test(row.place_name || '')
        && !nameMatches({ activity_name: row.activity_name }, { displayName: { text: row.place_name } }))
    )).map((row) => row.activity_id)) : null;
  const targets = (forceAll
    ? activities
    : activities.filter((activity) => !activity.google_place_checked_at || new Date(activity.google_place_checked_at).valueOf() <= cutoff))
    .filter((activity) => !sourceFilter || activity.data_source === sourceFilter)
    .filter((activity) => !activityIdFilter || activity.activity_id === activityIdFilter)
    .filter((activity) => !unresolvedOnly || activity.google_place_check_status === 'unresolved')
    .filter((activity) => !missingIdOnly || !activity.google_place_id)
    .filter((activity) => !withIdOnly || Boolean(activity.google_place_id))
    .filter((activity) => !cachedSuspects || cachedSuspects.has(activity.activity_id))
    .slice(0, requestedLimit || undefined);
  console.log(`Validating ${targets.length} of ${activities.length} active activities against Google Places.`);
  const results = await mapWithConcurrency(targets, 5, validateActivity);
  const updates = results.filter((result) => result.action === 'update');
  const archives = linksOnly ? [] : results.filter((result) => result.action === 'archive-permanently-closed');
  const summary = results.reduce((counts, result) => ({ ...counts, [result.action]: (counts[result.action] || 0) + 1 }), {});

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(updates, archives, results));
  writeFileSync(outputAudit, JSON.stringify({
    generated_at: new Date().toISOString(),
    full_validation: forceAll,
    stale_after_days: staleAfterDays,
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
      original_place_id: result.activity.google_place_id || null,
      business_status: result.place?.businessStatus || null,
      rejected_stored_place_name: result.directPlace?.displayName?.text || null,
      rejected_stored_place_address: result.directPlace?.formattedAddress || null,
      rejected_stored_place_type: result.directPlace?.primaryType || null,
      rejected_stored_place_location: result.directPlace?.location || null,
      search_candidates: (result.searchCandidates || []).map((place) => ({
        id: place.id, name: place.displayName?.text, address: place.formattedAddress,
        type: place.primaryType, website: place.websiteUri,
      })),
      error: result.error || null,
    })),
  }, null, 2) + '\n');
  console.log(`Google Place validation generated ${updates.length} repairs and ${archives.length} permanent-closure archives.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
