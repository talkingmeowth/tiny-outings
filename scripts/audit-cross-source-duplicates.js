/*
 * Finds the same public activity imported through different directories.
 * Matches require a strong title match and the same postcode or venue, then
 * archive the redundant record while preserving its activity history.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const AUDIT_PATH = path.join(ROOT, 'data', 'cross_source_duplicate_audit.generated.json');
const SQL_PATH = path.join(ROOT, 'supabase', 'seed', 'activity_cross_source_duplicate_consolidation.generated.sql');

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
  }));
}

function normalise(value = '') {
  return String(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

const ignoredTitleTokens = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to', 'with', 'london', 'family', 'kids', 'kid', 'child', 'children', 'activity', 'activities']);
const ignoredVenueTokens = new Set(['london', 'uk', 'road', 'rd', 'street', 'st', 'place', 'the', 'and']);

function tokens(value, ignored) {
  return [...new Set(normalise(value).split(' ').filter((token) => token.length > 1 && !ignored.has(token)))];
}

function similarity(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.max(1, new Set([...a, ...b]).size);
}

function postcode(activity) {
  const match = String(activity.postcode || activity.address || '').toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
  return match ? match[0].replace(/\s/g, '') : null;
}

function distanceKm(left, right) {
  if (left.lat == null || left.long == null || right.lat == null || right.long == null) return null;
  const radians = (value) => Number(value) * Math.PI / 180;
  const latitudeDelta = radians(Number(right.lat) - Number(left.lat));
  const longitudeDelta = radians(Number(right.long) - Number(left.long));
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sourceLabel(activity) {
  const value = `${activity.data_source || ''} ${activity.source_name || ''} ${activity.source_url || ''}`.toLowerCase();
  if (value.includes('loopla')) return 'loopla';
  if (value.includes('fever')) return 'fever';
  if (value.includes('happity')) return 'happity';
  if (value.includes('eventbrite')) return 'eventbrite';
  if (value.includes('timeout')) return 'time_out';
  if (value.includes('google')) return 'google_places';
  if (value.includes('better start') || value.includes('best start')) return 'better_start';
  return normalise(activity.data_source || activity.source_name || 'other');
}

function qualityScore(activity) {
  const source = sourceLabel(activity);
  return (postcode(activity) ? 5 : 0)
    + (activity.image_url ? 3 : 0)
    + Math.min(4, Math.floor(String(activity.description || '').length / 220))
    + (activity.website ? 2 : 0)
    + (activity.start_time && activity.end_time ? 1 : 0)
    + (['loopla', 'happity', 'better_start'].includes(source) ? 1 : 0);
}

async function fetchActivities(env) {
  const rows = [];
  const select = 'activity_id,activity_name,address,postcode,borough,category,start_time,end_time,activity_date,available_dates,availability_start_date,availability_end_date,days_of_week,available_days_of_week,availability_type,source_name,data_source,source_url,website,description,image_url,lat,long,public_listing_status';
  for (let offset = 0; ; offset += 1000) {
    const url = new URL('/rest/v1/activities', env.VITE_SUPABASE_URL);
    url.searchParams.set('select', select);
    url.searchParams.set('public_listing_status', 'eq.published');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } });
    if (!response.ok) throw new Error(`Supabase fetch failed: ${response.status}`);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

function canMatch(left, right) {
  if (sourceLabel(left) === sourceLabel(right)) return false;
  const titleScore = similarity(tokens(left.activity_name, ignoredTitleTokens), tokens(right.activity_name, ignoredTitleTokens));
  if (titleScore < 0.72) return false;
  const leftPostcode = postcode(left);
  const rightPostcode = postcode(right);
  if (leftPostcode && rightPostcode && leftPostcode === rightPostcode) return true;
  const distance = distanceKm(left, right);
  if (distance != null && distance <= 0.35) return true;
  const venueScore = similarity(tokens(left.address, ignoredVenueTokens), tokens(right.address, ignoredVenueTokens));
  return venueScore >= 0.58;
}

function sql(value) {
  return value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
}

function makeGroups(activities) {
  const parent = activities.map((_, index) => index);
  function find(index) {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  }
  function join(left, right) {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  }

  for (let left = 0; left < activities.length; left += 1) {
    for (let right = left + 1; right < activities.length; right += 1) {
      if (canMatch(activities[left], activities[right])) join(left, right);
    }
  }

  const groups = new Map();
  activities.forEach((activity, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), activity]);
  });
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const ordered = [...group].sort((left, right) => qualityScore(right) - qualityScore(left) || left.activity_id.localeCompare(right.activity_id));
      return { keeper: ordered[0], duplicates: ordered.slice(1) };
    });
}

function buildSql(groups, total) {
  const header = `-- Generated by scripts/audit-cross-source-duplicates.js\n-- Cross-source duplicate groups: ${groups.length}; archived records: ${groups.reduce((count, group) => count + group.duplicates.length, 0)} of ${total} published activities.\n`;
  if (!groups.length) return `${header}\n-- No confident cross-source duplicates found.\n`;
  const tuples = groups.map(({ keeper, duplicates }) => `(${sql(keeper.activity_id)}::uuid, array[${duplicates.map((item) => `${sql(item.activity_id)}::uuid`).join(', ')}])`);
  return `${header}\nbegin;\n\nwith duplicate_groups (keeper_id, duplicate_ids) as (\n  values\n    ${tuples.join(',\n    ')}\n), merged as (\n  select\n    groups.keeper_id,\n    groups.duplicate_ids,\n    min(activity.start_time) as start_time,\n    max(activity.end_time) as end_time,\n    min(activity.availability_start_date) as availability_start_date,\n    max(activity.availability_end_date) as availability_end_date,\n    coalesce((\n      select array_agg(distinct date_value order by date_value)\n      from public.activities source\n      cross join lateral unnest(coalesce(source.available_dates, '{}'::date[])) as date_value\n      where source.activity_id = any(array_append(groups.duplicate_ids, groups.keeper_id))\n    ), '{}'::date[]) as available_dates\n  from duplicate_groups groups\n  join public.activities activity on activity.activity_id = any(array_append(groups.duplicate_ids, groups.keeper_id))\n  group by groups.keeper_id, groups.duplicate_ids\n)\nupdate public.activities activity\nset\n  start_time = merged.start_time,\n  end_time = merged.end_time,\n  availability_start_date = merged.availability_start_date,\n  availability_end_date = merged.availability_end_date,\n  available_dates = merged.available_dates,\n  schedule_notes = concat_ws(' ', activity.schedule_notes, 'Duplicate source listings consolidated.'),\n  updated_at = now()\nfrom merged\nwhere activity.activity_id = merged.keeper_id;\n\nwith duplicate_groups (keeper_id, duplicate_ids) as (\n  values\n    ${tuples.join(',\n    ')}\n)\nupdate public.activities activity\nset public_listing_status = 'archived', updated_at = now()\nfrom duplicate_groups groups\nwhere activity.activity_id = any(groups.duplicate_ids)\n  and activity.public_listing_status = 'published';\n\ncommit;\n`;
}

const env = { ...process.env, ...parseEnv(await fs.readFile(path.join(ROOT, '.env.local'), 'utf8')) };
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.');
const activities = await fetchActivities(env);
const groups = makeGroups(activities);
const audit = groups.map(({ keeper, duplicates }) => ({
  keeper: { activity_id: keeper.activity_id, activity_name: keeper.activity_name, address: keeper.address, source: sourceLabel(keeper) },
  duplicates: duplicates.map((item) => ({ activity_id: item.activity_id, activity_name: item.activity_name, address: item.address, source: sourceLabel(item) })),
}));
await fs.writeFile(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`);
await fs.writeFile(SQL_PATH, buildSql(groups, activities.length));
console.log(`Audited ${activities.length} published activities. Found ${groups.length} cross-source duplicate groups and ${groups.reduce((count, group) => count + group.duplicates.length, 0)} redundant records.`);
