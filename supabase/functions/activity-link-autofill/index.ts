const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const googlePlaceFieldMask = [
  'id',
  'displayName',
  'formattedAddress',
  'addressComponents',
  'location',
  'googleMapsUri',
  'websiteUri',
  'primaryType',
  'editorialSummary',
  'rating',
  'userRatingCount',
  'regularOpeningHours',
].join(',');

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

async function resolveRedirects(link: string) {
  try {
    const head = await fetch(link, { method: 'HEAD', redirect: 'follow' });
    return head.url || link;
  } catch {
    try {
      const response = await fetch(link, { method: 'GET', redirect: 'follow' });
      return response.url || link;
    } catch {
      return link;
    }
  }
}

function canonicalListingUrl(link: string) {
  const url = new URL(link);
  [...url.searchParams.keys()].forEach((key) => {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  });
  url.hash = '';
  return url.toString();
}

function isGoogleMapsUrl(link: string) {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return host === 'maps.app.goo.gl'
      || host === 'google.com'
      || host.endsWith('.google.com')
      || host.endsWith('.google.co.uk');
  } catch {
    return false;
  }
}

function decodeHtml(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function absoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return null;
  }
}

function metaValue(html: string, names: string[]) {
  const metaTags = html.match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const nameMatch = tag.match(/\b(?:property|name)=["']([^"']+)["']/i);
    const contentMatch = tag.match(/\bcontent=["']([^"']+)["']/i);
    if (nameMatch && contentMatch && names.includes(nameMatch[1].toLowerCase())) return decodeHtml(contentMatch[1]);
  }
  return null;
}

function structuredNodes(html: string) {
  const nodes: Record<string, unknown>[] = [];
  const scripts = html.match(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim());
      const values = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [])];
      values.filter((value) => value && typeof value === 'object').forEach((value) => nodes.push(value));
    } catch {
      // Invalid JSON-LD is common. Metadata remains a useful fallback.
    }
  }
  return nodes;
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return textValue(value[0]);
  return cleanText(value);
}

function structuredAddress(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const address = value as Record<string, unknown>;
  return [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode]
    .map(textValue)
    .filter(Boolean)
    .join(', ');
}

function structuredListing(html: string) {
  const node = structuredNodes(html).find((item) => {
    const type = textValue(item['@type']).toLowerCase();
    return /event|localbusiness|organization|place/.test(type);
  }) || {};
  const geo = node.geo && typeof node.geo === 'object' ? node.geo as Record<string, unknown> : {};
  return {
    name: textValue(node.name),
    description: textValue(node.description),
    image: textValue(node.image),
    address: structuredAddress(node.address),
    latitude: Number(textValue(geo.latitude)) || null,
    longitude: Number(textValue(geo.longitude)) || null,
    openingHours: textValue(node.openingHours),
    price: textValue(node.priceRange),
  };
}

function inferCategory(value: string) {
  const text = value.toLowerCase();
  if (text.includes('cafe') || text.includes('coffee')) return 'coffee';
  if (text.includes('museum') || text.includes('gallery')) return 'museum';
  if (text.includes('park') || text.includes('playground')) return 'outdoors';
  if (text.includes('yoga')) return 'baby yoga';
  if (text.includes('sing') || text.includes('music')) return 'music and singing';
  if (text.includes('stay') || text.includes('play')) return 'stay and play';
  return 'parent friendly';
}

function inferBorough(value: string) {
  const text = value.toLowerCase();
  if (text.includes('waltham forest') || /\b(e17|e10|e11|e4)\b/i.test(text)) return 'Waltham Forest';
  if (text.includes('hackney') || /\b(e2|e5|e8|e9|n16)\b/i.test(text)) return 'Hackney';
  if (text.includes('islington') || /\b(n1|n5|n7|n19|ec1)\b/i.test(text)) return 'Islington';
  if (text.includes('newham') || /\b(e6|e7|e12|e13|e15|e16|e20)\b/i.test(text)) return 'Newham';
  return null;
}

function normaliseLondonBorough(value: unknown) {
  const borough = cleanText(value)
    .replace(/^the\s+/i, '')
    .replace(/^london borough of\s+/i, '')
    .replace(/^royal borough of\s+/i, '')
    .replace(/^borough of\s+/i, '')
    .trim();
  return borough || null;
}

function boroughFromAddressComponents(components: unknown) {
  if (!Array.isArray(components)) return null;
  const borough = components.find((component) => {
    const types = Array.isArray(component?.types) ? component.types : [];
    const name = cleanText(component?.longText || component?.long_name);
    return (types.includes('administrative_area_level_2') || types.includes('administrative_area_level_3'))
      && /borough|city of london|westminster|kensington|chelsea/i.test(name);
  });
  return borough ? normaliseLondonBorough(borough.longText || borough.long_name) : null;
}

function postcodeFromAddress(address: string) {
  return address.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase().replace(/\s+/g, ' ') || null;
}

async function boroughFromPostcode(address: string) {
  const postcode = postcodeFromAddress(address);
  if (!postcode) return null;
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const result = (await response.json()).result;
    return normaliseLondonBorough(result?.admin_district);
  } catch {
    return null;
  }
}

async function reverseGeocodeBorough(latitude: number, longitude: number) {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!apiKey || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${latitude},${longitude}`);
    url.searchParams.set('key', apiKey);
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const body = await response.json();
    for (const result of body.results || []) {
      const borough = boroughFromAddressComponents(result.address_components);
      if (borough) return borough;
    }
  } catch {
    // Boroughs remain optional when the Geocoding API is not enabled.
  }
  return null;
}

function conciseCardSummary(value: string | null | undefined) {
  const text = cleanText(value);
  if (!text) return null;
  const firstSentence = text.split(/(?<=[.!])\s+/)[0] || text;
  if (firstSentence.length <= 180) return firstSentence;
  return `${firstSentence.slice(0, 177).replace(/\s+\S*$/, '').trim()}...`;
}

function basicGoogleListing(link: string) {
  const url = new URL(link);
  const query = ['q', 'query', 'place', 'destination']
    .map((key) => url.searchParams.get(key))
    .find(Boolean);
  const pathName = url.pathname.match(/\/maps\/place\/([^/@]+)/i)?.[1];
  const title = decodeURIComponent(query || pathName || 'Google Maps activity').replace(/[+_-]+/g, ' ').trim();

  return {
    activity_name: title || 'Google Maps activity',
    address: 'Address needs review',
    lat: null,
    long: null,
    category: 'Classes and clubs',
    start_time: '09:00',
    end_time: '10:00',
    google_link: link,
    google_place_uri: link,
    website: null,
    organiser_website: null,
    child_friendly_score: null,
    app_rating: null,
    number_of_reviews: 0,
    age_suitability: 'Under 5s',
    borough: null,
    description: 'Google Maps link saved for admin review.',
    card_summary: null,
    cost: null,
    schedule_notes: null,
    source_url: link,
    google_place_id: null,
    google_photo_url: null,
    google_rating: null,
    google_user_rating_count: 0,
    google_primary_type: null,
    google_opening_hours: null,
    google_summary: null,
    image_url: null,
    image_source_url: null,
  };
}

async function extractWebsiteMetadata(link: string, providedName?: string | null) {
  const response = await fetch(link, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Tiny Outings activity preview bot',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('text/html')) throw new Error('The link did not return a public web page.');

  const html = await response.text();
  const structured = structuredListing(html);
  const title = providedName?.trim()
    || structured.name
    || metaValue(html, ['og:title', 'twitter:title'])
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    || new URL(response.url || link).hostname.replace(/^www\./, '');
  const description = structured.description || metaValue(html, ['og:description', 'twitter:description', 'description']);
  const imageValue = structured.image || metaValue(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
  const imageUrl = imageValue ? absoluteUrl(imageValue, response.url || link) : null;
  const address = structured.address || metaValue(html, ['place:location:address', 'og:street-address']) || 'Address needs review';
  const combinedText = `${title} ${description || ''} ${address} ${response.url || link}`;

  return {
    ...basicGoogleListing(link),
    activity_name: title,
    address,
    lat: structured.latitude,
    long: structured.longitude,
    category: inferCategory(combinedText),
    google_link: null,
    google_place_uri: null,
    website: response.url || link,
    organiser_website: null,
    borough: inferBorough(combinedText),
    description,
    card_summary: conciseCardSummary(description),
    cost: structured.price || null,
    schedule_notes: structured.openingHours || null,
    source_url: response.url || link,
    image_url: imageUrl,
    image_source_url: imageUrl ? response.url || link : null,
  };
}

function googlePlaceIdFromLink(link: string) {
  try {
    const url = new URL(link);
    const directId = url.searchParams.get('place_id') || url.searchParams.get('placeId');
    const query = ['q', 'query', 'destination'].map((key) => url.searchParams.get(key)).find(Boolean) || '';
    return directId || decodeURIComponent(query).match(/place_id:([^&\s]+)/i)?.[1] || null;
  } catch {
    return decodeURIComponent(link).match(/place_id:([^&\s]+)/i)?.[1] || null;
  }
}

function googleSearchText(link: string) {
  try {
    const url = new URL(link);
    const query = ['q', 'query', 'place', 'destination']
      .map((key) => url.searchParams.get(key))
      .find(Boolean);
    const pathName = url.pathname.match(/\/maps\/place\/([^/@]+)/i)?.[1];
    return cleanText(decodeURIComponent(query || pathName || '').replace(/[+_-]+/g, ' '));
  } catch {
    return '';
  }
}

async function googlePlaceLookup(activity: Record<string, unknown>, originalLink: string) {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return null;

  const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey };
  const placeId = googlePlaceIdFromLink(originalLink);
  try {
    if (placeId) {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en-GB&regionCode=GB`,
        { headers: { ...headers, 'X-Goog-FieldMask': googlePlaceFieldMask } },
      );
      return response.ok ? await response.json() : null;
    }

    const parts = [
      cleanText(activity.activity_name),
      cleanText(activity.address) === 'Address needs review' ? '' : cleanText(activity.address),
      googleSearchText(originalLink),
    ].filter(Boolean);
    const textQuery = [...new Set(parts)].join(', ');
    if (!textQuery) return null;
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { ...headers, 'X-Goog-FieldMask': `places.${googlePlaceFieldMask.split(',').join(',places.')}` },
      body: JSON.stringify({ textQuery, maxResultCount: 1, languageCode: 'en-GB', regionCode: 'GB' }),
    });
    if (!response.ok) return null;
    return (await response.json()).places?.[0] || null;
  } catch {
    // A Maps restriction must never prevent a parent from sending a draft.
    return null;
  }
}

async function enrichWithGooglePlace(activity: Record<string, any>, place: Record<string, any> | null, submittedLink: string) {
  if (!place) return activity;
  const address = cleanText(place.formattedAddress) || activity.address;
  const description = activity.description || cleanText(place.editorialSummary?.text) || null;
  const latitude = Number(place.location?.latitude);
  const longitude = Number(place.location?.longitude);
  const rating = Number(place.rating);
  const reviewCount = Number(place.userRatingCount);

  const borough = inferBorough(address)
    || boroughFromAddressComponents(place.addressComponents)
    || activity.borough
    || await boroughFromPostcode(address)
    || await reverseGeocodeBorough(latitude, longitude);

  return {
    ...activity,
    activity_name: cleanText(activity.activity_name) || cleanText(place.displayName?.text) || 'Activity needs review',
    address,
    lat: Number.isFinite(latitude) ? latitude : activity.lat,
    long: Number.isFinite(longitude) ? longitude : activity.long,
    borough,
    google_link: cleanText(place.googleMapsUri) || activity.google_link || (isGoogleMapsUrl(submittedLink) ? submittedLink : null),
    google_place_uri: cleanText(place.googleMapsUri) || activity.google_place_uri || (isGoogleMapsUrl(submittedLink) ? submittedLink : null),
    google_place_id: cleanText(place.id) || activity.google_place_id || null,
    website: activity.website || cleanText(place.websiteUri) || null,
    organiser_website: activity.organiser_website || cleanText(place.websiteUri) || null,
    app_rating: Number.isFinite(rating) ? rating : activity.app_rating,
    number_of_reviews: Number.isFinite(reviewCount) ? reviewCount : activity.number_of_reviews,
    google_rating: Number.isFinite(rating) ? rating : activity.google_rating,
    google_user_rating_count: Number.isFinite(reviewCount) ? reviewCount : activity.google_user_rating_count,
    google_primary_type: cleanText(place.primaryType) || activity.google_primary_type || null,
    google_opening_hours: place.regularOpeningHours || activity.google_opening_hours || null,
    google_summary: cleanText(place.editorialSummary?.text) || activity.google_summary || null,
    description,
    card_summary: activity.card_summary || conciseCardSummary(description),
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'POST a JSON body with a link.' }, 405);

  try {
    const { link, activityName } = await request.json();
    if (!link || typeof link !== 'string') return jsonResponse({ error: 'Missing link.' }, 400);

    const resolvedLink = canonicalListingUrl(await resolveRedirects(link.trim()));
    let activity;
    if (isGoogleMapsUrl(resolvedLink)) {
      activity = basicGoogleListing(resolvedLink);
    } else {
      try {
        activity = await extractWebsiteMetadata(resolvedLink, typeof activityName === 'string' ? activityName : null);
      } catch {
        activity = { ...basicGoogleListing(resolvedLink), website: resolvedLink, source_url: resolvedLink };
      }
    }

    const place = await googlePlaceLookup(activity, resolvedLink);
    return jsonResponse({ activity: await enrichWithGooglePlace(activity, place, resolvedLink) });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Activity autofill failed.' },
      500,
    );
  }
});
