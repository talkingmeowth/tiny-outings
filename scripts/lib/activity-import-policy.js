// Shared guardrails for every importer that creates family-directory records.

export { normaliseWalthamForestEventImageUrl } from './activity-image-policy.js';

const unsuitableFamilyCafeTypes = new Set([
  'bar',
  'bar_and_grill',
  'dog_cafe',
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
  // Past editorial decisions. Keep these exact names out even if Google later
  // assigns them a more general cafe type.
  'goods office',
  'park brew and kitchen',
  'cuppapug',
  'stone mini market',
  'yardarm',
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
  const types = [place.primaryType, ...(place.types || [])]
    .map((type) => String(type || '').toLowerCase())
    .filter(Boolean);
  if (types.some((type) => unsuitableFamilyCafeTypes.has(type))) return false;
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
