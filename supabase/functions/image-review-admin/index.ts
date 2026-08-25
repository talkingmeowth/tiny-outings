import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hasBlockedAssetTerms } from './candidate-policy.js'

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
const maxImageBytes = 8 * 1024 * 1024

type Activity = {
  activity_id: string
  activity_name: string
  address: string | null
  postcode: string | null
  borough: string | null
  category: string | null
  public_listing_status: string
  codex_image_candidates?: unknown
  codex_image_search_query?: string | null
  codex_image_searched_at?: string | null
  codex_image_search_model?: string | null
  image_review_ignored_at?: string | null
  image_review_ignored_by_user_id?: string | null
  reviewed_image_url?: string | null
  reviewed_image_source_url?: string | null
  reviewed_image_original_url?: string | null
  reviewed_image_selected_at?: string | null
  reviewed_image_model?: string | null
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
  if (hasBlockedAssetTerms(imageUrl, thumbnailUrl, sourcePageUrl, cleanText(candidate.title))) return null
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
  try {
    const payload = token.split('.')[1]
    const decoded = payload ? JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) : null
    if (decoded?.role === 'service_role') return { id: null, email: 'service_role' }
  } catch {
    // Continue with normal user authentication.
  }
  const { data, error } = await supabase.auth.getUser(token)
  const user = data.user
  if (error || !user?.email || !adminEmails.has(user.email.toLowerCase())) return null
  return user
}

async function findActivity(supabase: ReturnType<typeof createClient>, activityId: string) {
  const { data, error } = await supabase
    .from('activities')
    .select('activity_id,activity_name,address,postcode,borough,category,public_listing_status,codex_image_candidates,codex_image_search_query,codex_image_searched_at,codex_image_search_model,image_review_ignored_at,image_review_ignored_by_user_id,reviewed_image_url,reviewed_image_source_url,reviewed_image_original_url,reviewed_image_selected_at,reviewed_image_model')
    .eq('activity_id', activityId)
    .eq('archive', false)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Listing not found.')
  return data as Activity
}

async function searchUnfilteredSerpApiCandidates(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
  candidateRequestId: string,
  suppliedQuery: string,
  requestVariant: string,
  requestedByUserId: string | null,
) {
  const apiKey = Deno.env.get('SERPAPI_API_KEY')
  if (!apiKey) throw new Error('SERPAPI_API_KEY is not configured.')

  let query = cleanText(suppliedQuery)
  if (!query) query = `${cleanText(activity.activity_name)} ${cleanText(activity.address || activity.postcode || activity.borough || 'London')}`.trim()
  const validRequestVariants = new Set(['activity_location', 'provider_location', 'activity_only', 'custom'])
  const normalizedRequestVariant = validRequestVariants.has(requestVariant) ? requestVariant : 'activity_location'
  let requestRow: Record<string, unknown> | null = null
  if (candidateRequestId) {
    const { data: existingRequest, error: requestError } = await supabase
      .from('codex_image_candidate_requests')
      .select('candidate_request_id,activity_id,requested_query,request_variant,requested_at')
      .eq('candidate_request_id', candidateRequestId)
      .maybeSingle()
    if (requestError) throw new Error(requestError.message)
    if (!existingRequest || existingRequest.activity_id !== activity.activity_id) throw new Error('Candidate request not found for this listing.')
    query = cleanText(existingRequest.requested_query) || query
    requestRow = existingRequest
    const { error: requestUpdateError } = await supabase.from('codex_image_candidate_requests').update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
      failure_reason: null,
    }).eq('candidate_request_id', candidateRequestId)
    if (requestUpdateError) throw new Error(requestUpdateError.message)
  } else {
    const cancelledAt = new Date().toISOString()
    const { error: cancelError } = await supabase.from('codex_image_candidate_requests').update({
      status: 'cancelled',
      completed_at: cancelledAt,
      failure_reason: 'Superseded by an immediate SerpAPI search.',
    }).eq('activity_id', activity.activity_id).in('status', ['pending', 'in_progress'])
    if (cancelError) throw new Error(cancelError.message)
    const startedAt = new Date().toISOString()
    const { data: insertedRequest, error: insertError } = await supabase.from('codex_image_candidate_requests').insert({
      activity_id: activity.activity_id,
      requested_query: query.slice(0, 240),
      request_variant: normalizedRequestVariant,
      status: 'in_progress',
      requested_by_user_id: requestedByUserId,
      started_at: startedAt,
    }).select('candidate_request_id,activity_id,requested_query,request_variant,requested_at').single()
    if (insertError) throw new Error(insertError.message)
    requestRow = insertedRequest
  }
  const activeRequestId = cleanText(requestRow?.candidate_request_id || candidateRequestId)

  try {
    const searchUrl = new URL('https://serpapi.com/search.json')
    searchUrl.searchParams.set('engine', 'google_images')
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('location', 'London, England, United Kingdom')
    searchUrl.searchParams.set('api_key', apiKey)
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(25000) })
    if (!response.ok) throw new Error(`SerpAPI returned ${response.status}.`)
    const body = await response.json() as { images_results?: Array<Record<string, unknown>> }
    const rawResults = Array.isArray(body.images_results) ? body.images_results.slice(0, 20) : []
    const candidates = rawResults.map((image, index) => ({
      image_url: cleanText(image.original),
      thumbnail_url: cleanText(image.thumbnail) || null,
      source_page_url: cleanText(image.link) || null,
      source_domain: domain(image.link) || cleanText(image.source),
      title: cleanText(image.title) || null,
      width: Number.isFinite(Number(image.original_width)) ? Number(image.original_width) : null,
      height: Number.isFinite(Number(image.original_height)) ? Number(image.original_height) : null,
      relevance_reason: `Google Images result ${Number(image.position) || index + 1}`,
    }))
    const legacyCandidates = rawResults.map((image, index) => ({
      original: cleanText(image.original),
      thumbnail: cleanText(image.thumbnail) || null,
      title: cleanText(image.title) || null,
      source: cleanText(image.source) || null,
      link: cleanText(image.link) || null,
      position: Number(image.position) || index + 1,
      original_width: Number.isFinite(Number(image.original_width)) ? Number(image.original_width) : null,
      original_height: Number.isFinite(Number(image.original_height)) ? Number(image.original_height) : null,
    }))
    const completedAt = new Date().toISOString()
    const sourceLabel = 'SerpAPI Google Images — top 20 unfiltered'
    const activityUpdate = supabase.from('activities').update({
      codex_image_candidates: candidates,
      codex_image_search_query: query,
      codex_image_searched_at: completedAt,
      codex_image_search_model: sourceLabel,
      serpapi_image_candidates: legacyCandidates,
      serpapi_image_search_query: query,
      serpapi_image_candidates_fetched_at: completedAt,
      serpapi_image_checked_at: completedAt,
      updated_at: completedAt,
    }).eq('activity_id', activity.activity_id)
    const requestUpdate = activeRequestId
      ? supabase.from('codex_image_candidate_requests').update({
        status: 'completed',
        completed_at: completedAt,
        codex_model: sourceLabel,
        candidate_count: candidates.length,
        failure_reason: null,
      }).eq('candidate_request_id', activeRequestId)
      : Promise.resolve({ error: null })
    const [{ error: activityError }, { error: requestError }] = await Promise.all([activityUpdate, requestUpdate])
    if (activityError) throw new Error(activityError.message)
    if (requestError) throw new Error(requestError.message)
    return {
      candidates,
      query,
      searchedAt: completedAt,
      source: sourceLabel,
      request: {
        ...requestRow,
        candidate_request_id: activeRequestId,
        requested_query: query,
        status: 'completed',
        completed_at: completedAt,
        codex_model: sourceLabel,
        candidate_count: candidates.length,
        failure_reason: null,
      },
    }
  } catch (error) {
    if (activeRequestId) {
      await supabase.from('codex_image_candidate_requests').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        failure_reason: error instanceof Error ? error.message : 'SerpAPI image search failed.',
      }).eq('candidate_request_id', activeRequestId)
    }
    throw error
  }
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

async function downloadCandidateUrl(imageUrl: string, signal: AbortSignal) {
  const response = await fetch(imageUrl, {
    redirect: 'follow',
    signal,
    headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
  })
  const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase()
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (!response.ok || !acceptedMimeTypes.has(contentType) || (declaredSize && declaredSize > maxImageBytes)) {
    throw new Error('Image response was not usable.')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength < 5 * 1024 || bytes.byteLength > maxImageBytes) throw new Error('Image file size was not usable.')
  const dimensions = downloadedImageDimensions(bytes, contentType)
  if (!dimensions || Math.min(dimensions.width, dimensions.height) < 300 || dimensions.width * dimensions.height < 180000) {
    throw new Error('Image resolution was not usable.')
  }
  return { bytes, contentType, dimensions }
}

async function downloadCandidate(candidate: Candidate) {
  const imageUrls = [...new Set([candidate.image_url, candidate.thumbnail_url]
    .filter((value): value is string => Boolean(value)))]
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    return await Promise.any(imageUrls.map((imageUrl) => downloadCandidateUrl(imageUrl, controller.signal)))
  } catch {
    throw new Error('The selected image could not be downloaded at sufficient resolution.')
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
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
  const sourceUrl = candidate.source_page_url || candidate.image_url
  const model = cleanText(activity.codex_image_search_model) || 'Desktop image review'
  if (cleanText(activity.reviewed_image_original_url) === candidate.image_url && cleanText(activity.reviewed_image_url)) {
    return {
      reviewedImageUrl: cleanText(activity.reviewed_image_url),
      sourceUrl: cleanText(activity.reviewed_image_source_url) || sourceUrl,
      selectedAt: cleanText(activity.reviewed_image_selected_at) || new Date().toISOString(),
      model: cleanText(activity.reviewed_image_model) || model,
      candidate,
    }
  }
  const downloaded = await downloadCandidate(candidate)
  const selectedAt = new Date().toISOString()
  const revision = Date.parse(activity.codex_image_searched_at || selectedAt)
  const path = `reviewed/${activity.activity_id}/${revision}-${candidateIndex}.${extensionFor(downloaded.contentType)}`
  const upload = await supabase.storage.from('activity-images').upload(path, downloaded.bytes, {
    contentType: downloaded.contentType,
    cacheControl: '31536000',
    upsert: true,
  })
  if (upload.error) throw new Error(upload.error.message)
  const reviewedImageUrl = supabase.storage.from('activity-images').getPublicUrl(path).data.publicUrl
  const activityUpdate = supabase.from('activities').update({
    reviewed_image_url: reviewedImageUrl,
    reviewed_image_source_url: sourceUrl,
    reviewed_image_original_url: candidate.image_url,
    reviewed_image_selected_at: selectedAt,
    reviewed_image_model: model,
    reviewed_image_selected_by_user_id: userId,
    updated_at: selectedAt,
  }).eq('activity_id', activity.activity_id)
  const reviewLog = supabase.from('activity_image_manual_reviews').insert({
    activity_id: activity.activity_id,
    reviewed_image_url: reviewedImageUrl,
    original_image_url: candidate.image_url,
    source_page_url: candidate.source_page_url,
    search_query: cleanText(activity.codex_image_search_query),
    candidate: { ...candidate, downloaded_width: downloaded.dimensions.width, downloaded_height: downloaded.dimensions.height },
    model,
    selected_by_user_id: userId,
  })
  const [{ error: updateError }, { error: logError }] = await Promise.all([activityUpdate, reviewLog])
  if (updateError) throw new Error(updateError.message)
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

async function setImageReviewIgnored(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
  userId: string,
  ignored: boolean,
) {
  const changedAt = new Date().toISOString()
  const { data, error } = await supabase.from('activities').update({
    image_review_ignored_at: ignored ? changedAt : null,
    image_review_ignored_by_user_id: ignored ? userId : null,
    updated_at: changedAt,
  }).eq('activity_id', activity.activity_id)
    .select('activity_id,image_review_ignored_at,image_review_ignored_by_user_id')
    .single()
  if (error) throw new Error(error.message)
  return data
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const user = await authenticatedAdmin(request, supabase)
  if (!user) return jsonResponse({ error: 'Only Tiny Outings administrators can use desktop image review.' }, 403)
  const body = await request.json().catch(() => ({})) as {
    action?: 'search' | 'select' | 'publish' | 'ignore'
    activity_id?: string
    candidate_request_id?: string
    query?: string
    request_variant?: string
    candidate_index?: number
    candidate_set_searched_at?: string
    ignored?: boolean
  }
  if (!body.activity_id || !body.action) return jsonResponse({ error: 'action and activity_id are required.' }, 400)
  try {
    const activity = await findActivity(supabase, body.activity_id)
    if (body.action === 'search') {
      const result = await searchUnfilteredSerpApiCandidates(
        supabase,
        activity,
        cleanText(body.candidate_request_id),
        cleanText(body.query),
        cleanText(body.request_variant),
        user.id,
      )
      return jsonResponse({ status: 'searched', ...result })
    }
    if (body.action === 'select') {
      if (!user.id) return jsonResponse({ error: 'An administrator user session is required to select an image.' }, 403)
      if (!Number.isInteger(body.candidate_index) || Number(body.candidate_index) < 0) {
        return jsonResponse({ error: 'candidate_index is required.' }, 400)
      }
      const result = await storeReviewedImage(supabase, user.id, activity, Number(body.candidate_index), cleanText(body.candidate_set_searched_at))
      return jsonResponse({ status: 'selected', ...result })
    }
    if (body.action === 'publish') {
      if (!user.id) return jsonResponse({ error: 'An administrator user session is required to publish a listing.' }, 403)
      const result = await publishDraft(supabase, activity, user.id)
      return jsonResponse({ status: 'published', activity: result })
    }
    if (body.action === 'ignore') {
      if (!user.id) return jsonResponse({ error: 'An administrator user session is required to change image review status.' }, 403)
      const result = await setImageReviewIgnored(supabase, activity, user.id, body.ignored !== false)
      return jsonResponse({ status: result.image_review_ignored_at ? 'ignored' : 'reviewable', activity: result })
    }
    return jsonResponse({ error: 'Unsupported action.' }, 400)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Image review request failed.' }, 500)
  }
})
