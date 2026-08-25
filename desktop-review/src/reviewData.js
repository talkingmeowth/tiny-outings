import { activityImageGroupKey } from '../../src/activityDuplicates.js';
import { allowsWikimediaImages, isWikimediaUrl } from '../../src/wikimediaImagePolicy.js';

// The desktop reviewer owns this hierarchy. Keeping it here prevents the
// standalone review tool from changing the mobile application's card logic.
const activityImageFields = [
  'admin_cover_image_url',
  'reviewed_image_url',
  'user_image_url',
  'audit_image_url',
  'user_uploaded_image_url',
  'organiser_website_downloaded_image',
  'website_downloaded_image',
  'wikimedia_image_url',
  'website_image_url',
  'listing_image_url',
];

function securePhotoUrl(url) {
  return String(url || '').trim().replace(/^http:\/\//i, 'https://');
}

function isUsablePhotoUrl(url) {
  return Boolean(url) && !['image.thum.io', 's.wordpress.com/mshots'].some((blocked) => url.includes(blocked));
}

function isAllowedActivityPhoto(activity, field, url) {
  if (field === 'audit_image_url' && activity?.audit_image_status !== 'replaced') return false;
  if (allowsWikimediaImages(activity)) return true;
  if (field === 'wikimedia_image_url' || isWikimediaUrl(url)) return false;
  if (field === 'audit_image_url') return !isWikimediaUrl(activity?.audit_image_source_url);
  return true;
}

function candidateImage(activity) {
  for (let priority = 0; priority < activityImageFields.length; priority += 1) {
    const field = activityImageFields[priority];
    const url = securePhotoUrl(activity?.[field]);
    if (isUsablePhotoUrl(url) && isAllowedActivityPhoto(activity, field, url)) return { field, priority, url };
  }
  return null;
}

function isPreferredImage(candidate, current) {
  if (!current) return true;
  if (candidate.priority !== current.priority) return candidate.priority < current.priority;
  const candidateUpdated = Date.parse(candidate.activity.updated_at || candidate.activity.created_at || 0) || 0;
  const currentUpdated = Date.parse(current.activity.updated_at || current.activity.created_at || 0) || 0;
  if (candidateUpdated !== currentUpdated) return candidateUpdated > currentUpdated;
  return String(candidate.activity.activity_id) < String(current.activity.activity_id);
}

function shareListingImages(activities) {
  const imageByListing = new Map();
  activities.forEach((activity) => {
    const image = candidateImage(activity);
    if (!image) return;
    const key = activityImageGroupKey(activity);
    const candidate = { ...image, activity };
    const current = imageByListing.get(key);
    if (isPreferredImage(candidate, current)) imageByListing.set(key, candidate);
  });
  return activities.map((activity) => {
    const sharedImage = imageByListing.get(activityImageGroupKey(activity));
    if (!sharedImage || !isAllowedActivityPhoto(activity, sharedImage.field, sharedImage.url)) return activity;
    return { ...activity, shared_card_image_url: sharedImage.url, shared_card_image_source: sharedImage.field };
  });
}

export const QUEUES = [
  { id: 'missing_published', label: 'Missing — Published', description: 'Live listings with no usable card image.' },
  { id: 'unsuitable_audit', label: 'Unsuitable — Audit', description: 'Listings the image audit marked for replacement.' },
  { id: 'all_published', label: 'All — Published', description: 'Every live listing, with or without an image.' },
  { id: 'all_draft', label: 'All — Draft', description: 'Every unpublished listing.' },
  { id: 'ignored', label: 'Ignored', description: 'Listings removed from active image review.' },
];

export const IMAGE_SOURCE_LABELS = {
  admin_cover_image_url: 'Admin cover',
  reviewed_image_url: 'Desktop review',
  user_image_url: 'Admin image URL',
  audit_image_url: 'Audit replacement',
  user_uploaded_image_url: 'User upload',
  organiser_website_downloaded_image: 'Organiser website download',
  website_downloaded_image: 'Website download',
  wikimedia_image_url: 'Wikimedia',
  website_image_url: 'Website image',
  listing_image_url: 'Listing image',
};

export function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function domain(value) {
  try {
    return new URL(clean(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function providerFromDomain(value) {
  const host = domain(value);
  if (!host) return '';
  const parts = host.split('.');
  const stem = parts.length > 2 && ['co', 'org', 'ac'].includes(parts.at(-2)) ? parts.at(-3) : parts.at(-2) || parts[0];
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function providerLabel(activity) {
  const provider = providerFromDomain(activity.organiser_website) || providerFromDomain(activity.website);
  if (provider && !/^(facebook|instagram|eventbrite|happity|google)$/i.test(provider)) return provider;
  const sourceName = clean(activity.source_name);
  return /^(google|manual|import|website|unknown)/i.test(sourceName) ? '' : sourceName;
}

export function bestLocation(activity) {
  const address = clean(activity.address);
  const addressParts = address.split(',').map(clean).filter(Boolean);
  const locality = [...addressParts].reverse().find((part) => {
    const withoutPostcode = part.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/ig, '').trim();
    return withoutPostcode
      && !/^(england|united kingdom|uk|greater london)$/i.test(withoutPostcode)
      && !/^london$/i.test(withoutPostcode)
      && !/\d/.test(withoutPostcode);
  });
  if (locality) return locality;
  const borough = clean(activity.borough);
  if (borough) return borough;
  const postcode = clean(activity.postcode || address).match(/\b[A-Z]{1,2}\d[A-Z\d]?/i)?.[0]?.toUpperCase();
  return postcode ? `${postcode} London` : 'London';
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function combineWithoutDuplicate(label, location) {
  const cleanLabel = clean(label);
  const cleanLocation = clean(location);
  if (!cleanLocation) return cleanLabel;
  const labelText = normalized(cleanLabel);
  const locationText = normalized(cleanLocation);
  const locality = locationText.split(' ').filter((part) => !['london', 'greater'].includes(part)).join(' ');
  if (labelText.includes(locationText) || (locality && labelText.includes(locality))) return cleanLabel;
  return `${cleanLabel} ${cleanLocation}`.trim();
}

export function searchQueries(activity) {
  const name = clean(activity.activity_name) || 'Untitled activity';
  const location = bestLocation(activity);
  const provider = providerLabel(activity);
  return {
    activity_location: combineWithoutDuplicate(name, location),
    provider_location: combineWithoutDuplicate(provider || name, location),
    activity_only: name,
  };
}

export function currentImage(activity) {
  const ownImage = candidateImage(activity);
  const url = activity.shared_card_image_url || ownImage?.url || '';
  const field = activity.shared_card_image_source || ownImage?.field || '';
  let sourceUrl = url;
  if (field === 'reviewed_image_url') sourceUrl = activity.reviewed_image_source_url || activity.reviewed_image_original_url || url;
  if (field === 'audit_image_url') sourceUrl = activity.audit_image_source_url || url;
  if (['organiser_website_downloaded_image', 'website_downloaded_image', 'website_image_url', 'listing_image_url'].includes(field)) {
    sourceUrl = activity.image_source_url || activity.organiser_website || activity.website || activity.source_url || url;
  }
  return { url, field, label: IMAGE_SOURCE_LABELS[field] || 'No image', sourceUrl, sourceDomain: domain(sourceUrl) };
}

export function prepareActivities(activities) {
  return shareListingImages((activities || []).filter((activity) => !activity.archive));
}

export function isUnsuitable(activity) {
  return ['needs_replacement', 'no_replacement'].includes(activity.audit_image_status) && !clean(activity.reviewed_image_url);
}

export function isImageReviewIgnored(activity) {
  return Boolean(activity.image_review_ignored_at);
}

export function activitiesForQueue(activities, queueId) {
  return preparedActivitiesForQueue(prepareActivities(activities), queueId);
}

export function preparedActivitiesForQueue(prepared, queueId) {
  if (queueId === 'ignored') return prepared.filter(isImageReviewIgnored);
  const reviewable = prepared.filter((activity) => !isImageReviewIgnored(activity));
  if (queueId === 'missing_published') {
    return reviewable.filter((activity) => activity.public_listing_status === 'published' && !currentImage(activity).url);
  }
  if (queueId === 'unsuitable_audit') return reviewable.filter(isUnsuitable);
  if (queueId === 'all_draft') return reviewable.filter((activity) => activity.public_listing_status === 'draft');
  return reviewable.filter((activity) => activity.public_listing_status === 'published');
}

export function queueCounts(activities) {
  return queueCountsFromPrepared(prepareActivities(activities));
}

export function queueCountsFromPrepared(prepared) {
  return Object.fromEntries(QUEUES.map((queue) => [queue.id, preparedActivitiesForQueue(prepared, queue.id).length]));
}

function preloadWindow(prepared, queueId, perQueue, queueStartIds) {
  const queue = preparedActivitiesForQueue(prepared, queueId);
  const startId = queueStartIds?.[queueId];
  const selectedIndex = startId ? queue.findIndex((activity) => activity.activity_id === startId) : -1;
  return queue.slice(Math.max(0, selectedIndex), Math.max(0, selectedIndex) + perQueue);
}

export function activitiesToPreload(prepared, queueIds, perQueue = 20, queueStartIds = {}) {
  const queueLists = queueIds.map((queueId) => preloadWindow(prepared, queueId, perQueue, queueStartIds));
  const seen = new Set();
  const targets = [];
  for (let position = 0; position < perQueue; position += 1) {
    for (const queue of queueLists) {
      const activity = queue[position];
      if (activity && !seen.has(activity.activity_id)) {
        seen.add(activity.activity_id);
        targets.push(activity);
      }
    }
  }
  return targets;
}

export function preloadReadinessByQueue(prepared, queueIds, perQueue = 20, queueStartIds = {}) {
  return Object.fromEntries(queueIds.map((queueId) => {
    const activities = preloadWindow(prepared, queueId, perQueue, queueStartIds);
    const ready = activities.filter((activity) => (
      Array.isArray(activity.codex_image_candidates) && activity.codex_image_candidates.length > 0
    )).length;
    return [queueId, { ready, total: activities.length }];
  }));
}

export function listingSearchText(activity) {
  return normalized([
    activity.activity_name,
    activity.address,
    activity.borough,
    activity.category,
    providerLabel(activity),
  ].filter(Boolean).join(' '));
}

export function openListingUrl(activity) {
  return [activity.source_url, activity.website, activity.organiser_website]
    .map(clean)
    .find((value) => /^https?:\/\//i.test(value)) || '';
}

export function googlePlacesUrl(activity) {
  const storedUrl = [activity.google_place_uri, activity.google_link]
    .map(clean)
    .find((value) => /^https?:\/\//i.test(value));
  if (storedUrl) return storedUrl;

  const storedPlaceId = [activity.google_place_uri, activity.google_link]
    .map(clean)
    .map((value) => value.match(/(?:^|\/)(ChI[A-Za-z0-9_-]+)$/)?.[1] || '')
    .find(Boolean);
  const query = [clean(activity.activity_name), clean(activity.address || activity.borough || 'London')]
    .filter(Boolean)
    .join(' ');
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', query || 'London family activity');
  if (storedPlaceId) url.searchParams.set('query_place_id', storedPlaceId);
  return url.toString();
}
