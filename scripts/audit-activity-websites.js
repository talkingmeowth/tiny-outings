/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSqlPath = join(root, 'supabase', 'seed', 'activity_link_repairs.generated.sql');
const outputAuditPath = join(root, 'data', 'activity_link_audit.generated.json');
const useGooglePlaces = process.argv.includes('--google-places');
const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='));
const recordLimit = limitArgument ? Number(limitArgument.slice('--limit='.length)) : null;
const directoryHosts = new Set([
  'happity.co.uk', 'eventbrite.co.uk', 'eventbrite.com', 'feverup.com',
  'loopla.com', 'timeout.com', 'museumslondon.org', 'walthamforest.gov.uk',
  'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'google.com',
  'google.co.uk', 'maps.google.com', 'maps.app.goo.gl',
]);

function readEnv() {
  return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').replace(/^\uFEFF/, '')
    .split(/\r?\n/)
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
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function hostFor(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isDirectoryUrl(value) {
  const host = hostFor(value);
  return Boolean(host && [...directoryHosts].some((directoryHost) => host === directoryHost || host.endsWith(`.${directoryHost}`)));
}

function isGoogleMapsUrl(value) {
  const host = hostFor(value);
  return Boolean(host && (host === 'maps.app.goo.gl' || host.endsWith('google.com') || host.endsWith('google.co.uk')));
}

function isOfficialCandidate(value) {
  return isHttpUrl(value) && !isDirectoryUrl(value);
}

function sql(value) {
  return value == null ? 'null' : `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function statusIsUsable(status) {
  return ['reachable', 'source_blocked_401', 'source_blocked_403', 'source_blocked_429'].includes(status);
}

function statusIsBroken(status) {
  // Timeouts and connection failures can come from the current network, a
  // venue's bot protection, or a short-lived outage. Only clear a link when
  // the host has conclusively said that the page no longer exists.
  return ['invalid_url', 'http_404', 'http_410', 'http_451'].includes(status);
}

async function fetchActivities(config) {
  const records = [];
  const select = [
    'activity_id', 'activity_name', 'address', 'data_source', 'source_name',
    'website', 'organiser_website', 'source_url', 'google_place_id',
    'public_listing_status', 'archive',
  ].join(',');
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select,
      archive: 'eq.false',
      order: 'activity_id.asc',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/activities?${params}`, {
      headers: { apikey: config.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${config.VITE_SUPABASE_ANON_KEY}` },
    });
    if (!response.ok) throw new Error(`Could not load activities: ${response.status}`);
    const page = await response.json();
    records.push(...page);
    if (page.length < 1000 || (recordLimit && records.length >= recordLimit)) return recordLimit ? records.slice(0, recordLimit) : records;
  }
}

async function mapConcurrent(items, concurrency, callback) {
  let index = 0;
  const output = new Map();
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      output.set(item, await callback(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

async function fetchUrlStatus(url) {
  if (!isHttpUrl(url)) return { status: 'invalid_url', finalUrl: null };
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'TinyOutingsLinkAudit/1.0 (+https://tiny-outings-cpjh.onrender.com/)' },
    });
    if (response.status === 405 || [400, 404, 410, 451].includes(response.status)) {
      const fallback = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: { Range: 'bytes=0-0', 'User-Agent': 'TinyOutingsLinkAudit/1.0 (+https://tiny-outings-cpjh.onrender.com/)' },
      });
      fallback.body?.cancel();
      if (isNetworkFilterUrl(fallback.url)) return { status: 'network_filter', finalUrl: fallback.url };
      if (fallback.ok) return { status: 'reachable', finalUrl: fallback.url };
      if ([401, 403, 429].includes(fallback.status)) return { status: `source_blocked_${fallback.status}`, finalUrl: fallback.url };
      return { status: `http_${fallback.status}`, finalUrl: fallback.url };
    }
    if (isNetworkFilterUrl(response.url)) return { status: 'network_filter', finalUrl: response.url };
    if (response.ok) return { status: 'reachable', finalUrl: response.url };
    if ([401, 403, 429].includes(response.status)) return { status: `source_blocked_${response.status}`, finalUrl: response.url };
    return { status: `http_${response.status}`, finalUrl: response.url };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 'timeout' : 'network_error', finalUrl: null };
  }
}

function isNetworkFilterUrl(value) {
  const host = hostFor(value);
  return Boolean(host && (
    host.includes('securenet.')
    || host.includes('parental-controls.')
    || host.includes('webfilter.')
  ));
}

function urlVariants(value, { includeRoot = false } = {}) {
  const original = canonicalUrl(value);
  if (!original) return [];
  const variants = [original];
  const url = new URL(original);
  if (url.protocol === 'http:') {
    const https = new URL(original);
    https.protocol = 'https:';
    variants.push(https.toString());
  }
  const hostVariant = new URL(original);
  hostVariant.hostname = hostVariant.hostname.startsWith('www.')
    ? hostVariant.hostname.slice(4)
    : `www.${hostVariant.hostname}`;
  variants.push(hostVariant.toString());
  if (includeRoot) {
    const rootUrl = new URL(original);
    rootUrl.pathname = '/';
    rootUrl.search = '';
    variants.push(rootUrl.toString());
  }
  return [...new Set(variants.map(canonicalUrl).filter(Boolean))];
}

function activitySearchQuery(activity) {
  return [activity.activity_name, activity.address].filter(Boolean).join(', ');
}

async function placeWebsite(activity, config, cache) {
  if (!useGooglePlaces || !activity.google_place_id || !config.VITE_GOOGLE_MAPS_API_KEY) return null;
  const placeId = String(activity.google_place_id);
  if (!cache.has(placeId)) {
    const request = (async () => {
      const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=websiteUri,businessStatus&key=${encodeURIComponent(config.VITE_GOOGLE_MAPS_API_KEY)}`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) return null;
        const place = await response.json();
        return place.businessStatus === 'CLOSED_PERMANENTLY' || !isOfficialCandidate(place.websiteUri) ? null : canonicalUrl(place.websiteUri);
      } catch {
        return null;
      }
    })();
    cache.set(placeId, request);
  }
  return cache.get(placeId);
}

async function firstUsableUrl(candidates, statusFor) {
  for (const candidate of candidates) {
    if (!candidate || isNetworkFilterUrl(candidate)) continue;
    const check = await statusFor(candidate);
    if (statusIsUsable(check.status)) return check.finalUrl || candidate;
  }
  return null;
}

async function main() {
  const config = readEnv();
  if (!config.VITE_SUPABASE_URL || !config.VITE_SUPABASE_ANON_KEY) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required in .env.local.');
  }
  if (useGooglePlaces && !config.VITE_GOOGLE_MAPS_API_KEY) {
    throw new Error('VITE_GOOGLE_MAPS_API_KEY is required when using --google-places.');
  }

  const activities = await fetchActivities(config);
  const statusCache = new Map();
  const placeCache = new Map();
  const statusFor = async (value) => {
    const url = canonicalUrl(value);
    if (!url) return { status: 'invalid_url', finalUrl: null };
    if (!statusCache.has(url)) statusCache.set(url, fetchUrlStatus(url));
    return statusCache.get(url);
  };

  const initialUrls = [...new Set(activities.flatMap((activity) => [activity.website, activity.organiser_website]).map(canonicalUrl).filter(Boolean))];
  await mapConcurrent(initialUrls, 10, statusFor);

  const repairs = [];
  const auditRows = [];
  for (const activity of activities) {
    const currentWebsite = canonicalUrl(activity.website);
    const currentOrganiserWebsite = canonicalUrl(activity.organiser_website);
    const websiteCheck = currentWebsite ? await statusFor(currentWebsite) : { status: 'missing', finalUrl: null };
    const organiserCheck = currentOrganiserWebsite ? await statusFor(currentOrganiserWebsite) : { status: 'missing', finalUrl: null };
    let nextWebsite = currentWebsite;
    let nextOrganiserWebsite = currentOrganiserWebsite;
    const repairReasons = [];

    if (currentWebsite && statusIsBroken(websiteCheck.status)) {
      const placeUrl = await placeWebsite(activity, config, placeCache);
      const replacement = await firstUsableUrl([
        ...urlVariants(currentWebsite),
        canonicalUrl(activity.source_url),
        organiserCheck && statusIsUsable(organiserCheck.status) ? currentOrganiserWebsite : null,
        placeUrl,
      ].filter((candidate) => !isGoogleMapsUrl(candidate)), statusFor);
      nextWebsite = replacement;
      repairReasons.push(replacement ? 'replacement_found' : 'removed_broken_link');
    }

    if (currentOrganiserWebsite && statusIsBroken(organiserCheck.status)) {
      const placeUrl = await placeWebsite(activity, config, placeCache);
      const websiteAsOrganiser = isOfficialCandidate(currentWebsite) && statusIsUsable(websiteCheck.status)
        ? currentWebsite
        : null;
      const replacement = await firstUsableUrl([
        ...urlVariants(currentOrganiserWebsite, { includeRoot: true }),
        websiteAsOrganiser,
        placeUrl,
      ], statusFor);
      nextOrganiserWebsite = replacement;
      repairReasons.push(replacement ? 'replacement_found' : 'removed_broken_link');
    }

    const websiteChanged = nextWebsite !== currentWebsite;
    const organiserChanged = nextOrganiserWebsite !== currentOrganiserWebsite;
    if (websiteChanged || organiserChanged) {
      repairs.push({
        activity_id: activity.activity_id,
        activity_name: activity.activity_name,
        website: nextWebsite,
        organiser_website: nextOrganiserWebsite,
        website_status: websiteCheck.status,
        organiser_website_status: organiserCheck.status,
        reason: [...new Set(repairReasons)].join(', '),
      });
    }
    auditRows.push({
      activity_id: activity.activity_id,
      activity_name: activity.activity_name,
      address: activity.address,
      data_source: activity.data_source,
      search_query: activitySearchQuery(activity),
      website: currentWebsite,
      website_status: websiteCheck.status,
      organiser_website: currentOrganiserWebsite,
      organiser_website_status: organiserCheck.status,
      proposed_website: websiteChanged ? nextWebsite : undefined,
      proposed_organiser_website: organiserChanged ? nextOrganiserWebsite : undefined,
    });
  }

  const countStatuses = (field) => auditRows.reduce((counts, row) => {
    const status = row[field];
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const brokenWebsiteCount = auditRows.filter((row) => statusIsBroken(row.website_status)).length;
  const brokenOrganiserCount = auditRows.filter((row) => statusIsBroken(row.organiser_website_status)).length;
  const placeResults = await Promise.all([...placeCache.values()]);
  const officialPlaceWebsitesFound = placeResults.filter(Boolean).length;
  const sqlText = repairs.length
    ? `-- Generated by scripts/audit-activity-websites.js\n-- Only broken links are changed. A verified replacement is used first; otherwise the broken field is cleared.\nwith link_repairs (activity_id, website, organiser_website) as (\n  values\n    ${repairs.map((repair) => `(${sql(repair.activity_id)}::uuid, ${sql(repair.website)}::text, ${sql(repair.organiser_website)}::text)`).join(',\n    ')}\n)\nupdate public.activities as activity\nset\n  website = link_repairs.website,\n  organiser_website = link_repairs.organiser_website,\n  updated_at = now()\nfrom link_repairs\nwhere activity.activity_id = link_repairs.activity_id;\n`
    : '-- No broken website or organiser website links were found.\n';

  mkdirSync(dirname(outputSqlPath), { recursive: true });
  mkdirSync(dirname(outputAuditPath), { recursive: true });
  writeFileSync(outputSqlPath, sqlText);
  writeFileSync(outputAuditPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    scope: 'Unarchived activities visible through the project API.',
    google_places_lookup_used: useGooglePlaces,
    google_places_records_checked: placeCache.size,
    google_places_official_websites_found: officialPlaceWebsitesFound,
    checked_records: activities.length,
    unique_urls_checked: statusCache.size,
    website_statuses: countStatuses('website_status'),
    organiser_website_statuses: countStatuses('organiser_website_status'),
    broken_website_links: brokenWebsiteCount,
    broken_organiser_website_links: brokenOrganiserCount,
    proposed_repairs: repairs.length,
    repairs,
    records: auditRows,
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    checked_records: activities.length,
    unique_urls_checked: statusCache.size,
    broken_website_links: brokenWebsiteCount,
    broken_organiser_website_links: brokenOrganiserCount,
    proposed_repairs: repairs.length,
    google_places_lookup_used: useGooglePlaces,
    google_places_records_checked: placeCache.size,
    google_places_official_websites_found: officialPlaceWebsitesFound,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
