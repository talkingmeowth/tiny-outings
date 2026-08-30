import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tiny-outings-image-job-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const maxImageBytes = 8 * 1024 * 1024

type Candidate = {
  image_url: string
  thumbnail_url?: string | null
  source_page_url?: string | null
  source_domain?: string | null
  title?: string | null
  width?: number | null
  height?: number | null
  relevance_reason?: string | null
}

type Proposal = {
  activity_id: string
  source_queue: 'missing_published' | 'unsuitable_audit' | 'both' | 'all_published' | 'all_draft'
  candidate_index: number | null
  candidate: Candidate | Record<string, never>
  terminal_rejection?: boolean
  normalized_candidates?: Candidate[]
  candidate_set_searched_at?: string | null
  confidence: number
  reason: string
  model_name: string
  model_version: string
  training_review_count: number
  model_metrics?: Record<string, unknown>
  feature_snapshot?: Record<string, unknown>
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

function authorized(request: Request) {
  const expected = Deno.env.get('TINY_OUTINGS_IMAGE_JOB_SECRET') || ''
  return Boolean(expected && request.headers.get('x-tiny-outings-image-job-token') === expected)
}

function clean(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function hasImage(value: unknown) {
  return Boolean(clean(value))
}

function isMissingPublished(activity: Record<string, unknown>) {
  if (activity.public_listing_status !== 'published') return false
  return ![
    activity.admin_cover_image_url,
    activity.reviewed_image_url,
    activity.model_selected_url,
    activity.user_image_url,
    activity.audit_image_status === 'replaced' ? activity.audit_image_url : null,
    activity.organiser_website_downloaded_image,
    activity.website_downloaded_image,
    activity.wikimedia_image_url,
    activity.website_image_url,
    activity.listing_image_url,
  ].some(hasImage)
}

function isUnsuitable(activity: Record<string, unknown>) {
  return ['needs_replacement', 'no_replacement'].includes(clean(activity.audit_image_status))
    && !hasImage(activity.reviewed_image_url)
    && !hasImage(activity.model_selected_url)
}

function targetQueue(activity: Record<string, unknown>) {
  const missing = isMissingPublished(activity)
  const unsuitable = isUnsuitable(activity)
  if (missing && unsuitable) return 'both'
  if (missing) return 'missing_published'
  if (unsuitable) return 'unsuitable_audit'
  return null
}

function validCandidate(candidate: unknown): candidate is Candidate {
  if (!candidate || typeof candidate !== 'object') return false
  try {
    const url = new URL(clean((candidate as Candidate).image_url))
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

function readUint32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
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
  const imageUrls = [...new Set([candidate.image_url, candidate.thumbnail_url].filter((value): value is string => Boolean(value)))]
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    return await Promise.any(imageUrls.map((imageUrl) => downloadCandidateUrl(imageUrl, controller.signal)))
  } catch {
    throw new Error('The model-selected image could not be downloaded at sufficient resolution.')
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

async function trainingData(
  supabase: ReturnType<typeof createClient>,
  offset: number,
  pageSize: number,
) {
  const { data: reviews, error } = await supabase.from('activity_image_manual_reviews')
    .select('manual_review_id,activity_id,original_image_url,source_page_url,search_query,candidate,created_at')
    .order('created_at', { ascending: true })
    .range(offset, offset + pageSize - 1)
  if (error) throw new Error(error.message)
  const activityIds = [...new Set((reviews || []).map((review) => review.activity_id))]
  const { data: activities, error: activityError } = activityIds.length
    ? await supabase.from('activities')
      .select('activity_id,activity_name,address,postcode,borough,category,website,organiser_website,source_url,codex_image_candidates,serpapi_image_candidates')
      .in('activity_id', activityIds)
    : { data: [], error: null }
  if (activityError) throw new Error(activityError.message)
  const activityById = new Map((activities || []).map((activity) => [activity.activity_id, activity]))
  return {
    rows: (reviews || []).map((review) => ({ ...review, activity: activityById.get(review.activity_id) || null }))
      .filter((review) => review.activity && review.candidate?.selection_kind !== 'category_illustration'),
    next_offset: (reviews || []).length === pageSize ? offset + pageSize : null,
  }
}

async function targetData(
  supabase: ReturnType<typeof createClient>,
  offset: number,
  pageSize: number,
  scope: 'targeted' | 'all_unreviewed' | 'failed_applications',
) {
  let query = supabase.from('activities')
    .select('activity_id,activity_name,address,postcode,borough,category,website,organiser_website,source_url,public_listing_status,archive,audit_image_status,image_review_ignored_at,admin_cover_image_url,reviewed_image_url,model_selected_url,user_image_url,audit_image_url,organiser_website_downloaded_image,website_downloaded_image,wikimedia_image_url,website_image_url,listing_image_url,codex_image_candidates,codex_image_search_query,codex_image_searched_at,codex_image_search_model,serpapi_image_candidates,serpapi_image_search_query,serpapi_image_candidates_fetched_at,website_image_candidates,website_image_candidates_fetched_at')
    .eq('archive', false)
    .in('public_listing_status', ['draft', 'published'])
    .order('activity_id', { ascending: true })
    .range(offset, offset + pageSize - 1)
  if (scope === 'targeted') query = query.is('image_review_ignored_at', null).is('reviewed_image_url', null).is('model_selected_url', null)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const activityIds = (data || []).map((activity) => activity.activity_id)
  const activityIdBatches = Array.from({ length: Math.ceil(activityIds.length / 100) }, (_, index) => activityIds.slice(index * 100, (index + 1) * 100))
  const existingResponses = scope === 'all_unreviewed'
    ? await Promise.all(activityIdBatches.map((ids) => supabase.from('activity_image_automated_reviews').select('activity_id').in('activity_id', ids)))
    : []
  const existingReviewError = existingResponses.find((response) => response.error)?.error
  if (existingReviewError) throw new Error(existingReviewError.message)
  const existingReviews = existingResponses.flatMap((response) => response.data || [])
  const reviewedActivityIds = new Set((existingReviews || []).map((review) => review.activity_id))
  const failedResponses = await Promise.all(activityIdBatches.map((ids) => supabase.from('activity_image_automated_reviews')
    .select('activity_id,candidate')
    .in('activity_id', ids)
    .not('apply_failure_reason', 'is', null)))
  const failedReviewError = failedResponses.find((response) => response.error)?.error
  if (failedReviewError) throw new Error(failedReviewError.message)
  const failedReviews = failedResponses.flatMap((response) => response.data || [])
  const openResponses = await Promise.all(activityIdBatches.map((ids) => supabase.from('activity_image_automated_reviews')
    .select('activity_id,status,apply_failure_reason')
    .in('activity_id', ids)
    .in('status', ['pending', 'auto_applied'])))
  const openReviewError = openResponses.find((response) => response.error)?.error
  if (openReviewError) throw new Error(openReviewError.message)
  const openReviewByActivity = new Map(openResponses.flatMap((response) => response.data || [])
    .map((review) => [review.activity_id, review]))
  const failedUrlsByActivity = new Map<string, string[]>()
  for (const review of failedReviews || []) {
    const imageUrl = clean(review.candidate?.image_url)
    if (!imageUrl) continue
    const urls = failedUrlsByActivity.get(review.activity_id) || []
    if (!urls.includes(imageUrl)) urls.push(imageUrl)
    failedUrlsByActivity.set(review.activity_id, urls)
  }
  const rows = (data || []).map((activity) => ({
    ...activity,
    automated_source_queue: targetQueue(activity)
      || (scope !== 'targeted' ? (activity.public_listing_status === 'draft' ? 'all_draft' : 'all_published') : null),
    automated_failed_image_urls: failedUrlsByActivity.get(activity.activity_id) || [],
  }))
    .filter((activity) => scope !== 'all_unreviewed' || !reviewedActivityIds.has(activity.activity_id))
    .filter((activity) => {
      if (scope !== 'failed_applications' || !failedUrlsByActivity.has(activity.activity_id)) return scope !== 'failed_applications'
      const openReview = openReviewByActivity.get(activity.activity_id)
      return !openReview || (openReview.status === 'pending' && Boolean(openReview.apply_failure_reason))
    })
    .filter((activity) => activity.automated_source_queue)
  return {
    rows,
    next_offset: (data || []).length === pageSize ? offset + pageSize : null,
  }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency = 8) {
  const results: T[] = []
  let nextIndex = 0
  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results
}

async function storeProposals(
  supabase: ReturnType<typeof createClient>,
  proposals: Proposal[],
) {
  if (!proposals.length || proposals.length > 100) throw new Error('Between 1 and 100 proposals are required.')
  for (const proposal of proposals) {
    if (!clean(proposal.activity_id) || !['missing_published', 'unsuitable_audit', 'both', 'all_published', 'all_draft'].includes(proposal.source_queue)) throw new Error('A proposal has invalid activity or queue data.')
    if (proposal.terminal_rejection !== true
      && (!Number.isInteger(proposal.candidate_index) || Number(proposal.candidate_index) < 0 || Number(proposal.candidate_index) > 19)) throw new Error('A proposal has an invalid candidate index.')
    if (proposal.terminal_rejection !== true && !validCandidate(proposal.candidate)) throw new Error('A proposal has an invalid candidate.')
    if (!(Number(proposal.confidence) >= 0 && Number(proposal.confidence) <= 1)) throw new Error('A proposal has invalid confidence.')
    if (!clean(proposal.reason) || !clean(proposal.model_name) || !clean(proposal.model_version) || Number(proposal.training_review_count) < 1) throw new Error('A proposal is missing model audit data.')
  }
  const activityIds = proposals.map((proposal) => proposal.activity_id)
  const supersededAt = new Date().toISOString()
  const { error: supersedeError } = await supabase.from('activity_image_automated_reviews').update({
    status: 'superseded',
    reviewed_at: supersededAt,
  }).in('activity_id', activityIds).eq('status', 'pending')
  if (supersedeError) throw new Error(supersedeError.message)

  const candidateUpdates = proposals.filter((proposal) => Array.isArray(proposal.normalized_candidates) && proposal.normalized_candidates.length)
    .map((proposal) => async () => {
      const searchedAt = proposal.candidate_set_searched_at || supersededAt
      const { error } = await supabase.from('activities').update({
        codex_image_candidates: proposal.normalized_candidates!.slice(0, 20),
        codex_image_search_query: undefined,
        codex_image_searched_at: searchedAt,
        codex_image_search_model: 'Stored image candidates normalized for tagged-choice review',
      }).eq('activity_id', proposal.activity_id)
      if (error) throw new Error(error.message)
    })
  await runWithConcurrency(candidateUpdates)

  const rows = proposals.map((proposal) => ({
    activity_id: proposal.activity_id,
    status: proposal.terminal_rejection ? 'rejected' : 'pending',
    source_queue: proposal.source_queue,
    candidate_index: proposal.candidate_index,
    candidate: proposal.candidate,
    candidate_set_searched_at: proposal.candidate_set_searched_at || null,
    confidence: proposal.confidence,
    reason: clean(proposal.reason),
    model_name: clean(proposal.model_name),
    model_version: clean(proposal.model_version),
    training_review_count: Number(proposal.training_review_count),
    model_metrics: proposal.model_metrics || {},
    feature_snapshot: proposal.feature_snapshot || {},
    reviewed_at: proposal.terminal_rejection ? supersededAt : null,
  }))
  const { data, error } = await supabase.from('activity_image_automated_reviews').insert(rows)
    .select('automated_review_id,activity_id,status,candidate_index,confidence')
  if (error) throw new Error(error.message)
  return data || []
}

async function updateAutomatedReview(
  supabase: ReturnType<typeof createClient>,
  automatedReviewId: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase.from('activity_image_automated_reviews').update(values)
    .eq('automated_review_id', automatedReviewId)
  if (error) throw new Error(error.message)
}

async function applyProposal(
  supabase: ReturnType<typeof createClient>,
  proposal: Record<string, unknown>,
  activity: Record<string, unknown> | undefined,
) {
  const attemptedAt = new Date().toISOString()
  const automatedReviewId = clean(proposal.automated_review_id)
  const candidate = proposal.candidate as Candidate
  if (!activity) throw new Error('Activity not found.')
  if (activity.archive) {
    await updateAutomatedReview(supabase, automatedReviewId, {
      status: 'rejected',
      reviewed_at: attemptedAt,
      apply_attempted_at: attemptedAt,
      apply_failure_reason: 'Listing was archived before automatic application.',
    })
    return { activity_id: proposal.activity_id, status: 'archived' }
  }

  const protectedImage = clean(activity.admin_cover_image_url)
    || clean(activity.user_image_url)
    || clean(activity.user_uploaded_image_url)
  if (protectedImage || activity.image_review_ignored_at) {
    await updateAutomatedReview(supabase, automatedReviewId, {
      status: 'corrected',
      reviewed_at: attemptedAt,
      reviewed_candidate_index: null,
      reviewed_image_url: protectedImage || null,
      apply_attempted_at: attemptedAt,
      apply_failure_reason: null,
    })
    return { activity_id: proposal.activity_id, status: 'preserved-user-choice' }
  }

  const currentReviewedImage = clean(activity.reviewed_image_url)
  if (currentReviewedImage) {
    const selectedSameCandidate = clean(activity.reviewed_image_original_url) === clean(candidate.image_url)
    await updateAutomatedReview(supabase, automatedReviewId, selectedSameCandidate ? {
      status: 'auto_applied',
      auto_applied_at: attemptedAt,
      auto_applied_image_url: currentReviewedImage,
      apply_attempted_at: attemptedAt,
      apply_failure_reason: null,
    } : {
      status: 'corrected',
      reviewed_at: attemptedAt,
      reviewed_candidate_index: null,
      reviewed_image_url: currentReviewedImage,
      apply_attempted_at: attemptedAt,
      apply_failure_reason: null,
    })
    return { activity_id: proposal.activity_id, status: selectedSameCandidate ? 'already-applied' : 'preserved-existing-review' }
  }

  const currentModelImage = clean(activity.model_selected_url)
  if (currentModelImage) {
    await updateAutomatedReview(supabase, automatedReviewId, {
      status: 'superseded',
      reviewed_at: attemptedAt,
      reviewed_candidate_index: null,
      reviewed_image_url: currentModelImage,
      apply_attempted_at: attemptedAt,
      apply_failure_reason: null,
    })
    return { activity_id: proposal.activity_id, status: 'preserved-existing-model-selection' }
  }

  const downloaded = await downloadCandidate(candidate)
  const selectedAt = new Date().toISOString()
  const path = `model-selected/automated/${proposal.activity_id}/${automatedReviewId}.${extensionFor(downloaded.contentType)}`
  const upload = await supabase.storage.from('activity-images').upload(path, downloaded.bytes, {
    contentType: downloaded.contentType,
    cacheControl: '31536000',
    upsert: true,
  })
  if (upload.error) throw new Error(upload.error.message)
  const modelSelectedUrl = supabase.storage.from('activity-images').getPublicUrl(path).data.publicUrl
  const { data: updatedActivity, error: activityError } = await supabase.from('activities').update({
    model_selected_url: modelSelectedUrl,
    updated_at: selectedAt,
  }).eq('activity_id', proposal.activity_id)
    .is('reviewed_image_url', null)
    .is('model_selected_url', null)
    .select('activity_id')
    .maybeSingle()
  if (activityError) throw new Error(activityError.message)
  if (!updatedActivity) throw new Error('A human or model image choice was saved before this automatic update could be applied.')
  await updateAutomatedReview(supabase, automatedReviewId, {
    status: 'auto_applied',
    auto_applied_at: selectedAt,
    auto_applied_image_url: modelSelectedUrl,
    apply_attempted_at: attemptedAt,
    apply_failure_reason: null,
  })
  return {
    activity_id: proposal.activity_id,
    status: 'auto-applied',
    model_selected_url: modelSelectedUrl,
    width: downloaded.dimensions.width,
    height: downloaded.dimensions.height,
  }
}

async function applyPendingProposals(
  supabase: ReturnType<typeof createClient>,
  batchSize: number,
) {
  const { data: proposals, error } = await supabase.from('activity_image_automated_reviews')
    .select('automated_review_id,activity_id,status,candidate_index,candidate,model_name,model_version')
    .eq('status', 'pending')
    .is('apply_failure_reason', null)
    .order('created_at', { ascending: true })
    .limit(batchSize)
  if (error) throw new Error(error.message)
  const activityIds = (proposals || []).map((proposal) => proposal.activity_id)
  const { data: activities, error: activityError } = activityIds.length
    ? await supabase.from('activities')
      .select('activity_id,archive,image_review_ignored_at,admin_cover_image_url,user_image_url,reviewed_image_url,reviewed_image_original_url,model_selected_url')
      .in('activity_id', activityIds)
    : { data: [], error: null }
  if (activityError) throw new Error(activityError.message)
  const { data: userPhotos, error: userPhotoError } = activityIds.length
    ? await supabase.from('activity_photos')
      .select('activity_id,photo_url')
      .eq('source_provider', 'user_upload')
      .in('activity_id', activityIds)
    : { data: [], error: null }
  if (userPhotoError) throw new Error(userPhotoError.message)
  const userUploadByActivity = new Map((userPhotos || []).map((photo) => [photo.activity_id, photo.photo_url]))
  const activityById = new Map((activities || []).map((activity) => [activity.activity_id, {
    ...activity,
    user_uploaded_image_url: userUploadByActivity.get(activity.activity_id) || null,
  }]))
  const tasks = (proposals || []).map((proposal) => async () => {
    try {
      return await applyProposal(supabase, proposal, activityById.get(proposal.activity_id))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automatic image application failed.'
      await updateAutomatedReview(supabase, proposal.automated_review_id, {
        apply_attempted_at: new Date().toISOString(),
        apply_failure_reason: message,
      })
      return { activity_id: proposal.activity_id, status: 'failed', error: message }
    }
  })
  const rows = await runWithConcurrency(tasks, 4)
  const { count, error: countError } = await supabase.from('activity_image_automated_reviews')
    .select('automated_review_id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('apply_failure_reason', null)
  if (countError) throw new Error(countError.message)
  return { rows, remaining_count: count || 0 }
}

async function resetApplyFailures(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.from('activity_image_automated_reviews').update({
    apply_failure_reason: null,
  }).eq('status', 'pending')
    .not('apply_failure_reason', 'is', null)
    .select('automated_review_id')
  if (error) throw new Error(error.message)
  return data?.length || 0
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)
  if (!authorized(request)) return jsonResponse({ error: 'The automated image-review job token is required.' }, 403)
  const key = serviceRoleKey()
  if (!key) return jsonResponse({ error: 'Supabase service credentials are unavailable.' }, 500)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, key)
  const body = await request.json().catch(() => ({})) as {
    action?: 'training_data' | 'targets' | 'store_proposals' | 'apply_pending' | 'reset_apply_failures'
    offset?: number
    page_size?: number
    scope?: 'targeted' | 'all_unreviewed' | 'failed_applications'
    proposals?: Proposal[]
    batch_size?: number
  }
  try {
    if (body.action === 'training_data') {
      const pageSize = Math.min(200, Math.max(1, Number(body.page_size) || 100))
      return jsonResponse(await trainingData(supabase, Math.max(0, Number(body.offset) || 0), pageSize))
    }
    if (body.action === 'targets') {
      const pageSize = Math.min(1000, Math.max(1, Number(body.page_size) || 500))
      const scope = body.scope === 'all_unreviewed'
        ? 'all_unreviewed'
        : body.scope === 'failed_applications' ? 'failed_applications' : 'targeted'
      return jsonResponse(await targetData(supabase, Math.max(0, Number(body.offset) || 0), pageSize, scope))
    }
    if (body.action === 'store_proposals') {
      const stored = await storeProposals(supabase, Array.isArray(body.proposals) ? body.proposals : [])
      return jsonResponse({ stored_count: stored.length, rows: stored })
    }
    if (body.action === 'apply_pending') {
      const batchSize = Math.min(20, Math.max(1, Number(body.batch_size) || 10))
      const result = await applyPendingProposals(supabase, batchSize)
      return jsonResponse({ processed_count: result.rows.length, ...result })
    }
    if (body.action === 'reset_apply_failures') {
      return jsonResponse({ reset_count: await resetApplyFailures(supabase) })
    }
    return jsonResponse({ error: 'Unsupported action.' }, 400)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Automated image review failed.' }, 500)
  }
})
