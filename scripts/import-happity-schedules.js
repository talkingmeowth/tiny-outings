/* global process */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activities_happity_schedules.generated.sql');
const outputAudit = join(root, 'data', 'happity_schedule_import.generated.json');
const defaultFiles = [
  'data/happity_waltham_forest_2026.generated.json',
  'data/happity_hackney_islington_newham_2026.generated.json',
  'data/happity_manual_schedules.json',
];

function readEnv() {
  const path = join(root, '.env.local');
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function canonicalUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function plainName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-zA-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function weekday(value) {
  const day = String(value || '').trim().replace(/s$/i, '');
  return day ? day.charAt(0).toUpperCase() + day.slice(1).toLowerCase() : null;
}

function parseTimeRange(value, fallbackStart, fallbackEnd) {
  const match = String(value || '').match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
  return { start: match?.[1] || fallbackStart || null, end: match?.[2] || fallbackEnd || null };
}

function extractRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.happity)) return parsed.happity;
  return [];
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null;
}

function boroughFor(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('waltham')) return 'Waltham Forest';
  if (text.includes('hackney')) return 'Hackney';
  if (text.includes('islington')) return 'Islington';
  if (text.includes('newham') || text.includes('stratford')) return 'Newham';
  return 'London';
}

function normalizedRow(row) {
  const { start, end } = parseTimeRange(row.time, row.start, row.end);
  const days = [...new Set([...(row.days || []), row.day].map(weekday).filter(Boolean))];
  const sourceUrl = row.detailUrl || row.sourceUrl;
  if (!sourceUrl || !start || !end || !days.length) return null;
  const venue = row.venue || row.address || '';
  return {
    sourceUrl,
    activityName: plainName(row.name),
    address: venue,
    postcode: postcode(venue),
    borough: row.borough || boroughFor(row.area || venue),
    category: row.category || 'Baby classes',
    start,
    end,
    days,
    age: row.age || null,
    availability: row.availability || 'Weekly schedule; check Happity for term dates and holiday changes.',
    cost: row.cost || 'Check Happity',
    description: row.description || null,
    imageUrl: row.image || row.imageUrl || null,
    lat: Number.isFinite(Number(row.lat)) ? Number(row.lat) : null,
    long: Number.isFinite(Number(row.long)) ? Number(row.long) : null,
    googlePlaceId: row.googlePlaceId || null,
    googlePlaceUri: row.googlePlaceUri || null,
    website: row.website || sourceUrl,
  };
}

function sql(value) {
  if (value == null) return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function textArray(values) {
  return `array[${values.map(sql).join(', ')}]`;
}

function loadSchedules() {
  const additional = process.env.HAPPITY_SCHEDULE_FILE ? [resolve(root, process.env.HAPPITY_SCHEDULE_FILE)] : [];
  const files = [...defaultFiles.map((file) => join(root, file)), ...additional];
  const byUrl = new Map();
  for (const file of files) {
    if (!existsSync(file)) continue;
    const rows = extractRows(JSON.parse(readFileSync(file, 'utf8')));
    for (const raw of rows) {
      const row = normalizedRow(raw);
      if (row) byUrl.set(canonicalUrl(row.sourceUrl), row);
    }
  }
  return { files, schedules: [...byUrl.values()] };
}

async function loadExistingActivities(env) {
  const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required to audit Happity schedules.');
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${url}/rest/v1/activities?select=activity_id,source_url,website,google_photo_url,image_url,lat,long&data_source=eq.happity&limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw new Error(`Could not load Happity records: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function updateTuple(schedule) {
  return `(${sql(schedule.sourceUrl)}, ${sql(schedule.start)}::time, ${sql(schedule.end)}::time, ${textArray(schedule.days)}, ${sql(schedule.availability)}, ${sql(schedule.age)}, ${sql(schedule.cost)}, ${sql(schedule.description)}, ${sql(schedule.imageUrl)})`;
}

function insertTuple(schedule) {
  return `(${sql(schedule.activityName)}, ${sql(schedule.address)}, ${sql(schedule.postcode)}, ${schedule.lat}, ${schedule.long}, ${sql(schedule.category)}, ${sql(schedule.start)}::time, ${sql(schedule.end)}::time, ${sql(schedule.googlePlaceUri)}, ${sql(schedule.website)}, ${sql(schedule.age)}, ${sql(schedule.borough)}, ${textArray(schedule.days)}, ${sql(schedule.availability)}, ${sql(schedule.description)}, ${sql(schedule.cost)}, ${sql('Happity schedules')}, ${sql(schedule.sourceUrl)}, ${sql(schedule.imageUrl)}, ${sql(schedule.sourceUrl)}, ${sql(schedule.googlePlaceId)}, ${sql(schedule.googlePlaceUri)}, ${textArray(schedule.days)})`;
}

async function main() {
  const env = readEnv();
  const { files, schedules } = loadSchedules();
  const existing = await loadExistingActivities(env);
  const existingByUrl = new Map(existing.map((row) => [canonicalUrl(row.source_url), row]));
  const matched = schedules.filter((schedule) => existingByUrl.has(canonicalUrl(schedule.sourceUrl)));
  const newSchedules = schedules.filter((schedule) => !existingByUrl.has(canonicalUrl(schedule.sourceUrl)));
  const safeInserts = newSchedules.filter((schedule) => schedule.lat != null && schedule.long != null);
  const awaitingLocation = newSchedules.filter((schedule) => schedule.lat == null || schedule.long == null);
  const snapshotUrls = new Set(schedules.map((schedule) => canonicalUrl(schedule.sourceUrl)));
  const databaseOnly = existing.filter((activity) => !snapshotUrls.has(canonicalUrl(activity.source_url)));

  const updateSql = matched.length
    ? `with schedule_updates (source_url, start_time, end_time, days, availability_notes, age_suitability, cost, description, image_url) as (\n  values\n    ${matched.map(updateTuple).join(',\n    ')}\n)\nupdate public.activities as activity\nset\n  start_time = schedule_updates.start_time,\n  end_time = schedule_updates.end_time,\n  days_of_week = schedule_updates.days,\n  available_days_of_week = schedule_updates.days,\n  availability_type = 'weekly',\n  availability_notes = schedule_updates.availability_notes,\n  schedule_notes = schedule_updates.availability_notes,\n  age_suitability = coalesce(schedule_updates.age_suitability, activity.age_suitability),\n  cost = coalesce(schedule_updates.cost, activity.cost),\n  description = coalesce(schedule_updates.description, activity.description),\n  website = schedule_updates.source_url,\n  image_url = coalesce(activity.google_photo_url, activity.image_url, schedule_updates.image_url),\n  image_source_url = case when activity.google_photo_url is null and activity.image_url is null then schedule_updates.source_url else activity.image_source_url end,\n  updated_at = now()\nfrom schedule_updates\nwhere lower(trim(trailing '/' from activity.source_url)) = lower(trim(trailing '/' from schedule_updates.source_url));\n`
    : '-- No matching Happity schedules were found to refresh.\n';
  const insertSql = safeInserts.length
    ? `\ninsert into public.activities (activity_name, address, postcode, lat, long, category, start_time, end_time, google_link, website, age_suitability, borough, days_of_week, schedule_notes, description, cost, source_name, source_url, image_url, image_source_url, google_place_id, google_place_uri, available_days_of_week)\nvalues\n  ${safeInserts.map(insertTuple).join(',\n  ')}\non conflict (source_url) do update set\n  start_time = excluded.start_time,\n  end_time = excluded.end_time,\n  days_of_week = excluded.days_of_week,\n  available_days_of_week = excluded.available_days_of_week,\n  availability_type = 'weekly',\n  availability_notes = excluded.schedule_notes,\n  schedule_notes = excluded.schedule_notes,\n  website = excluded.website,\n  updated_at = now();\n`
    : '';

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, `-- Generated by scripts/import-happity-schedules.js\n-- Happity blocks automated page requests; this job refreshes every harvested schedule snapshot and reports schedules awaiting verified coordinates.\n\n${updateSql}${insertSql}`);
  writeFileSync(outputAudit, JSON.stringify({
    generated_at: new Date().toISOString(),
    source_files: files.map((file) => file.replace(root + '\\', '')),
    schedules_found: schedules.length,
    existing_happity_records: existing.length,
    matched_and_refreshed: matched.length,
    safe_new_records: safeInserts.length,
    awaiting_location_enrichment: awaitingLocation.length,
    database_records_not_in_current_snapshot: databaseOnly.length,
    missing_location_records: awaitingLocation.map((schedule) => ({ name: schedule.activityName, source_url: schedule.sourceUrl, venue: schedule.address })),
    database_only_records: databaseOnly.map((activity) => ({ activity_id: activity.activity_id, source_url: activity.source_url })),
  }, null, 2) + '\n');
  console.log(`Happity schedules: ${schedules.length}; refreshed: ${matched.length}; new with verified locations: ${safeInserts.length}; awaiting location: ${awaitingLocation.length}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
