/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  eventRecord,
  htmlTitle,
  pageExplicitlyMissing,
  parseHappityReaderPage,
  parseWalthamForestEventPage,
  scheduleDiffers,
  scheduleFromEvent,
} from './lib/activity-freshness.js';
import { loadActiveActivities } from './lib/active-activity-reader.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activity_source_freshness.generated.sql');
const outputAudit = join(root, 'data', 'activity_source_freshness.generated.json');
const forceFull = process.argv.includes('--full');
const requestedLimit = Number(process.argv.find((argument) => argument.startsWith('--limit='))?.split('=')[1] || 0);
const requestedSource = process.argv.find((argument) => argument.startsWith('--source='))?.split('=')[1]?.toLowerCase() || null;
const requestedStatus = process.argv.find((argument) => argument.startsWith('--status='))?.split('=')[1]?.toLowerCase() || null;
const staleAfterDays = Math.max(0, Number(process.argv.find((argument) => argument.startsWith('--stale-after-days='))?.split('=')[1] || 1));
const happityBatchSize = Math.max(1, Number(process.argv.find((argument) => argument.startsWith('--happity-limit='))?.split('=')[1] || 120));
const concurrency = Math.max(1, Number(process.env.ACTIVITY_FRESHNESS_CONCURRENCY || 8));
const readerPrefix = process.env.HAPPITY_READER_PREFIX || 'https://r.jina.ai/';
const happityReaderIntervalMs = Math.max(0, Number(process.env.HAPPITY_READER_INTERVAL_MS || 3200));
const happityAreas = (process.env.HAPPITY_DIRECTORY_AREAS || 'islington,hackney,newham,waltham-forest')
  .split(',').map((value) => value.trim()).filter(Boolean);
let currentHappityDirectoryUrls = new Set();
let happityReaderQueue = Promise.resolve();
let nextHappityReaderAt = 0;

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

const env = { ...readDotEnv('.env.local'), ...process.env };
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

function sql(value) {
  return value == null || value === '' ? 'null' : `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function sqlTextArray(values) {
  return values?.length ? `array[${values.map(sql).join(', ')}]::text[]` : "'{}'::text[]";
}

function sourceUrl(activity) {
  const candidates = [];
  for (const value of [activity.source_url, activity.website]) {
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol)) candidates.push(url.toString());
    } catch {
      // Continue to the next candidate URL.
    }
  }
  const isIndividual = (value) => /happity\.co\.uk\/schedules\/|eventbrite\.co\.uk\/e\/|feverup\.com\/m\/|loopla\.com\/business\/|walthamforest\.gov\.uk\/events\//i.test(value);
  return candidates.find(isIndividual) || candidates[0] || null;
}

function isHappity(activity) {
  return /happity/i.test(`${activity.data_source || ''} ${activity.source_name || ''} ${sourceUrl(activity) || ''}`);
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(value || '').split('#')[0].split('?')[0].replace(/\/$/, '').toLowerCase();
  }
}

function isFreshnessTarget(activity) {
  const url = sourceUrl(activity);
  if (!url) return false;
  const provenance = `${activity.data_source || ''} ${activity.source_name || ''} ${url}`;
  if (/happity|eventbrite|fever|loopla/i.test(provenance)) return true;
  if (/walthamforest\.gov\.uk\/events\//i.test(url)) return true;
  return /event/i.test(provenance) && ['one_off', 'specific_dates'].includes(activity.availability_type);
}

async function fetchActivities() {
  const columns = [
    'activity_id', 'activity_name', 'source_name', 'data_source', 'source_url', 'website',
    'public_listing_status', 'activity_date', 'start_time', 'end_time', 'days_of_week',
    'available_dates', 'availability_type', 'source_listing_checked_at',
    'source_listing_check_status',
  ];
  return loadActiveActivities({ root, supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, columns });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchPage(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TinyOutings/1.0; +https://tiny-outings-cpjh.onrender.com)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(30000),
      });
      const body = await response.text();
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
        return { status: response.status, body, finalUrl: response.url };
      }
    } catch (error) {
      if (attempt === 2) return { status: 0, body: '', finalUrl: url, error: error.message };
    }
    await delay(700 * (attempt + 1));
  }
  return { status: 0, body: '', finalUrl: url, error: 'Request failed after retries' };
}

function fetchHappityReader(url) {
  const request = happityReaderQueue.then(async () => {
    const pause = nextHappityReaderAt - Date.now();
    if (pause > 0) await delay(pause);
    nextHappityReaderAt = Date.now() + happityReaderIntervalMs;
    return fetchPage(`${readerPrefix}${url}`);
  });
  happityReaderQueue = request.catch(() => null);
  return request;
}

async function loadHappityDirectoryIndex() {
  const pages = await Promise.all(happityAreas.map(async (area) => {
    const response = await fetchHappityReader(`https://www.happity.co.uk/${area}/baby-toddler-classes`);
    if (response.status !== 200) return { area, status: response.status, urls: [] };
    const urls = [...response.body.matchAll(/https:\/\/www\.happity\.co\.uk\/schedules\/[^)\s?#]+/gi)]
      .map((match) => canonicalUrl(match[0]));
    return { area, status: response.status, urls: [...new Set(urls)] };
  }));
  currentHappityDirectoryUrls = new Set(pages.flatMap((page) => page.urls));
  console.log(`Current Happity directory index: ${currentHappityDirectoryUrls.size} unique schedule URLs across ${pages.filter((page) => page.status === 200).length}/${pages.length} areas.`);
  return pages.map((page) => ({ area: page.area, status: page.status, schedule_count: page.urls.length }));
}

function homepageRedirect(original, finalUrl) {
  try {
    const before = new URL(original);
    const after = new URL(finalUrl);
    return before.hostname === after.hostname && before.pathname !== '/' && ['/','/home'].includes(after.pathname);
  } catch {
    return false;
  }
}

async function validateHappity(activity, url, direct) {
  if (!/happity\.co\.uk\/schedules\//i.test(url)) {
    return { activity, url, status: 'unreachable', detail: 'No individual Happity schedule URL is stored; a generic directory is not stale evidence' };
  }
  if (direct.status === 404 || direct.status === 410) {
    return { activity, url, status: 'stale', detail: `Happity returned ${direct.status}` };
  }
  if (direct.status === 200 && !/just a moment/i.test(htmlTitle(direct.body))) {
    const parsed = parseHappityReaderPage(`Title: ${htmlTitle(direct.body)}`);
    return resultFromSchedule(activity, url, parsed, 'direct-happity');
  }
  if (![401, 403, 429].includes(direct.status)) {
    return { activity, url, status: 'unreachable', detail: direct.error || `Happity returned ${direct.status}` };
  }

  // Happity challenges or rate-limits unattended HTTP clients. The fallback
  // renders that exact public URL; it is never used for a timeout or 5xx.
  const rendered = await fetchHappityReader(url);
  if (rendered.status !== 200) {
    return { activity, url, status: 'unreachable', detail: `Happity reader returned ${rendered.status || rendered.error}` };
  }
  return resultFromSchedule(activity, url, parseHappityReaderPage(rendered.body), 'happity-reader');
}

function resultFromSchedule(activity, url, schedule, evidence) {
  if (schedule.state === 'stale') return { activity, url, status: 'stale', detail: schedule.reason, evidence };
  if (schedule.state !== 'active') return { activity, url, status: 'unreachable', detail: schedule.reason, evidence };
  const changed = scheduleDiffers(activity, schedule);
  return {
    activity, url, status: changed ? 'updated' : 'active',
    detail: schedule.reason || 'The individual listing URL is active',
    evidence,
    schedule: changed ? schedule : null,
  };
}

async function validateActivity(activity) {
  const url = sourceUrl(activity);
  if (isHappity(activity) && currentHappityDirectoryUrls.has(canonicalUrl(url))) {
    return { activity, url, status: 'active', detail: 'The exact schedule URL is present in the current Happity borough directory', evidence: 'happity-directory' };
  }
  const direct = await fetchPage(url);
  if (isHappity(activity)) return validateHappity(activity, url, direct);
  if ([404, 410].includes(direct.status)) {
    return { activity, url, status: 'stale', detail: `The authoritative listing returned ${direct.status}`, evidence: 'direct-source' };
  }
  if (direct.status === 0 || direct.status === 401 || direct.status === 403 || direct.status === 429 || direct.status >= 500) {
    return { activity, url, status: 'unreachable', detail: direct.error || `The authoritative listing returned ${direct.status}`, evidence: 'direct-source' };
  }
  if (direct.status < 200 || direct.status >= 400) {
    return { activity, url, status: 'unreachable', detail: `The authoritative listing returned ${direct.status}`, evidence: 'direct-source' };
  }
  if (homepageRedirect(url, direct.finalUrl)) {
    return { activity, url, status: 'stale', detail: 'The individual listing redirects to the source homepage', evidence: 'direct-source' };
  }
  if (pageExplicitlyMissing(direct.body)) {
    return { activity, url, status: 'stale', detail: 'The source page explicitly says the listing is no longer available', evidence: 'direct-source' };
  }

  let schedule;
  if (/walthamforest\.gov\.uk\/events\//i.test(url)) {
    schedule = parseWalthamForestEventPage(direct.body);
    const recurringCouncilListing = activity.activity_date == null
      || activity.availability_type === 'weekly'
      || (activity.days_of_week || []).length > 1;
    if (recurringCouncilListing) {
      // The council detail page exposes only the next occurrence. The source
      // importer reads all occurrences from the directory and must remain the
      // authority for recurring/multi-day schedules.
      if (schedule.state === 'stale') schedule = { state: 'active', kind: 'no-schedule', reason: 'Recurring council listing page remains reachable; directory reconciliation controls its schedule' };
      else schedule = { state: 'active', kind: 'no-schedule', reason: 'Recurring council listing page is active; directory reconciliation controls its schedule' };
    }
  } else {
    const event = eventRecord(direct.body);
    schedule = event ? scheduleFromEvent(event, { pageHtml: direct.body }) : { state: 'active', kind: 'no-schedule' };
  }
  return resultFromSchedule(activity, url, schedule, 'direct-source');
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;
  let completed = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
      completed += 1;
      if (completed % 25 === 0 || completed === items.length) console.log(`Freshness validation: ${completed}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function scheduleTuple(result) {
  const schedule = result.schedule;
  const specific = schedule.kind === 'specific-date';
  return `(${sql(result.activity.activity_id)}::uuid, ${sql(schedule.date)}::date, ${sql(schedule.start)}::time, ${sql(schedule.end)}::time, ${sqlTextArray(schedule.days)}, ${specific}, ${sql(schedule.reason)}::text)`;
}

function buildSql(results) {
  const scheduleUpdates = results.filter((result) => result.status === 'updated' && result.schedule);
  const archives = results.filter((result) => result.status === 'stale');
  const checkSql = results.length ? `with checks (activity_id, check_status, detail, seen) as (
  values
    ${results.map((result) => `(${sql(result.activity.activity_id)}::uuid, ${sql(result.status)}::text, ${sql(result.detail)}::text, ${['active', 'updated'].includes(result.status)})`).join(',\n    ')}
)
update public.activities as activity
set source_listing_checked_at = now(),
    source_listing_last_seen_at = case when checks.seen then now() else activity.source_listing_last_seen_at end,
    source_listing_check_status = checks.check_status,
    source_listing_check_detail = checks.detail,
    updated_at = now()
from checks
where activity.activity_id = checks.activity_id;
` : '-- No source listing checks were due.\n';

  const updateSql = scheduleUpdates.length ? `
with schedules (activity_id, activity_date, start_time, end_time, days, date_specific, notes) as (
  values
    ${scheduleUpdates.map(scheduleTuple).join(',\n    ')}
)
update public.activities as activity
set activity_date = case when schedules.date_specific then schedules.activity_date else activity.activity_date end,
    available_dates = case when schedules.date_specific then ${'array[schedules.activity_date]::date[]'} else activity.available_dates end,
    start_time = coalesce(schedules.start_time, activity.start_time),
    end_time = coalesce(schedules.end_time, activity.end_time),
    days_of_week = case when cardinality(schedules.days) > 0 then schedules.days else activity.days_of_week end,
    available_days_of_week = case when cardinality(schedules.days) > 0 then schedules.days else activity.available_days_of_week end,
    availability_type = case when schedules.date_specific then 'one_off' else 'weekly' end,
    availability_notes = coalesce(schedules.notes, activity.availability_notes),
    updated_at = now()
from schedules
where activity.activity_id = schedules.activity_id;
` : '';

  const archiveSql = archives.length ? `
-- Archive only direct 404/410 responses, explicit cancellation/expiry, or an
-- individual URL that authoritatively resolves to the source directory/homepage.
with stale (activity_id, reason) as (
  values
    ${archives.map((result) => `(${sql(result.activity.activity_id)}::uuid, ${sql(`Stale listing: ${result.detail}`)}::text)`).join(',\n    ')}
)
update public.activities as activity
set archive_previous_listing_status = case when activity.public_listing_status in ('draft', 'published') then activity.public_listing_status else activity.archive_previous_listing_status end,
    archive = true,
    public_listing_status = 'archived',
    archive_reason = stale.reason,
    archived_at = coalesce(activity.archived_at, now()),
    updated_at = now()
from stale
where activity.activity_id = stale.activity_id;
` : '';

  return `-- Generated by scripts/validate-activity-freshness.js
-- Transient failures, access blocks, and rate limits are recorded but never archived.

${checkSql}${updateSql}${archiveSql}`;
}

async function main() {
  const all = (await fetchActivities()).filter(isFreshnessTarget).filter((activity) => {
    if (!requestedSource) return true;
    return `${activity.data_source || ''} ${activity.source_name || ''} ${sourceUrl(activity) || ''}`.toLowerCase().includes(requestedSource);
  }).filter((activity) => !requestedStatus || String(activity.source_listing_check_status || '').toLowerCase() === requestedStatus);
  const cutoff = Date.now() - staleAfterDays * 24 * 60 * 60 * 1000;
  const due = all.filter((activity) => forceFull || !activity.source_listing_checked_at || new Date(activity.source_listing_checked_at).valueOf() <= cutoff)
    .sort((left, right) => String(left.source_listing_checked_at || '').localeCompare(String(right.source_listing_checked_at || '')));
  const happity = due.filter(isHappity);
  const other = due.filter((activity) => !isHappity(activity));
  const selected = [...other, ...(forceFull ? happity : happity.slice(0, happityBatchSize))]
    .slice(0, requestedLimit || undefined);
  const happityDirectoryPages = selected.some(isHappity) ? await loadHappityDirectoryIndex() : [];
  console.log(`Validating ${selected.length}/${all.length} active event and schedule URLs (${selected.filter(isHappity).length} Happity).`);
  const results = await mapWithConcurrency(selected, concurrency, validateActivity);
  const summary = results.reduce((counts, result) => ({ ...counts, [result.status]: (counts[result.status] || 0) + 1 }), {});

  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(results));
  writeFileSync(outputAudit, JSON.stringify({
    generated_at: new Date().toISOString(),
    full_validation: forceFull,
    stale_after_days: staleAfterDays,
    eligible_activity_count: all.length,
    target_count: selected.length,
    happity_target_count: selected.filter(isHappity).length,
    happity_directory_pages: happityDirectoryPages,
    happity_directory_unique_schedule_count: currentHappityDirectoryUrls.size,
    summary,
    results: results.map((result) => ({
      activity_id: result.activity.activity_id,
      activity_name: result.activity.activity_name,
      source_name: result.activity.source_name,
      data_source: result.activity.data_source,
      url: result.url,
      status: result.status,
      detail: result.detail,
      evidence: result.evidence,
      previous_schedule: {
        activity_date: result.activity.activity_date,
        start_time: result.activity.start_time,
        end_time: result.activity.end_time,
        days_of_week: result.activity.days_of_week,
      },
      current_schedule: result.schedule || null,
    })),
  }, null, 2) + '\n');
  console.log(`Freshness validation generated ${summary.updated || 0} schedule corrections and ${summary.stale || 0} stale archives; ${summary.unreachable || 0} transient/unsupported results were left active.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
