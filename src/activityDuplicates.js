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
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return '';
  }
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
