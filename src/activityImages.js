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

const userControlledImageFields = new Set([
  'admin_cover_image_url',
  'user_image_url',
  'user_uploaded_image_url',
]);

function isUsablePhotoUrl(url, field, activity) {
  if (!url) return false;
  const blockedPreviewHosts = [
    'image.thum.io',
    's.wordpress.com/mshots',
  ];
  if (blockedPreviewHosts.some((blocked) => url.includes(blocked))) return false;
  if (userControlledImageFields.has(field)) return true;

  // Imported images must not be a logo, social network asset, or interface
  // graphic. User and administrator uploads intentionally remain exempt.
  const source = field === 'scraped_image_url' ? String(activity?.image_source_url || '') : '';
  return !/(favicon|icon|wordmark|site-logo|facebook|fbcdn|scontent|cdninstagram|instagram|twitter|twimg|tiktok|linkedin|pinterest|youtube|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play|\/flags\/|site-flag|country-selector|language-selector|(?:^|[-_/])logo(?:[-_/]|$))/i
    .test(`${url} ${source}`);
}

function candidateImage(activity) {
  for (let priority = 0; priority < activityImageFields.length; priority += 1) {
    const field = activityImageFields[priority];
    const url = securePhotoUrl(activity?.[field]);
    if (isUsablePhotoUrl(url, field, activity)) return { field, priority, url };
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
    .map((field) => ({ field, url: securePhotoUrl(activity?.[field]) }))
    .filter(({ field, url }) => isUsablePhotoUrl(url, field, activity))
    .map(({ url }) => url);
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
