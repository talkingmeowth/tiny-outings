/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activity_cafe_google_photo_references_20260711.generated.sql');
const outputAudit = join(root, 'data', 'cafe_google_photo_references_20260711.generated.json');

function readDotEnv(name) {
  try {
    return Object.fromEntries(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, '')
      .split(/\r?\n/).filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      }));
  } catch {
    return {};
  }
}

const localEnv = readDotEnv('.env.local');
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const fieldMask = 'id,formattedAddress,googleMapsUri,photos';
const textSearchFieldMask = 'places.id,places.formattedAddress,places.googleMapsUri,places.photos';

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null;
}

async function fetchCafes() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration.');
  const response = await fetch(
    `${supabaseUrl}/rest/v1/activities?select=activity_id,activity_name,address,google_place_id,google_place_uri,image_url&public_listing_status=eq.published&category=eq.${encodeURIComponent('Child-friendly cafes')}&order=activity_name.asc`,
    { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } },
  );
  if (!response.ok) throw new Error(`Could not read cafes: ${response.status} ${await response.text()}`);
  return response.json();
}

async function google(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: { ...(options.headers || {}), 'X-Goog-Api-Key': googleApiKey },
  });
  if (!response.ok) throw new Error(`Google Places returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

async function findPlace(cafe) {
  if (cafe.google_place_id) {
    try {
      return await google(`https://places.googleapis.com/v1/places/${encodeURIComponent(cafe.google_place_id)}?languageCode=en-GB&regionCode=GB`, {
        headers: { 'X-Goog-FieldMask': fieldMask },
      });
    } catch {
      // A stale place ID falls back to a postcode-checked text search.
    }
  }

  const result = await google('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': textSearchFieldMask },
    body: JSON.stringify({ textQuery: `${cafe.activity_name}, ${cafe.address}`, languageCode: 'en-GB', regionCode: 'GB' }),
  });
  const expectedPostcode = postcode(cafe.address);
  return (result.places || []).find((place) => !expectedPostcode || postcode(place.formattedAddress) === expectedPostcode) || null;
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
  if (!rows.length) return '-- No cafe photo references found.';
  return `with cafe_photos (activity_id, google_place_id, google_place_uri, google_photo_url) as (
  values
    ${rows.map((row) => `(${sql(row.activityId)}::uuid, ${sql(row.placeId)}::text, ${sql(row.placeUri)}::text, ${sql(row.photoReference)}::text)`).join(',\n    ')}
)
update public.activities as activities
set
  google_place_id = cafe_photos.google_place_id,
  google_place_uri = coalesce(cafe_photos.google_place_uri, activities.google_place_uri),
  google_link = coalesce(cafe_photos.google_place_uri, activities.google_link),
  google_photo_url = cafe_photos.google_photo_url,
  updated_at = now()
from cafe_photos
where activities.activity_id = cafe_photos.activity_id;`;
}

async function main() {
  if (!googleApiKey) throw new Error('Missing GOOGLE_MAPS_API_KEY.');
  const cafes = await fetchCafes();
  const results = await mapWithConcurrency(cafes, 4, async (cafe, index) => {
    try {
      const place = await findPlace(cafe);
      const photoReference = place?.photos?.[0]?.name || null;
      console.log(`${index + 1}/${cafes.length} ${photoReference ? 'photo' : 'missing'}: ${cafe.activity_name}`);
      return {
        activityId: cafe.activity_id,
        activityName: cafe.activity_name,
        existingImage: Boolean(cafe.image_url),
        placeId: place?.id || cafe.google_place_id || null,
        placeUri: place?.googleMapsUri || cafe.google_place_uri || null,
        photoReference,
        status: photoReference ? 'ready' : 'missing',
      };
    } catch (error) {
      return { activityId: cafe.activity_id, activityName: cafe.activity_name, status: 'error', error: error.message };
    }
  });
  const updates = results.filter((result) => result.status === 'ready');
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, `-- Generated by scripts/enrich-cafe-google-photo-references.js\n-- Google photo references are requested live by the app; no photo files are stored.\n\n${updateSql(updates)}\n`);
  writeFileSync(outputAudit, JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2) + '\n');
  console.log(`Wrote ${updates.length} cafe photo references.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
