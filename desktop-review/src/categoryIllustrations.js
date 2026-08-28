const CATEGORY_ILLUSTRATIONS = {
  park: 'park-placeholder.svg',
  bookshop: 'bookshop-placeholder.svg',
  cafe: 'family-cafe-placeholder.svg',
  default: 'family-outing-placeholder.svg',
};

export const CATEGORY_ILLUSTRATION_SELECTION_KIND = 'category_illustration';

export function categoryIllustrationFilename(activity) {
  const category = String(activity?.category || '').toLowerCase();
  if (category.includes('park')) return CATEGORY_ILLUSTRATIONS.park;
  if (category.includes('book')) return CATEGORY_ILLUSTRATIONS.bookshop;
  if (category.includes('cafe') || category.includes('café')) return CATEGORY_ILLUSTRATIONS.cafe;
  return CATEGORY_ILLUSTRATIONS.default;
}

export function categoryIllustrationCandidate(activity) {
  const filename = categoryIllustrationFilename(activity);
  const baseUrl = import.meta.env?.BASE_URL || '/review/';
  const imageUrl = `${baseUrl}images/${filename}`;
  const category = String(activity?.category || 'Family activity').trim();
  return {
    image_url: imageUrl,
    thumbnail_url: imageUrl,
    source_page_url: null,
    source_domain: 'Tiny Outings illustration',
    title: `${category} illustrated category image`,
    width: null,
    height: null,
    relevance_reason: 'Illustrated category option used by Tiny Outings.',
    selection_kind: CATEGORY_ILLUSTRATION_SELECTION_KIND,
    is_category_illustration: true,
  };
}
