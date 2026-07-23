/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// Allow a targeted enrichment run without overwriting another pending image batch.
const outputSqlPath = process.env.ACTIVITY_IMAGE_OUTPUT
  ? join(repoRoot, process.env.ACTIVITY_IMAGE_OUTPUT)
  : join(repoRoot, 'supabase', 'seed', 'activity_image_updates.generated.sql');
const outputAuditPath = process.env.ACTIVITY_IMAGE_AUDIT_OUTPUT
  ? join(repoRoot, process.env.ACTIVITY_IMAGE_AUDIT_OUTPUT)
  : join(repoRoot, 'data', 'activity_image_audit.generated.json');

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

// These official programme images are more representative than the generic
// home-page, ticketing, or language-selector assets returned by their sites.
const curatedImageOverrides = [
  {
    // The site's older social preview returns a 404. This live Wix gallery
    // image is a clear, current food photo from Unity Cafe's own website.
    matches: (activity) => activity.activity_id === '2ff4ba86-ec3d-4409-ad63-58ce925ceeb5',
    imageUrl: 'https://static.wixstatic.com/media/b07a26_c699c85de5b340ef81377783a1fae040~mv2.jpg/v1/crop/x_10,y_0,w_2028,h_2047/fill/w_634,h_640,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/IMG_3803_edited_edited.jpg',
    imageSourceUrl: 'https://www.unitycafe.co.uk/',
  },
  {
    matches: (activity) => activity.activity_id === '2b2dca17-6b73-47c6-9582-183c2008b7d1',
    imageUrl: 'https://museumofbrands.com/wp-content/uploads/2023/07/Time_Tunnel_Thumbnail_Back.jpg',
    imageSourceUrl: 'https://museumofbrands.com/',
  },
  {
    matches: (activity) => /missionbodyfit/i.test(activity.activity_name || ''),
    imageUrl: 'https://www.missionbodyfit.com/quality_auto/904bc3_7b3f1a027f224e269e4201875204e9ad~mv2.jpg',
    imageSourceUrl: 'https://www.missionbodyfit.com/',
  },
  {
    // Happity supplies the activity's crisp, official class graphic. The
    // organiser page only exposes a deliberately blurred Wix thumbnail.
    matches: (activity) => activity.activity_id === '477dd3bf-03df-4e1d-b156-29f8cf562dd0',
    imageUrl: 'https://happity-production.s3.amazonaws.com/uploads/company/logo/11560/event_Baby_Yoga_at_LUFC_logo.png?v=1757943347',
    imageSourceUrl: 'https://www.happity.co.uk/schedules/baby-yoga-at-lufc-london-leytonstone-united-free-church-baby-yoga-at-lufc',
  },
  {
    // Happity's provider banner is a real Wee Movers class photo. The
    // organiser's blue plane artwork does not represent the activity.
    matches: (activity) => /wee movers/i.test(activity.activity_name || ''),
    imageUrl: 'https://happity-production.s3.amazonaws.com/uploads/company/banner/9625/Wee_Movers_banner.jpg?v=1715716435',
    imageSourceUrl: 'https://www.happity.co.uk/schedules/wee-movers-london-crate-walthamstow-wee-movers-preschool-creative-dance',
  },
  {
    // Happity supplies a real Bongalong class photo. The organiser page exposes
    // a Twitter social asset, which is not suitable for an activity card.
    matches: (activity) => /bongalong/i.test(activity.activity_name || ''),
    imageUrl: 'https://happity-production.s3.amazonaws.com/uploads/company/banner/433/Bongalong_banner.jpg?v=1681409656',
    imageSourceUrl: 'https://www.happity.co.uk/schedules/bongalong-london-the-quaker-meeting-house-under-ones-trial-session-fridays-11-00-11-45',
  },
  {
    // The organiser's Shopify storefront rate-limits image crawlers. Happity
    // provides this official programme graphic for the corresponding class.
    matches: (activity) => /treasure me kids/i.test(activity.activity_name || '') && /baby massage/i.test(activity.activity_name || ''),
    imageUrl: 'https://happity-production.s3.amazonaws.com/uploads/company/logo/10558/event_Treasure_Me_Kids_London_logo.jpeg?v=1775354189',
    imageSourceUrl: 'https://www.happity.co.uk/schedules/treasure-me-kids-london-london-walthamstow-toy-library-baby-massage-course-by-treasure-me-kids-london',
  },
  {
    // The organiser uses Linktree as its web address. Its Open Graph image is
    // generic, so retain a real activity flyer from the linked public gallery.
    matches: (activity) => /the castle play space/i.test(activity.activity_name || ''),
    imageUrl: 'https://scontent-lhr11-1.xx.fbcdn.net/v/t39.30808-6/564184670_122129102828956554_8342545195573448851_n.jpg?stp=dst-jpg_tt6&cstp=mx1080x1350&ctp=s1080x1350&_nc_cat=100&ccb=1-7&_nc_sid=833d8c&_nc_ohc=5FPs8AH0oXsQ7kNvwH-hNuz&_nc_oc=AdruFEVl8qG2z_J66mvY8EkqwJTbmz6SVrlvjDHbWhwRnisDuLfYWBZmqULhZgxyP3M&_nc_zt=23&_nc_ht=scontent-lhr11-1.xx&_nc_gid=jWdhh78EPM49PdhWDgY2Qw&_nc_ss=7b289&oh=00_AQDe6pUezqAA54sFdD6FBh9AWwiWwIpHRGV9s_WjD47zIA&oe=6A68634A',
    imageSourceUrl: 'https://www.facebook.com/people/The-Castle-Play-Space-CIC/61578696630205/',
  },
];

// A small, explicit set of recognisable cafe brands can fall back to their
// official app icon when a specific branch page does not publish a usable
// venue photo. This is deliberately used only after website extraction fails.
const cafeBrandLogoFallbacks = [
  {
    matches: (activity) => isCafe(activity) && /\bstarbucks\b/i.test(activity.activity_name || ''),
    imageUrl: 'https://www.starbucks.co.uk/assets/app/icons/apple-icon.png',
    imageSourceUrl: 'https://www.starbucks.co.uk/',
  },
];

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
    if (/^(?:facebook|twitter)[0-9_-]*\.(?:png|jpe?g|webp)$/.test(basename)) {
      return false;
    }
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
    '/flags/',
    'site-flag',
    'union-jack',
    'union_jack',
    'country-selector',
    'language-selector',
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
    'pixelated',
    'low-res',
    'lowres',
    'blurry',
    'facebook.com/tr',
    'facebook.net/tr',
    'facebook.png',
    'facebook.jpg',
    'facebook.jpeg',
    'facebook.webp',
    'twitter.png',
    'twitter.jpg',
    'twitter.jpeg',
    'twitter.webp',
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
    '/small_',
    '/uploads/company/logo/',
    '/x_small_',
    's100x100',
    'sloppyframe',
    'profile_pic',
    't51.2885-19/',
    'moon@2x',
    '150x150',
    '200x200',
    's200x200',
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

function dimensionsFromImageContext(imageUrl, context = '') {
  const contextWidth = Number(context.match(/\bwidth=(\d+)/i)?.[1] || 0);
  const contextHeight = Number(context.match(/\bheight=(\d+)/i)?.[1] || 0);
  const wixDimensions = [...String(imageUrl).matchAll(/(?:(?:\/|,)w_|[?&]w(?:idth)?=)(\d+).*?(?:(?:\/|,)h_|[?&]h(?:eight)?=)(\d+)/gi)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
  return {
    width: Math.max(contextWidth, ...wixDimensions.map((size) => size.width), 0),
    height: Math.max(contextHeight, ...wixDimensions.map((size) => size.height), 0),
  };
}

function isSocialMediaIconCandidate(imageUrl, context = '') {
  return /(facebook|instagram|twitter|tiktok|linkedin|pinterest|youtube|social[-_ ]?(?:icon|link|media))/i
    .test(`${imageUrl} ${context}`);
}

function isClearCafeLogoCandidate(imageUrl, context = '', activity = {}) {
  if (!isCafe(activity) || isSocialMediaIconCandidate(imageUrl, context)) return false;
  if (!/(?:logo|brand|wordmark)/i.test(`${imageUrl} ${context}`)) return false;
  if (!/\.(?:png|jpe?g|webp|avif)(?:[?#]|$)/i.test(imageUrl)) return false;
  const nameTerms = String(activity.activity_name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !['cafe', 'coffee', 'restaurant', 'bakery', 'shop']);
  if (!nameTerms.some((term) => `${imageUrl} ${context}`.toLowerCase().includes(term))) return false;
  const { width, height } = dimensionsFromImageContext(imageUrl, context);
  return width === 0 || height === 0 || (width >= 180 && height >= 120);
}

function imageCandidateScore(imageUrl, context = '', activity = {}) {
  const value = `${imageUrl} ${context}`.toLowerCase();
  let score = 0;
  if (/(original|full[-_]?size|large|hero|feature|gallery)/.test(value)) score += 10;
  if (/(thumbnail|thumb|150x150|300x300|400x400)/.test(value)) score -= 8;
  if (/\.gif(?:[?#]|$)/.test(value)) score -= 16;
  const { width, height } = dimensionsFromImageContext(imageUrl, context);
  if (width * height >= 180000) score += 8;
  if (width > 0 && height > 0 && width * height < 12000) score -= 12;
  const queryDimensions = [...value.matchAll(/[?&](?:w|width|h|height)=(\d+)/g)].map((match) => Number(match[1]));
  if (queryDimensions.some((dimension) => dimension >= 900)) score += 6;
  if (queryDimensions.some((dimension) => dimension > 0 && dimension < 180)) score -= 12;

  const activityTerms = String(activity.activity_name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !['with', 'from', 'this', 'that', 'class', 'activity', 'london', 'family', 'years'].includes(term));
  const matchingTerms = activityTerms.filter((term) => value.includes(term));
  score += Math.min(matchingTerms.length, 3) * 8;
  const categoryTerms = String(activity.category || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !['family', 'activities', 'outdoor'].includes(term));
  const matchingCategoryTerms = categoryTerms.filter((term) => value.includes(term));
  score += Math.min(matchingCategoryTerms.length, 2) * 10;
  if (isCafe(activity)) {
    // Cafe cards should show the place first, then food, then a clear brand
    // logo. The large gaps make this ordering deterministic for each page.
    if (/(interior|inside|venue|dining|seating|space|room|restaurant|cafe)/.test(value)) score += 600;
    else if (/(food|dish|cake|pastry|brunch|bakery|coffee|drink|menu)/.test(value)) score += 400;
    else if (isClearCafeLogoCandidate(imageUrl, context, activity)) score += 200;
    if (/(og:image|twitter:image|social-share|open-graph|default|banner)/.test(value)) score -= 18;
  } else if (/(interior|inside|venue|cafe|coffee|restaurant|food|gallery|play|studio|class|space|room|facility)/.test(value)) {
    score += 30;
  }
  // Across all importers, real activities and venues are more useful than
  // decorative graphics. These terms can come from an image's URL, alt text,
  // CSS classes, or metadata supplied by the source website.
  if (/(people|person|parent|mum|mom|dad|baby|toddler|child|children|kid|family|group|class|session|workshop|performance|dance|yoga)/.test(value)) score += 35;
  if (/(photo|photograph|gallery|interior|inside|venue|space|studio|room|food|dish|cake|pastry|coffee)/.test(value)) score += 25;
  if (/(graphic|illustration|drawing|cartoon|animation|plane|poster|flyer|template|stock)/.test(value)) score -= 45;
  if (/(hero|banner|cover|default|social-share)/.test(value)) score -= 6;
  if (/(logo|brand|wordmark|icon|avatar|badge)/.test(value)) score -= 20;
  return score;
}

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function websiteLinksForActivity(activity) {
  const links = [
    activity.organiser_website,
    activity.website,
    activity.source_url,
  ].filter((link) => link && !/google\./i.test(link));

  // Fever's listing page contains the activity-specific image, while an
  // organiser home page often only has generic brand artwork.
  if (activity.source_name === 'Fever London family listings') {
    return [...new Set([activity.website, activity.source_url, activity.organiser_website]
      .filter((link) => link && !/google\./i.test(link)))];
  }

  return [...new Set(links)];
}

function normaliseFeverImageUrl(imageUrl, activity) {
  if (activity?.source_name !== 'Fever London family listings') return imageUrl;

  try {
    const parsed = new URL(imageUrl);
    const photoPathIndex = parsed.pathname.indexOf('/fever2/plan/photo/');
    if (!parsed.hostname.endsWith('feverup.com') || photoPathIndex === -1) return imageUrl;
    const photoPath = parsed.pathname.slice(photoPathIndex + 1);
    return `https://applications-media.feverup.com/image/upload/f_auto,w_720,h_720/${photoPath}`;
  } catch {
    return imageUrl;
  }
}

function curatedImageForActivity(activity) {
  return curatedImageOverrides.find((override) => override.matches(activity)) || null;
}

function cafeBrandLogoForActivity(activity) {
  return cafeBrandLogoFallbacks.find((fallback) => fallback.matches(activity)) || null;
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

function feverListingImageFromHtml(html, baseUrl, activity) {
  if (activity.source_name !== 'Fever London family listings') return null;

  const metaTags = html.match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const name = (htmlAttr(tag, 'property') || htmlAttr(tag, 'name') || '').toLowerCase();
    const content = htmlAttr(tag, 'content');
    if (!['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(name)) continue;
    const imageUrl = content ? normaliseFeverImageUrl(absoluteUrl(content, baseUrl), activity) : null;
    if (isGoodActivityImageUrl(imageUrl)) return imageUrl;
  }

  return null;
}

function imageFromHtml(html, baseUrl, activity) {
  const candidates = [];
  const addCandidate = (value, context = '') => {
    const imageUrl = value ? normaliseFeverImageUrl(absoluteUrl(value, baseUrl), activity) : null;
    const isInterfaceAsset = /(site-flag|country-selector|language-selector|flag-icon)/i.test(context);
    const isClearCafeLogo = isClearCafeLogoCandidate(imageUrl, context, activity);
    if ((isGoodActivityImageUrl(imageUrl) || isClearCafeLogo) && !isInterfaceAsset && !isSocialMediaIconCandidate(imageUrl, context)) {
      const sourceBonus = /happity\.co\.uk/i.test(baseUrl) && /\/uploads\/company\/banner\//i.test(imageUrl)
        ? 80
        : 0;
      candidates.push({ imageUrl, score: imageCandidateScore(imageUrl, context, activity) + sourceBonus });
    }
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
  if (isGoodActivityImageUrl(linkedUrl) || isClearCafeLogoCandidate(linkedUrl, 'image source', activity)) {
    candidates.push({ imageUrl: linkedUrl, score: imageCandidateScore(linkedUrl, 'image source', activity) });
  }

  const jsonLdImage = imageFromJsonLd(html, baseUrl);
  if (isGoodActivityImageUrl(jsonLdImage) || isClearCafeLogoCandidate(jsonLdImage, 'structured data', activity)) {
    candidates.push({ imageUrl: jsonLdImage, score: imageCandidateScore(jsonLdImage, 'structured data', activity) });
  }

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

  // Many modern sites place their best photography in CSS backgrounds rather
  // than img tags. Include those candidates without treating them as logos.
  const backgroundUrls = [...html.matchAll(/background(?:-image)?\s*:\s*url\(([^)]+)\)/gi)];
  for (const match of backgroundUrls) {
    addCandidate(match[1].trim().replace(/^['"]|['"]$/g, ''), 'background image venue photo');
  }

  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

async function fetchWebsiteImage(activity) {
  const curatedImage = curatedImageForActivity(activity);
  if (curatedImage) return curatedImage;

  // Compare both official organiser and listing sources. This avoids letting a
  // usable but generic logo or graphic beat a stronger session or venue photo.
  const candidates = [];
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
      const feverImage = feverListingImageFromHtml(html, response.url || parsed.toString(), activity);
      if (feverImage) {
        candidates.push({ imageUrl: feverImage, imageSourceUrl: response.url || parsed.toString(), score: 90 });
      }
      const imageCandidate = imageFromHtml(html, response.url || parsed.toString(), activity);
      if (imageCandidate) {
        candidates.push({ ...imageCandidate, imageSourceUrl: response.url || parsed.toString() });
      }
    } catch {
      // Try the next candidate URL.
    }
  }

  return candidates.sort((left, right) => right.score - left.score)[0] || cafeBrandLogoForActivity(activity);
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

function auditCleanupSql() {
  return `-- Always serve images securely in the HTTPS mobile app.
update public.activities
set
  image_url = regexp_replace(image_url, '^http://', 'https://', 'i'),
  updated_at = now()
where image_url ~* '^http://';

-- Remove interface assets, tracking pixels, and other non-activity images.
-- The client displays a category illustration whenever image_url is null.
update public.activities
set
  image_url = null,
  image_source_url = null,
  updated_at = now()
where coalesce(image_url, '') ~* '(favicon|icon|logo|wordmark|strapline|sprite|avatar|placeholder|apple-touch|/flags/|site-flag|country-selector|language-selector|facebook[.]com/tr|facebook[.]net/tr|facebook[.](png|jpg|jpeg|webp)|twitter[0-9_-]*[.](png|jpg|jpeg|webp)|doubleclick|google-analytics|tracking-pixel|/pixel[.]|pixel[.]gif|[.]svg(?:[?#]|$)|google-play|google_play|app-store|app_store|download-button|/small_|150x150|200x200|s200x200|cookie|consent|newsletter|payment|checkout)'
  and (
    coalesce(image_source_url, '') !~* 'happity[.]co[.]uk'
    or coalesce(image_url, '') ~* '(facebook[.]com/tr|facebook[.]net/tr|facebook[.](png|jpg|jpeg|webp)|twitter[0-9_-]*[.](png|jpg|jpeg|webp)|/small_|150x150|200x200|s200x200)'
  );`;
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
  const audit = process.argv.includes('--audit');
  const websiteOnly = process.argv.includes('--website-only') || audit;
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
  console.log('Images are read from the verified organiser website, then the activity listing.');

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
  // A full audit must also remove a previous poor image when no suitable
  // organiser/listing image is found; the app then renders its illustration.
  const rowsToApply = websiteOnly ? enriched : usable;
  const sql = [
    '-- Generated by scripts/enrich-activity-images.js',
    `-- Generated at ${new Date().toISOString()}`,
    '-- Organiser images are preferred; listing images are the fallback.',
    '-- Cards without a usable website image render the in-app category illustration.',
    auditCleanupSql(),
    websiteOnly
      ? '-- Applies audited website images and clears legacy Google Places photo values.'
      : '-- Applies images found on the organiser website, then the activity listing.',
    bulkUpdateSql(rowsToApply, websiteOnly),
    '',
  ].join('\n\n');

  mkdirSync(dirname(outputSqlPath), { recursive: true });
  writeFileSync(outputSqlPath, sql);
  if (audit) {
    mkdirSync(dirname(outputAuditPath), { recursive: true });
    writeFileSync(outputAuditPath, JSON.stringify(enriched.map((result) => ({
      activity_id: result.activity.activity_id,
      activity_name: result.activity.activity_name,
      category: result.activity.category,
      source_name: result.activity.source_name,
      organiser_website: result.activity.organiser_website,
      previous_image_url: result.activity.image_url,
      image_url: result.imageUrl,
      image_source_url: result.imageSourceUrl,
      status: result.source,
    })), null, 2) + '\n');
  }

  const summary = enriched.reduce((counts, result) => {
    counts[result.source] = (counts[result.source] || 0) + 1;
    return counts;
  }, {});
  console.log(`Wrote ${rowsToApply.length} SQL updates to ${outputSqlPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
