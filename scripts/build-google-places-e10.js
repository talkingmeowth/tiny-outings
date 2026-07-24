/* global process */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFamilyCafePlace } from './lib/activity-import-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activities_google_places_e10_10_miles.generated.sql');
const outputAudit = join(root, 'data', 'google-places-e10-10-miles.generated.json');
const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const e10Query = 'E10, London, United Kingdom';
const radiusMeters = 16093.44;
const types = ['cafe', 'park', 'playground', 'museum', 'library', 'amusement_center'];
const familyQueries = [
  'family friendly cafe near E10 London',
  'baby friendly cafe near E10 London',
  'indoor play centre near E10 London',
  "children's museum near E10 London",
];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const discoveryMask = 'places.id,places.location';
const detailsMask = [
  'id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri', 'websiteUri',
  'rating', 'userRatingCount', 'primaryType', 'types', 'regularOpeningHours', 'photos',
  'businessStatus', 'goodForChildren',
].join(',');

function fail(message) {
  throw new Error(message);
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return '$$' + String(value).replaceAll('$$', '$ $') + '$$';
}

function sqlArray(values) {
  const clean = [...new Set((values || []).filter(Boolean))];
  return clean.length ? 'array[' + clean.map(sql).join(', ') + ']' : "'{}'";
}

function distanceMeters(a, b) {
  const radians = (value) => (value * Math.PI) / 180;
  const lat = radians(b.latitude - a.latitude);
  const long = radians(b.longitude - a.longitude);
  const value = Math.sin(lat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(long / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function category(place) {
  const allTypes = [place.primaryType, ...(place.types || [])].filter(Boolean).join(' ').toLowerCase();
  if (allTypes.includes('cafe') || allTypes.includes('coffee')) return 'child friendly cafe';
  if (allTypes.includes('museum')) return 'museum';
  if (allTypes.includes('library')) return 'library';
  if (allTypes.includes('playground') || allTypes.includes('amusement_center')) return 'indoor play';
  if (allTypes.includes('park')) return 'park';
  return 'family activity';
}

function borough(address) {
  const value = String(address || '').toLowerCase();
  if (/\b(e4|e10|e11|e17)\b/.test(value) || value.includes('waltham forest')) return 'Waltham Forest';
  if (/\b(e2|e5|e8|e9|n16)\b/.test(value) || value.includes('hackney')) return 'Hackney';
  if (/\b(n1|n5|n7|n19)\b/.test(value) || value.includes('islington')) return 'Islington';
  if (/\b(e6|e7|e12|e13|e15|e16)\b/.test(value) || value.includes('newham')) return 'Newham';
  return 'London';
}

function score(place) {
  const rating = Number(place.rating || 0);
  const reviewCount = Number(place.userRatingCount || 0);
  let value = rating ? rating * 0.72 : 0;
  if (reviewCount >= 500) value += 0.7;
  else if (reviewCount >= 100) value += 0.45;
  else if (reviewCount >= 25) value += 0.2;
  if (place.goodForChildren === true) value += 0.7;
  if (['park', 'playground', 'museum', 'library'].some((type) => String(place.primaryType || '').includes(type))) value += 0.25;
  return Math.min(5, Math.round(value * 10) / 10) || null;
}

function availability(hours = {}) {
  const periods = Array.isArray(hours.periods) ? hours.periods : [];
  const openDays = new Set();
  const starts = [];
  const ends = [];
  for (const period of periods) {
    if (period.open?.day !== undefined) openDays.add(days[period.open.day]);
    if (period.open?.hour !== undefined) starts.push(String(period.open.hour).padStart(2, '0') + ':' + String(period.open.minute || 0).padStart(2, '0'));
    if (period.close?.hour !== undefined) ends.push(String(period.close.hour).padStart(2, '0') + ':' + String(period.close.minute || 0).padStart(2, '0'));
  }
  const listedDays = [...openDays].filter(Boolean);
  return {
    days: listedDays,
    type: listedDays.length === 7 ? 'daily' : listedDays.length ? 'weekly' : 'unknown',
    start: starts.sort()[0] || '09:00',
    end: ends.sort().at(-1) || '17:00',
    notes: Array.isArray(hours.weekdayDescriptions) ? hours.weekdayDescriptions.join(' | ') : 'Check venue opening times.',
  };
}

async function google(url, options = {}) {
  if (!apiKey) fail('Set GOOGLE_MAPS_API_KEY before running this import.');
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30000),
    headers: { ...(options.headers || {}), 'X-Goog-Api-Key': apiKey },
  });
  if (!response.ok) fail('Google request failed (' + response.status + '): ' + (await response.text()).slice(0, 500));
  return response.json();
}

async function geocode() {
  const result = await google(
    'https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(e10Query) + '&key=' + encodeURIComponent(apiKey),
  );
  const location = result.results?.[0]?.geometry?.location;
  if (result.status !== 'OK' || !location) fail('Could not geocode E10: ' + (result.status || 'no result'));
  return { latitude: Number(location.lat), longitude: Number(location.lng) };
}

async function searchNearby(center, type) {
  const result = await google('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': discoveryMask },
    body: JSON.stringify({
      includedTypes: [type],
      maxResultCount: 20,
      rankPreference: 'POPULARITY',
      languageCode: 'en-GB',
      locationRestriction: { circle: { center, radius: radiusMeters } },
    }),
  });
  return result.places || [];
}

async function searchFamilyText(center, textQuery) {
  const result = await google('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': discoveryMask },
    body: JSON.stringify({
      textQuery,
      maxResultCount: 20,
      languageCode: 'en-GB',
      regionCode: 'GB',
      locationBias: { circle: { center, radius: radiusMeters } },
    }),
  });
  return result.places || [];
}

async function details(placeId) {
  return google('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId) + '?languageCode=en-GB&regionCode=GB', {
    headers: { 'X-Goog-FieldMask': detailsMask },
  });
}

async function photoUrl(name) {
  if (!name) return null;
  const photo = await google('https://places.googleapis.com/v1/' + name + '/media?maxWidthPx=1200&skipHttpRedirect=true');
  return photo.photoUri || null;
}

async function activity(place, center) {
  if (!place.id || !place.location || place.businessStatus === 'CLOSED_PERMANENTLY') return null;
  if (distanceMeters(center, place.location) > radiusMeters) return null;
  if (category(place) === 'child friendly cafe' && !isFamilyCafePlace(place)) return null;
  const hours = availability(place.regularOpeningHours);
  const image = await photoUrl(Array.isArray(place.photos) ? place.photos[0]?.name : null);
  const address = place.formattedAddress || '';
  return {
    activity_name: place.displayName?.text || 'Untitled place',
    address,
    postcode: address.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null,
    lat: Number(place.location.latitude),
    long: Number(place.location.longitude),
    category: category(place),
    start_time: hours.start,
    end_time: hours.end,
    google_link: place.googleMapsUri || null,
    website: place.websiteUri || null,
    child_friendly_score: score(place),
    app_rating: null,
    number_of_reviews: Number(place.userRatingCount || 0),
    age_suitability: 'Families and children',
    borough: borough(address),
    days_of_week: hours.days,
    recurrence_rule: hours.days.length ? 'FREQ=WEEKLY;BYDAY=' + hours.days.map((day) => day.slice(0, 2).toUpperCase()).join(',') : null,
    schedule_notes: hours.notes,
    description: (place.displayName?.text || 'This place') + ' discovered through the official Google Places API within 10 miles of E10.',
    cost: 'Check venue',
    booking_required: false,
    source_name: 'Google Places API',
    source_url: 'https://www.google.com/maps/place/?q=place_id:' + encodeURIComponent(place.id),
    image_url: image,
    image_source_url: place.googleMapsUri || null,
    google_place_id: place.id,
    google_place_uri: place.googleMapsUri || null,
    google_photo_url: image,
    google_rating: Number(place.rating || 0) || null,
    google_user_rating_count: Number(place.userRatingCount || 0),
    google_primary_type: place.primaryType || null,
    google_opening_hours: place.regularOpeningHours || null,
    google_summary: null,
    activity_date: null,
    available_dates: [],
    availability_start_date: null,
    availability_end_date: null,
    available_days_of_week: hours.days,
    availability_type: hours.type,
    availability_notes: hours.notes,
    public_listing_status: 'published',
    distance_meters: Math.round(distanceMeters(center, place.location)),
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
    if (column === 'google_opening_hours') return value ? sql(JSON.stringify(value)) + '::jsonb' : 'null';
    return sql(value);
  }).join(', ');
}

function buildSql(rows) {
  return '-- Generated by scripts/build-google-places-e10.js\n'
    + '-- Official Google Places API discovery within 10 miles of E10.\n\n'
    + 'insert into public.activities (\n  ' + columns.join(',\n  ') + '\n)\nvalues\n'
    + rows.map((row) => '(' + rowSql(row) + ')').join(',\n')
    + '\non conflict (google_place_id) where google_place_id is not null do update set\n'
    + '  activity_name = excluded.activity_name,\n  address = excluded.address,\n  postcode = excluded.postcode,\n'
    + '  lat = excluded.lat,\n  long = excluded.long,\n  category = excluded.category,\n'
    + '  start_time = excluded.start_time,\n  end_time = excluded.end_time,\n  google_link = excluded.google_link,\n'
    + '  website = excluded.website,\n  child_friendly_score = excluded.child_friendly_score,\n'
    + '  number_of_reviews = excluded.number_of_reviews,\n  days_of_week = excluded.days_of_week,\n'
    + '  recurrence_rule = excluded.recurrence_rule,\n  schedule_notes = excluded.schedule_notes,\n'
    + '  description = excluded.description,\n  image_url = excluded.image_url,\n  image_source_url = excluded.image_source_url,\n'
    + '  google_place_id = excluded.google_place_id,\n  google_place_uri = excluded.google_place_uri,\n'
    + '  google_photo_url = excluded.google_photo_url,\n  google_rating = excluded.google_rating,\n'
    + '  google_user_rating_count = excluded.google_user_rating_count,\n  google_primary_type = excluded.google_primary_type,\n'
    + '  google_opening_hours = excluded.google_opening_hours,\n  available_days_of_week = excluded.available_days_of_week,\n'
    + '  availability_type = excluded.availability_type,\n  availability_notes = excluded.availability_notes,\n'
    + '  public_listing_status = excluded.public_listing_status,\n  updated_at = now();\n';
}

async function main() {
  const center = await geocode();
  const candidates = new Map();
  for (const type of types) for (const place of await searchNearby(center, type)) candidates.set(place.id, place);
  for (const query of familyQueries) for (const place of await searchFamilyText(center, query)) candidates.set(place.id, place);

  const rows = [];
  for (const id of candidates.keys()) {
    const row = await activity(await details(id), center);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => (b.child_friendly_score || 0) - (a.child_friendly_score || 0) || a.distance_meters - b.distance_meters);
  if (!rows.length) fail('Google Places returned no in-radius places.');

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, JSON.stringify({ postcodeQuery: e10Query, radiusMeters, center, rows }, null, 2) + '\n');
  console.log('Generated ' + rows.length + ' activity rows at ' + outputSql);
  console.log('Wrote review audit at ' + outputAudit);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
