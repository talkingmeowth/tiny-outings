import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tiny-outings-image-job-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
  source_queue: 'missing_published' | 'unsuitable_audit' | 'both'
  candidate_index: number
  candidate: Candidate
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
      .filter((review) => review.activity),
    next_offset: (reviews || []).length === pageSize ? offset + pageSize : null,
  }
}

async function targetData(
  supabase: ReturnType<typeof createClient>,
  offset: number,
  pageSize: number,
) {
  const { data, error } = await supabase.from('activities')
    .select('activity_id,activity_name,address,postcode,borough,category,website,organiser_website,source_url,public_listing_status,archive,audit_image_status,image_review_ignored_at,admin_cover_image_url,reviewed_image_url,user_image_url,audit_image_url,organiser_website_downloaded_image,website_downloaded_image,wikimedia_image_url,website_image_url,listing_image_url,codex_image_candidates,codex_image_search_query,codex_image_searched_at,codex_image_search_model,serpapi_image_candidates,serpapi_image_search_query,serpapi_image_candidates_fetched_at')
    .eq('archive', false)
    .is('image_review_ignored_at', null)
    .is('reviewed_image_url', null)
    .order('activity_id', { ascending: true })
    .range(offset, offset + pageSize - 1)
  if (error) throw new Error(error.message)
  const rows = (data || []).map((activity) => ({ ...activity, automated_source_queue: targetQueue(activity) }))
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
    if (!clean(proposal.activity_id) || !['missing_published', 'unsuitable_audit', 'both'].includes(proposal.source_queue)) throw new Error('A proposal has invalid activity or queue data.')
    if (!Number.isInteger(proposal.candidate_index) || proposal.candidate_index < 0 || proposal.candidate_index > 19) throw new Error('A proposal has an invalid candidate index.')
    if (!validCandidate(proposal.candidate)) throw new Error('A proposal has an invalid candidate.')
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
        codex_image_search_model: 'Stored SerpAPI candidates normalized for tagged-choice review',
      }).eq('activity_id', proposal.activity_id)
      if (error) throw new Error(error.message)
    })
  await runWithConcurrency(candidateUpdates)

  const rows = proposals.map((proposal) => ({
    activity_id: proposal.activity_id,
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
  }))
  const { data, error } = await supabase.from('activity_image_automated_reviews').insert(rows)
    .select('automated_review_id,activity_id,status,candidate_index,confidence')
  if (error) throw new Error(error.message)
  return data || []
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)
  if (!authorized(request)) return jsonResponse({ error: 'The automated image-review job token is required.' }, 403)
  const key = serviceRoleKey()
  if (!key) return jsonResponse({ error: 'Supabase service credentials are unavailable.' }, 500)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, key)
  const body = await request.json().catch(() => ({})) as {
    action?: 'training_data' | 'targets' | 'store_proposals'
    offset?: number
    page_size?: number
    proposals?: Proposal[]
  }
  try {
    if (body.action === 'training_data') {
      const pageSize = Math.min(200, Math.max(1, Number(body.page_size) || 100))
      return jsonResponse(await trainingData(supabase, Math.max(0, Number(body.offset) || 0), pageSize))
    }
    if (body.action === 'targets') {
      const pageSize = Math.min(1000, Math.max(1, Number(body.page_size) || 500))
      return jsonResponse(await targetData(supabase, Math.max(0, Number(body.offset) || 0), pageSize))
    }
    if (body.action === 'store_proposals') {
      const stored = await storeProposals(supabase, Array.isArray(body.proposals) ? body.proposals : [])
      return jsonResponse({ stored_count: stored.length, rows: stored })
    }
    return jsonResponse({ error: 'Unsupported action.' }, 400)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Automated image review failed.' }, 500)
  }
})
