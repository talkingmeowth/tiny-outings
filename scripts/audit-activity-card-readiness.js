/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'data', 'activity_card_readiness_audit.generated.json');
const checkNetwork = process.argv.includes('--network');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

function env() {
  const path = join(root, '.env.local');
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

function canonicalUrl(value) {
  try {
    const parsed = new URL(String(value));
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function hasRealImage(activity) {
  const image = activity.google_photo_url || activity.image_url || activity.photo_url;
  return Boolean(image && !String(image).includes('placeholder'));
}

function imageTarget(activity) {
  return activity.google_photo_url || activity.image_url || activity.photo_url || null;
}

function availabilityIssue(activity) {
  const explicitDates = (activity.available_dates || []).map((date) => String(date).slice(0, 10));
  const dates = [activity.activity_date, activity.availability_start_date, activity.availability_end_date, ...explicitDates]
    .filter(Boolean).map((date) => String(date).slice(0, 10));
  const days = activity.available_days_of_week?.length ? activity.available_days_of_week : activity.days_of_week || [];
  const isEvent = ['eventbrite', 'fever'].includes(activity.data_source);
  if (String(activity.start_time) >= String(activity.end_time)) return 'end_time_not_after_start_time';
  if (['one_off', 'specific_dates'].includes(activity.availability_type) && !dates.length) return 'dated_listing_has_no_dates';
  if (isEvent && !dates.length && !days.length) return 'event_has_no_verified_availability';
  if (['one_off', 'specific_dates'].includes(activity.availability_type) && dates.length && Math.max(...dates.map(Date.parse)) < Date.parse(today)) return 'dated_listing_has_expired';
  return null;
}

function linkIssue(activity) {
  const link = activity.website || activity.source_url || activity.google_place_uri || activity.google_link;
  if (!isHttpUrl(link)) return 'no_usable_website_link';
  const value = String(link).toLowerCase();
  // Older Happity imports used a record-specific anchor on a borough listing.
  // New imports use the stronger /schedules/ URL; a verified provider website
  // is also valid when the source schedule itself has expired.
  const happitySource = String(activity.source_url || '').toLowerCase();
  if (activity.data_source === 'happity'
    && !happitySource.includes('happity.co.uk/schedules/')
    && !/baby-toddler-classes#[a-z0-9-]+/i.test(happitySource)
    && !value.includes('happity.co.uk/schedules/')
    && !/baby-toddler-classes#[a-z0-9-]+/i.test(value)) return 'happity_link_is_not_a_specific_listing';
  if (activity.data_source === 'eventbrite' && !value.includes('eventbrite.')) return 'eventbrite_link_is_not_eventbrite';
  if (activity.data_source === 'fever' && !value.includes('feverup.com/')) return 'fever_link_is_not_fever';
  return null;
}

async function fetchActivities(config) {
  const rows = [];
  const select = [
    'activity_id', 'activity_name', 'category', 'description', 'address', 'lat', 'long', 'start_time', 'end_time',
    'website', 'source_url', 'google_link', 'google_place_uri', 'image_url', 'google_photo_url',
    'days_of_week', 'available_days_of_week', 'available_dates', 'activity_date', 'availability_start_date',
    'availability_end_date', 'availability_type', 'data_source', 'public_listing_status',
  ].join(',');
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({ select, public_listing_status: 'eq.published', order: 'activity_id.asc', limit: '1000', offset: String(offset) });
    const response = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/activities?${params}`, {
      headers: { apikey: config.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${config.VITE_SUPABASE_ANON_KEY}` },
    });
    if (!response.ok) throw new Error(`Could not load activities: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function mapConcurrent(items, limit, callback) {
  let index = 0;
  const result = new Map();
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      result.set(item, await callback(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

async function checkUrl(url) {
  if (String(url).startsWith('places/')) return { status: 'google_photo_reference' };
  if (!isHttpUrl(url)) return { status: 'invalid_url' };
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (response.status === 405) {
      const fallback = await fetch(url, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(10000) });
      fallback.body?.cancel();
      return { status: fallback.ok ? 'reachable' : `http_${fallback.status}`, final_url: fallback.url };
    }
    if (response.ok) return { status: 'reachable', final_url: response.url };
    if ([401, 403, 429].includes(response.status)) return { status: `source_blocked_${response.status}`, final_url: response.url };
    return { status: `http_${response.status}`, final_url: response.url };
  } catch (error) {
    return { status: error.name === 'TimeoutError' ? 'timeout' : 'network_error' };
  }
}

async function main() {
  const config = env();
  const activities = await fetchActivities(config);
  const missingFields = activities.filter((activity) => !activity.activity_name || !activity.category || !activity.address);
  const invalidCoordinates = activities.filter((activity) => !Number.isFinite(Number(activity.lat)) || !Number.isFinite(Number(activity.long)));
  const availability = activities.map((activity) => ({ activity, issue: availabilityIssue(activity) })).filter((item) => item.issue);
  const links = activities.map((activity) => ({ activity, issue: linkIssue(activity) })).filter((item) => item.issue);
  const missingPhotos = activities.filter((activity) => !hasRealImage(activity));
  const overlongCardCopy = activities.filter((activity) => String(activity.activity_name || '').length > 180 || String(activity.category || '').length > 80);
  const audit = {
    generated_at: new Date().toISOString(),
    checked_date: today,
    checked_records: activities.length,
    card_rendering: {
      missing_required_fields: missingFields.length,
      invalid_coordinates: invalidCoordinates.length,
      overlong_title_or_category: overlongCardCopy.length,
      real_photo_present: activities.length - missingPhotos.length,
      fallback_illustration_only: missingPhotos.length,
    },
    links: { invalid_or_wrong_source_link: links.length },
    availability: { invalid_or_stale: availability.length },
    failures: {
      missing_required_fields: missingFields.map(({ activity_id, activity_name }) => ({ activity_id, activity_name })),
      invalid_coordinates: invalidCoordinates.map(({ activity_id, activity_name }) => ({ activity_id, activity_name })),
      overlong_title_or_category: overlongCardCopy.map(({ activity_id, activity_name, category }) => ({ activity_id, activity_name, category })),
      missing_real_photo: missingPhotos.map(({ activity_id, activity_name, data_source }) => ({ activity_id, activity_name, data_source })),
      links: links.map(({ activity, issue }) => ({ activity_id: activity.activity_id, activity_name: activity.activity_name, issue })),
      availability: availability.map(({ activity, issue }) => ({ activity_id: activity.activity_id, activity_name: activity.activity_name, issue })),
    },
  };

  if (checkNetwork) {
    const websiteUrls = [...new Set(activities.map((activity) => canonicalUrl(activity.website || activity.source_url || activity.google_place_uri || activity.google_link)).filter(Boolean))];
    const imageUrls = [...new Set(activities.map(imageTarget).filter(Boolean))];
    const [websiteChecks, imageChecks] = await Promise.all([
      mapConcurrent(websiteUrls, 16, checkUrl),
      mapConcurrent(imageUrls, 16, checkUrl),
    ]);
    const summarize = (checks) => [...checks.values()].reduce((summary, check) => ({ ...summary, [check.status]: (summary[check.status] || 0) + 1 }), {});
    audit.network = {
      unique_website_urls: websiteUrls.length,
      website_statuses: summarize(websiteChecks),
      unique_image_urls: imageUrls.length,
      image_statuses: summarize(imageChecks),
      broken_websites: websiteUrls.filter((url) => ['network_error', 'timeout'].includes(websiteChecks.get(url)?.status) || String(websiteChecks.get(url)?.status).startsWith('http_')),
      broken_images: imageUrls.filter((url) => ['network_error', 'timeout'].includes(imageChecks.get(url)?.status) || String(imageChecks.get(url)?.status).startsWith('http_')),
    };
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify({ ...audit, failures: Object.fromEntries(Object.entries(audit.failures).map(([key, value]) => [key, value.length])) }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
