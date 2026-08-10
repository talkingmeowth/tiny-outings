import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import L from 'leaflet';
import 'leaflet.heat';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { completeNativeGoogleSignIn, supabase } from './supabaseClient';

const dayWindows = ['morning', 'afternoon', 'evening'];
const storagePrefix = 'tiny-outings';
const adminEmail = 'talkingmeowth06@gmail.com';
const nativeAuthCallback = 'com.tinyoutings.app://auth/callback';
// Reset outdated swipe/filter state without touching planned calendar entries.
const planningStorageVersion = '2026-07-24-seven-plan-categories';
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
  'scraped_image_url',
  'user_image_url',
  'wikimedia_image_url',
  'website_image_url',
  'listing_image_url',
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
  'submitted_by_user_id',
  'created_at',
].join(',');
const statusLabels = {
  booked: 'Booked',
  tentative: 'Tentative',
  not_selected: 'Not selected',
};

const emptyLinkForm = {
  activity_name: '',
  category: '',
  website: '',
  google_places_link: '',
  photos: [],
};

const emptyReviewForm = {
  rating: 5,
  comments: '',
  photos: [],
};

const maxUploadedPhotos = 5;
const maxPhotoBytes = 8 * 1024 * 1024;

const activityInterestOptions = [
  'Cafes & food',
  'Parks & outdoor play',
  'Stay & play',
  'Classes & clubs',
  'Movement & wellbeing',
  'Museums & culture',
  'Bookshops',
  'Events',
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
    scraped_image_url: activity.scraped_image_url || null,
    user_image_url: activity.user_image_url || null,
    wikimedia_image_url: activity.wikimedia_image_url || null,
    website_image_url: activity.website_image_url || null,
    listing_image_url: activity.listing_image_url || null,
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

function activityConcentrations(activities) {
  const cells = new Map();
  for (const activity of activities) {
    const lat = numericOrNull(activity.lat);
    const long = numericOrNull(activity.long);
    if (lat == null || long == null) continue;
    // Roughly 1.2 km cells make a readable London-wide activity heat map.
    const key = `${Math.round(lat * 85) / 85}:${Math.round(long * 55) / 55}`;
    const existing = cells.get(key) || { lat: 0, long: 0, count: 0, activities: [] };
    existing.lat += lat;
    existing.long += long;
    existing.count += 1;
    if (existing.activities.length < 3) existing.activities.push(activity.activity_name);
    cells.set(key, existing);
  }
  return [...cells.values()]
    .map((cell) => ({ ...cell, lat: cell.lat / cell.count, long: cell.long / cell.count }))
    .sort((left, right) => right.count - left.count);
}

function shuffleActivities(activities) {
  const shuffled = [...activities];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function ActivityHeatLayer({ activities }) {
  const map = useMap();

  useEffect(() => {
    const points = activities
      .map((activity) => [numericOrNull(activity.lat), numericOrNull(activity.long), 1])
      .filter(([lat, long]) => lat != null && long != null);
    const layer = L.heatLayer(points, {
      radius: 48,
      blur: 34,
      minOpacity: 0.36,
      maxZoom: 11,
      max: 5,
      gradient: {
        0.2: '#5cb9ea',
        0.45: '#70d6a7',
        0.65: '#f7c948',
        0.82: '#f28a5d',
        1: '#c94762',
      },
    }).addTo(map);
    return () => map.removeLayer(layer);
  }, [activities, map]);

  return null;
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

function buildICSEvent(event, created) {
  const activity = event.activity;
  return [
    'BEGIN:VEVENT',
    `UID:${event.local_id}@tiny-outings`,
    `DTSTAMP:${created}`,
    `DTSTART;TZID=Europe/London:${dateStampForCalendar(event.planned_date, event.start_time)}`,
    `DTEND;TZID=Europe/London:${dateStampForCalendar(event.planned_date, event.end_time)}`,
    `SUMMARY:${cleanICS(event.title_override || activity.activity_name)}`,
    `DESCRIPTION:${cleanICS(activity.description || 'Planned in Tiny Outings')}`,
    `LOCATION:${cleanICS(activity.address)}`,
    'END:VEVENT',
  ];
}

function buildICS(events) {
  const created = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tiny Outings//Parent Planner//EN',
    'CALSCALE:GREGORIAN',
    ...events.flatMap((event) => buildICSEvent(event, created)),
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadICS(events, filename) {
  const blob = new Blob([buildICS(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function classNames(...names) {
  return names.filter(Boolean).join(' ');
}

function googleEntryUrl(activity) {
  const latitude = numericOrNull(activity.lat);
  const longitude = numericOrNull(activity.long);
  const query = latitude != null && longitude != null
    ? `${latitude},${longitude}`
    : `${activity.activity_name || ''} ${activity.address || ''}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function googleMapsAppUrl(activity) {
  const latitude = numericOrNull(activity.lat);
  const longitude = numericOrNull(activity.long);
  const label = encodeURIComponent(activity.activity_name || 'Tiny Outing');
  if (latitude != null && longitude != null) {
    return `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`;
  }
  return googleEntryUrl(activity);
}

function openGoogleMaps(activity) {
  const destination = Capacitor.isNativePlatform() ? googleMapsAppUrl(activity) : googleEntryUrl(activity);
  window.location.assign(destination);
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

function isGooglePlacesUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'maps.app.goo.gl'
      || host.endsWith('.google.com')
      || host === 'google.com'
      || host.endsWith('.google.co.uk');
  } catch {
    return false;
  }
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
    activity.user_image_url,
    activity.scraped_image_url,
    activity.wikimedia_image_url,
    activity.website_image_url,
    activity.listing_image_url,
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
        loading="lazy"
        decoding="async"
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

function profileUsername(user) {
  const requested = String(user?.user_metadata?.user_name || user?.user_metadata?.preferred_username || user?.email || '')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, 20);
  const suffix = String(user?.id || '').replace(/-/g, '').slice(0, 8);
  const base = requested.length >= 3 ? requested : 'parent';
  return `${base}_${suffix}`.slice(0, 30);
}

function profileDisplayName(user) {
  return user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Tiny Outings parent';
}

function profileAvatar(profile) {
  const name = profile?.display_name || profile?.user_name || 'T';
  return String(name).trim().slice(0, 1).toUpperCase();
}

function activityShareUrl(activity) {
  return activity.website || activity.organiser_website || activity.source_url || googleEntryUrl(activity);
}

function activityShareText(activity) {
  const timing = isFlexibleActivity(activity) ? 'Anytime' : `${activity.start_time} to ${activity.end_time}`;
  return `Fancy this Tiny Outing? ${activity.activity_name} - ${timing}.`;
}

function socialShareUrl(provider, activity) {
  const url = activityShareUrl(activity);
  const message = `${activityShareText(activity)} ${url}`;
  if (provider === 'whatsapp') return `https://wa.me/?text=${encodeURIComponent(message)}`;
  if (provider === 'facebook') return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  return url;
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
  if (isEventListing(activity)) return 'Events';

  const category = String(activity.category || '').toLowerCase();
  const filters = Array.isArray(activity.plan_filters) ? activity.plan_filters.join(' ').toLowerCase() : '';
  const value = `${category} ${filters}`;

  if (/cafe|coffee|food|lunch|bakery/.test(value)) return 'Cafes & food';
  if (/park|outdoor/.test(value)) return 'Parks & outdoor play';
  if (/bookshop|book shop|bookstore|book store/.test(value)) return 'Bookshops';
  if (/stay|soft play|family hub|play centre/.test(value)) return 'Stay & play';
  if (/dance|movement|yoga|swim|fitness/.test(value)) return 'Movement & wellbeing';
  if (/museum|culture/.test(value)) return 'Museums & culture';
  return 'Classes & clubs';
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
  return /eventbrite|fever|loopla/i.test([
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
  if (searchableSource.includes('loopla') || searchableSource.includes('eventbrite') || searchableSource.includes('fever')) return 'Events';
  if (sourceName.includes('museums london')) return 'Museums London';
  if (searchableSource.includes('better start') || searchableSource.includes('best start')) return 'Better Start for Life';
  if (source === 'google places' || source === 'google_places' || sourceName.includes('google places')) return 'Google Places';
  if (source === 'local directory' || sourceName.includes('directory')) return 'Local directory';
  return 'Other';
}

function isEventListing(activity) {
  // Keep the Plan filter aligned with the source badge on activity cards.
  return activitySourceLabel(activity) === 'Events';
}

function buildSubmittedPayload(enriched, submissionLink, websiteLink, googlePlacesLink, userId = null) {
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
    google_link: googlePlacesLink || enriched.google_link || enriched.google_place_uri || null,
    website: enriched.website || websiteLink || null,
    child_friendly_score: numericOrNull(enriched.child_friendly_score),
    app_rating: appRating,
    number_of_reviews: Number.isFinite(reviewCount) ? reviewCount : 0,
    age_suitability: enriched.age_suitability || 'Under 5s',
    description: enriched.description || null,
    cost: enriched.cost || null,
    source_name: googlePlacesLink ? 'Google Places link submission' : 'Website link submission',
    source_url: submissionLink,
    public_listing_status: 'draft',
    submitted_by_user_id: userId,
    google_place_id: enriched.google_place_id || null,
    google_place_uri: googlePlacesLink || enriched.google_place_uri || enriched.google_link || null,
    google_photo_url: enriched.google_photo_url || null,
    google_rating: numericOrNull(enriched.google_rating),
    google_user_rating_count: Number(enriched.google_user_rating_count ?? reviewCount ?? 0),
    google_primary_type: enriched.google_primary_type || null,
    google_opening_hours: enriched.google_opening_hours || null,
    google_summary: enriched.google_summary || null,
    image_url: enriched.image_url || enriched.google_photo_url || null,
    image_source_url: enriched.image_source_url || enriched.website || googlePlacesLink || websiteLink || submissionLink,
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

function acceptedPhotoFiles(fileList) {
  return Array.from(fileList || [])
    .filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    .filter((file) => file.size <= maxPhotoBytes)
    .slice(0, maxUploadedPhotos);
}

function activityPhotoPath(activityId, file) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${activityId}/${id}.${extension}`;
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
  const [reviewForm, setReviewForm] = useState(emptyReviewForm);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [activityPhotos, setActivityPhotos] = useState([]);
  const [activityPhotosLoading, setActivityPhotosLoading] = useState(false);
  const [returnScreen, setReturnScreen] = useState('swipe');
  const [dragState, setDragState] = useState({ activityId: null, startX: null, offsetX: 0 });
  const [session, setSession] = useState(null);
  const [entryChoice, setEntryChoice] = useState(() => loadStored('entry-choice', null));
  const [authLoading, setAuthLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [communityProfiles, setCommunityProfiles] = useState([]);
  const [followingIds, setFollowingIds] = useState([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewQueueLoading, setReviewQueueLoading] = useState(false);
  const [adminSaving, setAdminSaving] = useState(false);
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
  const isAdmin = session?.user?.email?.toLowerCase() === adminEmail;
  const signedInUser = session?.user || null;

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
    () => {
      const matchingWindow = filteredActivities
        .filter((activity) => activityMatchesWindow(activity, selectedWindow));
      // Shuffle once when this date/window deck is assembled. Swiping itself
      // does not reshuffle, so the next card stays stable during a gesture.
      return shuffleActivities(matchingWindow);
    },
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
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session || null);
      if (data.session) setEntryChoice('google');
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      if (nextSession) setEntryChoice('google');
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !signedInUser) {
      setProfile(null);
      setCommunityProfiles([]);
      setFollowingIds([]);
      return undefined;
    }

    let cancelled = false;
    async function loadCommunity() {
      const userId = signedInUser.id;
      let { data: ownProfile } = await supabase
        .from('user_table')
        .select('user_id,user_name,display_name,avatar_url,followers,following')
        .eq('user_id', userId)
        .maybeSingle();

      if (!ownProfile) {
        const { data } = await supabase
          .from('user_table')
          .upsert({
            user_id: userId,
            user_name: profileUsername(signedInUser),
            display_name: profileDisplayName(signedInUser),
            avatar_url: signedInUser.user_metadata?.avatar_url || signedInUser.user_metadata?.picture || null,
          }, { onConflict: 'user_id' })
          .select('user_id,user_name,display_name,avatar_url,followers,following')
          .maybeSingle();
        ownProfile = data;
      }

      const [{ data: profiles }, { data: follows }] = await Promise.all([
        supabase
          .from('user_table')
          .select('user_id,user_name,display_name,avatar_url,followers,following')
          .neq('user_id', userId)
          .order('followers', { ascending: false })
          .limit(20),
        supabase
          .from('user_follows')
          .select('followed_user_id')
          .eq('follower_user_id', userId),
      ]);

      if (cancelled) return;
      setProfile(ownProfile || null);
      setCommunityProfiles(profiles || []);
      setFollowingIds((follows || []).map((follow) => String(follow.followed_user_id)));
    }

    loadCommunity();
    return () => {
      cancelled = true;
    };
  }, [signedInUser]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const handleCallback = async ({ url }) => {
      if (!url.startsWith(nativeAuthCallback)) return;
      setAuthLoading(true);
      const { error } = await completeNativeGoogleSignIn(url);
      if (error) setNotice(`Google sign-in could not finish: ${error.message}`);
      else await Browser.close();
      setAuthLoading(false);
    };
    // Android can create a fresh activity when Chrome redirects back, before
    // the event listener exists. Read its launch URL as well as live events.
    CapacitorApp.getLaunchUrl().then((launch) => {
      if (launch?.url) handleCallback({ url: launch.url });
    });
    const listener = CapacitorApp.addListener('appUrlOpen', handleCallback);
    return () => {
      listener.then((handle) => handle.remove());
    };
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

  useEffect(() => {
    if (!supabase || !isAdmin) {
      setReviewQueue([]);
      return undefined;
    }

    let cancelled = false;
    async function loadReviewQueue() {
      setReviewQueueLoading(true);
      const { data, error } = await supabase
        .from('activities')
        .select(activitySelectColumns)
        .eq('public_listing_status', 'draft')
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setReviewQueueLoading(false);
      if (error) {
        setNotice(`Review queue could not be loaded: ${error.message}`);
        return;
      }
      setReviewQueue((data || []).map(normalizeActivity));
    }

    loadReviewQueue();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;

    async function loadActivityPhotos() {
      if (!selectedActivity?.activity_id || !supabase) {
        setActivityPhotos([]);
        setActivityPhotosLoading(false);
        return;
      }

      setActivityPhotosLoading(true);
      const { data, error } = await supabase
        .from('activity_photos')
        .select('photo_id,photo_url,caption,created_at,source_provider')
        .eq('activity_id', selectedActivity.activity_id)
        .eq('source_provider', 'user_upload')
        .order('created_at', { ascending: false });

      if (!cancelled) {
        setActivityPhotos(error ? [] : (data || []));
        setActivityPhotosLoading(false);
      }
    }

    loadActivityPhotos();
    return () => {
      cancelled = true;
    };
  }, [selectedActivity?.activity_id]);

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

  async function signInWithGoogle() {
    if (!supabase) {
      setNotice('Sign-in is not configured in this build.');
      return;
    }

    setAuthLoading(true);
    const isNativeApp = Capacitor.isNativePlatform();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: isNativeApp ? nativeAuthCallback : window.location.origin,
        skipBrowserRedirect: isNativeApp,
      },
    });
    if (error || !data?.url) {
      setNotice(`Google sign-in could not start: ${error?.message || 'No sign-in link was returned.'}`);
      setAuthLoading(false);
      return;
    }

    try {
      if (isNativeApp) await Browser.open({ url: data.url });
      else window.location.assign(data.url);
    } catch {
      setNotice('Google sign-in could not open. Please try again.');
      setAuthLoading(false);
    }
  }

  function continueAsGuest() {
    saveStored('entry-choice', 'guest');
    setEntryChoice('guest');
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(`Could not sign out: ${error.message}`);
    else {
      removeStored('entry-choice');
      setEntryChoice(null);
    }
  }

  async function saveProfile(values) {
    if (!supabase || !session?.user) {
      setNotice('Sign in to save your profile.');
      return;
    }
    const userName = values.user_name.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,30}$/.test(userName)) {
      setNotice('Choose 3 to 30 letters, numbers, dots, or underscores.');
      return;
    }

    setProfileSaving(true);
    const { data, error } = await supabase
      .from('user_table')
      .update({
        user_name: userName,
        display_name: values.display_name.trim() || userName,
        avatar_url: values.avatar_url.trim() || null,
      })
      .eq('user_id', session.user.id)
      .select('user_id,user_name,display_name,avatar_url,followers,following')
      .single();
    setProfileSaving(false);
    if (error) {
      setNotice(`Profile could not be saved: ${error.message}`);
      return;
    }
    setProfile(data);
    setNotice('Profile saved.');
  }

  async function toggleFollow(person) {
    if (!supabase || !session?.user) {
      setNotice('Sign in to follow other parents.');
      return;
    }
    const personId = String(person.user_id);
    const alreadyFollowing = followingIds.includes(personId);
    const request = alreadyFollowing
      ? supabase
        .from('user_follows')
        .delete()
        .eq('follower_user_id', session.user.id)
        .eq('followed_user_id', personId)
      : supabase
        .from('user_follows')
        .insert({ follower_user_id: session.user.id, followed_user_id: personId });
    const { error } = await request;
    if (error) {
      setNotice(`Could not update follow: ${error.message}`);
      return;
    }

    const adjustment = alreadyFollowing ? -1 : 1;
    setFollowingIds((current) => (
      alreadyFollowing ? current.filter((id) => id !== personId) : [...current, personId]
    ));
    setProfile((current) => current ? { ...current, following: Math.max(0, Number(current.following || 0) + adjustment) } : current);
    setCommunityProfiles((current) => current.map((item) => (
      String(item.user_id) === personId
        ? { ...item, followers: Math.max(0, Number(item.followers || 0) + adjustment) }
        : item
    )));
  }

  async function shareActivity(activity) {
    const shareData = {
      title: activity.activity_name,
      text: activityShareText(activity),
      url: activityShareUrl(activity),
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard?.writeText(`${shareData.text} ${shareData.url}`);
      setNotice('Activity link copied.');
    } catch (error) {
      if (error?.name !== 'AbortError') setNotice('Could not open sharing. Try WhatsApp or Facebook below.');
    }
  }

  async function saveAdminActivityEdits(activity, values) {
    if (!supabase || !isAdmin) return;
    const updates = {
      user_image_url: values.user_image_url || null,
      website: values.website || null,
      organiser_website: values.organiser_website || null,
      google_link: values.google_link || null,
      google_place_uri: values.google_link || null,
    };
    setAdminSaving(true);
    const { data, error } = await supabase
      .from('activities')
      .update(updates)
      .eq('activity_id', activity.activity_id)
      .select(activitySelectColumns)
      .single();
    setAdminSaving(false);
    if (error) {
      setNotice(`Listing update could not be saved: ${error.message}`);
      return;
    }
    const updatedActivity = normalizeActivity(data);
    setActivities((current) => current.map((item) => (
      String(item.activity_id) === String(updatedActivity.activity_id) ? updatedActivity : item
    )));
    setSelectedActivity(updatedActivity);
    setNotice('Listing correction saved for future importer review.');
  }

  async function archiveAdminActivity(activity) {
    if (!supabase || !isAdmin) return;
    if (!window.confirm(`Archive ${activity.activity_name}? It will no longer appear in the app.`)) return;

    setAdminSaving(true);
    const { error } = await supabase
      .from('activities')
      .update({ public_listing_status: 'archived' })
      .eq('activity_id', activity.activity_id);
    setAdminSaving(false);
    if (error) {
      setNotice(`Listing could not be archived: ${error.message}`);
      return;
    }

    setActivities((current) => current.filter((item) => String(item.activity_id) !== String(activity.activity_id)));
    closeActivity();
    setNotice('Listing archived.');
  }

  async function reviewSubmittedActivity(activity, status) {
    if (!supabase || !isAdmin) return;
    const label = status === 'published' ? 'approve' : 'archive';
    if (!window.confirm(`${label[0].toUpperCase()}${label.slice(1)} ${activity.activity_name}?`)) return;

    setAdminSaving(true);
    const { data, error } = await supabase
      .from('activities')
      .update({ public_listing_status: status })
      .eq('activity_id', activity.activity_id)
      .select(activitySelectColumns)
      .single();
    setAdminSaving(false);
    if (error) {
      setNotice(`Listing could not be ${status === 'published' ? 'approved' : 'archived'}: ${error.message}`);
      return;
    }

    setReviewQueue((current) => current.filter((item) => String(item.activity_id) !== String(activity.activity_id)));
    if (status === 'published') {
      setActivities((current) => [...current, normalizeActivity(data)]);
      setNotice('Listing approved and live.');
    } else {
      setNotice('Listing archived.');
    }
  }

  async function uploadActivityPhotos(activityId, files, caption = null, sourceUrl = null) {
    const uploads = acceptedPhotoFiles(files);
    if (!uploads.length) return [];

    const uploadedPhotos = [];
    for (const file of uploads) {
      const path = activityPhotoPath(activityId, file);
      const { error: uploadError } = await supabase.storage
        .from('activity-photos')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('activity-photos').getPublicUrl(path);
      uploadedPhotos.push({
        activity_id: activityId,
        user_id: session?.user?.id || null,
        photo_url: data.publicUrl,
        caption: caption || null,
        source_provider: 'user_upload',
        source_url: sourceUrl || null,
      });
    }

    const { error: photoError } = await supabase.from('activity_photos').insert(uploadedPhotos);
    if (photoError) throw photoError;
    return uploadedPhotos;
  }

  async function submitActivityLink(event) {
    event.preventDefault();
    const websiteLink = linkForm.website.trim();
    const googlePlacesLink = linkForm.google_places_link.trim();
    const link = websiteLink || googlePlacesLink;
    const submittedName = linkForm.activity_name.trim();

    if (!link) {
      setNotice('Add a website or Google Places link first.');
      return;
    }

    if (!supabase) {
      setNotice('Link adding is not ready in this build yet.');
      return;
    }

    setLoading(true);
    let enriched;
    if (!websiteLink && isGooglePlacesUrl(googlePlacesLink)) {
      if (!submittedName) {
        setNotice('Add an activity name with a Google Places link.');
        setLoading(false);
        return;
      }
      // Google Maps blocks public page scraping. Save a reviewable draft and
      // retain the supplied place URL instead of treating it as a website.
      enriched = {
        activity_name: submittedName,
        address: 'Address to review',
        category: linkForm.category || 'Classes & clubs',
        website: null,
        google_link: googlePlacesLink,
        google_place_uri: googlePlacesLink,
      };
    } else {
      const { data, error } = await supabase.functions.invoke('activity-link-autofill', {
        body: { link, websiteLink: websiteLink || null, googlePlacesLink: googlePlacesLink || null, activityName: submittedName || null },
      });

      if (error) {
        setNotice(`That link could not be read yet: ${error.message}`);
        setLoading(false);
        return;
      }
      enriched = data?.activity || data;
    }

    if (!enriched?.activity_name || !enriched?.address) {
      setNotice('That link needs more detail. Try the place listing link.');
      setLoading(false);
      return;
    }

    const activityId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
      ...buildSubmittedPayload(enriched, link, websiteLink, googlePlacesLink, session?.user?.id || null),
      activity_id: activityId,
      activity_name: submittedName || enriched.activity_name,
      category: linkForm.category || enriched.category || enriched.google_primary_type || 'Classes & clubs',
    };
    const { error: insertError } = await supabase.from('activities').insert(payload);
    if (insertError) {
      setLoading(false);
      setNotice(`The activity details were found, but could not be saved: ${insertError.message}`);
      return;
    }

    try {
      await uploadActivityPhotos(activityId, linkForm.photos, null, link);
    } catch (photoError) {
      setLoading(false);
      setNotice(`Activity added, but the photos could not be saved: ${photoError.message}`);
      return;
    }

    setLinkForm(emptyLinkForm);
    setLoading(false);
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
          user_id: session?.user?.id || null,
          rating: Number(reviewForm.rating),
          review_text: reviewForm.comments.trim() || null,
        }),
      );
    }
    let uploadedPhotos;
    try {
      uploadedPhotos = await uploadActivityPhotos(
        selectedActivity.activity_id,
        reviewForm.photos,
        reviewForm.comments.trim() || null,
        selectedActivity.website || selectedActivity.source_url || null,
      );
    } catch (photoError) {
      setNotice(`Photo could not be saved: ${photoError.message}`);
      return;
    }

    const results = await Promise.all(tasks);
    const failed = results.find((result) => result.error);
    if (failed) {
      setNotice(`Review could not be saved: ${failed.error.message}`);
      return;
    }

    setReviewForm(emptyReviewForm);
    if (uploadedPhotos.length) {
      setActivityPhotos((current) => [...uploadedPhotos, ...current]);
    }
    setNotice(uploadedPhotos.length ? 'Review and photo saved.' : 'Review saved.');
  }

  return (
    <div className="phone-app">
      {!session && !entryChoice ? (
        <WelcomeScreen
          authLoading={authLoading}
          onSignIn={signInWithGoogle}
          onContinueAsGuest={continueAsGuest}
        />
      ) : (
        <>
      <header className="app-topbar">
        <button className="brand-lockup" type="button" onClick={() => navigate('start')}>
          <span>Tiny</span>
          <strong>Outings</strong>
        </button>
        <div className="topbar-actions account-actions">
          {session ? (
            <>
              <span className={classNames('account-pill', isAdmin && 'is-admin')}>
                {isAdmin ? 'Admin' : 'Signed in'}
              </span>
              <button className="account-button" type="button" onClick={signOut}>Log out</button>
            </>
          ) : (
            <button className="account-button" type="button" onClick={signInWithGoogle} disabled={authLoading}>
              {authLoading ? 'Opening...' : 'Sign in'}
            </button>
          )}
        </div>
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
            profile={profile}
            communityProfiles={communityProfiles}
            followingIds={followingIds}
            signedIn={Boolean(session)}
            profileSaving={profileSaving}
            onOpenActivity={openActivity}
            onUpdateEvent={updateEvent}
            onRemoveEvent={removeEvent}
            onSaveProfile={saveProfile}
            onToggleFollow={toggleFollow}
            onSignIn={signInWithGoogle}
          />
        )}

        {activeScreen === 'map' && (
          <ActivityMapScreen activities={allActivities.filter((activity) => activity.public_listing_status === 'published')} />
        )}

        {activeScreen === 'add' && (
          <AddActivityScreen
            form={linkForm}
            setForm={setLinkForm}
            onSubmit={submitActivityLink}
            loading={loading}
            isAdmin={isAdmin}
            reviewQueue={reviewQueue}
            reviewQueueLoading={reviewQueueLoading}
            adminSaving={adminSaving}
            onReview={reviewSubmittedActivity}
          />
        )}

        {activeScreen === 'activity' && selectedActivity && (
          <ActivityDetail
            activity={selectedActivity}
            userPhotos={activityPhotos}
            userPhotosLoading={activityPhotosLoading}
            reviewForm={reviewForm}
            setReviewForm={setReviewForm}
            submitReview={submitReview}
            isAdmin={isAdmin}
            adminSaving={adminSaving}
            onSaveAdminEdits={saveAdminActivityEdits}
            onArchive={archiveAdminActivity}
            onShare={shareActivity}
            onClose={closeActivity}
          />
        )}
      </main>

      <BottomNav activeScreen={activeScreen} setActiveScreen={navigate} />
        </>
      )}
    </div>
  );
}

function WelcomeScreen({ authLoading, onSignIn, onContinueAsGuest }) {
  return (
    <main className="welcome-screen">
      <div className="welcome-sun" aria-hidden="true" />
      <div className="welcome-mark" aria-hidden="true"><span /><span /><span /></div>
      <p className="welcome-kicker">Tiny Outings</p>
      <h1>Small plans.<br />Big days.</h1>
      <p className="welcome-copy">Find family-friendly things to do, then build your week one outing at a time.</p>
      <div className="welcome-actions">
        <button className="welcome-google" type="button" onClick={onSignIn} disabled={authLoading}>
          <span className="google-g" aria-hidden="true">G</span>
          {authLoading ? 'Opening Google...' : 'Sign in with Google'}
        </button>
        <button className="welcome-guest" type="button" onClick={onContinueAsGuest}>Continue as guest</button>
      </div>
      <p className="welcome-note">Guest plans stay on this device.</p>
    </main>
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

function CalendarScreen({
  weekDays,
  calendarEvents,
  profile,
  communityProfiles,
  followingIds,
  signedIn,
  profileSaving,
  onOpenActivity,
  onUpdateEvent,
  onRemoveEvent,
  onSaveProfile,
  onToggleFollow,
  onSignIn,
}) {
  const weekEvents = calendarEvents.filter((event) => weekDays.includes(event.planned_date));
  const [editingProfile, setEditingProfile] = useState(false);
  const [form, setForm] = useState({ user_name: '', display_name: '', avatar_url: '' });

  useEffect(() => {
    setForm({
      user_name: profile?.user_name || '',
      display_name: profile?.display_name || '',
      avatar_url: profile?.avatar_url || '',
    });
  }, [profile]);

  return (
    <section className="app-screen calendar-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Week</span>
        <h1>Your plan</h1>
        <p>Booked and maybe plans.</p>
      </div>

      <section className="profile-card">
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="Your profile" className="profile-avatar" />
        ) : (
          <span className="profile-avatar profile-avatar-fallback">{profileAvatar(profile)}</span>
        )}
        <div className="profile-summary">
          <span className="eyebrow">Your profile</span>
          <strong>{profile?.display_name || profile?.user_name || 'Plan together'}</strong>
          <small>{profile?.user_name ? `@${profile.user_name}` : 'Sign in to create your profile'}</small>
          {profile && <small>{profile.followers || 0} followers · {profile.following || 0} following</small>}
        </div>
        {signedIn ? (
          <button type="button" className="profile-edit-button" onClick={() => setEditingProfile((current) => !current)}>
            {editingProfile ? 'Close' : 'Edit'}
          </button>
        ) : (
          <button type="button" className="profile-edit-button" onClick={onSignIn}>Sign in</button>
        )}
      </section>

      {signedIn && editingProfile && (
        <form className="profile-editor" onSubmit={(event) => { event.preventDefault(); onSaveProfile(form); }}>
          <label><span>Username</span><input value={form.user_name} onChange={(event) => setForm((current) => ({ ...current, user_name: event.target.value }))} /></label>
          <label><span>Name</span><input value={form.display_name} onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))} /></label>
          <label className="wide"><span>Profile photo URL</span><input type="url" value={form.avatar_url} onChange={(event) => setForm((current) => ({ ...current, avatar_url: event.target.value }))} placeholder="https://..." /></label>
          <button className="primary-action wide" type="submit" disabled={profileSaving}>{profileSaving ? 'Saving...' : 'Save profile'}</button>
        </form>
      )}

      {signedIn && communityProfiles.length > 0 && (
        <section className="community-card">
          <div className="section-heading"><span>Community</span><h2>Parents nearby</h2></div>
          <div className="community-list">
            {communityProfiles.map((person) => {
              const following = followingIds.includes(String(person.user_id));
              return (
                <article key={person.user_id} className="community-person">
                  {person.avatar_url ? <img src={person.avatar_url} alt="" className="community-avatar" /> : <span className="community-avatar profile-avatar-fallback">{profileAvatar(person)}</span>}
                  <div><strong>{person.display_name || person.user_name}</strong><small>@{person.user_name} · {person.followers || 0} followers</small></div>
                  <button type="button" className={classNames('follow-button', following && 'is-following')} onClick={() => onToggleFollow(person)}>{following ? 'Following' : 'Follow'}</button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="week-export-card">
        <div>
          <strong>Take your week with you</strong>
          <small>{weekEvents.length ? `${weekEvents.length} plans ready to import.` : 'Add plans to export them.'}</small>
        </div>
        <button
          type="button"
          disabled={weekEvents.length === 0}
          onClick={() => downloadICS(weekEvents, `tiny-outings-week-${weekDays[0]}.ics`)}
        >
          Export for Google Calendar
        </button>
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
                            <button type="button" onClick={() => downloadICS([event], `${event.planned_date}-${event.day_window}-tiny-outings.ics`)}>
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

function AddActivityScreen({
  form,
  setForm,
  onSubmit,
  loading,
  isAdmin,
  reviewQueue,
  reviewQueueLoading,
  adminSaving,
  onReview,
}) {
  return (
    <section className="app-screen form-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Add</span>
        <h1>Add a spot.</h1>
        <p>Share the basics. We review every new listing first.</p>
      </div>

      <form className="app-form link-only-form" onSubmit={onSubmit}>
        <label className="wide">
          <span>Activity name</span>
          <input
            value={form.activity_name}
            onChange={(event) => setForm((current) => ({ ...current, activity_name: event.target.value }))}
            placeholder="e.g. Saturday stay and play"
          />
        </label>
        <label className="wide">
          <span>Category</span>
          <select
            required
            value={form.category}
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
          >
            <option value="">Choose a category</option>
            {activityInterestOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>Website</span>
          <input
            type="url"
            value={form.website}
            onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))}
            placeholder="https://activity-website..."
          />
        </label>
        <label className="wide">
          <span>Google Places link</span>
          <input
            type="url"
            value={form.google_places_link}
            onChange={(event) => setForm((current) => ({ ...current, google_places_link: event.target.value }))}
            placeholder="https://maps.google.com/..."
          />
          <small>Paste a shared Google Maps or Google Places link.</small>
        </label>

        <label className="wide photo-upload-field">
          <span>Photos</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => setForm((current) => ({
              ...current,
              photos: acceptedPhotoFiles(event.target.files),
            }))}
          />
          <small>{form.photos.length ? `${form.photos.length} ready to upload` : 'Up to 5 JPG, PNG, or WebP images'}</small>
        </label>

        <button className="primary-action wide" type="submit" disabled={loading}>
          {loading ? 'Reading...' : 'Add'}
        </button>
      </form>

      {isAdmin && (
        <section className="review-queue">
          <div className="section-heading">
            <span>Admin review</span>
            <h2>{reviewQueueLoading ? 'Loading submissions...' : `${reviewQueue.length} awaiting review`}</h2>
          </div>
          {!reviewQueueLoading && reviewQueue.length === 0 && <p className="queue-empty">Nothing waiting right now.</p>}
          <div className="review-list">
            {reviewQueue.map((activity) => (
              <article key={activity.activity_id} className="review-item">
                <ActivityPhoto activity={activity} className="review-photo" />
                <div>
                  <strong>{activity.activity_name}</strong>
                  <small>{activityPlanLabel(activity)} · {activity.address || 'Address to review'}</small>
                  <small>{activity.website || activity.google_link || 'No source link'}</small>
                </div>
                <div className="review-actions">
                  <button type="button" onClick={() => onReview(activity, 'published')} disabled={adminSaving}>Approve</button>
                  <button type="button" onClick={() => onReview(activity, 'archived')} disabled={adminSaving}>Archive</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

function ActivityMapScreen({ activities }) {
  const concentrations = useMemo(() => activityConcentrations(activities), [activities]);
  const mappedActivityCount = activities.filter((activity) => activity.lat != null && activity.long != null).length;
  const largest = concentrations[0];
  const peakClusters = concentrations.slice(0, 16);

  return (
    <section className="app-screen map-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Where are we</span>
        <h1>London, mapped.</h1>
        <p>Bigger bubbles mean more Tiny Outings nearby.</p>
      </div>

      <div className="map-summary">
        <span><strong>{mappedActivityCount.toLocaleString()}</strong> mapped outings</span>
        <span><strong>{concentrations.length}</strong> local clusters</span>
      </div>

      <div className="heatmap-legend" aria-label="Map density legend">
        <span>Less to explore</span><i aria-hidden="true" /><span>More to explore</span>
      </div>

      <div className="london-map-shell">
        <MapContainer
          center={[51.5074, -0.1278]}
          zoom={8.5}
          zoomSnap={0.25}
          minZoom={8}
          maxZoom={15}
          maxBounds={[[51.12, -0.78], [51.9, 0.56]]}
          scrollWheelZoom={false}
          className="london-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <ActivityHeatLayer activities={activities} />
          {peakClusters.map((cluster) => (
            <CircleMarker
              key={`${cluster.lat}:${cluster.long}`}
              center={[cluster.lat, cluster.long]}
              radius={Math.min(18, 4 + Math.sqrt(cluster.count) * 2.3)}
              pathOptions={{
                color: '#fffdf6',
                weight: 2.5,
                fillColor: '#17324d',
                fillOpacity: 0.86,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                <strong>{cluster.count} activities</strong><br />
                {cluster.activities.join(', ')}
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      {largest && (
        <div className="map-insight">
          <span>Most concentrated</span>
          <strong>{largest.count} activities in one local area</strong>
          <small>{largest.activities.join(' · ')}</small>
        </div>
      )}
    </section>
  );
}

function ActivityDetail({
  activity,
  userPhotos,
  userPhotosLoading,
  reviewForm,
  setReviewForm,
  submitReview,
  isAdmin,
  adminSaving,
  onSaveAdminEdits,
  onArchive,
  onShare,
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
          {userPhotos.map((photo) => (
            <figure className="detail-photo user-photo" key={photo.photo_id || photo.photo_url}>
              <img className="activity-photo-image" src={securePhotoUrl(photo.photo_url)} alt={photo.caption || `Photo of ${activity.activity_name}`} />
              <figcaption>{photo.caption || 'Parent photo'}</figcaption>
            </figure>
          ))}
        </div>
        {userPhotosLoading && <p className="gallery-loading">Loading parent photos...</p>}
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
          <button className="detail-map" type="button" onClick={() => openGoogleMaps(activity)}>
            <iframe
              title={`Map for ${activity.activity_name}`}
              src={mapEmbedUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              tabIndex="-1"
            />
            <span>Open in Google Maps</span>
          </button>
        )}

        <div className="external-links detail-links">
          <a href={websiteUrl} target="_blank" rel="noreferrer">Website</a>
          {organiserWebsiteUrl && (
            <a href={organiserWebsiteUrl} target="_blank" rel="noreferrer">Organiser site</a>
          )}
          <a href={googleUrl} target="_blank" rel="noreferrer">Google Maps</a>
        </div>

        <div className="share-card">
          <div><strong>Share this outing</strong><small>Send it to your people.</small></div>
          <div className="share-actions">
            <button type="button" onClick={() => onShare(activity)}>Share</button>
            <a href={socialShareUrl('whatsapp', activity)} target="_blank" rel="noreferrer">WhatsApp</a>
            <a href={socialShareUrl('facebook', activity)} target="_blank" rel="noreferrer">Facebook</a>
            <button type="button" onClick={() => onShare(activity)}>Instagram</button>
          </div>
        </div>
      </div>

      {isAdmin && (
        <ActivityAdminEditor
          activity={activity}
          saving={adminSaving}
          onSave={onSaveAdminEdits}
          onArchive={onArchive}
        />
      )}

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
          <span>Photos</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => setReviewForm((current) => ({
              ...current,
              photos: acceptedPhotoFiles(event.target.files),
            }))}
          />
          <small>{reviewForm.photos.length ? `${reviewForm.photos.length} ready to upload` : 'Up to 5 images'}</small>
        </label>
        <button className="primary-action" type="submit">Save</button>
      </form>
    </section>
  );
}

function ActivityAdminEditor({ activity, saving, onSave, onArchive }) {
  const [form, setForm] = useState({
    user_image_url: activity.user_image_url || '',
    website: activity.website || '',
    organiser_website: activity.organiser_website || '',
    google_link: activity.google_place_uri || activity.google_link || '',
  });

  useEffect(() => {
    setForm({
      user_image_url: activity.user_image_url || '',
      website: activity.website || '',
      organiser_website: activity.organiser_website || '',
      google_link: activity.google_place_uri || activity.google_link || '',
    });
  }, [activity]);

  function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim()]),
    );
    onSave(activity, values);
  }

  return (
    <form className="admin-editor" onSubmit={submit}>
      <div>
        <span className="eyebrow">Admin tools</span>
        <h2>Improve this listing</h2>
        <p>These corrections are saved as importer feedback.</p>
      </div>
      <label>
        <span>Card image URL</span>
        <input
          type="url"
          value={form.user_image_url}
          onChange={(event) => setForm((current) => ({ ...current, user_image_url: event.target.value }))}
          placeholder="https://..."
        />
      </label>
      <label>
        <span>Website</span>
        <input
          type="url"
          value={form.website}
          onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))}
          placeholder="https://..."
        />
      </label>
      <label>
        <span>Organiser website</span>
        <input
          type="url"
          value={form.organiser_website}
          onChange={(event) => setForm((current) => ({ ...current, organiser_website: event.target.value }))}
          placeholder="https://..."
        />
      </label>
      <label>
        <span>Google Places link</span>
        <input
          type="url"
          value={form.google_link}
          onChange={(event) => setForm((current) => ({ ...current, google_link: event.target.value }))}
          placeholder="https://maps.google.com/..."
        />
      </label>
      <button className="primary-action" type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save corrections'}
      </button>
      <button className="archive-listing-button" type="button" onClick={() => onArchive(activity)} disabled={saving}>
        Archive listing
      </button>
    </form>
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
    ['map', 'Where'],
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
