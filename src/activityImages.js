import {
  activityImageFamilyKey,
  activityImageGroupKey,
  activityImageLocationKey,
} from './activityDuplicates.js';
import { allowsWikimediaImages, isWikimediaUrl } from './wikimediaImagePolicy.js';

// Only explicit human choices and the learned cross-source winner are display
// fields. All scraper, website, audit and listing fields remain candidate data;
// they never win merely because they happen to sit earlier in a fixed list.
export const activityImageFields = [
  'admin_cover_image_url',
  'reviewed_image_url',
  'user_image_url',
  'user_uploaded_image_url',
  'model_selected_url',
];

// The selector has already passed download, resolution, logo, provenance and
// visual checks before writing a model choice. Keep usable coverage high: only
// genuinely uncertain results fall back to category artwork and remain in the
// missing-image queue.
export const MODEL_IMAGE_MIN_CONFIDENCE = 0.50;

export function securePhotoUrl(url) {
  return String(url || '').trim().replace(/^http:\/\//i, 'https://');
}

function isUsablePhotoUrl(url) {
  if (!url) return false;
  return ![
    'image.thum.io',
    's.wordpress.com/mshots',
  ].some((blocked) => url.includes(blocked));
}

function isAllowedActivityPhoto(activity, field, url) {
  if (allowsWikimediaImages(activity)) return true;
  if (field === 'wikimedia_image_url' || isWikimediaUrl(url)) return false;
  if (field === 'audit_image_url' && isWikimediaUrl(activity?.audit_image_source_url)) return false;
  if (field === 'scraped_image_url' && isWikimediaUrl(activity?.image_source_url)) return false;
  return true;
}

export function isAuditReplacementApproved(activity, url = activity?.audit_image_url) {
  return String(activity?.audit_image_status || '').trim() === 'replaced'
    && securePhotoUrl(activity?.audit_image_url) === securePhotoUrl(url);
}

export function isScrapedImageApprovedByAudit(activity, url = activity?.scraped_image_url) {
  if (String(activity?.audit_image_status || '').trim() !== 'pass') return false;
  if (String(activity?.audit_image_original_source_field || '').trim() !== 'scraped_image_url') return false;
  const auditedUrl = securePhotoUrl(activity?.audit_image_original_url);
  return Boolean(auditedUrl && auditedUrl === securePhotoUrl(url));
}

export function isModelImageApproved(activity, url = activity?.model_selected_url) {
  // A value reaches model_selected_url only after the cross-source selector's
  // download, resolution, logo, provenance and visual checks. Confidence is
  // retained for audit/review. A human-approved choice is always valid; an
  // automatic choice needs the coverage-first minimum confidence above.
  const selectedUrl = securePhotoUrl(activity?.model_selected_url);
  if (!selectedUrl || selectedUrl !== securePhotoUrl(url)) return false;
  const confidence = Number(activity?.model_selected_confidence);
  const explicitlyApproved = activity?.image_review_approved_source_field === 'model_selected_url'
    && securePhotoUrl(activity?.image_review_approved_url) === selectedUrl;
  return explicitlyApproved || (Number.isFinite(confidence) && confidence >= MODEL_IMAGE_MIN_CONFIDENCE);
}

export function isQualityApprovedImageField(activity, field, url) {
  if (field === 'audit_image_url') return isAuditReplacementApproved(activity, url);
  if (field === 'scraped_image_url') return isScrapedImageApprovedByAudit(activity, url);
  if (field === 'model_selected_url') return isModelImageApproved(activity, url);
  return true;
}

export function activityFallbackImage(activity) {
  const category = String(activity?.category || '').toLowerCase();
  return category.includes('park')
    ? '/images/park-placeholder.svg'
    : category.includes('book')
      ? '/images/bookshop-placeholder.svg'
      : category.includes('caf')
        ? '/images/family-cafe-placeholder.svg'
        : '/images/family-outing-placeholder.svg';
}

function imageCandidates(activity) {
  const candidates = [];
  for (let priority = 0; priority < activityImageFields.length; priority += 1) {
    const field = activityImageFields[priority];
    if (field === 'reviewed_image_url' && activity?.use_category_image) {
      candidates.push({ field: 'category_placeholder', priority, url: activityFallbackImage(activity) });
      continue;
    }
    const url = securePhotoUrl(activity?.[field]);
    if (!isQualityApprovedImageField(activity, field, url)) continue;
    if (isUsablePhotoUrl(url) && isAllowedActivityPhoto(activity, field, url)) candidates.push({ field, priority, url });
  }
  return candidates;
}

function candidateImage(activity) {
  return imageCandidates(activity)[0] || null;
}

function familyCandidateImage(activity, image) {
  if (!image) return null;
  const approvedModel = image.field === 'model_selected_url'
    && activity.image_review_approved_at
    && activity.image_review_approved_source_field === image.field
    && securePhotoUrl(activity.image_review_approved_url) === image.url;
  return { ...image, priority: approvedModel ? 3.5 : image.priority };
}

function isPreferredImage(candidate, current) {
  if (!current) return true;
  if (candidate.priority !== current.priority) return candidate.priority < current.priority;
  if (candidate.field === 'model_selected_url' && current.field === 'model_selected_url') {
    const candidateConfidence = Number(candidate.activity.model_selected_confidence);
    const currentConfidence = Number(current.activity.model_selected_confidence);
    if (Number.isFinite(candidateConfidence) && Number.isFinite(currentConfidence)
      && candidateConfidence !== currentConfidence) return candidateConfidence > currentConfidence;
  }

  const candidateUpdated = Date.parse(candidate.activity.updated_at || candidate.activity.created_at || 0) || 0;
  const currentUpdated = Date.parse(current.activity.updated_at || current.activity.created_at || 0) || 0;
  if (candidateUpdated !== currentUpdated) return candidateUpdated > currentUpdated;

  return String(candidate.activity.activity_id) < String(current.activity.activity_id);
}

export function activityImageUrls(activity) {
  return imageCandidates(activity).map(({ url }) => url);
}

export function hasActivityImage(activity) {
  return activityImageUrls(activity).length > 0;
}

// A recurring listing can have one record per time slot. Select one image for
// every such record so changing time never changes the visual card identity.
export function shareListingImages(activities) {
  const imageByListing = new Map();
  const locationsByFamily = new Map();
  const imageByFamily = new Map();

  activities.forEach((activity) => {
    const familyKey = activityImageFamilyKey(activity);
    if (familyKey) {
      if (!locationsByFamily.has(familyKey)) locationsByFamily.set(familyKey, new Set());
      locationsByFamily.get(familyKey).add(activityImageLocationKey(activity));
    }

    const image = candidateImage(activity);
    if (!image) return;

    const key = activityImageGroupKey(activity);
    const candidate = { ...familyCandidateImage(activity, image), activity };
    const current = imageByListing.get(key);
    if (isPreferredImage(candidate, current)) imageByListing.set(key, candidate);

    // Category artwork is an explicit fallback, not a reusable activity photo.
    if (!familyKey || image.field === 'category_placeholder') return;
    const currentFamilyImage = imageByFamily.get(familyKey);
    if (isPreferredImage(candidate, currentFamilyImage)) imageByFamily.set(familyKey, candidate);
  });

  return activities.map((activity) => {
    const listingImage = imageByListing.get(activityImageGroupKey(activity));
    const familyKey = activityImageFamilyKey(activity);
    const familyImage = familyKey && locationsByFamily.get(familyKey)?.size > 1
      ? imageByFamily.get(familyKey)
      : null;
    const sharedImage = familyImage && isPreferredImage(familyImage, listingImage)
      ? familyImage
      : listingImage;
    if (!sharedImage) return activity;
    if (!isAllowedActivityPhoto(activity, sharedImage.field, sharedImage.url)) return activity;
    return {
      ...activity,
      shared_card_image_url: sharedImage.url,
      shared_card_image_source: sharedImage.field,
    };
  });
}
