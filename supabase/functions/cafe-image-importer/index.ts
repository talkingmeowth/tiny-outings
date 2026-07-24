import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async () => {
  await supabase.storage.createBucket('activity-images', { public: true }).catch(() => {})

  const query = await supabase
    .from('activities')
    .select('activity_id,activity_name,address')
    .eq('category', 'Child-friendly cafes')
    .or('image_url.is.null,image_url.eq.')
    .limit(10)

  if (query?.error) return Response.json({ error: query.error.message }, { status: 500 })

  const results = []
  for (const row of query?.data ?? []) {
    const q = encodeURIComponent(`${row.activity_name} ${row.address ?? ''} venue`)
    try {
      const search = await fetch(`https://serpapi.com/search.json?engine=google_images&q=${q}&tbs=itp:photo&api_key=${Deno.env.get('SERPAPI_API_KEY')}`)
      const body = await search.json()
      let updated = false

      for (const source of (body.images_results ?? []).slice(0, 5).map((item: { original?: string }) => item.original).filter(Boolean) as string[]) {
        try {
          const image = await fetch(source)
          if (!image.ok) continue
          const path = `cafes/${row.activity_id}.jpg`
          const upload = await supabase.storage.from('activity-images').upload(path, new Uint8Array(await image.arrayBuffer()), {
            contentType: image.headers.get('content-type') ?? 'image/jpeg',
            upsert: true,
          })
          if (!upload || upload.error) continue
          const imageUrl = supabase.storage.from('activity-images').getPublicUrl(path).data.publicUrl
          await supabase.from('activities').update({ image_url: imageUrl, scraped_image_url: imageUrl, image_source_url: source, updated_at: new Date().toISOString() }).eq('activity_id', row.activity_id)
          results.push({ id: row.activity_id, status: 'updated' })
          updated = true
          break
        } catch (_) {}
      }
      if (!updated) results.push({ id: row.activity_id, status: 'failed' })
    } catch (_) {
      results.push({ id: row.activity_id, status: 'failed' })
    }
  }
  return Response.json({ processed: results.length, results })
})
