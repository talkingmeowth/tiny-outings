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
const blockedImageTerms = /(favicon|icon|wordmark|site-logo|social[-_ ]?(?:icon|link|media)|facebook[.]com\/tr|facebook[.]net\/tr|twitter[0-9_-]*\.(?:png|jpe?g|webp)|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play|\/flags\/|site-flag|country-selector|language-selector)/i

type SearchImage = {
  original?: string
  title?: string
  source?: string
  link?: string
}

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

function imageScore(image: SearchImage, activityName: string) {
  const text = [image.original, image.title, image.source, image.link].filter(Boolean).join(' ').toLowerCase()
  const words = activityName.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2)
  let score = words.reduce((total, word) => total + (text.includes(word) ? 18 : 0), 0)
  if (/(cafe|coffee|bakery|restaurant|interior|inside|food|cake|brunch|pastry|table|kitchen)/.test(text)) score += 20
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
  activity: { activity_id: string; activity_name: string; address: string | null },
) {
  const apiKey = Deno.env.get('SERPAPI_API_KEY')
  if (!apiKey) throw new Error('SERPAPI_API_KEY is not configured.')

  const query = `${activity.activity_name} ${activity.address || 'London'} cafe interior food`
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
  const candidates = (Array.isArray(body.images_results) ? body.images_results : [])
    .filter((image: SearchImage) => usableImageUrl(image.original))
    .sort((left: SearchImage, right: SearchImage) => imageScore(right, activity.activity_name) - imageScore(left, activity.activity_name))
    .slice(0, 3) as SearchImage[]

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
  if (!(await authorised(request, supabase))) return jsonResponse({ error: 'Only Tiny Outings administrators or the update job can refresh cafe images.' }, 403)

  const body = await request.json().catch(() => ({})) as { cursor?: string; batch_size?: number }
  const batchSize = Math.min(Math.max(Number(body.batch_size) || maxBatchSize, 1), maxBatchSize)
  await supabase.storage.createBucket('activity-images', { public: true }).catch(() => {})

  let query = supabase
    .from('activities')
    .select('activity_id,activity_name,address,admin_cover_image_url,user_image_url')
    .eq('public_listing_status', 'published')
    .eq('archive', false)
    .ilike('category', '%cafe%')
    .order('activity_id', { ascending: true })
    .limit(batchSize)
  if (body.cursor) query = query.gt('activity_id', body.cursor)

  const { data: activities, error } = await query
  if (error) return jsonResponse({ error: error.message }, 500)

  const results = await mapWithConcurrency(activities || [], 4, async (activity) => {
    try {
      const image = await findAndStoreImage(supabase, activity)
      if (!image) {
        return { activity_id: activity.activity_id, status: 'no-usable-image' }
      }
      const { error: updateError } = await supabase.from('activities').update({
        // Admin and user cover fields are deliberately untouched and remain higher priority in the app.
        scraped_image_url: image.publicUrl,
        image_url: image.publicUrl,
        image_source_url: image.sourceUrl,
        updated_at: new Date().toISOString(),
      }).eq('activity_id', activity.activity_id)
      return updateError
        ? { activity_id: activity.activity_id, status: 'update-failed', reason: updateError.message }
        : { activity_id: activity.activity_id, status: 'updated', source_url: image.sourceUrl }
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
    next_cursor: activities?.length === batchSize ? last?.activity_id || null : null,
    results,
  })
})
