const compact = (value) => String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const date = (value) => String(value || '').slice(0, 10);
const list = (value) => Array.isArray(value) ? [...new Set(value.map((item) => String(item).toLowerCase()))].sort().join(',') : '';
const time = (value) => String(value || '').slice(0, 5);
const present = (value) => value !== null && value !== undefined && value !== '';

export function humanProtected(activity) {
  return Boolean(activity.admin_cover_image_url || activity.reviewed_image_url || activity.user_image_url
    || activity.use_category_image || activity.image_review_approved_at || activity.reviewed_image_selected_at);
}

function identityKey(activity) {
  const name = compact(activity.activity_name);
  const address = compact(activity.address);
  if (name.length < 5 || address.length < 8) return '';
  const start = time(activity.start_time);
  const end = time(activity.end_time);
  // A missing timetable is too weak to collapse two independently imported activities.
  if (!start || !end) return '';
  return [name, address, compact(activity.category), date(activity.activity_date),
    list(activity.available_dates), list(activity.days_of_week), list(activity.available_days_of_week),
    start, end, compact(activity.availability_type), date(activity.availability_start_date),
    date(activity.availability_end_date), compact(activity.time_window)].join('|');
}

function sourceFamily(activity) {
  const value = `${activity.data_source || ''} ${activity.source_name || ''}`.toLowerCase();
  if (value.includes('happity')) return 'happity';
  if (value.includes('google places')) return 'google_places';
  if (value.includes('better start') || value.includes('best start')) return 'better_start';
  return compact(activity.data_source || activity.source_name);
}

function host(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function googlePlaceInUrl(value) {
  try { return new URL(value).searchParams.get('q')?.match(/^place_id:(.+)$/)?.[1] || ''; } catch { return ''; }
}

function compatiblePair(left, right) {
  if (left.google_place_id && right.google_place_id && left.google_place_id !== right.google_place_id) return false;
  const leftFamily = sourceFamily(left);
  const rightFamily = sourceFamily(right);
  if (leftFamily !== rightFamily) return false;
  const leftHost = host(left.source_url || left.website);
  const rightHost = host(right.source_url || right.website);
  if (!leftHost || leftHost !== rightHost) return false;
  if (leftFamily === 'google_places') {
    const leftPlace = googlePlaceInUrl(left.source_url);
    const rightPlace = googlePlaceInUrl(right.source_url);
    if (!leftPlace || leftPlace !== rightPlace || leftPlace !== left.google_place_id || rightPlace !== right.google_place_id) return false;
    if (left.website && right.website && left.website !== right.website) return false;
  }
  return true;
}

function keeperScore(activity) {
  const source = String(activity.source_url || '');
  return (humanProtected(activity) ? 1000 : 0)
    + (activity.public_listing_status === 'published' ? 100 : 0)
    + (/\/schedules\//.test(source) ? 20 : 0)
    + (/(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?-\d{1,2}-\d{2}/i.test(source) ? 10 : 0)
    + (present(activity.google_place_id) ? 2 : 0)
    + (present(activity.website) ? 1 : 0);
}

export function findExactDuplicateGroups(activities) {
  const buckets = new Map();
  for (const activity of activities) {
    const key = identityKey(activity);
    if (key) buckets.set(key, [...(buckets.get(key) || []), activity]);
  }
  const groups = [];
  const excluded = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    if (!bucket.every((left) => bucket.every((right) => compatiblePair(left, right)))) {
      excluded.push({ reason: 'conflicting source or place identity', activities: bucket });
      continue;
    }
    if (bucket.filter(humanProtected).length > 1) {
      excluded.push({ reason: 'multiple human-curated listings', activities: bucket });
      continue;
    }
    const ordered = [...bucket].sort((left, right) => keeperScore(right) - keeperScore(left)
      || String(left.created_at || '').localeCompare(String(right.created_at || ''))
      || left.activity_id.localeCompare(right.activity_id));
    groups.push({ keeper: ordered[0], duplicates: ordered.slice(1) });
  }
  return { groups, excluded };
}
