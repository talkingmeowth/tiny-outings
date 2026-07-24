import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

const dayWindows = ['morning', 'afternoon', 'evening'];
const storagePrefix = 'tiny-outings';
// Reset outdated swipe/filter state without touching planned calendar entries.
const planningStorageVersion = '2026-07-23-source-and-category-filters';
const statusOptions = ['booked', 'tentative'];
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
  'organiser_website',
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
  'plan_filters',
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
  'Cafes & food',
  'Parks & outdoor play',
  'Music & singing',
  'Stay & play',
  'Movement & dance',
  'Sensory & development',
  'Stories, books & crafts',
  'Museums & culture',
  'Family events & cinema',
  'Parent support & meet-ups',
];

const ageFilterOptions = [
  { value: 'all', label: 'Any age' },
  { value: 'baby', label: 'Baby', minMonths: 0, maxMonths: 12 },
  { value: 'toddler', label: 'Toddler', minMonths: 12, maxMonths: 36 },
  { value: 'preschool', label: 'Preschool', minMonths: 36, maxMonths: 60 },
  { value: 'five-plus', label: '5+', minMonths: 60, maxMonths: 216 },
];

function defaultFilters() {
  return {
    distanceMode: 'radius',
    radiusMiles: 10,
    walkMinutes: 35,
    driveMinutes: 25,
    weekStart: startOfWeekISO(todayISO()),
    interests: [...activityInterestOptions],
    source: [],
    ageRange: 'all',
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
    plan_filters: Array.isArray(activity.plan_filters) ? activity.plan_filters : [],
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
    image_url: activity.image_url || activity.photo_url || null,
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
    !activity.start_time ||
    !activity.end_time ||
    category.includes('park') ||
    name.includes('park') ||
    activity.availability_type === 'daily' ||
    (dailyDays && !activity.schedule_notes)
  );
}

function activityMatchesWindow(activity, window) {
  if (isFlexibleActivity(activity)) return true;

  const minutes = (time) => {
    const [hours = '0', minutesPart = '0'] = String(time || '').split(':');
    return Number(hours) * 60 + Number(minutesPart);
  };
  const windows = {
    morning: [0, 12 * 60],
    afternoon: [12 * 60, 17 * 60],
    evening: [17 * 60, 24 * 60],
  };
  const [windowStart, windowEnd] = windows[window] || windows.morning;
  const start = minutes(activity.start_time);
  const end = minutes(activity.end_time);

  // Consolidated listings can span multiple session times, so include them in
  // every planning window that overlaps their earliest-to-latest range.
  return start < windowEnd && end > windowStart;
}

function isTermTimeOnly(activity) {
  const availability = [
    activity.availability_notes,
    activity.schedule_notes,
    activity.availability_type,
  ].filter(Boolean).join(' ').toLowerCase();
  return /term[\s-]?time/.test(availability) && !/all year|year round/.test(availability);
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

function googleMapEmbedUrl(activity) {
  const latitude = numericOrNull(activity.lat);
  const longitude = numericOrNull(activity.long);
  const query = latitude != null && longitude != null
    ? `${latitude},${longitude}`
    : `${activity.activity_name || ''} ${activity.address || ''}`.trim();

  if (!query) return null;
  // This public iframe URL does not use a Google Maps Platform API key.
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`;
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
  ].some((blocked) => value.includes(blocked));
}

function securePhotoUrl(url) {
  return String(url || '').replace(/^http:\/\//i, 'https://');
}

function activityFallbackImage(activity) {
  const category = String(activity.category || '').toLowerCase();
  return category.includes('park')
    ? '/images/park-placeholder.svg'
    : category.includes('book')
      ? '/images/bookshop-placeholder.svg'
      : category.includes('cafe')
        ? '/images/family-cafe-placeholder.svg'
        : '/images/family-outing-placeholder.svg';
}

function activityPhotoUrls(activity) {
  const fallbackImage = activityFallbackImage(activity);
  const candidates = [
    activity.image_url,
    activity.photo_url,
    fallbackImage,
  ].map(securePhotoUrl).filter(isUsablePhotoUrl);

  return [...new Set(candidates)];
}

function activityPhotoUrl(activity) {
  return activityPhotoUrls(activity)[0] || null;
}

function ActivityPhoto({ activity, className }) {
  const photoUrl = activityPhotoUrl(activity);
  const fallbackImage = activityFallbackImage(activity);

  return (
    <div className={classNames(className, 'has-image')}>
      <img
        className="activity-photo-image"
        src={photoUrl || fallbackImage}
        alt=""
        aria-hidden="true"
        onError={(event) => {
          // A bad remote image must never leave the card blank on a mobile connection.
          if (event.currentTarget.dataset.usedFallback === 'true') return;
          event.currentTarget.dataset.usedFallback = 'true';
          event.currentTarget.src = fallbackImage;
        }}
      />
    </div>
  );
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
  return selectedCategories.has(activityPlanLabel(activity));
}

function activityPlanLabel(activity) {
  const category = String(activity.category || '').toLowerCase();
  const filters = Array.isArray(activity.plan_filters) ? activity.plan_filters.join(' ').toLowerCase() : '';
  const value = `${category} ${filters}`;

  if (/cafe|coffee|food|lunch|bakery/.test(value)) return 'Cafes & food';
  if (/park|outdoor/.test(value)) return 'Parks & outdoor play';
  if (/music|sing/.test(value)) return 'Music & singing';
  if (/stay|soft play|family hub|play centre/.test(value)) return 'Stay & play';
  if (/dance|movement|yoga|swim|fitness/.test(value)) return 'Movement & dance';
  if (/sensory|development|massage|signing/.test(value)) return 'Sensory & development';
  if (/story|rhyme|book|craft|art/.test(value)) return 'Stories, books & crafts';
  if (/museum|culture/.test(value)) return 'Museums & culture';
  if (/support|feeding|postnatal|meet.?up/.test(value)) return 'Parent support & meet-ups';
  return 'Family events & cinema';
}

function ageEndpointInMonths(value) {
  const years = [...String(value || '').matchAll(/(\d+)\s*(?:year|years|yr|yrs)/gi)]
    .reduce((total, match) => total + Number(match[1]) * 12, 0);
  const months = [...String(value || '').matchAll(/(\d+)\s*(?:month|months|mo|mos)/gi)]
    .reduce((total, match) => total + Number(match[1]), 0);
  const total = years + months;
  return total > 0 || /\b0\s*(?:month|months|mo|mos)\b/i.test(value) ? total : null;
}

function activityAgeRange(activity) {
  const value = String(activity.age_suitability || '').toLowerCase();
  if (!value || /all ages|all parents|famil(?:y|ies)|babies and young children|under 5s/.test(value)) {
    return { minMonths: 0, maxMonths: 216 };
  }
  const underMatch = value.match(/under\s+(\d+)\s*(year|years|month|months|yr|yrs|mo|mos)?/i);
  if (underMatch) {
    const unit = underMatch[2] || 'years';
    return { minMonths: 0, maxMonths: Number(underMatch[1]) * (/month|mo/i.test(unit) ? 1 : 12) };
  }
  if (value.includes('+')) {
    const minMonths = ageEndpointInMonths(value);
    return minMonths == null ? null : { minMonths, maxMonths: 216 };
  }
  const [minimumText, maximumText] = value.split(/\s*(?:-|to)\s*/i);
  const minMonths = ageEndpointInMonths(minimumText);
  const maxMonths = maximumText ? ageEndpointInMonths(maximumText) : null;
  if (minMonths == null) return null;
  return { minMonths, maxMonths: maxMonths ?? 216 };
}

function activityMatchesAge(activity, ageRange) {
  if (ageRange === 'all') return true;
  const selected = ageFilterOptions.find((option) => option.value === ageRange);
  const activityRange = activityAgeRange(activity);
  if (!selected || !activityRange) return true;
  return activityRange.minMonths <= selected.maxMonths && activityRange.maxMonths >= selected.minMonths;
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

function activitySourceLabel(activity) {
  const source = String(activity.data_source || '').trim().toLowerCase();
  const sourceName = String(activity.source_name || '').toLowerCase();
  const searchableSource = `${source} ${sourceName} ${activity.source_url || ''}`.toLowerCase();

  if (searchableSource.includes('happity')) return 'Happity';
  if (searchableSource.includes('timeout.com') || sourceName.includes('time out')) return 'Time Out London';
  if (searchableSource.includes('loopla')) return 'Loopla';
  if (sourceName.includes('museums london')) return 'Museums London';
  if (searchableSource.includes('eventbrite')) return 'Eventbrite';
  if (searchableSource.includes('fever')) return 'Fever';
  if (searchableSource.includes('better start') || searchableSource.includes('best start')) return 'Better Start for Life';
  if (source === 'google places' || source === 'google_places' || sourceName.includes('google places')) return 'Google Places';
  if (source === 'local directory' || sourceName.includes('directory')) return 'Local directory';
  return 'Other';
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
      source: Array.isArray(stored.source)
        ? stored.source
        : stored.source && stored.source !== 'all'
          ? [stored.source]
          : defaults.source,
      ageRange: ageFilterOptions.some((option) => option.value === stored.ageRange)
        ? stored.ageRange
        : defaults.ageRange,
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
  // Keep Plan controls responsive while the directory catches up with a changed filter.
  const deferredFilters = useDeferredValue(filters);
  const selectedCategorySet = useMemo(
    () => new Set(deferredFilters.interests),
    [deferredFilters.interests],
  );
  const allCategoriesSelected = selectedCategorySet.size === activityInterestOptions.length;
  const selectedSourceSet = useMemo(
    () => new Set(deferredFilters.source),
    [deferredFilters.source],
  );

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
      distance: milesBetween(userLocation, { lat: activity.lat, long: activity.long }),
    })),
    [allActivities, userLocation],
  );

  const publishedActivityCount = useMemo(
    () => allActivities.filter((activity) => activity.public_listing_status === 'published').length,
    [allActivities],
  );
  const sourceOptions = useMemo(
    () => [...new Set(allActivities.map(activitySourceLabel))].sort((left, right) => left.localeCompare(right)),
    [allActivities],
  );
  const baseFilteredActivities = useMemo(
    () => activitiesWithDistance.filter((activity) => {
      return activity.public_listing_status === 'published'
        && activityMatchesInterests(activity, selectedCategorySet, allCategoriesSelected)
        && (selectedSourceSet.size === 0 || selectedSourceSet.has(activitySourceLabel(activity)))
        && activityMatchesAge(activity, deferredFilters.ageRange);
    }),
    [activitiesWithDistance, selectedCategorySet, allCategoriesSelected, deferredFilters.ageRange, selectedSourceSet],
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
      .filter((activity) => activityMatchesWindow(activity, selectedWindow))
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
            sourceOptions={sourceOptions}
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
  sourceOptions,
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

  function toggleSource(source) {
    setFilters((current) => {
      const selected = current.source || [];
      return {
        ...current,
        source: selected.includes(source)
          ? selected.filter((item) => item !== source)
          : [...selected, source],
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
          </div>
        </div>

        <div className="field-group source-filter">
          <span>Source</span>
          <details className="source-picker">
            <summary>
              {filters.source.length === 0 ? 'All sources' : `${filters.source.length} selected`}
            </summary>
            <div className="source-options" role="group" aria-label="Activity sources">
              {sourceOptions.map((source) => (
                <label key={source}>
                  <input
                    type="checkbox"
                    checked={filters.source.includes(source)}
                    onChange={() => toggleSource(source)}
                  />
                  <span>{source}</span>
                </label>
              ))}
            </div>
          </details>
        </div>

        <div className="field-group">
          <span>Child's age</span>
          <p>Show activities that suit their stage.</p>
          <div className="chip-grid age-grid" role="group" aria-label="Child age filter">
            {ageFilterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={classNames('filter-chip', filters.ageRange === option.value && 'is-on')}
                onClick={() => setFilters((current) => ({ ...current, ageRange: option.value }))}
              >
                {option.label}
              </button>
            ))}
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
  const cost = activityCost(activity);
  const distance = formatDistance(activity.distance);
  // Travel estimates use the local straight-line distance, without an external routing API.
  const walkMinutes = activity.distance == null ? null : Math.max(1, Math.round(activity.distance * 20));
  const driveMinutes = activity.distance == null ? null : Math.max(1, Math.round(activity.distance * 6));
  const walk = Number.isFinite(walkMinutes) ? `${walkMinutes} min` : null;
  const drive = Number.isFinite(driveMinutes) ? `${driveMinutes} min` : null;
  const flexible = isFlexibleActivity(activity);
  const sourceLabel = activitySourceLabel(activity);
  const termTimeOnly = isTermTimeOnly(activity);

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

      <ActivityPhoto activity={activity} className="card-photo" />

      <div className="card-content">
        <div className="card-kicker">
          <div className="card-tags">
            <span>{activityPlanLabel(activity)}</span>
            {termTimeOnly && <span className="term-time-badge">Term time</span>}
          </div>
          <div className="card-tags">
            <span className="status-pill is-ghost">{sourceLabel}</span>
            {status && <StatusPill status={status} />}
          </div>
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
                <span>{isFlexibleActivity(activity) ? 'Anytime' : `${activity.start_time} to ${activity.end_time}`} - {activityPlanLabel(activity)}</span>
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
  const mapEmbedUrl = googleMapEmbedUrl(activity);
  const websiteUrl = activityWebsiteUrl(activity);
  const organiserWebsiteUrl = activity.organiser_website || null;
  const cost = activityCost(activity);
  const flexible = isFlexibleActivity(activity);

  return (
    <section className="app-screen activity-detail-screen">
      <button className="sheet-close detail-back-button" type="button" onClick={onClose}>
        Back
      </button>

      <div className="detail-hero">
        <div className="detail-gallery" aria-label={`${activity.activity_name} photos`}>
          <ActivityPhoto activity={activity} className="detail-photo is-main" />
        </div>
      </div>

      <div className="detail-content-card">
        <p className="eyebrow">{activityPlanLabel(activity)}</p>
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

        {mapEmbedUrl && (
          <figure className="detail-map">
            <iframe
              title={`Map for ${activity.activity_name}`}
              src={mapEmbedUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
            <figcaption>Map preview</figcaption>
          </figure>
        )}

        <div className="external-links detail-links">
          <a href={websiteUrl} target="_blank" rel="noreferrer">Website</a>
          {organiserWebsiteUrl && (
            <a href={organiserWebsiteUrl} target="_blank" rel="noreferrer">Organiser site</a>
          )}
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

function StatusPill({ status }) {
  return (
    <span className={classNames('status-pill', `status-${status}`)}>
      {statusLabels[status]}
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
