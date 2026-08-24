/*
 * Uses OpenStreetMap's explicitly tagged Wikimedia media to enrich activity
 * cards. Matches are name-and-location based; it never assigns search results.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { allowsWikimediaImages } from '../src/wikimediaImagePolicy.js';

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'supabase', 'seed', 'activity_osm_wikimedia_image_updates.generated.sql');
const BBOX = '51.20,-0.70,51.80,0.40'; // Greater London: south, west, north, east.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const REQUEST_DELAY_MS = 150;

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
  }));
}

function normalise(value = '') {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function nameVariants(value = '') {
  const raw = normalise(value);
  const trimmed = raw.replace(/\b(play areas?|playground|splash pad|adventure playground|woodland playground|picnic field|lakes?)\b.*$/, '').trim();
  return [...new Set([raw, trimmed].filter((name) => name.length >= 5))];
}

function distanceMetres(first, second) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 6_371_000;
  const dLat = toRadians(second.lat - first.lat);
  const dLon = toRadians(second.lon - first.lon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(first.lat)) * Math.cos(toRadians(second.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function filenameFromMediaTag(value) {
  if (!value) return null;
  if (/^File:/i.test(value)) return value.replace(/^File:/i, '').trim();
  if (!/upload\.wikimedia\.org\/wikipedia\/commons/i.test(value)) return null;
  const parts = new URL(value).pathname.split('/').filter(Boolean);
  const thumbIndex = parts.indexOf('thumb');
  return decodeURIComponent(thumbIndex >= 0 ? parts.at(-2) : parts.at(-1));
}

function usableFileTitle(title = '') {
  const value = normalise(title);
  return !/file type icons?|fileicon| icon | logo | flag | poster|illustration| ogg | mp3 | webm /.test(` ${value} `);
}

async function fetchActivities(env) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL('/rest/v1/activities', env.VITE_SUPABASE_URL);
    url.searchParams.set('select', 'activity_id,activity_name,category,lat,long');
    url.searchParams.set('wikimedia_image_url', 'is.null');
    url.searchParams.set('lat', 'gte.51.20');
    url.searchParams.set('lat', 'lte.51.80');
    url.searchParams.set('long', 'gte.-0.70');
    url.searchParams.set('long', 'lte.0.40');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } });
    if (!response.ok) throw new Error(`Supabase activity fetch failed: ${response.status}`);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < 1000) return rows.filter(allowsWikimediaImages);
  }
}

async function fetchOsmFeatures() {
  const query = `[out:json][timeout:120];(nwr["wikimedia_commons"](${BBOX});nwr["image"~"wikimedia.org|commons.wikimedia.org"](${BBOX}););out center tags;`;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'TinyOutingsOSMEnrichment/1.0 (support@tinyoutings.app)' },
      body: query,
      signal: AbortSignal.timeout(180_000),
    }).catch(() => null);
    if (response?.ok) return response.json();
  }
  throw new Error('No configured Overpass endpoint returned a response.');
}

async function commonsRequest(params) {
  const url = new URL(COMMONS_API);
  Object.entries({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...params })
    .forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { 'User-Agent': 'TinyOutingsOSMEnrichment/1.0 (support@tinyoutings.app)' } }).catch(() => null);
  return response?.ok ? response.json() : null;
}

async function resolveCommonsImage(tags) {
  const commonsTag = tags.wikimedia_commons;
  const directFile = filenameFromMediaTag(commonsTag) || filenameFromMediaTag(tags.image);
  if (directFile) {
    const payload = await commonsRequest({ titles: `File:${directFile}`, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '640' });
    return payload?.query?.pages?.[0]?.imageinfo?.[0]?.thumburl || null;
  }
  if (!/^Category:/i.test(commonsTag || '')) return null;
  const category = await commonsRequest({ list: 'categorymembers', cmtitle: commonsTag, cmtype: 'file', cmlimit: '20' });
  const member = (category?.query?.categorymembers || []).find((item) => usableFileTitle(item.title));
  if (!member) return null;
  const payload = await commonsRequest({ titles: member.title, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '640' });
  return payload?.query?.pages?.[0]?.imageinfo?.[0]?.thumburl || null;
}

function matchedFeature(activity, features, activityNameCounts) {
  // A repeated chain name cannot safely identify a particular branch from OSM
  // alone (for example, several Waterstones locations in central London).
  if ((activityNameCounts.get(normalise(activity.activity_name)) || 0) > 1) return null;
  const activityNames = nameVariants(activity.activity_name);
  return features
    .map((feature) => ({ feature, distance: distanceMetres({ lat: Number(activity.lat), lon: Number(activity.long) }, feature) }))
    .filter(({ feature, distance }) => distance <= 1_500 && activityNames.some((activityName) => feature.names.some((featureName) => (
      featureName === activityName || (activityName.length >= 8 && featureName.includes(activityName))
    ))))
    .sort((left, right) => left.distance - right.distance)[0]?.feature || null;
}

const env = { ...process.env, ...parseEnv(await fs.readFile(path.join(ROOT, '.env.local'), 'utf8')) };
const activities = await fetchActivities(env);
const activityNameCounts = new Map();
for (const activity of activities) {
  const name = normalise(activity.activity_name);
  activityNameCounts.set(name, (activityNameCounts.get(name) || 0) + 1);
}
const osm = await fetchOsmFeatures();
const features = (osm.elements || []).flatMap((element) => {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const tags = element.tags || {};
  const names = [tags.name, tags.alt_name, tags.official_name].filter(Boolean).map(normalise);
  return Number.isFinite(lat) && Number.isFinite(lon) && names.length && (tags.wikimedia_commons || tags.image)
    ? [{ lat, lon, names, tags }]
    : [];
});

const updates = [];
for (const [index, activity] of activities.entries()) {
  const feature = matchedFeature(activity, features, activityNameCounts);
  if (feature) {
    const imageUrl = await resolveCommonsImage(feature.tags).catch(() => null);
    if (imageUrl) updates.push({ activity_id: activity.activity_id, wikimedia_image_url: imageUrl });
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }
  if ((index + 1) % 250 === 0 || index + 1 === activities.length) console.log(`Checked ${index + 1}/${activities.length}; matched ${updates.length}.`);
}

const header = `-- Generated by scripts/enrich-wikimedia-from-osm.js\n-- Exact OSM name-and-location matches: ${updates.length} of ${activities.length} London activities searched.\n`;
const body = updates.length
  ? `with image_updates (activity_id, wikimedia_image_url) as (values\n  ${updates.map((item) => `(${sql(item.activity_id)}::uuid, ${sql(item.wikimedia_image_url)}::text)`).join(',\n  ')}\n)\nupdate public.activities as activity\nset wikimedia_image_url = image_updates.wikimedia_image_url, updated_at = now()\nfrom image_updates\nwhere activity.activity_id = image_updates.activity_id\n  and nullif(btrim(activity.wikimedia_image_url), '') is null;\n`
  : '-- No exact OSM/Wikimedia matches found.\n';
await fs.writeFile(OUTPUT_PATH, header + body);
console.log(`Wrote ${updates.length} updates to ${path.relative(ROOT, OUTPUT_PATH)}.`);
