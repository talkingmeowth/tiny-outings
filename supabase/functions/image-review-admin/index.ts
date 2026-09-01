import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hasBlockedAssetTerms } from './candidate-policy.js'

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
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const maxImageBytes = 8 * 1024 * 1024
const categoryIllustrationSelectionKind = 'category_illustration'
const reviewAppBaseUrl = 'https://tiny-outings-cpjh.onrender.com/review/'
const storedSourceFields = [
  'admin_cover_image_url',
  'reviewed_image_url',
  'user_image_url',
  'audit_image_url',
  'scraped_image_url',
  'organiser_website_downloaded_image',
  'website_downloaded_image',
  'model_selected_url',
  'user_uploaded_image_url',
  'wikimedia_image_url',
  'website_image_url',
  'listing_image_url',
] as const
type StoredSourceField = typeof storedSourceFields[number]

type Activity = {
  activity_id: string
  activity_name: string
  address: string | null
  postcode: string | null
  borough: string | null
  category: string | null
  public_listing_status: string
  archive?: boolean
  archive_reason?: string | null
  archived_at?: string | null
  archive_previous_listing_status?: string | null
  codex_image_candidates?: unknown
  codex_image_search_query?: string | null
  codex_image_searched_at?: string | null
  codex_image_search_model?: string | null
  serpapi_image_candidates?: unknown
  serpapi_image_search_query?: string | null
  serpapi_image_candidates_fetched_at?: string | null
  serpapi_image_search_attempted_at?: string | null
  serpapi_image_search_status?: string | null
  serpapi_image_search_failure_reason?: string | null
  serpapi_image_raw_result_count?: number | null
  serpapi_image_search_metadata?: unknown
  image_review_ignored_at?: string | null
  image_review_ignored_by_user_id?: string | null
  reviewed_image_url?: string | null
  reviewed_image_source_url?: string | null
  reviewed_image_original_url?: string | null
  reviewed_image_selected_at?: string | null
  reviewed_image_model?: string | null
  use_category_image?: boolean
  model_selected_url?: string | null
  model_selected_confidence?: number | null
  model_selected_original_url?: string | null
  model_selected_source_url?: string | null
  model_selected_source_field?: string | null
  model_selected_reason?: string | null
  model_selected_model?: string | null
  model_selected_model_version?: string | null
  admin_cover_image_url?: string | null
  user_image_url?: string | null
  user_uploaded_image_url?: string | null
  organiser_website_downloaded_image?: string | null
  website_downloaded_image?: string | null
  wikimedia_image_url?: string | null
  website_image_url?: string | null
  listing_image_url?: string | null
  audit_image_url?: string | null
  audit_image_source_url?: string | null
  audit_image_status?: string | null
  audit_image_original_url?: string | null
  audit_image_original_source_field?: string | null
  scraped_image_url?: string | null
  image_source_url?: string | null
  website?: string | null
  organiser_website?: string | null
  source_url?: string | null
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
  selection_kind?: typeof categoryIllustrationSelectionKind | 'hierarchy_source'
  source_field?: StoredSourceField
  candidate_source?: string | null
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

function redactSerpApiSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSerpApiSecrets)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      /api[_-]?key/i.test(key) ? '[redacted]' : redactSerpApiSecrets(nested),
    ]))
  }
  return typeof value === 'string'
    ? value.replace(/([?&]api_key=)[^&]+/gi, '$1[redacted]')
    : value
}

function secureImageUrl(value: unknown) {
  return cleanText(value).replace(/^http:\/\//i, 'https://')
}

function isQualityApprovedStoredSource(activity: Activity, field: StoredSourceField, imageUrl: string) {
  if (field === 'audit_image_url') {
    return cleanText(activity.audit_image_status) === 'replaced'
      && secureImageUrl(activity.audit_image_url) === secureImageUrl(imageUrl)
  }
  if (field === 'model_selected_url') return Number(activity.model_selected_confidence) >= 0.7
  if (field !== 'scraped_image_url') return true
  if (cleanText(activity.audit_image_status) !== 'pass') return false
  if (cleanText(activity.audit_image_original_source_field) !== 'scraped_image_url') return false
  const auditedUrl = secureImageUrl(activity.audit_image_original_url)
  return Boolean(auditedUrl && auditedUrl === secureImageUrl(imageUrl))
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

function categoryIllustrationFilename(activity: Pick<Activity, 'category'>) {
  const category = cleanText(activity.category).toLowerCase()
  if (category.includes('park')) return 'park-placeholder.svg'
  if (category.includes('book')) return 'bookshop-placeholder.svg'
  if (category.includes('caf')) return 'family-cafe-placeholder.svg'
  return 'family-outing-placeholder.svg'
}

function categoryIllustrationCandidate(activity: Activity): Candidate {
  const imageUrl = new URL(`images/${categoryIllustrationFilename(activity)}`, reviewAppBaseUrl).toString()
  return {
    image_url: imageUrl,
    thumbnail_url: null,
    source_page_url: imageUrl,
    source_domain: domain(imageUrl),
    title: `${cleanText(activity.category) || 'Family activity'} illustrated category image`,
    width: 1200,
    height: 720,
    relevance_reason: 'Illustrated category option selected in desktop image review.',
    selection_kind: categoryIllustrationSelectionKind,
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
  const expectedJobToken = Deno.env.get('TINY_OUTINGS_IMAGE_JOB_SECRET') || ''
  if (expectedJobToken && request.headers.get('x-tiny-outings-image-job-token') === expectedJobToken) {
    return { id: null, email: 'image-review-job' }
  }
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

async function findActivity(
  supabase: ReturnType<typeof createClient>,
  activityId: string,
  includeArchived = false,
) {
  let query = supabase
    .from('activities')
    .select('activity_id,activity_name,address,postcode,borough,category,public_listing_status,archive,archive_reason,archived_at,archive_previous_listing_status,website,organiser_website,source_url,image_source_url,codex_image_candidates,codex_image_search_query,codex_image_searched_at,codex_image_search_model,serpapi_image_candidates,serpapi_image_search_query,serpapi_image_candidates_fetched_at,serpapi_image_search_attempted_at,serpapi_image_search_status,serpapi_image_search_failure_reason,serpapi_image_raw_result_count,serpapi_image_search_metadata,image_review_ignored_at,image_review_ignored_by_user_id,admin_cover_image_url,reviewed_image_url,use_category_image,reviewed_image_source_url,reviewed_image_original_url,reviewed_image_selected_at,reviewed_image_model,user_image_url,model_selected_url,model_selected_confidence,model_selected_original_url,model_selected_source_url,model_selected_source_field,model_selected_reason,model_selected_model,model_selected_model_version,organiser_website_downloaded_image,website_downloaded_image,wikimedia_image_url,website_image_url,listing_image_url,audit_image_url,audit_image_source_url,audit_image_status,audit_image_original_url,audit_image_original_source_field,scraped_image_url')
    .eq('activity_id', activityId)
  if (!includeArchived) query = query.eq('archive', false)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Listing not found.')
  return data as Activity
}

function isStoredSourceField(value: unknown): value is StoredSourceField {
  return storedSourceFields.includes(cleanText(value) as StoredSourceField)
}

function storedSourcePageUrl(activity: Activity, field: StoredSourceField, imageUrl: string) {
  if (field === 'reviewed_image_url') return cleanText(activity.reviewed_image_source_url) || cleanText(activity.reviewed_image_original_url) || imageUrl
  if (field === 'audit_image_url') return cleanText(activity.audit_image_source_url) || imageUrl
  if (field === 'scraped_image_url') return cleanText(activity.image_source_url) || imageUrl
  if (field === 'organiser_website_downloaded_image') return cleanText(activity.organiser_website) || cleanText(activity.website) || imageUrl
  if (['website_downloaded_image', 'website_image_url', 'listing_image_url'].includes(field)) {
    return cleanText(activity.image_source_url) || cleanText(activity.website) || cleanText(activity.source_url) || imageUrl
  }
  return imageUrl
}

async function storedSourceCandidate(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
  field: StoredSourceField,
) {
  let imageUrl = cleanText(activity[field])
  if (field === 'user_uploaded_image_url') {
    const { data, error } = await supabase.from('activity_photos')
      .select('photo_url')
      .eq('activity_id', activity.activity_id)
      .eq('source_provider', 'user_upload')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    imageUrl = cleanText(data?.photo_url)
  }
  if (!validHttpUrl(imageUrl)) throw new Error(`${field} no longer contains a usable image URL.`)
  if (!isQualityApprovedStoredSource(activity, field, imageUrl)) {
    throw new Error(`${field} has not passed the quality gate required by the card-image hierarchy.`)
  }
  const sourcePageUrl = storedSourcePageUrl(activity, field, imageUrl)
  if (!allowsWikimediaImages(activity) && [imageUrl, sourcePageUrl].some(isWikimediaSource)) {
    throw new Error('Wikimedia images are not allowed for this activity category.')
  }
  return {
    image_url: imageUrl,
    thumbnail_url: null,
    source_page_url: validHttpUrl(sourcePageUrl) ? sourcePageUrl : imageUrl,
    source_domain: domain(sourcePageUrl) || domain(imageUrl),
    title: field,
    width: null,
    height: null,
    relevance_reason: `Existing listing image from ${field}.`,
    selection_kind: 'hierarchy_source' as const,
    source_field: field,
  }
}

function desktopCandidateFromStored(image: Record<string, unknown>, index: number): Candidate {
  const imageUrl = cleanText(image.original || image.image_url)
  const sourcePageUrl = cleanText(image.link || image.source_page_url) || null
  return {
    image_url: imageUrl,
    thumbnail_url: cleanText(image.thumbnail || image.thumbnail_url) || null,
    source_page_url: sourcePageUrl,
    source_domain: domain(sourcePageUrl) || cleanText(image.source_domain || image.source),
    title: cleanText(image.title) || null,
    width: Number.isFinite(Number(image.original_width ?? image.width)) ? Number(image.original_width ?? image.width) : null,
    height: Number.isFinite(Number(image.original_height ?? image.height)) ? Number(image.original_height ?? image.height) : null,
    relevance_reason: cleanText(image.relevance_reason) || `Google Images result ${Number(image.position) || index + 1}`,
  }
}

function desktopCandidatesFromStored(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20)
    .filter((image): image is Record<string, unknown> => Boolean(image && typeof image === 'object'))
    .map(desktopCandidateFromStored)
    .filter((candidate) => validHttpUrl(candidate.image_url))
}

function canonicalCandidatesFromDesktop(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((image): image is Record<string, unknown> => Boolean(image && typeof image === 'object'))
    .map((image, index) => ({
      ...image,
      original: cleanText(image.original || image.image_url) || null,
      thumbnail: cleanText(image.thumbnail || image.thumbnail_url) || null,
      link: cleanText(image.link || image.source_page_url) || null,
      source: cleanText(image.source || image.source_domain) || null,
      position: Number(image.position) || index + 1,
      original_width: Number.isFinite(Number(image.original_width ?? image.width)) ? Number(image.original_width ?? image.width) : null,
      original_height: Number.isFinite(Number(image.original_height ?? image.height)) ? Number(image.original_height ?? image.height) : null,
    }))
}

async function searchUnfilteredSerpApiCandidates(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
  candidateRequestId: string,
  suppliedQuery: string,
  requestVariant: string,
  requestedByUserId: string | null,
) {
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
  let claimedPaidSearch = false

  const completeFromStored = async (cachedActivity: Activity) => {
    const canonicalWasStored = Array.isArray(cachedActivity.serpapi_image_candidates)
    const storedSet = canonicalWasStored ? cachedActivity.serpapi_image_candidates : cachedActivity.codex_image_candidates
    const candidates = desktopCandidatesFromStored(storedSet)
    const canonicalCandidates = canonicalWasStored
      ? cachedActivity.serpapi_image_candidates as Array<Record<string, unknown>>
      : canonicalCandidatesFromDesktop(cachedActivity.codex_image_candidates)
    const completedAt = cleanText(cachedActivity.serpapi_image_candidates_fetched_at || cachedActivity.codex_image_searched_at) || new Date().toISOString()
    const attemptedAt = cleanText(cachedActivity.serpapi_image_search_attempted_at) || completedAt
    const cachedQuery = cleanText(cachedActivity.serpapi_image_search_query || cachedActivity.codex_image_search_query) || query
    const sourceLabel = 'Stored SerpAPI candidates - reused without a paid call'
    const status = cleanText(cachedActivity.serpapi_image_search_status)
      || (canonicalCandidates.length ? 'legacy_completed' : 'no_results')
    const activityUpdate = supabase.from('activities').update({
      codex_image_candidates: candidates,
      codex_image_search_query: cachedQuery,
      codex_image_searched_at: completedAt,
      codex_image_search_model: sourceLabel,
      ...(!canonicalWasStored ? { serpapi_image_candidates: canonicalCandidates } : {}),
      serpapi_image_search_query: cachedQuery,
      serpapi_image_candidates_fetched_at: completedAt,
      serpapi_image_search_attempted_at: attemptedAt,
      serpapi_image_search_status: status,
      serpapi_image_raw_result_count: Number.isFinite(Number(cachedActivity.serpapi_image_raw_result_count))
        ? Number(cachedActivity.serpapi_image_raw_result_count)
        : canonicalCandidates.length,
      updated_at: new Date().toISOString(),
    }).eq('activity_id', cachedActivity.activity_id)
    const requestUpdate = activeRequestId
      ? supabase.from('codex_image_candidate_requests').update({
        status: 'completed', completed_at: completedAt, codex_model: sourceLabel,
        candidate_count: candidates.length, failure_reason: null,
      }).eq('candidate_request_id', activeRequestId)
      : Promise.resolve({ error: null })
    const [{ error: activityError }, { error: requestError }] = await Promise.all([activityUpdate, requestUpdate])
    if (activityError) throw new Error(activityError.message)
    if (requestError) throw new Error(requestError.message)
    return {
      candidates, query: cachedQuery, searchedAt: completedAt, source: sourceLabel, reused: true,
      request: {
        ...requestRow, candidate_request_id: activeRequestId, requested_query: cachedQuery,
        status: 'completed', completed_at: completedAt, codex_model: sourceLabel,
        candidate_count: candidates.length, failure_reason: null,
      },
    }
  }

  try {
    if (activity.serpapi_image_search_attempted_at
      || activity.serpapi_image_candidates_fetched_at
      || activity.codex_image_searched_at) return await completeFromStored(activity)

    const apiKey = Deno.env.get('SERPAPI_API_KEY')
    if (!apiKey) throw new Error('SERPAPI_API_KEY is not configured.')
    const attemptedAt = new Date().toISOString()
    const { data: claim, error: claimError } = await supabase.from('activities').update({
      serpapi_image_search_attempted_at: attemptedAt,
      serpapi_image_search_status: 'in_progress',
      serpapi_image_search_failure_reason: null,
      updated_at: attemptedAt,
    }).eq('activity_id', activity.activity_id)
      .is('serpapi_image_search_attempted_at', null)
      .select('activity_id')
      .maybeSingle()
    if (claimError) throw new Error(claimError.message)
    if (!claim) return await completeFromStored(await findActivity(supabase, activity.activity_id))
    claimedPaidSearch = true

    const searchUrl = new URL('https://serpapi.com/search.json')
    searchUrl.searchParams.set('engine', 'google_images')
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('location', 'London, England, United Kingdom')
    searchUrl.searchParams.set('api_key', apiKey)
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(25000) })
    if (!response.ok) throw new Error(`SerpAPI returned ${response.status}.`)
    const body = await response.json() as Record<string, unknown>
    const rawResults = Array.isArray(body.images_results)
      ? body.images_results.filter((image): image is Record<string, unknown> => Boolean(image && typeof image === 'object'))
      : []
    const storedCandidates = rawResults.map((image, index) => ({
      ...redactSerpApiSecrets(image) as Record<string, unknown>,
      position: Number(image.position) || index + 1,
    }))
    const candidates = desktopCandidatesFromStored(storedCandidates)
    const { images_results: _imagesResults, ...searchMetadata } = body
    const completedAt = new Date().toISOString()
    const sourceLabel = 'SerpAPI Google Images - first 20 displayed; complete response cached'
    const activityUpdate = supabase.from('activities').update({
      codex_image_candidates: candidates,
      codex_image_search_query: query,
      codex_image_searched_at: completedAt,
      codex_image_search_model: sourceLabel,
      serpapi_image_candidates: storedCandidates,
      serpapi_image_search_query: query,
      serpapi_image_candidates_fetched_at: completedAt,
      serpapi_image_search_status: storedCandidates.length ? 'completed' : 'no_results',
      serpapi_image_search_failure_reason: null,
      serpapi_image_raw_result_count: storedCandidates.length,
      serpapi_image_search_metadata: redactSerpApiSecrets(searchMetadata),
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
      reused: false,
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
    if (claimedPaidSearch) {
      await supabase.from('activities').update({
        serpapi_image_search_status: 'failed',
        serpapi_image_search_failure_reason: error instanceof Error ? error.message : 'SerpAPI image search failed.',
        updated_at: new Date().toISOString(),
      }).eq('activity_id', activity.activity_id)
    }
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

async function storeReviewedCandidate(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  activity: Activity,
  candidate: Candidate,
  storageKey: string,
  searchQuery: string,
  model: string,
) {
  const sourceUrl = candidate.source_page_url || candidate.image_url
  if (cleanText(activity.reviewed_image_original_url) === candidate.image_url
    && cleanText(activity.reviewed_image_url)
    && !cleanText(activity.model_selected_url)
    && !activity.use_category_image) {
    return {
      reviewedImageUrl: cleanText(activity.reviewed_image_url),
      sourceUrl: cleanText(activity.reviewed_image_source_url) || sourceUrl,
      selectedAt: cleanText(activity.reviewed_image_selected_at) || new Date().toISOString(),
      model: cleanText(activity.reviewed_image_model) || model,
      candidate,
      clearedModelSelection: false,
      useCategoryImage: false,
    }
  }
  const downloaded = await downloadCandidate(candidate)
  const selectedAt = new Date().toISOString()
  const revision = Date.parse(selectedAt)
  const safeStorageKey = storageKey.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80)
  const path = `reviewed/${activity.activity_id}/${revision}-${safeStorageKey}.${extensionFor(downloaded.contentType)}`
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
    use_category_image: false,
    model_selected_url: null,
    model_selected_confidence: null,
    model_selected_at: null,
    model_selected_original_url: null,
    model_selected_source_url: null,
    model_selected_source_field: null,
    model_selected_reason: null,
    model_selected_model: null,
    model_selected_model_version: null,
    updated_at: selectedAt,
  }).eq('activity_id', activity.activity_id)
  const reviewLog = supabase.from('activity_image_manual_reviews').insert({
    activity_id: activity.activity_id,
    reviewed_image_url: reviewedImageUrl,
    original_image_url: candidate.image_url,
    source_page_url: candidate.source_page_url,
    search_query: searchQuery,
    candidate: { ...candidate, downloaded_width: downloaded.dimensions.width, downloaded_height: downloaded.dimensions.height },
    model,
    selected_by_user_id: userId,
  })
  const [{ error: updateError }, { error: logError }] = await Promise.all([activityUpdate, reviewLog])
  if (updateError) throw new Error(updateError.message)
  if (logError) throw new Error(`Image saved, but the manual review log failed: ${logError.message}`)
  return { reviewedImageUrl, sourceUrl, selectedAt, model, candidate, clearedModelSelection: true, useCategoryImage: false }
}

async function storeSearchCandidate(
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
  return storeReviewedCandidate(
    supabase,
    userId,
    activity,
    candidate,
    `serpapi-${candidateIndex}`,
    cleanText(activity.codex_image_search_query),
    cleanText(activity.codex_image_search_model) || 'Desktop image review',
  )
}

async function storeExistingSource(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  activity: Activity,
  sourceField: StoredSourceField,
) {
  const candidate = await storedSourceCandidate(supabase, activity, sourceField)
  return storeReviewedCandidate(
    supabase,
    userId,
    activity,
    candidate,
    `stored-${sourceField}`,
    `Existing listing image: ${sourceField}`,
    `Desktop image review — ${sourceField}`,
  )
}

async function storeCategoryIllustration(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  activity: Activity,
) {
  const candidate = categoryIllustrationCandidate(activity)
  const sourceUrl = candidate.image_url
  const model = 'Tiny Outings illustrated category image'
  const selectedAt = new Date().toISOString()
  const activityUpdate = supabase.from('activities').update({
    reviewed_image_url: null,
    reviewed_image_source_url: null,
    reviewed_image_original_url: null,
    reviewed_image_selected_at: null,
    reviewed_image_model: null,
    reviewed_image_selected_by_user_id: null,
    use_category_image: true,
    updated_at: selectedAt,
  }).eq('activity_id', activity.activity_id)
  const reviewLog = supabase.from('activity_image_manual_reviews').insert({
    activity_id: activity.activity_id,
    reviewed_image_url: null,
    original_image_url: candidate.image_url,
    source_page_url: candidate.source_page_url,
    search_query: `Illustrated category image: ${cleanText(activity.category) || 'Family activity'}`,
    candidate,
    model,
    selected_by_user_id: userId,
  })
  const [{ error: updateError }, { error: logError }] = await Promise.all([activityUpdate, reviewLog])
  if (updateError) throw new Error(updateError.message)
  if (logError) throw new Error(`Image saved, but the manual review log failed: ${logError.message}`)
  return { reviewedImageUrl: null, sourceUrl, selectedAt, model, candidate, clearedModelSelection: false, useCategoryImage: true }
}

async function publishDraft(supabase: ReturnType<typeof createClient>, activity: Activity, userId: string) {
  if (activity.public_listing_status === 'published' && !activity.archive) {
    return {
      activity_id: activity.activity_id,
      public_listing_status: 'published',
      archive: false,
    }
  }
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

async function findPendingAutomatedReview(
  supabase: ReturnType<typeof createClient>,
  automatedReviewId: string,
  activityId: string,
) {
  const { data, error } = await supabase.from('activity_image_automated_reviews')
    .select('automated_review_id,activity_id,status,candidate_index,candidate,model_name,model_version')
    .eq('automated_review_id', automatedReviewId)
    .eq('activity_id', activityId)
    .in('status', ['pending', 'auto_applied'])
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('The automated review proposal is no longer awaiting review.')
  return data
}

async function completeAutomatedReview(
  supabase: ReturnType<typeof createClient>,
  automatedReview: { automated_review_id: string; candidate_index: number | null },
  selectedCandidateIndex: number | null,
  reviewedImageUrl: string | null,
  userId: string,
) {
  const reviewedAt = new Date().toISOString()
  const status = automatedReview.candidate_index === selectedCandidateIndex ? 'approved' : 'corrected'
  const { data, error } = await supabase.from('activity_image_automated_reviews').update({
    status,
    reviewed_at: reviewedAt,
    reviewed_by_user_id: userId,
    reviewed_candidate_index: selectedCandidateIndex,
    reviewed_image_url: reviewedImageUrl,
  }).eq('automated_review_id', automatedReview.automated_review_id)
    .in('status', ['pending', 'auto_applied'])
    .select('automated_review_id,status,reviewed_at,reviewed_candidate_index')
    .single()
  if (error) throw new Error(`Image saved, but the automated review log failed: ${error.message}`)
  return data
}

async function promoteModelSelection(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  activity: Activity,
  automatedReview: {
    automated_review_id: string
    candidate_index: number | null
    candidate?: Candidate
    model_name?: string | null
    model_version?: string | null
  },
) {
  const reviewedImageUrl = cleanText(activity.model_selected_url)
  if (!validHttpUrl(reviewedImageUrl) || Number(activity.model_selected_confidence) < 0.7) {
    throw new Error('The model-selected image is no longer approved for this listing.')
  }
  const candidate = automatedReview.candidate || {
    image_url: cleanText(activity.model_selected_original_url) || reviewedImageUrl,
    source_page_url: cleanText(activity.model_selected_source_url) || reviewedImageUrl,
    source_field: cleanText(activity.model_selected_source_field) || 'model_selected_url',
  }
  const selectedAt = new Date().toISOString()
  const sourceUrl = cleanText(candidate.source_page_url) || cleanText(activity.model_selected_source_url) || reviewedImageUrl
  const originalUrl = cleanText(candidate.image_url) || cleanText(activity.model_selected_original_url) || reviewedImageUrl
  const model = `Desktop approval of ${cleanText(automatedReview.model_name) || cleanText(activity.model_selected_model) || 'learned image selector'}`
  const activityUpdate = supabase.from('activities').update({
    reviewed_image_url: reviewedImageUrl,
    reviewed_image_source_url: sourceUrl,
    reviewed_image_original_url: originalUrl,
    reviewed_image_selected_at: selectedAt,
    reviewed_image_model: model,
    reviewed_image_selected_by_user_id: userId,
    use_category_image: false,
    model_selected_url: null,
    model_selected_confidence: null,
    model_selected_at: null,
    model_selected_original_url: null,
    model_selected_source_url: null,
    model_selected_source_field: null,
    model_selected_reason: null,
    model_selected_model: null,
    model_selected_model_version: null,
    updated_at: selectedAt,
  }).eq('activity_id', activity.activity_id)
  const reviewLog = supabase.from('activity_image_manual_reviews').insert({
    activity_id: activity.activity_id,
    reviewed_image_url: reviewedImageUrl,
    original_image_url: originalUrl,
    source_page_url: sourceUrl,
    search_query: `Approved learned cross-source selection: ${cleanText(activity.model_selected_source_field) || 'unknown source'}`,
    candidate,
    model,
    selected_by_user_id: userId,
  })
  const [{ error: updateError }, { error: logError }] = await Promise.all([activityUpdate, reviewLog])
  if (updateError) throw new Error(updateError.message)
  if (logError) throw new Error(`Image approved, but the manual review log failed: ${logError.message}`)
  const completedAutomatedReview = await completeAutomatedReview(
    supabase,
    automatedReview,
    automatedReview.candidate_index,
    reviewedImageUrl,
    userId,
  )
  return {
    reviewedImageUrl,
    sourceUrl,
    selectedAt,
    model,
    candidate,
    clearedModelSelection: true,
    useCategoryImage: false,
    automatedReview: completedAutomatedReview,
  }
}

async function useNextHierarchyImage(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
  suppliedActivityIds: unknown,
) {
  const activityIds = [...new Set([
    activity.activity_id,
    ...(Array.isArray(suppliedActivityIds) ? suppliedActivityIds : []),
  ].map(cleanText).filter((value) => /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 50)
  const changedAt = new Date().toISOString()
  const { data, error } = await supabase.from('activities').update({
    model_selected_url: null,
    model_selected_confidence: null,
    model_selected_at: null,
    model_selected_original_url: null,
    model_selected_source_url: null,
    model_selected_source_field: null,
    model_selected_reason: null,
    model_selected_model: null,
    model_selected_model_version: null,
    updated_at: changedAt,
  }).in('activity_id', activityIds)
    .eq('archive', false)
    .select('activity_id,model_selected_url')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('No matching activity images could be updated.')
  return data
}

async function archiveActivity(supabase: ReturnType<typeof createClient>, activity: Activity, userId: string) {
  const archivedAt = new Date().toISOString()
  const previousStatus = ['draft', 'published'].includes(activity.public_listing_status)
    ? activity.public_listing_status
    : cleanText(activity.archive_previous_listing_status) || 'draft'
  const { data, error } = await supabase.from('activities').update({
    archive: true,
    public_listing_status: 'archived',
    archive_previous_listing_status: previousStatus,
    archive_reason: 'Archived from desktop image review',
    archived_at: archivedAt,
    updated_at: archivedAt,
  }).eq('activity_id', activity.activity_id)
    .select('activity_id,public_listing_status,archive,archive_reason,archived_at,archive_previous_listing_status')
    .single()
  if (error) throw new Error(error.message)
  await supabase.from('activity_review_queue').update({
    status: 'dismissed',
    reviewed_at: archivedAt,
    reviewed_by_user_id: userId,
  }).eq('activity_id', activity.activity_id).eq('status', 'pending')
  return data
}

async function unarchiveActivity(supabase: ReturnType<typeof createClient>, activity: Activity) {
  if (!activity.archive && activity.public_listing_status !== 'archived') {
    throw new Error('Only archived listings can be restored from this queue.')
  }
  const { data, error } = await supabase.rpc('unarchive_activity_from_image_review', {
    p_activity_id: activity.activity_id,
  }).single()
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
    action?: 'search' | 'select' | 'approve_model' | 'select_category_illustration' | 'use_next_hierarchy_image' | 'publish' | 'ignore' | 'archive' | 'unarchive'
    activity_id?: string
    activity_ids?: string[]
    candidate_request_id?: string
    query?: string
    request_variant?: string
    candidate_index?: number
    selection_kind?: 'search_candidate' | 'hierarchy_source' | typeof categoryIllustrationSelectionKind
    source_field?: StoredSourceField
    candidate_set_searched_at?: string
    automated_review_id?: string
    ignored?: boolean
  }
  if (!body.activity_id || !body.action) return jsonResponse({ error: 'action and activity_id are required.' }, 400)
  try {
    const activity = await findActivity(supabase, body.activity_id, body.action === 'unarchive')
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
    if (body.action === 'select_category_illustration') {
      if (!user.id) return jsonResponse({ error: 'An administrator user session is required to select an image.' }, 403)
      const automatedReviewId = cleanText(body.automated_review_id)
      const automatedReview = automatedReviewId
        ? await findPendingAutomatedReview(supabase, automatedReviewId, activity.activity_id)
        : null
      const result = await storeCategoryIllustration(supabase, user.id, activity)
      const completedAutomatedReview = automatedReview
        ? await completeAutomatedReview(supabase, automatedReview, null, null, user.id)
        : null
      return jsonResponse({ status: 'selected', ...result, automatedReview: completedAutomatedReview })
    }
    if (body.action === 'select') {
      if (!user.id) return jsonResponse({ error: 'An administrator user session is required to select an image.' }, 403)
      if (body.selection_kind === categoryIllustrationSelectionKind) {
        const automatedReviewId = cleanText(body.automated_review_id)
        const automatedReview = automatedReviewId
          ? await findPendingAutomatedReview(supabase, automatedReviewId, activity.activity_id)
          : null
        const result = await storeCategoryIllustration(supabase, user.id, activity)
        const completedAutomatedReview = automatedReview
          ? await completeAutomatedReview(supabase, automatedReview, null, null, user.id)
          : null
        return jsonResponse({ status: 'selected', ...result, automatedReview: completedAutomatedReview })
      }
      const selectedStoredSource = body.selection_kind === 'hierarchy_source'
      if (selectedStoredSource && !isStoredSourceField(body.source_field)) {
        return jsonResponse({ error: 'A valid source_field is required.' }, 400)
      }
      if (!selectedStoredSource && (!Number.isInteger(body.candidate_index) || Number(body.candidate_index) < 0)) {
        return jsonResponse({ error: 'candidate_index is required.' }, 400)
      }
      const automatedReviewId = cleanText(body.automated_review_id)
      const automatedReview = automatedReviewId
        ? await findPendingAutomatedReview(supabase, automatedReviewId, activity.activity_id)
        : null
      const selectedCandidateIndex = selectedStoredSource ? null : Number(body.candidate_index)
      const result = selectedStoredSource
        ? await storeExistingSource(supabase, user.id, activity, body.source_field as StoredSourceField)
        : await storeSearchCandidate(supabase, user.id, activity, selectedCandidateIndex as number, cleanText(body.candidate_set_searched_at))
      const completedAutomatedReview = automatedReview
        ? await completeAutomatedReview(supabase, automatedReview, selectedCandidateIndex, result.reviewedImageUrl, user.id)
        : null
      return jsonResponse({ status: 'selected', ...result, automatedReview: completedAutomatedReview })
    }
    if (body.action === 'approve_model') {
      if (!user.id) return jsonResponse({ error: 'An administrator user session is required to approve an image.' }, 403)
      const automatedReviewId = cleanText(body.automated_review_id)
      if (!automatedReviewId) return jsonResponse({ error: 'automated_review_id is required.' }, 400)
      const automatedReview = await findPendingAutomatedReview(supabase, automatedReviewId, activity.activity_id)
      return jsonResponse({ status: 'selected', ...await promoteModelSelection(supabase, user.id, activity, automatedReview) })
    }
    if (body.action === 'use_next_hierarchy_image') {
      if (!user.id) return jsonResponse({ error: 'An administrator user session is required to change the image hierarchy.' }, 403)
      const automatedReviewId = cleanText(body.automated_review_id)
      const automatedReview = automatedReviewId
        ? await findPendingAutomatedReview(supabase, automatedReviewId, activity.activity_id)
        : null
      const result = await useNextHierarchyImage(supabase, activity, body.activity_ids)
      const completedAutomatedReview = automatedReview
        ? await completeAutomatedReview(supabase, automatedReview, null, null, user.id)
        : null
      return jsonResponse({ status: 'next_hierarchy_image', activity: result, automatedReview: completedAutomatedReview })
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
    if (body.action === 'archive') {
      if (!user.id) return jsonResponse({ error: 'An administrator user session is required to archive a listing.' }, 403)
      const result = await archiveActivity(supabase, activity, user.id)
      return jsonResponse({ status: 'archived', activity: result })
    }
    if (body.action === 'unarchive') {
      if (!user.id) return jsonResponse({ error: 'An administrator user session is required to restore a listing.' }, 403)
      const result = await unarchiveActivity(supabase, activity)
      return jsonResponse({ status: 'unarchived', activity: result })
    }
    return jsonResponse({ error: 'Unsupported action.' }, 400)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Image review request failed.' }, 500)
  }
})
