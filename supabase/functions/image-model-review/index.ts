import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { proposalAlternativePage } from './policy.js'
import { downloadSubmittedImage, imageDimensions, publicImageUrl } from './remoteImage.js'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tiny-outings-image-job-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const admins = new Set(['talkingmeowth06@gmail.com', 'talkingmeowtho6@gmail.com', 'benfielden@gmail.com'])
const validId = (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

function isDurableActivityImageUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''))
    const project = new URL(Deno.env.get('SUPABASE_URL')!)
    return url.origin === project.origin
      && url.pathname.startsWith('/storage/v1/object/public/activity-images/')
  } catch { return false }
}

async function persistApprovedPhoto(db: ReturnType<typeof createClient>, originalUrl: string) {
  if (isDurableActivityImageUrl(originalUrl)) {
    const url = new URL(originalUrl)
    return { storedUrl: originalUrl, storagePath: decodeURIComponent(url.pathname.split('/activity-images/')[1] || ''), width: null, height: null, mime: null }
  }
  const { data: cached, error: cacheError } = await db.from('activity_image_review_asset_cache')
    .select('stored_url,storage_path,width,height,mime_type').eq('original_url', originalUrl).maybeSingle()
  if (cacheError) throw cacheError
  if (cached && isDurableActivityImageUrl(cached.stored_url)) {
    return { storedUrl: cached.stored_url, storagePath: cached.storage_path,
      width: cached.width, height: cached.height, mime: cached.mime_type }
  }
  const photo = await downloadSubmittedImage(originalUrl, fetch, {
    allowAssetTerms: true, allowHttp: true, allowSniffedMime: true,
    maxBytes: 20 * 1024 * 1024, minimumSide: 100, minimumPixels: 10000, minimumBytes: 1024,
  })
  const stored = await storeApprovedBytes(db, photo.bytes, photo.mime, photo.width, photo.height)
  const { error: saveCacheError } = await db.from('activity_image_review_asset_cache').upsert({
    original_url: originalUrl, stored_url: stored.storedUrl, storage_path: stored.storagePath,
    width: stored.width, height: stored.height, mime_type: stored.mime, stored_at: new Date().toISOString(),
  }, { onConflict: 'original_url' })
  if (saveCacheError) throw saveCacheError
  return stored
}

async function storeApprovedBytes(
  db: ReturnType<typeof createClient>, bytes: Uint8Array, mime: string,
  suppliedWidth?: number | null, suppliedHeight?: number | null,
) {
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }
  const extension = extensions[mime]
  if (!extension || bytes.byteLength < 1024 || bytes.byteLength > 8 * 1024 * 1024) throw Error('Stored image payload was not usable.')
  const dimensions = imageDimensions(bytes, mime)
  const width = suppliedWidth || dimensions?.width || null
  const height = suppliedHeight || dimensions?.height || null
  if (!width || !height || Math.min(width, height) < 100) throw Error('Stored image resolution was not usable.')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  const storagePath = `reviewed/approved/${hash}.${extension}`
  const { error } = await db.storage.from('activity-images').upload(storagePath, bytes, {
    contentType: mime, cacheControl: '31536000', upsert: true,
  })
  if (error) throw error
  return {
    storedUrl: db.storage.from('activity-images').getPublicUrl(storagePath).data.publicUrl,
    storagePath, width, height, mime,
  }
}

const queueFields = 'batch_id,activity_id,activity_snapshot,status,selected_image,candidate_count,decision,chosen_image,proposal_hash'
const detailFields = 'batch_id,activity_id,activity_snapshot,model_version,status,selected_image,candidate_count,assessed_count,source_gaps,failure_reason,proposal_hash,decision,chosen_image,reviewed_by,reviewed_at,created_at'

function proposalSummary(proposal: Record<string, unknown>) {
  const { alternatives: _alternatives, ...summary } = proposal
  return summary
}

async function latestBatch(db: ReturnType<typeof createClient>) {
  const { data, error } = await db.from('activity_image_model_proposals')
    .select('batch_id,created_at').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data || null
}

async function loadQueuePage(db: ReturnType<typeof createClient>, batchId: string,
  offset = 0, limit = 200, includeTotal = true) {
  const safeOffset = Math.max(0, Math.min(100000, Math.floor(Number(offset) || 0)))
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 200)))
  const query = db.from('activity_image_model_proposal_queue')
    .select(queueFields, includeTotal ? { count: 'exact' } : undefined)
    .eq('batch_id', batchId).order('activity_id')
    .range(safeOffset, safeOffset + safeLimit - 1)
  const { data, error, count } = await query
  if (error) throw error
  const total = includeTotal ? count || 0 : null
  const next = includeTotal
    ? safeOffset + (data?.length || 0) < (total || 0) ? safeOffset + safeLimit : null
    : (data?.length || 0) === safeLimit ? safeOffset + safeLimit : null
  return { proposals: data || [], total, next }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const expectedJobToken = Deno.env.get('TINY_OUTINGS_IMAGE_JOB_SECRET') || ''
  const isImageJob = Boolean(expectedJobToken)
    && request.headers.get('x-tiny-outings-image-job-token') === expectedJobToken
  if (isImageJob) {
    try {
      const body = await request.json()
      if (!['persist_approved_urls', 'persist_approved_payloads'].includes(body?.action) || !Array.isArray(body.items)) {
        return reply({ error: 'This job token is limited to approved-image persistence.' }, 403)
      }
      const items = body.items.slice(0, body.action === 'persist_approved_payloads' ? 3 : 6)
      const results = []
      for (const item of items as Array<{ image_url?: unknown; image_base64?: unknown; mime_type?: unknown }>) {
        const originalUrl = String(item?.image_url || '')
        try {
          if (isDurableActivityImageUrl(originalUrl)) {
            results.push({ image_url: originalUrl, status: 'already_stored', updated: 0 })
            continue
          }
          let stored
          if (body.action === 'persist_approved_payloads') {
            const encoded = String(item.image_base64 || '')
            if (!encoded || encoded.length > 12 * 1024 * 1024) throw Error('Stored image payload was too large.')
            const binary = atob(encoded)
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
            stored = await storeApprovedBytes(db, bytes, String(item.mime_type || ''))
          } else {
            stored = await persistApprovedPhoto(db, originalUrl)
          }
          const { data, error } = await db.rpc('persist_approved_model_image_url', {
            p_original_image_url: originalUrl,
            p_stored_image_url: stored.storedUrl,
            p_storage_path: stored.storagePath,
            p_width: stored.width,
            p_height: stored.height,
            p_mime_type: stored.mime,
          })
          if (error) throw error
          results.push({ image_url: originalUrl, stored_url: stored.storedUrl, status: 'stored', updated: data?.length || 0 })
        } catch (error) {
          results.push({ image_url: originalUrl, status: 'failed', error: error instanceof Error ? error.message : 'Could not store image.' })
        }
      }
      return reply({ results })
    } catch (error) {
      return reply({ error: error instanceof Error ? error.message : 'Could not persist approved images.' }, 400)
    }
  }
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
      return reply({ batch: await latestBatch(db) })
    }
    if (body.action === 'bootstrap') {
      const batch = await latestBatch(db)
      if (!batch) return reply({ batch: null, proposals: [], total: 0, next: null })
      return reply({ batch, ...(await loadQueuePage(db, batch.batch_id, 0, 200, true)) })
    }
    if (typeof body.batch_id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(body.batch_id)) return reply({ error: 'Invalid batch.' }, 400)
    if (body.action === 'list') {
      return reply(await loadQueuePage(db, body.batch_id, body.offset, body.limit, body.include_total !== false))
    }
    if (body.action === 'prepare') {
      const ids = Array.isArray(body.activity_ids)
        ? [...new Set(body.activity_ids.filter(validId))].slice(0, 4)
        : []
      if (!ids.length) return reply({ prepared: [] })
      const { data: proposals, error } = await table.select('activity_id,selected_image')
        .eq('batch_id', body.batch_id).eq('decision', 'pending').in('activity_id', ids)
      if (error) throw error
      const prepared = await Promise.all((proposals || []).map(async (proposal) => {
        const originalUrl = String(proposal.selected_image?.image_url || '')
        if (!originalUrl) return { activity_id: proposal.activity_id, status: 'no_image' }
        try {
          const stored = await persistApprovedPhoto(db, originalUrl)
          return { activity_id: proposal.activity_id, original_url: originalUrl,
            stored_url: stored.storedUrl, status: 'ready' }
        } catch (error) {
          return { activity_id: proposal.activity_id, original_url: originalUrl, status: 'failed',
            error: error instanceof Error ? error.message : 'Could not prepare image.' }
        }
      }))
      return reply({ prepared })
    }
    if (!validId(body.activity_id)) return reply({ error: 'Invalid activity.' }, 400)
    if (body.action === 'detail') {
      const { data: proposal, error } = await table.select(detailFields).eq('batch_id', body.batch_id).eq('activity_id', body.activity_id).maybeSingle()
      if (error) throw error
      if (!proposal) return reply({ error: 'Proposal not found.' }, 404)
      return reply({ proposal })
    }
    if (body.action === 'alternatives') {
      const { data: proposal, error } = await table.select('proposal_hash,alternatives')
        .eq('batch_id', body.batch_id).eq('activity_id', body.activity_id).maybeSingle()
      if (error) throw error
      if (!proposal) return reply({ error: 'Proposal not found.' }, 404)
      if (body.proposal_hash && body.proposal_hash !== proposal.proposal_hash) {
        return reply({ error: 'The proposal changed. Refresh it first.' }, 409)
      }
      return reply(proposalAlternativePage(proposal, body.offset, body.limit))
    }
    if (body.action === 'submit_url') {
      const { data: proposal, error } = await table.select('*').eq('batch_id', body.batch_id).eq('activity_id', body.activity_id).maybeSingle()
      if (error) throw error
      if (!proposal) return reply({ error: 'Proposal not found.' }, 404)
      if (body.proposal_hash !== proposal.proposal_hash) return reply({ error: 'The proposal changed. Refresh it first.' }, 409)
      const originalUrl = publicImageUrl(body.image_url).href
      const existing = [proposal.selected_image, ...(proposal.alternatives || [])].find(
        (candidate) => candidate?.submitted_original_url === originalUrl,
      )
      if (existing) return reply({ proposal: proposalSummary(proposal), candidate: existing })
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
        return reply({ proposal: proposalSummary(saved), candidate: savedCandidate })
      } catch (submissionError) {
        await db.storage.from('activity-images').remove([path])
        throw submissionError
      }
    }
    if (body.action !== 'decide') return reply({ error: 'Unknown action.' }, 400)
    if (!['approved', 'rejected', 'unsure'].includes(body.decision)) return reply({ error: 'Choose approve, reject, or unsure.' }, 400)
    if (body.decision === 'approved') {
      let imageUrl = ''
      try {
        const parsed = new URL(body.image_url)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw Error()
        imageUrl = body.image_url
      } catch {
        return reply({ error: 'Approve only an image from this proposal.' }, 400)
      }
      const stored = await persistApprovedPhoto(db, imageUrl)
      const approvalRpc = isDurableActivityImageUrl(imageUrl)
        ? db.rpc('approve_model_image_url_across_sessions', {
          p_batch_id: body.batch_id,
          p_activity_id: body.activity_id,
          p_proposal_hash: body.proposal_hash,
          p_image_url: imageUrl,
          p_reviewer: auth.user.id,
        })
        : db.rpc('approve_persisted_model_image_url_across_sessions', {
          p_batch_id: body.batch_id,
          p_activity_id: body.activity_id,
          p_proposal_hash: body.proposal_hash,
          p_original_image_url: imageUrl,
          p_stored_image_url: stored.storedUrl,
          p_storage_path: stored.storagePath,
          p_width: stored.width,
          p_height: stored.height,
          p_mime_type: stored.mime,
          p_reviewer: auth.user.id,
        })
      const { data: updates, error: approvalError } = await approvalRpc
      if (approvalError) throw approvalError
      const savedUpdates = updates || []
      if (!savedUpdates.some((item: { updated_activity_id: string }) => item.updated_activity_id === body.activity_id)) {
        throw Error('The approval was not saved. Refresh this proposal.')
      }
      const sourceUpdate = savedUpdates.find((item: { updated_activity_id: string }) => item.updated_activity_id === body.activity_id)
      return reply({ saved: true, review: { decision: 'approved', chosen_image: sourceUpdate!.approved_image },
        updated_proposals: savedUpdates.map((item: { updated_activity_id: string; approved_image: unknown }) => ({
          activity_id: item.updated_activity_id, decision: 'approved', chosen_image: item.approved_image,
        })),
        propagated_count: savedUpdates.length - 1, live_image_unchanged: false })
    }
    const { data: saved, error: saveError } = await table.update({
      decision: body.decision, chosen_image: null,
      reviewed_by: auth.user.id, reviewed_at: new Date().toISOString(),
    }).eq('batch_id', body.batch_id).eq('activity_id', body.activity_id)
      .eq('proposal_hash', body.proposal_hash)
      .select('decision,chosen_image,reviewed_at').maybeSingle()
    if (saveError) throw saveError
    if (!saved) return reply({ error: 'The proposal changed. Refresh it first.' }, 409)
    return reply({ saved: true, review: saved })
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Could not complete image review.' }, 400)
  }
})
