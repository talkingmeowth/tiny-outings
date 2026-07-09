const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const placeFields = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'googleMapsUri',
  'websiteUri',
  'rating',
  'userRatingCount',
  'primaryType',
  'photos',
  'regularOpeningHours',
  'editorialSummary',
].join(',');

const textSearchFields = placeFields
  .split(',')
  .map((field) => `places.${field}`)
  .join(',');

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function getApiKey() {
  return Deno.env.get('GOOGLE_MAPS_API_KEY') || Deno.env.get('GOOGLE_PLACES_API_KEY');
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

function extractPlaceId(link: string) {
  try {
    const parsed = new URL(link);
    return (
      parsed.searchParams.get('place_id') ||
      parsed.searchParams.get('query_place_id') ||
      parsed.searchParams.get('destination_place_id')
    );
  } catch {
    return null;
  }
}

function textQueryFromLink(link: string) {
  try {
    const parsed = new URL(link);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const placeIndex = pathParts.findIndex((part) => part.toLowerCase() === 'place');
    if (placeIndex >= 0 && pathParts[placeIndex + 1]) {
      return decodeURIComponent(pathParts[placeIndex + 1]).replaceAll('+', ' ');
    }

    const query = parsed.searchParams.get('query') || parsed.searchParams.get('q');
    if (query) return query;

    return `${parsed.hostname.replace(/^www\./, '')} ${decodeURIComponent(parsed.pathname).replace(/[/-]/g, ' ')}`.trim();
  } catch {
    return link;
  }
}

function mapCategory(primaryType: string | undefined) {
  const type = (primaryType || '').toLowerCase();
  if (type.includes('cafe') || type.includes('coffee')) return 'coffee';
  if (type.includes('restaurant') || type.includes('meal')) return 'lunch';
  if (type.includes('museum') || type.includes('gallery')) return 'museum';
  if (type.includes('library')) return 'library';
  if (type.includes('park') || type.includes('playground')) return 'outdoors';
  if (type.includes('gym') || type.includes('fitness')) return 'baby yoga';
  return 'parent friendly';
}

function inferBorough(address: string | undefined) {
  const value = (address || '').toLowerCase();
  if (value.includes('waltham forest') || /\b(e17|e10|e11|e4)\b/i.test(value)) return 'Waltham Forest';
  if (value.includes('hackney') || /\b(e8|e9|n1|n16)\b/i.test(value)) return 'Hackney';
  if (value.includes('islington') || /\b(n1|n5|n7|n19)\b/i.test(value)) return 'Islington';
  if (value.includes('newham') || /\b(e6|e7|e12|e13|e15|e16)\b/i.test(value)) return 'Newham';
  return undefined;
}

async function fetchPlaceDetails(placeId: string, apiKey: string) {
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en-GB&regionCode=GB`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': placeFields,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Place Details failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function searchPlace(textQuery: string, apiKey: string) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': textSearchFields,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'en-GB',
      regionCode: 'GB',
      locationBias: {
        circle: {
          center: {
            latitude: 51.5845,
            longitude: -0.021,
          },
          radius: 18000,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Text Search failed (${response.status}): ${text}`);
  }

  const body = await response.json();
  return body.places?.[0] || null;
}

async function fetchPhotoUri(photoName: string | undefined, apiKey: string) {
  if (!photoName) return null;

  const response = await fetch(
    `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200&skipHttpRedirect=true`,
    {
      headers: {
        'X-Goog-Api-Key': apiKey,
      },
    },
  );

  if (!response.ok) return null;
  const body = await response.json();
  return body.photoUri || null;
}

function normalizePlace(place: Record<string, unknown>, sourceLink: string, photoUrl: string | null) {
  const displayName = place.displayName as { text?: string } | undefined;
  const location = place.location as { latitude?: number; longitude?: number } | undefined;
  const openingHours = place.regularOpeningHours;
  const editorialSummary = place.editorialSummary as { text?: string } | undefined;
  const formattedAddress = place.formattedAddress as string | undefined;
  const primaryType = place.primaryType as string | undefined;
  const rating = place.rating as number | undefined;
  const userRatingCount = place.userRatingCount as number | undefined;

  return {
    activity_name: displayName?.text || 'Untitled activity',
    address: formattedAddress || '',
    lat: location?.latitude ?? null,
    long: location?.longitude ?? null,
    category: mapCategory(primaryType),
    start_time: '09:00',
    end_time: '10:00',
    google_link: (place.googleMapsUri as string | undefined) || sourceLink,
    website: (place.websiteUri as string | undefined) || null,
    child_friendly_score: null,
    app_rating: rating ?? null,
    number_of_reviews: userRatingCount ?? 0,
    age_suitability: 'Under 5s',
    borough: inferBorough(formattedAddress),
    description: editorialSummary?.text || null,
    source_url: sourceLink,
    google_place_id: place.id as string | undefined,
    google_place_uri: (place.googleMapsUri as string | undefined) || null,
    google_photo_url: photoUrl,
    google_rating: rating ?? null,
    google_user_rating_count: userRatingCount ?? 0,
    google_primary_type: primaryType || null,
    google_opening_hours: openingHours || null,
    google_summary: editorialSummary?.text || null,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST a JSON body with a link.' }, 405);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return jsonResponse(
      { error: 'Set GOOGLE_MAPS_API_KEY as a Supabase Edge Function secret before using activity autofill.' },
      503,
    );
  }

  try {
    const { link } = await request.json();
    if (!link || typeof link !== 'string') {
      return jsonResponse({ error: 'Missing link.' }, 400);
    }

    const resolvedLink = await resolveRedirects(link.trim());
    const placeId = extractPlaceId(resolvedLink);
    const searchedPlace = placeId
      ? null
      : await searchPlace(textQueryFromLink(resolvedLink), apiKey);
    const place = placeId
      ? await fetchPlaceDetails(placeId, apiKey)
      : searchedPlace;

    if (!place) {
      return jsonResponse({ error: 'Google Places could not find a matching place.' }, 404);
    }

    const placeForDetails = place.id && !placeId
      ? await fetchPlaceDetails(place.id as string, apiKey)
      : place;
    const photos = placeForDetails.photos as Array<{ name?: string }> | undefined;
    const photoUrl = await fetchPhotoUri(photos?.[0]?.name, apiKey);

    return jsonResponse({
      activity: normalizePlace(placeForDetails, resolvedLink, photoUrl),
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Activity autofill failed.' },
      500,
    );
  }
});
