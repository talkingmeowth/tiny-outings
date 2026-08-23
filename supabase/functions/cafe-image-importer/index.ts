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
const maxBatchSize = 20
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const blockedImageTerms = /(favicon|icon|wordmark|site-logo|social[-_ ]?(?:icon|link|media)|facebook|fbcdn|scontent|cdninstagram|instagram|twitter|twimg|tiktok|linkedin|pinterest|youtube|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play|\/flags\/|site-flag|country-selector|language-selector)/i
const ignoredTitleWords = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'london', 'class', 'classes', 'club', 'activity', 'activities', 'family', 'families', 'children', 'child', 'baby', 'babies', 'toddler', 'toddlers'])

type SearchImage = {
  original?: string
  title?: string
  source?: string
  link?: string
}

type Activity = {
  activity_id: string
  activity_name: string
  address: string | null
  category: string | null
  website: string | null
  organiser_website: string | null
  scraped_image_url: string | null
  image_source_url: string | null
}

type SerpApiAssessment = 'updated' | 'no-usable-image'

class SerpApiRateLimitError extends Error {}

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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

async function authorised(request: Request, supabase: ReturnType<typeof createClient>) {
  const jobSecret = Deno.env.get('TINY_OUTINGS_IMAGE_JOB_SECRET') || ''
  if (jobSecret && request.headers.get('x-tiny-outings-image-job-token') === jobSecret) return true

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || ''
  if (!token) return false
  if (isServiceRoleToken(token)) return true
  const { data, error } = await supabase.auth.getUser(token)
  return !error && Boolean(data.user?.email && adminEmails.has(data.user.email.toLowerCase()))
}

function usableImageUrl(value: string | undefined) {
  if (!value || blockedImageTerms.test(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

function normalisedText(value: string | undefined | null) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function significantTitleWords(activityName: string) {
  return [...new Set(normalisedText(activityName).split(' ')
    .filter((word) => word.length > 2 && !ignoredTitleWords.has(word)))]
}

function hostRoot(value: string | undefined | null) {
  try {
    const labels = new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '').split('.')
    if (labels.length < 2) return labels.join('.')
    // Keep the organisation part of UK domains such as example.co.uk.
    return labels.slice(labels.at(-2) === 'uk' && labels.at(-3) ? -3 : -2).join('.')
  } catch {
    return ''
  }
}

function candidateText(image: SearchImage) {
  return [image.original, image.title, image.source, image.link].filter(Boolean).join(' ').toLowerCase()
}

function isOfficialCandidate(image: SearchImage, activity: Activity) {
  const officialHosts = [activity.website, activity.organiser_website]
    .map(hostRoot)
    .filter(Boolean)
  if (!officialHosts.length) return false
  return [image.original, image.link]
    .map(hostRoot)
    .some((host) => host && officialHosts.includes(host))
}

function imageConfidence(image: SearchImage, activity: Activity) {
  const text = candidateText(image)
  const title = normalisedText(activity.activity_name)
  const words = significantTitleWords(activity.activity_name)
  const matchingWords = words.filter((word) => text.includes(word))
  const exactTitle = title.length >= 7 && text.includes(title)
  const official = isOfficialCandidate(image, activity)
  const score = (exactTitle ? 72 : 0)
    + Math.min(54, matchingWords.length * 27)
    + (official ? 48 : 0)

  // Search results can include visually suitable images for a different venue.
  // Require a full name match, several distinctive words, or an official page
  // plus a distinctive title word before writing a card image.
  const highConfidence = exactTitle
    || matchingWords.length >= 2
    || (official && matchingWords.length >= 1)
  return { highConfidence, score, matchingWords, official }
}

function imageScore(image: SearchImage, activity: Activity) {
  const text = [image.original, image.title, image.source, image.link].filter(Boolean).join(' ').toLowerCase()
  const confidence = imageConfidence(image, activity)
  const isCafe = /cafe|coffee|bakery|restaurant|food/.test(String(activity.category || '').toLowerCase())
  let score = confidence.score
  if (isCafe && /(interior|inside|dining[ -]?room|seating|coffee[ -]?bar|cafe[ -]?space|venue[ -]?space|tables?)/.test(text)) score += 95
  else if (isCafe && /(food|cake|brunch|pastry|coffee|kitchen)/.test(text)) score += 50
  else if (isCafe && /(front|exterior|facade|outside|street)/.test(text)) score += 5
  if (/(logo|brand|wordmark|menu|flyer|poster|facebook|fbcdn|scontent|cdninstagram|instagram|twitter|twimg|linkedin|profile)/.test(text)) score -= 100
  if (/(thumb|thumbnail|150x150|200x200|300x300|avatar|default)/.test(text)) score -= 45
  return score
}

function existingImageScore(activity: Activity) {
  if (!activity.scraped_image_url) return Number.NEGATIVE_INFINITY
  const text = [activity.scraped_image_url, activity.image_source_url, activity.activity_name, activity.category]
    .filter(Boolean).join(' ').toLowerCase()
  const isCafe = /cafe|coffee|bakery|restaurant|food/.test(String(activity.category || '').toLowerCase())
  let score = 0
  if (isCafe && /(interior|inside|dining[ -]?room|seating|coffee[ -]?bar|cafe[ -]?space|venue[ -]?space|tables?)/.test(text)) score += 95
  else if (isCafe && /(food|cake|brunch|pastry|coffee|kitchen)/.test(text)) score += 50
  if (/(logo|brand|wordmark|menu|flyer|poster|facebook|instagram|twitter|linkedin|profile)/.test(text)) score -= 100
  if (/(thumb|thumbnail|150x150|200x200|300x300|avatar|default)/.test(text)) score -= 45
  return score
}

function extensionFor(contentType: string, imageUrl: string) {
  const byType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  }
  return byType[contentType] || imageUrl.match(/\.([a-z]{3,4})(?:[?#]|$)/i)?.[1]?.toLowerCase() || 'jpg'
}

async function findAndStoreImage(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
) {
  const apiKey = Deno.env.get('SERPAPI_API_KEY')
  if (!apiKey) throw new Error('SERPAPI_API_KEY is not configured.')

  const isCafe = /cafe|coffee|bakery|restaurant|food/.test(String(activity.category || '').toLowerCase())
  const query = isCafe
    ? `${activity.activity_name} ${activity.address || 'London'} cafe interior`
    : `${activity.activity_name} ${activity.address || 'London'} ${activity.category || 'family activity'}`
  const searchUrl = new URL('https://serpapi.com/search.json')
  searchUrl.searchParams.set('engine', 'google_images')
  searchUrl.searchParams.set('q', query)
  searchUrl.searchParams.set('location', 'London, England, United Kingdom')
  searchUrl.searchParams.set('tbs', 'itp:photo')
  searchUrl.searchParams.set('api_key', apiKey)

  const search = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) })
  if (search.status === 429) throw new SerpApiRateLimitError('SerpAPI rate limit reached.')
  if (!search.ok) throw new Error(`SerpAPI returned ${search.status}.`)
  const body = await search.json()
  const existingScore = existingImageScore(activity)
  const candidates = (Array.isArray(body.images_results) ? body.images_results : [])
    .filter((image: SearchImage) => usableImageUrl(image.original))
    .filter((image: SearchImage) => imageConfidence(image, activity).highConfidence)
    .sort((left: SearchImage, right: SearchImage) => imageScore(right, activity) - imageScore(left, activity))
    .filter((image: SearchImage) => imageScore(image, activity) > existingScore)
    .slice(0, 5) as SearchImage[]

  for (const candidate of candidates) {
    if (!candidate.original) continue
    try {
      const image = await fetch(candidate.original, {
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
      })
      const contentType = (image.headers.get('content-type') || '').split(';')[0].toLowerCase()
      const declaredSize = Number(image.headers.get('content-length') || 0)
      if (!image.ok || !acceptedMimeTypes.has(contentType) || (declaredSize && declaredSize > maxImageBytes)) continue
      const bytes = new Uint8Array(await image.arrayBuffer())
      if (bytes.byteLength < 1024 || bytes.byteLength > maxImageBytes) continue

      const path = `serpapi/cafes/${activity.activity_id}.${extensionFor(contentType, candidate.original)}`
      const upload = await supabase.storage.from('activity-images').upload(path, bytes, {
        contentType,
        cacheControl: '31536000',
        upsert: true,
      })
      if (upload.error) continue
      return {
        publicUrl: supabase.storage.from('activity-images').getPublicUrl(path).data.publicUrl,
        sourceUrl: candidate.original,
        confidence: imageConfidence(candidate, activity),
      }
    } catch {
      // Try the next high-scoring result when an image host blocks the fetch.
    }
  }
  return null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  if (!(await authorised(request, supabase))) return jsonResponse({ error: 'Only Tiny Outings administrators or the update job can refresh activity images.' }, 403)

  const body = await request.json().catch(() => ({})) as {
    cursor?: string
    batch_size?: number
    scope?: 'all' | 'cafes'
    refresh_existing?: boolean
    activity_ids?: string[]
  }
  const batchSize = Math.min(Math.max(Number(body.batch_size) || maxBatchSize, 1), maxBatchSize)
  const scope = body.scope === 'cafes' ? 'cafes' : 'all'
  const refreshExisting = body.refresh_existing === true
  await supabase.storage.createBucket('activity-images', { public: true }).catch(() => {})

  let query = supabase
    .from('activities')
    .select('activity_id,activity_name,address,category,website,organiser_website,scraped_image_url,image_source_url')
    .in('public_listing_status', ['draft', 'published'])
    .eq('archive', false)
    .order('activity_id', { ascending: true })
    .limit(batchSize)
  const activityIds = [...new Set((body.activity_ids || []).filter((value) => typeof value === 'string' && value.length > 0))]
    .slice(0, maxBatchSize)
  if (scope === 'cafes') query = query.or('category.ilike.%cafe%,category.ilike.%food%')
  if (!refreshExisting && !activityIds.length) {
    // Each new activity receives one vetted SerpAPI assessment, even when an
    // importer has already supplied an official image. The assessment marker
    // avoids re-searching existing cards on every recurring update.
    query = query.is('serpapi_image_checked_at', null)
  }
  if (activityIds.length) query = query.in('activity_id', activityIds)
  else if (body.cursor) query = query.gt('activity_id', body.cursor)

  const { data: activities, error } = await query
  if (error) return jsonResponse({ error: error.message }, 500)

  const results = await mapWithConcurrency(activities || [], 4, async (activity) => {
    try {
      const image = await findAndStoreImage(supabase, activity)
      const assessment: SerpApiAssessment = image ? 'updated' : 'no-usable-image'
      const { error: updateError } = await supabase.from('activities').update({
        // Admin and parent image choices remain higher priority in the app.
        ...(image ? {
          scraped_image_url: image.publicUrl,
          image_source_url: image.sourceUrl,
        } : {}),
        // Persist a completed assessment even when no result meets the quality
        // bar. Failed and rate-limited calls are intentionally left pending.
        serpapi_image_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('activity_id', activity.activity_id)
      return updateError
        ? { activity_id: activity.activity_id, status: 'update-failed', reason: updateError.message }
        : image
          ? { activity_id: activity.activity_id, status: assessment, source_url: image.sourceUrl, confidence: image.confidence.score }
          : { activity_id: activity.activity_id, status: assessment }
    } catch (error) {
      if (error instanceof SerpApiRateLimitError) {
        return { activity_id: activity.activity_id, status: 'rate-limited', reason: error.message }
      }
      return { activity_id: activity.activity_id, status: 'failed', reason: error instanceof Error ? error.message : 'Image search failed.' }
    }
  })

  const last = activities?.at(-1)
  return jsonResponse({
    processed: results.length,
    updated: results.filter((result) => result.status === 'updated').length,
    rate_limited: results.filter((result) => result.status === 'rate-limited').length,
    scope,
    refresh_existing: refreshExisting,
    next_cursor: activityIds.length ? null : activities?.length === batchSize ? last?.activity_id || null : null,
    results,
  })
})
