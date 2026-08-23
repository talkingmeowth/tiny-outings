// Shared image rules for importers and the post-import curation pass.

export function normaliseWalthamForestEventImageUrl(imageUrl) {
  if (!imageUrl || !/walthamforest\.gov\.uk/i.test(imageUrl)) return imageUrl;
  return imageUrl.replace(
    '/styles/x_small_3_2_546_x_364_/public/',
    '/styles/large_3_2_2x/public/',
  );
}

export function normaliseFeverImageUrl(imageUrl) {
  if (!imageUrl) return imageUrl;
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

export function isCafeActivity(activity = {}) {
  return /cafe|coffee|food|lunch|bakery/i.test(activity.category || '');
}

export function imageDimensions(imageUrl, context = '') {
  const contextWidth = Number(context.match(/\bwidth=(\d+)/i)?.[1] || 0);
  const contextHeight = Number(context.match(/\bheight=(\d+)/i)?.[1] || 0);
  const urlSizes = [...String(imageUrl).matchAll(/(?:(?:\/|,)w_|[?&]w(?:idth)?=)(\d+).*?(?:(?:\/|,)h_|[?&]h(?:eight)?=)(\d+)/gi)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
  return {
    width: Math.max(contextWidth, ...urlSizes.map((size) => size.width), 0),
    height: Math.max(contextHeight, ...urlSizes.map((size) => size.height), 0),
  };
}

export function isSocialMediaImage(imageUrl, context = '') {
  return /(facebook|fbcdn|scontent|cdninstagram|instagram|twitter|twimg|tiktok|linkedin|pinterest|youtube|social[-_ ]?(?:icon|link|media))/i
    .test(`${imageUrl} ${context}`);
}

const blockedImageTerms = [
  'favicon', 'icon', 'logo', 'brand', 'wordmark', 'header', 'footer',
  '/flags/', 'site-flag', 'union-jack', 'union_jack', 'country-selector',
  'language-selector', 'sprite', 'avatar', 'placeholder', 'apple-touch',
  'loading', 'spinner', 'pixelated', 'low-res', 'lowres', 'blurry',
  'facebook.com/tr', 'facebook.net/tr', 'facebook.png', 'facebook.jpg',
  'facebook.jpeg', 'facebook.webp', 'twitter.png', 'twitter.jpg',
  'twitter.jpeg', 'twitter.webp', 'doubleclick.net', 'google-analytics.com',
  'tracking-pixel', '/pixel.', 'pixel.gif', '.svg', 'google-play',
  'google_play', 'app-store', 'app_store', 'download-button', '/small_',
  '/uploads/company/logo/', '/x_small_', 's100x100', 'sloppyframe',
  'profile_pic', 't51.2885-19/', 'moon@2x', '150x150', '200x200',
  's200x200', 'cookie', 'consent', 'newsletter', 'payment', 'checkout',
  'fbcdn', 'scontent', 'cdninstagram', 'twimg',
];

export function isUsableActivityImageUrl(imageUrl, { allowCafeLogo = false } = {}) {
  if (!imageUrl) return false;
  const value = imageUrl.toLowerCase();
  try {
    const parsed = new URL(imageUrl);
    const basename = parsed.pathname.toLowerCase().split('/').pop() || '';
    if (/^(?:facebook|twitter)[0-9_-]*\.(?:png|jpe?g|webp)$/.test(basename)) return false;
    if (
      parsed.hostname.includes('walthamforest.gov.uk')
      && parsed.pathname.includes('/sites/default/files/2026-06/')
      && basename.endsWith('.png')
    ) return false;
  } catch {
    return false;
  }

  if (allowCafeLogo) {
    return !blockedImageTerms.filter((term) => !['logo', 'brand', 'wordmark'].includes(term))
      .some((term) => value.includes(term));
  }
  return !blockedImageTerms.some((term) => value.includes(term));
}

export function isClearCafeLogoCandidate(imageUrl, context = '', activity = {}) {
  if (!isCafeActivity(activity) || isSocialMediaImage(imageUrl, context)) return false;
  if (!/(?:logo|brand|wordmark)/i.test(`${imageUrl} ${context}`)) return false;
  if (!/\.(?:png|jpe?g|webp|avif)(?:[?#]|$)/i.test(imageUrl)) return false;
  const nameTerms = String(activity.activity_name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !['cafe', 'coffee', 'restaurant', 'bakery', 'shop'].includes(term));
  if (!nameTerms.some((term) => `${imageUrl} ${context}`.toLowerCase().includes(term))) return false;
  const { width, height } = imageDimensions(imageUrl, context);
  return (width === 0 || height === 0 || (width >= 180 && height >= 120))
    && isUsableActivityImageUrl(imageUrl, { allowCafeLogo: true });
}

export function scoreActivityImage(imageUrl, context = '', activity = {}) {
  const value = `${imageUrl} ${context}`.toLowerCase();
  let score = 0;
  if (/(original|full[-_]?size|large|hero|feature|gallery)/.test(value)) score += 10;
  if (/(thumbnail|thumb|150x150|300x300|400x400)/.test(value)) score -= 8;
  if (/\.gif(?:[?#]|$)/.test(value)) score -= 16;
  const { width, height } = imageDimensions(imageUrl, context);
  if (width * height >= 180000) score += 8;
  if (width > 0 && height > 0 && width * height < 12000) score -= 12;
  const queryDimensions = [...value.matchAll(/[?&](?:w|width|h|height)=(\d+)/g)].map((match) => Number(match[1]));
  if (queryDimensions.some((dimension) => dimension >= 900)) score += 6;
  if (queryDimensions.some((dimension) => dimension > 0 && dimension < 180)) score -= 12;
  const activityTerms = String(activity.activity_name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !['with', 'from', 'this', 'that', 'class', 'activity', 'london', 'family', 'years'].includes(term));
  score += Math.min(activityTerms.filter((term) => value.includes(term)).length, 3) * 8;
  const categoryTerms = String(activity.category || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !['family', 'activities', 'outdoor'].includes(term));
  score += Math.min(categoryTerms.filter((term) => value.includes(term)).length, 2) * 10;
  if (isCafeActivity(activity)) {
    // A venue name often includes "cafe" or "restaurant". Those words alone
    // do not prove an image shows the interior, so require a more specific
    // scene cue before giving the strongest family-cafe preference.
    if (/(interior|inside|dining|seating|table|tables|venue[-_ ]?space|play[-_ ]?space|room)/.test(value)) score += 600;
    else if (/(front|exterior|facade|shopfront|storefront|outside|street)/.test(value)) score += 450;
    else if (/(food|dish|cake|pastry|brunch|bakery|coffee|drink|menu)/.test(value)) score += 200;
    else if (isClearCafeLogoCandidate(imageUrl, context, activity)) score += 200;
    if (/(og:image|twitter:image|social-share|open-graph|default|banner)/.test(value)) score -= 18;
  } else if (/(interior|inside|venue|cafe|coffee|restaurant|food|gallery|play|studio|class|space|room|facility)/.test(value)) {
    score += 30;
  }
  if (/(people|person|parent|mum|mom|dad|baby|toddler|child|children|kid|family|group|class|session|workshop|performance|dance|yoga)/.test(value)) score += 35;
  if (/(photo|photograph|gallery|interior|inside|venue|space|studio|room|food|dish|cake|pastry|coffee)/.test(value)) score += 25;
  if (/(graphic|illustration|drawing|cartoon|animation|plane|poster|flyer|template|stock)/.test(value)) score -= 45;
  if (/(hero|banner|cover|default|social-share)/.test(value)) score -= 6;
  if (/(logo|brand|wordmark|icon|avatar|badge)/.test(value)) score -= 20;
  return score;
}
