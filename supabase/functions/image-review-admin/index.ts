import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const adminEmails = new Set([
  'talkingmeowth06@gmail.com',
  'talkingmeowtho6@gmail.com',
  'benfielden@gmail.com',
])
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const blockedImageTerms = /(favicon|icon|logo|wordmark|brand|badge|avatar|social[-_ ]?(?:icon|link|media)|facebook|fbcdn|scontent|cdninstagram|instagram|twitter|twimg|tiktok|linkedin|pinterest|youtube|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play)/i
const maxImageBytes = 8 * 1024 * 1024

type Activity = {
  activity_id: string
  category: string | null
  public_listing_status: string
  codex_image_candidates?: unknown
  codex_image_search_query?: string | null
  codex_image_searched_at?: string | null
  codex_image_search_model?: string | null
}

type Candidate = {
  image_url: string
  thumbnail_url: string | null
  source_page_url: string | null
  source_domain: string
  title: string | null
  width: number | null
  height: number | null
  relevance_reason: string | null
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function cleanText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function validHttpUrl(value: unknown) {
  try {
    const url = new URL(cleanText(value))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function domain(value: unknown) {
  try {
    return new URL(cleanText(value)).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function allowsWikimediaImages(activity: Pick<Activity, 'category'>) {
  const category = cleanText(activity.category).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
  return ['parks and outdoor play', 'museums and culture', 'family activities'].includes(category)
}

function isWikimediaSource(value: unknown) {
  if (/\b(?:wikimedia commons|wikipedia)\b/i.test(cleanText(value))) return true
  const host = domain(value)
  return host === 'wikimedia.org' || host.endsWith('.wikimedia.org')
    || host === 'wikipedia.org' || host.endsWith('.wikipedia.org')
}

function normalizeCandidate(activity: Activity, value: unknown): Candidate | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const imageUrl = cleanText(candidate.image_url)
  const thumbnailUrl = validHttpUrl(candidate.thumbnail_url) ? cleanText(candidate.thumbnail_url) : null
  const sourcePageUrl = validHttpUrl(candidate.source_page_url) ? cleanText(candidate.source_page_url) : null
  if (!validHttpUrl(imageUrl)) return null
  if (blockedImageTerms.test(`${imageUrl} ${thumbnailUrl || ''} ${sourcePageUrl || ''} ${cleanText(candidate.title)}`)) return null
  if (!allowsWikimediaImages(activity) && [imageUrl, thumbnailUrl, sourcePageUrl].some(isWikimediaSource)) return null
  const width = Number(candidate.width)
  const height = Number(candidate.height)
  return {
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl,
    source_page_url: sourcePageUrl,
    source_domain: cleanText(candidate.source_domain) || domain(sourcePageUrl) || domain(imageUrl),
    title: cleanText(candidate.title) || null,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    relevance_reason: cleanText(candidate.relevance_reason) || null,
  }
}

async function authenticatedAdmin(request: Request, supabase: ReturnType<typeof createClient>) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || ''
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  const user = data.user
  if (error || !user?.email || !adminEmails.has(user.email.toLowerCase())) return null
  return user
}

async function findActivity(supabase: ReturnType<typeof createClient>, activityId: string) {
  const { data, error } = await supabase
    .from('activities')
    .select('activity_id,category,public_listing_status,codex_image_candidates,codex_image_search_query,codex_image_searched_at,codex_image_search_model')
    .eq('activity_id', activityId)
    .eq('archive', false)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Listing not found.')
  return data as Activity
}

function readUint32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return 0
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function downloadedImageDimensions(bytes: Uint8Array, contentType: string) {
  if (contentType === 'image/png' && bytes.byteLength >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) }
  }
  if (contentType === 'image/jpeg' && bytes.byteLength >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
    let offset = 2
    while (offset + 9 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset]
      if (marker === 0xda) break
      if (frameMarkers.has(marker) && offset + 7 < bytes.byteLength) {
        return { width: (bytes[offset + 6] << 8) + bytes[offset + 7], height: (bytes[offset + 4] << 8) + bytes[offset + 5] }
      }
      if (offset + 2 >= bytes.byteLength) break
      const length = (bytes[offset + 1] << 8) + bytes[offset + 2]
      if (length < 2) break
      offset += length + 1
    }
  }
  if (contentType === 'image/webp' && bytes.byteLength >= 30
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const subtype = String.fromCharCode(...bytes.slice(12, 16))
    if (subtype === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) }
    if (subtype === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: ((bytes[27] << 8) + bytes[26]) & 0x3fff, height: ((bytes[29] << 8) + bytes[28]) & 0x3fff }
    if (subtype === 'VP8L' && bytes[20] === 0x2f) {
      const packed = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0
      return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
    }
  }
  if (contentType === 'image/avif') {
    for (let offset = 4; offset + 16 < bytes.byteLength; offset += 1) {
      if (bytes[offset] === 0x69 && bytes[offset + 1] === 0x73 && bytes[offset + 2] === 0x70 && bytes[offset + 3] === 0x65) {
        return { width: readUint32(bytes, offset + 8), height: readUint32(bytes, offset + 12) }
      }
    }
  }
  return null
}

function extensionFor(contentType: string) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' } as Record<string, string>)[contentType] || 'jpg'
}

async function downloadCandidate(candidate: Candidate) {
  const candidates = [candidate.image_url, candidate.thumbnail_url].filter((value): value is string => Boolean(value))
  for (const imageUrl of candidates) {
    try {
      const response = await fetch(imageUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
        headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
      })
      const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase()
      const declaredSize = Number(response.headers.get('content-length') || 0)
      if (!response.ok || !acceptedMimeTypes.has(contentType) || (declaredSize && declaredSize > maxImageBytes)) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength < 5 * 1024 || bytes.byteLength > maxImageBytes) continue
      const dimensions = downloadedImageDimensions(bytes, contentType)
      if (!dimensions || Math.min(dimensions.width, dimensions.height) < 300 || dimensions.width * dimensions.height < 180000) continue
      return { bytes, contentType, dimensions }
    } catch {
      // Some image hosts reject direct downloads; the thumbnail is the fallback.
    }
  }
  throw new Error('The selected image could not be downloaded at sufficient resolution.')
}

async function storeReviewedImage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  activity: Activity,
  candidateIndex: number,
  expectedSearchedAt: string,
) {
  if (expectedSearchedAt && Date.parse(expectedSearchedAt) !== Date.parse(activity.codex_image_searched_at || '')) {
    throw new Error('The candidate set changed. Refresh the listing before saving.')
  }
  const candidates = Array.isArray(activity.codex_image_candidates) ? activity.codex_image_candidates : []
  const candidate = normalizeCandidate(activity, candidates[candidateIndex])
  if (!candidate) throw new Error('The selected candidate is no longer available.')
  const downloaded = await downloadCandidate(candidate)
  const selectedAt = new Date().toISOString()
  const revision = Date.parse(activity.codex_image_searched_at || selectedAt)
  const path = `reviewed/${activity.activity_id}/${revision}-${candidateIndex}.${extensionFor(downloaded.contentType)}`
  await supabase.storage.createBucket('activity-images', { public: true }).catch(() => {})
  const upload = await supabase.storage.from('activity-images').upload(path, downloaded.bytes, {
    contentType: downloaded.contentType,
    cacheControl: '31536000',
    upsert: true,
  })
  if (upload.error) throw new Error(upload.error.message)
  const reviewedImageUrl = supabase.storage.from('activity-images').getPublicUrl(path).data.publicUrl
  const sourceUrl = candidate.source_page_url || candidate.image_url
  const model = cleanText(activity.codex_image_search_model) || 'Codex chat'
  const { error: updateError } = await supabase.from('activities').update({
    reviewed_image_url: reviewedImageUrl,
    reviewed_image_source_url: sourceUrl,
    reviewed_image_original_url: candidate.image_url,
    reviewed_image_selected_at: selectedAt,
    reviewed_image_model: model,
    reviewed_image_selected_by_user_id: userId,
    updated_at: selectedAt,
  }).eq('activity_id', activity.activity_id)
  if (updateError) throw new Error(updateError.message)
  const { error: logError } = await supabase.from('activity_image_manual_reviews').insert({
    activity_id: activity.activity_id,
    reviewed_image_url: reviewedImageUrl,
    original_image_url: candidate.image_url,
    source_page_url: candidate.source_page_url,
    search_query: cleanText(activity.codex_image_search_query),
    candidate: { ...candidate, downloaded_width: downloaded.dimensions.width, downloaded_height: downloaded.dimensions.height },
    model,
    selected_by_user_id: userId,
  })
  if (logError) throw new Error(`Image saved, but the manual review log failed: ${logError.message}`)
  return { reviewedImageUrl, sourceUrl, selectedAt, model, candidate }
}

async function publishDraft(supabase: ReturnType<typeof createClient>, activity: Activity, userId: string) {
  if (activity.public_listing_status !== 'draft') throw new Error('Only draft listings can be published from this queue.')
  const publishedAt = new Date().toISOString()
  const { data, error } = await supabase.from('activities').update({
    public_listing_status: 'published',
    archive: false,
    updated_at: publishedAt,
  }).eq('activity_id', activity.activity_id).select('activity_id,public_listing_status,archive').single()
  if (error) throw new Error(error.message)
  await supabase.from('activity_review_queue').update({
    status: 'reviewed',
    reviewed_at: publishedAt,
    reviewed_by_user_id: userId,
  }).eq('activity_id', activity.activity_id).eq('status', 'pending')
  return data
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const user = await authenticatedAdmin(request, supabase)
  if (!user) return jsonResponse({ error: 'Only Tiny Outings administrators can use desktop image review.' }, 403)
  const body = await request.json().catch(() => ({})) as {
    action?: 'select' | 'publish'
    activity_id?: string
    candidate_index?: number
    candidate_set_searched_at?: string
  }
  if (!body.activity_id || !body.action) return jsonResponse({ error: 'action and activity_id are required.' }, 400)
  try {
    const activity = await findActivity(supabase, body.activity_id)
    if (body.action === 'select') {
      if (!Number.isInteger(body.candidate_index) || Number(body.candidate_index) < 0) {
        return jsonResponse({ error: 'candidate_index is required.' }, 400)
      }
      const result = await storeReviewedImage(supabase, user.id, activity, Number(body.candidate_index), cleanText(body.candidate_set_searched_at))
      return jsonResponse({ status: 'selected', ...result })
    }
    if (body.action === 'publish') {
      const result = await publishDraft(supabase, activity, user.id)
      return jsonResponse({ status: 'published', activity: result })
    }
    return jsonResponse({ error: 'Unsupported action.' }, 400)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Image review request failed.' }, 500)
  }
})
