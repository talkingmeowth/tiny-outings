/* global process */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const listingUrl = 'https://feverup.com/en/london/family';
const outputSql = join(root, 'supabase', 'seed', 'activities_fever_london_family_20260711.generated.sql');
const outputAudit = join(root, 'data', 'fever_london_family_20260711.generated.json');

function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
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
  const text = `${product.name || ''} ${product.description || ''}`.toLowerCase();
  return /baby|toddler|kid|child|children|family|parent|peppa|paw patrol|matilda|lion king|harry potter|halloween at kew|hobbledown|bubble planet|babylon park|london zoo|space explorers|dinos|mini genius|raver tots|museum of brands|moco museum|paradox museum|science museum/.test(text);
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

function rowFor(product, url) {
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
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
    start_time: '10:00',
    end_time: '17:00',
    google_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    website: url,
    child_friendly_score: null,
    app_rating: null,
    number_of_reviews: 0,
    age_suitability: ageSuitability(description),
    borough: 'London',
    days_of_week: [],
    recurrence_rule: null,
    schedule_notes: 'Select a live date and time on Fever before booking.',
    description,
    cost: Number.isFinite(price) ? `GBP ${price.toFixed(2)} from Fever` : 'Check Fever',
    booking_required: true,
    source_name: 'Fever London family listings',
    source_url: url,
    image_url: product.image?.contentUrl || null,
    image_source_url: url,
    activity_date: null,
    available_dates: [],
    availability_start_date: new Date().toISOString().slice(0, 10),
    availability_end_date: null,
    available_days_of_week: [],
    availability_type: 'date_range',
    availability_notes: 'Fever lists live availability in its ticket selector. Check Fever before booking.',
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
      const product = productJsonLd(await fetchHtml(url));
      if (!product) return { url, status: 'skipped', reason: 'No product data' };
      if (!familyRelevant(product)) return { url, name: product.name, status: 'skipped', reason: 'Not explicitly family-focused' };
      return { url, name: product.name, status: 'ready', product };
    } catch (error) {
      return { url, status: 'error', reason: error.message };
    }
  });
  const rows = audit.filter((item) => item.status === 'ready').map((item) => rowFor(item.product, item.url));
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
