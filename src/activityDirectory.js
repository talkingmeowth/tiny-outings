function searchableName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isDirectorySearchResult(activity, query, hiddenActivityIds = new Set()) {
  if (!activity || activity.public_listing_status !== 'published' || activity.archive) return false;
  if (hiddenActivityIds.has(String(activity.activity_id))) return false;

  const queryTerms = searchableName(query).split(/\s+/).filter(Boolean);
  if (!queryTerms.length) return true;

  const name = searchableName(activity.activity_name);
  return queryTerms.every((term) => name.includes(term));
}
