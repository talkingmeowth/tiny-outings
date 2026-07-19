/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// Allow a targeted enrichment run without overwriting another pending image batch.
const outputSqlPath = process.env.ACTIVITY_IMAGE_OUTPUT
  ? join(repoRoot, process.env.ACTIVITY_IMAGE_OUTPUT)
  : join(repoRoot, 'supabase', 'seed', 'activity_image_updates.generated.sql');

const placeFields = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.googleMapsUri',
  'places.websiteUri',
  'places.photos',
  'places.rating',
  'places.userRatingCount',
].join(',');

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
const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const categoryFilter = process.env.ACTIVITY_IMAGE_CATEGORY || null;
const sourceNameFilter = process.env.ACTIVITY_IMAGE_SOURCE_NAME || null;

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
  ].some((blocked) => value.includes(blocked));
}

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bestLinkForActivity(activity) {
  return activity.organiser_website || activity.website || activity.source_url || activity.google_link || activity.google_place_uri || null;
}

function googleSearchQuery(activity) {
  return [
    activity.activity_name,
    activity.address,
    activity.borough,
    'London',
  ].filter(Boolean).join(', ');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs || 12000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${text.slice(0, 220)}`);
  }

  return response.json();
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

async function searchGooglePlace(activity) {
  if (!googleApiKey) return null;

  try {
    const body = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      timeoutMs: 15000,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': placeFields,
      },
      body: JSON.stringify({
        textQuery: googleSearchQuery(activity),
        languageCode: 'en-GB',
        regionCode: 'GB',
        locationBias: {
          circle: {
            center: {
              latitude: Number(activity.lat) || 51.56,
              longitude: Number(activity.long) || -0.04,
            },
            radius: 12000,
          },
        },
      }),
    });
    return body.places?.[0] || null;
  } catch (error) {
    console.warn(`Google lookup failed for ${activity.activity_name}: ${error.message}`);
    return null;
  }
}

async function fetchGooglePhotoUrl(place) {
  const photoName = place?.photos?.[0]?.name;
  if (!googleApiKey || !photoName) return null;

  try {
    const body = await fetchJson(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200&skipHttpRedirect=true`,
      {
        timeoutMs: 15000,
        headers: {
          'X-Goog-Api-Key': googleApiKey,
        },
      },
    );
    return body.photoUri || null;
  } catch (error) {
    console.warn(`Google photo failed for ${place.displayName?.text || place.id}: ${error.message}`);
    return null;
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

function imageFromHtml(html, baseUrl) {
  const metaTags = html.match(/<meta\s+[^>]*>/gi) || [];
  const imageMetaNames = ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];

  for (const tag of metaTags) {
    const name = (htmlAttr(tag, 'property') || htmlAttr(tag, 'name') || '').toLowerCase();
    const content = htmlAttr(tag, 'content');
    if (content && imageMetaNames.includes(name)) {
      const imageUrl = absoluteUrl(content, baseUrl);
      if (isGoodActivityImageUrl(imageUrl)) return imageUrl;
    }
  }

  const linkedImage = html.match(/<link\s+[^>]*rel=["'][^"']*image_src[^"']*["'][^>]*>/i)?.[0];
  const linkedHref = linkedImage ? htmlAttr(linkedImage, 'href') : null;
  const linkedUrl = linkedHref ? absoluteUrl(linkedHref, baseUrl) : null;
  if (isGoodActivityImageUrl(linkedUrl)) return linkedUrl;

  const jsonLdImage = imageFromJsonLd(html, baseUrl);
  if (isGoodActivityImageUrl(jsonLdImage)) return jsonLdImage;

  const imageTags = html.match(/<img\s+[^>]*>/gi) || [];
  for (const tag of imageTags) {
    const rawSrc =
      htmlAttr(tag, 'src') ||
      htmlAttr(tag, 'data-src') ||
      htmlAttr(tag, 'data-lazy-src') ||
      htmlAttr(tag, 'data-original');
    const imageUrl = rawSrc ? absoluteUrl(rawSrc, baseUrl) : null;
    if (!isGoodActivityImageUrl(imageUrl)) continue;
    return imageUrl;
  }

  return null;
}

async function fetchWebsiteImage(activity) {
  const link = bestLinkForActivity(activity);
  if (!link) return null;

  try {
    const parsed = new URL(link);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (/google\./i.test(parsed.hostname)) return null;

    const response = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Tiny Outings activity image bot (+https://tiny-outings)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const html = await response.text();
    const imageUrl = imageFromHtml(html, response.url || parsed.toString());
    return imageUrl ? { imageUrl, imageSourceUrl: response.url || parsed.toString() } : null;
  } catch {
    return null;
  }
}

async function enrichActivity(activity) {
  const place = await searchGooglePlace(activity);
  const googlePhotoUrl = await fetchGooglePhotoUrl(place);

  if (googlePhotoUrl) {
    return {
      activity,
      source: 'google',
      googlePlaceId: place.id || activity.google_place_id,
      googlePlaceUri: place.googleMapsUri || activity.google_place_uri,
      googlePhotoUrl,
      googleRating: place.rating ?? activity.google_rating,
      googleUserRatingCount: place.userRatingCount ?? activity.google_user_rating_count,
      imageUrl: googlePhotoUrl,
      imageSourceUrl: place.googleMapsUri || activity.google_place_uri || bestLinkForActivity(activity),
    };
  }

  const websiteImage = await fetchWebsiteImage(activity);
  if (websiteImage?.imageUrl) {
    return {
      activity,
      source: 'website',
      googlePlaceId: place?.id || activity.google_place_id,
      googlePlaceUri: place?.googleMapsUri || activity.google_place_uri,
      googlePhotoUrl: activity.google_photo_url,
      googleRating: place?.rating ?? activity.google_rating,
      googleUserRatingCount: place?.userRatingCount ?? activity.google_user_rating_count,
      imageUrl: websiteImage.imageUrl,
      imageSourceUrl: websiteImage.imageSourceUrl,
    };
  }

  return {
    activity,
    source: 'missing',
    googlePlaceId: place?.id || activity.google_place_id,
    googlePlaceUri: place?.googleMapsUri || activity.google_place_uri,
    googlePhotoUrl: activity.google_photo_url,
    googleRating: place?.rating ?? activity.google_rating,
    googleUserRatingCount: place?.userRatingCount ?? activity.google_user_rating_count,
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
  ));
  const targets = websiteOnly
    ? scopedActivities
    : force
    ? scopedActivities
    : missingOnly
      ? scopedActivities.filter((activity) => !activity.image_url && !activity.google_photo_url)
      : scopedActivities.filter((activity) => !activity.image_url || !activity.google_photo_url);

  console.log(`Found ${activities.length} published activities; ${scopedActivities.length} match scope; enriching ${targets.length}.`);
  console.log(websiteOnly
    ? 'Website-only mode: Google image values will be cleared.'
    : googleApiKey
      ? 'Google Places key found; Google photos will be tried first.'
      : 'No Google Places key found; using website images only.');

  const enriched = await mapWithConcurrency(targets, websiteOnly ? 10 : googleApiKey ? 3 : 6, async (activity, index) => {
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
      console.log(`${index + 1}/${targets.length} ${result.source}: ${activity.activity_name}`);
      return result;
    }
    const result = await enrichActivity(activity);
    console.log(`${index + 1}/${targets.length} ${result.source}: ${activity.activity_name}`);
    return result;
  });

  const usable = enriched.filter(
    (result) =>
      result.googlePlaceId ||
      result.googlePlaceUri ||
      result.googlePhotoUrl ||
      result.imageUrl,
  );
  const sql = [
    '-- Generated by scripts/enrich-activity-images.js',
    `-- Generated at ${new Date().toISOString()}`,
    websiteOnly
      ? '-- Applies website images only and clears Google Places photo values.'
      : '-- Applies Google Places image metadata first, with website image fallbacks.',
    bulkUpdateSql(websiteOnly ? enriched : usable, websiteOnly),
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
