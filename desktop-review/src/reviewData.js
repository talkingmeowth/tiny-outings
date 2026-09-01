import { activityImageGroupKey } from '../../src/activityDuplicates.js';
import { isQualityApprovedImageField } from '../../src/activityImages.js';
import { allowsWikimediaImages, isWikimediaUrl } from '../../src/wikimediaImagePolicy.js';
import { categoryIllustrationCandidate } from './categoryIllustrations.js';

// Display only explicit human choices and the learned cross-source winner.
// The remaining fields are still shown below as candidates for manual review.
export const activityImageFields = [
  'admin_cover_image_url',
  'reviewed_image_url',
  'user_image_url',
  'user_uploaded_image_url',
  'model_selected_url',
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
  if (field === 'audit_image_url' && isWikimediaUrl(activity?.audit_image_source_url)) return false;
  if (field === 'scraped_image_url' && isWikimediaUrl(activity?.image_source_url)) return false;
  return true;
}

function candidateImage(activity) {
  for (let priority = 0; priority < activityImageFields.length; priority += 1) {
    const field = activityImageFields[priority];
    if (field === 'reviewed_image_url' && activity?.use_category_image) {
      return { field: 'category_placeholder', priority, url: categoryIllustrationCandidate(activity).image_url };
    }
    const url = securePhotoUrl(activity?.[field]);
    if (!isQualityApprovedImageField(activity, field, url)) continue;
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
  { id: 'archive', label: 'Archive', description: 'Archived listings. Restore one to return it to its previous status; older archives return as drafts.' },
];

export function fullReviewUrl(baseUrl, activityId, queueId = 'all_activities') {
  const url = new URL(baseUrl);
  const validQueue = QUEUES.some((queue) => queue.id === queueId) ? queueId : 'all_activities';
  url.searchParams.set('view', 'detail');
  url.searchParams.set('activity', clean(activityId));
  url.searchParams.set('queue', validQueue);
  return url.toString();
}

export const IMAGE_SOURCE_LABELS = {
  admin_cover_image_url: 'Admin cover',
  reviewed_image_url: 'Manual desktop review',
  reviewed_image_original_url: 'Manual review original',
  user_image_url: 'Admin image URL',
  audit_image_url: 'Audited replacement',
  audit_image_original_url: 'Image checked by audit',
  scraped_image_url: 'Scraped image (SerpAPI selector)',
  organiser_website_downloaded_image: 'Organiser website download',
  website_downloaded_image: 'Website download',
  model_selected_url: 'Model selected (70%+ confidence)',
  model_selected_original_url: 'Model selection original',
  user_uploaded_image_url: 'User upload',
  google_photo_url: 'Google Places photo',
  image_url: 'Legacy activity image',
  wikimedia_image_url: 'Wikimedia',
  website_image_url: 'Website image',
  listing_image_url: 'Listing image',
  category_placeholder: 'Illustrated category image',
};

export const CANDIDATE_ARRAY_LABELS = {
  website_image_candidates: 'Website discovery',
  serpapi_image_candidates: 'Stored SerpAPI discovery',
  codex_image_candidates: 'Desktop SerpAPI top 20',
  user_uploaded_image_candidates: 'Uploaded image',
};

export const DISPLAY_IMAGE_SOURCE_ORDER = [
  ...activityImageFields,
  'category_placeholder',
];

export const STORED_CANDIDATE_FIELDS = [
  'admin_cover_image_url',
  'reviewed_image_url',
  'reviewed_image_original_url',
  'user_image_url',
  'user_uploaded_image_url',
  'audit_image_url',
  'audit_image_original_url',
  'scraped_image_url',
  'organiser_website_downloaded_image',
  'website_downloaded_image',
  'model_selected_url',
  'model_selected_original_url',
  'google_photo_url',
  'wikimedia_image_url',
  'website_image_url',
  'listing_image_url',
  'image_url',
];

export const CANDIDATE_ARRAY_FIELDS = Object.keys(CANDIDATE_ARRAY_LABELS);

const storedSourceSelectionPrefix = 'stored_source:';
const candidateArraySelectionPrefix = 'candidate_source:';

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
  if (field === 'scraped_image_url') sourceUrl = activity.image_source_url || url;
  if (field === 'model_selected_url') sourceUrl = activity.model_selected_source_url
    || activity.automated_image_review?.candidate?.source_page_url
    || activity.model_selected_original_url
    || activity.automated_image_review?.candidate?.image_url
    || url;
  if (field === 'audit_image_url') sourceUrl = activity.audit_image_source_url || url;
  if (field === 'category_placeholder') sourceUrl = url;
  if (['organiser_website_downloaded_image', 'website_downloaded_image', 'website_image_url', 'listing_image_url'].includes(field)) {
    sourceUrl = activity.image_source_url || activity.organiser_website || activity.website || activity.source_url || url;
  }
  return { url, field, label: IMAGE_SOURCE_LABELS[field] || 'No image', sourceUrl, sourceDomain: domain(sourceUrl) };
}

export function candidateArraySelectionKey(field, index) {
  return `${candidateArraySelectionPrefix}${field}:${Number(index)}`;
}

export function candidateArraySelectionForValue(value) {
  const selection = clean(value);
  if (!selection.startsWith(candidateArraySelectionPrefix)) return null;
  const [field, rawIndex] = selection.slice(candidateArraySelectionPrefix.length).split(':');
  const index = Number(rawIndex);
  if (!CANDIDATE_ARRAY_FIELDS.includes(field) || !Number.isInteger(index) || index < 0) return null;
  return { field, index };
}

export function quickReviewImage(activity) {
  const image = currentImage(activity);
  if (image.url) return { ...image, isPlaceholder: image.field === 'category_placeholder' };
  const illustration = categoryIllustrationCandidate(activity);
  return {
    url: illustration.image_url,
    field: 'category_placeholder',
    label: IMAGE_SOURCE_LABELS.category_placeholder,
    sourceUrl: '',
    sourceDomain: '',
    isPlaceholder: true,
  };
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
  if (field === 'reviewed_image_original_url') return activity.reviewed_image_source_url || imageUrl;
  if (field === 'audit_image_url') return activity.audit_image_source_url || imageUrl;
  if (field === 'audit_image_original_url') return activity.audit_image_source_url || activity.image_source_url || imageUrl;
  if (field === 'scraped_image_url' || field === 'google_photo_url' || field === 'image_url') return activity.image_source_url || activity.google_place_uri || activity.google_link || imageUrl;
  if (field === 'model_selected_original_url') return activity.model_selected_source_url || imageUrl;
  if (field === 'organiser_website_downloaded_image') return activity.organiser_website || activity.website || imageUrl;
  if (['website_downloaded_image', 'website_image_url', 'listing_image_url'].includes(field)) {
    return activity.image_source_url || activity.website || activity.source_url || imageUrl;
  }
  return imageUrl;
}

function storedCandidateLabel(activity, field) {
  const base = IMAGE_SOURCE_LABELS[field] || field;
  if (field === 'audit_image_url' || field === 'audit_image_original_url') {
    return `${base} — audit ${clean(activity.audit_image_status || 'not reviewed').replaceAll('_', ' ')}`;
  }
  if (field === 'scraped_image_url') {
    const exactPass = clean(activity.audit_image_status) === 'pass'
      && clean(activity.audit_image_original_source_field) === 'scraped_image_url'
      && securePhotoUrl(activity.audit_image_original_url) === securePhotoUrl(activity.scraped_image_url);
    return `${base} — ${exactPass ? 'audit passed' : clean(activity.audit_image_status || 'not audited').replaceAll('_', ' ')}`;
  }
  if (field === 'model_selected_url' || field === 'model_selected_original_url') {
    const confidence = Number(activity.model_selected_confidence);
    return Number.isFinite(confidence) ? `${base} — ${Math.round(confidence * 100)}% confidence` : base;
  }
  return base;
}

export function storedImageCandidates(activity) {
  const seen = new Set();
  return STORED_CANDIDATE_FIELDS.flatMap((field) => {
    const imageUrl = securePhotoUrl(activity?.[field]);
    if (!isUsablePhotoUrl(imageUrl) || !isAllowedActivityPhoto(activity, field, imageUrl)) return [];
    const duplicateKey = `${field}:${imageUrl}`;
    if (seen.has(duplicateKey)) return [];
    seen.add(duplicateKey);
    const label = storedCandidateLabel(activity, field);
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

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeArrayCandidate(candidate, index, field) {
  if (!candidate || typeof candidate !== 'object') return null;
  const imageUrl = securePhotoUrl(candidate.original || candidate.image_url || candidate.photo_url);
  if (!isUsablePhotoUrl(imageUrl)) return null;
  const thumbnailUrl = securePhotoUrl(candidate.thumbnail || candidate.thumbnail_url || imageUrl);
  const sourcePageUrl = clean(candidate.link || candidate.source_page_url || candidate.page_url || imageUrl);
  const sourceKind = clean(candidate.source_kind);
  const sourceLabel = field === 'website_image_candidates' && sourceKind
    ? `${CANDIDATE_ARRAY_LABELS[field]} — ${sourceKind}`
    : `${CANDIDATE_ARRAY_LABELS[field]} #${Number(candidate.position) || index + 1}`;
  return {
    ...candidate,
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl,
    source_page_url: sourcePageUrl,
    source_domain: clean(candidate.source_domain || candidate.source) || domain(sourcePageUrl) || domain(imageUrl),
    title: clean(candidate.title) || null,
    width: numberOrNull(candidate.original_width ?? candidate.width),
    height: numberOrNull(candidate.original_height ?? candidate.height),
    relevance_reason: clean(candidate.relevance_reason)
      || `${CANDIDATE_ARRAY_LABELS[field]} result ${Number(candidate.position) || index + 1}`,
    selection_kind: 'candidate_source',
    candidate_source: field,
    candidate_index: index,
    source_field: field,
    source_label: sourceLabel,
  };
}

export function arrayImageCandidates(activity, field) {
  if (!CANDIDATE_ARRAY_FIELDS.includes(field)) return [];
  const values = Array.isArray(activity?.[field]) ? activity[field] : [];
  const maximum = field === 'serpapi_image_candidates' || field === 'codex_image_candidates' ? 20 : values.length;
  return values.slice(0, maximum)
    .map((candidate, index) => normalizeArrayCandidate(candidate, index, field))
    .filter((candidate) => candidate
      && isAllowedActivityPhoto(activity, field, candidate.image_url)
      && isAllowedActivityPhoto(activity, field, candidate.source_page_url));
}

export function imageCandidateSections(activity) {
  return [
    { id: 'website_image_candidates', label: 'All images discovered on listing and organiser websites', candidates: arrayImageCandidates(activity, 'website_image_candidates') },
    { id: 'serpapi_image_candidates', label: 'Stored SerpAPI discovery results — top 20', candidates: arrayImageCandidates(activity, 'serpapi_image_candidates') },
    { id: 'codex_image_candidates', label: 'Desktop Google Images search — SerpAPI top 20', candidates: arrayImageCandidates(activity, 'codex_image_candidates') },
    { id: 'user_uploaded_image_candidates', label: 'All uploaded activity images', candidates: arrayImageCandidates(activity, 'user_uploaded_image_candidates') },
  ].filter((section) => section.candidates.length);
}

export function quickReviewApproval(activity) {
  const image = quickReviewImage(activity);
  let originalUrl = image.url;
  if (image.field === 'reviewed_image_url') originalUrl = clean(activity.reviewed_image_original_url) || image.url;
  if (image.field === 'model_selected_url') originalUrl = clean(activity.model_selected_original_url) || image.url;
  return {
    displayed_image_url: image.url,
    original_image_url: originalUrl,
    source_page_url: image.sourceUrl || image.url,
    source_field: image.field || 'category_placeholder',
    source_label: image.label || IMAGE_SOURCE_LABELS[image.field] || image.field,
    is_category_art: image.field === 'category_placeholder',
  };
}

export function isQuickReviewApproved(activity) {
  if (!activity?.image_review_approved_at) return false;
  const approval = quickReviewApproval(activity);
  return securePhotoUrl(activity.image_review_approved_url) === securePhotoUrl(approval.displayed_image_url)
    && clean(activity.image_review_approved_source_field) === approval.source_field;
}

export function prepareActivities(activities) {
  const eligible = (activities || []).filter((activity) => (
    activity.archive
    || activity.public_listing_status === 'archived'
    || ['published', 'draft'].includes(activity.public_listing_status)
  ));
  const active = eligible.filter((activity) => !activity.archive && activity.public_listing_status !== 'archived');
  const archived = eligible.filter((activity) => activity.archive || activity.public_listing_status === 'archived');
  const preparedById = new Map([
    ...shareListingImages(active),
    ...shareListingImages(archived),
  ].map((activity) => [activity.activity_id, activity]));
  return eligible.map((activity) => preparedById.get(activity.activity_id) || activity);
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
  const archived = prepared.filter((activity) => activity.archive || activity.public_listing_status === 'archived');
  if (queueId === 'archive') return archived;
  const active = prepared.filter((activity) => !activity.archive && ['published', 'draft'].includes(activity.public_listing_status));
  if (queueId === 'all_activities') return active;
  if (queueId === 'model_selected') return active.filter((activity) => currentImage(activity).field === 'model_selected_url');
  if (queueId === 'missing_images') return active.filter((activity) => {
    const image = currentImage(activity);
    return !image.url || image.field === 'category_placeholder';
  });
  if (queueId === 'all_draft') return active.filter((activity) => activity.public_listing_status === 'draft');
  return active.filter((activity) => activity.public_listing_status === 'published');
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
