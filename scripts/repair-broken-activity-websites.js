/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const auditPath = join(root, 'data', 'activity_card_readiness_audit.generated.json');
const outputSqlPath = join(root, 'supabase', 'seed', 'activity_website_repairs.generated.sql');
const outputAuditPath = join(root, 'data', 'activity_website_repairs.generated.json');

function readEnv() {
  return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function isHttp(value) {
  try {
    return ['http:', 'https:'].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

function sql(value) {
  return value == null ? 'null' : `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

async function fetchActivities(config) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select: 'activity_id,activity_name,data_source,website,source_url,google_link,google_place_id,google_place_uri',
      public_listing_status: 'eq.published',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/activities?${params}`, {
      headers: { apikey: config.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${config.VITE_SUPABASE_ANON_KEY}` },
    });
    if (!response.ok) throw new Error(`Could not load activities: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function placeDetails(placeId, apiKey) {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=websiteUri,googleMapsUri,businessStatus&key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) return null;
  const place = await response.json();
  return place.businessStatus === 'CLOSED_PERMANENTLY' ? null : place;
}

async function main() {
  const config = readEnv();
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || config.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('A Google Places API key is required to repair website links.');
  const brokenUrls = new Set(JSON.parse(readFileSync(auditPath, 'utf8')).network?.broken_websites || []);
  const activities = (await fetchActivities(config)).filter((activity) => brokenUrls.has(activity.website || activity.source_url || activity.google_place_uri) && activity.google_place_id);
  const updates = [];
  for (const activity of activities) {
    const place = await placeDetails(activity.google_place_id, apiKey);
    if (!place) continue;
    const replacement = isHttp(place.websiteUri) ? place.websiteUri : place.googleMapsUri;
    if (!replacement || replacement === activity.website) continue;
    updates.push({ activityId: activity.activity_id, activityName: activity.activity_name, website: replacement, googlePlaceUri: place.googleMapsUri || activity.google_place_uri || activity.google_link });
  }
  const sqlText = updates.length
    ? `with website_repairs (activity_id, website, google_place_uri) as (\n  values\n    ${updates.map((item) => `(${sql(item.activityId)}::uuid, ${sql(item.website)}, ${sql(item.googlePlaceUri)})`).join(',\n    ')}\n)\nupdate public.activities as activity\nset\n  website = website_repairs.website,\n  google_place_uri = coalesce(website_repairs.google_place_uri, activity.google_place_uri),\n  google_link = coalesce(website_repairs.google_place_uri, activity.google_link),\n  updated_at = now()\nfrom website_repairs\nwhere activity.activity_id = website_repairs.activity_id;\n`
    : '-- No Google Places website repairs were found.\n';
  mkdirSync(dirname(outputSqlPath), { recursive: true });
  writeFileSync(outputSqlPath, sqlText);
  writeFileSync(outputAuditPath, JSON.stringify({ generated_at: new Date().toISOString(), broken_urls_checked: brokenUrls.size, repairs: updates }, null, 2) + '\n');
  console.log(`Checked ${activities.length} broken website records; generated ${updates.length} website repairs.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
