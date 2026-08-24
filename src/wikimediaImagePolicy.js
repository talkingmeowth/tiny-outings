const allowedWikimediaCategories = new Set([
  'parks and outdoor play',
  'museums and culture',
  'family activities',
]);

function normaliseCategory(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function allowsWikimediaImages(activityOrCategory) {
  const category = typeof activityOrCategory === 'object'
    ? activityOrCategory?.category
    : activityOrCategory;
  return allowedWikimediaCategories.has(normaliseCategory(category));
}

export function isWikimediaUrl(value) {
  if (!value) return false;
  try {
    const host = new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'wikimedia.org'
      || host.endsWith('.wikimedia.org')
      || host === 'wikipedia.org'
      || host.endsWith('.wikipedia.org');
  } catch {
    return false;
  }
}

export function isWikimediaSource(value) {
  return isWikimediaUrl(value) || /\b(?:wikimedia commons|wikipedia)\b/i.test(String(value || ''));
}
