/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'fever_availability_updates.generated.sql');
const outputAudit = join(root, 'data', 'fever_availability_updates.generated.json');
const weekdayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function readDotEnv(name) {
  try {
    return Object.fromEntries(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, '')
      .split(/\r?\n/).filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      }));
  } catch {
    return {};
  }
}

const localEnv = readDotEnv('.env.local');
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;

function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlDateArray(values) {
  return values.length ? `array[${values.map(sql).join(', ')}]::date[]` : "'{}'::date[]";
}

function sqlTextArray(values) {
  return values.length ? `array[${values.map(sql).join(', ')}]::text[]` : "'{}'::text[]";
}

function toTwentyFourHour(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (match[3].toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (match[3].toLowerCase() === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function weekdaysBetween(first, last) {
  const start = weekdayOrder.indexOf(first);
  const end = weekdayOrder.indexOf(last || first);
  return start === -1 || end === -1 ? [] : weekdayOrder.slice(start, end + 1);
}

function weeklyHours(html) {
  const text = cleanText(html).replaceAll('–', '-').replaceAll('—', '-');
  const section = text.match(/Time:\s*([\s\S]*?)(?=Duration:|Location:|Age requirement:|Accessibility:|Description:|$)/i)?.[1] || '';
  const pattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*-\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?(?:\s*&\s*Public Holidays)?\s*:\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/gi;
  const periods = [];
  for (const match of section.matchAll(pattern)) {
    const start = toTwentyFourHour(match[3]);
    const end = toTwentyFourHour(match[4]);
    if (start && end) periods.push({ days: weekdaysBetween(match[1], match[2]), start, end, label: match[0].trim() });
  }
  const days = [...new Set(periods.flatMap((period) => period.days))];
  return {
    days,
    start: periods.length ? periods.map((period) => period.start).sort()[0] : null,
    end: periods.length ? periods.map((period) => period.end).sort().at(-1) : null,
    type: !periods.length ? 'unknown' : days.length === 7 ? 'daily' : 'weekly',
    notes: periods.length ? `Fever opening hours: ${periods.map((period) => period.label).join(' | ')}` : null,
  };
}

function calendarDates(html) {
  const today = new Date().toISOString().slice(0, 10);
  const latest = new Date();
  latest.setFullYear(latest.getFullYear() + 1);
  const latestDate = latest.toISOString().slice(0, 10);
  return [...new Set([...String(html || '').matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map((match) => match[0]))]
    .filter((date) => date >= today && date <= latestDate)
    .sort();
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TinyOutings/1.0)', Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Fever returned ${response.status}`);
  return response.text();
}

async function feverActivities() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration.');
  const response = await fetch(`${supabaseUrl}/rest/v1/activities?select=activity_id,activity_name,source_url&data_source=eq.fever&public_listing_status=eq.published&order=activity_name.asc`, {
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
  return response.json();
}

function buildSql(updates) {
  const values = updates.map((item) => `(${sql(item.activity_id)}::uuid, ${sql(item.start_time || '09:00')}::time, ${sql(item.end_time || '17:00')}::time, ${sqlTextArray(item.days)}, ${sql(item.schedule_notes)}::text, ${sqlDateArray(item.dates)}, ${sql(item.dates[0])}::date, ${sql(item.dates.at(-1))}::date, ${sql(item.dates.length ? 'specific_dates' : item.hours_type)}::text, ${sql(item.availability_notes)}::text)`).join(',\n    ');
  return `-- Generated by scripts/enrich-fever-availability.js from current Fever listing pages.\n-- Fever records are retained; only confirmed calendar dates or published weekly hours are used.\n\nwith updates (activity_id, start_time, end_time, available_days_of_week, schedule_notes, available_dates, availability_start_date, availability_end_date, availability_type, availability_notes) as (\n  values\n    ${values}\n)\nupdate public.activities as activity\nset\n  start_time = coalesce(updates.start_time, activity.start_time),\n  end_time = coalesce(updates.end_time, activity.end_time),\n  days_of_week = case when cardinality(updates.available_days_of_week) > 0 then updates.available_days_of_week else activity.days_of_week end,\n  schedule_notes = coalesce(updates.schedule_notes, activity.schedule_notes),\n  available_dates = updates.available_dates,\n  availability_start_date = updates.availability_start_date,\n  availability_end_date = updates.availability_end_date,\n  available_days_of_week = updates.available_days_of_week,\n  availability_type = updates.availability_type,\n  availability_notes = updates.availability_notes,\n  public_listing_status = 'published',\n  updated_at = now()\nfrom updates\nwhere activity.activity_id = updates.activity_id;\n`;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const activities = await feverActivities();
  const audit = await mapWithConcurrency(activities, 3, async (activity) => {
    try {
      const html = await fetchHtml(activity.source_url);
      const hours = weeklyHours(html);
      const dates = calendarDates(html);
      return {
        ...activity,
        status: 'ready',
        dates,
        days: hours.days,
        start_time: hours.start,
        end_time: hours.end,
        hours_type: hours.type,
        schedule_notes: hours.notes,
        availability_notes: dates.length
          ? `Fever ticket calendar lists ${dates.length} bookable date${dates.length === 1 ? '' : 's'} through ${dates.at(-1)}. ${hours.notes || 'Select a time in Fever.'}`
          : hours.notes || 'Fever has not published a structured availability schedule yet.',
      };
    } catch (error) {
      return { ...activity, status: 'error', reason: error.message };
    }
  });
  const updates = audit.filter((item) => item.status === 'ready');
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(updates));
  writeFileSync(outputAudit, JSON.stringify({ generated_at: new Date().toISOString(), audit }, null, 2) + '\n');
  console.log(`Enriched ${updates.length} of ${activities.length} Fever listings.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
