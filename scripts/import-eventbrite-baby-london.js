/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const listingUrl = 'https://www.eventbrite.co.uk/d/united-kingdom--london/baby/';
const outputSql = join(root, 'supabase', 'seed', 'activities_eventbrite_london_baby_20260711.generated.sql');
const outputAudit = join(root, 'data', 'eventbrite_london_baby_20260711.generated.json');
const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

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

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null;
}

function boroughForAddress(address) {
  const value = String(address || '').toUpperCase();
  if (/\b(E10|E11|E17)\b/.test(value)) return 'Waltham Forest';
  if (/\b(E2|E5|E8|E9|N16)\b/.test(value)) return 'Hackney';
  if (/\b(N1|N5|N7|N19|EC1)\b/.test(value)) return 'Islington';
  if (/\b(E6|E7|E12|E13|E15|E16|E20)\b/.test(value)) return 'Newham';
  return 'London';
}

function weekday(date) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/London' }).format(date);
}

function time(date) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London',
  }).format(date);
}

function categoryForEvent(event) {
  const text = `${event.name} ${event.description}`.toLowerCase();
  if (/(bach to baby|baby music|family concert|sing|rhyme)/.test(text)) return 'Music & singing';
  if (/(sensory|squish)/.test(text)) return 'Baby sensory';
  if (/(pilates|barre|fitness|padel)/.test(text)) return 'Postnatal fitness';
  if (/(walk|outdoor)/.test(text)) return 'Parks & outdoor play';
  if (/(stay and play|play session|playgroup)/.test(text)) return 'Stay & play';
  if (/(baby cafe|brunch|pub quiz|comedy|wine tasting|networking)/.test(text)) return 'Parent meet-ups';
  return 'Family activities';
}

function eventJsonLd(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const value = JSON.parse(script[1]);
      const values = Array.isArray(value) ? value : [value];
      const event = values.find((item) => item?.['@type'] === 'Event');
      if (event) return event;
    } catch {
      // Ignore unrelated or malformed structured data.
    }
  }
  return null;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TinyOutings/1.0; +https://tiny-outings-cpjh.onrender.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Eventbrite returned ${response.status}`);
  return response.text();
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

async function googlePlace(query, expectedPostcode) {
  if (!googleApiKey) return null;
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleApiKey,
      'X-Goog-FieldMask': 'places.id,places.formattedAddress,places.location,places.googleMapsUri,places.rating,places.userRatingCount,places.primaryType',
    },
    body: JSON.stringify({ textQuery: query, languageCode: 'en-GB', regionCode: 'GB' }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return null;
  const body = await response.json();
  return (body.places || []).find((place) => !expectedPostcode || postcode(place.formattedAddress) === expectedPostcode) || null;
}

async function existingSourceUrls() {
  const urls = new Set();
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/activities?select=source_url&public_listing_status=eq.published&source_url=not.is.null&limit=1000&offset=${offset}`,
      { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } },
    );
    if (!response.ok) throw new Error(`Could not read activities: ${response.status}`);
    const page = await response.json();
    page.forEach((row) => urls.add(row.source_url));
    if (page.length < 1000) return urls;
  }
}

function toRow(event, place) {
  const addressParts = [event.location?.name, event.location?.address?.streetAddress, event.location?.address?.addressLocality]
    .map(cleanText).filter(Boolean);
  const eventAddress = [...new Set(addressParts)].join(', ');
  const start = new Date(event.startDate);
  const end = event.endDate ? new Date(event.endDate) : new Date(start.getTime() + 60 * 60 * 1000);
  const offer = Array.isArray(event.offers) ? event.offers[0] : event.offers;
  const lowPrice = Number(offer?.lowPrice);
  const cost = Number.isFinite(lowPrice) ? `£${lowPrice.toFixed(2)} per ticket` : 'Check Eventbrite';
  const address = place?.formattedAddress || eventAddress;
  const eventUrl = event.url;
  return {
    activity_name: cleanText(event.name),
    address,
    postcode: postcode(address),
    lat: place?.location?.latitude ?? null,
    long: place?.location?.longitude ?? null,
    category: categoryForEvent(event),
    start_time: time(start),
    end_time: time(end),
    google_link: place?.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(eventAddress)}`,
    website: eventUrl,
    child_friendly_score: null,
    app_rating: null,
    number_of_reviews: 0,
    age_suitability: 'Parents, babies and young children',
    borough: boroughForAddress(address),
    days_of_week: [weekday(start)],
    recurrence_rule: null,
    schedule_notes: 'One-off Eventbrite listing. Check Eventbrite for availability and booking details.',
    description: cleanText(event.description),
    cost,
    booking_required: true,
    source_name: 'Eventbrite London baby listings',
    source_url: eventUrl,
    image_url: Array.isArray(event.image) ? event.image[0] : event.image || null,
    image_source_url: eventUrl,
    google_place_id: place?.id || null,
    google_place_uri: place?.googleMapsUri || null,
    google_photo_url: null,
    google_rating: place?.rating ?? null,
    google_user_rating_count: place?.userRatingCount ?? null,
    google_primary_type: place?.primaryType || null,
    google_opening_hours: null,
    google_summary: null,
    activity_date: start.toISOString().slice(0, 10),
    available_dates: [start.toISOString().slice(0, 10)],
    availability_start_date: null,
    availability_end_date: null,
    available_days_of_week: [weekday(start)],
    availability_type: 'one_off',
    availability_notes: `Eventbrite listing on ${start.toLocaleDateString('en-GB', { timeZone: 'Europe/London' })}. Booking required.`,
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
    if (column === 'available_dates') return `${sqlArray(value)}::date[]`;
    if (['days_of_week', 'available_days_of_week'].includes(column)) return sqlArray(value);
    if (column === 'booking_required') return value ? 'true' : 'false';
    if (column === 'google_opening_hours') return value ? `${sql(JSON.stringify(value))}::jsonb` : 'null';
    return sql(value);
  }).join(', ');
}

function buildSql(rows) {
  return `-- Generated by scripts/import-eventbrite-baby-london.js\n-- Source: ${listingUrl}\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n${rows.map((row) => `(${rowSql(row)})`).join(',\n')}\n;\n`;
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration.');
  const listing = await fetchHtml(listingUrl);
  const urls = [...new Set([...listing.matchAll(/https:\/\/www\.eventbrite\.co\.uk\/e\/[^"'<>\s?]+/g)].map((match) => match[0]))];
  const existing = await existingSourceUrls();
  const minimumDate = new Date();
  minimumDate.setHours(0, 0, 0, 0);
  const audit = await mapWithConcurrency(urls, 4, async (url) => {
    try {
      const event = eventJsonLd(await fetchHtml(url));
      if (!event) return { url, status: 'skipped', reason: 'No event structured data' };
      const start = new Date(event.startDate);
      const address = cleanText(`${event.location?.address?.streetAddress || ''}, ${event.location?.address?.addressLocality || ''}`);
      if (event.eventStatus?.includes('EventCancelled') || Number.isNaN(start.valueOf()) || start < minimumDate) {
        return { url, name: event.name, status: 'skipped', reason: 'Past or cancelled event' };
      }
      if (!/london/i.test(address)) return { url, name: event.name, status: 'skipped', reason: 'Outside London' };
      if (existing.has(event.url)) return { url, name: event.name, status: 'skipped', reason: 'Already imported' };
      const place = await googlePlace(`${event.location?.name || ''}, ${address}`, postcode(address));
      return { url, name: event.name, status: 'ready', event, place };
    } catch (error) {
      return { url, status: 'error', reason: error.message };
    }
  });
  const rows = audit.filter((item) => item.status === 'ready').map((item) => toRow(item.event, item.place));
  rows.sort((left, right) => left.activity_date.localeCompare(right.activity_date) || left.start_time.localeCompare(right.start_time));
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  const auditRows = audit.map(({ event, place, ...item }) => ({
    ...item,
    event: event ? { name: event.name, startDate: event.startDate, location: event.location } : null,
    google_place_id: place?.id || null,
  }));
  writeFileSync(outputAudit, JSON.stringify({
    listing_url: listingUrl,
    generated_at: new Date().toISOString(),
    audit: auditRows,
    rows,
  }, null, 2) + '\n');
  console.log(`Found ${urls.length} event cards and generated ${rows.length} future London activity records.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
