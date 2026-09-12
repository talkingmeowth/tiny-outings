const genericIdentityTerms = new Set([
  'activity', 'activities', 'baby', 'babies', 'cafe', 'centre', 'center', 'child', 'children',
  'class', 'classes', 'club', 'event', 'events', 'families', 'family', 'food', 'group', 'hub',
  'kids', 'london', 'park', 'play', 'playground', 'session', 'the', 'toddler', 'toddlers', 'venue',
]);

const nonLondonPlaces = [
  'aberdeen', 'belfast', 'birmingham', 'bradford', 'brighton', 'bristol', 'cambridge', 'cardiff',
  'chicago', 'coventry', 'derby', 'dublin', 'edinburgh', 'glasgow', 'leeds', 'leicester', 'liverpool',
  'manchester', 'melbourne', 'new york', 'newcastle', 'nottingham', 'oxford', 'paris', 'raleigh',
  'sheffield', 'southampton', 'sydney', 'toronto', 'york',
];

const directoryDomains = /(tripadvisor|wheree|yelp|foursquare|restaurantguru|wanderlog|corner\.inc|google|bing)/i;
const sharedHostDomains = /(facebook|instagram|pinterest|tiktok|wikipedia|wikimedia|gov\.uk|org\.uk|wordpress|wixsite|squarespace)/i;
const hostNoiseTerms = new Set(['cdn', 'co', 'com', 'images', 'media', 'net', 'org', 'static', 'uk', 'www']);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function host(value) {
  try {
    return new URL(clean(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return clean(value).toLowerCase().replace(/^www\./, '');
  }
}

function rootDomain(value) {
  const hostname = host(value);
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;
  if (['co', 'org', 'gov', 'ac'].includes(parts.at(-2))) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

function pathText(value) {
  try {
    return decodeURIComponent(new URL(clean(value)).pathname);
  } catch {
    return '';
  }
}

function tokens(value, ignored = new Set()) {
  return new Set(normalized(value).split(' ')
    .filter((token) => token.length > 2 && !ignored.has(token)));
}

function tokenOverlap(left, right) {
  if (!left.size || !right.size) return 0;
  let matched = 0;
  for (const token of left) if (right.has(token)) matched += 1;
  return matched / Math.max(1, Math.min(left.size, right.size));
}

function fullPostcodes(value) {
  return new Set(clean(value).toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g) || []);
}

function outwardPostcode(value) {
  const match = clean(value).toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/);
  return match?.[1] || '';
}

function candidateText(candidate) {
  return [
    candidate?.title,
    candidate?.relevance_reason,
    candidate?.source_page_url || candidate?.link,
    pathText(candidate?.source_page_url || candidate?.link),
    candidate?.source_domain || candidate?.source,
  ].filter(Boolean).join(' ');
}

function officialDomains(activity) {
  return new Set([activity?.website, activity?.organiser_website, activity?.source_url]
    .map(rootDomain).filter(Boolean));
}

export function imageSourceConflict(activity, candidate) {
  const text = normalized(candidateText(candidate));
  const candidateHost = rootDomain(candidate?.source_page_url || candidate?.link
    || candidate?.source_domain || candidate?.source || candidate?.image_url || candidate?.original);
  const official = officialDomains(activity).has(candidateHost);
  const nameTokens = tokens(activity?.activity_name, genericIdentityTerms);
  const candidateTokens = tokens(text);
  const nameOverlap = tokenOverlap(nameTokens, candidateTokens);
  const activityLocationText = [activity?.address, activity?.borough, activity?.postcode].filter(Boolean).join(' ');
  const locationTokens = tokens(activityLocationText, genericIdentityTerms);
  const locationOverlap = tokenOverlap(locationTokens, candidateTokens);

  const activityOutward = outwardPostcode(activityLocationText);
  const candidatePostcodes = fullPostcodes(text);
  const candidateOutwards = new Set([...candidatePostcodes].map(outwardPostcode).filter(Boolean));
  const postcodeConflict = Boolean(activityOutward && candidateOutwards.size && !candidateOutwards.has(activityOutward));

  const activityText = normalized(`${activity?.activity_name || ''} ${activityLocationText}`);
  const conflictingPlaces = nonLondonPlaces.filter((place) => text.includes(place) && !activityText.includes(place));
  const locationConflict = conflictingPlaces.length > 0 && nameOverlap < 0.6;

  const hostLabel = candidateHost.split('.')[0] || '';
  const hostTokens = tokens(hostLabel, hostNoiseTerms);
  const brandedHost = hostTokens.size > 0 && [...hostTokens].some((token) => candidateTokens.has(token));
  const brandOverlap = tokenOverlap(nameTokens, hostTokens);
  const brandConflict = Boolean(candidateHost
    && !official
    && !directoryDomains.test(candidateHost)
    && !sharedHostDomains.test(candidateHost)
    && brandedHost
    && nameTokens.size > 0
    && nameOverlap < 0.25
    && brandOverlap === 0);

  let score = 0;
  const reasons = [];
  if (postcodeConflict) {
    score = Math.max(score, 0.98);
    reasons.push(`candidate postcode conflicts with ${activityOutward}`);
  }
  if (locationConflict) {
    score = Math.max(score, 0.9);
    reasons.push(`candidate names ${conflictingPlaces.slice(0, 2).join(' / ')} rather than the listing location`);
  }
  if (brandConflict) {
    score = Math.max(score, 0.68);
    reasons.push(`candidate appears to belong to ${candidateHost}, which does not match the activity identity`);
  }
  if (official && !postcodeConflict && !locationConflict) score = 0;

  return {
    score: Number(score.toFixed(2)),
    clear: score >= 0.8,
    official,
    name_overlap: Number(nameOverlap.toFixed(4)),
    location_overlap: Number(locationOverlap.toFixed(4)),
    postcode_conflict: postcodeConflict,
    location_conflict: locationConflict,
    brand_conflict: brandConflict,
    candidate_domain: candidateHost || null,
    reasons,
  };
}

