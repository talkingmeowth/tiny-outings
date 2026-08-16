/* global process */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFamilyCafePlace } from './lib/activity-import-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activities_google_places_family.generated.sql');
const outputAudit = join(root, 'data', 'google-places-family.generated.json');
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

const localEnv = readDotEnv('.env.local');
const env = { ...localEnv, ...process.env };
const apiKey = env.GOOGLE_PLACES_API_KEY || env.GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY;
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

const londonZones = [
  { name: 'Walthamstow', latitude: 51.583, longitude: -0.02 },
  { name: 'Leyton and Leytonstone', latitude: 51.562, longitude: -0.001 },
  { name: 'Hackney', latitude: 51.545, longitude: -0.055 },
  { name: 'Stoke Newington', latitude: 51.562, longitude: -0.075 },
  { name: 'Islington', latitude: 51.536, longitude: -0.103 },
  { name: 'Stratford and Newham', latitude: 51.541, longitude: 0.003 },
  { name: 'Camden', latitude: 51.539, longitude: -0.142 },
  { name: 'Southwark', latitude: 51.503, longitude: -0.09 },
  { name: 'Brixton', latitude: 51.462, longitude: -0.115 },
  { name: 'Notting Hill', latitude: 51.512, longitude: -0.205 },
  { name: 'Ealing', latitude: 51.513, longitude: -0.304 },
  { name: 'Richmond', latitude: 51.46, longitude: -0.303 },
];

const profiles = {
  play_cafes: {
    category: 'Child-friendly cafes',
    sourceName: 'Google Places baby and child friendly play cafes importer',
    queries: ['baby friendly cafe', 'child friendly play cafe', 'soft play cafe'],
    description: 'A cafe or play cafe found through Google Places for a relaxed outing with babies and young children.',
    cost: 'Cafe purchases or play session fees',
    bookingRequired: false,
  },
  baby_swim: {
    category: 'Baby swimming',
    sourceName: 'Google Places baby swim activities importer',
    queries: ['baby swimming classes', 'baby swim lessons', 'parent and baby swimming'],
    description: 'A baby or parent and child swimming activity found through Google Places. Check the provider for class times and booking.',
    cost: 'Check provider for prices',
    bookingRequired: true,
  },
  baby_sensory: {
    category: 'Baby sensory',
    sourceName: 'Google Places baby sensory activities importer',
    queries: ['baby sensory classes', 'baby sensory play', 'sensory classes for babies'],
    description: 'A baby sensory activity found through Google Places. Check the provider for session times and booking.',
    cost: 'Check provider for prices',
    bookingRequired: true,
  },
};

const detailFieldMask = [
  'id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri', 'websiteUri',
  'rating', 'userRatingCount', 'primaryType', 'types', 'regularOpeningHours', 'businessStatus',
  'goodForChildren', 'editorialSummary', 'photos',
].join(',');

const columns = [
  'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website', 'organiser_website',
  'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'recurrence_rule',
  'schedule_notes', 'description', 'cost', 'booking_required', 'source_name', 'source_url', 'image_url', 'image_source_url',
  'google_place_id', 'google_place_uri', 'google_photo_url', 'google_rating', 'google_user_rating_count', 'google_primary_type',
  'google_opening_hours', 'google_summary', 'activity_date', 'available_dates', 'availability_start_date', 'availability_end_date',
  'available_days_of_week', 'availability_type', 'availability_notes', 'public_listing_status', 'archive',
];

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function normalized(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null;
}

function sourceUrl(placeId) {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

function activityKey(activity) {
  return `${normalized(activity.activity_name)}|${postcode(activity.postcode || activity.address) || normalized(activity.address)}`;
}

function isGreaterLondon(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= 51.28 && latitude <= 51.72 && longitude >= -0.56 && longitude <= 0.35;
}

function boroughForAddress(address) {
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
  const finalEnd = ends.sort().at(-1) || '17:00';
  return {
    days: listedDays,
    start,
    end: finalEnd <= start ? '23:59' : finalEnd,
    type: listedDays.length === 7 ? 'daily' : listedDays.length ? 'weekly' : 'unknown',
    notes: hours.weekdayDescriptions?.join(' | ') || 'Check the provider for current times and availability.',
  };
}

function placeText(place) {
  return normalized([
    place.displayName?.text,
    place.editorialSummary?.text,
    place.websiteUri,
    place.primaryType,
    ...(place.types || []),
  ].join(' '));
}

function hasProfileSignal(place, profileId) {
  const value = placeText(place);
  if (profileId === 'play_cafes') {
    return place.goodForChildren === true || /\b(baby|child|children|kid|kids|toddler|family|play cafe|soft play|play)\b/.test(value);
  }
  if (profileId === 'baby_swim') {
    return /\b(baby|toddler|infant|parent child|water babies|puddle ducks|little fishes|swim|swimming|aqua)\b/.test(value)
      && !/\b(adult only|scuba|diving)\b/.test(value);
  }
  return /\b(baby sensory|baby sense|toddler sense|hartbeeps|sensory|baby|toddler|infant)\b/.test(value)
    && !/\b(sensory room|sensory deprivation|adult)\b/.test(value);
}

function childFriendlyScore(place) {
  const rating = Number(place.rating || 0);
  const reviews = Number(place.userRatingCount || 0);
  if (!rating) return null;
  return Math.min(5, Math.round((rating + (place.goodForChildren ? 0.2 : 0) + (reviews >= 100 ? 0.1 : 0)) * 10) / 10);
}

async function google(url, options = {}) {
  if (!apiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY, GOOGLE_MAPS_API_KEY, or VITE_GOOGLE_MAPS_API_KEY.');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(25000),
      headers: { ...(options.headers || {}), 'X-Goog-Api-Key': apiKey },
    });
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
      throw new Error(`Google Places returned ${response.status}: ${(await response.text()).slice(0, 250)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error('Google Places did not return a result.');
}

async function discover(zone, query) {
  const body = await google('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': 'places.id' },
    body: JSON.stringify({
      textQuery: `${query} in ${zone.name}, London`,
      maxResultCount: 8,
      languageCode: 'en-GB',
      regionCode: 'GB',
      locationBias: { circle: { center: { latitude: zone.latitude, longitude: zone.longitude }, radius: 5500 } },
    }),
  });
  return body.places || [];
}

async function details(placeId) {
  return google(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en-GB&regionCode=GB`, {
    headers: { 'X-Goog-FieldMask': detailFieldMask },
  });
}

async function existingActivities() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  const activities = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${supabaseUrl}/rest/v1/activities?select=activity_id,activity_name,address,postcode,google_place_id,source_url&public_listing_status=eq.published&limit=1000&offset=${offset}`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
    });
    if (!response.ok) throw new Error(`Could not read existing activities: ${response.status}`);
    const page = await response.json();
    activities.push(...page);
    if (page.length < 1000) break;
  }
  return {
    placeIds: new Set(activities.map((activity) => activity.google_place_id).filter(Boolean)),
    sourceUrls: new Set(activities.map((activity) => activity.source_url).filter(Boolean)),
    activityKeys: new Set(activities.map(activityKey)),
  };
}

function prepareActivity(place, profileId, queryTerms) {
  const profile = profiles[profileId];
  const name = String(place.displayName?.text || '').trim();
  const address = String(place.formattedAddress || '').trim();
  const placeId = String(place.id || '').trim();
  if (!name || !address || !placeId || !isGreaterLondon(place.location)) return { reason: 'Missing a name, London address, place ID, or verified coordinate.' };
  if (place.businessStatus === 'CLOSED_PERMANENTLY') return { reason: 'Permanently closed.' };
  if (profileId === 'play_cafes' && !isFamilyCafePlace(place)) return { reason: 'Failed child-friendly cafe quality checks.' };
  if (!hasProfileSignal(place, profileId)) return { reason: `Missing a clear ${profileId.replace('_', ' ')} signal.` };

  const hours = availability(place.regularOpeningHours);
  const rating = Number(place.rating || 0) || null;
  const reviews = Number(place.userRatingCount || 0);
  return {
    activity: {
      activity_name: name, address, postcode: postcode(address), lat: Number(place.location.latitude), long: Number(place.location.longitude),
      category: profile.category, start_time: hours.start, end_time: hours.end, google_link: place.googleMapsUri || null,
      website: place.websiteUri || null, organiser_website: place.websiteUri || null, child_friendly_score: childFriendlyScore(place),
      app_rating: rating, number_of_reviews: reviews, age_suitability: 'Babies, toddlers and their grown-ups', borough: boroughForAddress(address),
      days_of_week: hours.days, recurrence_rule: hours.days.length ? `FREQ=WEEKLY;BYDAY=${hours.days.map((day) => day.slice(0, 2).toUpperCase()).join(',')}` : null,
      schedule_notes: hours.notes, description: profile.description, cost: profile.cost, booking_required: profile.bookingRequired,
      source_name: profile.sourceName, source_url: sourceUrl(placeId), image_url: null, image_source_url: place.websiteUri || null,
      google_place_id: placeId, google_place_uri: place.googleMapsUri || null, google_photo_url: place.photos?.[0]?.name || null,
      google_rating: rating, google_user_rating_count: reviews, google_primary_type: place.primaryType || null,
      google_opening_hours: place.regularOpeningHours || null, google_summary: place.editorialSummary?.text || null,
      activity_date: null, available_dates: [], availability_start_date: null, availability_end_date: null,
      available_days_of_week: hours.days, availability_type: hours.type,
      availability_notes: `Google Places discovery: ${[...queryTerms].join('; ')}. ${hours.notes}`,
      public_listing_status: 'published', archive: false,
    },
  };
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const clean = [...new Set((values || []).filter(Boolean))];
  return clean.length ? `array[${clean.map(sql).join(', ')}]` : "'{}'";
}

function rowSql(row) {
  return columns.map((column) => {
    const value = row[column];
    if (['lat', 'long', 'child_friendly_score', 'app_rating', 'number_of_reviews', 'google_rating', 'google_user_rating_count'].includes(column)) return value ?? 'null';
    if (['days_of_week', 'available_dates', 'available_days_of_week'].includes(column)) return sqlArray(value);
    if (['booking_required', 'archive'].includes(column)) return value ? 'true' : 'false';
    if (column === 'google_opening_hours') return value ? `${sql(JSON.stringify(value))}::jsonb` : 'null';
    return sql(value);
  }).join(', ');
}

function buildSql(rows) {
  if (!rows.length) return '-- No net-new Google Places family listings met the directory quality checks.\n';
  return `-- Generated by scripts/import-google-places-family.js\n-- Google Places discoveries are London-only, duplicate-checked, and queued for admin review by database trigger.\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n${rows.map((row) => `(${rowSql(row)})`).join(',\n')}\non conflict (source_url) do update set\n  activity_name = excluded.activity_name,\n  address = excluded.address,\n  postcode = excluded.postcode,\n  lat = excluded.lat,\n  long = excluded.long,\n  category = excluded.category,\n  start_time = excluded.start_time,\n  end_time = excluded.end_time,\n  google_link = excluded.google_link,\n  website = coalesce(excluded.website, public.activities.website),\n  organiser_website = coalesce(excluded.organiser_website, public.activities.organiser_website),\n  child_friendly_score = excluded.child_friendly_score,\n  app_rating = excluded.app_rating,\n  number_of_reviews = excluded.number_of_reviews,\n  days_of_week = excluded.days_of_week,\n  recurrence_rule = excluded.recurrence_rule,\n  schedule_notes = excluded.schedule_notes,\n  description = excluded.description,\n  cost = excluded.cost,\n  image_source_url = coalesce(excluded.image_source_url, public.activities.image_source_url),\n  google_place_id = excluded.google_place_id,\n  google_place_uri = excluded.google_place_uri,\n  google_photo_url = coalesce(excluded.google_photo_url, public.activities.google_photo_url),\n  google_rating = excluded.google_rating,\n  google_user_rating_count = excluded.google_user_rating_count,\n  google_primary_type = excluded.google_primary_type,\n  google_opening_hours = excluded.google_opening_hours,\n  google_summary = excluded.google_summary,\n  available_days_of_week = excluded.available_days_of_week,\n  availability_type = excluded.availability_type,\n  availability_notes = excluded.availability_notes,\n  archive = false,\n  updated_at = now();\n`;
}

async function runProfile(profileId, known, maxCandidates) {
  const discovered = new Map();
  const discoveryErrors = [];
  for (const zone of londonZones) {
    for (const query of profiles[profileId].queries) {
      try {
        for (const place of await discover(zone, query)) {
          if (!place.id) continue;
          const terms = discovered.get(place.id) || new Set();
          terms.add(`${query} in ${zone.name}`);
          discovered.set(place.id, terms);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Google Places discovery failed.';
        // Invalid credentials and malformed requests will fail every location,
        // so stop before creating an audit that looks like a valid empty run.
        if (/API_KEY_INVALID|API key expired|Google Places returned 400/i.test(message)) throw error;
        discoveryErrors.push(`${query} in ${zone.name}: ${message}`);
      }
    }
  }

  if (!discovered.size && discoveryErrors.length) {
    throw new Error(`Google Places discovery failed for ${profileId}: ${discoveryErrors[0]}`);
  }

  const rows = [];
  const rejected = [];
  for (const [placeId, terms] of [...discovered.entries()].slice(0, maxCandidates)) {
    if (known.placeIds.has(placeId) || known.sourceUrls.has(sourceUrl(placeId))) {
      rejected.push({ place_id: placeId, reason: 'Already represented in the activity directory.' });
      continue;
    }
    try {
      const place = await details(placeId);
      const result = prepareActivity(place, profileId, terms);
      if (!result.activity) {
        rejected.push({ place_id: placeId, name: place.displayName?.text, reason: result.reason });
        continue;
      }
      if (known.activityKeys.has(activityKey(result.activity))) {
        rejected.push({ place_id: placeId, name: result.activity.activity_name, reason: 'Matching name and venue already exist.' });
        continue;
      }
      rows.push(result.activity);
      known.placeIds.add(placeId);
      known.sourceUrls.add(sourceUrl(placeId));
      known.activityKeys.add(activityKey(result.activity));
    } catch (error) {
      rejected.push({ place_id: placeId, reason: error.message || 'Place detail request failed.' });
    }
  }
  return {
    importer: profileId,
    category: profiles[profileId].category,
    discovered: discovered.size,
    inspected: Math.min(discovered.size, maxCandidates),
    imported_or_refreshed: rows.length,
    skipped_or_rejected: rejected.length,
    discovery_errors: discoveryErrors,
    rejected: rejected.slice(0, 50),
    rows,
  };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/import-google-places-family.js [--importers play_cafes,baby_swim,baby_sensory] [--max-candidates 60]');
    return;
  }
  const requested = option('--importers', Object.keys(profiles).join(',')).split(',').map((value) => value.trim()).filter(Boolean);
  const importerIds = [...new Set(requested)].filter((id) => Object.hasOwn(profiles, id));
  if (!importerIds.length) throw new Error('Choose play_cafes, baby_swim, or baby_sensory.');
  const maxCandidates = Math.min(Math.max(Number(option('--max-candidates', '60')) || 60, 1), 100);
  const known = await existingActivities();
  const results = [];
  for (const profileId of importerIds) results.push(await runProfile(profileId, known, maxCandidates));
  const rows = results.flatMap((result) => result.rows);

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  const auditResults = results.map((result) => ({
    importer: result.importer,
    category: result.category,
    discovered: result.discovered,
    inspected: result.inspected,
    imported_or_refreshed: result.imported_or_refreshed,
    skipped_or_rejected: result.skipped_or_rejected,
    discovery_errors: result.discovery_errors,
    rejected: result.rejected,
  }));
  writeFileSync(outputAudit, JSON.stringify({ generated_at: new Date().toISOString(), max_candidates_per_importer: maxCandidates, results: auditResults, rows }, null, 2) + '\n');
  console.log(`Generated ${rows.length} Google Places family listings at ${outputSql}`);
  for (const result of results) console.log(`${result.importer}: ${result.imported_or_refreshed} accepted, ${result.skipped_or_rejected} skipped or rejected.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
