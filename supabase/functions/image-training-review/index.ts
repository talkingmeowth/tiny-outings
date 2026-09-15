import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateTrainingReview } from './policy.js'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const admins = new Set(['talkingmeowth06@gmail.com', 'talkingmeowtho6@gmail.com', 'benfielden@gmail.com'])
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sign in as an administrator.' }, 401)
  const { data: auth, error: authError } = await db.auth.getUser(token)
  if (authError || !auth.user) return json({ error: 'Your session has expired. Sign in again.' }, 401)
  if (!admins.has((auth.user.email || '').trim().toLowerCase()) || !auth.user.email_confirmed_at) return json({ error: 'Administrator access required.' }, 403)
  try {
    const raw = await request.text()
    if (raw.length > 250000) return json({ error: 'Review is too large.' }, 413)
    const body = JSON.parse(raw)
    if (body.action === 'list') {
      const query = db.from('image_training_batches').select('*')
      const batchResponse = body.batch_id ? await query.eq('batch_id', body.batch_id).single()
        : await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (batchResponse.error) throw batchResponse.error
      if (!batchResponse.data) return json({ batch: null, cases: [] })
      const { data: cases, error } = await db.from('image_training_case_progress')
        .select('case_id,activity_id,sequence,activity_name,category,address,candidate_count,review_status,outcome,submitted_at')
        .eq('batch_id', batchResponse.data.batch_id).order('sequence').limit(1000)
      if (error) throw error
      return json({ batch: batchResponse.data, cases })
    }
    if (!uuid(body.case_id)) return json({ error: 'Choose a valid review case.' }, 400)
    const { data: reviewCase, error: caseError } = await db.from('image_training_cases').select('*').eq('case_id', body.case_id).single()
    if (caseError || !reviewCase) return json({ error: 'Review case not found.' }, 404)
    if (body.action === 'case') {
      const { data: reviews, error } = await db.from('image_training_reviews')
        .select('review_id,labels,preferred_candidate_id,outcome,notes,submitted_at')
        .eq('case_id', body.case_id).order('submitted_at', { ascending: false }).order('review_id', { ascending: false }).limit(1)
      if (error) throw error
      // Hide sampling reason, split, prior human labels and model scores to
      // avoid anchoring the reviewer. Candidate source URLs remain visible.
      return json({ case: { case_id: reviewCase.case_id, batch_id: reviewCase.batch_id, activity_id: reviewCase.activity_id,
        sequence: reviewCase.sequence, activity: reviewCase.activity_snapshot, candidates: reviewCase.candidates,
        candidate_set_hash: reviewCase.candidate_set_hash }, review: reviews?.[0] || null })
    }
    if (body.action !== 'save') return json({ error: 'Unknown action.' }, 400)
    const validated = validateTrainingReview(reviewCase, body)
    const duplicateResult = async () => await db.from('image_training_reviews')
      .select('review_id,case_id,reviewer_id,submitted_at,candidate_set_hash,labels,preferred_candidate_id,outcome,notes').eq('request_id', validated.request_id).maybeSingle()
    const matches = (row: Record<string, unknown>) => row.case_id === body.case_id && row.reviewer_id === auth.user!.id
      && row.candidate_set_hash === validated.candidate_set_hash && row.preferred_candidate_id === validated.preferred_candidate_id
      && row.outcome === validated.outcome && row.notes === validated.notes
      && JSON.stringify((row.labels as Array<Record<string, unknown>>).map((r) => [r.candidate_id, r.label, r.reason]).sort()) === JSON.stringify(validated.labels.map((r: Record<string, unknown>) => [r.candidate_id, r.label, r.reason]).sort())
    const { data: previous, error: duplicateError } = await duplicateResult()
    if (duplicateError) throw duplicateError
    if (previous) {
      if (!matches(previous)) return json({ error: 'Save identifier already used for different labels. Reload before saving.' }, 409)
      return json({ saved: true, review_id: previous.review_id, submitted_at: previous.submitted_at })
    }
    const { data: saved, error } = await db.from('image_training_reviews').insert({
      ...validated, case_id: body.case_id, reviewer_id: auth.user.id,
    }).select('review_id,submitted_at').single()
    if (error?.code === '23505') {
      const { data: raced } = await duplicateResult()
      return raced && matches(raced) ? json({ saved: true, review_id: raced.review_id, submitted_at: raced.submitted_at })
        : json({ error: 'Save identifier conflict. Reload before saving.' }, 409)
    }
    if (error) throw error
    return json({ saved: true, ...saved })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String((error as { message?: string })?.message || 'Could not save this review.') }, 400)
  }
})
