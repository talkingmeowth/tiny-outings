/* global process */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cachePath = join(root, 'data', 'happity_openstreetmap_geocode_cache.generated.json');
const auditPath = join(root, 'data', 'happity_location_audit.generated.json');
const sqlPath = join(root, 'supabase', 'seed', 'activity_happity_location_audit_updates.generated.sql');
const requestedLimit = Number(process.argv.find((argument) => argument.startsWith('--limit='))?.split('=')[1] || 0);

function readEnv() {
  return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').replace(/^\uFEFF/, '')
    .split(/\r?\n/).filter((line) => line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fullPostcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.replace(/\s/g, '').toUpperCase() || null;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function distanceMeters(left, right) {
  const rad = Math.PI / 180;
  const lat = (right.lat - left.lat) * rad;
  const lon = (right.long - left.long) * rad;
  const a = Math.sin(lat / 2) ** 2 + Math.cos(left.lat * rad) * Math.cos(right.lat * rad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadActivities(env) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${env.VITE_SUPABASE_URL}/rest/v1/activities?select=activity_id,address,lat,long&source_name=eq.Happity&limit=1000&offset=${offset}`,
      { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } },
    );
    if (!response.ok) throw new Error(`Could not load Happity activities: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function geocode(address, cache) {
  const key = normalized(address);
  if (key in cache) return cache[key];
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(`${address}, United Kingdom`)}`, {
    headers: { 'User-Agent': 'TinyOutings/1.0 (location-audit)' },
  });
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  const expectedPostcode = fullPostcode(address);
  const candidates = await response.json();
  const match = candidates.find((candidate) => expectedPostcode && fullPostcode(candidate.display_name) === expectedPostcode) || null;
  cache[key] = match ? { lat: Number(match.lat), long: Number(match.lon), display_name: match.display_name } : null;
  return cache[key];
}

function createSql(updates) {
  if (!updates.length) return '-- No verified Happity location corrections found.\n';
  return `with location_updates (activity_id, lat, long, google_link) as (\n  values\n    ${updates.map((row) => `(${sql(row.activityId)}::uuid, ${row.lat}::numeric, ${row.long}::numeric, ${sql(row.googleLink)}::text)`).join(',\n    ')}\n)\nupdate public.activities as activity\nset\n  lat = location_updates.lat,\n  long = location_updates.long,\n  google_link = location_updates.google_link,\n  google_place_uri = location_updates.google_link,\n  google_place_id = null,\n  updated_at = now()\nfrom location_updates\nwhere activity.activity_id = location_updates.activity_id;\n`;
}

async function main() {
  const env = readEnv();
  const activities = await loadActivities(env);
  const groups = [...new Map(activities.filter((activity) => fullPostcode(activity.address))
    .map((activity) => [normalized(activity.address), activity])).values()];
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const selected = groups.filter((group) => !(normalized(group.address) in cache)).slice(0, requestedLimit || undefined);
  console.log(`Checking ${selected.length} Happity venue addresses (${groups.length - selected.length} cached or skipped).`);
  for (let index = 0; index < selected.length; index += 1) {
    await geocode(selected[index].address, cache);
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    console.log(`${index + 1}/${selected.length} ${selected[index].address}`);
    if (index < selected.length - 1) await sleep(1100);
  }
  const updates = activities.flatMap((activity) => {
    const result = cache[normalized(activity.address)];
    if (!result || !Number.isFinite(activity.lat) || !Number.isFinite(activity.long)) return [];
    const distance = distanceMeters(activity, result);
    if (distance < 35) return [];
    return [{ activityId: activity.activity_id, address: activity.address, lat: result.lat, long: result.long, distance, googleLink: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.address)}` }];
  });
  mkdirSync(dirname(auditPath), { recursive: true });
  writeFileSync(auditPath, JSON.stringify({ checked_addresses: Object.keys(cache).length, corrected_records: updates.length, updates }, null, 2) + '\n');
  writeFileSync(sqlPath, createSql(updates));
  console.log(`Generated ${updates.length} verified location corrections.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
