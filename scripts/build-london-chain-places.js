/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activities_london_cafe_expansion_20260711.generated.sql');
const outputAudit = join(root, 'data', 'london_cafe_expansion_20260711.generated.json');
const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const zones = [
  { name: 'East London', center: { latitude: 51.542, longitude: -0.018 } },
  { name: 'North London', center: { latitude: 51.574, longitude: -0.112 } },
  { name: 'Central London', center: { latitude: 51.516, longitude: -0.112 } },
  { name: 'West London', center: { latitude: 51.511, longitude: -0.209 } },
  { name: 'South London', center: { latitude: 51.462, longitude: -0.098 } },
];
const searches = [
  { query: "GAIL's Bakery", category: 'Child-friendly cafes', type: 'cafe' },
  { query: 'Starbucks', category: 'Child-friendly cafes', type: 'cafe' },
  { query: 'Blank Street Coffee', category: 'Child-friendly cafes', type: 'cafe' },
  { query: 'family friendly cafe', category: 'Child-friendly cafes', type: 'cafe' },
  { query: 'baby friendly cafe', category: 'Child-friendly cafes', type: 'cafe' },
  { query: 'Yardarm', category: 'Child-friendly cafes', type: 'cafe' },
  { query: 'bookshop', category: 'Bookshops', type: 'bookshop' },
  { query: "children's bookshop", category: 'Bookshops', type: 'bookshop' },
];
const discoveryMask = 'places.id';
const detailsMask = [
  'id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri', 'websiteUri',
  'rating', 'userRatingCount', 'primaryType', 'types', 'regularOpeningHours', 'photos', 'businessStatus',
].join(',');
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const clean = [...new Set((values || []).filter(Boolean))];
  return clean.length ? `array[${clean.map(sql).join(', ')}]` : "'{}'";
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null;
}

function normalized(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

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
  const starts = [];
  const ends = [];
  for (const period of hours.periods || []) {
    if (period.open?.day !== undefined) openDays.add(days[period.open.day]);
    if (period.open?.hour !== undefined) starts.push(`${String(period.open.hour).padStart(2, '0')}:${String(period.open.minute || 0).padStart(2, '0')}`);
    if (period.close?.hour !== undefined) ends.push(`${String(period.close.hour).padStart(2, '0')}:${String(period.close.minute || 0).padStart(2, '0')}`);
  }
  const listedDays = [...openDays].filter(Boolean);
  const start = starts.sort()[0] || '09:00';
  const end = ends.sort().at(-1) || '17:00';
  return {
    days: listedDays,
    start,
    end: end <= start ? '23:59' : end,
    type: listedDays.length === 7 ? 'daily' : listedDays.length ? 'weekly' : 'unknown',
    notes: hours.weekdayDescriptions?.join(' | ') || 'Check the venue for current opening times.',
  };
}

async function google(url, options = {}) {
  if (!apiKey) throw new Error('Set GOOGLE_MAPS_API_KEY before running this import.');
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: { ...(options.headers || {}), 'X-Goog-Api-Key': apiKey },
  });
  if (!response.ok) throw new Error(`Google Places returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function discover(zone, search) {
  const result = await google('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': discoveryMask },
    body: JSON.stringify({
      textQuery: `${search.query} in ${zone.name}`,
      maxResultCount: 20,
      languageCode: 'en-GB',
      regionCode: 'GB',
      locationBias: { circle: { center: zone.center, radius: 6000 } },
    }),
  });
  return result.places || [];
}

async function details(id) {
  return google(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=en-GB&regionCode=GB`, {
    headers: { 'X-Goog-FieldMask': detailsMask },
  });
}

async function existingVenues() {
  const ids = new Set();
  const venueKeys = new Set();
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/activities?select=google_place_id,activity_name,address&limit=1000&offset=${offset}`,
      { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } },
    );
    if (!response.ok) throw new Error(`Could not read existing activities: ${response.status}`);
    const page = await response.json();
    page.forEach((row) => {
      if (row.google_place_id) ids.add(row.google_place_id);
      venueKeys.add(`${normalized(row.activity_name)}|${postcode(row.address) || ''}`);
    });
    if (page.length < 1000) return { ids, venueKeys };
  }
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
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, worker));
  return results;
}

function toRow(place, discovery) {
  if (!place.location || place.businessStatus === 'CLOSED_PERMANENTLY') return null;
  const address = place.formattedAddress || 'London';
  const hours = availability(place.regularOpeningHours);
  const isCafe = discovery.types.has('cafe');
  const rating = Number(place.rating || 0) || null;
  const reviewCount = Number(place.userRatingCount || 0);
  // Avoid promoting low-quality cafes while retaining unrated family venues for manual review.
  if (isCafe && rating !== null && reviewCount >= 10 && rating < 3.8) return null;
  const photoReference = place.photos?.[0]?.name || null;
  return {
    activity_name: place.displayName?.text || (isCafe ? 'Cafe' : 'Bookshop'),
    address,
    postcode: postcode(address),
    lat: Number(place.location.latitude),
    long: Number(place.location.longitude),
    category: isCafe ? 'Child-friendly cafes' : 'Bookshops',
    start_time: hours.start,
    end_time: hours.end,
    google_link: place.googleMapsUri || null,
    website: place.websiteUri || place.googleMapsUri || null,
    child_friendly_score: rating ? Math.min(5, Math.round(rating * 10) / 10) : null,
    app_rating: rating,
    number_of_reviews: reviewCount,
    age_suitability: 'Parents, babies and young children',
    borough: borough(address),
    days_of_week: hours.days,
    recurrence_rule: hours.days.length ? `FREQ=WEEKLY;BYDAY=${hours.days.map((day) => day.slice(0, 2).toUpperCase()).join(',')}` : null,
    schedule_notes: hours.notes,
    description: isCafe
      ? 'A London cafe branch for a low-key coffee, snack, or meet-up with little ones. Check the venue for facilities.'
      : 'A London bookshop for browsing with little ones. Check the venue for children\'s events and facilities.',
    cost: isCafe ? 'Cafe purchases' : 'Free to browse',
    booking_required: false,
    source_name: 'Google Places API London family directory',
    source_url: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}`,
    image_url: null,
    image_source_url: place.websiteUri || place.googleMapsUri || null,
    google_place_id: place.id,
    google_place_uri: place.googleMapsUri || null,
    google_photo_url: photoReference,
    google_rating: rating,
    google_user_rating_count: reviewCount,
    google_primary_type: place.primaryType || null,
    google_opening_hours: place.regularOpeningHours || null,
    google_summary: null,
    activity_date: null,
    available_dates: [],
    availability_start_date: null,
    availability_end_date: null,
    available_days_of_week: hours.days,
    availability_type: hours.type,
    availability_notes: `Google Places discovery: ${[...discovery.queries].join('; ')}. ${hours.notes}`,
    public_listing_status: 'published',
  };
}

const columns = [
  'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website',
  'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'recurrence_rule',
  'schedule_notes', 'description', 'cost', 'booking_required', 'source_name', 'source_url', 'image_url', 'image_source_url',
  'google_place_id', 'google_place_uri', 'google_photo_url', 'google_rating', 'google_user_rating_count', 'google_primary_type',
  'google_opening_hours', 'google_summary', 'activity_date', 'available_dates', 'availability_start_date', 'availability_end_date',
  'available_days_of_week', 'availability_type', 'availability_notes', 'public_listing_status',
];

function rowSql(row) {
  return columns.map((column) => {
    const value = row[column];
    if (['lat', 'long', 'child_friendly_score', 'app_rating', 'number_of_reviews', 'google_rating', 'google_user_rating_count'].includes(column)) return value ?? 'null';
    if (['days_of_week', 'available_dates', 'available_days_of_week'].includes(column)) return sqlArray(value);
    if (column === 'booking_required') return value ? 'true' : 'false';
    if (column === 'google_opening_hours') return value ? `${sql(JSON.stringify(value))}::jsonb` : 'null';
    return sql(value);
  }).join(', ');
}

function buildSql(rows) {
  if (!rows.length) return '-- No new London chain cafes or bookshops found.';
  return '-- Generated by scripts/build-london-chain-places.js using official Google Places data.\n\n'
    + `insert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n`
    + rows.map((row) => `(${rowSql(row)})`).join(',\n')
    + ';\n';
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration.');
  const existing = await existingVenues();
  const candidates = new Map();

  for (const zone of zones) {
    for (const search of searches) {
      for (const place of await discover(zone, search)) {
        const current = candidates.get(place.id) || { types: new Set(), queries: new Set(), zones: new Set() };
        current.types.add(search.type);
        current.queries.add(`${search.query} in ${zone.name}`);
        current.zones.add(zone.name);
        candidates.set(place.id, current);
      }
    }
  }

  const selected = [...candidates.entries()].filter(([id]) => !existing.ids.has(id));
  const detailsRows = await mapWithConcurrency(selected, 5, async ([id, discovery]) => toRow(await details(id), discovery));
  const rows = detailsRows.filter(Boolean).filter((row) => !existing.venueKeys.has(`${normalized(row.activity_name)}|${row.postcode || ''}`));
  rows.sort((left, right) => left.category.localeCompare(right.category) || left.activity_name.localeCompare(right.activity_name));

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, JSON.stringify({ zones, searches, discovered_places: candidates.size, imported_rows: rows.length, rows }, null, 2) + '\n');
  console.log(`Generated ${rows.length} London chain cafe and bookshop listings.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
