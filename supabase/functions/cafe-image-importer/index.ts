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
const maxBatchSize = 20
const maxStoredCandidates = 20
const maxImageBytes = 8 * 1024 * 1024
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const blockedImageTerms = /(favicon|icon|logo|wordmark|brand|badge|avatar|social[-_ ]?(?:icon|link|media)|facebook|fbcdn|scontent|cdninstagram|instagram|twitter|twimg|tiktok|linkedin|pinterest|youtube|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play)/i

type SearchImage = {
  original?: string
  thumbnail?: string
  title?: string
  source?: string
  link?: string
  position?: number
  original_width?: number
  original_height?: number
  thumbnail_width?: number
  thumbnail_height?: number
}

type StoredCandidate = {
  original: string
  thumbnail: string | null
  title: string | null
  source: string | null
  link: string | null
  position: number | null
  original_width: number | null
  original_height: number | null
}

type Activity = {
  activity_id: string
  activity_name: string
  address: string | null
  postcode: string | null
  borough: string | null
  category: string | null
  description: string | null
  website: string | null
  organiser_website: string | null
}

type VisionReview = {
  provider: 'codex'
  model: string
  workflow_version: string
  candidate_set_fetched_at: string
}

type SelectionRequest = {
  activity_id: string
  candidate_index: number | null
  selection_reason: string
  selection_confidence: number | null
  clear_selected_image?: boolean
  vision_review?: VisionReview
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
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function text(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function allowsWikimediaImages(activity: Pick<Activity, 'category'>) {
  const category = text(activity.category).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
  return ['parks and outdoor play', 'museums and culture', 'family activities'].includes(category)
}

function isWikimediaSource(value: string | null | undefined) {
  if (/\b(?:wikimedia commons|wikipedia)\b/i.test(text(value))) return true
  try {
    const host = new URL(text(value)).hostname.toLowerCase().replace(/^www\./, '')
    return host === 'wikimedia.org' || host.endsWith('.wikimedia.org')
      || host === 'wikipedia.org' || host.endsWith('.wikipedia.org')
  } catch {
    return false
  }
}

function isDisallowedWikimediaCandidate(activity: Pick<Activity, 'category'>, image: SearchImage | StoredCandidate) {
  return !allowsWikimediaImages(activity)
    && [image.original, image.thumbnail, image.link, image.source].some(isWikimediaSource)
}

function postcodeFromActivity(activity: Activity) {
  return text(activity.postcode) || text(activity.address).match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)?.[1]?.toUpperCase() || ''
}

function fallbackLocality(activity: Activity) {
  const parts = text(activity.address).split(',').map((part) => text(part)).filter(Boolean)
  return parts
    .map((part) => part.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, '').trim())
    .reverse()
    .find((part) => part && !/^london$/i.test(part) && !/^uk$/i.test(part) && !/\d/.test(part))
    || text(activity.borough)
    || 'London'
}

async function londonWard(activity: Activity) {
  const postcode = postcodeFromActivity(activity)
  if (postcode) {
    try {
      const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
        signal: AbortSignal.timeout(6000),
      })
      if (response.ok) {
        const body = await response.json()
        const ward = text(body?.result?.admin_ward)
        if (ward) return ward
      }
    } catch {
      // A postcode lookup failure must not block the importer; the address and
      // borough fallback still give Google Images a useful London locality.
    }
  }
  return fallbackLocality(activity)
}

function isCafeActivity(activity: Activity) {
  return /cafe|coffee|bakery|food/i.test(`${text(activity.category)} ${text(activity.activity_name)}`)
}

function quoted(value: string) {
  return `"${text(value).replace(/"/g, '')}"`
}

function searchQuery(activity: Activity, ward: string) {
  const location = [postcodeFromActivity(activity), text(activity.borough), 'London']
    .filter((value, index, values) => value && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .join(' ')
  if (isCafeActivity(activity)) {
    return `${quoted(activity.activity_name)} ${quoted(ward)} ${location} cafe interior seating exterior`
  }
  const category = text(activity.category) || 'family activity'
  return `${quoted(activity.activity_name)} ${quoted(ward)} ${location} ${category} activity venue`
}

function storedCandidate(activity: Activity, image: SearchImage, fallbackPosition: number): StoredCandidate | null {
  if (!usableImageUrl(image.original)) return null
  if (isDisallowedWikimediaCandidate(activity, image)) return null
  if (blockedImageTerms.test(`${image.original || ''} ${image.thumbnail || ''} ${image.title || ''} ${image.source || ''}`)) return null
  const width = Number(image.original_width) || 0
  const height = Number(image.original_height) || 0
  if ((width && width < 400) || (height && height < 300) || (width && height && width * height < 180000)) return null
  return {
    original: image.original!,
    thumbnail: usableImageUrl(image.thumbnail) ? image.thumbnail! : null,
    title: text(image.title) || null,
    source: text(image.source) || null,
    link: usableImageUrl(image.link) ? image.link! : null,
    position: Number.isFinite(Number(image.position)) ? Number(image.position) : fallbackPosition,
    original_width: Number.isFinite(Number(image.original_width)) ? Number(image.original_width) : null,
    original_height: Number.isFinite(Number(image.original_height)) ? Number(image.original_height) : null,
  }
}

async function discoverCandidates(activity: Activity) {
  const apiKey = Deno.env.get('SERPAPI_API_KEY')
  if (!apiKey) throw new Error('SERPAPI_API_KEY is not configured.')

  // One request is the entire paid allowance for a listing. We save all usable
  // results, then the local selector can be improved and rerun without calling
  // SerpAPI again.
  const ward = await londonWard(activity)
  const query = searchQuery(activity, ward)
  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google_images')
  url.searchParams.set('q', query)
  url.searchParams.set('location', 'London, England, United Kingdom')
  url.searchParams.set('tbs', 'itp:photo')
  url.searchParams.set('api_key', apiKey)
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (response.status === 429) throw new SerpApiRateLimitError('SerpAPI rate limit reached.')
  if (!response.ok) throw new Error(`SerpAPI returned ${response.status}.`)
  const body = await response.json()
  const rawCandidates = Array.isArray(body.images_results) ? body.images_results : []
  const seen = new Set<string>()
  const candidates = rawCandidates
    .map((image: SearchImage, index: number) => storedCandidate(activity, image, index + 1))
    .filter((image: StoredCandidate | null): image is StoredCandidate => Boolean(image))
    .filter((image) => {
      if (seen.has(image.original)) return false
      seen.add(image.original)
      return true
    })
    .slice(0, maxStoredCandidates)
  return { query, ward, rawCandidateCount: rawCandidates.length, candidates }
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

function sameTimestamp(left: string | null | undefined, right: string | null | undefined) {
  const leftTime = Date.parse(left || '')
  const rightTime = Date.parse(right || '')
  return Number.isFinite(leftTime) && leftTime === rightTime
}

function visionReviewFields(selection: SelectionRequest, now: string, status: 'selected' | 'rejected' | 'selection_download_failed') {
  if (!selection.vision_review) return {}
  return {
    serpapi_image_vision_reviewed_at: now,
    serpapi_image_vision_model: selection.vision_review.model,
    serpapi_image_vision_status: status,
    serpapi_image_vision_candidate_index: selection.candidate_index,
    serpapi_image_vision_reason: selection.selection_reason,
    serpapi_image_vision_candidates_fetched_at: selection.vision_review.candidate_set_fetched_at,
  }
}

async function recordVisionReview(
  supabase: ReturnType<typeof createClient>,
  activity: { activity_id: string; serpapi_image_candidates: unknown; serpapi_image_candidates_fetched_at: string | null },
  selection: SelectionRequest,
  reviewedAt: string,
  applicationStatus: 'selected' | 'rejected' | 'selection_download_failed',
  selectedSourceUrl: string | null,
) {
  if (!selection.vision_review) return null
  const candidates = Array.isArray(activity.serpapi_image_candidates) ? activity.serpapi_image_candidates : []
  const { error } = await supabase.from('activity_image_llm_reviews').upsert({
    activity_id: activity.activity_id,
    candidate_set_fetched_at: selection.vision_review.candidate_set_fetched_at,
    reviewed_at: reviewedAt,
    provider: selection.vision_review.provider,
    model: selection.vision_review.model,
    workflow_version: selection.vision_review.workflow_version,
    decision: selection.candidate_index === null ? 'rejected' : 'selected',
    application_status: applicationStatus,
    selected_candidate_index: selection.candidate_index,
    selection_reason: selection.selection_reason,
    selection_confidence: selection.selection_confidence,
    candidate_count: candidates.length,
    selected_source_url: selectedSourceUrl,
    metadata: { display_model: 'Codex 5.6 Sol', vision_review: true },
  }, { onConflict: 'activity_id,candidate_set_fetched_at,provider,model,workflow_version' })
  return error?.message || null
}

async function storeSelectedCandidate(
  supabase: ReturnType<typeof createClient>,
  selection: SelectionRequest,
) {
  const { data: activity, error } = await supabase
    .from('activities')
    .select('activity_id,category,serpapi_image_candidates,serpapi_image_candidates_fetched_at')
    .eq('activity_id', selection.activity_id)
    .eq('archive', false)
    .maybeSingle()
  if (error || !activity) return { activity_id: selection.activity_id, status: 'selection-failed', reason: error?.message || 'Activity was not found.' }

  if (selection.vision_review) {
    if (selection.vision_review.provider !== 'codex' || !text(selection.vision_review.model) || !text(selection.vision_review.workflow_version)) {
      return { activity_id: selection.activity_id, status: 'selection-failed', reason: 'Codex vision review metadata is incomplete.' }
    }
    if (!sameTimestamp(activity.serpapi_image_candidates_fetched_at, selection.vision_review.candidate_set_fetched_at)) {
      return { activity_id: selection.activity_id, status: 'selection-failed', reason: 'The reviewed candidate set is no longer current.' }
    }
  }

  const now = new Date().toISOString()
  if (selection.candidate_index === null) {
    const { error: updateError } = await supabase.from('activities').update({
      ...(selection.clear_selected_image ? { scraped_image_url: null, image_source_url: null } : {}),
      serpapi_image_selected_at: now,
      serpapi_image_selection_reason: selection.selection_reason,
      serpapi_image_selection_confidence: selection.selection_confidence,
      ...visionReviewFields(selection, now, 'rejected'),
      updated_at: now,
    }).eq('activity_id', selection.activity_id)
    if (updateError) return { activity_id: selection.activity_id, status: 'selection-failed', reason: updateError.message }
    const reviewError = await recordVisionReview(supabase, activity, selection, now, 'rejected', null)
    return reviewError
      ? { activity_id: selection.activity_id, status: 'selection-failed', reason: `Image decision saved but the vision audit log failed: ${reviewError}` }
      : { activity_id: selection.activity_id, status: 'no-high-confidence-candidate' }
  }

  const candidates = Array.isArray(activity.serpapi_image_candidates) ? activity.serpapi_image_candidates as StoredCandidate[] : []
  const candidate = candidates[selection.candidate_index]
  if (!candidate || !usableImageUrl(candidate.original)) {
    return { activity_id: selection.activity_id, status: 'selection-failed', reason: 'The selected candidate is no longer available.' }
  }
  if (isDisallowedWikimediaCandidate(activity, candidate)) {
    return { activity_id: selection.activity_id, status: 'selection-failed', reason: 'Wikimedia images are not allowed for this activity category.' }
  }

  for (const imageUrl of [candidate.original, candidate.thumbnail].filter(usableImageUrl)) {
    try {
      const response = await fetch(imageUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
      })
      const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase()
      const declaredSize = Number(response.headers.get('content-length') || 0)
      if (!response.ok || !acceptedMimeTypes.has(contentType) || (declaredSize && declaredSize > maxImageBytes)) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength < 5 * 1024 || bytes.byteLength > maxImageBytes) continue
      const candidateSetRevision = selection.vision_review
        ? Date.parse(selection.vision_review.candidate_set_fetched_at)
        : Date.parse(now)
      const path = `serpapi/selected/${activity.activity_id}-${candidateSetRevision}-${selection.candidate_index}.${extensionFor(contentType, imageUrl)}`
      const upload = await supabase.storage.from('activity-images').upload(path, bytes, {
        contentType,
        cacheControl: '31536000',
        upsert: true,
      })
      if (upload.error) continue
      const publicUrl = supabase.storage.from('activity-images').getPublicUrl(path).data.publicUrl
      const { error: updateError } = await supabase.from('activities').update({
        scraped_image_url: publicUrl,
        image_source_url: candidate.original,
        serpapi_image_selected_at: now,
        serpapi_image_selection_reason: selection.selection_reason,
        serpapi_image_selection_confidence: selection.selection_confidence,
        ...visionReviewFields(selection, now, 'selected'),
        updated_at: now,
      }).eq('activity_id', selection.activity_id)
      if (updateError) return { activity_id: selection.activity_id, status: 'selection-failed', reason: updateError.message }
      const reviewError = await recordVisionReview(supabase, activity, selection, now, 'selected', candidate.original)
      return reviewError
        ? { activity_id: selection.activity_id, status: 'selection-failed', reason: `Image saved but the vision audit log failed: ${reviewError}` }
        : { activity_id: selection.activity_id, status: 'selected' }
    } catch {
      // Try the candidate thumbnail if the original host blocks the download.
    }
  }
  const { error: updateError } = await supabase.from('activities').update({
    serpapi_image_selected_at: now,
    serpapi_image_selection_reason: selection.selection_reason,
    serpapi_image_selection_confidence: selection.selection_confidence,
    ...visionReviewFields(selection, now, 'selection_download_failed'),
    updated_at: now,
  }).eq('activity_id', selection.activity_id)
  if (updateError) return { activity_id: selection.activity_id, status: 'selection-failed', reason: updateError.message }
  const reviewError = await recordVisionReview(supabase, activity, selection, now, 'selection_download_failed', candidate.original)
  return {
    activity_id: selection.activity_id,
    status: 'selection-download-failed',
    reason: reviewError
      ? `The chosen image could not be copied and the vision audit log failed: ${reviewError}`
      : 'The chosen candidate could not be copied to activity storage; the Codex review was logged for retry without another vision review.',
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  if (!(await authorised(request, supabase))) {
    return jsonResponse({ error: 'Only Tiny Outings administrators or the update job can discover activity image candidates.' }, 403)
  }

  const body = await request.json().catch(() => ({})) as {
    cursor?: string
    batch_size?: number
    scope?: 'all' | 'cafes'
    activity_ids?: string[]
    created_after?: string
    retry_empty_candidates?: boolean
    review_queue?: boolean
    selections?: SelectionRequest[]
  }
  const selections = Array.isArray(body.selections) ? body.selections.slice(0, maxBatchSize) : []
  if (selections.length) {
    await supabase.storage.createBucket('activity-images', { public: true }).catch(() => {})
    const results = await mapWithConcurrency(selections, 3, (selection) => storeSelectedCandidate(supabase, selection))
    return jsonResponse({
      processed: results.length,
      selected: results.filter((result) => result.status === 'selected').length,
      no_high_confidence_candidate: results.filter((result) => result.status === 'no-high-confidence-candidate').length,
      selection_download_failed: results.filter((result) => result.status === 'selection-download-failed').length,
      results,
    })
  }
  const batchSize = Math.min(Math.max(Number(body.batch_size) || maxBatchSize, 1), maxBatchSize)
  const activityIds = [...new Set((body.activity_ids || []).filter((value) => typeof value === 'string' && value.length > 0))]
    .slice(0, maxBatchSize)
  if (body.review_queue === true) {
    let reviewQuery = supabase
      .from('codex_image_review_queue')
      .select('*')
      .order('activity_id', { ascending: true })
      .limit(batchSize)
    if (activityIds.length) reviewQuery = reviewQuery.in('activity_id', activityIds)
    else if (body.cursor) reviewQuery = reviewQuery.gt('activity_id', body.cursor)
    const { data: reviewRows, error: reviewError } = await reviewQuery
    if (reviewError) return jsonResponse({ error: reviewError.message }, 500)
    const lastReview = reviewRows?.at(-1)
    return jsonResponse({
      processed: reviewRows?.length || 0,
      next_cursor: !activityIds.length && reviewRows?.length === batchSize ? lastReview?.activity_id || null : null,
      model: 'gpt-5.6-sol',
      workflow_version: 'codex-visual-v2',
      rows: reviewRows || [],
    })
  }
  const scope = body.scope === 'cafes' ? 'cafes' : 'all'
  const retryEmptyCandidates = body.retry_empty_candidates === true
  const createdAfter = body.created_after && Number.isFinite(Date.parse(body.created_after))
    ? new Date(body.created_after).toISOString()
    : null

  let query = supabase
    .from('activities')
    .select('activity_id,activity_name,address,postcode,borough,category,description,website,organiser_website')
    .in('public_listing_status', ['draft', 'published'])
    .eq('archive', false)
    .order('activity_id', { ascending: true })
    .limit(batchSize)
  // Paid retries are opt-in and tightly limited to listings whose stored
  // candidate set is empty. Normal importer calls retain the one-search cap.
  query = retryEmptyCandidates
    ? query.filter('serpapi_image_candidates', 'eq', '[]')
    : query.is('serpapi_image_candidates_fetched_at', null)
  if (scope === 'cafes') query = query.or('category.ilike.%cafe%,category.ilike.%food%')
  if (createdAfter) query = query.gte('created_at', createdAfter)
  if (activityIds.length) query = query.in('activity_id', activityIds)
  else if (body.cursor) query = query.gt('activity_id', body.cursor)

  const { data: activities, error } = await query
  if (error) return jsonResponse({ error: error.message }, 500)

  const discoveryConcurrency = retryEmptyCandidates ? 5 : 3
  const results = await mapWithConcurrency(activities || [], discoveryConcurrency, async (activity: Activity) => {
    try {
      const discovery = await discoverCandidates(activity)
      const now = new Date().toISOString()
      const { error: updateError } = await supabase.from('activities').update({
        serpapi_image_candidates: discovery.candidates,
        serpapi_image_search_query: discovery.query,
        serpapi_image_search_ward: discovery.ward,
        serpapi_image_candidates_fetched_at: now,
        serpapi_image_selected_at: null,
        serpapi_image_selection_reason: null,
        serpapi_image_selection_confidence: null,
        serpapi_image_vision_reviewed_at: null,
        serpapi_image_vision_model: null,
        serpapi_image_vision_status: null,
        serpapi_image_vision_candidate_index: null,
        serpapi_image_vision_reason: null,
        serpapi_image_vision_candidates_fetched_at: null,
        // Retained for compatibility with previous reporting and never used to
        // determine whether a new paid search is allowed.
        serpapi_image_checked_at: now,
        updated_at: now,
      }).eq('activity_id', activity.activity_id)
      return updateError
        ? { activity_id: activity.activity_id, status: 'update-failed', reason: updateError.message }
        : {
          activity_id: activity.activity_id,
          status: discovery.candidates.length ? 'candidates-stored' : 'no-candidates',
          candidates: discovery.candidates.length,
          raw_candidates: discovery.rawCandidateCount,
        }
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
    candidates_stored: results.filter((result) => result.status === 'candidates-stored').length,
    no_candidates: results.filter((result) => result.status === 'no-candidates').length,
    rate_limited: results.filter((result) => result.status === 'rate-limited').length,
    scope,
    retry_empty_candidates: retryEmptyCandidates,
    created_after: createdAfter,
    next_cursor: activityIds.length ? null : activities?.length === batchSize ? last?.activity_id || null : null,
    results,
  })
})
