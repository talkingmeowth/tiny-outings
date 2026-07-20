/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// Allow a targeted enrichment run without overwriting another pending image batch.
const outputSqlPath = process.env.ACTIVITY_IMAGE_OUTPUT
  ? join(repoRoot, process.env.ACTIVITY_IMAGE_OUTPUT)
  : join(repoRoot, 'supabase', 'seed', 'activity_image_updates.generated.sql');

function readDotEnv(fileName) {
  try {
    return Object.fromEntries(
      readFileSync(join(repoRoot, fileName), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
        .map((line) => {
          const index = line.indexOf('=');
          return [
            line.slice(0, index).trim(),
            line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ''),
          ];
        }),
    );
  } catch {
    return {};
  }
}

const localEnv = readDotEnv('.env.local');
const supabaseUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
const categoryFilter = process.env.ACTIVITY_IMAGE_CATEGORY || null;
const sourceNameFilter = process.env.ACTIVITY_IMAGE_SOURCE_NAME || null;
const organiserWebsiteFilter = process.env.ACTIVITY_IMAGE_ORGANISER_WEBSITE || null;
const verbose = process.env.ACTIVITY_IMAGE_VERBOSE === 'true';

function decodeHtml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function htmlAttr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || null;
}

function absoluteUrl(value, baseUrl) {
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // The app is served over HTTPS, so insecure image URLs can be blocked on mobile.
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

function isGoodActivityImageUrl(imageUrl) {
  if (!imageUrl) return false;
  const value = imageUrl.toLowerCase();
  try {
    const parsed = new URL(imageUrl);
    const path = parsed.pathname.toLowerCase();
    const basename = path.split('/').pop() || '';
    if (
      parsed.hostname.includes('walthamforest.gov.uk') &&
      path.includes('/sites/default/files/2026-06/') &&
      basename.endsWith('.png')
    ) {
      return false;
    }
  } catch {
    return false;
  }

  return ![
    'favicon',
    'icon',
    'logo',
    'brand',
    'wordmark',
    'header',
    'footer',
    'sprite',
    'avatar',
    'placeholder',
    '/pay.',
    'pay.png',
    '/find.',
    'find.png',
    '/apply.',
    'apply.png',
    '/report.',
    'report.png',
    'apple-touch',
    'loading',
    'spinner',
    'facebook.com/tr',
    'facebook.net/tr',
    'doubleclick.net',
    'google-analytics.com',
    'tracking-pixel',
    '/pixel.',
    'pixel.gif',
    '.svg',
    'google-play',
    'google_play',
    'app-store',
    'app_store',
    'download-button',
    'cookie',
    'consent',
    'newsletter',
    'payment',
    'checkout',
  ].some((blocked) => value.includes(blocked));
}

function isCafe(activity) {
  return /cafe|coffee|food|lunch/i.test(activity.category || '');
}

function imageCandidateScore(imageUrl, context = '', activity = {}) {
  const value = `${imageUrl} ${context}`.toLowerCase();
  let score = 0;
  if (/(original|full[-_]?size|large|hero|feature|gallery)/.test(value)) score += 10;
  if (/(thumbnail|thumb|small|150x150|300x300|400x400)/.test(value)) score -= 8;
  const width = Number(context.match(/\bwidth=(\d+)/i)?.[1] || 0);
  const height = Number(context.match(/\bheight=(\d+)/i)?.[1] || 0);
  if (width * height >= 180000) score += 8;
  if (width > 0 && height > 0 && width * height < 12000) score -= 12;

  const activityTerms = String(activity.activity_name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !['with', 'from', 'this', 'that', 'class', 'activity', 'london', 'family', 'years'].includes(term));
  const matchingTerms = activityTerms.filter((term) => value.includes(term));
  score += Math.min(matchingTerms.length, 3) * 8;
  if (isCafe(activity)) {
    // Cafe cards should show the place first, then what families can eat there.
    if (/(interior|inside|venue|dining|seating|space|room|restaurant|cafe)/.test(value)) score += 40;
    if (/(food|dish|cake|pastry|brunch|bakery|coffee|drink|menu)/.test(value)) score += 20;
  } else if (/(interior|inside|venue|cafe|coffee|restaurant|food|gallery|play|studio|class|space|room|facility)/.test(value)) {
    score += 8;
  }
  if (/(hero|banner|cover|default|social-share)/.test(value)) score -= 2;
  if (/(logo|brand|wordmark|icon|avatar|badge)/.test(value)) score -= 20;
  return score;
}

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function websiteLinksForActivity(activity) {
  return [...new Set([
    activity.website,
    activity.source_url,
    activity.organiser_website,
  ].filter((link) => link && !/google\./i.test(link)))];
}

async function fetchPublishedActivities() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  }

  const columns = [
    'activity_id',
    'activity_name',
    'address',
    'borough',
    'category',
    'source_name',
    'website',
    'organiser_website',
    'source_url',
    'google_link',
    'google_place_id',
    'google_place_uri',
    'google_photo_url',
    'google_rating',
    'google_user_rating_count',
    'image_url',
    'image_source_url',
  ].join(',');
  const activities = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/activities?select=${columns}&public_listing_status=eq.published&order=activity_name.asc&limit=${pageSize}&offset=${offset}`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
      },
    );

    if (!response.ok) throw new Error(`Could not read activities: ${response.status} ${await response.text()}`);
    const page = await response.json();
    activities.push(...page);
    if (page.length < pageSize) return activities;
  }
}

function imageFromJsonLd(html, baseUrl) {
  const scripts = html.match(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  for (const script of scripts) {
    const jsonText = script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try {
      const parsed = JSON.parse(jsonText);
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] || [])];
      for (const node of nodes) {
        const image = Array.isArray(node.image) ? node.image[0] : node.image;
        const url = typeof image === 'string' ? image : image?.url;
        const absolute = url ? absoluteUrl(url, baseUrl) : null;
        if (absolute) return absolute;
      }
    } catch {
      // Many websites include invalid JSON-LD. Metadata parsing below is enough.
    }
  }

  return null;
}

function imageFromHtml(html, baseUrl, activity) {
  const candidates = [];
  const addCandidate = (value, context = '') => {
    const imageUrl = value ? absoluteUrl(value, baseUrl) : null;
    if (isGoodActivityImageUrl(imageUrl)) candidates.push({ imageUrl, score: imageCandidateScore(imageUrl, context, activity) });
  };
  const metaTags = html.match(/<meta\s+[^>]*>/gi) || [];
  const imageMetaNames = ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];

  for (const tag of metaTags) {
    const name = (htmlAttr(tag, 'property') || htmlAttr(tag, 'name') || '').toLowerCase();
    const content = htmlAttr(tag, 'content');
    if (content && imageMetaNames.includes(name)) {
      addCandidate(content, name);
    }
  }

  const linkedImage = html.match(/<link\s+[^>]*rel=["'][^"']*image_src[^"']*["'][^>]*>/i)?.[0];
  const linkedHref = linkedImage ? htmlAttr(linkedImage, 'href') : null;
  const linkedUrl = linkedHref ? absoluteUrl(linkedHref, baseUrl) : null;
  if (isGoodActivityImageUrl(linkedUrl)) candidates.push({ imageUrl: linkedUrl, score: imageCandidateScore(linkedUrl, 'image source', activity) });

  const jsonLdImage = imageFromJsonLd(html, baseUrl);
  if (isGoodActivityImageUrl(jsonLdImage)) candidates.push({ imageUrl: jsonLdImage, score: imageCandidateScore(jsonLdImage, 'structured data', activity) });

  const imageTags = html.match(/<img\s+[^>]*>/gi) || [];
  for (const tag of imageTags) {
    const rawSrc =
      htmlAttr(tag, 'data-lazyload') ||
      htmlAttr(tag, 'data-src') ||
      htmlAttr(tag, 'data-lazy-src') ||
      htmlAttr(tag, 'data-original') ||
      htmlAttr(tag, 'src');
    const srcset = htmlAttr(tag, 'srcset') || htmlAttr(tag, 'data-srcset');
    const largestSrcsetImage = srcset
      ?.split(',')
      .map((entry) => {
        const [url, size] = entry.trim().split(/\s+/);
        return { url, width: Number(size?.replace(/\D/g, '') || 0) };
      })
      .sort((left, right) => right.width - left.width)[0]?.url;
    const context = [
      htmlAttr(tag, 'alt') || '',
      htmlAttr(tag, 'title') || '',
      htmlAttr(tag, 'class') || '',
      `width=${htmlAttr(tag, 'width') || ''}`,
      `height=${htmlAttr(tag, 'height') || ''}`,
    ].join(' ');
    addCandidate(largestSrcsetImage || rawSrc, context);
  }

  return candidates.sort((a, b) => b.score - a.score)[0]?.imageUrl || null;
}

async function fetchWebsiteImage(activity) {
  // Use the activity listing image before falling back to its organiser.
  for (const link of websiteLinksForActivity(activity)) {
    try {
      const parsed = new URL(link);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;

      const response = await fetch(parsed.toString(), {
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: {
          'User-Agent': 'Tiny Outings activity image bot (+https://tiny-outings)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) continue;

      const html = await response.text();
      const imageUrl = imageFromHtml(html, response.url || parsed.toString(), activity);
      if (imageUrl) return { imageUrl, imageSourceUrl: response.url || parsed.toString() };
    } catch {
      // Try the next candidate URL.
    }
  }

  return null;
}

async function enrichActivity(activity) {
  const websiteImage = await fetchWebsiteImage(activity);
  if (websiteImage?.imageUrl) {
    return {
      activity,
      source: 'website',
      googlePlaceId: activity.google_place_id,
      googlePlaceUri: activity.google_place_uri,
      googlePhotoUrl: null,
      googleRating: activity.google_rating,
      googleUserRatingCount: activity.google_user_rating_count,
      imageUrl: websiteImage.imageUrl,
      imageSourceUrl: websiteImage.imageSourceUrl,
    };
  }

  return {
    activity,
    source: 'missing',
    googlePlaceId: activity.google_place_id,
    googlePlaceUri: activity.google_place_uri,
    googlePhotoUrl: null,
    googleRating: activity.google_rating,
    googleUserRatingCount: activity.google_user_rating_count,
    imageUrl: null,
    imageSourceUrl: null,
  };
}

function updateValuesSql(enriched) {
  return [
    `${sqlString(enriched.activity.activity_id)}::uuid`,
    `${sqlString(enriched.googlePlaceId)}::text`,
    `${sqlString(enriched.googlePlaceUri)}::text`,
    `${sqlString(enriched.googlePhotoUrl)}::text`,
    `${enriched.googleRating ?? 'null'}::numeric`,
    `${enriched.googleUserRatingCount ?? 'null'}::integer`,
    `${sqlString(enriched.imageUrl)}::text`,
    `${sqlString(enriched.imageSourceUrl)}::text`,
  ].join(', ');
}

function bulkUpdateSql(enrichedRows, overwriteImages = false) {
  if (!enrichedRows.length) return '-- No image updates found.';

  return `with image_updates (
  activity_id,
  google_place_id,
  google_place_uri,
  google_photo_url,
  google_rating,
  google_user_rating_count,
  image_url,
  image_source_url
) as (
  values
    ${enrichedRows.map((row) => `(${updateValuesSql(row)})`).join(',\n    ')}
)
update public.activities as activities
set
  google_place_id = coalesce(image_updates.google_place_id, activities.google_place_id),
  google_place_uri = coalesce(image_updates.google_place_uri, activities.google_place_uri),
  google_photo_url = ${overwriteImages ? 'null' : 'coalesce(image_updates.google_photo_url, activities.google_photo_url)'},
  google_rating = coalesce(image_updates.google_rating, activities.google_rating),
  google_user_rating_count = coalesce(image_updates.google_user_rating_count, activities.google_user_rating_count),
  image_url = ${overwriteImages ? 'image_updates.image_url' : 'coalesce(image_updates.image_url, activities.image_url)'},
  image_source_url = ${overwriteImages ? 'image_updates.image_source_url' : 'coalesce(image_updates.image_source_url, activities.image_source_url)'},
  updated_at = now()
from image_updates
where activities.activity_id = image_updates.activity_id;`;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const force = process.argv.includes('--force');
  const missingOnly = process.argv.includes('--missing-only');
  const websiteOnly = process.argv.includes('--website-only');
  const activities = await fetchPublishedActivities();
  const scopedActivities = activities.filter((activity) => (
    (!categoryFilter || activity.category === categoryFilter)
    && (!sourceNameFilter || activity.source_name === sourceNameFilter)
    && (!organiserWebsiteFilter || activity.organiser_website === organiserWebsiteFilter)
  ));
  const targets = websiteOnly
    ? scopedActivities
    : force
    ? scopedActivities
    : missingOnly
      ? scopedActivities.filter((activity) => !activity.image_url && !activity.google_photo_url)
      : scopedActivities.filter((activity) => !activity.image_url || !activity.google_photo_url);

  console.log(`Found ${activities.length} published activities; ${scopedActivities.length} match scope; enriching ${targets.length}.`);
  console.log('Images are read from the activity listing, then the verified organiser website.');

  const enriched = await mapWithConcurrency(targets, websiteOnly ? 10 : 6, async (activity, index) => {
    if (websiteOnly) {
      const websiteImage = await fetchWebsiteImage(activity);
      const result = websiteImage?.imageUrl
        ? {
          activity,
          source: 'website',
          googlePlaceId: activity.google_place_id,
          googlePlaceUri: activity.google_place_uri,
          googlePhotoUrl: null,
          googleRating: activity.google_rating,
          googleUserRatingCount: activity.google_user_rating_count,
          imageUrl: websiteImage.imageUrl,
          imageSourceUrl: websiteImage.imageSourceUrl,
        }
        : {
          activity,
          source: 'missing',
          googlePlaceId: activity.google_place_id,
          googlePlaceUri: activity.google_place_uri,
          googlePhotoUrl: null,
          googleRating: activity.google_rating,
          googleUserRatingCount: activity.google_user_rating_count,
          imageUrl: null,
          imageSourceUrl: null,
        };
      if (verbose) console.log(`${index + 1}/${targets.length} ${result.source}: ${activity.activity_name}`);
      return result;
    }
    const result = await enrichActivity(activity);
    if (verbose) console.log(`${index + 1}/${targets.length} ${result.source}: ${activity.activity_name}`);
    return result;
  });

  const usable = enriched.filter((result) => result.imageUrl);
  const sql = [
    '-- Generated by scripts/enrich-activity-images.js',
    `-- Generated at ${new Date().toISOString()}`,
    websiteOnly
      ? '-- Applies website images only and clears legacy Google Places photo values.'
      : '-- Applies images found on the activity listing, then the organiser website.',
    bulkUpdateSql(usable, websiteOnly),
    '',
  ].join('\n\n');

  mkdirSync(dirname(outputSqlPath), { recursive: true });
  writeFileSync(outputSqlPath, sql);

  const summary = enriched.reduce((counts, result) => {
    counts[result.source] = (counts[result.source] || 0) + 1;
    return counts;
  }, {});
  console.log(`Wrote ${usable.length} SQL updates to ${outputSqlPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
