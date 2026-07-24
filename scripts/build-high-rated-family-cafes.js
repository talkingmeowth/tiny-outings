/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFamilyCafePlace } from './lib/activity-import-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activities_high_rated_family_cafes_20260711.generated.sql');
const outputAudit = join(root, 'data', 'high_rated_family_cafes_20260711.generated.json');
const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

const areas = [
  { name: 'Leyton', borough: 'Waltham Forest', center: { latitude: 51.5607, longitude: -0.0088 } },
  { name: 'Leytonstone', borough: 'Waltham Forest', center: { latitude: 51.5685, longitude: 0.0092 } },
  { name: 'Walthamstow', borough: 'Waltham Forest', center: { latitude: 51.582, longitude: -0.020 } },
  { name: 'Hackney', borough: 'Hackney', center: { latitude: 51.545, longitude: -0.055 } },
  { name: 'Stoke Newington', borough: 'Hackney', center: { latitude: 51.562, longitude: -0.075 } },
  { name: 'Islington', borough: 'Islington', center: { latitude: 51.5362, longitude: -0.1033 } },
  { name: 'Finsbury Park, Islington', borough: 'Islington', center: { latitude: 51.564, longitude: -0.106 } },
  { name: 'Stratford', borough: 'Newham', center: { latitude: 51.5413, longitude: -0.003 } },
];
const namedBakeries = [
  'Beaten by a Whisker Walthamstow',
  'Jolene Bakery Newington Green',
  'Jolene Bakery Hornsey Road',
  'SUBA Walthamstow',
];
const radiusMeters = 2500;
const discoveryMask = 'places.id';
const detailsMask = [
  'id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri', 'websiteUri',
  'rating', 'userRatingCount', 'primaryType', 'types', 'regularOpeningHours', 'businessStatus', 'goodForChildren', 'photos',
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
  return '$$' + String(value).replaceAll('$$', '$ $') + '$$';
}

function sqlArray(values) {
  const clean = [...new Set((values || []).filter(Boolean))];
  return clean.length ? `array[${clean.map(sql).join(', ')}]` : "'{}'";
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null;
}

function normalized(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function boroughForAddress(address, fallback) {
  const value = String(address || '').toUpperCase();
  if (/\b(E10|E11|E17)\b/.test(value)) return 'Waltham Forest';
  if (/\b(E2|E5|E8|E9|N16)\b/.test(value)) return 'Hackney';
  if (/\b(N1|N5|N7|N19|EC1)\b/.test(value)) return 'Islington';
  if (/\b(E6|E7|E12|E13|E15|E16|E20)\b/.test(value)) return 'Newham';
  return fallback;
}

function distanceMeters(origin, destination) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const lat = toRadians(destination.latitude - origin.latitude);
  const long = toRadians(destination.longitude - origin.longitude);
  const value = Math.sin(lat / 2) ** 2
    + Math.cos(toRadians(origin.latitude)) * Math.cos(toRadians(destination.latitude)) * Math.sin(long / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
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
  const closing = ends.sort().at(-1) || '17:00';
  return {
    days: listedDays,
    start,
    // Activities does not model overnight hours; the full opening times remain in notes.
    end: closing <= start ? '23:59' : closing,
    type: listedDays.length === 7 ? 'daily' : listedDays.length ? 'weekly' : 'unknown',
    notes: hours.weekdayDescriptions?.join(' | ') || 'Check opening times with the cafe.',
  };
}

async function google(url, options = {}) {
  if (!apiKey) throw new Error('Missing GOOGLE_MAPS_API_KEY.');
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: { ...(options.headers || {}), 'X-Goog-Api-Key': apiKey },
  });
  if (!response.ok) throw new Error(`Google Places returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function discover(area, textQuery) {
  const result = await google('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': discoveryMask },
    body: JSON.stringify({
      textQuery,
      maxResultCount: 20,
      languageCode: 'en-GB',
      regionCode: 'GB',
      locationBias: area ? { circle: { center: area.center, radius: radiusMeters } } : undefined,
    }),
  });
  return result.places || [];
}

async function details(id) {
  return google(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=en-GB&regionCode=GB`, {
    headers: { 'X-Goog-FieldMask': detailsMask },
  });
}

async function existingPlaceIds() {
  const ids = new Set();
  const venueKeys = new Set();
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/activities?select=google_place_id,activity_name,address&public_listing_status=eq.published&limit=1000&offset=${offset}`,
      { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } },
    );
    if (!response.ok) throw new Error(`Could not read existing activities: ${response.status}`);
    const page = await response.json();
    page.forEach((row) => {
      if (row.google_place_id) ids.add(row.google_place_id);
      const key = `${normalized(row.activity_name)}|${postcode(row.address) || ''}`;
      venueKeys.add(key);
    });
    if (page.length < 1000) return { ids, venueKeys };
  }
}

function isCafeOrBakery(place) {
  const types = [place.primaryType, ...(place.types || [])].filter(Boolean).join(' ').toLowerCase();
  return types.includes('cafe') || types.includes('bakery') || types.includes('coffee_shop');
}

function isHighRated(place) {
  return Number(place.rating || 0) >= 4.4 && Number(place.userRatingCount || 0) >= 50;
}

function toRow(place, area, discoveryTerms, named) {
  const hours = availability(place.regularOpeningHours);
  const rating = Number(place.rating);
  const reviewCount = Number(place.userRatingCount);
  const address = place.formattedAddress || `${area.name}, London`;
  return {
    activity_name: place.displayName?.text || 'Cafe',
    address,
    postcode: postcode(address),
    lat: Number(place.location.latitude),
    long: Number(place.location.longitude),
    category: 'Child-friendly cafes',
    start_time: hours.start,
    end_time: hours.end,
    google_link: place.googleMapsUri || null,
    website: place.websiteUri || place.googleMapsUri || null,
    child_friendly_score: Math.min(5, Math.round((rating + 0.5) * 10) / 10),
    app_rating: rating,
    number_of_reviews: reviewCount,
    age_suitability: 'Parents, babies and families',
    borough: boroughForAddress(address, area.borough),
    days_of_week: hours.days,
    recurrence_rule: hours.days.length ? `FREQ=WEEKLY;BYDAY=${hours.days.map((day) => day.slice(0, 2).toUpperCase()).join(',')}` : null,
    schedule_notes: hours.notes,
    description: `${named ? 'Independent bakery' : 'High-rated cafe or bakery'} discovered in a family-focused Google Places search for ${area.name}: ${rating}/5 from ${reviewCount} Google reviews.`,
    cost: 'Cafe or bakery purchases',
    booking_required: false,
    source_name: 'Google Places API family cafe and bakery discovery',
    source_url: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}`,
    image_url: null,
    image_source_url: place.websiteUri || place.googleMapsUri || null,
    google_place_id: place.id,
    google_place_uri: place.googleMapsUri || null,
    google_photo_url: place.photos?.[0]?.name || null,
    google_rating: rating,
    google_user_rating_count: reviewCount,
    google_primary_type: place.primaryType || 'cafe',
    google_opening_hours: place.regularOpeningHours || null,
    google_summary: null,
    activity_date: null,
    available_dates: [],
    availability_start_date: null,
    availability_end_date: null,
    available_days_of_week: hours.days,
    availability_type: hours.type,
    availability_notes: `Discovered via: ${[...discoveryTerms].join('; ')}. ${hours.notes}`,
    public_listing_status: 'published',
    distance_meters: Math.round(distanceMeters(area.center, place.location)),
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
  return `-- Generated by scripts/build-high-rated-family-cafes.js\n-- Google Places rating aggregates only; no review text is stored.\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n${rows.map((row) => `(${rowSql(row)})`).join(',\n')}\n;\n`;
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration.');
  const existing = await existingPlaceIds();
  const discovered = new Map();

  for (const area of areas) {
    for (const query of [
      `family friendly cafe in ${area.name}, London`,
      `baby friendly cafe in ${area.name}, London`,
      `independent bakery in ${area.name}, London`,
    ]) {
      for (const place of await discover(area, query)) {
        const current = discovered.get(place.id) || { areas: new Set(), terms: new Set() };
        current.areas.add(area.name);
        current.terms.add(query);
      discovered.set(place.id, current);
    }
  }

  for (const query of namedBakeries) {
    for (const place of await discover(null, query)) {
      const current = discovered.get(place.id) || { areas: new Set(), terms: new Set(), named: false };
      current.areas.add('Named bakery');
      current.terms.add(query);
      current.named = true;
      discovered.set(place.id, current);
    }
  }
  }

  const rows = [];
  for (const [id, discovery] of discovered) {
    if (existing.ids.has(id)) continue;
    const place = await details(id);
    const area = areas.find((item) => distanceMeters(item.center, place.location) <= radiusMeters);
    if (!area || !isCafeOrBakery(place) || !isFamilyCafePlace(place) || (!discovery.named && !isHighRated(place))) continue;
    if (!discovery.named && place.goodForChildren !== true && ![...discovery.terms].some((term) => term.includes('family friendly'))) continue;
    const existingKey = `${normalized(place.displayName?.text)}|${postcode(place.formattedAddress) || ''}`;
    if (existing.venueKeys.has(existingKey)) continue;
    rows.push(toRow(place, area, discovery.terms, discovery.named));
  }

  rows.sort((left, right) => right.google_rating - left.google_rating || right.google_user_rating_count - left.google_user_rating_count);
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, JSON.stringify({ areas, minimum_rating: 4.4, minimum_review_count: 50, rows }, null, 2) + '\n');
  console.log(`Generated ${rows.length} high-rated family cafe listings.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
