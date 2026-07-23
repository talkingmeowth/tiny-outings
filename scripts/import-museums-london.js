/* global process */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceUrl = 'https://www.museumslondon.org/list-of-museums-in-london';
const childFriendlyUrl = 'https://www.museumslondon.org/child-friendly-museums';
const outputSql = join(root, 'supabase', 'seed', 'activities_museums_london.generated.sql');
const outputAudit = join(root, 'data', 'museums_london_import.generated.json');
const sourceName = 'Museums London child-friendly listing';
// `data_source` is the app's high-level grouping; retain the named publisher
// in `source_name` so its provenance remains visible on activity cards.
const dataSource = 'other';

// Museums London flags these venues as child-friendly, but these subjects are
// outside Tiny Outings' family-day-out remit. Keep the rule conservative.
const unsuitableVenuePattern = /\b(firepower|artillery|military|war museum|imperial war|national army|battle of britain|bunker|weapons?|army|naval|hms belfast|household cavalry|police museum|prison|torture|yeomanry)\b/i;
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const addressOverrides = {
  'Science Museum': { address: 'Exhibition Road, South Kensington, London SW7 2DD', postcode: 'SW7 2DD' },
};

function cleanText(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || null;
}

function absoluteUrl(value, baseUrl) {
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const clean = [...new Set(values.filter(Boolean))];
  return clean.length ? `array[${clean.map(sql).join(', ')}]` : "'{}'";
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'TinyOutings/1.0 (+https://tiny-outings-cpjh.onrender.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return { html: await response.text(), url: response.url };
}

function childFriendlyMuseumUrls(html) {
  return [...new Set([...html.matchAll(/href=["']([^"']*museum\/\d+\/[^"']+)["']/gi)]
    .map((match) => absoluteUrl(match[1], childFriendlyUrl))
    .filter(Boolean))];
}

function openHours(text) {
  const section = text.match(/Open Times\s+([\s\S]*?)(?=London Area:|Address|Contact details|$)/i)?.[1] || '';
  const values = [];
  const openDays = [];
  for (const day of weekdays) {
    const row = section.match(new RegExp(`${day}\\s+(CLOSED|\\d{1,2}:\\d{2}(?:am|pm)?)\\s+[–-]\\s+(CLOSED|\\d{1,2}:\\d{2}(?:am|pm)?)`, 'i'));
    if (!row || /closed/i.test(row[1])) continue;
    const toTime = (value) => {
      const match = value.match(/(\d{1,2}):(\d{2})(am|pm)/i);
      if (!match) return null;
      let hour = Number(match[1]);
      if (match[3].toLowerCase() === 'pm' && hour !== 12) hour += 12;
      if (match[3].toLowerCase() === 'am' && hour === 12) hour = 0;
      return `${String(hour).padStart(2, '0')}:${match[2]}`;
    };
    const start = toTime(row[1]);
    const end = toTime(row[2]);
    if (start && end) values.push({ start, end });
    openDays.push(day);
  }
  return {
    start: values.map((value) => value.start).sort()[0] || null,
    end: values.map((value) => value.end).sort().at(-1) || null,
    days: openDays,
  };
}

function museumImage(html, pageUrl) {
  for (const tag of html.match(/<meta\s+[^>]*>/gi) || []) {
    const property = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    if (!['og:image', 'og:image:url', 'twitter:image'].includes(property)) continue;
    const content = attr(tag, 'content');
    const imageUrl = content ? absoluteUrl(content, pageUrl) : null;
    if (imageUrl && !/(logo|icon|favicon|facebook|twitter|pixel|tracking)/i.test(imageUrl)) return imageUrl;
  }

  // Museums London publishes the activity image as a regular hero image rather
  // than Open Graph metadata. Prefer that image and skip logos and ad pixels.
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const source = attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || attr(tag, 'srcset') || attr(tag, 'src');
    const imageUrl = source ? absoluteUrl(source.split(',')[0].trim().split(/\s+/)[0], pageUrl) : null;
    const alt = attr(tag, 'alt') || '';
    if (!imageUrl || !/\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(imageUrl)) continue;
    if (/(logo|icon|favicon|facebook|twitter|pixel|tracking|prf\.hn)/i.test(`${imageUrl} ${alt}`)) continue;
    return imageUrl;
  }
  return null;
}

function museumWebsite(html, pageUrl) {
  const link = [...html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .find((match) => /visit museum website/i.test(cleanText(match[2])));
  return link ? absoluteUrl(link[1], pageUrl) : null;
}

function museumAddress(text, name) {
  const section = text.match(/Address\s+([\s\S]*?)(?=How to get there|Contact details|$)/i)?.[1] || '';
  const postcode = section.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null;
  const lines = section.split(/(?<=\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b)/i)[0] || section;
  const address = cleanText(lines).replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '');
  return addressOverrides[name] || { address: address || `${name}, London`, postcode };
}

function boroughFor(address) {
  const value = String(address || '').toLowerCase();
  if (/hackney|e8\b/.test(value)) return 'Hackney';
  if (/islington|n1\b/.test(value)) return 'Islington';
  if (/newham|e15\b|e16\b/.test(value)) return 'Newham';
  if (/walthamstow|leyton|e17\b|e10\b|e11\b/.test(value)) return 'Waltham Forest';
  return 'London';
}

async function geocode(postcode) {
  if (!postcode) return { lat: null, long: null };
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    const place = response.ok ? (await response.json()).result : null;
    return place ? { lat: Number(place.latitude), long: Number(place.longitude) } : { lat: null, long: null };
  } catch {
    return { lat: null, long: null };
  }
}

function museumDescription(text) {
  const value = text.match(/^([\s\S]*?)(?:Museum Facilities|Admission|Open Times|London Area:|Address)/i)?.[1] || text;
  return cleanText(value).slice(0, 500);
}

function museumContent(text, name) {
  const start = text.toLowerCase().indexOf(name.toLowerCase());
  return start === -1 ? text : text.slice(start);
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

function rowSql(row) {
  return `(${[
    sql(row.activity_name), sql(row.address), sql(row.postcode), row.lat ?? 'null', row.long ?? 'null', sql(row.category),
    sql(row.start_time), sql(row.end_time), sql(row.google_link), sql(row.website), sql(row.organiser_website),
    '5', 'null', '0', sql(row.age_suitability), sql(row.borough), sqlArray(row.days_of_week), sql(row.schedule_notes),
    sql(row.description), sql(row.cost), 'false', sql(row.source_name), sql(row.source_url), sql(row.image_url), sql(row.image_source_url),
    sql(row.data_source), sql(row.availability_type), sql(row.public_listing_status),
  ].join(', ')})`;
}

function buildSql(rows) {
  const columns = [
    'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website', 'organiser_website',
    'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'schedule_notes',
    'description', 'cost', 'booking_required', 'source_name', 'source_url', 'image_url', 'image_source_url', 'data_source', 'availability_type', 'public_listing_status',
  ];
  if (!rows.length) return '-- No suitable Museums London records found.\n';
  return `-- Generated by scripts/import-museums-london.js\n-- Source: ${sourceUrl}\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n  ${rows.map(rowSql).join(',\n  ')}\non conflict (source_url) do update set\n  activity_name = excluded.activity_name,\n  address = excluded.address,\n  postcode = excluded.postcode,\n  lat = coalesce(excluded.lat, public.activities.lat),\n  long = coalesce(excluded.long, public.activities.long),\n  website = excluded.website,\n  organiser_website = excluded.organiser_website,\n  days_of_week = excluded.days_of_week,\n  schedule_notes = excluded.schedule_notes,\n  description = excluded.description,\n  cost = excluded.cost,\n  image_url = coalesce(excluded.image_url, public.activities.image_url),\n  image_source_url = coalesce(excluded.image_source_url, public.activities.image_source_url),\n  public_listing_status = 'published',\n  updated_at = now();\n`;
}

async function main() {
  const { html: listingHtml } = await fetchHtml(childFriendlyUrl);
  const museumUrls = childFriendlyMuseumUrls(listingHtml);
  const audit = await mapWithConcurrency(museumUrls, 5, async (museumUrl) => {
    try {
      const { html, url } = await fetchHtml(museumUrl);
      const name = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
      const headingIndex = html.search(/<h1\b/i);
      const text = cleanText(headingIndex === -1 ? html : html.slice(headingIndex));
      const content = museumContent(text, name);
      const description = museumDescription(content);
      if (!name || unsuitableVenuePattern.test(`${name} ${description}`)) return { museumUrl, name, status: 'excluded' };
      const { address, postcode } = museumAddress(content, name);
      const hours = openHours(content);
      const coordinates = await geocode(postcode);
      return {
        status: 'ready',
        row: {
          activity_name: name,
          address,
          postcode,
          ...coordinates,
          category: 'Museums & culture',
          start_time: hours.start || '10:00',
          end_time: hours.end || '17:00',
          google_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
          website: museumWebsite(html, url) || url,
          organiser_website: museumWebsite(html, url),
          age_suitability: 'Families and children',
          borough: boroughFor(address),
          days_of_week: hours.days,
          schedule_notes: hours.days.length ? `Opening hours sourced from Museums London. Check the museum website before travelling.` : 'Check opening hours before travelling.',
          description,
          cost: /FREE entry/i.test(content) ? 'Free' : 'Check museum website',
          source_name: sourceName,
          source_url: url,
          image_url: museumImage(html, url),
          image_source_url: url,
          data_source: dataSource,
          availability_type: hours.days.length === 7 ? 'daily' : 'weekly',
          public_listing_status: 'published',
        },
      };
    } catch (error) {
      return { museumUrl, status: 'error', error: error.message };
    }
  });
  const rows = audit.filter((item) => item.status === 'ready').map((item) => item.row);
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, JSON.stringify({
    generated_at: new Date().toISOString(),
    source_url: sourceUrl,
    child_friendly_source_url: childFriendlyUrl,
    candidates: museumUrls.length,
    imported: rows.length,
    excluded: audit.filter((item) => item.status === 'excluded').map((item) => item.name),
    errors: audit.filter((item) => item.status === 'error').map((item) => ({ url: item.museumUrl, error: item.error })),
  }, null, 2) + '\n');
  console.log(`Museums London: ${museumUrls.length} child-friendly candidates; ${rows.length} suitable imports; ${audit.filter((item) => item.status === 'excluded').length} excluded.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
