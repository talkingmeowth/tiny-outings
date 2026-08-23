import {
  isCafeActivity,
  isSocialMediaImage,
  isUsableActivityImageUrl,
  scoreActivityImage,
} from './activity-image-policy.js';

const genericImageTerms = new Set([
  'activity', 'activities', 'baby', 'babies', 'child', 'children', 'class', 'classes',
  'club', 'event', 'events', 'family', 'families', 'group', 'kids', 'london',
  'play', 'session', 'toddlers', 'toddler', 'workshop',
]);

const incompatiblePlaceTypes = {
  cafe: ['adult_education', 'church', 'library', 'mosque', 'school', 'university'],
  park: ['bar', 'casino', 'night_club'],
  museum: ['bar', 'casino', 'night_club'],
};

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function host(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function distinctiveTerms(activity) {
  return [...new Set(normalise(activity.activity_name).split(' ')
    .filter((term) => term.length >= 4 && !genericImageTerms.has(term)))];
}

function categoryFamily(category) {
  const value = normalise(category);
  if (/(cafe|coffee|food|bakery|restaurant)/.test(value)) return 'cafe';
  if (/(park|outdoor)/.test(value)) return 'park';
  if (/(museum|culture)/.test(value)) return 'museum';
  return null;
}

function isExpectedGooglePlaceType(activity) {
  const family = categoryFamily(activity.category);
  const primaryType = normalise(activity.google_primary_type).replaceAll(' ', '_');
  if (!family || !primaryType) return true;
  return !incompatiblePlaceTypes[family].includes(primaryType);
}

// This is deliberately conservative. A card is refreshable only where its
// persisted source gives a strong reason to believe the image is unsuitable;
// otherwise a human or a visual Google Places comparison should decide.
export function assessScrapedImage(activity) {
  const imageUrl = String(activity.scraped_image_url || '').trim();
  const sourceUrl = String(activity.image_source_url || '').trim();
  const context = [sourceUrl, activity.activity_name, activity.category, activity.description].join(' ');
  const reasons = [];
  let severity = 'pass';

  if (!imageUrl) return { severity: 'missing', reasons: ['No scraped image is stored.'], score: -100 };
  if (!isUsableActivityImageUrl(imageUrl)) {
    reasons.push('The stored card image has a blocked, invalid, or utility-asset URL.');
    severity = 'refresh';
  }
  if (!sourceUrl) {
    reasons.push('The scraped image has no retained source URL.');
    severity = severity === 'refresh' ? 'refresh' : 'review';
  }
  if (isSocialMediaImage(imageUrl, sourceUrl)) {
    reasons.push('The image or its source appears to be a social-media asset.');
    severity = 'refresh';
  }

  const imageScore = scoreActivityImage(imageUrl, context, activity);
  if (imageScore < -20) {
    reasons.push('Image URL quality signals indicate a likely graphic, logo, or low-quality asset.');
    severity = 'refresh';
  }

  const terms = distinctiveTerms(activity);
  const sourceText = normalise(`${imageUrl} ${sourceUrl}`);
  const matchingTerms = terms.filter((term) => sourceText.includes(term));
  const officialHosts = [host(activity.website), host(activity.organiser_website)].filter(Boolean);
  const sourceHost = host(sourceUrl);
  const linkedToOfficialSite = Boolean(sourceHost && officialHosts.some((official) => sourceHost === official || sourceHost.endsWith(`.${official}`)));
  if (terms.length && matchingTerms.length === 0 && !linkedToOfficialSite) {
    reasons.push('The image provenance contains no distinctive activity term or official-site host.');
    if (severity === 'pass') severity = 'review';
  }

  if (!isExpectedGooglePlaceType(activity)) {
    reasons.push(`The Google Places primary type (${activity.google_primary_type}) conflicts with the activity category.`);
    if (severity === 'pass') severity = 'review';
  }
  if (!activity.google_place_id) {
    reasons.push('No Google Places identity is available for a place-reference comparison.');
    if (severity === 'pass') severity = 'review';
  }

  return {
    severity,
    reasons,
    score: imageScore,
    image_url: imageUrl,
    image_source_url: sourceUrl || null,
    matching_terms: matchingTerms,
    google_place_aligned: isExpectedGooglePlaceType(activity),
  };
}

export function refreshableScrapedImage(activity) {
  return assessScrapedImage(activity).severity === 'refresh';
}

const cafeInteriorTerms = /(interior|inside|dining|seating|table|tables|venue[-_ ]?space|play[-_ ]?space|room)/i;
const cafeExteriorTerms = /(front|exterior|facade|shopfront|storefront|outside|street)/i;
const cafeFoodTerms = /(food|dish|cake|pastry|brunch|bakery|drink|menu)/i;
const cafeLogoTerms = /(favicon|icon|logo|brand|wordmark)/i;

// A stored SerpAPI source URL is the durable provenance we retain after the
// image is copied into Supabase Storage. Only unambiguous logo signals become
// automatic replacement candidates; ambiguous imagery remains untouched.
export function isSerpApiLogoImage(activity) {
  if (!activity?.scraped_image_url) return false;
  return cafeLogoTerms.test(`${activity.scraped_image_url} ${activity.image_source_url || ''}`);
}

// SerpAPI persists the source URL, rather than a complete caption. This
// classification therefore only changes images where the URL itself gives a
// clear signal that the card is food-led or a logo. Ambiguous images stay put.
export function assessCafeSerpApiPresentation(activity) {
  if (!isCafeActivity(activity) || !activity.scraped_image_url) return null;
  const source = `${activity.scraped_image_url} ${activity.image_source_url || ''}`;
  if (cafeInteriorTerms.test(source)) return { outcome: 'retain', reason: 'Venue interior signal.' };
  if (cafeExteriorTerms.test(source)) return { outcome: 'retain', reason: 'Venue exterior signal.' };
  if (cafeLogoTerms.test(source)) return { outcome: 'refresh', reason: 'Logo or brand asset.' };
  if (cafeFoodTerms.test(source)) return { outcome: 'refresh', reason: 'Food or menu image.' };
  return { outcome: 'review', reason: 'No reliable interior, exterior, food, or logo signal.' };
}

export function cafePresentationSummary(rows) {
  return rows.reduce((summary, row) => {
    summary[row.assessment.outcome] = (summary[row.assessment.outcome] || 0) + 1;
    return summary;
  }, { retain: 0, review: 0, refresh: 0 });
}

export function imageAuditSummary(rows) {
  return rows.reduce((summary, row) => {
    summary[row.assessment.severity] = (summary[row.assessment.severity] || 0) + 1;
    return summary;
  }, { pass: 0, review: 0, refresh: 0, missing: 0 });
}

export { isCafeActivity };
