/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputSql = join(root, 'supabase', 'seed', 'activity_provider_link_updates.generated.sql');
const outputAudit = join(root, 'data', 'activity_provider_link_updates.generated.json');
const providerSourcePattern = /happity|fever|eventbrite/i;
const blockedDomains = /(?:^|\.)(?:google\.|gstatic\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com|linkedin\.com)/i;

function readDotEnv(name) {
  try {
    return Object.fromEntries(readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
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
const requestedLimit = Number(process.argv.find((argument) => argument.startsWith('--limit='))?.split('=')[1] || 0);

function sql(value) {
  return value == null ? 'null' : `$$${String(value).replaceAll('$$', '$ $')}$$`;
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function host(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function isProviderLink(value) {
  return providerSourcePattern.test(host(value) || '');
}

function isSpecificListing(value) {
  const url = normalizeUrl(value);
  if (!url) return false;
  if (blockedDomains.test(host(url) || '')) return false;
  const valueLower = url.toLowerCase();
  if (valueLower.includes('happity.co.uk')) return /\/schedules\//i.test(valueLower);
  if (valueLower.includes('feverup.com')) return /\/m\/\d+/i.test(valueLower);
  if (valueLower.includes('eventbrite.')) return /\/e\//i.test(valueLower);
  return true;
}

function isOfficialCandidate(value, sourceUrl) {
  const url = normalizeUrl(value);
  if (!url || blockedDomains.test(host(url) || '')) return false;
  if (isProviderLink(url)) return false;
  return host(url) !== host(sourceUrl);
}

function htmlAttribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || null;
}

function absoluteUrl(value, baseUrl) {
  try {
    return normalizeUrl(new URL(String(value || '').replaceAll('&amp;', '&'), baseUrl).toString());
  } catch {
    return null;
  }
}

function stringsFromStructuredValue(value, key = '') {
  if (!value) return [];
  if (typeof value === 'string') return /^(url|website|organizer|organiser|provider|brand)$/i.test(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => stringsFromStructuredValue(item, key));
  if (typeof value !== 'object') return [];

  const urls = [];
  for (const [childKey, childValue] of Object.entries(value)) {
    if (/^(organizer|organiser|provider|brand|author|publisher)$/i.test(childKey)) {
      if (typeof childValue === 'string') urls.push(childValue);
      else if (childValue && typeof childValue === 'object') {
        for (const field of ['url', 'sameAs', 'website']) {
          const candidate = childValue[field];
          if (typeof candidate === 'string') urls.push(candidate);
          if (Array.isArray(candidate)) urls.push(...candidate.filter((item) => typeof item === 'string'));
        }
      }
    }
    urls.push(...stringsFromStructuredValue(childValue, childKey));
  }
  return urls;
}

function organiserUrlFromHtml(html, pageUrl, sourceUrl) {
  const candidates = [];
  const add = (value) => {
    const url = absoluteUrl(value, pageUrl);
    if (isOfficialCandidate(url, sourceUrl)) candidates.push(url);
  };

  const scripts = html.match(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    try {
      const body = script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
      const json = JSON.parse(body);
      stringsFromStructuredValue(json).forEach(add);
    } catch {
      // Some listings embed malformed JSON-LD; link text remains a fallback.
    }
  }

  const anchors = html.match(/<a\s+[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const anchor of anchors) {
    const label = anchor.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/(website|organis[ez]r|provider|run by|visit)/i.test(label)) continue;
    add(htmlAttribute(anchor, 'href'));
  }

  return [...new Set(candidates)][0] || null;
}

async function fetchActivities() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  const rows = [];
  const select = 'activity_id,activity_name,website,organiser_website,source_url,source_name,data_source';
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select,
      public_listing_status: 'eq.published',
      archive: 'eq.false',
      order: 'activity_name.asc',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/activities?${params}`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
    });
    if (!response.ok) throw new Error(`Could not load activities: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function discoverLinks(activity) {
  const sourceUrl = normalizeUrl(activity.source_url);
  const website = normalizeUrl(activity.website);
  const needsWebsite = !website;
  const needsOrganiser = providerSourcePattern.test(`${activity.source_name || ''} ${activity.data_source || ''}`)
    && !normalizeUrl(activity.organiser_website);
  if (!needsWebsite && !needsOrganiser) return { activity, website: null, organiserWebsite: null, status: 'already-complete' };

  let nextWebsite = needsWebsite && isSpecificListing(sourceUrl) ? sourceUrl : null;
  let organiserWebsite = null;
  if (!needsOrganiser || !sourceUrl) return { activity, website: nextWebsite, organiserWebsite, status: nextWebsite ? 'listing-linked' : 'no-source-link' };

  try {
    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Tiny Outings directory updater (+https://tiny-outings-cpjh.onrender.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) {
      return { activity, website: nextWebsite, organiserWebsite, status: `listing-unavailable-${response.status}` };
    }
    const pageUrl = response.url || sourceUrl;
    const html = await response.text();
    organiserWebsite = organiserUrlFromHtml(html, pageUrl, sourceUrl);
    return { activity, website: nextWebsite, organiserWebsite, status: organiserWebsite ? 'organiser-found' : nextWebsite ? 'listing-linked' : 'no-provider-link-found' };
  } catch (error) {
    return { activity, website: nextWebsite, organiserWebsite, status: `listing-error-${error.name || 'unknown'}` };
  }
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

function buildSql(updates) {
  if (!updates.length) return '-- No provider website links needed updating.\n';
  return `-- Generated by scripts/enrich-activity-provider-links.js
-- Uses listing metadata to find independent organiser websites for Happity,
-- Fever, and Eventbrite records. Listing URLs are retained separately.
with updates (activity_id, website, organiser_website) as (
  values
    ${updates.map((row) => `(${sql(row.activity.activity_id)}::uuid, ${sql(row.website)}::text, ${sql(row.organiserWebsite)}::text)`).join(',\n    ')}
)
update public.activities as activity
set
  website = coalesce(updates.website, activity.website),
  organiser_website = coalesce(updates.organiser_website, activity.organiser_website),
  updated_at = now()
from updates
where activity.activity_id = updates.activity_id;
`;
}

async function main() {
  const activities = await fetchActivities();
  const targets = activities.filter((activity) => (
    !normalizeUrl(activity.website)
    || (providerSourcePattern.test(`${activity.source_name || ''} ${activity.data_source || ''}`) && !normalizeUrl(activity.organiser_website))
  )).slice(0, requestedLimit || undefined);
  const results = await mapWithConcurrency(targets, 6, discoverLinks);
  const updates = results.filter((result) => result.website || result.organiserWebsite);
  mkdirSync(dirname(outputSql), { recursive: true });
  mkdirSync(dirname(outputAudit), { recursive: true });
  writeFileSync(outputSql, buildSql(updates));
  writeFileSync(outputAudit, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_published_activities: activities.length,
    target_count: targets.length,
    update_count: updates.length,
    results: results.map((result) => ({
      activity_id: result.activity.activity_id,
      activity_name: result.activity.activity_name,
      website: result.website,
      organiser_website: result.organiserWebsite,
      status: result.status,
    })),
  }, null, 2) + '\n');
  console.log(`Provider-link enrichment checked ${targets.length} activities and generated ${updates.length} updates.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
