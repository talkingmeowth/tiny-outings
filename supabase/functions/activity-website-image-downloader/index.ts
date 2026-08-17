import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tiny-outings-image-job-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const adminEmails = new Set([
  'talkingmeowth06@gmail.com',
  'talkingmeowtho6@gmail.com',
  'benfielden@gmail.com',
])
const maxImageBytes = 8 * 1024 * 1024
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const blockedImageTerms = /(favicon|icon|wordmark|site-logo|social[-_ ]?(?:icon|link|media)|facebook[.]com\/tr|facebook[.]net\/tr|twitter[0-9_-]*\.(?:png|jpe?g|webp)|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play|\/flags\/|site-flag|country-selector|language-selector)/i

type Activity = {
  activity_id: string
  activity_name: string
  website: string | null
  organiser_website: string | null
  source_url: string | null
  image_url: string | null
  scraped_image_url: string | null
  website_image_url: string | null
  listing_image_url: string | null
  wikimedia_image_url: string | null
  user_image_url: string | null
  admin_cover_image_url: string | null
  website_downloaded_image: string | null
  organiser_website_downloaded_image: string | null
}

type Candidate = { url: string; score: number }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function serviceRoleKey() {
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacyKey) return legacyKey
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    return keys.default || Object.values(keys).find((value) => typeof value === 'string') || null
  } catch {
    return null
  }
}

function isServiceRoleToken(token: string) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return false
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return decoded.role === 'service_role'
  } catch {
    return false
  }
}

async function authorize(request: Request, supabase: ReturnType<typeof createClient>) {
  const jobSecret = Deno.env.get('TINY_OUTINGS_IMAGE_JOB_SECRET') || ''
  if (jobSecret && request.headers.get('x-tiny-outings-image-job-token') === jobSecret) return true

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || ''
  if (!token) return false
  if (isServiceRoleToken(token)) return true
  const { data, error } = await supabase.auth.getUser(token)
  return !error && Boolean(data.user?.email && adminEmails.has(data.user.email.toLowerCase()))
}

function decodeHtml(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || null
}

function absoluteUrl(value: string | null, baseUrl: string) {
  if (!value) return null
  try {
    const url = new URL(decodeHtml(value), baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

function usableImageUrl(value: string | null) {
  if (!value || blockedImageTerms.test(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

function candidateScore(url: string, context = '') {
  const text = `${url} ${context}`.toLowerCase()
  let score = 0
  if (/(hero|feature|gallery|interior|venue|studio|class|play|people|baby|family|food|coffee|room|space)/.test(text)) score += 25
  if (/(full|large|original|2048|1600|1200|1080|1024)/.test(text)) score += 12
  if (/(thumbnail|thumb|150x150|200x200|300x300|banner|social-share|default)/.test(text)) score -= 18
  if (/(graphic|illustration|cartoon|poster|flyer|template|stock)/.test(text)) score -= 15
  if (/(logo|brand|wordmark|badge|avatar)/.test(text)) score -= 30
  return score
}

function imageCandidatesFromPage(html: string, baseUrl: string) {
  const candidates: Candidate[] = []
  const add = (rawUrl: string | null, context = '') => {
    const url = absoluteUrl(rawUrl, baseUrl)
    if (url && usableImageUrl(url) && !blockedImageTerms.test(context)) {
      candidates.push({ url, score: candidateScore(url, context) })
    }
  }

  for (const tag of html.match(/<meta\s+[^>]*>/gi) || []) {
    const key = (attribute(tag, 'property') || attribute(tag, 'name') || '').toLowerCase()
    if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key)) {
      add(attribute(tag, 'content'), key)
    }
  }

  for (const script of html.match(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []) {
    try {
      const parsed = JSON.parse(script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim())
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed?.['@graph'] || [])]
      for (const node of nodes) {
        const image = Array.isArray(node?.image) ? node.image[0] : node?.image
        add(typeof image === 'string' ? image : image?.url || null, 'structured image')
      }
    } catch {
      // Invalid structured data is common. Metadata and image tags remain useful.
    }
  }

  for (const tag of html.match(/<img\s+[^>]*>/gi) || []) {
    const srcset = attribute(tag, 'srcset') || attribute(tag, 'data-srcset')
    const srcsetUrl = srcset?.split(',')
      .map((item) => {
        const [url, width] = item.trim().split(/\s+/)
        return { url, width: Number(width?.replace(/\D/g, '') || 0) }
      })
      .sort((left, right) => right.width - left.width)[0]?.url || null
    const rawUrl = srcsetUrl || attribute(tag, 'data-lazyload') || attribute(tag, 'data-src') || attribute(tag, 'data-original') || attribute(tag, 'src')
    const context = [attribute(tag, 'alt'), attribute(tag, 'title'), attribute(tag, 'class')].filter(Boolean).join(' ')
    add(rawUrl, context)
  }

  for (const match of html.matchAll(/background(?:-image)?\s*:\s*url\(([^)]+)\)/gi)) {
    add(match[1].trim().replace(/^["']|["']$/g, ''), 'background image')
  }

  const seen = new Set<string>()
  return candidates
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => !seen.has(candidate.url) && Boolean(seen.add(candidate.url)))
}

async function pageCandidates(sourceUrl: string) {
  try {
    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Tiny Outings image downloader (+https://tiny-outings-cpjh.onrender.com/)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) return []
    return imageCandidatesFromPage(await response.text(), response.url || sourceUrl)
  } catch {
    return []
  }
}

function extensionFor(contentType: string, imageUrl: string) {
  const fromMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  }
  if (fromMime[contentType]) return fromMime[contentType]
  return imageUrl.match(/\.([a-z]{3,4})(?:[?#]|$)/i)?.[1]?.toLowerCase() || 'jpg'
}

function stableName(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

async function downloadToStorage(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
  sourceKind: 'website' | 'organiser',
  candidates: Candidate[],
) {
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
        headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
      })
      const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase()
      const declaredSize = Number(response.headers.get('content-length') || 0)
      if (!response.ok || !acceptedMimeTypes.has(contentType) || (declaredSize && declaredSize > maxImageBytes)) continue

      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength < 1024 || bytes.byteLength > maxImageBytes) continue

      const path = `downloaded/${sourceKind}/${activity.activity_id}-${stableName(candidate.url)}.${extensionFor(contentType, candidate.url)}`
      const upload = await supabase.storage.from('activity-images').upload(path, bytes, {
        contentType,
        cacheControl: '31536000',
        upsert: true,
      })
      if (upload.error) continue

      return {
        source_url: candidate.url,
        public_url: supabase.storage.from('activity-images').getPublicUrl(path).data.publicUrl,
      }
    } catch {
      // Try the next validated candidate from the same official page.
    }
  }
  return null
}

function hasCardImage(activity: Activity) {
  return [
    activity.admin_cover_image_url,
    activity.user_image_url,
    activity.scraped_image_url,
    activity.organiser_website_downloaded_image,
    activity.website_downloaded_image,
    activity.wikimedia_image_url,
    activity.website_image_url,
    activity.listing_image_url,
  ].some((image) => usableImageUrl(image))
}

function uniqueUrls(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  return values.filter((value): value is string => {
    if (!value) return false
    try {
      const url = new URL(value).toString()
      if (!['http:', 'https:'].includes(new URL(url).protocol) || /google\./i.test(url) || seen.has(url)) return false
      seen.add(url)
      return true
    } catch {
      return false
    }
  })
}

async function processActivity(supabase: ReturnType<typeof createClient>, activity: Activity) {
  if (hasCardImage(activity)) return { activity_id: activity.activity_id, status: 'already-covered' }

  const organiserPages = uniqueUrls([activity.organiser_website])
  const websitePages = uniqueUrls([activity.website, activity.source_url]).filter((url) => !organiserPages.includes(url))
  const organiserCandidates = activity.organiser_website
    ? [{ url: activity.website_image_url, score: 100 }, ...(await Promise.all(organiserPages.map(pageCandidates))).flat()]
    : []
  const organiserImage = await downloadToStorage(
    supabase,
    activity,
    'organiser',
    organiserCandidates.filter((candidate): candidate is Candidate => Boolean(candidate.url && usableImageUrl(candidate.url))),
  )
  if (organiserImage) {
    const { error } = await supabase.from('activities').update({
      organiser_website_downloaded_image: organiserImage.public_url,
      updated_at: new Date().toISOString(),
    }).eq('activity_id', activity.activity_id)
    return error
      ? { activity_id: activity.activity_id, status: 'update-failed', reason: error.message }
      : { activity_id: activity.activity_id, status: 'organiser-downloaded', source_url: organiserImage.source_url }
  }

  const websiteCandidates = [
    { url: activity.listing_image_url, score: 100 },
    ...(activity.organiser_website ? [] : [{ url: activity.website_image_url, score: 95 }]),
    ...(await Promise.all(websitePages.map(pageCandidates))).flat(),
  ]
  const websiteImage = await downloadToStorage(
    supabase,
    activity,
    'website',
    websiteCandidates.filter((candidate): candidate is Candidate => Boolean(candidate.url && usableImageUrl(candidate.url))),
  )
  if (!websiteImage) return { activity_id: activity.activity_id, status: 'no-usable-image' }

  const { error } = await supabase.from('activities').update({
    website_downloaded_image: websiteImage.public_url,
    updated_at: new Date().toISOString(),
  }).eq('activity_id', activity.activity_id)
  return error
    ? { activity_id: activity.activity_id, status: 'update-failed', reason: error.message }
    : { activity_id: activity.activity_id, status: 'website-downloaded', source_url: websiteImage.source_url }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = []
  let index = 0
  async function worker() {
    while (index < items.length) {
      const current = index
      index += 1
      results[current] = await mapper(items[current])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST to download image batches.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = serviceRoleKey()
  if (!url || !serviceKey) return jsonResponse({ error: 'The downloader is missing its Supabase service role configuration.' }, 500)
  const supabase = createClient(url, serviceKey)
  if (!(await authorize(request, supabase))) return jsonResponse({ error: 'Only Tiny Outings administrators or the manual update job can download images.' }, 403)

  try {
    const body = await request.json().catch(() => ({}))
    const activityIds = Array.isArray(body.activity_ids)
      ? [...new Set(body.activity_ids.filter((id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 25)
      : []
    if (!activityIds.length) return jsonResponse({ error: 'Provide up to 25 activity_ids.' }, 400)

    const { data, error } = await supabase.from('activities')
      .select('activity_id,activity_name,website,organiser_website,source_url,image_url,scraped_image_url,website_image_url,listing_image_url,wikimedia_image_url,user_image_url,admin_cover_image_url,website_downloaded_image,organiser_website_downloaded_image')
      .eq('public_listing_status', 'published')
      .eq('archive', false)
      .in('activity_id', activityIds)
    if (error) throw new Error(error.message)

    const results = await mapWithConcurrency((data || []) as Activity[], 4, (activity) => processActivity(supabase, activity))
    return jsonResponse({ processed: results.length, results })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Image download failed.' }, 500)
  }
})
