const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
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
    if (nameMatch && contentMatch && names.includes(nameMatch[1].toLowerCase())) {
      return decodeHtml(contentMatch[1]);
    }
  }
  return null;
}

function inferCategory(value: string) {
  const text = value.toLowerCase();
  if (text.includes('cafe') || text.includes('coffee')) return 'coffee';
  if (text.includes('museum') || text.includes('gallery')) return 'museum';
  if (text.includes('park') || text.includes('playground')) return 'outdoors';
  if (text.includes('yoga')) return 'baby yoga';
  if (text.includes('sing') || text.includes('music')) return 'music & singing';
  if (text.includes('stay') || text.includes('play')) return 'stay & play';
  return 'parent friendly';
}

function inferBorough(value: string) {
  const text = value.toLowerCase();
  if (text.includes('waltham forest') || /\b(e17|e10|e11|e4)\b/i.test(text)) return 'Waltham Forest';
  if (text.includes('hackney') || /\b(e8|e9|n1|n16)\b/i.test(text)) return 'Hackney';
  if (text.includes('islington') || /\b(n1|n5|n7|n19)\b/i.test(text)) return 'Islington';
  if (text.includes('newham') || /\b(e6|e7|e12|e13|e15|e16)\b/i.test(text)) return 'Newham';
  return null;
}

async function extractWebsiteMetadata(link: string) {
  const response = await fetch(link, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Tiny Outings activity preview bot',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('text/html')) {
    throw new Error('The link did not return a public web page.');
  }

  const html = await response.text();
  const title = metaValue(html, ['og:title', 'twitter:title'])
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    || new URL(response.url || link).hostname.replace(/^www\./, '');
  const description = metaValue(html, ['og:description', 'twitter:description', 'description']);
  const imageValue = metaValue(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
  const imageUrl = imageValue ? absoluteUrl(imageValue, response.url || link) : null;
  const address = metaValue(html, ['place:location:address', 'og:street-address']) || '';
  const combinedText = `${title} ${description || ''} ${address} ${response.url || link}`;

  return {
    activity_name: title,
    address,
    lat: null,
    long: null,
    category: inferCategory(combinedText),
    start_time: '09:00',
    end_time: '10:00',
    google_link: null,
    website: response.url || link,
    child_friendly_score: null,
    app_rating: null,
    number_of_reviews: 0,
    age_suitability: 'Under 5s',
    borough: inferBorough(combinedText),
    description,
    source_url: response.url || link,
    google_place_id: null,
    google_place_uri: null,
    google_photo_url: null,
    google_rating: null,
    google_user_rating_count: 0,
    google_primary_type: null,
    google_opening_hours: null,
    google_summary: null,
    image_url: imageUrl,
    image_source_url: imageUrl ? response.url || link : null,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'POST a JSON body with a link.' }, 405);

  try {
    const { link } = await request.json();
    if (!link || typeof link !== 'string') return jsonResponse({ error: 'Missing link.' }, 400);

    const resolvedLink = await resolveRedirects(link.trim());
    const activity = await extractWebsiteMetadata(resolvedLink);
    return jsonResponse({ activity });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Activity autofill failed.' },
      500,
    );
  }
});
