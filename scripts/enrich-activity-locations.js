/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSqlPath = join(repoRoot, 'supabase', 'seed', 'activity_location_updates.generated.sql');
const outputAuditPath = join(repoRoot, 'data', 'activity_location_updates.generated.json');
const fieldMask = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.googleMapsUri',
  'places.location',
  'places.rating',
  'places.userRatingCount',
].join(',');

function readDotEnv(fileName) {
  try {
    return Object.fromEntries(
      readFileSync(join(repoRoot, fileName), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

const localEnv = readDotEnv('.env.local');
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const requestedLimit = Number(process.argv.find((argument) => argument.startsWith('--limit='))?.split('=')[1] || 0);

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function postcodeDistrict(value) {
  return String(value || '').match(/\b(?:E|N|SE|SW|W|NW|EC|WC)\d{1,2}[A-Z]?\b/i)?.[0]?.toUpperCase() || null;
}

function normalizedAddress(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isPlausiblePlace(group, place) {
  if (!place?.location || !Number.isFinite(place.location.latitude) || !Number.isFinite(place.location.longitude)) {
    return false;
  }

  const requestedDistrict = postcodeDistrict(group.address);
  const returnedDistrict = postcodeDistrict(place.formattedAddress);
  if (requestedDistrict && returnedDistrict && requestedDistrict !== returnedDistrict) return false;

  const tokens = normalizedAddress(group.address)
    .split(' ')
    .filter((token) => token.length > 3 && !['london', 'road', 'street', 'centre', 'center'].includes(token));
  const returned = normalizedAddress(`${place.displayName?.text || ''} ${place.formattedAddress || ''}`);
  return tokens.length === 0 || tokens.some((token) => returned.includes(token));
}

async function fetchPublishedActivities() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration.');
  const activities = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/activities?select=activity_id,activity_name,address,borough,lat,long&public_listing_status=eq.published&or=(lat.is.null,long.is.null)&order=activity_name.asc&limit=${pageSize}&offset=${offset}`,
      { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } },
    );
    if (!response.ok) throw new Error(`Could not read activities: ${response.status} ${await response.text()}`);
    const page = await response.json();
    activities.push(...page);
    if (page.length < pageSize) return activities;
  }
}

async function searchPlace(group) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleApiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify({
      textQuery: `${group.address}, London`,
      languageCode: 'en-GB',
      regionCode: 'GB',
      locationBias: {
        circle: {
          center: { latitude: 51.53, longitude: -0.04 },
          radius: 30000,
        },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 220)}`);
  const body = await response.json();
  return body.places?.find((place) => isPlausiblePlace(group, place)) || null;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function updateSql(rows) {
  if (!rows.length) return '-- No verified Google Places location updates found.';
  return `with location_updates (
  activity_id,
  formatted_address,
  lat,
  long,
  google_place_id,
  google_place_uri,
  google_rating,
  google_user_rating_count
) as (
  values
    ${rows.map((row) => `(${sqlString(row.activityId)}::uuid, ${sqlString(row.address)}::text, ${row.lat}::numeric, ${row.long}::numeric, ${sqlString(row.placeId)}::text, ${sqlString(row.placeUri)}::text, ${row.rating ?? 'null'}::numeric, ${row.reviewCount ?? 'null'}::integer)`).join(',\n    ')}
)
update public.activities as activities
set
  address = coalesce(location_updates.formatted_address, activities.address),
  lat = location_updates.lat,
  long = location_updates.long,
  google_place_id = location_updates.google_place_id,
  google_place_uri = location_updates.google_place_uri,
  google_link = coalesce(location_updates.google_place_uri, activities.google_link),
  google_rating = coalesce(location_updates.google_rating, activities.google_rating),
  google_user_rating_count = coalesce(location_updates.google_user_rating_count, activities.google_user_rating_count),
  updated_at = now()
from location_updates
where activities.activity_id = location_updates.activity_id;`;
}

async function main() {
  if (!googleApiKey) throw new Error('Missing GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY.');
  const activities = await fetchPublishedActivities();
  const grouped = new Map();
  for (const activity of activities) {
    const key = normalizedAddress(activity.address);
    if (!key) continue;
    const group = grouped.get(key) || { address: activity.address, activities: [] };
    group.activities.push(activity);
    grouped.set(key, group);
  }
  const groups = [...grouped.values()].slice(0, requestedLimit || undefined);
  console.log(`Resolving ${groups.length} unique venues for ${activities.length} activities.`);

  const results = await mapWithConcurrency(groups, 4, async (group, index) => {
    try {
      const place = await searchPlace(group);
      console.log(`${index + 1}/${groups.length} ${place ? 'matched' : 'unmatched'}: ${group.address}`);
      return { group, place, error: null };
    } catch (error) {
      console.warn(`${index + 1}/${groups.length} failed: ${group.address} (${error.message})`);
      return { group, place: null, error: error.message };
    }
  });

  const updates = results.flatMap(({ group, place }) => place
    ? group.activities.map((activity) => ({
      activityId: activity.activity_id,
      address: place.formattedAddress || activity.address,
      lat: place.location.latitude,
      long: place.location.longitude,
      placeId: place.id,
      placeUri: place.googleMapsUri,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? null,
    }))
    : []);
  const audit = results.map(({ group, place, error }) => ({
    address: group.address,
    activity_count: group.activities.length,
    status: place ? 'matched' : error ? 'error' : 'unmatched',
    place_id: place?.id || null,
    place_name: place?.displayName?.text || null,
    formatted_address: place?.formattedAddress || null,
    error,
  }));

  mkdirSync(dirname(outputSqlPath), { recursive: true });
  writeFileSync(outputSqlPath, `-- Generated by scripts/enrich-activity-locations.js\n-- Generated at ${new Date().toISOString()}\n\n${updateSql(updates)}\n`);
  mkdirSync(dirname(outputAuditPath), { recursive: true });
  writeFileSync(outputAuditPath, JSON.stringify(audit, null, 2));
  console.log(`Wrote ${updates.length} activity updates and ${audit.filter((row) => row.status === 'matched').length} matched venues.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
