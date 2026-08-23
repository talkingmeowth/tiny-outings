/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { googlePlacesJson } from './lib/google-places-client.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directoryUrl = 'https://assets.publishing.service.gov.uk/media/6980dbf0ec71a16669612e3d/List_of_family_hub_sites.csv';
const directoryPageUrl = 'https://www.gov.uk/government/publications/list-of-family-hub-sites';
const outputSql = join(root, 'supabase', 'seed', 'activities_london_family_hubs.generated.sql');
const outputAudit = join(root, 'data', 'london_family_hubs_import.generated.json');
function localEnv() {
  try {
    return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const divider = line.indexOf('=');
        return [line.slice(0, divider).trim(), line.slice(divider + 1).trim().replace(/^['"]|['"]$/g, '')];
      }));
  } catch {
    return {};
  }
}

const env = localEnv();
const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY
  || env.GOOGLE_MAPS_API_KEY || env.GOOGLE_PLACES_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY;
const sourceName = 'GOV.UK Family Hubs and Start for Life';
const googleFields = 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.websiteUri,places.primaryType';
const unsuitableHub = /\byouth\b/i;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function csvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values.map(cleanText);
}

function parseDirectory(csv) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const columns = csvLine(header);
  return lines.map((line) => {
    const values = csvLine(line);
    return Object.fromEntries(columns.map((column, index) => [column, values[index] || '']));
  }).filter((row) => row.Region === 'London'
    && row.Family_Hub
    && row.Postcode
    // Youth-only provision is not enough evidence of a baby/family activity.
    && !unsuitableHub.test(row.Family_Hub));
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const unique = [...new Set((values || []).filter(Boolean))];
  return unique.length ? `array[${unique.map(sql).join(', ')}]` : "'{}'";
}

function sourceUrlFor(hub) {
  return `${directoryPageUrl}#${encodeURIComponent(`${hub.Local_Authority}/${hub.Family_Hub}`)}`;
}

function isOfficialWebsite(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) && !/google\./i.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchDirectory() {
  const response = await fetch(directoryUrl, {
    headers: { 'User-Agent': 'TinyOutings/1.0 (+https://tiny-outings-cpjh.onrender.com)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GOV.UK Family Hubs directory returned ${response.status}`);
  return response.text();
}

async function lookupPlace(hub) {
  if (!googleApiKey) throw new Error('GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY is required.');
  const body = await googlePlacesJson('https://places.googleapis.com/v1/places:searchText', googleApiKey, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-FieldMask': googleFields,
    },
    body: JSON.stringify({
      textQuery: `${hub.Family_Hub}, ${hub.Postcode}, London`,
      languageCode: 'en-GB',
      regionCode: 'GB',
    }),
    signal: AbortSignal.timeout(25000),
  });
  const places = body.places || [];
  const postcode = hub.Postcode.replace(/\s/g, '').toLowerCase();
  const place = places.find((candidate) => candidate.formattedAddress?.replace(/\s/g, '').toLowerCase().includes(postcode));
  return place || null;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function toActivity(hub, place) {
  if (!place?.location || !place.formattedAddress) return null;
  return {
    activity_name: `Family activities at ${hub.Family_Hub}`,
    address: place.formattedAddress,
    postcode: hub.Postcode,
    lat: Number(place.location.latitude),
    long: Number(place.location.longitude),
    category: 'Family activities',
    start_time: null,
    end_time: null,
    google_link: place.googleMapsUri || null,
    website: isOfficialWebsite(place.websiteUri),
    organiser_website: null,
    child_friendly_score: 5,
    app_rating: null,
    number_of_reviews: 0,
    age_suitability: 'Parents, babies and young children',
    borough: hub.Local_Authority,
    days_of_week: [],
    schedule_notes: 'Check the family hub website for its current sessions and booking details.',
    description: `Family Hub and Start for Life services at ${hub.Family_Hub}. The official directory identifies this as a family hub serving ${hub.Local_Authority}.`,
    cost: 'Check the family hub website',
    booking_required: false,
    source_name: sourceName,
    source_url: sourceUrlFor(hub),
    data_source: 'Better Start for Life',
    google_place_id: place.id || null,
    google_place_uri: place.googleMapsUri || null,
    google_primary_type: place.primaryType || null,
    availability_type: 'unknown',
    availability_notes: 'Session times are not published in the national directory. Check the hub website before planning.',
    public_listing_status: 'published',
  };
}

function rowSql(row) {
  const columns = [
    'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website', 'organiser_website',
    'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'schedule_notes', 'description', 'cost',
    'booking_required', 'source_name', 'source_url', 'data_source', 'google_place_id', 'google_place_uri', 'google_primary_type',
    'availability_type', 'availability_notes', 'public_listing_status',
  ];
  return `(${columns.map((column) => {
    if (['lat', 'long', 'child_friendly_score', 'app_rating', 'number_of_reviews'].includes(column)) return row[column] ?? 'null';
    if (column === 'days_of_week') return sqlArray(row[column]);
    if (column === 'booking_required') return row[column] ? 'true' : 'false';
    return sql(row[column]);
  }).join(', ')})`;
}

function buildSql(rows) {
  const columns = [
    'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website', 'organiser_website',
    'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'schedule_notes', 'description', 'cost',
    'booking_required', 'source_name', 'source_url', 'data_source', 'google_place_id', 'google_place_uri', 'google_primary_type',
    'availability_type', 'availability_notes', 'public_listing_status',
  ];
  if (!rows.length) return '-- No verified London Family Hub records found.\n';
  return `-- Generated by scripts/import-london-family-hubs.js\n-- Official source: ${directoryPageUrl}\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n  ${rows.map(rowSql).join(',\n  ')}\non conflict (source_url) do update set\n  activity_name = excluded.activity_name,\n  address = excluded.address,\n  postcode = excluded.postcode,\n  lat = excluded.lat,\n  long = excluded.long,\n  google_link = excluded.google_link,\n  google_place_id = excluded.google_place_id,\n  google_place_uri = excluded.google_place_uri,\n  google_primary_type = excluded.google_primary_type,\n  website = coalesce(excluded.website, public.activities.website),\n  description = excluded.description,\n  availability_notes = excluded.availability_notes,\n  updated_at = now();\n`;
}

async function main() {
  const hubs = parseDirectory(await fetchDirectory());
  const audit = await mapWithConcurrency(hubs, 3, async (hub) => {
    try {
      const place = await lookupPlace(hub);
      const activity = toActivity(hub, place);
      return activity ? { hub, activity, status: 'ready' } : { hub, status: 'skipped', reason: 'No postcode-matched Google Places result.' };
    } catch (error) {
      return { hub, status: 'failed', reason: error.message };
    }
  });
  const rows = audit.filter((item) => item.status === 'ready').map((item) => item.activity);
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    source: directoryPageUrl,
    london_hubs_discovered: hubs.length,
    ready: rows.length,
    skipped: audit.filter((item) => item.status === 'skipped').map(({ hub, reason }) => ({ hub: hub.Family_Hub, reason })),
    failures: audit.filter((item) => item.status === 'failed').map(({ hub, reason }) => ({ hub: hub.Family_Hub, reason })),
  }, null, 2)}\n`);
  console.log(`London Family Hubs: ${rows.length}/${hubs.length} verified listings prepared for review.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
