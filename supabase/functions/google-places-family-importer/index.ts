import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const adminEmails = new Set([
  'talkingmeowth06@gmail.com',
  'talkingmeowtho6@gmail.com',
  'benfielden@gmail.com',
])

const londonZones = [
  { name: 'Walthamstow', latitude: 51.583, longitude: -0.02 },
  { name: 'Leyton and Leytonstone', latitude: 51.562, longitude: -0.001 },
  { name: 'Hackney', latitude: 51.545, longitude: -0.055 },
  { name: 'Stoke Newington', latitude: 51.562, longitude: -0.075 },
  { name: 'Islington', latitude: 51.536, longitude: -0.103 },
  { name: 'Stratford and Newham', latitude: 51.541, longitude: 0.003 },
  { name: 'Camden', latitude: 51.539, longitude: -0.142 },
  { name: 'Southwark', latitude: 51.503, longitude: -0.09 },
  { name: 'Brixton', latitude: 51.462, longitude: -0.115 },
  { name: 'Notting Hill', latitude: 51.512, longitude: -0.205 },
  { name: 'Ealing', latitude: 51.513, longitude: -0.304 },
  { name: 'Richmond', latitude: 51.46, longitude: -0.303 },
  { name: 'Harrow', latitude: 51.581, longitude: -0.337 },
  { name: 'Enfield', latitude: 51.652, longitude: -0.081 },
  { name: 'Hampstead and Finchley', latitude: 51.582, longitude: -0.19 },
  { name: 'Hammersmith and Fulham', latitude: 51.49, longitude: -0.235 },
  { name: 'Greenwich', latitude: 51.482, longitude: 0.006 },
  { name: 'Lewisham and Bromley', latitude: 51.436, longitude: -0.018 },
  { name: 'Croydon', latitude: 51.375, longitude: -0.102 },
  { name: 'Kingston and Wimbledon', latitude: 51.41, longitude: -0.245 },
]

const profiles = {
  play_cafes: {
    id: 'play_cafes',
    label: 'baby and child friendly play cafes',
    category: 'Child-friendly cafes',
    sourceName: 'Google Places baby and child friendly play cafes importer',
    queries: ['baby friendly cafe', 'child friendly play cafe', 'soft play cafe'],
    description: 'A cafe or play cafe found through Google Places for a relaxed outing with babies and young children.',
    cost: 'Cafe purchases or play session fees',
    bookingRequired: false,
  },
  baby_swim: {
    id: 'baby_swim',
    label: 'baby swim activities',
    category: 'Baby swimming',
    sourceName: 'Google Places baby swim activities importer',
    queries: ['baby swimming classes', 'baby swim lessons', 'parent and baby swimming'],
    description: 'A baby or parent and child swimming activity found through Google Places. Check the provider for class times and booking.',
    cost: 'Check provider for prices',
    bookingRequired: true,
  },
  baby_sensory: {
    id: 'baby_sensory',
    label: 'baby sensory activities',
    category: 'Baby sensory',
    sourceName: 'Google Places baby sensory activities importer',
    queries: ['baby sensory classes', 'baby sensory play', 'sensory classes for babies'],
    description: 'A baby sensory activity found through Google Places. Check the provider for session times and booking.',
    cost: 'Check provider for prices',
    bookingRequired: true,
  },
} as const

type ImporterId = keyof typeof profiles
type Profile = (typeof profiles)[ImporterId]
type GooglePlace = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  googleMapsUri?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  primaryType?: string
  types?: string[]
  regularOpeningHours?: {
    periods?: Array<{
      open?: { day?: number; hour?: number; minute?: number }
      close?: { day?: number; hour?: number; minute?: number }
    }>
    weekdayDescriptions?: string[]
  }
  businessStatus?: string
  goodForChildren?: boolean
  editorialSummary?: { text?: string }
}

type ExistingActivity = {
  activity_id: string
  activity_name: string
  address: string
  postcode: string | null
  google_place_id: string | null
  source_url: string | null
}

type PreparedActivity = Record<string, unknown>

const detailFieldMask = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'googleMapsUri',
  'websiteUri',
  'rating',
  'userRatingCount',
  'primaryType',
  'types',
  'regularOpeningHours',
  'businessStatus',
  'goodForChildren',
  'editorialSummary',
].join(',')

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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

function text(value: unknown) {
  return String(value || '').trim()
}

function normalized(value: unknown) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function postcode(value: unknown) {
  return text(value).match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0]?.toUpperCase() || null
}

function sourceUrl(placeId: string) {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
}

function officialWebsiteUrl(value: unknown) {
  try {
    const url = new URL(String(value || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (
      host === 'google.com'
      || host === 'google.co.uk'
      || host.endsWith('.google.com')
      || host.endsWith('.google.co.uk')
      || host === 'maps.app.goo.gl'
    ) return null
    return url.toString()
  } catch {
    return null
  }
}

function isGreaterLondon(location: GooglePlace['location']) {
  const latitude = Number(location?.latitude)
  const longitude = Number(location?.longitude)
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= 51.28
    && latitude <= 51.72
    && longitude >= -0.56
    && longitude <= 0.35
}

function boroughForAddress(address: string) {
  const value = address.toUpperCase()
  if (/\b(E4|E10|E11|E17)\b/.test(value)) return 'Waltham Forest'
  if (/\b(E2|E5|E8|E9|N16)\b/.test(value)) return 'Hackney'
  if (/\b(N1|N5|N7|N19|EC1)\b/.test(value)) return 'Islington'
  if (/\b(E6|E7|E12|E13|E15|E16|E20)\b/.test(value)) return 'Newham'
  return 'London'
}

function availability(hours: GooglePlace['regularOpeningHours']) {
  const openDays = new Set<string>()
  const starts: string[] = []
  const ends: string[] = []
  for (const period of hours?.periods || []) {
    if (period.open?.day !== undefined) openDays.add(dayNames[period.open.day])
    if (period.open?.hour !== undefined) starts.push(`${String(period.open.hour).padStart(2, '0')}:${String(period.open.minute || 0).padStart(2, '0')}`)
    if (period.close?.hour !== undefined) ends.push(`${String(period.close.hour).padStart(2, '0')}:${String(period.close.minute || 0).padStart(2, '0')}`)
  }
  const days = [...openDays].filter(Boolean)
  const start = starts.sort()[0] || null
  const finalEnd = ends.sort().at(-1) || null
  return {
    days,
    start,
    end: finalEnd && start && finalEnd <= start ? '23:59' : finalEnd,
    type: days.length === 7 ? 'daily' : days.length ? 'weekly' : 'unknown',
    notes: hours?.weekdayDescriptions?.join(' | ') || 'Check the provider for current times and availability.',
  }
}

function placeText(place: GooglePlace) {
  return normalized([
    place.displayName?.text,
    place.editorialSummary?.text,
    place.websiteUri,
    place.primaryType,
    ...(place.types || []),
  ].join(' '))
}

function isFamilyCafe(place: GooglePlace) {
  const name = normalized(place.displayName?.text)
  const types = normalized([place.primaryType, ...(place.types || [])].join(' '))
  const rating = Number(place.rating || 0)
  const reviews = Number(place.userRatingCount || 0)
  if (place.businessStatus === 'CLOSED_PERMANENTLY') return false
  if (/\b(bar|bar and grill|pub|night club|casino|liquor store|dog cafe)\b/.test(types)) return false
  if ([
    'elite cafe',
    'forest bistro cafe 1',
    'goods office',
    'park brew and kitchen',
    'cuppapug',
    'stone mini market',
    'yardarm',
  ].includes(name)) return false
  if (!/\b(cafe|coffee|bakery|restaurant|amusement center|playground)\b/.test(types)) return false
  if (reviews >= 10 && rating > 0 && rating < 3.8) return false
  return true
}

function hasProfileSignal(place: GooglePlace, profile: Profile) {
  const value = placeText(place)
  if (profile.id === 'play_cafes') {
    return place.goodForChildren === true || /\b(baby|child|children|kid|kids|toddler|family|play cafe|soft play|play)\b/.test(value)
  }
  if (profile.id === 'baby_swim') {
    return /\b(baby|toddler|infant|parent child|water babies|puddle ducks|little fishes|swim|swimming|aqua)\b/.test(value)
      && !/\b(adult only|scuba|diving)\b/.test(value)
  }
  return /\b(baby sensory|baby sense|toddler sense|hartbeeps|sensory|baby|toddler|infant)\b/.test(value)
    && !/\b(sensory room|sensory deprivation|adult)\b/.test(value)
}

function activityScore(place: GooglePlace) {
  const rating = Number(place.rating || 0)
  const reviews = Number(place.userRatingCount || 0)
  if (!rating) return null
  let score = rating
  if (place.goodForChildren === true) score += 0.2
  if (reviews >= 100) score += 0.1
  return Math.min(5, Math.round(score * 10) / 10)
}

function knownActivityKey(activity: Pick<ExistingActivity, 'activity_name' | 'address' | 'postcode'>) {
  const addressKey = postcode(activity.postcode || activity.address) || normalized(activity.address)
  return `${normalized(activity.activity_name)}|${addressKey}`
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
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || ''
  if (!token) return false
  if (isServiceRoleToken(token)) return true
  const { data, error } = await supabase.auth.getUser(token)
  return !error && Boolean(data.user?.email && adminEmails.has(data.user.email.toLowerCase()))
}

async function google(apiKey: string, url: string, options: RequestInit = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(25000),
      headers: { ...(options.headers || {}), 'X-Goog-Api-Key': apiKey },
    })
    if (response.ok) return response.json()
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
      throw new Error(`Google Places returned ${response.status}: ${(await response.text()).slice(0, 250)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
  }
  throw new Error('Google Places did not return a result.')
}

async function discover(apiKey: string, zone: (typeof londonZones)[number], query: string) {
  const body = await google(apiKey, 'https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': 'places.id' },
    body: JSON.stringify({
      textQuery: `${query} in ${zone.name}, London`,
      maxResultCount: 8,
      languageCode: 'en-GB',
      regionCode: 'GB',
      locationBias: { circle: { center: { latitude: zone.latitude, longitude: zone.longitude }, radius: 5500 } },
    }),
  })
  return (body.places || []) as GooglePlace[]
}

async function details(apiKey: string, placeId: string) {
  return google(apiKey, `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en-GB&regionCode=GB`, {
    headers: { 'X-Goog-FieldMask': detailFieldMask },
  }) as Promise<GooglePlace>
}

async function existingActivities(supabase: ReturnType<typeof createClient>) {
  const activities: ExistingActivity[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('activities')
      .select('activity_id,activity_name,address,postcode,google_place_id,source_url')
      .range(from, from + 999)
    if (error) throw new Error(`Could not check existing activities: ${error.message}`)
    activities.push(...(data || []) as ExistingActivity[])
    if ((data || []).length < 1000) break
  }
  return {
    placeIds: new Set(activities.map((activity) => activity.google_place_id).filter(Boolean)),
    sourceUrls: new Set(activities.map((activity) => activity.source_url).filter(Boolean)),
    activityKeys: new Set(activities.map(knownActivityKey)),
  }
}

function prepareActivity(place: GooglePlace, profile: Profile, queries: Set<string>) {
  const name = text(place.displayName?.text)
  const address = text(place.formattedAddress)
  const placeId = text(place.id)
  if (!name || !address || !placeId || !isGreaterLondon(place.location)) return { reason: 'Missing a name, London address, place ID, or verified coordinate.' }
  if (place.businessStatus === 'CLOSED_PERMANENTLY') return { reason: 'Permanently closed.' }
  if (profile.id === 'play_cafes' && !isFamilyCafe(place)) return { reason: 'Failed child-friendly cafe quality checks.' }
  if (!hasProfileSignal(place, profile)) return { reason: `Missing a clear ${profile.label} signal.` }

  const hours = availability(place.regularOpeningHours)
  const rating = Number(place.rating || 0) || null
  const reviews = Number(place.userRatingCount || 0)
  const activity: PreparedActivity = {
    activity_name: name, address, postcode: postcode(address), lat: Number(place.location?.latitude), long: Number(place.location?.longitude),
    category: profile.category, start_time: hours.start, end_time: hours.end,
    google_link: place.googleMapsUri || null, website: officialWebsiteUrl(place.websiteUri), organiser_website: null,
    child_friendly_score: activityScore(place), app_rating: rating, number_of_reviews: reviews,
    age_suitability: 'Babies, toddlers and their grown-ups', borough: boroughForAddress(address), days_of_week: hours.days,
    recurrence_rule: hours.days.length ? `FREQ=WEEKLY;BYDAY=${hours.days.map((day) => day.slice(0, 2).toUpperCase()).join(',')}` : null,
    schedule_notes: hours.notes, description: profile.description, cost: profile.cost, booking_required: profile.bookingRequired,
    source_name: profile.sourceName, source_url: sourceUrl(placeId), image_url: null, image_source_url: officialWebsiteUrl(place.websiteUri),
    google_place_id: placeId, google_place_uri: place.googleMapsUri || null, google_photo_url: null,
    google_rating: rating, google_user_rating_count: reviews, google_primary_type: place.primaryType || null,
    google_opening_hours: place.regularOpeningHours || null, google_summary: place.editorialSummary?.text || null,
    activity_date: null, available_dates: [], availability_start_date: null, availability_end_date: null,
    available_days_of_week: hours.days, availability_type: hours.type,
    availability_notes: `Google Places discovery: ${[...queries].join('; ')}. ${hours.notes}`,
    public_listing_status: 'published', archive: false,
  }
  return { activity }
}

async function runImporter(supabase: ReturnType<typeof createClient>, apiKey: string, profile: Profile, maxCandidates: number) {
  const discovered = new Map<string, Set<string>>()
  const discoveryErrors: string[] = []
  for (const zone of londonZones) {
    for (const query of profile.queries) {
      try {
        for (const place of await discover(apiKey, zone, query)) {
          if (!place.id) continue
          const queries = discovered.get(place.id) || new Set<string>()
          queries.add(`${query} in ${zone.name}`)
          discovered.set(place.id, queries)
        }
      } catch (error) {
        discoveryErrors.push(`${query} in ${zone.name}: ${error instanceof Error ? error.message : 'request failed'}`)
      }
    }
  }

  const known = await existingActivities(supabase)
  const prepared: PreparedActivity[] = []
  const rejected: Array<{ place_id: string; name?: string; reason: string }> = []
  const candidates = [...discovered.entries()].slice(0, maxCandidates)
  for (const [placeId, queries] of candidates) {
    try {
      const place = await details(apiKey, placeId)
      const result = prepareActivity(place, profile, queries)
      if (!('activity' in result)) {
        rejected.push({ place_id: placeId, name: place.displayName?.text, reason: result.reason })
        continue
      }
      if (known.activityKeys.has(knownActivityKey(result.activity as unknown as ExistingActivity)) && !known.placeIds.has(placeId)) {
        rejected.push({ place_id: placeId, name: place.displayName?.text, reason: 'Matching name and venue already exist.' })
        continue
      }
      prepared.push(result.activity)
      known.placeIds.add(placeId)
      known.sourceUrls.add(sourceUrl(placeId))
      known.activityKeys.add(knownActivityKey(result.activity as unknown as ExistingActivity))
    } catch (error) {
      rejected.push({ place_id: placeId, reason: error instanceof Error ? error.message : 'Place detail request failed.' })
    }
  }

  if (prepared.length) {
    const { error } = await supabase.from('activities').upsert(prepared, { onConflict: 'source_url' })
    if (error) throw new Error(`Could not save ${profile.label}: ${error.message}`)
  }

  return {
    importer: profile.id, category: profile.category, discovered: discovered.size, inspected: candidates.length,
    imported_or_refreshed: prepared.length, skipped_or_rejected: rejected.length,
    discovery_errors: discoveryErrors, rejected: rejected.slice(0, 50),
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Use POST to run one or more Google Places importers.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = serviceRoleKey()
  const googleApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY') || Deno.env.get('GOOGLE_MAPS_API_KEY')
  if (!url || !serviceKey || !googleApiKey) return jsonResponse({ error: 'The importer is missing its Supabase service key or Google Places API secret.' }, 500)

  const supabase = createClient(url, serviceKey)
  if (!(await authorize(request, supabase))) return jsonResponse({ error: 'Only a Tiny Outings administrator can run paid Google Places imports.' }, 403)

  try {
    const body = await request.json().catch(() => ({}))
    const requested = Array.isArray(body.importers) ? body.importers : Object.keys(profiles)
    const importerIds = [...new Set(requested)].filter((id): id is ImporterId => id in profiles)
    if (!importerIds.length) return jsonResponse({ error: 'Choose play_cafes, baby_swim, or baby_sensory.' }, 400)
    const maxCandidates = Math.min(Math.max(Number(body.max_candidates) || 60, 1), 100)
    const results = []
    for (const importerId of importerIds) results.push(await runImporter(supabase, googleApiKey, profiles[importerId], maxCandidates))
    return jsonResponse({ imported_at: new Date().toISOString(), max_candidates_per_importer: maxCandidates, results })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Google Places import failed.' }, 500)
  }
})
