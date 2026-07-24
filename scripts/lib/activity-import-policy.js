// Shared guardrails for every importer that creates family-directory records.

const unsuitableFamilyCafeTypes = new Set([
  'bar',
  'pub',
  'night_club',
  'casino',
  'liquor_store',
]);

const excludedFamilyCafePlaceIds = new Set([
  // Manually reviewed as unsuitable for the family directory.
  'ChIJy8yEC48ddkgRlogHHcXa_Ew',
]);

const excludedFamilyCafeNames = new Set([
  'elite cafe',
  'forest bistro cafe 1',
]);

function normaliseName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isFamilyCafePlace(place) {
  if (!place || place.businessStatus === 'CLOSED_PERMANENTLY') return false;
  if (unsuitableFamilyCafeTypes.has(place.primaryType)) return false;
  if (excludedFamilyCafePlaceIds.has(place.id)) return false;
  return !excludedFamilyCafeNames.has(normaliseName(place.displayName?.text));
}

// Parks are deliberately lightweight, map-led listings. A website or image
// source is not imported because those links often point to generic council
// pages rather than the specific park.
export const parkExternalFields = Object.freeze({
  website: null,
  organiser_website: null,
  image_url: null,
  image_source_url: null,
});

export function normaliseWalthamForestEventImageUrl(imageUrl) {
  if (!imageUrl || !/walthamforest\.gov\.uk/i.test(imageUrl)) return imageUrl;
  return imageUrl.replace(
    '/styles/x_small_3_2_546_x_364_/public/',
    '/styles/large_3_2_2x/public/',
  );
}
