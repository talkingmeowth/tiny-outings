const stopWords = new Set([
  'activity', 'and', 'at', 'baby', 'babies', 'children', 'child', 'class', 'club', 'event',
  'family', 'for', 'from', 'in', 'london', 'of', 'on', 'parents', 'play', 'session', 'stay',
  'the', 'to', 'with', 'young', 'national', 'trust',
]);

function clean(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value) {
  return [...new Set(clean(value).split(' ').filter((token) => token.length > 2 && !stopWords.has(token)))];
}

function postcode(value) {
  return String(value || '').match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]
    ?.replace(/\s/g, '').toUpperCase() || null;
}

function host(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

function distanceMetres(activity, place) {
  const lat1 = Number(activity.lat);
  const lon1 = Number(activity.long);
  const lat2 = Number(place.location?.latitude);
  const lon2 = Number(place.location?.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite) || !activity.lat || !activity.long) return null;
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLon = (lon2 - lon1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians)
    * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function streetAddressMatches(activity, place, expectedPostcode, returnedPostcode, distance) {
  if (!expectedPostcode || expectedPostcode !== returnedPostcode || distance === null || distance > 150) return false;
  const withoutPostcode = (value) => clean(String(value || '').replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/ig, ''));
  const left = withoutPostcode(activity.address);
  const right = withoutPostcode(place.formattedAddress);
  if (left.length >= 8 && left === right) return true;
  const words = (value) => new Set(value.split(' ').filter((word) => word.length >= 4
    && !['london', 'road', 'street', 'avenue', 'lane', 'drive', 'place', 'square', 'terrace',
      'church', 'centre', 'center', 'school', 'hall', 'building', 'house', 'primary',
      'community', 'unit', 'suite', 'floor', 'saint'].includes(word)));
  const leftWords = words(left);
  const rightWords = words(right);
  if (![...leftWords].some((word) => rightWords.has(word))) return false;
  const numbers = (value) => new Set(value.match(/\b\d+[a-z]?\b/g) || []);
  const leftNumbers = numbers(left);
  const rightNumbers = numbers(right);
  return !leftNumbers.size || !rightNumbers.size
    || [...leftNumbers].some((number) => rightNumbers.has(number));
}

function venueNameInAddress(activity, place) {
  const name = clean(place.displayName?.text);
  const address = clean(activity.address);
  if (name.length >= 8 && address.includes(name)) return true;
  const placeTokens = tokens(name);
  const addressTokens = new Set(tokens(address));
  const matches = placeTokens.filter((token) => addressTokens.has(token));
  return placeTokens.length >= 2 && matches.length >= 2
    && matches.length / placeTokens.length >= 0.6;
}

export function isStreetOrAddress(place) {
  const name = clean(place.displayName?.text || '');
  if (/\bestate$/.test(name)) return true;
  if (/^\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\s+/.test(name)
    && (!place.primaryType || ['premise', 'street_address'].includes(place.primaryType))) return true;
  if (/^\d+[a-z]?\s+(?:[a-z0-9]+\s+){0,5}(road|street|grove|avenue|lane|drive|rd|st|ave)$/.test(name)) return true;
  if (place.primaryType && !['route', 'street_address', 'intersection', 'plus_code', 'postal_code', 'plaza', 'market']
    .includes(place.primaryType)) return false;
  return ['route', 'street_address', 'intersection', 'plus_code', 'postal_code', 'plaza', 'market']
    .includes(place.primaryType)
    || /\b(road|street|grove|avenue|lane|drive|square|terrace|place|market|estate|rd|st|ave)\b$/.test(name)
    || /^\d+[a-z]?\s+(?:[a-z]+\s+){0,4}(road|street|grove|avenue|lane|drive|rd|st)$/.test(name);
}

export function nameMatches(activity, place) {
  const title = clean(activity.activity_name);
  const name = clean(place.displayName?.text);
  if (!title || !name) return false;
  if (activity.category === 'Parks & outdoor play' && place.primaryType === 'transit_station') return false;
  if (title === name || (title.length >= 5 && name.includes(title))) return true;
  if (name.length >= 12 && tokens(name).length >= 2 && title.startsWith(`${name} `)) return true;
  const providerName = name.replace(/ (ltd|limited|cic)$/, '');
  if (providerName.length >= 12 && providerName !== name && title.startsWith(`${providerName} `)) return true;
  if (activity.category === 'Parks & outdoor play' && place.primaryType === 'park'
    && name.length >= 8 && title.replace(/^the /, '').startsWith(`${name} `)) return true;
  const titleTokens = tokens(title);
  const nameTokens = new Set(tokens(name));
  const matches = titleTokens.filter((token) => nameTokens.has(token));
  return titleTokens.length > 0 && matches.length >= Math.min(2, titleTokens.length)
    && matches.length / titleTokens.length >= 0.5;
}

export function isPlausiblePlace(activity, place) {
  if (!place?.id) return false;
  const latitude = Number(place.location?.latitude);
  const longitude = Number(place.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < 51.25 || latitude > 51.75 || longitude < -0.60 || longitude > 0.40) return false;
  const expectedPostcode = postcode(activity.address) || postcode(activity.postcode);
  const returnedPostcode = postcode(place.formattedAddress);
  const distance = distanceMetres(activity, place);
  if (distance !== null && distance > 1000
    && !(distance <= 2000 && expectedPostcode && expectedPostcode === returnedPostcode
      && nameMatches(activity, place))) return false;
  if (expectedPostcode && returnedPostcode && expectedPostcode !== returnedPostcode
    && !(nameMatches(activity, place) && distance !== null && distance <= 500)) return false;
  if (activity.category === 'Events' && expectedPostcode && returnedPostcode
    && expectedPostcode !== returnedPostcode) {
    const addressWords = tokens(activity.address);
    const placeAddressWords = new Set(tokens(place.formattedAddress));
    if (addressWords.filter((word) => placeAddressWords.has(word)).length < 2) return false;
  }
  if (isStreetOrAddress(place) && !nameMatches(activity, place)) return false;
  if (nameMatches(activity, place)) return true;
  if (streetAddressMatches(activity, place, expectedPostcode, returnedPostcode, distance)) return true;

  const isVenueListing = activity.data_source === 'Google Places'
    || activity.data_source === 'Museums London'
    || ['Museums & culture', 'Parks & outdoor play', 'Cafes & food', 'Bookshops'].includes(activity.category);
  if (isVenueListing) {
    const listingHost = host(activity.website);
    const placeHost = host(place.websiteUri);
    return Boolean(listingHost && listingHost === placeHost && distance !== null
      && (distance <= 300 || (expectedPostcode && expectedPostcode === returnedPostcode && distance <= 1000)));
  }

  // Classes and events often take place at a differently named venue. Match
  // the actual venue in the address; a street-name-only result is rejected.
  return venueNameInAddress(activity, place);
}

export function isPlausibleSearchPlace(activity, place) {
  return isPlausiblePlace(activity, place)
    && (nameMatches(activity, place) || venueNameInAddress(activity, place));
}

export function googlePlaceSearchUrl(activity) {
  const query = [activity.activity_name, activity.address || activity.postcode]
    .filter(Boolean).join(', ').trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function isCoordinateOnlyGoogleUrl(value) {
  try {
    const url = new URL(value);
    return /(?:^|\.)google\.[a-z.]+$/.test(url.hostname)
      && /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(url.searchParams.get('query') || '');
  } catch {
    return false;
  }
}

export function needsGoogleSearchFallback(activity, directPlace, action) {
  return action === 'unresolved' && Boolean(activity?.google_place_id && directPlace);
}
