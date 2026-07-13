/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'activity_plan_filter_audit.generated.json');

function readEnv() {
  return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function expectedFilter(activity) {
  if (['eventbrite', 'fever'].includes(activity.data_source)) return 'Events';
  const groups = {
    'Baby classes': ['Baby yoga', 'Baby massage', 'Baby sensory', 'Music & singing', 'Baby signing', 'Baby swimming', 'Postnatal fitness', 'Baby dance & movement', 'Developmental play'],
    'Play & learn': ['Stay & play', 'Story & rhyme time', 'Arts & crafts', 'Soft play', 'Family hubs'],
    'Food & socials': ['Child-friendly cafes', 'Bookshops', 'Parent meet-ups', 'Feeding & postnatal support'],
    Parks: ['Parks & outdoor play'],
    'Days out': ['Museums & culture', 'Baby & toddler cinema', 'Family activities'],
  };
  return Object.entries(groups).find(([, categories]) => categories.includes(activity.category))?.[0] || 'Days out';
}

async function fetchActivities(config) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({ select: 'activity_id,activity_name,category,data_source,plan_filters,public_listing_status', order: 'activity_id.asc', limit: '1000', offset: String(offset) });
    const response = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/activities?${params}`, {
      headers: { apikey: config.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${config.VITE_SUPABASE_ANON_KEY}` },
    });
    if (!response.ok) throw new Error(`Could not load activity filters: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function main() {
  const activities = await fetchActivities(readEnv());
  const invalid = activities.filter((activity) => {
    const actual = Array.isArray(activity.plan_filters) ? activity.plan_filters : [];
    return actual.length !== 1 || actual[0] !== expectedFilter(activity);
  });
  const byFilter = activities.reduce((result, activity) => {
    const filter = activity.plan_filters?.[0] || 'Missing';
    result[filter] = (result[filter] || 0) + 1;
    return result;
  }, {});
  const audit = { generated_at: new Date().toISOString(), checked_records: activities.length, by_filter: byFilter, invalid_records: invalid };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(audit, null, 2) + '\n');
  if (invalid.length) throw new Error(`Plan filter audit failed for ${invalid.length} activities.`);
  console.log(`PASS: all ${activities.length} activity records have one correct plan filter.`);
  console.log(JSON.stringify(byFilter, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
