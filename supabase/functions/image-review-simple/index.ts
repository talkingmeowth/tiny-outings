import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jpegDimensions } from './jpeg.js'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const admins = new Set(['talkingmeowth06@gmail.com', 'talkingmeowtho6@gmail.com', 'benfielden@gmail.com'])
const columns = 'activity_id,activity_name,category,address,postcode,borough,website,organiser_website,source_url,source_name,public_listing_status,archive,admin_cover_image_url,reviewed_image_url,user_image_url,use_category_image,model_selected_url,model_selected_confidence,image_review_approved_at,image_review_approved_url,image_review_approved_source_field,created_at,updated_at'
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sign in as an administrator.' }, 401)
  const { data: auth, error: authError } = await db.auth.getUser(token)
  if (authError || !auth.user) return json({ error: 'Your session expired. Sign in again.' }, 401)
  if (!auth.user.email_confirmed_at || !admins.has((auth.user.email || '').toLowerCase())) return json({ error: 'Administrator access required.' }, 403)
  try {
    if (Number(request.headers.get('content-length')) > 12000000) return json({ error: 'Upload too large.' }, 413)
    const raw = await request.text()
    if (raw.length > 12000000) return json({ error: 'Upload too large.' }, 413)
    const body = JSON.parse(raw)
    if (body.action === 'list') {
      const offset = Math.max(0, Math.min(100000, Math.floor(Number(body.offset) || 0)))
      const { data: activities, error } = await db.from('activities').select(columns).eq('archive', false)
        .in('public_listing_status', ['draft','published']).order('activity_id').range(offset, offset + 299)
      if (error) throw error
      const ids = (activities || []).map((a) => a.activity_id)
      const { data: photos, error: photoError } = ids.length ? await db.from('activity_photos').select('activity_id,photo_url,created_at')
        .in('activity_id', ids).eq('source_provider', 'user_upload').order('created_at', { ascending: false }) : { data: [], error: null }
      if (photoError) throw photoError
      return json({ activities: activities?.map((a) => ({ ...a, user_uploaded_image_url: photos?.find((p) => p.activity_id === a.activity_id)?.photo_url || null })), next: activities?.length === 300 ? offset + 300 : null })
    }
    if (!/^[0-9a-f-]{36}$/i.test(body.activity_id || '')) return json({ error: 'Choose a valid listing.' }, 400)
    const { data: activity, error } = await db.from('activities').select('*').eq('activity_id', body.activity_id).eq('archive', false).single()
    if (error || !activity) return json({ error: 'Listing not found.' }, 404)
    if (body.action === 'detail') {
      const { data: photos, error: photoError } = await db.from('activity_photos').select('photo_url,created_at').eq('activity_id', body.activity_id).eq('source_provider', 'user_upload').order('created_at', { ascending: false })
      if (photoError) throw photoError
      return json({ activity: { ...activity, user_uploaded_image_url: photos?.[0]?.photo_url || null, user_uploaded_image_candidates: photos?.map((p) => ({ image_url: p.photo_url, title: 'Uploaded activity photo' })) || [] } })
    }
    if (body.action !== 'upload') return json({ error: 'Unknown action.' }, 400)
    if (activity.updated_at !== body.expected_updated_at) return json({ error: 'Listing changed. Refresh before saving.' }, 409)
    if (typeof body.jpeg_base64 !== 'string' || body.jpeg_base64.length > 11000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.jpeg_base64)) return json({ error: 'Invalid upload.' }, 400)
    const bytes = Uint8Array.from(atob(body.jpeg_base64), (c) => c.charCodeAt(0))
    if (bytes.length > 8 * 1024 * 1024) return json({ error: 'Photo exceeds 8MB.' }, 413)
    const dimensions = jpegDimensions(bytes)
    const path = `reviewed/uploads/${activity.activity_id}/${crypto.randomUUID()}.jpg`
    const upload = await db.storage.from('activity-images').upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
    if (upload.error) throw upload.error
    const imageUrl = db.storage.from('activity-images').getPublicUrl(path).data.publicUrl
    const { error: saveError } = await db.rpc('save_manual_image_upload', { p_activity_id: activity.activity_id, p_user_id: auth.user.id, p_image_url: imageUrl,
      p_expected_updated_at: body.expected_updated_at, p_candidate: { image_url: imageUrl, source_label: 'Manual upload', selection_kind: 'manual_upload', ...dimensions } })
    if (saveError) { await db.storage.from('activity-images').remove([path]); throw saveError }
    return json({ saved: true, reviewedImageUrl: imageUrl })
  } catch (e) { return json({ error: e instanceof Error ? e.message : String((e as { message?: string })?.message || 'Could not save this image.') }, 400) }
})
