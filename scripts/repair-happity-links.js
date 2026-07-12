/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activity_happity_detail_link_repairs.generated.sql');
const outputAudit = join(root, 'data', 'happity_detail_link_repairs.generated.json');

function readEnv() {
  return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function normalized(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readHappityRows(fileName) {
  const parsed = JSON.parse(readFileSync(join(root, 'data', fileName), 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : parsed.happity || [];
  return rows
    .filter((row) => row.detailUrl?.includes('happity.co.uk/schedules/'))
    .map((row) => ({
      name: normalized(row.name),
      venue: normalized(row.venue),
      venuePostcode: postcode(row.venue),
      detailUrl: row.detailUrl,
    }));
}

function bestMatch(activity, schedules) {
  const name = normalized(activity.activity_name);
  const address = normalized(activity.address);
  const addressPostcode = postcode(activity.address);
  const byName = schedules.filter((schedule) => schedule.name === name);
  if (!byName.length) return null;
  const exactVenue = byName.find((schedule) => schedule.venuePostcode && schedule.venuePostcode === addressPostcode);
  if (exactVenue) return exactVenue;
  const containedVenue = byName.find((schedule) => schedule.venue && (address.includes(schedule.venue) || schedule.venue.includes(address)));
  return containedVenue || (byName.length === 1 ? byName[0] : null);
}

async function loadActivities(env) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${env.VITE_SUPABASE_URL}/rest/v1/activities?select=activity_id,activity_name,address,website,source_url&source_name=eq.Happity&limit=1000&offset=${offset}`,
      { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } },
    );
    if (!response.ok) throw new Error(`Could not load Happity activities: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function main() {
  const env = readEnv();
  const schedules = [
    ...readHappityRows('happity_waltham_forest_2026.generated.json'),
    ...readHappityRows('happity_hackney_islington_newham_2026.generated.json'),
  ];
  const activities = await loadActivities(env);
  const updates = activities
    .filter((activity) => !String(activity.website || '').includes('happity.co.uk/schedules/'))
    .map((activity) => ({ activity, match: bestMatch(activity, schedules) }))
    .filter((item) => item.match)
    .map(({ activity, match }) => ({ activityId: activity.activity_id, detailUrl: match.detailUrl, activityName: activity.activity_name }));

  const sqlText = updates.length
    ? `with detail_links (activity_id, detail_url) as (\n  values\n    ${updates.map((item) => `(${sql(item.activityId)}::uuid, ${sql(item.detailUrl)}::text)`).join(',\n    ')}\n)\nupdate public.activities as activity\nset website = detail_links.detail_url, updated_at = now()\nfrom detail_links\nwhere activity.activity_id = detail_links.activity_id;\n`
    : '-- No Happity detail-link repairs were found.\n';
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, sqlText);
  writeFileSync(outputAudit, JSON.stringify({ schedule_rows: schedules.length, repaired_records: updates.length, updates }, null, 2) + '\n');
  console.log(`Generated ${updates.length} Happity detail-link repairs.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
