/* global process */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const landingUrl = 'https://www.timeout.com/london/kids';
const outputSql = join(root, 'supabase', 'seed', 'activities_timeout_london_kids.generated.sql');
const outputAudit = join(root, 'data', 'timeout_london_kids_import.generated.json');
const maxDetails = Math.max(1, Number.parseInt(process.env.TIMEOUT_MAX_DETAIL_PAGES || '250', 10));

// Time Out's kid guides can mention historic military sites. Keep the same
// conservative exclusion used for the family museum import.
const unsuitablePattern = /\b(firepower|artillery|military|war museum|imperial war|national army|battle of britain|bunker|weapons?|army|naval|hms belfast|household cavalry|police museum|prison|torture|yeomanry)\b/i;
const rootGuidePaths = new Set([
  '/london/kids/the-best-things-for-kids-to-do-in-london-in-the-summer-holidays',
  '/london/kids/101-things-to-do-in-london-with-kids',
  '/london/theatre/childrens-theatre-in-london',
  '/london/kids/activities/free-things-to-do-with-the-kids-in-london',
  '/london/kids/101-things-to-do-in-london-with-kids-babies-and-toddlers',
  '/london/attractions/top-london-attractions',
  '/london/things-to-do/harry-potter-in-london-tours-walks-and-more',
  '/london/events/indoor-play-centres-in-london',
  '/london/attractions/top-10-museums-in-london-for-kids',
]);

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

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlArray(values) {
  const clean = [...new Set((values || []).filter(Boolean))];
  return clean.length ? `array[${clean.map(sql).join(', ')}]` : "'{}'";
}

function absoluteUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    return url.hostname === 'www.timeout.com' && url.pathname.startsWith('/london/') ? url.toString().split('#')[0] : null;
  } catch {
    return null;
  }
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TinyOutings/1.0; +https://tiny-outings-cpjh.onrender.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Time Out returned ${response.status}`);
  return { html: await response.text(), url: canonicalUrl(response.url) };
}

function links(html, baseUrl) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ url: absoluteUrl(match[1], baseUrl), text: cleanText(match[2]) }))
    .filter((link) => link.url && !/\[cta_link\]/i.test(link.url));
}

function guideUrls(landingHtml) {
  return [...new Set(links(landingHtml, landingUrl)
    .map((link) => canonicalUrl(link.url))
    .filter((url) => rootGuidePaths.has(new URL(url).pathname)))];
}

function rootVenueUrls(landingHtml) {
  return [...new Set(links(landingHtml, landingUrl)
    .map((link) => canonicalUrl(link.url))
    .filter((url) => /\/(young-v-a|natural-history-museum|london-zoo)$/.test(new URL(url).pathname)))];
}

function reviewJsonLd(html) {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]);
      const values = Array.isArray(value) ? value : [value];
      const review = values.find((item) => item?.['@type'] === 'Review' && item.itemReviewed?.geo);
      if (review) return review;
    } catch {
      // Ignore non-JSON or unrelated structured data blocks.
    }
  }
  return null;
}

function pageTitle(html) {
  return cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
}

function metaDescription(html) {
  for (const tag of html.match(/<meta\s+[^>]*>/gi) || []) {
    const name = tag.match(/\b(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    if (content && ['description', 'og:description', 'twitter:description'].includes(name)) return cleanText(content);
  }
  return null;
}

function categoryFor(review) {
  const text = cleanText([review.headline, review.keywords?.join(' ')].join(' ')).toLowerCase();
  if (/(museum|gallery|science|illustration|history)/.test(text)) return 'Museums & culture';
  if (/(theatre|cinema|show|musical)/.test(text)) return 'Family activities';
  if (/(soft play|indoor play|play space|play centre)/.test(text)) return 'Soft play';
  if (/(park|zoo|farm|garden|outdoor|adventure|water|lido|swim)/.test(text)) return 'Parks & outdoor play';
  if (/(cafe|restaurant|food|brunch)/.test(text)) return 'Child-friendly cafes';
  if (/(book|library|shop)/.test(text)) return 'Bookshops';
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

function addressFor(place) {
  const address = place.address || {};
  return [address.streetAddress, address.addressLocality || 'London', address.postalCode]
    .map(cleanText).filter(Boolean).join(', ');
}

function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)).then(() => results);
}

const columns = [
  'activity_name', 'address', 'postcode', 'lat', 'long', 'category', 'start_time', 'end_time', 'google_link', 'website', 'organiser_website',
  'child_friendly_score', 'app_rating', 'number_of_reviews', 'age_suitability', 'borough', 'days_of_week', 'schedule_notes', 'description', 'cost',
  'booking_required', 'source_name', 'source_url', 'image_url', 'image_source_url', 'data_source', 'availability_type', 'public_listing_status',
];

function rowSql(row) {
  return `(${columns.map((column) => {
    const value = row[column];
    if (['lat', 'long', 'child_friendly_score', 'app_rating', 'number_of_reviews'].includes(column)) return value ?? 'null';
    if (column === 'days_of_week') return sqlArray(value);
    if (column === 'booking_required') return value ? 'true' : 'false';
    return sql(value);
  }).join(', ')})`;
}

function buildSql(rows) {
  if (!rows.length) return '-- No Time Out London Kids activity records found.\n';
  return `-- Generated by scripts/import-timeout-london-kids.js\n-- Source: ${landingUrl}\n\ninsert into public.activities (\n  ${columns.join(',\n  ')}\n)\nvalues\n  ${rows.map(rowSql).join(',\n  ')}\non conflict (source_url) do update set\n  activity_name = excluded.activity_name,\n  address = excluded.address,\n  postcode = excluded.postcode,\n  lat = coalesce(excluded.lat, public.activities.lat),\n  long = coalesce(excluded.long, public.activities.long),\n  category = excluded.category,\n  website = excluded.website,\n  organiser_website = excluded.organiser_website,\n  app_rating = excluded.app_rating,\n  number_of_reviews = excluded.number_of_reviews,\n  description = excluded.description,\n  image_url = coalesce(excluded.image_url, public.activities.image_url),\n  image_source_url = excluded.image_source_url,\n  public_listing_status = 'published',\n  updated_at = now();\n`;
}

function rowFor(url, html, review) {
  const place = review.itemReviewed;
  const address = addressFor(place);
  const title = pageTitle(html) || cleanText(place.name).replace(/\s*(\||:).*$/, '');
  const image = place.image || review.image || null;
  return {
    activity_name: title,
    address,
    postcode: place.address?.postalCode || null,
    lat: Number(place.geo?.latitude),
    long: Number(place.geo?.longitude),
    category: categoryFor(review),
    start_time: null,
    end_time: null,
    google_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    website: place.url || url,
    organiser_website: place.url || null,
    child_friendly_score: 5,
    app_rating: Number(review.reviewRating?.ratingValue) || null,
    number_of_reviews: 0,
    age_suitability: 'Families and children',
    borough: boroughFor(address),
    days_of_week: [],
    schedule_notes: 'Check the venue website for opening hours and booking details.',
    description: metaDescription(html) || 'Family-friendly London activity recommended by Time Out.',
    cost: place.priceRange || 'Check venue website',
    booking_required: false,
    source_name: 'Time Out London Kids',
    source_url: url,
    image_url: image,
    image_source_url: url,
    data_source: 'other',
    availability_type: 'unknown',
    public_listing_status: 'published',
  };
}

async function main() {
  const { html: landingHtml } = await fetchHtml(landingUrl);
  const guides = guideUrls(landingHtml);
  const guidePages = await mapWithConcurrency(guides, 3, async (url) => {
    try {
      const { html } = await fetchHtml(url);
      return { url, links: links(html, url).filter((link) => /^read more$/i.test(link.text)).map((link) => canonicalUrl(link.url)) };
    } catch (error) {
      return { url, links: [], error: error.message };
    }
  });
  const candidateUrls = [...new Set([
    ...rootVenueUrls(landingHtml),
    ...guidePages.flatMap((guide) => guide.links),
  ])].slice(0, maxDetails);
  const audit = await mapWithConcurrency(candidateUrls, 4, async (url) => {
    try {
      const { html, url: finalUrl } = await fetchHtml(url);
      const review = reviewJsonLd(html);
      if (!review) return { url, status: 'skipped', reason: 'Linked page is not a structured venue listing' };
      const place = review.itemReviewed;
      const address = addressFor(place);
      const title = pageTitle(html) || place.name;
      if (unsuitablePattern.test(`${title} ${review.keywords?.join(' ') || ''}`)) return { url, name: title, status: 'excluded', reason: 'Outside Tiny Outings family suitability rules' };
      if (!address || !Number.isFinite(Number(place.geo?.latitude)) || !Number.isFinite(Number(place.geo?.longitude))) {
        return { url, name: title, status: 'skipped', reason: 'No verified address and coordinates' };
      }
      return { url: finalUrl, name: title, status: 'ready', row: rowFor(finalUrl, html, review) };
    } catch (error) {
      return { url, status: 'error', reason: error.message };
    }
  });
  const rowsByUrl = new Map();
  for (const item of audit.filter((item) => item.status === 'ready')) rowsByUrl.set(item.row.source_url, item.row);
  const rows = [...rowsByUrl.values()].sort((left, right) => left.activity_name.localeCompare(right.activity_name));
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(rows));
  writeFileSync(outputAudit, JSON.stringify({
    generated_at: new Date().toISOString(),
    landing_url: landingUrl,
    guide_pages_scanned: guides,
    candidate_links: candidateUrls.length,
    imported: rows.length,
    audit: audit.map((item) => ({
      url: item.url,
      name: item.name || null,
      status: item.status,
      reason: item.reason || null,
    })),
  }, null, 2) + '\n');
  console.log(`Scanned ${guides.length} Time Out Kids guides, checked ${candidateUrls.length} linked venues, and generated ${rows.length} activities.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
