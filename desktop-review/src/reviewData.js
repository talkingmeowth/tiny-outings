import { activityImageFields, activityImageUrls, shareListingImages } from '../../src/activityImages.js';

export const QUEUES = [
  { id: 'missing_published', label: 'Missing — Published', description: 'Live listings with no usable card image.' },
  { id: 'unsuitable_audit', label: 'Unsuitable — Audit', description: 'Listings the image audit marked for replacement.' },
  { id: 'all_published', label: 'All — Published', description: 'Every live listing, with or without an image.' },
  { id: 'all_draft', label: 'All — Draft', description: 'Every unpublished listing.' },
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
  const url = activity.shared_card_image_url || activityImageUrls(activity)[0] || '';
  const field = activity.shared_card_image_source
    || activityImageFields.find((candidateField) => activity[candidateField] && activityImageUrls({ ...activity, ...Object.fromEntries(activityImageFields.map((key) => [key, key === candidateField ? activity[key] : null])) }).length)
    || '';
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

export function activitiesForQueue(activities, queueId) {
  const prepared = prepareActivities(activities);
  if (queueId === 'missing_published') {
    return prepared.filter((activity) => activity.public_listing_status === 'published' && !currentImage(activity).url);
  }
  if (queueId === 'unsuitable_audit') return prepared.filter(isUnsuitable);
  if (queueId === 'all_draft') return prepared.filter((activity) => activity.public_listing_status === 'draft');
  return prepared.filter((activity) => activity.public_listing_status === 'published');
}

export function queueCounts(activities) {
  return Object.fromEntries(QUEUES.map((queue) => [queue.id, activitiesForQueue(activities, queue.id).length]));
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
  return [activity.source_url, activity.website, activity.organiser_website, activity.google_place_uri, activity.google_link]
    .map(clean)
    .find((value) => /^https?:\/\//i.test(value)) || '';
}
