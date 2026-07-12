/* global process */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const listingUrl = 'https://feverup.com/en/london/family';
const outputSql = join(root, 'supabase', 'seed', 'activities_fever_london_family_20260711.generated.sql');
const outputAudit = join(root, 'data', 'fever_london_family_20260711.generated.json');
const excludedTitles = new Set([
  'les miserables',
  'modern magic show with jake banfield',
  'paradox museum london the ultimate birthday party venue in london',
]);
const curatedSummaries = {
  'babylon park londons underground theme park': 'Indoor Camden theme park with rides, arcade games and soft-play zones for little explorers.',
  'christmas by candlelight at 235 shaftesbury avenue': 'Seasonal candlelit concert at Bloomsbury Central, with child concession tickets available.',
  'halloween at kew': 'After-dark Halloween trail at Kew Gardens with illuminated scenes, performers and seasonal treats.',
  'harry potter warner bros studios with coach transport from london': 'Coach day trip from central London to the Warner Bros. Studio Tour and its Harry Potter film sets.',
  'hobbledown heath londons largest adventure playground': 'Adventure playground and animal park with climbing, outdoor play and family-friendly activities.',
  'house of dreamers': 'Family-friendly immersive exhibition with dreamy installations, a giant ball pit and interactive moments.',
  'kid quest in kensington gardens london superhero city adventure for kids ages 4 8': 'Self-guided superhero adventure around Kensington Gardens for children aged 4 to 8.',
  'matilda the musical': 'West End musical based on Roald Dahl\'s Matilda, best suited to older children.',
  'mini genius lab cool science experiments for kids': 'Hands-on science workshop where children can try colourful experiments and learn through play.',
  'paradox museum london': 'Interactive illusion museum with playful rooms, visual puzzles and family photo opportunities.',
  'paw patrol afternoon tea bus tour': 'PAW Patrol-themed afternoon tea and sightseeing bus ride around central London.',
  'paw patrol christmas lights bus tour': 'Seasonal PAW Patrol bus tour with London lights, treats and family entertainment.',
  'peppa pig afternoon tea london sightseeing bus tour': 'Peppa Pig-themed afternoon tea and sightseeing bus ride for young children and their grown-ups.',
  'peppa pig christmas bus tour': 'Seasonal Peppa Pig sightseeing bus tour with festive treats and entertainment.',
  'peppa pig halloween london sightseeing bus tour': 'Seasonal Peppa Pig bus tour with Halloween treats, games and sightseeing.',
  'raver tots wembley': 'Family dance party with child-friendly music, performers, face painting and space to move.',
  'the lion king': 'Family West End musical at the Lyceum Theatre, recommended for children aged three and over.',
  'the museum of brands a visual journey through consumer culture': 'Small Notting Hill museum with nostalgic toys, packaging and family tickets.',
  'tootbus london discovery bus tour': 'Hop-on hop-off London bus tour with a children\'s audio guide and stroller-friendly access.',
  'zsl london zoo': 'Family day out at London Zoo with animals, keeper talks and feeding sessions.',
};

function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalized(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const weekdayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function toTwentyFourHour(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (match[3].toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (match[3].toLowerCase() === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function weekdaysBetween(first, last) {
  const start = weekdayOrder.indexOf(first);
  const end = weekdayOrder.indexOf(last || first);
  return start === -1 || end === -1 ? [] : weekdayOrder.slice(start, end + 1);
}

function feverWeeklyHours(html) {
  const text = cleanText(html).replaceAll('–', '-').replaceAll('—', '-');
  const timeSection = text.match(/Time:\s*([\s\S]*?)(?=Duration:|Location:|Age requirement:|Accessibility:|Description:|$)/i)?.[1] || '';
  const pattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*-\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?(?:\s*&\s*Public Holidays)?\s*:\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/gi;
  const periods = [];
  for (const match of timeSection.matchAll(pattern)) {
    const start = toTwentyFourHour(match[3]);
    const end = toTwentyFourHour(match[4]);
    if (!start || !end) continue;
    periods.push({ days: weekdaysBetween(match[1], match[2]), start, end, label: match[0].trim() });
  }
  const days = [...new Set(periods.flatMap((period) => period.days))];
  if (!periods.length) return { days: [], start: null, end: null, type: 'unknown', notes: null };
  return {
    days,
    start: periods.map((period) => period.start).sort()[0],
    end: periods.map((period) => period.end).sort().at(-1),
    type: days.length === 7 ? 'daily' : 'weekly',
    notes: `Fever opening hours: ${periods.map((period) => period.label).join(' | ')}`,
  };
}

function feverCalendarDates(html) {
  const today = new Date().toISOString().slice(0, 10);
  const latest = new Date();
  latest.setFullYear(latest.getFullYear() + 1);
  const latestDate = latest.toISOString().slice(0, 10);
  return [...new Set([...String(html || '').matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map((match) => match[0]))]
    .filter((date) => date >= today && date <= latestDate)
    .sort();
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const clean = [...new Set((values || []).filter(Boolean))];
  return clean.length ? `array[${clean.map(sql).join(', ')}]` : "'{}'";
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TinyOutings/1.0)', Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Fever returned ${response.status}`);
  return response.text();
}

function listingUrls(html) {
  return [...new Set([...html.matchAll(/https:\/\/feverup\.com\/m\/\d+(?:\?[^"'<>\s]*)?/g)].map((match) => match[0].split('?')[0]))];
}

function productJsonLd(html) {
  for (const match of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      const product = values.find((item) => item?.['@type'] === 'Product' && item?.offers);
      if (product) return product;
    } catch {
      // Ignore unrelated embedded data.
    }
  }
  return null;
}

function familyRelevant(product) {
  const title = normalized(product.name);
  const text = `${title} ${product.description || ''}`.toLowerCase();
  return !excludedTitles.has(title)
    && /baby|toddler|kid|child|children|family|parent|peppa|paw patrol|matilda|lion king|harry potter|halloween at kew|hobbledown|bubble planet|babylon park|london zoo|space explorers|dinos|mini genius|raver tots|museum of brands|moco museum|paradox museum|science museum/.test(text);
}

function shortDescription(product) {
  const curated = curatedSummaries[normalized(product.name)];
  if (curated) return curated;
  return 'Family outing in London. Check Fever for the latest dates, times and tickets.';
}

function categoryFor(product) {
  const text = `${product.name || ''} ${product.description || ''}`.toLowerCase();
  if (/(concert|candlelight|sing|music)/.test(text)) return 'Music & singing';
  if (/(museum|exhibition|science)/.test(text)) return 'Museums & culture';
  if (/(zoo|park|garden|outdoor|adventure)/.test(text)) return 'Parks & outdoor play';
  if (/(brunch|tea|food|kitchen)/.test(text)) return 'Family activities';
  return 'Family activities';
}

function ageSuitability(description) {
  const match = cleanText(description).match(/Age (?:recommendation|requirement):\s*([^\r\n.]+)/i);
  return match ? match[1].trim() : 'Families and children';
}

function rowFor(product, url, html) {
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const hours = feverWeeklyHours(html);
  const calendarDates = feverCalendarDates(html);
  const place = offer?.areaServed || {};
  const geo = place.geo || product.image?.contentLocation?.geo || {};
  const price = Number(offer?.price);
  const name = cleanText(product.name);
  const location = cleanText(place.name || 'London');
  const locality = cleanText(place.address?.addressLocality || 'London');
  const address = location.toLowerCase().includes('london') ? location : `${location}, ${locality}`;
  const description = cleanText(product.description);
  return {
    activity_name: name,
    address,
    postcode: null,
    lat: Number.isFinite(Number(geo.latitude)) ? Number(geo.latitude) : null,
    long: Number.isFinite(Number(geo.longitude)) ? Number(geo.longitude) : null,
    category: categoryFor(product),
    start_time: hours.start,
    end_time: hours.end,
    google_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    website: url,
    child_friendly_score: null,
    app_rating: null,
    number_of_reviews: 0,
    age_suitability: ageSuitability(description),
    borough: 'London',
    days_of_week: hours.days,
    recurrence_rule: null,
    schedule_notes: hours.notes || 'Select a live date and time on Fever before booking.',
    description: shortDescription(product),
    cost: Number.isFinite(price) ? `GBP ${price.toFixed(2)} from Fever` : 'Check Fever',
    booking_required: true,
    source_name: 'Fever London family listings',
    source_url: url,
    image_url: product.image?.contentUrl || null,
    image_source_url: url,
    activity_date: calendarDates.length === 1 ? calendarDates[0] : null,
    available_dates: calendarDates,
    availability_start_date: calendarDates[0] || null,
    availability_end_date: calendarDates.at(-1) || null,
    available_days_of_week: hours.days,
    availability_type: calendarDates.length ? 'specific_dates' : hours.type,
    availability_notes: calendarDates.length
      ? `Fever ticket calendar lists ${calendarDates.length} bookable date${calendarDates.length === 1 ? '' : 's'} through ${calendarDates.at(-1)}. ${hours.notes || 'Select a time in Fever.'}`
      : hours.notes || 'Fever has not published a structured availability schedule yet.',
    public_listing_status: 'published',
  };
}

const columns = [
  'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website',
  'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'recurrence_rule',
  'schedule_notes', 'description', 'cost', 'booking_required', 'source_name', 'source_url', 'image_url', 'image_source_url',
  'activity_date', 'available_dates', 'availability_start_date', 'availability_end_date', 'available_days_of_week',
  'availability_type', 'availability_notes', 'public_listing_status',
];

function rowSql(row) {
  return columns.map((column) => {
    const value = row[column];
    if (['lat', 'long', 'child_friendly_score', 'app_rating', 'number_of_reviews'].includes(column)) return value ?? 'null';
    if (column === 'available_dates') return `${sqlArray(value)}::date[]`;
    if (['days_of_week', 'available_days_of_week'].includes(column)) return sqlArray(value);
    if (column === 'booking_required') return value ? 'true' : 'false';
    return sql(value);
  }).join(', ');
}

function buildSql(rows) {
  return `-- Generated by scripts/import-fever-london-family.js\n-- Source: ${listingUrl}\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n${rows.map((row) => `(${rowSql(row)})`).join(',\n')}\non conflict (source_url) do update set\n  activity_name = excluded.activity_name,\n  address = excluded.address,\n  lat = excluded.lat,\n  long = excluded.long,\n  category = excluded.category,\n  website = excluded.website,\n  age_suitability = excluded.age_suitability,\n  schedule_notes = excluded.schedule_notes,\n  description = excluded.description,\n  cost = excluded.cost,\n  image_url = excluded.image_url,\n  image_source_url = excluded.image_source_url,\n  availability_start_date = excluded.availability_start_date,\n  availability_type = excluded.availability_type,\n  availability_notes = excluded.availability_notes,\n  public_listing_status = 'published',\n  updated_at = now();\n`;
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

async function main() {
  const urls = listingUrls(await fetchHtml(listingUrl));
  const audit = await mapWithConcurrency(urls, 3, async (url) => {
    try {
      const html = await fetchHtml(url);
      const product = productJsonLd(html);
      if (!product) return { url, status: 'skipped', reason: 'No product data' };
      if (!familyRelevant(product)) return { url, name: product.name, status: 'skipped', reason: 'Not explicitly family-focused' };
      return { url, name: product.name, status: 'ready', product, html };
    } catch (error) {
      return { url, status: 'error', reason: error.message };
    }
  });
  const rows = audit
    .filter((item) => item.status === 'ready')
    .map((item) => ({ item, row: rowFor(item.product, item.url, item.html) }))
    .filter(({ item, row }) => {
      const hasCoordinates = Number.isFinite(row.lat) && Number.isFinite(row.long);
      if (!hasCoordinates) {
        item.status = 'skipped';
        item.reason = 'No verified venue coordinate';
      }
      return hasCoordinates;
    })
    .map(({ row }) => row);
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, JSON.stringify({
    listing_url: listingUrl,
    generated_at: new Date().toISOString(),
    audit: audit.map((item) => ({ url: item.url, name: item.name, status: item.status, reason: item.reason })),
    rows,
  }, null, 2) + '\n');
  console.log(`Found ${urls.length} Fever family listings and generated ${rows.length} family-friendly activities.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
