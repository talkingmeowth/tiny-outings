import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const sources = ['better_start_for_life', 'happity', 'eventbrite', 'fever', 'google_places'];
const targetDate = process.argv.find((argument) => argument.startsWith('--date='))?.slice(7) || '2026-07-16';
const targetWindow = process.argv.find((argument) => argument.startsWith('--window='))?.slice(9) || 'morning';

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/)
    .map((line) => line.match(/^([^#=]+)=(.*)$/))
    .filter(Boolean)
    .map(([, key, value]) => [key.trim(), value.trim().replace(/^['"]|['"]$/g, '')]));
}

function canonicalWeekday(value) {
  return String(value || '').trim().toLowerCase().replace(/s$/, '');
}

function weekdayName(date) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/London' })
    .format(new Date(`${date}T12:00:00Z`));
}

function isEventSource(activity) {
  return ['eventbrite', 'fever'].includes(activity.data_source);
}

function isAvailableOn(activity, date) {
  const explicitDates = Array.isArray(activity.available_dates)
    ? activity.available_dates.map((item) => String(item).slice(0, 10))
    : [];
  const activityDate = activity.activity_date ? String(activity.activity_date).slice(0, 10) : null;
  const days = activity.available_days_of_week?.length
    ? activity.available_days_of_week
    : activity.days_of_week || [];

  if (activityDate === date || explicitDates.includes(date)) return true;
  if (['one_off', 'specific_dates'].includes(activity.availability_type) && (activityDate || explicitDates.length)) return false;
  if (activity.availability_start_date && date < String(activity.availability_start_date).slice(0, 10)) return false;
  if (activity.availability_end_date && date > String(activity.availability_end_date).slice(0, 10)) return false;
  if (isEventSource(activity) && !activityDate && !explicitDates.length && !activity.availability_start_date && !activity.availability_end_date && !days.length) return false;
  return !days.length || days.some((day) => canonicalWeekday(day) === canonicalWeekday(weekdayName(date)));
}

function timeWindow(activity) {
  const hour = Number(String(activity.start_time || '09:00').slice(0, 2));
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

function isBabyClass(activity) {
  return /baby|toddler|sensory|music|sing|sign|yoga|massage|swim|dance|pilates|postnatal|developmental|class/
    .test([activity.category, activity.activity_name, activity.description, activity.age_suitability]
      .filter(Boolean).join(' ').toLowerCase());
}

async function fetchSourceActivities(url, key, source) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select: 'activity_id,activity_name,data_source,category,description,age_suitability,start_time,end_time,time_window,available_days_of_week,days_of_week,available_dates,activity_date,availability_start_date,availability_end_date,availability_type',
      public_listing_status: 'eq.published',
      data_source: `eq.${source}`,
      order: 'activity_id.asc',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${url}/rest/v1/activities?${params}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw new Error(`${source}: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const env = parseEnv(await readFile(resolve(root, '.env.local'), 'utf8'));
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required in .env.local.');
}

const allRows = [];
for (const source of sources) allRows.push(...await fetchSourceActivities(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, source));

console.log(`Swipe visibility audit: ${weekdayName(targetDate)} ${targetDate}, ${targetWindow}`);
for (const source of sources) {
  const rows = allRows.filter((row) => row.data_source === source);
  const slotRows = rows.filter((row) => isAvailableOn(row, targetDate) && timeWindow(row) === targetWindow);
  const babyClassRows = slotRows.filter(isBabyClass);
  console.log(`${source}: ${rows.length} published, ${slotRows.length} in slot, ${babyClassRows.length} match Baby classes`);
}

const happityRows = allRows.filter((row) => row.data_source === 'happity');
const eventRows = allRows.filter((row) => isEventSource(row));
const validWeekdays = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const scheduleIssues = happityRows.filter((row) => {
  const days = row.available_days_of_week?.length ? row.available_days_of_week : row.days_of_week || [];
  const invalidDay = days.some((day) => !validWeekdays.has(canonicalWeekday(day)));
  const invalidTime = !/^([01]\d|2[0-3]):[0-5]\d/.test(String(row.start_time || ''))
    || !/^([01]\d|2[0-3]):[0-5]\d/.test(String(row.end_time || ''));
  const mismatchedWindow = row.time_window && row.time_window !== timeWindow(row);
  const noSchedule = !row.activity_date && !row.available_dates?.length && !days.length;
  return invalidDay || invalidTime || String(row.end_time) <= String(row.start_time) || mismatchedWindow || noSchedule;
});

if (scheduleIssues.length) {
  throw new Error(`Happity schedule audit failed for ${scheduleIssues.length} records.`);
}
console.log(`PASS: all ${happityRows.length} Happity records have valid days, times, and swipe windows.`);

const eventScheduleIssues = eventRows.flatMap((row) => {
  const explicitDates = Array.isArray(row.available_dates)
    ? row.available_dates.map((date) => String(date).slice(0, 10))
    : [];
  const dates = [...new Set([row.activity_date ? String(row.activity_date).slice(0, 10) : null, ...explicitDates].filter(Boolean))];
  const days = row.available_days_of_week?.length ? row.available_days_of_week : row.days_of_week || [];
  const issues = [];
  if (!dates.length && !days.length && !row.availability_start_date && !row.availability_end_date) issues.push('no_availability');
  if (!/^([01]\d|2[0-3]):[0-5]\d/.test(String(row.start_time || ''))
    || !/^([01]\d|2[0-3]):[0-5]\d/.test(String(row.end_time || ''))
    || String(row.end_time) <= String(row.start_time)) issues.push('invalid_time_range');
  if (row.time_window && row.time_window !== timeWindow(row)) issues.push('time_window_mismatch');
  for (const date of dates) {
    if (!isAvailableOn(row, date)) issues.push(`not_visible_on_${date}`);
    const weekday = canonicalWeekday(weekdayName(date));
    if (days.length && !days.some((day) => canonicalWeekday(day) === weekday)) issues.push(`weekday_mismatch_${date}`);
  }
  return issues.map((issue) => ({ activity_id: row.activity_id, activity_name: row.activity_name, issue }));
});

if (eventScheduleIssues.length) {
  throw new Error(`Event schedule audit failed for ${eventScheduleIssues.length} checks: ${JSON.stringify(eventScheduleIssues.slice(0, 5))}`);
}
console.log(`PASS: all ${eventRows.length} Eventbrite and Fever listings are visible on their stored dates and time slots.`);

const zipZap = allRows.find((row) => row.data_source === 'happity'
  && row.activity_name.toLowerCase() === 'zip zap babies'
  && row.available_days_of_week?.some((day) => canonicalWeekday(day) === 'thursday')
  && String(row.start_time).startsWith('11:00'));

if (weekdayName(targetDate) === 'Thursday' && targetWindow === 'morning' && (!zipZap || !isAvailableOn(zipZap, targetDate) || timeWindow(zipZap) !== targetWindow || !isBabyClass(zipZap))) {
  throw new Error('Zip Zap Babies failed the Thursday morning visibility audit.');
}

if (weekdayName(targetDate) === 'Thursday' && targetWindow === 'morning') console.log(`PASS: ${zipZap.activity_name} is visible as a Thursday morning Baby classes result.`);
