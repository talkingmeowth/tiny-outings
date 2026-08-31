import { activityImageGroupKey } from './activityDuplicates.js';
import { allowsWikimediaImages, isWikimediaUrl } from './wikimediaImagePolicy.js';

// Keep this order aligned with the admin and community image controls. The
// first usable image is the cover shown everywhere a listing appears.
export const activityImageFields = [
  'admin_cover_image_url',
  'reviewed_image_url',
  'user_image_url',
  'audit_image_url',
  'scraped_image_url',
  'organiser_website_downloaded_image',
  'website_downloaded_image',
  'model_selected_url',
  'user_uploaded_image_url',
  'wikimedia_image_url',
  'website_image_url',
  'listing_image_url',
];

export const minimumModelImageConfidence = 0.7;

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
  const confidence = Number(activity?.model_selected_confidence);
  return securePhotoUrl(activity?.model_selected_url) === securePhotoUrl(url)
    && Number.isFinite(confidence)
    && confidence >= minimumModelImageConfidence;
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

function isPreferredImage(candidate, current) {
  if (!current) return true;
  if (candidate.priority !== current.priority) return candidate.priority < current.priority;

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
    if (!sharedImage) return activity;
    if (!isAllowedActivityPhoto(activity, sharedImage.field, sharedImage.url)) return activity;
    return {
      ...activity,
      shared_card_image_url: sharedImage.url,
      shared_card_image_source: sharedImage.field,
    };
  });
}
