/* global process */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const listingUrl = 'https://loopla.com/search?type=events-and-activities&location=London&geo-lat=51.5072178&geo-lng=-0.1275862&ages=0-6m%2C6-12m%2C1%2C2%2C3';
const searchUrl = 'https://loopla.com/api/event/v1/public/search';
const outputSql = join(root, 'supabase', 'seed', 'activities_loopla_london.generated.sql');
const outputAudit = join(root, 'data', 'loopla_london_import.generated.json');
const maxPages = Math.max(1, Number.parseInt(process.env.LOOPLA_MAX_PAGES || '10', 10));
const ageFilters = ['0-6m', '6-12m', '1', '2', '3'];
const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const clean = [...new Set((values || []).filter(Boolean))];
  return clean.length ? `array[${clean.map(sql).join(', ')}]` : "'{}'";
}

function toDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function localTime(value) {
  const match = String(value || '').match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function eventUrl(event) {
  return `https://loopla.com${String(event.url || '').split('?')[0]}`;
}

function organiserUrl(event) {
  const value = event.organizer?.website;
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function imageUrl(event) {
  const imagePath = (event.image || []).find(Boolean);
  return imagePath ? `https://loopla-prod-images.loopla.com/cdn-cgi/image/w=1000,f=auto/${imagePath}` : null;
}

function categoryFor(event) {
  const text = cleanText([event.name, event.additionalType, ...(event.categories || [])].join(' ')).toLowerCase();
  if (/(music|concert|bach to baby|sing|broadway)/.test(text)) return 'Music & singing';
  if (/(sensory)/.test(text)) return 'Baby sensory';
  if (/(yoga)/.test(text)) return 'Baby yoga';
  if (/(ballet|dance|movement)/.test(text)) return 'Baby dance & movement';
  if (/(swim|water)/.test(text)) return 'Baby swimming';
  if (/(museum|exhibition|gallery|science|immersive|\bart\b)/.test(text)) return 'Museums & culture';
  if (/(soft play|indoor play|playground|theme park)/.test(text)) return 'Soft play';
  if (/(park|outdoor|zoo|farm|adventure)/.test(text)) return 'Parks & outdoor play';
  if (/(playgroup|play & learn|toddler group)/.test(text)) return 'Stay & play';
  if (/(theatre|show|film|cinema)/.test(text)) return 'Family activities';
  return 'Family activities';
}

function boroughFor(address) {
  const value = String(address || '').toUpperCase();
  if (/\b(E10|E11|E17)\b/.test(value)) return 'Waltham Forest';
  if (/\b(E2|E5|E8|E9|N16)\b/.test(value)) return 'Hackney';
  if (/\b(N1|N5|N7|N19|EC1)\b/.test(value)) return 'Islington';
  if (/\b(E6|E7|E12|E13|E15|E16|E20)\b/.test(value)) return 'Newham';
  return 'London';
}

function scheduleDays(schedule) {
  return (schedule?.byDay || []).map((day) => {
    const value = String(day).replace(/^https?:\/\/schema\.org\//i, '').toLowerCase();
    return weekDays.find((name) => name.toLowerCase() === value) || null;
  }).filter(Boolean);
}

function availabilityType(schedule) {
  const frequency = String(schedule?.repeatFrequency || '').toLowerCase();
  if (/p1d|daily/.test(frequency)) return 'daily';
  if (/weekly|p1w|monthly|p1m/.test(frequency)) return 'weekly';
  return 'one_off';
}

function addressFor(event) {
  const location = event.location || {};
  const address = location.address || {};
  return [location.name, address.streetAddress, address.addressLocality, address.postalCode]
    .map(cleanText).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(', ');
}

async function search(query) {
  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; TinyOutings/1.0; +https://tiny-outings-cpjh.onrender.com)',
    },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Loopla returned ${response.status}`);
  const body = await response.json();
  if (!body.success || !body.result) throw new Error(body.messages?.join(', ') || 'Loopla returned no search result');
  return body.result;
}

const columns = [
  'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website', 'organiser_website',
  'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'schedule_notes', 'description', 'cost',
  'booking_required', 'source_name', 'source_url', 'image_url', 'image_source_url', 'data_source', 'activity_date', 'available_dates',
  'availability_start_date', 'availability_end_date', 'available_days_of_week', 'availability_type', 'availability_notes', 'public_listing_status',
];

function rowSql(row) {
  return `(${columns.map((column) => {
    const value = row[column];
    if (['lat', 'long', 'child_friendly_score', 'app_rating', 'number_of_reviews'].includes(column)) return value ?? 'null';
    if (column === 'available_dates') return `${sqlArray(value)}::date[]`;
    if (['days_of_week', 'available_days_of_week'].includes(column)) return sqlArray(value);
    if (column === 'booking_required') return value ? 'true' : 'false';
    return sql(value);
  }).join(', ')})`;
}

function buildSql(rows) {
  if (!rows.length) return '-- No current Loopla London activities found.\n';
  return `-- Generated by scripts/import-loopla-london.js\n-- Source: ${listingUrl}\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n  ${rows.map(rowSql).join(',\n  ')}\non conflict (source_url) do update set\n  activity_name = excluded.activity_name,\n  address = excluded.address,\n  postcode = excluded.postcode,\n  lat = coalesce(excluded.lat, public.activities.lat),\n  long = coalesce(excluded.long, public.activities.long),\n  category = excluded.category,\n  start_time = excluded.start_time,\n  end_time = excluded.end_time,\n  website = excluded.website,\n  organiser_website = excluded.organiser_website,\n  days_of_week = excluded.days_of_week,\n  schedule_notes = excluded.schedule_notes,\n  description = excluded.description,\n  cost = excluded.cost,\n  image_url = coalesce(excluded.image_url, public.activities.image_url),\n  image_source_url = excluded.image_source_url,\n  activity_date = excluded.activity_date,\n  available_dates = excluded.available_dates,\n  availability_start_date = excluded.availability_start_date,\n  availability_end_date = excluded.availability_end_date,\n  available_days_of_week = excluded.available_days_of_week,\n  availability_type = excluded.availability_type,\n  availability_notes = excluded.availability_notes,\n  public_listing_status = 'published',\n  updated_at = now();\n`;
}

function rowFor(event) {
  const schedule = event.eventSchedule || {};
  const type = availabilityType(schedule);
  const startDate = toDate(schedule.startDate || event.startDate);
  const endDate = toDate(schedule.endDate || event.nextUpComingEndDateTime);
  const nextDate = toDate(event.nextUpComingStartDateTime || schedule.startDate);
  const address = addressFor(event);
  const coordinates = event.location?.geo?.coordinates || [];
  const days = scheduleDays(schedule);
  const startTime = localTime(schedule.startTime || event.nextUpComingStartDateTime);
  const endTime = localTime(schedule.endTime || event.nextUpComingEndDateTime);
  const isFree = event.isAccessibleForFree === true || Number(event.lowPrice) === 0;
  return {
    activity_name: cleanText(event.name),
    address,
    postcode: event.location?.address?.postalCode || null,
    lat: Number(coordinates[1]),
    long: Number(coordinates[0]),
    category: categoryFor(event),
    start_time: startTime,
    end_time: endTime,
    google_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    website: eventUrl(event),
    organiser_website: organiserUrl(event),
    child_friendly_score: 5,
    app_rating: null,
    number_of_reviews: 0,
    age_suitability: `Suitable for: ${(event.ages || ageFilters).join(', ')}`,
    borough: boroughFor(address),
    days_of_week: days,
    schedule_notes: 'Times and availability sourced from Loopla. Check Loopla before travelling.',
    description: cleanText(event.description).slice(0, 1200),
    cost: isFree ? 'Free' : Number.isFinite(Number(event.lowPrice)) ? `GBP ${Number(event.lowPrice).toFixed(2)} from Loopla` : 'Check Loopla',
    booking_required: !isFree,
    source_name: 'Loopla London events and activities',
    source_url: eventUrl(event),
    image_url: imageUrl(event),
    image_source_url: eventUrl(event),
    data_source: 'other',
    activity_date: type === 'one_off' ? nextDate : null,
    available_dates: type === 'one_off' && nextDate ? [nextDate] : [],
    availability_start_date: type === 'one_off' ? null : startDate,
    availability_end_date: type === 'one_off' ? null : endDate,
    available_days_of_week: days,
    availability_type: type,
    availability_notes: type === 'one_off'
      ? `Loopla lists this activity on ${nextDate || 'a forthcoming date'}.`
      : `Loopla schedule: ${schedule.repeatFrequency || 'recurring'} through ${endDate || 'a future date'}.`,
    public_listing_status: 'published',
  };
}

async function main() {
  const query = {
    type: ['events-and-activities'],
    location: 'London',
    'geo-lat': 51.5072178,
    'geo-lng': -0.1275862,
    ages: ageFilters,
  };
  const discovered = [];
  let page = 0;
  let total = null;
  while (page < maxPages) {
    const result = await search(query);
    const items = result.eventsWithGroupCounts || [];
    total = result.meta?.total_count ?? total;
    if (!items.length) break;
    discovered.push(...items.map((item) => item.event).filter(Boolean));
    const last = items.at(-1);
    if (!last?.event?.groupId) break;
    query.cursorId = last.event.groupId;
    query.cursorMinDistance = last.minDistance;
    page += 1;
  }
  const today = new Date().toISOString().slice(0, 10);
  const rowsByUrl = new Map();
  const audit = discovered.map((event) => {
    const row = rowFor(event);
    const nextDate = toDate(event.nextUpComingStartDateTime || event.eventSchedule?.startDate);
    if (!row.activity_name || !row.address || !Number.isFinite(row.lat) || !Number.isFinite(row.long)) {
      return { name: row.activity_name || null, url: row.source_url, status: 'skipped', reason: 'Missing verified activity location' };
    }
    if (nextDate && nextDate < today) return { name: row.activity_name, url: row.source_url, status: 'skipped', reason: 'No future occurrence' };
    if (rowsByUrl.has(row.source_url)) return { name: row.activity_name, url: row.source_url, status: 'duplicate', reason: 'Repeated search result' };
    rowsByUrl.set(row.source_url, row);
    return { name: row.activity_name, url: row.source_url, status: 'ready', category: row.category };
  });
  const rows = [...rowsByUrl.values()].sort((left, right) => left.activity_name.localeCompare(right.activity_name));
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, JSON.stringify({
    generated_at: new Date().toISOString(),
    listing_url: listingUrl,
    pages_scanned: page,
    source_total: total,
    activities_discovered: discovered.length,
    activities_imported: rows.length,
    audit,
  }, null, 2) + '\n');
  console.log(`Scanned ${page} Loopla pages, found ${discovered.length}/${total ?? '?'} results, and generated ${rows.length} activities.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
