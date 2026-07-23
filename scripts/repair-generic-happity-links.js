/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activity_generic_happity_link_repairs.generated.sql');
const outputAudit = join(root, 'data', 'generic_happity_link_repairs.generated.json');

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

function tokens(value) {
  return new Set(normalized(value).split(' ').filter((token) => token.length > 1));
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.replace(/\s/g, '').toUpperCase() || null;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function isGenericHappityUrl(value) {
  return /happity\.co\.uk\/(?!schedules\/)/i.test(String(value || ''));
}

function readSchedules(fileName) {
  const parsed = JSON.parse(readFileSync(join(root, 'data', fileName), 'utf8').replace(/^\uFEFF/, ''));
  const rows = Array.isArray(parsed) ? parsed : parsed.happity || [];
  return rows.filter((row) => row.detailUrl?.includes('happity.co.uk/schedules/'));
}

function score(activity, schedule) {
  const activityName = normalized(activity.activity_name);
  const scheduleName = normalized(schedule.name);
  const activityTokens = tokens(activity.activity_name);
  const scheduleTokens = tokens(schedule.name);
  const intersection = [...activityTokens].filter((token) => scheduleTokens.has(token)).length;
  const nameScore = activityName === scheduleName
    ? 100
    : Math.round((intersection / Math.max(activityTokens.size, scheduleTokens.size, 1)) * 75);
  const activityPostcode = postcode(activity.address);
  const venuePostcode = postcode(schedule.venue);
  const time = String(activity.start_time || '').slice(0, 5);
  const startTime = String(schedule.time || '').split('-')[0];
  return nameScore
    + (activityPostcode && activityPostcode === venuePostcode ? 45 : 0)
    + (time && time === startTime ? 30 : 0);
}

function bestMatch(activity, schedules) {
  const candidates = schedules.map((schedule) => ({ schedule, score: score(activity, schedule) }))
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const runnerUp = candidates[1];
  if (!best || best.score < 115 || (runnerUp && best.score - runnerUp.score < 20)) return null;
  return best.schedule;
}

async function loadActivities(env) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${env.VITE_SUPABASE_URL}/rest/v1/activities?select=activity_id,activity_name,address,start_time,website,source_url&source_name=eq.Happity&limit=1000&offset=${offset}`,
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
    ...readSchedules('happity_waltham_forest_2026.generated.json'),
    ...readSchedules('happity_hackney_islington_newham_2026.generated.json'),
  ];
  const generic = (await loadActivities(env))
    .filter((activity) => isGenericHappityUrl(activity.website) || isGenericHappityUrl(activity.source_url));
  const updates = generic.map((activity) => {
    if (!isGenericHappityUrl(activity.website) && isGenericHappityUrl(activity.source_url)) {
      return { activityId: activity.activity_id, detailUrl: activity.website, activityName: activity.activity_name, method: 'existing-detail-link' };
    }
    const match = bestMatch(activity, schedules);
    return match ? { activityId: activity.activity_id, detailUrl: match.detailUrl, activityName: activity.activity_name, method: 'title-venue-time-match' } : null;
  }).filter(Boolean);
  const resolved = new Set(updates.map((update) => update.activityId));
  const unresolved = generic.filter((activity) => !resolved.has(activity.activity_id));

  const sqlText = updates.length
    ? `with detail_links (activity_id, detail_url) as (\n  values\n    ${updates.map((update) => `(${sql(update.activityId)}::uuid, ${sql(update.detailUrl)}::text)`).join(',\n    ')}\n)\nupdate public.activities as activity\nset\n  website = detail_links.detail_url,\n  updated_at = now()\nfrom detail_links\nwhere activity.activity_id = detail_links.activity_id;\n`
    : '-- No generic Happity links with a verified detail page were found.\n';
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, sqlText);
  writeFileSync(outputAudit, JSON.stringify({ generic_records: generic.length, repaired_records: updates.length, unresolved_records: unresolved.length, updates, unresolved }, null, 2) + '\n');
  console.log(`Generated ${updates.length} verified Happity link repairs; ${unresolved.length} records need a future source refresh.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
