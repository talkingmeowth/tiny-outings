import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  blockedWebsiteImageTerms,
  extractWebsiteImageCandidates,
} from '../_shared/website-image-candidate-policy.js'

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
const maxStoredCandidates = 80
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

type Activity = {
  activity_id: string
  activity_name: string
  category: string | null
  website: string | null
  organiser_website: string | null
  source_url: string | null
  image_url: string | null
  scraped_image_url: string | null
  image_source_url: string | null
  website_image_url: string | null
  listing_image_url: string | null
  wikimedia_image_url: string | null
  user_image_url: string | null
  admin_cover_image_url: string | null
  website_downloaded_image: string | null
  organiser_website_downloaded_image: string | null
  website_image_candidates: Candidate[] | null
  website_image_candidates_fetched_at: string | null
  website_image_vision_candidates_fetched_at: string | null
}

type Candidate = {
  original: string
  thumbnail: string | null
  title: string | null
  source: string | null
  link: string | null
  position: number | null
  original_width: number | null
  original_height: number | null
  source_kind: 'website' | 'organiser'
  metadata_score: number
}

type SelectionRequest = {
  activity_id: string
  candidate_index: number | null
  selection_reason: string
  selection_confidence?: number | null
  reviewed_width?: number | null
  reviewed_height?: number | null
  clear_selected_image?: boolean
  vision_review: {
    provider: 'codex'
    model: string
    workflow_version: string
    candidate_set_fetched_at: string
  }
}

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

function usableImageUrl(value: string | null) {
  if (!value || blockedWebsiteImageTerms.test(value)) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

async function pageCandidates(sourceUrl: string, sourceKind: 'website' | 'organiser') {
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
    return extractWebsiteImageCandidates(await response.text(), response.url || sourceUrl, sourceKind) as Candidate[]
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

async function downloadSelectedToStorage(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
  candidate: Candidate,
  selection: SelectionRequest,
) {
  if (!usableActivityImageUrl(activity, candidate.original) || blockedWebsiteImageTerms.test(`${candidate.original} ${candidate.title || ''}`)) return null
  // HTML width/height attributes are commonly responsive display sizes rather
  // than the dimensions of the original asset. Trust the dimensions measured
  // from the downloaded file during the authenticated Codex review instead.
  const reviewedShortestSide = Math.min(Number(selection.reviewed_width || 0), Number(selection.reviewed_height || 0))
  if (reviewedShortestSide > 0 && reviewedShortestSide < 400) return null
  try {
    const response = await fetch(candidate.original, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
      headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
    })
    const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase()
    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (!response.ok || !acceptedMimeTypes.has(contentType) || (declaredSize && declaredSize > maxImageBytes)) return null

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength < 8 * 1024 || bytes.byteLength > maxImageBytes) return null

    const path = `downloaded/${candidate.source_kind}/${activity.activity_id}-${stableName(candidate.original)}.${extensionFor(contentType, candidate.original)}`
    const upload = await supabase.storage.from('activity-images').upload(path, bytes, {
      contentType,
      cacheControl: '31536000',
      upsert: true,
    })
    if (upload.error) return null

    return {
      source_url: candidate.original,
      public_url: supabase.storage.from('activity-images').getPublicUrl(path).data.publicUrl,
    }
  } catch {
    return null
  }
}

function allowsWikimediaImages(activity: Pick<Activity, 'category'>) {
  const category = String(activity.category || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
  return ['parks and outdoor play', 'museums and culture', 'family activities'].includes(category)
}

function isWikimediaUrl(value: string | null | undefined) {
  if (!value) return false
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '')
    return host === 'wikimedia.org' || host.endsWith('.wikimedia.org')
      || host === 'wikipedia.org' || host.endsWith('.wikipedia.org')
  } catch {
    return false
  }
}

function usableActivityImageUrl(activity: Activity, value: string | null | undefined) {
  return usableImageUrl(value) && (allowsWikimediaImages(activity) || !isWikimediaUrl(value))
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

async function discoverActivityCandidates(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
) {
  const organiserPages = uniqueUrls([activity.organiser_website])
  const websitePages = uniqueUrls([activity.website, activity.source_url]).filter((url) => !organiserPages.includes(url))
  const pageResults = await Promise.all([
    ...organiserPages.map((page) => pageCandidates(page, 'organiser')),
    ...websitePages.map((page) => pageCandidates(page, 'website')),
  ])
  const seen = new Set<string>()
  const candidates = pageResults.flat()
    .filter((candidate) => usableActivityImageUrl(activity, candidate.original))
    .sort((left, right) => Number(right.source_kind === 'organiser') - Number(left.source_kind === 'organiser')
      || right.metadata_score - left.metadata_score)
    .filter((candidate) => !seen.has(candidate.original) && Boolean(seen.add(candidate.original)))
    .slice(0, maxStoredCandidates)
    .map((candidate, index) => ({ ...candidate, position: index + 1 }))
  const now = new Date().toISOString()
  const { error } = await supabase.from('activities').update({
    website_image_candidates: candidates,
    website_image_candidates_fetched_at: now,
    website_image_candidate_pages: [...organiserPages, ...websitePages],
    website_image_vision_reviewed_at: null,
    website_image_vision_model: null,
    website_image_vision_status: null,
    website_image_vision_candidate_index: null,
    website_image_vision_reason: null,
    website_image_vision_candidates_fetched_at: null,
    updated_at: now,
  }).eq('activity_id', activity.activity_id)
  return error
    ? { activity_id: activity.activity_id, status: 'update-failed', reason: error.message }
    : {
      activity_id: activity.activity_id,
      activity_name: activity.activity_name,
      status: candidates.length ? 'candidates-stored' : 'no-candidates-found',
      candidate_count: candidates.length,
      pages_scanned: organiserPages.length + websitePages.length,
      candidates_fetched_at: now,
    }
}

function sameTimestamp(left: string | null, right: string | null) {
  return Boolean(left && right && Date.parse(left) === Date.parse(right))
}

function visionFields(selection: SelectionRequest, now: string, status: 'selected' | 'rejected' | 'selection_download_failed') {
  return {
    website_image_vision_reviewed_at: now,
    website_image_vision_model: selection.vision_review.model,
    website_image_vision_status: status,
    website_image_vision_candidate_index: selection.candidate_index,
    website_image_vision_reason: selection.selection_reason,
    website_image_vision_candidates_fetched_at: selection.vision_review.candidate_set_fetched_at,
  }
}

async function recordVisionReview(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
  selection: SelectionRequest,
  now: string,
  applicationStatus: 'selected' | 'rejected' | 'selection_download_failed',
  selectedSourceUrl: string | null,
) {
  const candidates = Array.isArray(activity.website_image_candidates) ? activity.website_image_candidates : []
  const { error } = await supabase.from('activity_website_image_llm_reviews').upsert({
    activity_id: activity.activity_id,
    candidate_set_fetched_at: selection.vision_review.candidate_set_fetched_at,
    reviewed_at: now,
    provider: selection.vision_review.provider,
    model: selection.vision_review.model,
    workflow_version: selection.vision_review.workflow_version,
    decision: selection.candidate_index === null ? 'rejected' : 'selected',
    application_status: applicationStatus,
    selected_candidate_index: selection.candidate_index,
    selection_reason: selection.selection_reason,
    selection_confidence: selection.selection_confidence ?? null,
    candidate_count: candidates.length,
    selected_source_url: selectedSourceUrl,
    metadata: { candidate_source: 'official_website', display_model: 'Codex 5.6 Sol' },
  }, { onConflict: 'activity_id,candidate_set_fetched_at,provider,model,workflow_version' })
  return error
}

async function storeSelectedCandidate(
  supabase: ReturnType<typeof createClient>,
  selection: SelectionRequest,
) {
  const { data, error } = await supabase.from('activities')
    .select('activity_id,activity_name,category,website,organiser_website,source_url,image_url,scraped_image_url,image_source_url,website_image_url,listing_image_url,wikimedia_image_url,user_image_url,admin_cover_image_url,website_downloaded_image,organiser_website_downloaded_image,website_image_candidates,website_image_candidates_fetched_at,website_image_vision_candidates_fetched_at')
    .eq('activity_id', selection.activity_id)
    .maybeSingle()
  if (error || !data) return { activity_id: selection.activity_id, status: 'selection-failed', reason: error?.message || 'Activity not found.' }
  const activity = data as Activity
  if (selection.vision_review.provider !== 'codex' || !selection.vision_review.model || !selection.vision_review.workflow_version) {
    return { activity_id: selection.activity_id, status: 'selection-failed', reason: 'A complete Codex vision review record is required.' }
  }
  if (!sameTimestamp(activity.website_image_candidates_fetched_at, selection.vision_review.candidate_set_fetched_at)) {
    return { activity_id: selection.activity_id, status: 'selection-failed', reason: 'The reviewed website candidate set is no longer current.' }
  }
  const candidates = Array.isArray(activity.website_image_candidates) ? activity.website_image_candidates : []
  if (!candidates.length) return { activity_id: selection.activity_id, status: 'selection-failed', reason: 'The website candidate set is empty.' }
  const now = new Date().toISOString()

  if (selection.candidate_index === null) {
    const update = {
      ...(selection.clear_selected_image ? { organiser_website_downloaded_image: null, website_downloaded_image: null } : {}),
      website_image_selected_at: null,
      ...visionFields(selection, now, 'rejected'),
      updated_at: now,
    }
    const { error: updateError } = await supabase.from('activities').update(update).eq('activity_id', activity.activity_id)
    if (updateError) return { activity_id: activity.activity_id, status: 'selection-failed', reason: updateError.message }
    const reviewError = await recordVisionReview(supabase, activity, selection, now, 'rejected', null)
    return reviewError
      ? { activity_id: activity.activity_id, status: 'review-log-failed', reason: reviewError.message }
      : { activity_id: activity.activity_id, status: 'no-high-confidence-candidate' }
  }

  const candidate = candidates[selection.candidate_index]
  if (!candidate) return { activity_id: activity.activity_id, status: 'selection-failed', reason: 'The selected website candidate is no longer available.' }
  const downloaded = await downloadSelectedToStorage(supabase, activity, candidate, selection)
  if (!downloaded) {
    const update = { ...visionFields(selection, now, 'selection_download_failed'), updated_at: now }
    await supabase.from('activities').update(update).eq('activity_id', activity.activity_id)
    const reviewError = await recordVisionReview(supabase, activity, selection, now, 'selection_download_failed', candidate.original)
    return reviewError
      ? { activity_id: activity.activity_id, status: 'review-log-failed', reason: reviewError.message }
      : { activity_id: activity.activity_id, status: 'selection-download-failed' }
  }

  const selectedFields = candidate.source_kind === 'organiser'
    ? { organiser_website_downloaded_image: downloaded.public_url, website_downloaded_image: null }
    : { organiser_website_downloaded_image: null, website_downloaded_image: downloaded.public_url }
  const { error: updateError } = await supabase.from('activities').update({
    ...selectedFields,
    website_image_selected_at: now,
    ...visionFields(selection, now, 'selected'),
    updated_at: now,
  }).eq('activity_id', activity.activity_id)
  if (updateError) return { activity_id: activity.activity_id, status: 'selection-failed', reason: updateError.message }
  const reviewError = await recordVisionReview(supabase, activity, selection, now, 'selected', candidate.original)
  return reviewError
    ? { activity_id: activity.activity_id, status: 'review-log-failed', reason: reviewError.message }
    : { activity_id: activity.activity_id, status: 'selected', source_url: candidate.original, stored_url: downloaded.public_url, source_kind: candidate.source_kind }
}

async function loadReviewQueue(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const requestedIds = Array.isArray(body.activity_ids)
    ? [...new Set(body.activity_ids.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 25)
    : []
  const batchSize = Math.min(25, Math.max(1, Number(body.batch_size || 20)))
  let query = supabase.from('codex_website_image_review_queue').select('*').order('activity_id').limit(batchSize)
  if (requestedIds.length) query = query.in('activity_id', requestedIds)
  if (!requestedIds.length && typeof body.cursor === 'string') query = query.gt('activity_id', body.cursor)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = data || []
  return { rows, next_cursor: rows.length === batchSize ? rows.at(-1)?.activity_id || null : null }
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
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    if (body.review_queue === true) return jsonResponse(await loadReviewQueue(supabase, body))

    if (Array.isArray(body.selections)) {
      const selections = body.selections.slice(0, 20) as SelectionRequest[]
      if (!selections.length) return jsonResponse({ error: 'Provide at least one website image selection.' }, 400)
      const results = await mapWithConcurrency(selections, 3, (selection) => storeSelectedCandidate(supabase, selection))
      return jsonResponse({ processed: results.length, results })
    }

    const activityIds = Array.isArray(body.activity_ids)
      ? [...new Set(body.activity_ids.filter((id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 25)
      : []
    if (!activityIds.length) return jsonResponse({ error: 'Provide up to 25 activity_ids.' }, 400)

    const { data, error } = await supabase.from('activities')
      .select('activity_id,activity_name,category,website,organiser_website,source_url,image_url,scraped_image_url,image_source_url,website_image_url,listing_image_url,wikimedia_image_url,user_image_url,admin_cover_image_url,website_downloaded_image,organiser_website_downloaded_image,website_image_candidates,website_image_candidates_fetched_at,website_image_vision_candidates_fetched_at')
      .in('public_listing_status', ['draft', 'published'])
      .eq('archive', false)
      .in('activity_id', activityIds)
    if (error) throw new Error(error.message)

    const results = await mapWithConcurrency(
      (data || []) as Activity[],
      4,
      (activity) => discoverActivityCandidates(supabase, activity),
    )
    return jsonResponse({ processed: results.length, selection_required: true, results })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Image download failed.' }, 500)
  }
})
