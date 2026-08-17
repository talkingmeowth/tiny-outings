/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'activity_category_audit.generated.json');
const canonicalCategories = new Set([
  'Cafes & food',
  'Play cafes',
  'Baby swim',
  'Parks & outdoor play',
  'Stay & play',
  'Classes & clubs',
  'Movement & wellbeing',
  'Museums & culture',
  'Bookshops',
  'Family activities',
  'Events',
]);

function env() {
  return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').replace(/^\uFEFF/, '')
    .split(/\r?\n/).filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function eventSource(activity) {
  return /eventbrite|fever|loopla/i.test([
    activity.data_source,
    activity.source_name,
    activity.source_url,
  ].filter(Boolean).join(' '));
}

function expectedCategory(activity) {
  if (eventSource(activity)) return 'Events';
  const category = String(activity.category || '').trim().toLowerCase();
  const content = [activity.activity_name, activity.description].filter(Boolean).join(' ').toLowerCase();
  const map = new Map([
    ['cafes & food', 'Cafes & food'], ['child-friendly cafes', 'Cafes & food'], ['child friendly cafe', 'Cafes & food'],
    ['play cafes', 'Play cafes'], ['soft play', 'Play cafes'], ['indoor play', 'Play cafes'],
    ['baby swim', 'Baby swim'], ['baby swimming', 'Baby swim'], ['baby swimming lessons', 'Baby swim'],
    ['parks & outdoor play', 'Parks & outdoor play'], ['park', 'Parks & outdoor play'], ['outdoor play', 'Parks & outdoor play'],
    ['stay & play', 'Stay & play'], ['family hubs', 'Stay & play'], ['family hub', 'Stay & play'], ['parent-and-baby playgroups', 'Stay & play'], ['baby stay and play', 'Stay & play'],
    ['classes & clubs', 'Classes & clubs'], ['music & singing', 'Classes & clubs'], ['baby sensory', 'Classes & clubs'], ['arts & crafts', 'Classes & clubs'], ['story & rhyme time', 'Classes & clubs'], ['baby signing', 'Classes & clubs'], ['developmental play', 'Classes & clubs'],
    ['movement & wellbeing', 'Movement & wellbeing'], ['baby dance & movement', 'Movement & wellbeing'], ['baby yoga', 'Movement & wellbeing'], ['baby massage', 'Movement & wellbeing'], ['postnatal fitness', 'Movement & wellbeing'], ['feeding & postnatal support', 'Movement & wellbeing'],
    ['museums & culture', 'Museums & culture'], ['museum', 'Museums & culture'], ['child friendly museum', 'Museums & culture'],
    ['bookshops', 'Bookshops'],
    ['family activities', 'Family activities'], ['family activity', 'Family activities'], ['baby & toddler cinema', 'Family activities'], ['parent meet-ups', 'Family activities'],
    ['events', 'Events'],
  ]);
  const base = map.get(category) || null;
  if (!['Stay & play', 'Family activities'].includes(base)) return base;

  if (/\b(swim|swimming|water babies|puddle ducks)\b/.test(content)) return 'Baby swim';
  if (/\b(play cafe|soft play|indoor play|playroom)\b/.test(content)) return 'Play cafes';
  if (/\b(cafe|coffee|bakery|restaurant|brasserie|bistro|lunch)\b/.test(content)) return 'Cafes & food';
  if (/\b(park|playground|garden|open space|nature reserve|recreation ground)\b/.test(content)) return 'Parks & outdoor play';
  if (/\b(bookshop|book shop|bookstore|book store)\b/.test(content)) return 'Bookshops';
  if (/\b(museum|culture|gallery|historic house)\b/.test(content)) return 'Museums & culture';
  if (/\b(dance|ballet|yoga|barre|fitness|massage|postnatal|pregnancy|judo|martial arts|movement|feeding|breastfeeding|bottle feeding)\b/.test(content)) return 'Movement & wellbeing';
  if (/\b(pub quiz|parent meet-up|parent meetup|family day)\b/.test(content)) return 'Family activities';
  if (/\b(stay and play|stay & play|playgroup|tots and toys|family hub|parent and baby)\b/.test(content)) return 'Stay & play';
  if (/\b(sensory|story|rhyme|music|singing|signing|drama|craft|art class|adventure babies|class|club)\b/.test(content)) return 'Classes & clubs';
  return base;
}

async function fetchActivities(config) {
  const rows = [];
  const select = 'activity_id,activity_name,category,description,plan_filters,data_source,source_name,source_url,website,public_listing_status,archive';
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select,
      archive: 'eq.false',
      public_listing_status: 'eq.published',
      order: 'activity_id.asc',
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

async function main() {
  const activities = await fetchActivities(env());
  const invalid = activities.map((activity) => ({ activity, expected: expectedCategory(activity) }))
    .filter(({ activity, expected }) => !expected || activity.category !== expected || activity.plan_filters?.length !== 1 || activity.plan_filters[0] !== expected);
  const byCategory = Object.fromEntries([...canonicalCategories].map((category) => [category, 0]));
  for (const activity of activities) byCategory[activity.category] = (byCategory[activity.category] || 0) + 1;

  const audit = {
    generated_at: new Date().toISOString(),
    checked_records: activities.length,
    canonical_categories: [...canonicalCategories],
    by_category: byCategory,
    invalid_records: invalid.map(({ activity, expected }) => ({
      activity_id: activity.activity_id,
      activity_name: activity.activity_name,
      category: activity.category,
      plan_filters: activity.plan_filters,
      expected_category: expected,
    })),
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(audit, null, 2) + '\n');
  if (invalid.length) throw new Error(`Category audit failed for ${invalid.length} activities.`);
  console.log(`PASS: all ${activities.length} active listings use one canonical Plan category.`);
  console.log(JSON.stringify(byCategory, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
