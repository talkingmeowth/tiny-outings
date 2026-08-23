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
const maxImageBytes = 8 * 1024 * 1024
const maxBatchSize = 20
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const blockedImageTerms = /(favicon|icon|wordmark|site-logo|social[-_ ]?(?:icon|link|media)|facebook|fbcdn|scontent|cdninstagram|instagram|twitter|twimg|tiktok|linkedin|pinterest|youtube|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play|\/flags\/|site-flag|country-selector|language-selector)/i
const ignoredTitleWords = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'london', 'class', 'classes', 'club', 'activity', 'activities', 'family', 'families', 'children', 'child', 'baby', 'babies', 'toddler', 'toddlers'])

type SearchImage = {
  original?: string
  thumbnail?: string
  title?: string
  source?: string
  link?: string
}

type Activity = {
  activity_id: string
  activity_name: string
  address: string | null
  category: string | null
  website: string | null
  organiser_website: string | null
  scraped_image_url: string | null
  image_source_url: string | null
}

type SerpApiAssessment = 'updated' | 'no-usable-image' | 'retained-existing-venue-image'
type ReplacementMode = 'logo_to_venue' | 'cafe_venue_photo'
type StoredImage = {
  publicUrl: string
  sourceUrl: string
  confidence: ReturnType<typeof imageConfidence>
}
type ImageSearchDiagnostics = {
  searches: number
  raw_candidates: number
  usable_urls: number
  high_confidence: number
  unblocked: number
  eligible_candidates: number
  download_attempts: number
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
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

function normalisedText(value: string | undefined | null) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function significantTitleWords(activityName: string) {
  return [...new Set(normalisedText(activityName).split(' ')
    .filter((word) => word.length > 2 && !ignoredTitleWords.has(word)))]
}

function hostRoot(value: string | undefined | null) {
  try {
    const labels = new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '').split('.')
    if (labels.length < 2) return labels.join('.')
    // Keep the organisation part of UK domains such as example.co.uk.
    return labels.slice(labels.at(-2) === 'uk' && labels.at(-3) ? -3 : -2).join('.')
  } catch {
    return ''
  }
}

function imageSearchHost(activity: Activity) {
  const candidates = [activity.organiser_website, activity.website]
    .map(hostRoot)
    .filter((host) => host && !/(linktr\.ee|happity\.co\.uk)$/.test(host))
  return candidates[0] || hostRoot(activity.website)
}

function candidateText(image: SearchImage) {
  return [image.original, image.title, image.source, image.link].filter(Boolean).join(' ').toLowerCase()
}

function isOfficialCandidate(image: SearchImage, activity: Activity) {
  const officialHosts = [activity.website, activity.organiser_website]
    .map(hostRoot)
    .filter(Boolean)
  if (!officialHosts.length) return false
  return [image.original, image.link]
    .map(hostRoot)
    .some((host) => host && officialHosts.includes(host))
}

function imageConfidence(image: SearchImage, activity: Activity) {
  const text = candidateText(image)
  const title = normalisedText(activity.activity_name)
  const words = significantTitleWords(activity.activity_name)
  const matchingWords = words.filter((word) => text.includes(word))
  const exactTitle = title.length >= 7 && text.includes(title)
  const official = isOfficialCandidate(image, activity)
  const score = (exactTitle ? 72 : 0)
    + Math.min(54, matchingWords.length * 27)
    + (official ? 48 : 0)

  // Search results can include visually suitable images for a different venue.
  // Google Images captions alone are not sufficient evidence. Keep the card
  // image tied to a listing or organiser domain, then require a full title or
  // at least two distinctive activity words. This deliberately favours a
  // missing image over showing parents the wrong venue.
  const highConfidence = official && (exactTitle || matchingWords.length >= 2)
  return { highConfidence, score, matchingWords, official }
}

function venueImageProfile(activity: Activity) {
  const category = String(activity.category || '').toLowerCase()
  // "Play cafes" deliberately follow the same visual hierarchy as cafes.
  if (/play[ -]?cafe|cafe|coffee|bakery|restaurant|food/.test(category)) return 'cafe'
  if (/museum|culture|bookshop|book store|bookstore/.test(category)) return 'exterior-first'
  return null
}

function venuePhotoPreference(image: SearchImage, profile: ReturnType<typeof venueImageProfile>) {
  const text = candidateText(image)
  const isInterior = /(interior|inside|dining[ -]?room|seating|coffee[ -]?bar|cafe[ -]?space|venue[ -]?space|tables?|play[ -]?space)/.test(text)
  const isExterior = /(front|exterior|facade|shopfront|storefront|outside|street|building)/.test(text)
  if (profile === 'cafe') {
    if (isInterior) return 1000
    if (isExterior) return 800
  } else if (profile === 'exterior-first') {
    if (isExterior) return 1000
    if (isInterior) return 800
  }
  return 0
}

function hasBlockedCandidateCue(image: SearchImage) {
  return blockedImageTerms.test(candidateText(image))
    || /(logo|brand|wordmark|menu|flyer|poster|profile)/.test(candidateText(image))
}

function isVenuePhotoCandidate(image: SearchImage, activity: Activity) {
  return venuePhotoPreference(image, venueImageProfile(activity)) > 0 || isOfficialCandidate(image, activity)
}

function hasExistingVenuePhoto(activity: Activity) {
  const text = [activity.scraped_image_url, activity.image_source_url]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return /(front|exterior|facade|shopfront|storefront|outside|street|building|interior|inside|dining[ -]?room|seating|coffee[ -]?bar|cafe[ -]?space|venue[ -]?space|tables?|play[ -]?space)/.test(text)
}

function imageScore(image: SearchImage, activity: Activity, replacementMode?: ReplacementMode) {
  const text = [image.original, image.title, image.source, image.link].filter(Boolean).join(' ').toLowerCase()
  const confidence = imageConfidence(image, activity)
  const profile = venueImageProfile(activity)
  let score = confidence.score
  const isInterior = /(interior|inside|dining[ -]?room|seating|coffee[ -]?bar|cafe[ -]?space|venue[ -]?space|tables?)/.test(text)
  const isExterior = /(front|exterior|facade|shopfront|storefront|outside|street)/.test(text)
  if (profile === 'cafe' && isInterior) score += 600
  else if (profile === 'cafe' && isExterior) score += 450
  else if (profile === 'cafe' && /(food|dish|cake|brunch|pastry|drink|kitchen)/.test(text)) score += 100
  else if (profile === 'exterior-first' && isExterior) score += 600
  else if (profile === 'exterior-first' && isInterior) score += 450
  if (replacementMode === 'logo_to_venue' || replacementMode === 'cafe_venue_photo') {
    score += venuePhotoPreference(image, profile)
  }
  if (/(logo|brand|wordmark|menu|flyer|poster|facebook|fbcdn|scontent|cdninstagram|instagram|twitter|twimg|linkedin|profile)/.test(text)) score -= 100
  if (/(thumb|thumbnail|150x150|200x200|300x300|avatar|default)/.test(text)) score -= 45
  return score
}

function existingImageScore(activity: Activity) {
  if (!activity.scraped_image_url) return Number.NEGATIVE_INFINITY
  const text = [activity.scraped_image_url, activity.image_source_url, activity.activity_name, activity.category]
    .filter(Boolean).join(' ').toLowerCase()
  const profile = venueImageProfile(activity)
  let score = 0
  const isInterior = /(interior|inside|dining[ -]?room|seating|coffee[ -]?bar|cafe[ -]?space|venue[ -]?space|tables?)/.test(text)
  const isExterior = /(front|exterior|facade|shopfront|storefront|outside|street)/.test(text)
  if (profile === 'cafe' && isInterior) score += 600
  else if (profile === 'cafe' && isExterior) score += 450
  else if (profile === 'cafe' && /(food|dish|cake|brunch|pastry|drink|kitchen)/.test(text)) score += 100
  else if (profile === 'exterior-first' && isExterior) score += 600
  else if (profile === 'exterior-first' && isInterior) score += 450
  if (/(logo|brand|wordmark|menu|flyer|poster|facebook|instagram|twitter|linkedin|profile)/.test(text)) score -= 100
  if (/(thumb|thumbnail|150x150|200x200|300x300|avatar|default)/.test(text)) score -= 45
  return score
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

async function findAndStoreImage(
  supabase: ReturnType<typeof createClient>,
  activity: Activity,
  replacementMode?: ReplacementMode,
  forceVenueRefresh = false,
): Promise<{ image: StoredImage | null, diagnostics: ImageSearchDiagnostics, retainedExistingVenueImage?: boolean }> {
  const apiKey = Deno.env.get('SERPAPI_API_KEY')
  if (!apiKey) throw new Error('SERPAPI_API_KEY is not configured.')

  const profile = venueImageProfile(activity)
  const isCafe = profile === 'cafe'
  const venuePhotoReplacement = replacementMode === 'logo_to_venue'
    || (replacementMode === 'cafe_venue_photo' && isCafe)
  const diagnostics: ImageSearchDiagnostics = {
    searches: 0,
    raw_candidates: 0,
    usable_urls: 0,
    high_confidence: 0,
    unblocked: 0,
    eligible_candidates: 0,
    download_attempts: 0,
  }

  // This full audit leaves confirmed venue photos alone. It spends SerpAPI
  // searches only on cards whose current visual treatment is uncertain.
  if (replacementMode === 'cafe_venue_photo' && !forceVenueRefresh && hasExistingVenuePhoto(activity)) {
    return { image: null, diagnostics, retainedExistingVenueImage: true }
  }

  // URL captions rarely say "exterior" even for a clear building photo. Run
  // targeted searches in the card-image order: interior, exterior, then food
  // only as a final fallback. Logos, menus, and social graphics are rejected.
  const officialHost = imageSearchHost(activity)
  const officialSite = officialHost ? ` site:${officialHost}` : ''
  const interiorSearchPlan = {
    kind: 'interior',
    query: `"${activity.activity_name}" ${activity.address || 'London'} venue interior${officialSite}`,
    preference: profile === 'cafe' ? 1000 : 800,
  }
  const exteriorSearchPlan = {
    kind: 'exterior',
    query: `"${activity.activity_name}" ${activity.address || 'London'} building exterior${officialSite}`,
    preference: profile === 'cafe' ? 800 : 1000,
  }
  const venueSearchPlans = profile === 'cafe'
    ? [interiorSearchPlan, exteriorSearchPlan]
    : [exteriorSearchPlan, interiorSearchPlan]
  const foodFallbackPlan = {
    kind: 'food',
    query: `"${activity.activity_name}" ${activity.address || 'London'} cafe food${officialSite}`,
    preference: 100,
  }
  const searchPlans = profile
    ? replacementMode === 'cafe_venue_photo'
      ? venueSearchPlans
      : [...venueSearchPlans, foodFallbackPlan]
    : venuePhotoReplacement
      ? venueSearchPlans
      : [{
        kind: 'default',
        // Other categories favour a useful venue photograph, while the
        // confidence scorer requires a strong title or official-site match.
        query: `"${activity.activity_name}" ${activity.address || 'London'} ${activity.category || 'family activity'} venue photo`,
        preference: 0,
      }]
  const existingScore = existingImageScore(activity)

  for (const plan of searchPlans) {
    const searchUrl = new URL('https://serpapi.com/search.json')
    searchUrl.searchParams.set('engine', 'google_images')
    searchUrl.searchParams.set('q', plan.query)
    searchUrl.searchParams.set('location', 'London, England, United Kingdom')
    searchUrl.searchParams.set('tbs', 'itp:photo')
    searchUrl.searchParams.set('api_key', apiKey)
    const search = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) })
    if (search.status === 429) throw new SerpApiRateLimitError('SerpAPI rate limit reached.')
    if (!search.ok) throw new Error(`SerpAPI returned ${search.status}.`)
    const body = await search.json()
    diagnostics.searches += 1
    const rawCandidates = Array.isArray(body.images_results) ? body.images_results : []
    diagnostics.raw_candidates += rawCandidates.length
    const usableCandidates = rawCandidates.filter((image: SearchImage) => usableImageUrl(image.original))
    diagnostics.usable_urls += usableCandidates.length
    const confidentCandidates = usableCandidates.filter((image: SearchImage) => (
      imageConfidence(image, activity).highConfidence
    ))
    diagnostics.high_confidence += confidentCandidates.length
    const unblockedCandidates = confidentCandidates
      .filter((image: SearchImage) => !hasBlockedCandidateCue(image))
      .filter((image: SearchImage) => !venuePhotoReplacement || (
        plan.kind === 'food' || isVenuePhotoCandidate(image, activity)
      ))
    diagnostics.unblocked += unblockedCandidates.length
    const candidates = unblockedCandidates
      .sort((left: SearchImage, right: SearchImage) => (
        imageScore(right, activity, replacementMode) + plan.preference
        - imageScore(left, activity, replacementMode) - plan.preference
      ))
      .filter((image: SearchImage) => imageScore(image, activity, replacementMode) + plan.preference > existingScore)
      .slice(0, 5) as SearchImage[]
    diagnostics.eligible_candidates += candidates.length

    for (const candidate of candidates) {
      if (!candidate.original) continue
      // Some venue websites block a server-side fetch of their original image.
      // SerpAPI's thumbnail is a photo rendition of the same result and is used
      // only as a fallback, after the original URL, so logos are not retained.
      const downloadUrls = [...new Set([candidate.original, candidate.thumbnail].filter(usableImageUrl))]
      for (const downloadUrl of downloadUrls) {
        try {
          diagnostics.download_attempts += 1
          const image = await fetch(downloadUrl, {
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
            headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
          })
          const contentType = (image.headers.get('content-type') || '').split(';')[0].toLowerCase()
          const declaredSize = Number(image.headers.get('content-length') || 0)
          if (!image.ok || !acceptedMimeTypes.has(contentType) || (declaredSize && declaredSize > maxImageBytes)) continue
          const bytes = new Uint8Array(await image.arrayBuffer())
          if (bytes.byteLength < 5 * 1024 || bytes.byteLength > maxImageBytes) continue

          const path = `serpapi/cafes/${activity.activity_id}.${extensionFor(contentType, downloadUrl)}`
          const upload = await supabase.storage.from('activity-images').upload(path, bytes, {
            contentType,
            cacheControl: '31536000',
            upsert: true,
          })
          if (upload.error) continue
          return {
            image: {
              publicUrl: supabase.storage.from('activity-images').getPublicUrl(path).data.publicUrl,
              sourceUrl: candidate.original,
              confidence: imageConfidence(candidate, activity),
            },
            diagnostics,
          }
        } catch {
          // Try the original or thumbnail counterpart when a host blocks one.
        }
      }

      // Keep the original result as provenance, but use SerpAPI's cached photo
      // rendition only after every downloadable source URL failed. This avoids
      // leaving an identified logo on a card because an image host blocks bots.
      if (candidate.thumbnail && usableImageUrl(candidate.thumbnail)) {
        return {
          image: {
            publicUrl: candidate.thumbnail,
            sourceUrl: candidate.original,
            confidence: imageConfidence(candidate, activity),
          },
          diagnostics,
        }
      }
    }
  }
  return { image: null, diagnostics }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  if (!(await authorised(request, supabase))) return jsonResponse({ error: 'Only Tiny Outings administrators or the update job can refresh activity images.' }, 403)

  const body = await request.json().catch(() => ({})) as {
    cursor?: string
    batch_size?: number
    scope?: 'all' | 'cafes'
    refresh_existing?: boolean
    activity_ids?: string[]
    replacement_mode?: ReplacementMode
    force_venue_refresh?: boolean
  }
  const batchSize = Math.min(Math.max(Number(body.batch_size) || maxBatchSize, 1), maxBatchSize)
  const scope = body.scope === 'cafes' ? 'cafes' : 'all'
  const refreshExisting = body.refresh_existing === true
  const replacementMode = body.replacement_mode === 'logo_to_venue' || body.replacement_mode === 'cafe_venue_photo'
    ? body.replacement_mode
    : undefined
  const forceVenueRefresh = body.force_venue_refresh === true && replacementMode === 'cafe_venue_photo'
  await supabase.storage.createBucket('activity-images', { public: true }).catch(() => {})

  let query = supabase
    .from('activities')
    .select('activity_id,activity_name,address,category,website,organiser_website,scraped_image_url,image_source_url')
    .in('public_listing_status', ['draft', 'published'])
    .eq('archive', false)
    .order('activity_id', { ascending: true })
    .limit(batchSize)
  const activityIds = [...new Set((body.activity_ids || []).filter((value) => typeof value === 'string' && value.length > 0))]
    .slice(0, maxBatchSize)
  if (scope === 'cafes') query = query.or('category.ilike.%cafe%,category.ilike.%food%')
  if (!refreshExisting && !activityIds.length) {
    // Each new activity receives one vetted SerpAPI assessment, even when an
    // importer has already supplied an official image. The assessment marker
    // avoids re-searching existing cards on every recurring update.
    query = query.is('serpapi_image_checked_at', null)
  }
  if (activityIds.length) query = query.in('activity_id', activityIds)
  else if (body.cursor) query = query.gt('activity_id', body.cursor)

  const { data: activities, error } = await query
  if (error) return jsonResponse({ error: error.message }, 500)

  const results = await mapWithConcurrency(activities || [], 4, async (activity) => {
    try {
      const imageSearch = await findAndStoreImage(supabase, activity, replacementMode, forceVenueRefresh)
      const image = imageSearch.image
      const assessment: SerpApiAssessment = image
        ? 'updated'
        : imageSearch.retainedExistingVenueImage
          ? 'retained-existing-venue-image'
          : 'no-usable-image'
      const { error: updateError } = await supabase.from('activities').update({
        // Admin and parent image choices remain higher priority in the app.
        ...(image ? {
          scraped_image_url: image.publicUrl,
          image_source_url: image.sourceUrl,
        } : {}),
        // Persist a completed assessment even when no result meets the quality
        // bar. Failed and rate-limited calls are intentionally left pending.
        serpapi_image_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('activity_id', activity.activity_id)
      return updateError
        ? { activity_id: activity.activity_id, status: 'update-failed', reason: updateError.message }
        : image
          ? { activity_id: activity.activity_id, status: assessment, source_url: image.sourceUrl, confidence: image.confidence.score, diagnostics: imageSearch.diagnostics }
          : { activity_id: activity.activity_id, status: assessment, diagnostics: imageSearch.diagnostics }
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
    updated: results.filter((result) => result.status === 'updated').length,
    rate_limited: results.filter((result) => result.status === 'rate-limited').length,
    scope,
    refresh_existing: refreshExisting,
    replacement_mode: replacementMode || null,
    force_venue_refresh: forceVenueRefresh,
    next_cursor: activityIds.length ? null : activities?.length === batchSize ? last?.activity_id || null : null,
    results,
  })
})
