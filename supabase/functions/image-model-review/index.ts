import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { currentActiveProposals, reviewedChoice } from './policy.js'
import { downloadSubmittedImage, publicImageUrl } from './remoteImage.js'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const admins = new Set(['talkingmeowth06@gmail.com', 'talkingmeowtho6@gmail.com', 'benfielden@gmail.com'])
const validId = (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return reply({ error: 'Sign in as an administrator.' }, 401)
  const { data: auth, error: authError } = await db.auth.getUser(token)
  if (authError || !auth.user) return reply({ error: 'Session expired. Sign in again.' }, 401)
  if (!auth.user.email_confirmed_at || !admins.has((auth.user.email || '').toLowerCase())) return reply({ error: 'Administrator access required.' }, 403)
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') return reply({ error: 'Invalid request.' }, 400)
    const table = db.from('activity_image_model_proposals')
    if (body.action === 'batch') {
      const { data, error } = await table.select('batch_id,created_at').order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return reply({ batch: data || null })
    }
    if (typeof body.batch_id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(body.batch_id)) return reply({ error: 'Invalid batch.' }, 400)
    if (body.action === 'list') {
      const offset = Math.max(0, Math.min(100000, Math.floor(Number(body.offset) || 0)))
      const { data, error, count } = await db.from('activity_image_model_proposal_queue')
        .select('batch_id,activity_id,activity_snapshot,status,selected_image,candidate_count,decision,chosen_image,proposal_hash', { count: 'exact' })
        .eq('batch_id', body.batch_id).order('activity_id').range(offset, offset + 199)
      if (error) throw error
      const ids = (data || []).map((proposal) => proposal.activity_id)
      const { data: activities, error: activityError } = ids.length
        ? await db.from('activities').select('activity_id,archive,public_listing_status').in('activity_id', ids)
        : { data: [], error: null }
      if (activityError) throw activityError
      const proposals = currentActiveProposals(data || [], activities || [])
      return reply({ proposals, total: count || 0, next: offset + (data?.length || 0) < (count || 0) ? offset + 200 : null })
    }
    if (!validId(body.activity_id)) return reply({ error: 'Invalid activity.' }, 400)
    const { data: proposal, error } = await table.select('*').eq('batch_id', body.batch_id).eq('activity_id', body.activity_id).maybeSingle()
    if (error) throw error
    if (!proposal) return reply({ error: 'Proposal not found.' }, 404)
    if (body.action === 'detail') return reply({ proposal })
    if (body.action === 'submit_url') {
      if (body.proposal_hash !== proposal.proposal_hash) return reply({ error: 'The proposal changed. Refresh it first.' }, 409)
      const originalUrl = publicImageUrl(body.image_url).href
      const existing = [proposal.selected_image, ...(proposal.alternatives || [])].find(
        (candidate) => candidate?.submitted_original_url === originalUrl,
      )
      if (existing) return reply({ proposal, candidate: existing })
      const { data: activity, error: activityError } = await db.from('activities')
        .select('activity_id').eq('activity_id', body.activity_id).eq('archive', false)
        .in('public_listing_status', ['draft', 'published']).maybeSingle()
      if (activityError) throw activityError
      if (!activity) return reply({ error: 'This listing is no longer active.' }, 409)
      const photo = await downloadSubmittedImage(originalUrl)
      const path = `reviewed/submitted/${body.activity_id}/${crypto.randomUUID()}.${photo.extension}`
      const { error: uploadError } = await db.storage.from('activity-images').upload(path, photo.bytes, {
        contentType: photo.mime, cacheControl: '31536000', upsert: false,
      })
      if (uploadError) throw uploadError
      const storedUrl = db.storage.from('activity-images').getPublicUrl(path).data.publicUrl
      const candidate = {
        image_url: storedUrl,
        submitted_original_url: originalUrl,
        source_page_url: originalUrl,
        source_domain: new URL(originalUrl).hostname,
        source_field: 'admin_submitted_url',
        candidate_source: 'admin_submitted_url',
        source_kind: 'admin_submitted',
        title: 'Admin-submitted photo URL',
        width: photo.width, height: photo.height,
        mime_type: photo.mime,
        model_assessed: false,
        submitted_by: auth.user.id,
        submitted_at: new Date().toISOString(),
      }
      try {
        const { data: saved, error: appendError } = await db.rpc('append_model_review_url_candidate', {
          p_batch_id: body.batch_id,
          p_activity_id: body.activity_id,
          p_proposal_hash: body.proposal_hash,
          p_candidate: candidate,
        })
        if (appendError) throw appendError
        const savedCandidate = (saved?.alternatives || []).find(
          (item: { submitted_original_url?: string }) => item.submitted_original_url === originalUrl,
        )
        if (!savedCandidate) throw Error('The submitted URL was not saved. Refresh and try again.')
        if (savedCandidate.image_url !== storedUrl) await db.storage.from('activity-images').remove([path])
        return reply({ proposal: saved, candidate: savedCandidate })
      } catch (submissionError) {
        await db.storage.from('activity-images').remove([path])
        throw submissionError
      }
    }
    if (body.action !== 'decide') return reply({ error: 'Unknown action.' }, 400)
    if (body.proposal_hash !== proposal.proposal_hash) return reply({ error: 'The proposal changed. Refresh it first.' }, 409)
    const chosen = reviewedChoice(proposal, body.decision, body.image_url)
    if (body.decision === 'approved') {
      const { data: updates, error: approvalError } = await db.rpc('approve_model_image_across_sessions', {
        p_batch_id: body.batch_id,
        p_activity_id: body.activity_id,
        p_proposal_hash: body.proposal_hash,
        p_chosen_image: chosen,
        p_reviewer: auth.user.id,
      })
      if (approvalError) throw approvalError
      if (!updates?.some((item: { updated_activity_id: string }) => item.updated_activity_id === body.activity_id)) {
        throw Error('The approval was not saved. Refresh this proposal.')
      }
      return reply({ saved: true, review: { decision: 'approved', chosen_image: chosen },
        updated_proposals: updates.map((item: { updated_activity_id: string; approved_image: unknown }) => ({
          activity_id: item.updated_activity_id, decision: 'approved', chosen_image: item.approved_image,
        })),
        propagated_count: updates.length - 1, live_image_unchanged: false })
    }
    const { data: saved, error: saveError } = await table.update({
      decision: body.decision, chosen_image: chosen || null,
      reviewed_by: auth.user.id, reviewed_at: new Date().toISOString(),
    }).eq('batch_id', body.batch_id).eq('activity_id', body.activity_id).eq('proposal_hash', body.proposal_hash)
      .select('decision,chosen_image,reviewed_at').maybeSingle()
    if (saveError) throw saveError
    if (!saved) return reply({ error: 'The proposal changed. Refresh it first.' }, 409)
    return reply({ saved: true, review: saved })
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Could not complete image review.' }, 400)
  }
})
