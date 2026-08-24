/*
 * Finds conservatively matched Wikimedia Commons images for Tiny Outings.
 * The script only writes a mapping file; applying it remains an explicit DB step.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { allowsWikimediaImages } from '../src/wikimediaImagePolicy.js';

const ROOT = process.cwd();
const parksOnly = process.argv.includes('--parks-only');
const OUTPUT_PATH = path.join(
  ROOT,
  'supabase',
  'seed',
  parksOnly ? 'activity_park_wikimedia_image_updates.generated.sql' : 'activity_wikimedia_image_updates.generated.sql',
);
const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'TinyOutingsImageEnrichment/1.0 (contact: support@tinyoutings.app)';
const CONCURRENCY = Number(process.env.WIKIMEDIA_CONCURRENCY || 3);
const REQUEST_DELAY_MS = Number(process.env.WIKIMEDIA_REQUEST_DELAY_MS || 125);
const REQUEST_TIMEOUT_MS = Number(process.env.WIKIMEDIA_REQUEST_TIMEOUT_MS || 12_000);

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!match) return [];
    return [[match[1], match[2].replace(/^['"]|['"]$/g, '')]];
  }));
}

function normalise(value = '') {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function significantTokens(value) {
  const ignored = new Set(['the', 'and', 'for', 'with', 'london', 'baby', 'babies', 'children', 'child', 'class', 'classes', 'group', 'groups', 'at']);
  return normalise(value).split(' ').filter((token) => token.length > 2 && !ignored.has(token));
}

function confidence(activity, page) {
  const activityName = normalise(activity.activity_name);
  const title = normalise(page.title.replace(/^file\s*/i, ''));
  const wanted = significantTokens(activity.activity_name);
  const matched = wanted.filter((token) => title.includes(token));
  const tokenScore = wanted.length ? matched.length / wanted.length : 0;
  const exact = activityName && title.includes(activityName);
  const addressTokens = significantTokens(activity.address || '');
  const addressMatch = addressTokens.some((token) => title.includes(token));
  return (exact ? 1 : tokenScore) + (addressMatch ? 0.15 : 0);
}

async function getActivities(env) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL('/rest/v1/activities', env.VITE_SUPABASE_URL);
    url.searchParams.set('select', 'activity_id,activity_name,address,borough,category,wikimedia_image_url');
    url.searchParams.set('wikimedia_image_url', 'is.null');
    if (parksOnly) url.searchParams.set('category', 'ilike.*park*');
    url.searchParams.set('order', 'activity_name.asc');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } });
    if (!response.ok) throw new Error(`Supabase activity fetch failed: ${response.status}`);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < 1000) return rows.filter(allowsWikimediaImages);
  }
}

async function commonsRequest(params) {
  const url = new URL(API);
  Object.entries({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...params })
    .forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  return response?.ok ? response.json() : null;
}

function isParkActivity(activity) {
  return /park|playground|garden|open space|recreation ground|wood/.test(String(activity.category || '').toLowerCase());
}

function isUsableCommonsImage(member) {
  const title = normalise(member?.title || '');
  // Commons categories sometimes include media icons or files from another
  // place with the same name, or artwork and exhibition graphics. Never use
  // those as an activity-card photo.
  return !/file type icons?|fileicon| icon | logo | flag | denbighshire|wrexham|wrecsam|painting|exhibition|poster|illustration| nyc | ogg | mp3 | webm /.test(` ${title} `);
}

function mobileThumbnail(imageUrl) {
  // Commons may use a different path label (for example 960px) for a
  // 640px-rendered thumbnail. Preserve the API-issued URL exactly.
  return imageUrl || null;
}

function parkCategoryNames(activity) {
  const activityName = String(activity.activity_name || '').trim();
  const names = [activityName];
  // Listings often describe a feature within a park (for example, "Clissold
  // Park splash pad"). Commons stores those photos in the parent park's
  // category, not under the full listing title.
  const parentMatch = activityName.match(/^(.+?\b(?:park|gardens?|playground|woods?|open space|recreation ground))\b/i);
  const parentName = parentMatch?.[1]?.trim();
  const specificTokens = significantTokens(parentName).filter((token) => ![
    'park', 'garden', 'gardens', 'playground', 'woods', 'open', 'space',
    'recreation', 'ground',
  ].includes(token));
  if (parentName && parentName !== activityName && specificTokens.length >= 1) names.push(parentName);
  return [...new Set(names)];
}

function isAmbiguousParkCategory(categoryName) {
  // Commons categories for these place names point to parks outside London.
  // Do not guess: a missing image is better than a misleading one.
  const meaningfulTokens = significantTokens(categoryName).filter((token) => ![
    'park', 'garden', 'gardens', 'playground', 'woods', 'open', 'space',
    'recreation', 'ground',
  ].includes(token));
  return meaningfulTokens.length === 1 && ['central', 'acton'].includes(meaningfulTokens[0]);
}

function parkSearchNames(activity) {
  const activityName = String(activity.activity_name || '').trim();
  const placeName = activityName
    .replace(/\b(play areas?|playground|splash pad|adventure playground|woodland playground|picnic field|lakes?)\b.*$/i, '')
    .trim();
  return [...new Set([activityName, placeName].filter(Boolean))];
}

function isSpecificParkPlace(placeName) {
  const genericTerms = new Set(['park', 'garden', 'gardens', 'playground', 'woods', 'open', 'space', 'recreation', 'ground']);
  return normalise(placeName).split(' ').filter((token) => !genericTerms.has(token)).length >= 2;
}

async function parkSearchImage(activity) {
  // Some Commons files have no category. For a specific multi-word place such
  // as London Fields, a filename containing that exact place name is a safe
  // fallback. One-word places remain category-only to avoid global matches.
  const postcodeDistrict = String(activity.address || '').match(/\b([A-Z]{1,2}\d{1,2})\s*\d[A-Z]{2}\b/i)?.[1]?.toLowerCase();
  if (!postcodeDistrict) return null;
  for (const placeName of parkSearchNames(activity)) {
    if (!isSpecificParkPlace(placeName)) continue;
    const payload = await commonsRequest({
      generator: 'search', gsrsearch: placeName, gsrnamespace: '6', gsrlimit: '10',
      prop: 'imageinfo', iiprop: 'url', iiurlwidth: '640',
    });
    const normalisedPlace = normalise(placeName);
    const page = Object.values(payload?.query?.pages || {}).find((item) => {
      const title = normalise(item.title);
      return isUsableCommonsImage(item)
        && title.includes(normalisedPlace)
        && title.includes(postcodeDistrict)
        && /park|playground|play area|field|garden|wood|lake/.test(title)
        && item.imageinfo?.[0]?.thumburl;
    });
    if (page) return mobileThumbnail(page.imageinfo[0].thumburl);
  }
  return null;
}

async function parkCategoryImage(activity) {
  // Generic park names occur worldwide. A named Commons category is the
  // reliable source for a park photo, so skip the image when none exists.
  for (const categoryName of parkCategoryNames(activity)) {
    if (isAmbiguousParkCategory(categoryName)) continue;
    const category = await commonsRequest({
      list: 'categorymembers',
      cmtitle: `Category:${categoryName}`,
      cmtype: 'file',
      cmlimit: '20',
    });
    const members = category?.query?.categorymembers || [];
    const normalisedCategory = normalise(categoryName);
    const usableMembers = members.filter(isUsableCommonsImage);
    const member = usableMembers.find((item) => normalise(item.title).includes(normalisedCategory)) || usableMembers[0];
    if (!member) continue;
    const image = await commonsRequest({
      titles: member.title,
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '640',
    });
    const imageUrl = image?.query?.pages?.[0]?.imageinfo?.[0]?.thumburl || null;
    if (imageUrl) return mobileThumbnail(imageUrl);
  }
  return parkSearchImage(activity);
}

async function searchWikimedia(activity) {
  if (isParkActivity(activity)) return parkCategoryImage(activity);
  // Full street addresses over-constrain Commons' text search. The name is
  // the searchable entity; the address remains part of the confidence check.
  const query = activity.activity_name;
  const payload = await commonsRequest({
    generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '5',
    prop: 'imageinfo', iiprop: 'url', iiurlwidth: '640',
  }).catch(() => null);
  const pages = payload?.query?.pages || [];
  const ranked = pages
    .map((page) => ({ page, score: confidence(activity, page) }))
    .filter(({ page, score }) => score >= 0.75 && page.imageinfo?.[0]?.thumburl)
    .sort((a, b) => b.score - a.score);
  return mobileThumbnail(ranked[0]?.page.imageinfo[0].thumburl);
}

function sql(value) {
  return value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
}

function buildSql(updates, total) {
  const scope = parksOnly ? 'park/outdoor' : 'activity';
  const header = `-- Generated by scripts/populate-wikimedia-images.js\n-- Wikimedia Commons matches: ${updates.length} of ${total} ${scope} activities searched.\n`;
  if (!updates.length) return `${header}\n-- No credible Wikimedia Commons matches found.\n`;
  return `${header}\nwith image_updates (activity_id, wikimedia_image_url) as (\n  values\n    ${updates.map((item) => `(${sql(item.activity_id)}::uuid, ${sql(item.wikimedia_image_url)}::text)`).join(',\n    ')}\n)\nupdate public.activities as activity\nset wikimedia_image_url = image_updates.wikimedia_image_url,\n    updated_at = now()\nfrom image_updates\nwhere activity.activity_id = image_updates.activity_id\n  and nullif(btrim(activity.wikimedia_image_url), '') is null;\n`;
}

const env = { ...process.env, ...parseEnv(await fs.readFile(path.join(ROOT, '.env.local'), 'utf8')) };
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.');

const activities = await getActivities(env);
const updates = [];
let nextIndex = 0;
async function worker() {
  while (nextIndex < activities.length) {
    const index = nextIndex++;
    const activity = activities[index];
    const imageUrl = await searchWikimedia(activity);
    if (imageUrl) updates.push({ activity_id: activity.activity_id, wikimedia_image_url: imageUrl });
    if ((index + 1) % 100 === 0 || index + 1 === activities.length) console.log(`Checked ${index + 1}/${activities.length}; matched ${updates.length}.`);
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
updates.sort((a, b) => a.activity_id.localeCompare(b.activity_id));
await fs.writeFile(OUTPUT_PATH, buildSql(updates, activities.length));
console.log(`Wrote ${updates.length} Wikimedia image updates to ${path.relative(ROOT, OUTPUT_PATH)}.`);
