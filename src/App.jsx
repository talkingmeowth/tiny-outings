import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

const dayWindows = ['morning', 'afternoon', 'evening'];
const storagePrefix = 'tiny-outings';
// Reset outdated swipe/filter state without touching planned calendar entries.
const planningStorageVersion = '2026-07-13-event-swipe-validation';
const statusOptions = ['booked', 'tentative'];
const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const activitySelectColumns = [
  'activity_id',
  'activity_name',
  'address',
  'lat',
  'long',
  'category',
  'start_time',
  'end_time',
  'google_link',
  'website',
  'child_friendly_score',
  'app_rating',
  'number_of_reviews',
  'age_suitability',
  'borough',
  'days_of_week',
  'available_days_of_week',
  'available_dates',
  'activity_date',
  'availability_start_date',
  'availability_end_date',
  'availability_type',
  'availability_notes',
  'schedule_notes',
  'time_window',
  'description',
  'cost',
  'image_url',
  'google_photo_url',
  'image_source_url',
  'source_url',
  'source_name',
  'data_source',
  'google_primary_type',
  'google_place_id',
  'google_place_uri',
  'google_rating',
  'google_user_rating_count',
  'public_listing_status',
].join(',');
const statusLabels = {
  booked: 'Booked',
  tentative: 'Tentative',
  not_selected: 'Not selected',
};

const emptyLinkForm = {
  activity_link: '',
};

const activityInterestOptions = [
  'Baby classes',
  'Play & learn',
  'Food & socials',
  'Parks',
  'Days out',
];

const activityInterestCategories = {
  'Baby classes': [
    'Baby yoga', 'Baby massage', 'Baby sensory', 'Music & singing', 'Baby signing',
    'Baby swimming', 'Postnatal fitness', 'Baby dance & movement', 'Developmental play',
  ],
  'Play & learn': ['Stay & play', 'Story & rhyme time', 'Arts & crafts', 'Soft play', 'Family hubs'],
  'Food & socials': ['Child-friendly cafes', 'Bookshops', 'Parent meet-ups', 'Feeding & postnatal support'],
  Parks: ['Parks & outdoor play'],
  'Days out': ['Museums & culture', 'Baby & toddler cinema', 'Family activities'],
};

let routesLibraryPromise;

function loadRoutesLibrary() {
  if (!googleMapsApiKey || typeof window === 'undefined') return null;
  if (window.google?.maps?.importLibrary) return window.google.maps.importLibrary('routes');
  if (routesLibraryPromise) return routesLibraryPromise;

  routesLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}&v=weekly`;
    script.async = true;
    script.onload = async () => {
      try {
        resolve(await window.google.maps.importLibrary('routes'));
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => reject(new Error('Google Maps could not load.'));
    document.head.append(script);
  });

  return routesLibraryPromise;
}

async function fetchTravelRoute(origin, activity, travelMode) {
  const routesLibrary = await loadRoutesLibrary();
  if (!routesLibrary || activity.lat == null || activity.long == null) return null;

  const { Route } = routesLibrary;
  const { routes } = await Route.computeRoutes({
    origin: { lat: origin.lat, lng: origin.long },
    destination: { lat: activity.lat, lng: activity.long },
    travelMode,
    fields: ['distanceMeters', 'durationMillis'],
  });
  const route = routes?.[0];
  if (!route?.distanceMeters || !route?.durationMillis) return null;

  return {
    distance: Number(route.distanceMeters) / 1609.344,
    minutes: Math.max(1, Math.round(Number(route.durationMillis) / 60000)),
  };
}

function defaultFilters() {
  return {
    distanceMode: 'radius',
    radiusMiles: 10,
    walkMinutes: 35,
    driveMinutes: 25,
    weekStart: startOfWeekISO(todayISO()),
    interests: [...activityInterestOptions],
    includeEvents: true,
  };
}

function loadStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(`${storagePrefix}:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    window.localStorage.setItem(`${storagePrefix}:${key}`, JSON.stringify(value));
  } catch {
    // Local storage is only a convenience cache.
  }
}

function removeStored(key) {
  try {
    window.localStorage.removeItem(`${storagePrefix}:${key}`);
  } catch {
    // Ignore blocked local storage.
  }
}

function clearOldPlanningCache() {
  const versionKey = `${storagePrefix}:planning-storage-version`;
  try {
    if (window.localStorage.getItem(versionKey) === planningStorageVersion) return;
    // A saved past week or Events-only mode can otherwise make a populated
    // directory look empty after an app update.
    for (const key of ['filters', 'swipes', 'shortlists', 'statuses']) {
      window.localStorage.removeItem(`${storagePrefix}:${key}`);
    }
    window.localStorage.setItem(versionKey, planningStorageVersion);
  } catch {
    // If storage is blocked, the app simply starts with in-memory state.
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeekISO(dateISO = todayISO()) {
  const date = new Date(`${dateISO}T12:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function addDaysISO(dateISO, days) {
  const date = new Date(`${dateISO}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDay(dateISO, style = 'short') {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: style,
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${dateISO}T12:00:00`));
}

function weekdayName(dateISO) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(new Date(`${dateISO}T12:00:00`));
}

function normalizedWeekday(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/s$/, '');
}

function formatWeekRange(weekStart) {
  return `${formatDay(weekStart)} to ${formatDay(addDaysISO(weekStart, 6))}`;
}

function toWindow(startTime) {
  const hour = Number(String(startTime || '09:00').slice(0, 2));
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeActivity(activity) {
  const appRating = numericOrNull(activity.app_rating);
  const googleRating = numericOrNull(activity.google_rating);
  const reviewCount = Number(activity.number_of_reviews ?? activity.google_user_rating_count ?? 0);
  const cost = activity.cost || activity.price || activity.price_text || activity.fee || null;

  return {
    ...activity,
    activity_id: String(activity.activity_id),
    start_time: String(activity.start_time || '09:00').slice(0, 5),
    end_time: String(activity.end_time || '10:00').slice(0, 5),
    // A source import can carry an old derived window. The visible card and
    // its swipe slot must always follow the actual scheduled start time.
    time_window: toWindow(activity.start_time),
    category: activity.category || activity.google_primary_type || 'parent friendly',
    lat: numericOrNull(activity.lat),
    long: numericOrNull(activity.long),
    app_rating: appRating ?? googleRating,
    google_rating: googleRating,
    number_of_reviews: Number.isFinite(reviewCount) ? reviewCount : 0,
    google_user_rating_count: Number(activity.google_user_rating_count ?? reviewCount ?? 0),
    days_of_week: Array.isArray(activity.days_of_week) ? activity.days_of_week : [],
    available_days_of_week: Array.isArray(activity.available_days_of_week)
      ? activity.available_days_of_week
      : [],
    available_dates: Array.isArray(activity.available_dates)
      ? activity.available_dates.map((date) => String(date).slice(0, 10))
      : [],
    activity_date: activity.activity_date ? String(activity.activity_date).slice(0, 10) : null,
    availability_start_date: activity.availability_start_date
      ? String(activity.availability_start_date).slice(0, 10)
      : null,
    availability_end_date: activity.availability_end_date
      ? String(activity.availability_end_date).slice(0, 10)
      : null,
    availability_type: activity.availability_type || 'recurring',
    cost,
    image_url: activity.image_url || activity.google_photo_url || activity.photo_url || null,
    image_source_url: activity.image_source_url || activity.website || activity.source_url || null,
    public_listing_status: activity.public_listing_status || 'published',
  };
}

function slotKey(date, windowName) {
  return `${date}:${windowName}`;
}

function statusKey(date, windowName, activityId) {
  return `${slotKey(date, windowName)}:${activityId}`;
}

function milesBetween(a, b) {
  if (!a || !b || a.lat == null || a.long == null || b.lat == null || b.long == null) return null;
  const radiusMiles = 3958.8;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(Number(b.lat) - Number(a.lat));
  const dLon = toRad(Number(b.long) - Number(a.long));
  const lat1 = toRad(Number(a.lat));
  const lat2 = toRad(Number(b.lat));
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * radiusMiles * Math.asin(Math.sqrt(x));
}

function formatDistance(miles) {
  if (miles == null || Number.isNaN(miles)) return null;
  if (miles < 0.1) return 'Very nearby';
  return `${miles.toFixed(1)} mi`;
}

function isFlexibleActivity(activity) {
  const category = String(activity.category || '').toLowerCase();
  const name = String(activity.activity_name || '').toLowerCase();
  const dailyDays = activity.available_days_of_week?.length === 7 || activity.days_of_week?.length === 7;
  return (
    category.includes('park') ||
    name.includes('park') ||
    activity.availability_type === 'daily' ||
    (dailyDays && !activity.schedule_notes)
  );
}

function shouldShowAvailability(activity) {
  return !isFlexibleActivity(activity) && formatAvailability(activity) !== 'Open dates vary';
}

function formatAvailability(activity) {
  if (isFlexibleActivity(activity)) return 'Anytime';
  if (activity.activity_date) return formatDay(activity.activity_date);
  if (activity.availability_start_date && activity.availability_end_date) {
    return `${formatDay(activity.availability_start_date)} to ${formatDay(activity.availability_end_date)}`;
  }
  const days = activity.available_days_of_week?.length
    ? activity.available_days_of_week
    : activity.days_of_week;
  if (days?.length === 7) return 'Every day';
  if (days?.length) return days.join(', ');
  return activity.availability_type === 'unknown' ? 'Check dates' : 'Open dates vary';
}

function dateStampForCalendar(dateISO, time) {
  return `${dateISO.replaceAll('-', '')}T${String(time).replace(':', '')}00`;
}

function buildGoogleCalendarUrl(event) {
  const activity = event.activity;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title_override || activity.activity_name,
    details: `${activity.description || ''}\n\nTiny Outings status: ${statusLabels[event.status]}.`,
    location: activity.address,
    dates: `${dateStampForCalendar(event.planned_date, event.start_time)}/${dateStampForCalendar(
      event.planned_date,
      event.end_time,
    )}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function cleanICS(value) {
  return String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

function buildICS(event) {
  const activity = event.activity;
  const created = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tiny Outings//Parent Planner//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.local_id}@tiny-outings`,
    `DTSTAMP:${created}`,
    `DTSTART;TZID=Europe/London:${dateStampForCalendar(event.planned_date, event.start_time)}`,
    `DTEND;TZID=Europe/London:${dateStampForCalendar(event.planned_date, event.end_time)}`,
    `SUMMARY:${cleanICS(event.title_override || activity.activity_name)}`,
    `DESCRIPTION:${cleanICS(activity.description || 'Planned in Tiny Outings')}`,
    `LOCATION:${cleanICS(activity.address)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadICS(event) {
  const blob = new Blob([buildICS(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.planned_date}-${event.day_window}-tiny-outings.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function classNames(...names) {
  return names.filter(Boolean).join(' ');
}

function googleEntryUrl(activity) {
  if (activity.google_place_uri) return activity.google_place_uri;
  if (activity.google_link) return activity.google_link;
  if (activity.google_place_id) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.activity_name)}&query_place_id=${activity.google_place_id}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${activity.activity_name} ${activity.address || ''}`,
  )}`;
}

function activityWebsiteUrl(activity) {
  return activity.website || activity.source_url || activity.google_place_uri || activity.google_link || googleEntryUrl(activity);
}

function isUsablePhotoUrl(url) {
  if (!url) return false;
  const value = String(url);
  return ![
    'image.thum.io',
    's.wordpress.com/mshots',
    'maps.googleapis.com/maps/api/place/photo',
  ].some((blocked) => value.includes(blocked));
}

function googlePhotoMediaUrl(photoReference) {
  const value = String(photoReference || '');
  if (!value.startsWith('places/') || !googleMapsApiKey) return value || null;
  return `https://places.googleapis.com/v1/${encodeURI(value)}/media?maxWidthPx=1200&key=${encodeURIComponent(googleMapsApiKey)}`;
}

function activityPhotoUrls(activity) {
  const category = String(activity.category || '').toLowerCase();
  const fallbackImage = category.includes('park')
    ? '/images/park-placeholder.svg'
    : category.includes('book')
      ? '/images/bookshop-placeholder.svg'
      : category.includes('cafe')
        ? '/images/family-cafe-placeholder.svg'
        : '/images/family-outing-placeholder.svg';
  const candidates = [
    googlePhotoMediaUrl(activity.google_photo_url),
    activity.image_url,
    activity.photo_url,
    fallbackImage,
  ].filter(isUsablePhotoUrl);

  return [...new Set(candidates)];
}

function activityPhotoUrl(activity) {
  return activityPhotoUrls(activity)[0] || null;
}

function activityPhotoLabel(activity) {
  const photoUrl = activityPhotoUrl(activity);
  if (photoUrl && (photoUrl === activity.google_photo_url || String(activity.google_photo_url || '').startsWith('places/'))) return 'Google Places photo';
  if (photoUrl && (photoUrl === activity.image_url || photoUrl === activity.photo_url)) return 'Activity photo';
  if (String(photoUrl).includes('-placeholder.svg')) return 'Activity illustration';
  if (photoUrl) return 'Website preview';
  return 'Photo pending';
}

function activityCost(activity) {
  const cost = activity.cost || activity.price || activity.price_text || activity.fee;
  if (!cost || String(cost).trim().length === 0) return null;
  return String(cost).trim();
}

function isActivityAvailableOn(activity, dateISO) {
  const weekday = weekdayName(dateISO);
  const explicitDates = activity.available_dates || [];
  const availableDays = activity.available_days_of_week?.length
    ? activity.available_days_of_week
    : activity.days_of_week;

  if (activity.activity_date === dateISO || explicitDates.includes(dateISO)) return true;

  if (
    ['one_off', 'specific_dates'].includes(activity.availability_type) &&
    (activity.activity_date || explicitDates.length)
  ) {
    return false;
  }

  if (activity.availability_start_date && dateISO < activity.availability_start_date) return false;
  if (activity.availability_end_date && dateISO > activity.availability_end_date) return false;

  // Do not guess dates for ticketed events. A source page without a specific
  // date, a date range, or recurring days belongs in the directory data but
  // must not be offered as a plan for every day of the year.
  if (
    isEventSource(activity)
    && !activity.activity_date
    && explicitDates.length === 0
    && !(activity.availability_start_date && activity.availability_end_date)
    && !availableDays?.length
  ) return false;

  if (availableDays?.length) {
    const normalizedTargetDay = normalizedWeekday(weekday);
    return availableDays.some((day) => normalizedWeekday(day) === normalizedTargetDay);
  }
  return true;
}

function activityMatchesInterests(activity, selectedCategories, allCategoriesSelected) {
  if (allCategoriesSelected) return true;
  const category = String(activity.category || '');
  const activityText = [
    category,
    activity.activity_name,
    activity.description,
    activity.age_suitability,
  ].filter(Boolean).join(' ').toLowerCase();
  const semanticMatchers = {
    'Baby classes': /baby|toddler|sensory|music|sing|sign|yoga|massage|swim|dance|pilates|postnatal|developmental|class/,
    'Play & learn': /stay and play|stay & play|playgroup|soft play|story|rhyme|craft|family hub|sensory room/,
    'Food & socials': /cafe|coffee|brunch|bakery|bookshop|meetup|feeding|breastfeed|postnatal support/,
    Parks: /park|playground|garden|outdoor|nature|walk/,
    'Days out': /museum|cinema|theatre|concert|farm|zoo|aquarium|family activit|day out/,
  };
  return [...selectedCategories].some((interest) => (
    activityInterestCategories[interest]?.includes(category)
    || semanticMatchers[interest]?.test(activityText)
  ));
}

function isEventSource(activity) {
  return /eventbrite|fever/i.test([
    activity.data_source,
    activity.source_name,
    activity.source_url,
    activity.website,
  ].filter(Boolean).join(' '));
}

function isHappityListing(activity) {
  return /happity/i.test([
    activity.data_source,
    activity.source_name,
    activity.source_url,
    activity.website,
  ].filter(Boolean).join(' '));
}

function isEventListing(activity) {
  // Fever and Eventbrite listings are events even when their publisher has
  // not supplied a machine-readable date yet. Dated entries are still
  // filtered by isActivityAvailableOn when a parent chooses a planning week.
  return isEventSource(activity);
}

function buildSubmittedPayload(enriched, link) {
  const appRating = numericOrNull(enriched.app_rating ?? enriched.google_rating);
  const reviewCount = Number(enriched.number_of_reviews ?? enriched.google_user_rating_count ?? 0);
  const payload = {
    activity_name: enriched.activity_name,
    address: enriched.address,
    lat: numericOrNull(enriched.lat),
    long: numericOrNull(enriched.long),
    category: enriched.category || enriched.google_primary_type || 'parent friendly',
    start_time: enriched.start_time || '09:00',
    end_time: enriched.end_time || '10:00',
    google_link: enriched.google_link || enriched.google_place_uri || link,
    website: enriched.website || null,
    child_friendly_score: numericOrNull(enriched.child_friendly_score),
    app_rating: appRating,
    number_of_reviews: Number.isFinite(reviewCount) ? reviewCount : 0,
    age_suitability: enriched.age_suitability || 'Under 5s',
    description: enriched.description || null,
    cost: enriched.cost || null,
    source_name: 'Google Places link submission',
    source_url: link,
    public_listing_status: 'draft',
    submitted_by_user_id: null,
    google_place_id: enriched.google_place_id || null,
    google_place_uri: enriched.google_place_uri || enriched.google_link || null,
    google_photo_url: enriched.google_photo_url || null,
    google_rating: numericOrNull(enriched.google_rating),
    google_user_rating_count: Number(enriched.google_user_rating_count ?? reviewCount ?? 0),
    google_primary_type: enriched.google_primary_type || null,
    google_opening_hours: enriched.google_opening_hours || null,
    google_summary: enriched.google_summary || null,
    image_url: enriched.image_url || enriched.google_photo_url || null,
    image_source_url: enriched.image_source_url || enriched.website || enriched.google_place_uri || link,
    activity_date: enriched.activity_date || null,
    available_dates: enriched.available_dates || [],
    availability_start_date: enriched.availability_start_date || null,
    availability_end_date: enriched.availability_end_date || null,
    available_days_of_week: enriched.available_days_of_week || [],
    availability_type: enriched.availability_type || 'unknown',
    availability_notes: enriched.availability_notes || null,
  };

  if (enriched.postcode) payload.postcode = enriched.postcode;
  if (enriched.borough) payload.borough = enriched.borough;
  return payload;
}

export default function App() {
  useState(() => {
    clearOldPlanningCache();
    return true;
  });
  const [activeScreen, setActiveScreen] = useState('start');
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedWindow, setSelectedWindow] = useState('morning');
  const [filters, setFilters] = useState(() => {
    const stored = loadStored('filters', {});
    const defaults = defaultFilters();
    return {
      distanceMode: ['walk', 'drive'].includes(stored.distanceMode) ? stored.distanceMode : 'radius',
      radiusMiles: Number(stored.radiusMiles) || defaults.radiusMiles,
      walkMinutes: Number(stored.walkMinutes) || defaults.walkMinutes,
      driveMinutes: Number(stored.driveMinutes) || defaults.driveMinutes,
      weekStart: stored.weekStart || defaults.weekStart,
      // Categories always begin broad. Parents can narrow them for the current session.
      interests: defaults.interests,
      // Events start on for every fresh app version. Older cached filters could
      // leave a populated events directory invisible after an import.
      includeEvents: true,
    };
  });
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('idle');
  const [swipes, setSwipes] = useState(() => loadStored('swipes', {}));
  const [shortlists, setShortlists] = useState(() => loadStored('shortlists', {}));
  const [statuses, setStatuses] = useState(() => loadStored('statuses', {}));
  const [calendarEvents, setCalendarEvents] = useState(() => loadStored('calendar-events', []));
  const [linkForm, setLinkForm] = useState(emptyLinkForm);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comments: '', photo_url: '' });
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [returnScreen, setReturnScreen] = useState('swipe');
  const [dragState, setDragState] = useState({ activityId: null, startX: null, offsetX: 0 });
  const [travelRoutes, setTravelRoutes] = useState({});
  // Keep Plan controls responsive while the directory catches up with a changed filter.
  const deferredFilters = useDeferredValue(filters);
  const selectedCategorySet = useMemo(
    () => new Set(deferredFilters.interests),
    [deferredFilters.interests],
  );
  const allCategoriesSelected = selectedCategorySet.size === activityInterestOptions.length;
  const eventsOnly = deferredFilters.includeEvents && selectedCategorySet.size === 0;

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysISO(filters.weekStart, index)),
    [filters.weekStart],
  );
  const activeSlot = slotKey(selectedDate, selectedWindow);
  const allActivities = useMemo(() => activities.map(normalizeActivity), [activities]);
  const activityById = useMemo(
    () => new Map(allActivities.map((activity) => [String(activity.activity_id), activity])),
    [allActivities],
  );
  const filteredWeekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysISO(deferredFilters.weekStart, index)),
    [deferredFilters.weekStart],
  );

  const activitiesWithDistance = useMemo(
    () => allActivities.map((activity) => ({
      ...activity,
      distance: travelRoutes[activity.activity_id]?.walking?.distance ?? (
        milesBetween(userLocation, { lat: activity.lat, long: activity.long })
      ),
      walkMinutes: travelRoutes[activity.activity_id]?.walking?.minutes ?? null,
      driveDistance: travelRoutes[activity.activity_id]?.driving?.distance ?? null,
      driveMinutes: travelRoutes[activity.activity_id]?.driving?.minutes ?? null,
    })),
    [allActivities, userLocation, travelRoutes],
  );

  const publishedActivityCount = useMemo(
    () => allActivities.filter((activity) => activity.public_listing_status === 'published').length,
    [allActivities],
  );
  const baseFilteredActivities = useMemo(
    () => activitiesWithDistance.filter((activity) => {
      // Events are an independent tag: when it is the only selection, do not
      // also require an activity category match.
      const interestMatch = eventsOnly
        ? isEventListing(activity)
        : activityMatchesInterests(activity, selectedCategorySet, allCategoriesSelected);
      const eventMatch = eventsOnly
        ? true
        : deferredFilters.includeEvents
          ? (!isEventSource(activity) || isEventListing(activity))
          : !isEventSource(activity);
      return activity.public_listing_status === 'published' && interestMatch && eventMatch;
    }),
    [activitiesWithDistance, selectedCategorySet, allCategoriesSelected, deferredFilters.includeEvents, eventsOnly],
  );
  const distanceMatchedActivities = useMemo(
    () => !userLocation
      ? baseFilteredActivities
      : baseFilteredActivities.filter((activity) => {
        if (activity.distance == null) return false;
        if (deferredFilters.distanceMode === 'walk') {
          const minutes = activity.walkMinutes ?? activity.distance * 20;
          return minutes <= Number(deferredFilters.walkMinutes);
        }
        if (deferredFilters.distanceMode === 'drive') {
          // A conservative London fallback while the precise Google route loads.
          const minutes = activity.driveMinutes ?? activity.distance * 6;
          return minutes <= Number(deferredFilters.driveMinutes);
        }
        return activity.distance <= Number(deferredFilters.radiusMiles);
      }),
    [baseFilteredActivities, deferredFilters.distanceMode, deferredFilters.driveMinutes, deferredFilters.radiusMiles, deferredFilters.walkMinutes, userLocation],
  );
  // Do not leave a parent with an empty app if a device location is outside the
  // London directory or is too imprecise for the chosen range.
  const usingDistanceFallback = Boolean(userLocation)
    && distanceMatchedActivities.length === 0
    && baseFilteredActivities.length > 0;
  const sharedFilteredActivities = usingDistanceFallback
    ? baseFilteredActivities
    : distanceMatchedActivities;
  const weekMatchedActivities = useMemo(
    () => sharedFilteredActivities.filter(
      (activity) => filteredWeekDays.some((day) => isActivityAvailableOn(activity, day)),
    ),
    [sharedFilteredActivities, filteredWeekDays],
  );
  const filteredActivities = useMemo(
    () => sharedFilteredActivities.filter(
      (activity) => isActivityAvailableOn(activity, selectedDate),
    ),
    [sharedFilteredActivities, selectedDate],
  );
  const slotActivities = useMemo(
    () => filteredActivities
      .filter((activity) => isFlexibleActivity(activity) || activity.time_window === selectedWindow)
      // Ticketed events lead the deck, followed by the weekly Happity classes
      // that match this exact day and time. General places follow afterwards.
      .sort((left, right) => (
        Number(isEventListing(right)) - Number(isEventListing(left))
        || Number(isHappityListing(right)) - Number(isHappityListing(left))
        || String(left.start_time).localeCompare(String(right.start_time))
      )),
    [filteredActivities, selectedWindow],
  );
  const swipedIds = useMemo(
    () => new Set((swipes[activeSlot] || []).map((item) => String(item.activity_id))),
    [activeSlot, swipes],
  );
  const deckActivities = useMemo(
    () => slotActivities.filter((activity) => !swipedIds.has(String(activity.activity_id))),
    [slotActivities, swipedIds],
  );
  const currentShortlist = useMemo(
    () => (shortlists[activeSlot] || [])
      .map((activityId) => activityById.get(String(activityId)))
      .filter(Boolean),
    [activeSlot, activityById, shortlists],
  );
  const chosenForSlot = useMemo(
    () => calendarEvents.filter(
      (event) => event.planned_date === selectedDate && event.day_window === selectedWindow,
    ),
    [calendarEvents, selectedDate, selectedWindow],
  );
  const routeCandidates = useMemo(
    () => [...deckActivities.slice(0, 3), selectedActivity]
      .filter((activity) => activity?.lat != null && activity?.long != null)
      .filter((activity, index, items) => items.findIndex((item) => item.activity_id === activity.activity_id) === index),
    [deckActivities, selectedActivity],
  );

  useEffect(() => saveStored('filters', filters), [filters]);
  useEffect(() => saveStored('swipes', swipes), [swipes]);
  useEffect(() => saveStored('shortlists', shortlists), [shortlists]);
  useEffect(() => saveStored('statuses', statuses), [statuses]);
  useEffect(() => saveStored('calendar-events', calendarEvents), [calendarEvents]);

  useEffect(() => {
    removeStored('activity-drafts');
  }, []);

  useEffect(() => {
    const weekEnd = addDaysISO(filters.weekStart, 6);
    if (selectedDate < filters.weekStart || selectedDate > weekEnd) {
      setSelectedDate(filters.weekStart);
    }
  }, [filters.weekStart, selectedDate]);

  useEffect(() => {
    if (activeScreen !== 'swipe') return;
    window.requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  }, [activeScreen]);

  useEffect(() => {
    setTravelRoutes({});
  }, [userLocation?.lat, userLocation?.long]);

  useEffect(() => {
    if (!googleMapsApiKey || !userLocation || !routeCandidates.length) return undefined;
    let cancelled = false;
    const missingRoutes = routeCandidates.filter((activity) => !travelRoutes[activity.activity_id]);
    if (!missingRoutes.length) return undefined;

    Promise.all(
      missingRoutes.map(async (activity) => ({
        activityId: activity.activity_id,
        routes: await Promise.all([
          fetchTravelRoute(userLocation, activity, 'WALKING'),
          fetchTravelRoute(userLocation, activity, 'DRIVING'),
        ]),
      })),
    )
      .then((results) => {
        if (cancelled) return;
        setTravelRoutes((current) => {
          const next = { ...current };
          for (const result of results) {
            const [walking, driving] = result.routes;
            if (walking || driving) next[result.activityId] = { walking, driving };
          }
          return next;
        });
      })
      .catch(() => {
        // A card without a route simply omits travel until the next attempt.
      });

    return () => {
      cancelled = true;
    };
  }, [routeCandidates, userLocation, travelRoutes]);

  useEffect(() => {
    let cancelled = false;

    async function loadActivities() {
      if (!supabase) return;
      setLoading(true);
      const pageSize = 1000;
      const data = [];
      let error = null;

      for (let from = 0; ; from += pageSize) {
        const response = await supabase
          .from('activities')
          .select(activitySelectColumns)
          .eq('public_listing_status', 'published')
          .order('start_time', { ascending: true })
          .order('activity_id', { ascending: true })
          .range(from, from + pageSize - 1);

        if (response.error) {
          error = response.error;
          break;
        }
        data.push(...(response.data || []));
        if ((response.data || []).length < pageSize) break;
      }

      if (cancelled) return;

      if (error) {
        setNotice(`We could not refresh outings just now: ${error.message}`);
      } else {
        setActivities(data);
      }
      setLoading(false);
    }

    loadActivities();
    return () => {
      cancelled = true;
    };
  }, []);

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('blocked');
      setNotice('Location is not available on this device.');
      return;
    }

    setLocationStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          long: position.coords.longitude,
        });
        setLocationStatus('ready');
        setNotice('Nearby picks are on. Tap Show all if you want the full London list.');
      },
      () => {
        setLocationStatus('blocked');
        setNotice('No worries. You can still browse the full list.');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout: 12000,
      },
    );
  }

  function showAllActivities() {
    setFilters((current) => ({
      ...defaultFilters(),
      weekStart: current.weekStart,
    }));
    setUserLocation(null);
    setLocationStatus('idle');
    setSwipes({});
    setShortlists({});
    setStatuses({});
    setNotice('Showing the full London list. Your calendar plans are still saved.');
  }

  function resetBrowsingState() {
    setSwipes({});
    setShortlists({});
    setStatuses({});
    setNotice('Your swipe deck is fresh again. Calendar plans stayed put.');
  }

  function setLocalStatus(activity, status) {
    setStatuses((current) => ({
      ...current,
      [statusKey(selectedDate, selectedWindow, activity.activity_id)]: status,
    }));
  }

  function handleSwipe(activity, decision) {
    if (!activity) return;
    const activityId = String(activity.activity_id);
    const nextStatus = decision === 'yes' ? 'tentative' : 'not_selected';

    setSwipes((current) => {
      const slotSwipes = current[activeSlot] || [];
      if (slotSwipes.some((item) => String(item.activity_id) === activityId)) return current;
      return {
        ...current,
        [activeSlot]: [
          ...slotSwipes,
          {
            activity_id: activityId,
            decision,
            status: nextStatus,
            created_at: new Date().toISOString(),
          },
        ],
      };
    });

    if (decision === 'yes') {
      setShortlists((current) => {
        const slotShortlist = current[activeSlot] || [];
        if (slotShortlist.includes(activityId)) return current;
        return {
          ...current,
          [activeSlot]: [...slotShortlist, activityId],
        };
      });
      setNotice(`${activity.activity_name} added to your ${selectedWindow} maybe-list.`);
    } else {
      setNotice('');
    }

    setLocalStatus(activity, nextStatus);
    setDragState({ activityId: null, startX: null, offsetX: 0 });
  }

  function startDrag(event, activity) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragState({ activityId: activity.activity_id, startX: event.clientX, offsetX: 0 });
  }

  function moveDrag(event, activity) {
    if (dragState.activityId !== activity.activity_id || dragState.startX == null) return;
    setDragState((current) => ({ ...current, offsetX: event.clientX - current.startX }));
  }

  function endDrag(activity) {
    if (dragState.activityId !== activity.activity_id) return;
    if (dragState.offsetX > 86) {
      handleSwipe(activity, 'yes');
    } else if (dragState.offsetX < -86) {
      handleSwipe(activity, 'no');
    } else {
      setDragState({ activityId: null, startX: null, offsetX: 0 });
    }
  }

  function resetCurrentSlot() {
    setSwipes((current) => {
      const next = { ...current };
      delete next[activeSlot];
      return next;
    });
    setShortlists((current) => {
      const next = { ...current };
      delete next[activeSlot];
      return next;
    });
    setStatuses((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${activeSlot}:`))),
    );
    setNotice(`Cleared ${selectedWindow} on ${formatDay(selectedDate)}.`);
  }

  function chooseActivity(activity, status = 'booked') {
    const event = {
      local_id: `${selectedDate}-${selectedWindow}-${activity.activity_id}`,
      user_id: null,
      activity_id: activity.activity_id,
      activity,
      planned_date: selectedDate,
      day_window: selectedWindow,
      start_time: activity.start_time,
      end_time: activity.end_time,
      status,
      created_at: new Date().toISOString(),
    };

    setCalendarEvents((current) => {
      const existingIndex = current.findIndex((item) => item.local_id === event.local_id);
      if (existingIndex === -1) return [...current, event];
      return current.map((item) => (item.local_id === event.local_id ? { ...item, ...event } : item));
    });

    setLocalStatus(activity, status);
    setNotice(`${activity.activity_name} added to your week as ${statusLabels[status].toLowerCase()}.`);
  }

  function updateEvent(event, changes) {
    const nextEvent = { ...event, ...changes };
    setCalendarEvents((current) =>
      current.map((item) => (item.local_id === event.local_id ? nextEvent : item)),
    );
  }

  function removeEvent(event) {
    setCalendarEvents((current) => current.filter((item) => item.local_id !== event.local_id));
    setNotice(`${event.activity.activity_name} removed from your calendar.`);
  }

  function navigate(screen) {
    if (screen !== 'activity') {
      setSelectedActivity(null);
    }
    setActiveScreen(screen);
  }

  function openActivity(activity) {
    setReturnScreen(activeScreen === 'activity' ? returnScreen : activeScreen);
    setSelectedActivity(activity);
    setActiveScreen('activity');
  }

  function closeActivity() {
    setSelectedActivity(null);
    setActiveScreen(returnScreen);
  }

  async function submitActivityLink(event) {
    event.preventDefault();
    const link = linkForm.activity_link.trim();

    if (!link) {
      setNotice('Paste a place or activity link first.');
      return;
    }

    if (!supabase) {
      setNotice('Link adding is not ready in this build yet.');
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke('activity-link-autofill', {
      body: { link },
    });

    if (error) {
      setNotice(`That link could not be read yet: ${error.message}`);
      setLoading(false);
      return;
    }

    const enriched = data?.activity || data;
    if (!enriched?.activity_name || !enriched?.address) {
      setNotice('That link needs more detail. Try the place listing link.');
      setLoading(false);
      return;
    }

    const payload = buildSubmittedPayload(enriched, link);
    const { error: insertError } = await supabase.from('activities').insert(payload);

    setLoading(false);
    if (insertError) {
      setNotice(`The activity details were found, but could not be saved: ${insertError.message}`);
      return;
    }

    setLinkForm(emptyLinkForm);
    setNotice(`${payload.activity_name} was added for review.`);
  }

  async function submitReview(event) {
    event.preventDefault();
    if (!selectedActivity) return;
    if (!supabase) {
      setNotice('Reviews are not ready in this build yet.');
      return;
    }

    const tasks = [];
    if (reviewForm.rating) {
      tasks.push(
        supabase.from('activity_reviews').insert({
          activity_id: selectedActivity.activity_id,
          user_id: null,
          rating: Number(reviewForm.rating),
          review_text: reviewForm.comments.trim() || null,
        }),
      );
    }
    if (reviewForm.photo_url.trim()) {
      tasks.push(
        supabase.from('activity_photos').insert({
          activity_id: selectedActivity.activity_id,
          user_id: null,
          photo_url: reviewForm.photo_url.trim(),
          source_provider: 'user_upload',
        }),
      );
    }

    const results = await Promise.all(tasks);
    const failed = results.find((result) => result.error);
    if (failed) {
      setNotice(`Review could not be saved: ${failed.error.message}`);
      return;
    }

    setReviewForm({ rating: 5, comments: '', photo_url: '' });
    setNotice('Review saved.');
  }

  return (
    <div className="phone-app">
      <header className="app-topbar">
        <button className="brand-lockup" type="button" onClick={() => navigate('start')}>
          <span>Tiny</span>
          <strong>Outings</strong>
        </button>
      </header>

      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>OK</button>
        </div>
      )}

      <main className="app-main">
        {activeScreen === 'start' && (
          <StartScreen
            filters={filters}
            setFilters={setFilters}
            locationStatus={locationStatus}
            userLocation={userLocation}
            usingDistanceFallback={usingDistanceFallback}
            weekDays={weekDays}
            totalActivityCount={publishedActivityCount}
            weekActivityCount={weekMatchedActivities.length}
            dayActivityCount={filteredActivities.length}
            slotActivityCount={slotActivities.length}
            onRequestLocation={requestLocation}
            onShowAll={showAllActivities}
            onResetBrowsing={resetBrowsingState}
            onStart={() => navigate('swipe')}
          />
        )}

        {activeScreen === 'swipe' && (
          <SwipeScreen
            weekDays={weekDays}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedWindow={selectedWindow}
            setSelectedWindow={setSelectedWindow}
            deckActivities={deckActivities}
            slotActivities={slotActivities}
            shortlist={currentShortlist}
            chosenForSlot={chosenForSlot}
            statuses={statuses}
            selectedDateKey={selectedDate}
            dragState={dragState}
            loading={loading}
            hasActivities={allActivities.length > 0}
            onSwipe={handleSwipe}
            onStartDrag={startDrag}
            onMoveDrag={moveDrag}
            onEndDrag={endDrag}
            onResetSlot={resetCurrentSlot}
            onChoose={chooseActivity}
            onOpenActivity={openActivity}
          />
        )}

        {activeScreen === 'calendar' && (
          <CalendarScreen
            weekDays={weekDays}
            calendarEvents={calendarEvents}
            onOpenActivity={openActivity}
            onUpdateEvent={updateEvent}
            onRemoveEvent={removeEvent}
          />
        )}

        {activeScreen === 'add' && (
          <AddActivityScreen
            form={linkForm}
            setForm={setLinkForm}
            onSubmit={submitActivityLink}
            loading={loading}
          />
        )}

        {activeScreen === 'activity' && selectedActivity && (
          <ActivityDetail
            activity={selectedActivity}
            reviewForm={reviewForm}
            setReviewForm={setReviewForm}
            submitReview={submitReview}
            onClose={closeActivity}
          />
        )}
      </main>

      <BottomNav activeScreen={activeScreen} setActiveScreen={navigate} />
    </div>
  );
}

function StartScreen({
  filters,
  setFilters,
  locationStatus,
  userLocation,
  usingDistanceFallback,
  weekDays,
  totalActivityCount,
  weekActivityCount,
  dayActivityCount,
  slotActivityCount,
  onRequestLocation,
  onShowAll,
  onResetBrowsing,
  onStart,
}) {
  const isWalkMode = filters.distanceMode === 'walk';
  const isDriveMode = filters.distanceMode === 'drive';
  const chosenInterests = filters.interests || [];

  function toggleInterest(interest) {
    setFilters((current) => {
      const exists = current.interests.includes(interest);
      return {
        ...current,
        interests: exists
          ? current.interests.filter((item) => item !== interest)
          : [...current.interests, interest],
      };
    });
  }

  return (
    <section className="app-screen start-screen">
      <div className="screen-title hero-title">
        <span className="eyebrow">Family day planner</span>
        <h1>Little plans, sorted.</h1>
        <p>
          Pick a week. Set your range. Swipe your day into shape.
        </p>
        <div className="hero-badges" aria-label="Planning windows">
          <span>Morning</span>
          <span>Afternoon</span>
          <span>Evening</span>
        </div>
      </div>

      <div className="filter-card location-card">
        <div className="field-group">
          <span>Week</span>
          <strong>{formatWeekRange(filters.weekStart)}</strong>
          <p>Choose the week to plan.</p>
          <input
            type="date"
            value={filters.weekStart}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                weekStart: startOfWeekISO(event.target.value || todayISO()),
              }))
            }
          />
          <div className="week-preview">
            {weekDays.map((day) => (
              <span key={day}>{formatDay(day).split(' ')[0]}</span>
            ))}
          </div>
        </div>

        <div className="field-group">
          <span>Plan</span>
          <p>Pick a few, or browse everything.</p>
          <div className="chip-grid interest-grid">
            {activityInterestOptions.map((interest) => (
              <button
                key={interest}
                type="button"
                className={classNames('filter-chip', chosenInterests.includes(interest) && 'is-on')}
                onClick={() => toggleInterest(interest)}
              >
                {interest}
              </button>
            ))}
            <button
              type="button"
              className={classNames('filter-chip', filters.includeEvents && 'is-on')}
              onClick={() => setFilters((current) => ({ ...current, includeEvents: !current.includeEvents }))}
            >
              Events
            </button>
          </div>
        </div>

        <div className="field-group">
          <span>Start point</span>
          <strong>
            {locationStatus === 'ready' && 'Nearby on'}
            {locationStatus === 'requesting' && 'Asking...'}
            {locationStatus === 'blocked' && 'Location off'}
            {locationStatus === 'idle' && 'Location off'}
          </strong>
          <p>
            {usingDistanceFallback
              ? 'No picks in this range, so you are seeing London ideas.'
              : userLocation
              ? 'Showing closer picks first.'
              : 'Use your location or browse all.'}
          </p>
          <div className="filter-actions">
            <button className="secondary-button" type="button" onClick={onRequestLocation}>
              Nearby
            </button>
            {userLocation && (
              <button className="secondary-button warm" type="button" onClick={onShowAll}>
                All areas
              </button>
            )}
          </div>
        </div>

        <div className="field-group">
          <span>Range</span>
          <div className="distance-toggle" role="group" aria-label="Distance filter mode">
            <button
              type="button"
              className={classNames(filters.distanceMode === 'radius' && 'is-on')}
              onClick={() => setFilters((current) => ({ ...current, distanceMode: 'radius' }))}
            >
              Radius
            </button>
            <button
              type="button"
              className={classNames(isWalkMode && 'is-on')}
              onClick={() => setFilters((current) => ({ ...current, distanceMode: 'walk' }))}
            >
              Walk time
            </button>
            <button
              type="button"
              className={classNames(isDriveMode && 'is-on')}
              onClick={() => setFilters((current) => ({ ...current, distanceMode: 'drive' }))}
            >
              Drive time
            </button>
          </div>
        </div>

        <div className="range-card">
          <span>{isWalkMode ? `${filters.walkMinutes} min walk` : isDriveMode ? `${filters.driveMinutes} min drive` : `${filters.radiusMiles} miles`}</span>
          {isWalkMode || isDriveMode ? (
            <label>
              <span>{isWalkMode ? 'Walk' : 'Drive'}</span>
              <input
                type="range"
                min="5"
                max="90"
                step="5"
                value={isWalkMode ? filters.walkMinutes : filters.driveMinutes}
                onChange={(event) =>
                  setFilters((current) => isWalkMode
                    ? { ...current, walkMinutes: Number(event.target.value) }
                    : { ...current, driveMinutes: Number(event.target.value) })
                }
              />
            </label>
          ) : (
            <label>
              <span>Miles</span>
              <input
                type="range"
                min="1"
                max="15"
                step="1"
                value={filters.radiusMiles}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, radiusMiles: Number(event.target.value) }))
                }
              />
            </label>
          )}
        </div>
      </div>

      <div className="start-summary">
        <div>
          <span>Outings</span>
          <strong>{totalActivityCount}</strong>
          <small>{weekActivityCount} this week. {dayActivityCount} today. {slotActivityCount} now.</small>
        </div>
        <div className="start-actions">
          <button className="primary-action" type="button" onClick={onStart}>
            Start swiping
          </button>
          <button className="secondary-button" type="button" onClick={onResetBrowsing}>
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}

function SwipeScreen({
  weekDays,
  selectedDate,
  setSelectedDate,
  selectedWindow,
  setSelectedWindow,
  deckActivities,
  slotActivities,
  shortlist,
  chosenForSlot,
  statuses,
  selectedDateKey,
  dragState,
  loading,
  hasActivities,
  onSwipe,
  onStartDrag,
  onMoveDrag,
  onEndDrag,
  onResetSlot,
  onChoose,
  onOpenActivity,
}) {
  const topActivity = deckActivities[0];

  return (
    <section className="app-screen swipe-screen">
      <div className="planner-strip">
        <div className="date-strip" aria-label="Choose day">
          {weekDays.map((day) => (
            <button
              key={day}
              type="button"
              className={classNames('date-pill', selectedDate === day && 'is-on')}
              onClick={() => setSelectedDate(day)}
            >
              <span>{formatDay(day).split(' ')[0]}</span>
              <strong>{formatDay(day).replace(/^[A-Za-z]+ /, '')}</strong>
            </button>
          ))}
        </div>

        <div className="window-switcher" aria-label="Choose day window">
          {dayWindows.map((windowName) => (
            <button
              key={windowName}
              type="button"
              className={classNames('window-pill', selectedWindow === windowName && 'is-on')}
              onClick={() => setSelectedWindow(windowName)}
            >
              {windowName}
            </button>
          ))}
        </div>
      </div>

      <div className="swipe-status-bar">
        <div>
          <span>{formatDay(selectedDate, 'long')} - {selectedWindow}</span>
          <strong>{deckActivities.length} left - {shortlist.length} saved</strong>
        </div>
        <button type="button" onClick={onResetSlot}>Start over</button>
      </div>

      <div className="tinder-stage" aria-live="polite">
        {loading && <EmptyDeck title="Finding outings" message="Checking what fits your day." />}
        {!loading && !hasActivities && (
          <EmptyDeck
            title="Nothing to show yet"
            message="The outing list has not loaded. Check your connection, then try again."
          />
        )}
        {!loading && hasActivities && deckActivities.length === 0 && (
          <EmptyDeck
            title={slotActivities.length > 0 ? 'All caught up' : 'Nothing scheduled here'}
            message={slotActivities.length > 0
              ? 'You have swiped through this day and time. Pick from your saved ideas, tap Start over, or change the day/time above.'
              : 'Try another day or time. Weekly Happity classes appear only in their scheduled slot.'}
          />
        )}
        {!loading && deckActivities.slice(0, 1).map((activity) => {
          const stackIndex = 0;
          const isTop = activity.activity_id === topActivity?.activity_id;
          const offset = isTop && dragState.activityId === activity.activity_id ? dragState.offsetX : 0;
          const decisionClass = offset > 40 ? 'is-yes' : offset < -40 ? 'is-no' : '';
          const status = statuses[statusKey(selectedDateKey, selectedWindow, activity.activity_id)];

          return (
            <ActivityCard
              key={activity.activity_id}
              activity={activity}
              status={status}
              stackIndex={stackIndex}
              isTop={isTop}
              decisionClass={decisionClass}
              offset={offset}
              onSwipe={onSwipe}
              onStartDrag={onStartDrag}
              onMoveDrag={onMoveDrag}
              onEndDrag={onEndDrag}
              onOpenActivity={onOpenActivity}
            />
          );
        })}
      </div>

      <div className="swipe-controls">
        <button
          className="swipe-button no"
          type="button"
          disabled={!topActivity}
          onClick={() => onSwipe(topActivity, 'no')}
        >
          Skip
        </button>
        <button
          className="swipe-button info"
          type="button"
          disabled={!topActivity}
          onClick={() => onOpenActivity(topActivity)}
        >
          Details
        </button>
        <button
          className="swipe-button yes"
          type="button"
          disabled={!topActivity}
          onClick={() => onSwipe(topActivity, 'yes')}
        >
          Save
        </button>
      </div>

      <ShortlistPanel
        selectedDate={selectedDate}
        selectedWindow={selectedWindow}
        shortlist={shortlist}
        chosenForSlot={chosenForSlot}
        onChoose={onChoose}
        onOpenActivity={onOpenActivity}
      />
    </section>
  );
}

function EmptyDeck({ title, message }) {
  return (
    <div className="empty-deck">
      <span>{title}</span>
      <p>{message}</p>
    </div>
  );
}

function ActivityCard({
  activity,
  status,
  stackIndex,
  isTop,
  decisionClass,
  offset,
  onStartDrag,
  onMoveDrag,
  onEndDrag,
  onOpenActivity,
}) {
  const rotate = offset / 22;
  const stackOffset = stackIndex * 12;
  const photoUrl = activityPhotoUrl(activity);
  const photoLabel = activityPhotoLabel(activity);
  const imageStyle = photoUrl
    ? { '--card-photo': `url("${photoUrl}")` }
    : undefined;
  const cost = activityCost(activity);
  const distance = formatDistance(activity.distance ?? activity.driveDistance);
  // Google routing replaces these conservative London estimates as soon as a
  // route is available, so every card has a complete travel summary.
  const walkMinutes = activity.walkMinutes ?? (
    activity.distance == null ? null : Math.max(1, Math.round(activity.distance * 20))
  );
  const driveMinutes = activity.driveMinutes ?? (
    activity.driveDistance == null && activity.distance == null
      ? null
      : Math.max(1, Math.round((activity.driveDistance ?? activity.distance) * 6))
  );
  const walk = Number.isFinite(walkMinutes) ? `${walkMinutes} min` : null;
  const drive = Number.isFinite(driveMinutes) ? `${driveMinutes} min` : null;
  const flexible = isFlexibleActivity(activity);
  const isHappity = isHappityListing(activity);

  return (
    <article
      className={classNames('swipe-card', isTop && 'is-top', !isTop && 'is-stacked', decisionClass)}
      role="button"
      tabIndex={isTop ? 0 : -1}
      aria-label={`Open ${activity.activity_name}`}
      style={{
        transform: `translateX(${offset}px) translateY(${stackOffset}px) scale(${1 - stackIndex * 0.035}) rotate(${rotate}deg)`,
        zIndex: 10 - stackIndex,
      }}
      onClick={() => isTop && Math.abs(offset) < 8 && onOpenActivity(activity)}
      onKeyDown={(event) => {
        if (!isTop) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenActivity(activity);
        }
      }}
      onPointerDown={(event) => isTop && onStartDrag(event, activity)}
      onPointerMove={(event) => isTop && onMoveDrag(event, activity)}
      onPointerUp={() => isTop && onEndDrag(activity)}
      onPointerCancel={() => isTop && onEndDrag(activity)}
    >
      <span className="decision-stamp yes">Save</span>
      <span className="decision-stamp no">Skip</span>

      <div
        className={classNames('card-photo', photoUrl && 'has-image')}
        style={imageStyle}
      >
        <span>{photoLabel}</span>
      </div>

      <div className="card-content">
        <div className="card-kicker">
          <span>{activity.category}</span>
          {isHappity && !status ? (
            <span className="status-pill is-ghost">Happity</span>
          ) : (
            <StatusPill status={status || 'tentative'} ghost={!status} />
          )}
        </div>
        <h2>{activity.activity_name}</h2>
        <p className="card-description">
          {activity.description || 'Tap for the latest details.'}
        </p>

        <div className="card-summary">
          {flexible ? (
            <span><strong>Time</strong><small>Anytime</small></span>
          ) : (
            <>
              <span><strong>Start</strong><small>{activity.start_time}</small></span>
              <span><strong>End</strong><small>{activity.end_time}</small></span>
            </>
          )}
          {cost && (
            <span className={String(cost).length > 22 ? 'is-wide' : undefined}>
              <strong>Price</strong>
              <small>{cost}</small>
            </span>
          )}
          {distance && <span><strong>Miles</strong><small>{distance}</small></span>}
          {walk && <span><strong>Walk</strong><small>{walk}</small></span>}
          {drive && <span><strong>Drive</strong><small>{drive}</small></span>}
        </div>
      </div>
    </article>
  );
}

function ShortlistPanel({
  selectedDate,
  selectedWindow,
  shortlist,
  chosenForSlot,
  onChoose,
  onOpenActivity,
}) {
  return (
    <section className="shortlist-panel">
      <div className="section-heading">
        <span>Saved</span>
        <h2>{selectedWindow} on {formatDay(selectedDate)}</h2>
      </div>

      {chosenForSlot.length > 0 && (
        <div className="chosen-slot-card">
          <span>{chosenForSlot.length === 1 ? 'In your week' : `${chosenForSlot.length} in your week`}</span>
          {chosenForSlot.map((event) => (
            <div key={event.local_id}>
              <strong>{event.activity.activity_name}</strong>
              <small>{statusLabels[event.status]}</small>
            </div>
          ))}
        </div>
      )}

      {shortlist.length === 0 ? (
        <div className="empty-list">
          Swipe right to save.
        </div>
      ) : (
        <div className="shortlist-list">
          {shortlist.map((activity) => (
            <article key={activity.activity_id} className="shortlist-card">
              <button type="button" onClick={() => onOpenActivity(activity)}>
                <strong>{activity.activity_name}</strong>
                <span>{isFlexibleActivity(activity) ? 'Anytime' : `${activity.start_time} to ${activity.end_time}`} - {activity.category}</span>
              </button>
              <div className="shortlist-actions">
                <button type="button" onClick={() => onChoose(activity, 'tentative')}>
                  Tentative
                </button>
                <button type="button" onClick={() => onChoose(activity, 'booked')}>
                  Booked
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CalendarScreen({ weekDays, calendarEvents, onOpenActivity, onUpdateEvent, onRemoveEvent }) {
  return (
    <section className="app-screen calendar-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Week</span>
        <h1>Your plan</h1>
        <p>Booked and maybe plans.</p>
      </div>

      <div className="calendar-list">
        {weekDays.map((day) => (
          <section key={day} className="calendar-day">
            <h2>{formatDay(day, 'long')}</h2>
            {dayWindows.map((windowName) => {
              const events = calendarEvents.filter(
                (item) => item.planned_date === day && item.day_window === windowName,
              );
              return (
                <div key={`${day}-${windowName}`} className="calendar-slot">
                  <span className="slot-name">{windowName}</span>
                  {events.length > 0 ? (
                    <div className="calendar-events">
                      {events.map((event) => (
                        <article key={event.local_id} className="calendar-event">
                          <button type="button" onClick={() => onOpenActivity(event.activity)}>
                            <strong>{event.activity.activity_name}</strong>
                            <span>{isFlexibleActivity(event.activity) ? 'Anytime' : `${event.start_time} to ${event.end_time}`}</span>
                          </button>
                          <div className="calendar-controls">
                            <select
                              value={event.status}
                              onChange={(changeEvent) =>
                                onUpdateEvent(event, { status: changeEvent.target.value })
                              }
                            >
                              {statusOptions.map((status) => (
                                <option key={status} value={status}>{statusLabels[status]}</option>
                              ))}
                            </select>
                          </div>
                          <div className="export-actions">
                            <a href={buildGoogleCalendarUrl(event)} target="_blank" rel="noreferrer">
                              Google
                            </a>
                            <button type="button" onClick={() => downloadICS(event)}>
                              ICS
                            </button>
                            <button type="button" onClick={() => onRemoveEvent(event)}>
                              Remove
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <span className="open-slot">Free</span>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </section>
  );
}

function AddActivityScreen({ form, setForm, onSubmit, loading }) {
  return (
    <section className="app-screen form-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Add</span>
        <h1>Add a spot.</h1>
        <p>Paste a link. We fill the rest.</p>
      </div>

      <form className="app-form link-only-form" onSubmit={onSubmit}>
        <label className="wide">
          <span>Place or activity link</span>
          <input
            required
            value={form.activity_link}
            onChange={(event) => setForm({ activity_link: event.target.value })}
            placeholder="https://..."
          />
        </label>

        <button className="primary-action wide" type="submit" disabled={loading}>
          {loading ? 'Reading...' : 'Add'}
        </button>
      </form>
    </section>
  );
}

function ActivityDetail({
  activity,
  reviewForm,
  setReviewForm,
  submitReview,
  onClose,
}) {
  const googleUrl = googleEntryUrl(activity);
  const websiteUrl = activityWebsiteUrl(activity);
  const photoUrl = activityPhotoUrl(activity);
  const photoLabel = activityPhotoLabel(activity);
  const cost = activityCost(activity);
  const flexible = isFlexibleActivity(activity);

  return (
    <section className="app-screen activity-detail-screen">
      <button className="sheet-close detail-back-button" type="button" onClick={onClose}>
        Back
      </button>

      <div className="detail-hero">
        <div className="detail-gallery" aria-label={`${activity.activity_name} photos`}>
          {photoUrl ? (
            <div
              className={classNames('detail-photo', 'has-image', 'is-main')}
              style={{ '--card-photo': `url("${photoUrl}")` }}
            >
              <span>{photoLabel}</span>
            </div>
          ) : (
            <div className="detail-photo is-main">
              <span>Photo pending</span>
            </div>
          )}
        </div>
      </div>

      <div className="detail-content-card">
        <p className="eyebrow">{activity.category}</p>
        <h1>{activity.activity_name}</h1>
        <p className="detail-description">
          {activity.description || 'Description coming soon. Check the links for the latest details.'}
        </p>

        <div className="detail-grid">
          {flexible ? (
            <span><strong>Time</strong><small>Anytime</small></span>
          ) : (
            <>
              <span><strong>Start</strong><small>{activity.start_time}</small></span>
              <span><strong>End</strong><small>{activity.end_time}</small></span>
            </>
          )}
          <span className={String(cost || '').length > 22 ? 'is-wide' : undefined}>
            <strong>Price</strong>
            <small>{cost || 'Check venue'}</small>
          </span>
          {shouldShowAvailability(activity) && (
            <span className="is-wide">
              <strong>Dates</strong>
              <small>{formatAvailability(activity)}</small>
            </span>
          )}
          <span><strong>Age</strong><small>{activity.age_suitability || 'Under 5s'}</small></span>
        </div>

        <div className="external-links detail-links">
          <a href={websiteUrl} target="_blank" rel="noreferrer">Website</a>
          <a href={googleUrl} target="_blank" rel="noreferrer">Google Places</a>
        </div>
      </div>

      <form className="review-card" onSubmit={submitReview}>
        <h3>Quick review</h3>
        <label>
          <span>Rating</span>
          <input
            type="number"
            min="1"
            max="5"
            value={reviewForm.rating}
            onChange={(event) => setReviewForm((current) => ({ ...current, rating: event.target.value }))}
          />
        </label>
        <label>
          <span>Comment</span>
          <textarea
            value={reviewForm.comments}
            onChange={(event) => setReviewForm((current) => ({ ...current, comments: event.target.value }))}
            placeholder="Buggy access, baby change, vibe..."
          />
        </label>
        <label>
          <span>Photo URL</span>
          <input
            value={reviewForm.photo_url}
            onChange={(event) => setReviewForm((current) => ({ ...current, photo_url: event.target.value }))}
            placeholder="https://..."
          />
        </label>
        <button className="primary-action" type="submit">Save</button>
      </form>
    </section>
  );
}

function StatusPill({ status, ghost = false }) {
  return (
    <span className={classNames('status-pill', `status-${status}`, ghost && 'is-ghost')}>
      {ghost ? 'New' : statusLabels[status]}
    </span>
  );
}

function BottomNav({ activeScreen, setActiveScreen }) {
  const items = [
    ['start', 'Plan'],
    ['swipe', 'Swipe'],
    ['calendar', 'Week'],
    ['add', 'Add'],
  ];

  return (
    <nav className="bottom-nav" aria-label="App navigation">
      {items.map(([screen, label]) => (
        <button
          key={screen}
          type="button"
          className={classNames(activeScreen === screen && 'is-on')}
          onClick={() => setActiveScreen(screen)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
