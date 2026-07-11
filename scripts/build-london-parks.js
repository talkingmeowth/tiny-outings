/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activities_london_parks_20260711.generated.sql');
const outputAudit = join(root, 'data', 'london_parks_20260711.generated.json');
const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const zones = [
  { name: 'Waltham Forest', center: { latitude: 51.589, longitude: -0.025 } },
  { name: 'Hackney', center: { latitude: 51.545, longitude: -0.055 } },
  { name: 'Islington', center: { latitude: 51.536, longitude: -0.104 } },
  { name: 'Newham', center: { latitude: 51.530, longitude: 0.020 } },
  { name: 'North London', center: { latitude: 51.575, longitude: -0.112 } },
  { name: 'Central London', center: { latitude: 51.516, longitude: -0.112 } },
  { name: 'South London', center: { latitude: 51.463, longitude: -0.098 } },
  { name: 'West London', center: { latitude: 51.511, longitude: -0.209 } },
];
const namedParks = ['St James Park Walthamstow', 'Springfield Park London'];
const detailsMask = 'id,displayName,formattedAddress,location,googleMapsUri,websiteUri,rating,userRatingCount,primaryType,types,regularOpeningHours,photos,businessStatus';
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function readEnv() {
  try {
    return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => { const index = line.indexOf('='); return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
  } catch { return {}; }
}

const env = readEnv();
const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}
function sqlArray(values) { return values?.length ? `array[${[...new Set(values)].map(sql).join(', ')}]` : "'{}'"; }
function postcode(value) { return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null; }
function normalized(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function borough(address) {
  const value = String(address || '').toUpperCase();
  if (/\b(E4|E10|E11|E17)\b/.test(value)) return 'Waltham Forest';
  if (/\b(E2|E5|E8|E9|N16)\b/.test(value)) return 'Hackney';
  if (/\b(N1|N5|N7|N19|EC1)\b/.test(value)) return 'Islington';
  if (/\b(E6|E7|E12|E13|E15|E16|E20)\b/.test(value)) return 'Newham';
  return 'London';
}
function availability(hours = {}) {
  const openDays = new Set();
  for (const period of hours.periods || []) if (period.open?.day !== undefined) openDays.add(dayNames[period.open.day]);
  const days = [...openDays].filter(Boolean);
  return { days, type: days.length === 7 ? 'daily' : days.length ? 'weekly' : 'daily', notes: hours.weekdayDescriptions?.join(' | ') || 'Open space; check the park website for facilities and seasonal notices.' };
}
async function google(url, options = {}) {
  if (!apiKey) throw new Error('Set GOOGLE_MAPS_API_KEY before running this import.');
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000), headers: { ...(options.headers || {}), 'X-Goog-Api-Key': apiKey } });
  if (!response.ok) throw new Error(`Google Places returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}
async function search(textQuery, center) {
  const response = await google('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': 'places.id' },
    body: JSON.stringify({ textQuery, maxResultCount: 20, languageCode: 'en-GB', regionCode: 'GB', locationBias: center ? { circle: { center, radius: 7000 } } : undefined }),
  });
  return response.places || [];
}
async function details(id) { return google(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=en-GB&regionCode=GB`, { headers: { 'X-Goog-FieldMask': detailsMask } }); }
async function existing() {
  const ids = new Set(); const keys = new Set();
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${supabaseUrl}/rest/v1/activities?select=google_place_id,activity_name,address&limit=1000&offset=${offset}`, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } });
    if (!response.ok) throw new Error(`Could not read activities: ${response.status}`);
    const page = await response.json();
    page.forEach((row) => { if (row.google_place_id) ids.add(row.google_place_id); keys.add(`${normalized(row.activity_name)}|${postcode(row.address) || ''}`); });
    if (page.length < 1000) return { ids, keys };
  }
}
async function mapWithConcurrency(items, limit, mapper) {
  const results = []; let index = 0;
  async function worker() { while (index < items.length) { const current = index; index += 1; results[current] = await mapper(items[current]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)); return results;
}
function row(place) {
  if (!place.location || place.businessStatus === 'CLOSED_PERMANENTLY') return null;
  const types = [place.primaryType, ...(place.types || [])].filter(Boolean).join(' ').toLowerCase();
  if (!types.includes('park') && !types.includes('playground')) return null;
  const address = place.formattedAddress || 'London'; const hours = availability(place.regularOpeningHours); const rating = Number(place.rating || 0) || null;
  return { activity_name: place.displayName?.text || 'Park', address, postcode: postcode(address), lat: Number(place.location.latitude), long: Number(place.location.longitude), category: 'Parks & outdoor play', start_time: '09:00', end_time: '17:00', google_link: place.googleMapsUri || null, website: place.websiteUri || place.googleMapsUri || null, child_friendly_score: rating ? Math.min(5, Math.round(rating * 10) / 10) : null, app_rating: rating, number_of_reviews: Number(place.userRatingCount || 0), age_suitability: 'Parents, babies and young children', borough: borough(address), days_of_week: hours.days, recurrence_rule: hours.days.length ? `FREQ=WEEKLY;BYDAY=${hours.days.map((day) => day.slice(0, 2).toUpperCase()).join(',')}` : null, schedule_notes: hours.notes, description: 'Park or playground for a pram walk, outdoor play, picnic, or a low-key family outing.', cost: 'Free', booking_required: false, source_name: 'Google Places API London parks directory', source_url: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}`, image_url: null, image_source_url: place.websiteUri || place.googleMapsUri || null, google_place_id: place.id, google_place_uri: place.googleMapsUri || null, google_photo_url: place.photos?.[0]?.name || null, google_rating: rating, google_user_rating_count: Number(place.userRatingCount || 0), google_primary_type: place.primaryType || null, google_opening_hours: place.regularOpeningHours || null, google_summary: null, activity_date: null, available_dates: [], availability_start_date: null, availability_end_date: null, available_days_of_week: hours.days, availability_type: hours.type, availability_notes: hours.notes, public_listing_status: 'published' };
}
const columns = ['activity_name','address','postcode','lat','long','category','start_time','end_time','google_link','website','child_friendly_score','app_rating','number_of_reviews','age_suitability','borough','days_of_week','recurrence_rule','schedule_notes','description','cost','booking_required','source_name','source_url','image_url','image_source_url','google_place_id','google_place_uri','google_photo_url','google_rating','google_user_rating_count','google_primary_type','google_opening_hours','google_summary','activity_date','available_dates','availability_start_date','availability_end_date','available_days_of_week','availability_type','availability_notes','public_listing_status'];
function rowSql(item) { return columns.map((column) => { const value = item[column]; if (['lat','long','child_friendly_score','app_rating','number_of_reviews','google_rating','google_user_rating_count'].includes(column)) return value ?? 'null'; if (['days_of_week','available_dates','available_days_of_week'].includes(column)) return sqlArray(value); if (column === 'booking_required') return value ? 'true' : 'false'; if (column === 'google_opening_hours') return value ? `${sql(JSON.stringify(value))}::jsonb` : 'null'; return sql(value); }).join(', '); }
async function main() {
  const known = await existing(); const candidates = new Set();
  for (const zone of zones) for (const place of await search(`parks and playgrounds in ${zone.name}`, zone.center)) candidates.add(place.id);
  for (const name of namedParks) for (const place of await search(name)) candidates.add(place.id);
  const places = await mapWithConcurrency([...candidates].filter((id) => !known.ids.has(id)), 5, async (id) => row(await details(id)));
  const rows = places.filter(Boolean).filter((item) => !known.keys.has(`${normalized(item.activity_name)}|${item.postcode || ''}`));
  rows.sort((left, right) => left.activity_name.localeCompare(right.activity_name));
  const sqlText = rows.length ? `-- Generated by scripts/build-london-parks.js using official Google Places data.\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n${rows.map((item) => `(${rowSql(item)})`).join(',\n')};\n` : '-- No new London parks found.\n';
  mkdirSync(dirname(outputSql), { recursive: true }); mkdirSync(dirname(outputAudit), { recursive: true }); writeFileSync(outputSql, sqlText); writeFileSync(outputAudit, JSON.stringify({ zones, namedParks, imported_rows: rows.length, rows }, null, 2) + '\n'); console.log(`Generated ${rows.length} London park listings.`);
}
main().catch((error) => { console.error(error.message); process.exit(1); });
