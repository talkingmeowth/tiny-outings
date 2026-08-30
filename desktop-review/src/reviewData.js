import { activityImageGroupKey } from '../../src/activityDuplicates.js';
import { allowsWikimediaImages, isWikimediaUrl } from '../../src/wikimediaImagePolicy.js';
import { categoryIllustrationCandidate } from './categoryIllustrations.js';

// Keep this order aligned with src/activityImages.js so the desktop reviewer
// always shows the same card image and source as the main application.
export const activityImageFields = [
  'admin_cover_image_url',
  'reviewed_image_url',
  'user_image_url',
  'user_uploaded_image_url',
  'model_selected_url',
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
  if (allowsWikimediaImages(activity)) return true;
  if (field === 'wikimedia_image_url' || isWikimediaUrl(url)) return false;
  return true;
}

function candidateImage(activity) {
  for (let priority = 0; priority < activityImageFields.length; priority += 1) {
    const field = activityImageFields[priority];
    if (field === 'reviewed_image_url' && activity?.use_category_image) {
      return { field: 'category_placeholder', priority, url: categoryIllustrationCandidate(activity).image_url };
    }
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
  { id: 'all_activities', label: 'All activities', description: 'Every non-archived published and draft listing.' },
  { id: 'model_selected', label: 'Model selected', description: 'Listings currently displaying an automatically selected model image.' },
  { id: 'all_published', label: 'All published', description: 'Every live listing, with or without an image.' },
  { id: 'all_draft', label: 'All draft', description: 'Every unpublished listing, with or without an image.' },
  { id: 'missing_images', label: 'Missing images', description: 'Listings with no activity photo. Category artwork remains displayed but counts as missing.' },
];

export const IMAGE_SOURCE_LABELS = {
  admin_cover_image_url: 'Admin cover',
  reviewed_image_url: 'Manual desktop review',
  user_image_url: 'Admin image URL',
  user_uploaded_image_url: 'User upload',
  model_selected_url: 'Model selected',
  organiser_website_downloaded_image: 'Organiser website download',
  website_downloaded_image: 'Website download',
  wikimedia_image_url: 'Wikimedia',
  website_image_url: 'Website image',
  listing_image_url: 'Listing image',
  category_placeholder: 'Illustrated category image',
  audit_image_url: 'Legacy audit replacement',
  scraped_image_url: 'Legacy scraped image',
};

export const DISPLAY_IMAGE_SOURCE_ORDER = [
  ...activityImageFields,
  'category_placeholder',
];

export const STORED_CANDIDATE_FIELDS = [
  ...activityImageFields,
  'audit_image_url',
  'scraped_image_url',
];

const storedSourceSelectionPrefix = 'stored_source:';

export function storedSourceSelectionKey(field) {
  return `${storedSourceSelectionPrefix}${field}`;
}

export function storedSourceFieldForSelection(value) {
  const selection = clean(value);
  if (!selection.startsWith(storedSourceSelectionPrefix)) return '';
  const field = selection.slice(storedSourceSelectionPrefix.length);
  return STORED_CANDIDATE_FIELDS.includes(field) ? field : '';
}

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
  if (field === 'model_selected_url') sourceUrl = activity.automated_image_review?.candidate?.source_page_url || activity.automated_image_review?.candidate?.image_url || url;
  if (field === 'audit_image_url') sourceUrl = activity.audit_image_source_url || url;
  if (field === 'scraped_image_url') sourceUrl = activity.image_source_url || url;
  if (field === 'category_placeholder') sourceUrl = url;
  if (['organiser_website_downloaded_image', 'website_downloaded_image', 'website_image_url', 'listing_image_url'].includes(field)) {
    sourceUrl = activity.image_source_url || activity.organiser_website || activity.website || activity.source_url || url;
  }
  return { url, field, label: IMAGE_SOURCE_LABELS[field] || 'No image', sourceUrl, sourceDomain: domain(sourceUrl) };
}

export function displayedImageSource(activity) {
  return currentImage(activity).field || 'category_placeholder';
}

export function imageSourceOptions(activities) {
  const counts = new Map(DISPLAY_IMAGE_SOURCE_ORDER.map((field) => [field, 0]));
  for (const activity of activities || []) {
    const field = displayedImageSource(activity);
    counts.set(field, (counts.get(field) || 0) + 1);
  }
  return DISPLAY_IMAGE_SOURCE_ORDER
    .filter((field) => counts.get(field) > 0)
    .map((field) => ({ field, label: IMAGE_SOURCE_LABELS[field] || field, count: counts.get(field) }));
}

function storedCandidateSourceUrl(activity, field, imageUrl) {
  if (field === 'reviewed_image_url') return activity.reviewed_image_source_url || activity.reviewed_image_original_url || imageUrl;
  if (field === 'audit_image_url') return activity.audit_image_source_url || imageUrl;
  if (field === 'scraped_image_url') return activity.image_source_url || imageUrl;
  if (field === 'organiser_website_downloaded_image') return activity.organiser_website || activity.website || imageUrl;
  if (['website_downloaded_image', 'website_image_url', 'listing_image_url'].includes(field)) {
    return activity.image_source_url || activity.website || activity.source_url || imageUrl;
  }
  return imageUrl;
}

export function storedImageCandidates(activity) {
  return STORED_CANDIDATE_FIELDS.flatMap((field) => {
    const imageUrl = securePhotoUrl(activity?.[field]);
    if (!isUsablePhotoUrl(imageUrl) || !isAllowedActivityPhoto(activity, field, imageUrl)) return [];
    const label = IMAGE_SOURCE_LABELS[field] || field;
    const sourcePageUrl = storedCandidateSourceUrl(activity, field, imageUrl);
    return [{
      image_url: imageUrl,
      thumbnail_url: imageUrl,
      source_page_url: sourcePageUrl,
      source_domain: domain(sourcePageUrl) || domain(imageUrl),
      title: label,
      width: null,
      height: null,
      relevance_reason: field,
      selection_kind: 'hierarchy_source',
      source_field: field,
      source_label: label,
      is_stored_source: true,
    }];
  });
}

export function prepareActivities(activities) {
  return shareListingImages((activities || []).filter((activity) => (
    !activity.archive && ['published', 'draft'].includes(activity.public_listing_status)
  )));
}

export function isUnsuitable(activity) {
  return ['needs_replacement', 'no_replacement'].includes(activity.audit_image_status)
    && !clean(activity.reviewed_image_url)
    && !clean(activity.model_selected_url);
}

export function isImageReviewIgnored(activity) {
  return Boolean(activity.image_review_ignored_at);
}

export function hasPendingAutomatedReview(activity) {
  return ['pending', 'auto_applied'].includes(activity?.automated_image_review?.status);
}

export function activitiesForQueue(activities, queueId) {
  return preparedActivitiesForQueue(prepareActivities(activities), queueId);
}

export function preparedActivitiesForQueue(prepared, queueId) {
  if (queueId === 'all_activities') return prepared;
  if (queueId === 'model_selected') return prepared.filter((activity) => currentImage(activity).field === 'model_selected_url');
  if (queueId === 'missing_images') return prepared.filter((activity) => {
    const image = currentImage(activity);
    return !image.url || image.field === 'category_placeholder';
  });
  if (queueId === 'all_draft') return prepared.filter((activity) => activity.public_listing_status === 'draft');
  return prepared.filter((activity) => activity.public_listing_status === 'published');
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
