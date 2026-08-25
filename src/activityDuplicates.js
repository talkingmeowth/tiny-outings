const duplicateComparisonStopWords = new Set([
  'a', 'an', 'and', 'at', 'class', 'classes', 'for', 'in', 'of', 'the', 'to', 'with',
]);

function comparisonText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function comparisonTokens(value) {
  return comparisonText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !duplicateComparisonStopWords.has(token));
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(comparisonTokens(left));
  const rightTokens = new Set(comparisonTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared / new Set([...leftTokens, ...rightTokens]).size;
}

function comparableActivityUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    });
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '').toLowerCase()}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || '';
}

function activityAddressKey(activity) {
  const postCode = postcode(activity.postcode || activity.address);
  return postCode || comparisonText(activity.address);
}

// Time is intentionally excluded. A recurring listing can run several times
// each week, but it should retain one recognisable image across every slot.
export function activityImageGroupKey(activity) {
  const name = comparisonText(activity.activity_name);
  const address = activityAddressKey(activity);
  if (name && address) return `venue:${name}|${address}`;

  const sourceUrl = comparableActivityUrl(activity.source_url).replace(/#.*/, '');
  if (sourceUrl) return `url:${sourceUrl}`;

  if (name && activity.google_place_id) return `place:${activity.google_place_id}|${name}`;
  return `activity:${String(activity.activity_id || '')}`;
}

function activityScheduleKey(activity) {
  const dates = [
    activity.activity_date,
    ...(Array.isArray(activity.available_dates) ? activity.available_dates : []),
    activity.availability_start_date,
    activity.availability_end_date,
  ].filter(Boolean).join(',');
  const days = [
    ...(Array.isArray(activity.days_of_week) ? activity.days_of_week : []),
    ...(Array.isArray(activity.available_days_of_week) ? activity.available_days_of_week : []),
  ].filter(Boolean).join(',');
  const times = [activity.start_time, activity.end_time].filter(Boolean).join('-');
  return [dates, days, times].filter(Boolean).join('|') || 'flexible';
}

function duplicateKeys(activity) {
  const name = comparisonText(activity.activity_name);
  const address = activityAddressKey(activity);
  const schedule = activityScheduleKey(activity);
  const keys = new Set();

  // Providers can have several classes at one venue. Keep each distinct
  // session visible and only collapse listings that also share a schedule.
  [activity.source_url]
    .map(comparableActivityUrl)
    .filter(Boolean)
    .forEach((url) => keys.add(`url:${url}|${schedule}`));

  if (name && address) keys.add(`venue:${name}|${address}|${schedule}`);
  if (name && activity.google_place_id) keys.add(`place:${activity.google_place_id}|${name}|${schedule}`);
  return keys;
}

function activityCompleteness(activity) {
  const fields = [
    'description',
    'card_summary',
    'website',
    'organiser_website',
    'google_place_uri',
    'google_place_id',
    'admin_cover_image_url',
    'reviewed_image_url',
    'user_image_url',
    'user_uploaded_image_url',
    'scraped_image_url',
    'organiser_website_downloaded_image',
    'website_downloaded_image',
    'wikimedia_image_url',
    'website_image_url',
    'listing_image_url',
  ];
  return fields.reduce((score, field) => score + (activity[field] ? 1 : 0), 0)
    + (activity.lat != null && activity.long != null ? 3 : 0)
    + (Number(activity.number_of_reviews || activity.google_user_rating_count || 0) > 0 ? 1 : 0);
}

function preferredActivity(left, right) {
  const leftScore = activityCompleteness(left);
  const rightScore = activityCompleteness(right);
  if (rightScore !== leftScore) return rightScore > leftScore ? right : left;

  const leftUpdated = Date.parse(left.updated_at || left.created_at || 0) || 0;
  const rightUpdated = Date.parse(right.updated_at || right.created_at || 0) || 0;
  return rightUpdated > leftUpdated ? right : left;
}

function isUsefulAddress(value) {
  const normalized = comparisonText(value);
  return normalized && !normalized.includes('address needs review') && !normalized.includes('address to review');
}

function duplicateMatchScore(submission, activity) {
  const submittedUrls = [submission.source_url, submission.website, submission.google_link, submission.google_place_uri]
    .map(comparableActivityUrl)
    .filter(Boolean);
  const activityUrls = [activity.source_url, activity.website, activity.google_link, activity.google_place_uri]
    .map(comparableActivityUrl)
    .filter(Boolean);
  if (submittedUrls.some((url) => activityUrls.includes(url))) return 1;

  const titleSimilarity = tokenSimilarity(submission.activity_name, activity.activity_name);
  const submittedHasAddress = isUsefulAddress(submission.address);
  const activityHasAddress = isUsefulAddress(activity.address);
  const submittedAddress = submittedHasAddress ? submission.address : submission.borough;
  const activityAddress = activityHasAddress ? activity.address : activity.borough;
  const addressSimilarity = tokenSimilarity(submittedAddress, activityAddress);
  const sameBorough = comparisonText(submission.borough)
    && comparisonText(submission.borough) === comparisonText(activity.borough);
  const onlyBoroughAvailable = !submittedHasAddress && !activityHasAddress && sameBorough;

  if (titleSimilarity >= 0.95 && (addressSimilarity >= 0.5 || onlyBoroughAvailable)) return 0.96;
  if (titleSimilarity >= 0.88 && addressSimilarity >= 0.72) return 0.92;
  return 0;
}

export function findLikelyDuplicate(submission, activities) {
  return activities
    .filter((activity) => activity.public_listing_status === 'published' && !activity.archive)
    .map((activity) => ({ activity, score: duplicateMatchScore(submission, activity) }))
    .filter((match) => match.score >= 0.9)
    .sort((left, right) => right.score - left.score)[0] || null;
}

// Imports can overlap while they are awaiting a later database consolidation.
// Keep a single, most complete card in the mobile directory without hiding
// similarly named activities that genuinely run at different venues.
export function dedupePublishedActivities(activities) {
  const deduplicated = [];
  const indexByKey = new Map();

  for (const activity of activities) {
    const keys = [...duplicateKeys(activity)];
    const matchingIndexes = [...new Set(keys.map((key) => indexByKey.get(key)).filter((index) => index != null))];

    if (!matchingIndexes.length) {
      const index = deduplicated.length;
      deduplicated.push(activity);
      keys.forEach((key) => indexByKey.set(key, index));
      continue;
    }

    const index = matchingIndexes[0];
    const winner = [...matchingIndexes.map((matchIndex) => deduplicated[matchIndex]), activity]
      .reduce(preferredActivity);
    deduplicated[index] = winner;
    matchingIndexes.slice(1).forEach((matchIndex) => {
      deduplicated[matchIndex] = null;
      for (const [key, storedIndex] of indexByKey) {
        if (storedIndex === matchIndex) indexByKey.set(key, index);
      }
    });
    duplicateKeys(winner).forEach((key) => indexByKey.set(key, index));
    keys.forEach((key) => indexByKey.set(key, index));
  }

  return deduplicated.filter(Boolean);
}
