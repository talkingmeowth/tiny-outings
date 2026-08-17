import { activityImageGroupKey } from './activityDuplicates.js';

// Keep this order aligned with the admin and community image controls. The
// first usable image is the cover shown everywhere a listing appears.
const activityImageFields = [
  'admin_cover_image_url',
  'user_image_url',
  'user_uploaded_image_url',
  'scraped_image_url',
  'organiser_website_downloaded_image',
  'website_downloaded_image',
  'wikimedia_image_url',
  'website_image_url',
  'listing_image_url',
];

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

function candidateImage(activity) {
  for (let priority = 0; priority < activityImageFields.length; priority += 1) {
    const field = activityImageFields[priority];
    const url = securePhotoUrl(activity?.[field]);
    if (isUsablePhotoUrl(url)) return { field, priority, url };
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

export function activityImageUrls(activity) {
  return activityImageFields
    .map((field) => securePhotoUrl(activity?.[field]))
    .filter(isUsablePhotoUrl);
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
    return {
      ...activity,
      shared_card_image_url: sharedImage.url,
      shared_card_image_source: sharedImage.field,
    };
  });
}
