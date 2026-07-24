/* global process */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseWalthamForestEventImageUrl } from './lib/activity-import-policy.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const siteRoot = 'https://www.walthamforest.gov.uk';
const listingUrl = `${siteRoot}/events?events_category=447&events_location=All&page=0`;
const outputSql = join(root, 'supabase', 'seed', 'activities_waltham_forest_best_start_live.generated.sql');
const outputAudit = join(root, 'data', 'waltham_forest_best_start_live.generated.json');
const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const maxPages = Math.max(1, Number.parseInt(process.env.WF_BEST_START_MAX_PAGES || '180', 10));
const noNewPageLimit = Math.max(1, Number.parseInt(process.env.WF_BEST_START_NO_NEW_PAGE_LIMIT || '45', 10));
const pageDelayMs = Math.max(0, Number.parseInt(process.env.WF_BEST_START_PAGE_DELAY_MS || '250', 10));
const detailDelayMs = Math.max(0, Number.parseInt(process.env.WF_BEST_START_DETAIL_DELAY_MS || '180', 10));
const detailConcurrency = Math.max(1, Number.parseInt(process.env.WF_BEST_START_DETAIL_CONCURRENCY || '3', 10));
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthNumbers = new Map([
  ['january', '01'], ['february', '02'], ['march', '03'], ['april', '04'], ['may', '05'], ['june', '06'],
  ['july', '07'], ['august', '08'], ['september', '09'], ['october', '10'], ['november', '11'], ['december', '12'],
]);

const excludedNames = /child health clinic|healthy eating|dental health|dental drop|oral health|speech and language|community drop|domestic abuse|violence against|quitright|smoking cessation/i;
const googleFields = 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.rating,places.userRatingCount,places.primaryType';

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&ndash;|&#8211;/gi, '-')
    .replace(/&rsquo;|&#8217;/gi, "'")
    .replace(/â€™/g, "'")
    .replace(/Â£/g, '£')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainEventName(value) {
  return cleanText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replaceAll('&', ' and ').replace(/[^A-Za-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function absoluteUrl(value) {
  if (!value) return null;
  try {
    return new URL(value.replaceAll('&amp;', '&'), siteRoot).toString();
  } catch {
    return null;
  }
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const clean = [...new Set((values || []).filter(Boolean))];
  return clean.length ? `array[${clean.map(sql).join(', ')}]` : "'{}'";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchHtml(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TinyOutings/1.0; +https://tiny-outings-cpjh.onrender.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (response.ok) return response.text();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
      throw new Error(`Waltham Forest returned ${response.status}`);
    }
    await delay(1000 * (attempt + 1));
  }
  throw new Error('Waltham Forest request failed after retries.');
}

function labelledValue(html, label) {
  const matcher = new RegExp(
    `details-block__label[^>]*>\\s*${escapeRegex(label)}\\s*<\\/div>\\s*<div[^>]*details-block__value[^>]*>([\\s\\S]*?)<\\/div>`,
    'i',
  );
  return cleanText(html.match(matcher)?.[1]);
}

function metaContent(html, property) {
  const tags = html.match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (name === property.toLowerCase() && content) return absoluteUrl(content);
  }
  return null;
}

function pageTitle(html) {
  return [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((match) => cleanText(match[1]))
    .find(Boolean) || '';
}

function mainDescription(html) {
  const block = html.match(/<div[^>]*class=["'][^"']*text-block--body[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i)?.[1];
  return cleanText(block || '');
}

function parseTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (match[3].toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (match[3].toLowerCase() === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseDateAndTimes(value) {
  const match = cleanText(value).match(/(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+to\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  if (!match) return null;
  const month = monthNumbers.get(match[2].toLowerCase());
  if (!month) return null;
  const date = `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
  const start = parseTime(match[4]);
  const end = parseTime(match[5]);
  if (!start || !end) return null;
  return { date, start, end };
}

function listingOccurrences(html) {
  const occurrences = [];
  for (const card of html.matchAll(/<a\b[^>]*href=["'](?<href>\/events\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const block = card[0];
    const date = cleanText(block.match(/card__date[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    const time = cleanText(block.match(/card__time[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    const eventDate = parseDateAndTimes(`${date} - ${time}`);
    if (!eventDate) continue;
    const image = absoluteUrl(block.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]);
    occurrences.push({ url: absoluteUrl(card.groups.href), ...eventDate, image });
  }
  return occurrences.filter((occurrence) => occurrence.url);
}

function weekdayFor(date) {
  return weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function categoryFor(name, description) {
  const title = String(name || '').toLowerCase();
  const text = `${title} ${description}`.toLowerCase();
  if (/baby massage/.test(title)) return 'Baby massage';
  if (/sensory/.test(title)) return 'Baby sensory';
  if (/stay and play|play and learn|play session/.test(title)) return 'Stay & play';
  if (/feeding|flourish|post[ -]?natal/.test(title)) return 'Feeding & postnatal support';
  if (/craft|lego|duplo/.test(title)) return 'Arts & crafts';
  if (/story|stories|rhymes|rhyme/.test(title)) return 'Story & rhyme time';
  if (/music|sing|bambini|bongalong/.test(title)) return 'Music & singing';
  if (/baller|dance|movement/.test(title)) return 'Baby dance & movement';
  if (/learn|explor/.test(title)) return 'Developmental play';
  if (/\bsensory\b/.test(text)) return 'Baby sensory';
  if (/\bstay and play\b|\bplay and learn\b/.test(text)) return 'Stay & play';
  if (/\bfeeding\b|\bpost[ -]?natal\b/.test(text)) return 'Feeding & postnatal support';
  if (/\bcraft\b|\blego\b|\bduplo\b/.test(text)) return 'Arts & crafts';
  if (/\brhymes?\b|\bstories\b/.test(text)) return 'Story & rhyme time';
  if (/\bmusic\b|\bsinging\b/.test(text)) return 'Music & singing';
  if (/\bballer\b|\bdance\b|\bmovement\b/.test(text)) return 'Baby dance & movement';
  if (/\blearning\b|\bexploring\b/.test(text)) return 'Developmental play';
  return 'Family activities';
}

function ageFor(name, description) {
  const text = `${name} ${description}`.toLowerCase();
  if (/under[ -]?2|0\s*[-to]+\s*1/.test(text)) return 'Under 2s';
  if (/over\s*2|2\+/.test(text)) return '2+ years';
  return 'Parents, babies and young children';
}

function costFor(description) {
  const price = description.match(/(?:£|Â£)\s*\d+(?:\.\d{1,2})?(?:\s*first child)?(?:,\s*\d+\s*p\s*(?:siblings?|sibling)?)?/i)?.[0];
  if (price) return cleanText(price);
  return /\bfree\b/i.test(description) ? 'Free' : 'Check council event page';
}

async function googlePlace(venue) {
  const expectedPostcode = venue.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.replace(/\s/g, '').toUpperCase();
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleApiKey,
      'X-Goog-FieldMask': googleFields,
    },
    body: JSON.stringify({ textQuery: `${venue}, London`, languageCode: 'en-GB', regionCode: 'GB' }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Google Places returned ${response.status}`);
  const places = (await response.json()).places || [];
  const postcodeMatch = places.find((place) => {
    const foundPostcode = place.formattedAddress?.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.replace(/\s/g, '').toUpperCase();
    return expectedPostcode ? foundPostcode === expectedPostcode : Boolean(place.location);
  });
  if (postcodeMatch) return postcodeMatch;

  // Council venue postcodes can refer to an entrance while Google stores the
  // main building postcode. Accept only a clearly named venue in that case.
  const venueTokens = new Set(cleanText(venue).toLowerCase().match(/[a-z]{3,}/g) || []);
  return places.find((place) => {
    const nameTokens = cleanText(place.displayName?.text).toLowerCase().match(/[a-z]{3,}/g) || [];
    const shared = nameTokens.filter((token) => venueTokens.has(token));
    return Boolean(place.location) && shared.length >= 2;
  }) || null;
}

function parseEvent(url, html, place, occurrences) {
  const activityName = pageTitle(html);
  const categories = labelledValue(html, 'Event category:');
  const eventDate = parseDateAndTimes(labelledValue(html, 'Event date:')) || occurrences[0];
  const status = labelledValue(html, 'Status:');
  const frequency = labelledValue(html, 'How often:');
  const description = mainDescription(html);
  const venue = labelledValue(html, 'Event venue:') || labelledValue(html, 'Location:');
  const recurring = occurrences.length > 1
    || /ongoing|every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(`${status} ${frequency}`)
    || /weekly|term[ -]?time/i.test(description);

  if (!activityName || !/best start in life/i.test(categories) || excludedNames.test(activityName)) return null;
  if (!eventDate || !venue || !place?.location) return null;

  const discoveredOccurrences = occurrences.length ? occurrences : [eventDate];
  const availableDates = [...new Set(discoveredOccurrences.map((occurrence) => occurrence.date))].sort();
  const availableDays = [...new Set(availableDates.map(weekdayFor))];
  const day = weekdayFor(eventDate.date);
  const lastListedDate = availableDates.at(-1) || eventDate.date;
  const availabilityNotes = recurring
    ? `Council dates listed through ${lastListedDate}${/term[ -]?time/i.test(description) ? '; term time only' : ''}. Check the council event page for changes.`
    : `Council event on ${eventDate.date}. Check the council event page for changes.`;

  return {
    activity_name: plainEventName(activityName),
    address: place.formattedAddress || venue,
    postcode: (place.formattedAddress || venue).match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null,
    lat: Number(place.location.latitude),
    long: Number(place.location.longitude),
    category: categoryFor(activityName, description),
    start_time: eventDate.start,
    end_time: eventDate.end,
    google_link: place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`,
    website: url,
    child_friendly_score: null,
    app_rating: null,
    number_of_reviews: Number(place.userRatingCount || 0),
    age_suitability: ageFor(activityName, description),
    borough: 'Waltham Forest',
    days_of_week: recurring ? availableDays : [day],
    recurrence_rule: null,
    schedule_notes: availabilityNotes,
    description,
    cost: costFor(description),
    booking_required: /\bbook(?:ing|ed)?\b|appointment|referral/i.test(description),
    source_name: 'Waltham Forest Best Start in Life events',
    source_url: url,
    image_url: normaliseWalthamForestEventImageUrl(
      occurrences.find((occurrence) => occurrence.image)?.image || metaContent(html, 'og:image'),
    ),
    image_source_url: url,
    google_place_id: place.id,
    google_place_uri: place.googleMapsUri || null,
    google_photo_url: null,
    google_rating: Number(place.rating || 0) || null,
    google_user_rating_count: Number(place.userRatingCount || 0),
    google_primary_type: place.primaryType || null,
    google_opening_hours: null,
    google_summary: null,
    activity_date: recurring ? null : eventDate.date,
    available_dates: recurring ? availableDates : [eventDate.date],
    availability_start_date: null,
    availability_end_date: null,
    available_days_of_week: recurring ? availableDays : [day],
    availability_type: recurring ? 'specific_dates' : 'one_off',
    availability_notes: availabilityNotes,
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
  if (!rows.length) return '-- No verified Best Start in Life rows found.\n';
  return `-- Generated by scripts/import-waltham-forest-best-start.js\n-- Source: ${listingUrl}\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n${rows.map((row) => `(${rowSql(row)})`).join(',\n')}\non conflict (source_url) do update set\n  activity_name = excluded.activity_name,\n  address = excluded.address,\n  postcode = excluded.postcode,\n  lat = excluded.lat,\n  long = excluded.long,\n  category = excluded.category,\n  start_time = excluded.start_time,\n  end_time = excluded.end_time,\n  google_link = excluded.google_link,\n  website = excluded.website,\n  number_of_reviews = excluded.number_of_reviews,\n  age_suitability = excluded.age_suitability,\n  days_of_week = excluded.days_of_week,\n  recurrence_rule = excluded.recurrence_rule,\n  schedule_notes = excluded.schedule_notes,\n  description = excluded.description,\n  cost = excluded.cost,\n  source_name = excluded.source_name,\n  image_url = excluded.image_url,\n  image_source_url = excluded.image_source_url,\n  google_place_id = excluded.google_place_id,\n  google_place_uri = excluded.google_place_uri,\n  google_rating = excluded.google_rating,\n  google_user_rating_count = excluded.google_user_rating_count,\n  google_primary_type = excluded.google_primary_type,\n  activity_date = excluded.activity_date,\n  available_dates = excluded.available_dates,\n  availability_start_date = excluded.availability_start_date,\n  availability_end_date = excluded.availability_end_date,\n  available_days_of_week = excluded.available_days_of_week,\n  availability_type = excluded.availability_type,\n  availability_notes = excluded.availability_notes,\n  public_listing_status = excluded.public_listing_status,\n  updated_at = now();\n`;
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

async function discoverEventUrls() {
  const urls = new Set();
  const occurrencesByUrl = new Map();
  let noNewPages = 0;
  let scannedPages = 0;

  for (let page = 0; page < maxPages && noNewPages < noNewPageLimit; page += 1) {
    const url = new URL(listingUrl);
    url.searchParams.set('page', String(page));
    const occurrences = listingOccurrences(await fetchHtml(url));
    const before = urls.size;
    occurrences.forEach((occurrence) => {
      urls.add(occurrence.url);
      const current = occurrencesByUrl.get(occurrence.url) || new Map();
      current.set(`${occurrence.date}|${occurrence.start}|${occurrence.end}`, occurrence);
      occurrencesByUrl.set(occurrence.url, current);
    });
    noNewPages = urls.size === before ? noNewPages + 1 : 0;
    scannedPages += 1;
    await delay(pageDelayMs);
  }

  return { urls: [...urls], occurrencesByUrl, scannedPages };
}

async function main() {
  if (!googleApiKey) throw new Error('Missing GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY.');
  const { urls, occurrencesByUrl, scannedPages } = await discoverEventUrls();
  const audit = await mapWithConcurrency(urls, detailConcurrency, async (url) => {
    try {
      const html = await fetchHtml(url);
      await delay(detailDelayMs);
      const name = pageTitle(html);
      const categories = labelledValue(html, 'Event category:');
      if (!/best start in life/i.test(categories)) return { url, name, status: 'skipped', reason: 'Not a Best Start in Life event' };
      if (excludedNames.test(name)) return { url, name, status: 'skipped', reason: 'Outside the family activity directory scope' };
      const venue = labelledValue(html, 'Event venue:') || labelledValue(html, 'Location:');
      if (!venue) return { url, name, status: 'skipped', reason: 'No venue supplied by council page' };
      const place = await googlePlace(venue);
      const occurrences = [...(occurrencesByUrl.get(url)?.values() || [])]
        .sort((left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start));
      const row = parseEvent(url, html, place, occurrences);
      if (!row) return { url, name, status: 'skipped', reason: 'No parsable schedule or verified venue coordinate' };
      return { url, name, status: 'ready', row };
    } catch (error) {
      return { url, status: 'error', reason: error.message };
    }
  });
  const rows = audit.filter((item) => item.status === 'ready').map((item) => item.row);
  rows.sort((left, right) => left.activity_name.localeCompare(right.activity_name));

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, JSON.stringify({
    listing_url: listingUrl,
    generated_at: new Date().toISOString(),
    pages_scanned: scannedPages,
    unique_event_pages: urls.length,
    rows: rows.length,
    audit: audit.map((item) => ({
      url: item.url,
      name: item.name || null,
      status: item.status,
      reason: item.reason || null,
    })),
  }, null, 2) + '\n');
  console.log(`Scanned ${scannedPages} council result pages, checked ${urls.length} unique event pages, and generated ${rows.length} verified Best Start listings.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
