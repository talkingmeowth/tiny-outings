import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import L from 'leaflet';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import QRCode from 'qrcode';
import 'leaflet/dist/leaflet.css';
import { supabase } from './supabaseClient';
import { googleSignInErrorMessage, signInWithNativeGoogle } from './googleAuth';
import { comparisonTokens, dedupePublishedActivities, findLikelyDuplicate } from './activityDuplicates';
import { activityImageUrls, hasActivityImage, securePhotoUrl, shareListingImages } from './activityImages';
import { activityCoordinates, resolveActivityCoordinates } from './activityLocation';
import { profileQrUrl, profileShareData } from './profileSharing';

const dayWindows = ['morning', 'afternoon', 'evening'];
const storagePrefix = 'tiny-outings';
const adminEmails = new Set([
  'talkingmeowth06@gmail.com',
  'talkingmeowtho6@gmail.com',
  'benfielden@gmail.com',
  ...(import.meta.env.DEV ? ['tinyoutings-qa-admin@tinyoutings.test'] : []),
]);
const appDownloadPageUrl = 'https://tiny-outings-cpjh.onrender.com/';
const defaultProfileAvatar = '/images/profile-placeholder.svg';
const NativeGoogleSignIn = registerPlugin('TinyOutingsGoogle');
// Reset outdated swipe/filter state without touching planned calendar entries.
const planningStorageVersion = '2026-08-17-family-activities-filter';
const onboardingStorageKey = 'onboarding-complete';
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
  'card_summary',
  'cost',
  'admin_cover_image_url',
  'scraped_image_url',
  'user_image_url',
  'organiser_website_downloaded_image',
  'website_downloaded_image',
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
  'archive',
  'submitted_by_user_id',
  'submission_notes',
  'submission_rating',
  'created_at',
].join(',');
const statusLabels = {
  booked: 'Booked',
  tentative: 'Tentative',
  not_selected: 'Not selected',
};

const reviewQueueSections = [
  {
    type: 'user_submission',
    title: 'User submissions',
    description: 'Drafts waiting to be checked and published or archived.',
  },
  {
    type: 'import_new',
    title: 'New from importers',
    description: 'New listings added by an importer.',
  },
  {
    type: 'import_change',
    title: 'Importer updates',
    description: 'Changes an importer made to an existing listing.',
  },
];

const reviewChangeLabels = {
  name: 'name',
  address: 'address',
  category: 'category',
  start_time: 'start time',
  end_time: 'end time',
  website: 'website',
  organiser_website: 'organiser website',
  google_places_link: 'Google Places link',
  description: 'description',
  card_summary: 'card summary',
  price: 'price',
  age_suitability: 'age suitability',
  latitude: 'location',
  longitude: 'location',
  availability_dates: 'available dates',
  availability_days: 'available days',
  status: 'listing status',
  archived: 'archive status',
  cover_image: 'cover image',
};

function reviewQueueChangeSummary(item) {
  if (item.queue_type === 'user_submission') return 'A parent submitted this for review.';
  if (item.queue_type === 'import_new') return 'A new listing was imported.';
  const changedFields = Object.keys(item.changes || {})
    .map((field) => reviewChangeLabels[field] || field.replaceAll('_', ' '));
  return changedFields.length ? `Changed: ${[...new Set(changedFields)].join(', ')}.` : 'An importer updated this listing.';
}

const emptyLinkForm = {
  link: '',
  category: '',
  comment: '',
  rating: '',
  photos: [],
};

const emptyReviewForm = {
  rating: 5,
  comments: '',
  photos: [],
};

const maxUploadedPhotos = 5;
const maxPhotoBytes = 8 * 1024 * 1024;
const preloadedActivityImageUrls = new Set();
const preconnectedImageOrigins = new Set();

const activityInterestOptions = [
  'Cafes & food',
  'Play cafes',
  'Baby swim',
  'Parks & outdoor play',
  'Stay & play',
  'Classes & clubs',
  'Movement & wellbeing',
  'Museums & culture',
  'Bookshops',
  'Family activities',
  'Events',
];

const ageFilterOptions = [
  { value: 'all', label: 'Any age' },
  { value: 'baby', label: 'Baby', minMonths: 0, maxMonths: 12 },
  { value: 'toddler', label: 'Toddler', minMonths: 12, maxMonths: 36 },
  { value: 'preschool', label: 'Preschool', minMonths: 36, maxMonths: 60 },
  { value: 'five-plus', label: '5+', minMonths: 60, maxMonths: 216 },
];
const ageFilterByValue = new Map(ageFilterOptions.map((option) => [option.value, option]));

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
    activitySearch: '',
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

function monthStartISO(dateISO) {
  const date = new Date(`${dateISO}T12:00:00`);
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function addMonthsISO(dateISO, months) {
  const date = new Date(`${dateISO}T12:00:00`);
  date.setMonth(date.getMonth() + months, 1);
  return date.toISOString().slice(0, 10);
}

function calendarDaysForMonth(monthStart) {
  const firstDay = new Date(`${monthStart}T12:00:00`);
  const mondayOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const calendarStart = new Date(firstDay);
  calendarStart.setDate(firstDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return {
      iso: date.toISOString().slice(0, 10),
      inMonth: date.getMonth() === firstDay.getMonth(),
    };
  });
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

function relativeWeekLabel(weekStart) {
  const currentWeek = startOfWeekISO();
  const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;
  const offset = Math.round(
    (new Date(`${weekStart}T12:00:00`) - new Date(`${currentWeek}T12:00:00`)) / millisecondsPerWeek,
  );

  if (offset === 0) return 'This week';
  if (offset === 1) return 'Next week';
  if (offset === -1) return 'Last week';
  return offset > 1 ? `In ${offset} weeks` : `${Math.abs(offset)} weeks ago`;
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

function cleanDisplayText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const cleaned = String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212\u00B7]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A3/g, 'GBP ')
    .replace(/\u20AC/g, 'EUR ')
    .replace(/\?/g, '')
    .replace(/[\u00A0\s]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
  return cleaned || fallback;
}

function conciseCardSummary(activity) {
  const description = cleanDisplayText(activity?.description);
  if (description) {
    const firstSentence = description.split(/(?<=[.!])\s+/)[0] || description;
    if (firstSentence.length <= 180) return firstSentence;
    const shortened = firstSentence.slice(0, 177).replace(/\s+\S*$/, '').trim();
    return `${shortened}...`;
  }

  const category = cleanDisplayText(activity?.category, 'Family activity');
  const age = cleanDisplayText(activity?.age_suitability);
  const location = cleanDisplayText(activity?.borough || activity?.address);
  return [category, age && `for ${age}`, location && `in ${location}`]
    .filter(Boolean)
    .join(' ');
}

function normalizeActivity(activity) {
  const appRating = numericOrNull(activity.app_rating);
  const googleRating = numericOrNull(activity.google_rating);
  const reviewCount = Number(activity.number_of_reviews ?? activity.google_user_rating_count ?? 0);
  const cost = cleanDisplayText(activity.cost || activity.price || activity.price_text || activity.fee || '') || null;

  const normalized = {
    ...activity,
    activity_id: String(activity.activity_id),
    start_time: String(activity.start_time || '09:00').slice(0, 5),
    end_time: String(activity.end_time || '10:00').slice(0, 5),
    // A source import can carry an old derived window. The visible card and
    // its swipe slot must always follow the actual scheduled start time.
    time_window: toWindow(activity.start_time),
    activity_name: cleanDisplayText(activity.activity_name, 'Untitled activity'),
    address: cleanDisplayText(activity.address),
    category: cleanDisplayText(activity.category || activity.google_primary_type, 'parent friendly'),
    description: cleanDisplayText(activity.description),
    card_summary: cleanDisplayText(activity.card_summary),
    age_suitability: cleanDisplayText(activity.age_suitability),
    availability_notes: cleanDisplayText(activity.availability_notes),
    source_name: cleanDisplayText(activity.source_name),
    borough: cleanDisplayText(activity.borough),
    submission_notes: cleanDisplayText(activity.submission_notes),
    submission_rating: numericOrNull(activity.submission_rating),
    google_primary_type: cleanDisplayText(activity.google_primary_type),
    lat: numericOrNull(activity.lat),
    long: numericOrNull(activity.long),
    app_rating: appRating ?? googleRating,
    google_rating: googleRating,
    number_of_reviews: Number.isFinite(reviewCount) ? reviewCount : 0,
    google_user_rating_count: Number(activity.google_user_rating_count ?? reviewCount ?? 0),
    days_of_week: Array.isArray(activity.days_of_week) ? activity.days_of_week.map((day) => cleanDisplayText(day)) : [],
    available_days_of_week: Array.isArray(activity.available_days_of_week)
      ? activity.available_days_of_week.map((day) => cleanDisplayText(day))
      : [],
    plan_filters: Array.isArray(activity.plan_filters) ? activity.plan_filters.map((filter) => cleanDisplayText(filter)) : [],
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
    admin_cover_image_url: activity.admin_cover_image_url || null,
    scraped_image_url: activity.scraped_image_url || null,
    user_uploaded_image_url: activity.user_uploaded_image_url || null,
    user_image_url: activity.user_image_url || null,
    organiser_website_downloaded_image: activity.organiser_website_downloaded_image || null,
    website_downloaded_image: activity.website_downloaded_image || null,
    wikimedia_image_url: activity.wikimedia_image_url || null,
    website_image_url: activity.website_image_url || null,
    listing_image_url: activity.listing_image_url || null,
    image_url: activity.image_url || activity.photo_url || null,
    image_source_url: activity.image_source_url || activity.website || activity.source_url || null,
    public_listing_status: activity.public_listing_status || 'published',
    archive: Boolean(activity.archive),
  };

  const sourceLabel = activitySourceLabel(normalized);
  const availableDays = normalized.available_days_of_week.length
    ? normalized.available_days_of_week
    : normalized.days_of_week;

  // These labels are used by every Plan filter. Deriving them once when the
  // directory arrives keeps category and age taps quick on lower-end phones.
  return {
    ...normalized,
    source_label: sourceLabel,
    is_event_source: isEventSource(normalized),
    plan_label: activityPlanLabel({ ...normalized, source_label: sourceLabel }),
    age_range: activityAgeRange(normalized),
    available_days_normalized: availableDays.map(normalizedWeekday),
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
    // Larger neighbourhood-sized cells make the London-wide hotspots readable.
    const key = `${Math.round(lat * 40) / 40}:${Math.round(long * 28) / 28}`;
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

function ActivityBubbleLayer({ concentrations }) {
  const map = useMap();

  useEffect(() => {
    const highestCount = Math.max(...concentrations.map((cluster) => cluster.count), 1);
    const layer = L.layerGroup().addTo(map);

    for (const cluster of concentrations) {
      const relativeSize = Math.sqrt(cluster.count / highestCount);
      const diameter = Math.round(36 + relativeSize * 34);
      const tier = relativeSize > 0.68 ? 'large' : relativeSize > 0.36 ? 'medium' : 'small';
      const icon = L.divIcon({
        className: 'activity-cluster-marker',
        html: `<span class="activity-cluster-bubble is-${tier}" style="--bubble-size:${diameter}px">${cluster.count}</span>`,
        iconSize: [diameter, diameter],
        iconAnchor: [diameter / 2, diameter / 2],
      });
      L.marker([cluster.lat, cluster.long], { icon, title: `${cluster.count} activities nearby` })
        .bindTooltip(`${cluster.count} activities nearby`, { direction: 'top', offset: [0, -diameter / 2] })
        .addTo(layer);
    }

    return () => map.removeLayer(layer);
  }, [concentrations, map]);

  return null;
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

function calendarTime(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function endTimeAfter(startTime) {
  const [hours, minutes] = startTime.split(':').map(Number);
  if (hours >= 23) return '23:59';
  return `${String(hours + 1).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function dateStampForCalendar(dateISO, time) {
  const [hours, minutes] = calendarTime(time, '09:00').split(':');
  return `${dateISO.replaceAll('-', '')}T${hours}${minutes}00`;
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

function calendarEventRecord(event, userId, visibility) {
  const startTime = calendarTime(event.start_time, '09:00');
  const requestedEndTime = calendarTime(event.end_time, '10:00');
  const endTime = requestedEndTime > startTime ? requestedEndTime : endTimeAfter(startTime);
  return {
    user_id: userId,
    activity_id: event.activity_id,
    planned_date: event.planned_date,
    day_window: dayWindows.includes(event.day_window) ? event.day_window : toWindow(startTime),
    start_time: startTime,
    end_time: endTime,
    status: statusOptions.includes(event.status) ? event.status : 'tentative',
    visibility,
    title_override: event.title_override || null,
    notes: event.notes || null,
  };
}

async function downloadICS(events, filename) {
  if (!events.length) throw new Error('Add at least one plan before exporting your week.');

  const calendar = buildICS(events);
  if (Capacitor.isNativePlatform()) {
    const savedFile = await Filesystem.writeFile({
      path: filename,
      data: calendar,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    await Share.share({
      title: 'Tiny Outings weekly plan',
      text: 'Your Tiny Outings week is attached as a calendar file.',
      url: savedFile.uri,
      dialogTitle: 'Export your week',
    });
  } else {
    const blob = new Blob([calendar], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function classNames(...names) {
  return names.filter(Boolean).join(' ');
}

function googleEntryUrl(activity) {
  if (activity.google_place_uri) return activity.google_place_uri;
  if (activity.google_link) return activity.google_link;
  if (activity.google_place_id) return googlePlaceIdUrl(activity);
  const query = `${activity.activity_name || ''} ${activity.address || ''}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function openGoogleMaps(activity) {
  window.location.assign(activityShareUrl(activity));
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
  return isOfficialWebsiteUrl(activity.website);
}

function sameExternalUrl(first, second) {
  try {
    const normalise = (value) => {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const path = url.pathname.replace(/\/+$/, '');
      return `${host}${url.port ? `:${url.port}` : ''}${path}`.toLowerCase();
    };
    return Boolean(first && second && normalise(first) === normalise(second));
  } catch {
    return false;
  }
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

function isOfficialWebsiteUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || isGooglePlacesUrl(url.toString())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function submittedActivityLink(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    });
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function activityNameFromSubmittedLink(link) {
  try {
    const url = new URL(link);
    const searchName = ['q', 'query', 'place', 'destination']
      .map((key) => url.searchParams.get(key))
      .find(Boolean);
    const placeName = url.pathname.match(/\/maps\/place\/([^/@]+)/i)?.[1];
    const candidate = searchName || placeName || url.hostname.replace(/^www\./i, '').split('.')[0];
    return cleanDisplayText(decodeURIComponent(candidate).replace(/[+_-]+/g, ' '), 'Activity to review');
  } catch {
    return 'Activity to review';
  }
}

function fallbackActivityFromSubmittedLink(link, category) {
  const isGoogleLink = isGooglePlacesUrl(link);
  return {
    activity_name: activityNameFromSubmittedLink(link),
    address: 'Address needs review',
    category: category || 'Classes & clubs',
    start_time: '09:00',
    end_time: '10:00',
    website: isGoogleLink ? null : link,
    google_link: isGoogleLink ? link : null,
    google_place_uri: isGoogleLink ? link : null,
    age_suitability: 'Under 5s',
    description: 'Link saved for admin review. Add the missing details before publishing.',
    card_summary: 'Draft saved for admin review.',
    cost: null,
    source_url: link,
  };
}

function isCoordinateGoogleMapsUrl(value) {
  if (!isGooglePlacesUrl(value)) return false;
  try {
    const decoded = decodeURIComponent(String(value));
    return /[?&]query=-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:[&#]|$)/i.test(decoded);
  } catch {
    return false;
  }
}

function googlePlaceIdUrl(activity) {
  const placeId = String(activity.google_place_id || '').trim();
  if (!placeId) return null;
  const query = activity.activity_name || activity.address || 'Tiny Outing';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${encodeURIComponent(placeId)}`;
}

function originalGooglePlacesUrl(activity) {
  return [activity.google_place_uri, activity.google_link]
    .find((url) => isGooglePlacesUrl(url) && !isCoordinateGoogleMapsUrl(url)) || null;
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

function hasActivityCardImage(activity) {
  return Boolean(activity.shared_card_image_url) || hasActivityImage(activity);
}

function activityPhotoUrls(activity) {
  const fallbackImage = activityFallbackImage(activity);
  const candidates = [
    activity.shared_card_image_url,
    ...activityImageUrls(activity),
    fallbackImage,
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function activityPhotoUrl(activity) {
  return activityPhotoUrls(activity)[0] || null;
}

function preloadActivityImages(activities, limit = 4) {
  if (!globalThis.Image || !Array.isArray(activities)) return;

  activities.slice(0, limit).forEach((activity) => {
    const imageUrl = activityPhotoUrl(activity);
    if (!imageUrl || imageUrl.startsWith('/')) return;

    try {
      const origin = new URL(imageUrl, globalThis.location?.origin).origin;
      if (!preconnectedImageOrigins.has(origin)) {
        preconnectedImageOrigins.add(origin);
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = origin;
        link.crossOrigin = 'anonymous';
        document.head.append(link);
      }
    } catch {
      // The image itself is still allowed to attempt loading below.
    }

    if (preloadedActivityImageUrls.has(imageUrl)) return;
    preloadedActivityImageUrls.add(imageUrl);
    const image = new Image();
    image.decoding = 'async';
    image.src = imageUrl;
  });
}

function ActivityPhoto({ activity, className, priority = false, children = null }) {
  const photoUrl = activityPhotoUrl(activity);
  const fallbackImage = activityFallbackImage(activity);

  return (
    <div className={classNames(className, 'has-image')}>
      <img
        className="activity-photo-image"
        src={photoUrl || fallbackImage}
        alt=""
        aria-hidden="true"
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onError={(event) => {
          // A bad remote image must never leave the card blank on a mobile connection.
          if (event.currentTarget.dataset.usedFallback === 'true') return;
          event.currentTarget.dataset.usedFallback = 'true';
          event.currentTarget.src = fallbackImage;
        }}
      />
      {children}
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

function usernameSearchValue(value) {
  return cleanDisplayText(value)
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, 30);
}

function activityShareUrl(activity) {
  return originalGooglePlacesUrl(activity) || googlePlaceIdUrl(activity) || googleEntryUrl(activity);
}

function sharedActivityIdFromLocation() {
  try {
    return new URLSearchParams(window.location.search).get('activity');
  } catch {
    return null;
  }
}

function followUsernameFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'tinyoutings:' && url.hostname === 'follow') {
      return cleanDisplayText(decodeURIComponent(url.pathname.replace(/^\//, ''))).toLowerCase() || null;
    }
    return cleanDisplayText(url.searchParams.get('follow')).toLowerCase() || null;
  } catch {
    return null;
  }
}

function activityShareText(activity) {
  const timing = isFlexibleActivity(activity) ? 'Anytime' : `${activity.start_time} to ${activity.end_time}`;
  return `Tiny Outings pick: ${activity.activity_name} - ${timing}.`;
}

function activityShareData(activity) {
  return {
    title: activity.activity_name,
    text: activityShareText(activity),
    url: activityShareUrl(activity),
  };
}

function appShareData() {
  return {
    title: 'Tiny Outings',
    text: 'Plan little family adventures with Tiny Outings.',
    url: appDownloadPageUrl,
  };
}

function socialShareUrl(provider, shareData) {
  const { url, text } = shareData;
  const message = `${text} ${url}`;
  if (provider === 'whatsapp') return `https://wa.me/?text=${encodeURIComponent(message)}`;
  if (provider === 'facebook') return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  if (provider === 'sms') return `sms:?body=${encodeURIComponent(message)}`;
  return url;
}

function isActivityAvailableOn(activity, dateISO) {
  const weekday = weekdayName(dateISO);
  const explicitDates = activity.available_dates || [];
  const availableDays = activity.available_days_normalized
    || (activity.available_days_of_week?.length
      ? activity.available_days_of_week
      : activity.days_of_week || []).map(normalizedWeekday);

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
    return availableDays.includes(normalizedTargetDay);
  }
  return true;
}

function activityMatchesInterests(activity, selectedCategories, allCategoriesSelected) {
  if (allCategoriesSelected) return true;
  return selectedCategories.has(activity.plan_label || activityPlanLabel(activity));
}

function activityMatchesSearch(activity, value) {
  const query = cleanDisplayText(value).toLowerCase();
  if (!query) return true;
  const searchable = [
    activity.activity_name,
    activity.category,
    activity.borough,
    activity.description,
    activity.card_summary,
  ].map((item) => cleanDisplayText(item).toLowerCase()).join(' ');
  return query.split(/\s+/).filter(Boolean).every((term) => searchable.includes(term));
}

function activityPlanLabel(activity) {
  if (activity.plan_label) return activity.plan_label;
  if (isEventListing(activity)) return 'Events';

  const category = String(activity.category || '').toLowerCase();
  const filters = Array.isArray(activity.plan_filters) ? activity.plan_filters.join(' ').toLowerCase() : '';
  const value = `${category} ${filters} ${activity.google_primary_type || ''} ${activity.activity_name || ''}`.toLowerCase();
  const categoryAndFilters = `${category} ${filters}`;

  // Historic plan filters group Bookshops under Food & socials. The card tag
  // should still expose the more useful, specific Bookshops category.
  if (category === 'events') return 'Events';
  if (/bookshop|book shop|bookstore|book store/.test(value)) return 'Bookshops';
  if (/play[ -]?cafe|soft[ -]?play|playroom|indoor play/.test(value)) return 'Play cafes';
  if (/baby swim|infant swim|toddler swim|parent.*swim|water babies|puddle ducks/.test(value)) return 'Baby swim';
  if (/cafe|coffee|food|lunch|bakery|restaurant|bistro|brasserie|diner|eatery/.test(value)) return 'Cafes & food';
  if (/park|outdoor/.test(value)) return 'Parks & outdoor play';
  if (/stay|family hub|play centre/.test(value)) return 'Stay & play';
  if (/dance|movement|yoga|swim|fitness/.test(value)) return 'Movement & wellbeing';
  if (/museum|culture/.test(value)) return 'Museums & culture';
  if (/family activit/.test(categoryAndFilters)) return 'Family activities';
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
  const selected = ageFilterByValue.get(ageRange);
  const activityRange = activity.age_range || activityAgeRange(activity);
  if (!selected || !activityRange) return true;
  return activityRange.minMonths <= selected.maxMonths && activityRange.maxMonths >= selected.minMonths;
}

function isEventSource(activity) {
  if (typeof activity.is_event_source === 'boolean') return activity.is_event_source;
  return /eventbrite|fever|loopla/i.test([
    activity.data_source,
    activity.source_name,
    activity.source_url,
  ].filter(Boolean).join(' '));
}

function activitySourceLabel(activity) {
  if (activity.source_label) return activity.source_label;
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

function buildSubmittedPayload(
  enriched,
  submissionLink,
  websiteLink,
  googlePlacesLink,
  userId = null,
  publicListingStatus = 'draft',
) {
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
    website: isOfficialWebsiteUrl(enriched.website) || isOfficialWebsiteUrl(websiteLink),
    organiser_website: isOfficialWebsiteUrl(enriched.organiser_website),
    child_friendly_score: numericOrNull(enriched.child_friendly_score),
    app_rating: appRating,
    number_of_reviews: Number.isFinite(reviewCount) ? reviewCount : 0,
    age_suitability: enriched.age_suitability || 'Under 5s',
    description: enriched.description || null,
    card_summary: cleanDisplayText(enriched.card_summary) || conciseCardSummary(enriched),
    cost: enriched.cost || null,
    source_name: googlePlacesLink ? 'Google Places link submission' : 'Website link submission',
    source_url: submissionLink,
    public_listing_status: publicListingStatus,
    archive: false,
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

function adminActivityUpdates(activity, values = {}) {
  const manualCoordinates = activityCoordinates({ lat: values.lat, long: values.long });
  const existingCoordinates = activityCoordinates(activity);
  const coordinates = manualCoordinates || existingCoordinates;
  const address = values.address || activity.address || 'Address needs review';

  return {
    activity_name: values.activity_name || activity.activity_name,
    address,
    borough: values.borough || null,
    category: values.category || activity.category || null,
    start_time: values.start_time || null,
    end_time: values.end_time || null,
    description: values.description || null,
    card_summary: cleanDisplayText(values.card_summary) || activity.card_summary || conciseCardSummary({
      description: values.description,
      category: values.category || activity.category,
      age_suitability: values.age_suitability,
      borough: values.borough,
      address,
    }),
    cost: values.cost || null,
    age_suitability: values.age_suitability || null,
    user_image_url: values.user_image_url || null,
    website: isOfficialWebsiteUrl(values.website),
    organiser_website: isOfficialWebsiteUrl(values.organiser_website),
    google_link: values.google_link || null,
    google_place_uri: values.google_link || null,
    lat: coordinates?.lat ?? null,
    long: coordinates?.long ?? null,
  };
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

function adminCoverPhotoPath(activityId, file) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `admin-covers/${activityId}/${id}.${extension}`;
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
      // Each new app launch starts with the current Monday, not the last plan viewed.
      weekStart: defaults.weekStart,
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
      activitySearch: typeof stored.activitySearch === 'string' ? stored.activitySearch : defaults.activitySearch,
    };
  });
  const [calendarMonth, setCalendarMonth] = useState(() => monthStartISO(startOfWeekISO(todayISO())));
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('idle');
  const [swipes, setSwipes] = useState(() => loadStored('swipes', {}));
  const [shortlists, setShortlists] = useState(() => loadStored('shortlists', {}));
  const [statuses, setStatuses] = useState(() => loadStored('statuses', {}));
  const [hiddenActivityIds, setHiddenActivityIds] = useState(() => loadStored('hidden-activity-ids', []));
  const [calendarEvents, setCalendarEvents] = useState(() => loadStored('calendar-events', []));
  const calendarEventsRef = useRef(calendarEvents);
  const [calendarSyncedUserId, setCalendarSyncedUserId] = useState(null);
  const [linkForm, setLinkForm] = useState(emptyLinkForm);
  const [reviewForm, setReviewForm] = useState(emptyReviewForm);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [sharedActivityId] = useState(sharedActivityIdFromLocation);
  const [openedSharedActivity, setOpenedSharedActivity] = useState(false);
  const [shareSheetActivity, setShareSheetActivity] = useState(null);
  const [shareSheetApp, setShareSheetApp] = useState(false);
  const [reportSheetActivity, setReportSheetActivity] = useState(null);
  const [duplicateSubmission, setDuplicateSubmission] = useState(null);
  const [reportText, setReportText] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [activityPhotos, setActivityPhotos] = useState([]);
  const [activityPhotosLoading, setActivityPhotosLoading] = useState(false);
  const [returnScreen, setReturnScreen] = useState('swipe');
  const [dragState, setDragState] = useState({ activityId: null, startX: null, offsetX: 0 });
  const [session, setSession] = useState(null);
  // A guest choice lasts only for the open app session. On a fresh launch,
  // signed-out people always start at the account screen.
  const [entryChoice, setEntryChoice] = useState(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(() => loadStored(onboardingStorageKey, false) === true);
  const [authLoading, setAuthLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [followingProfiles, setFollowingProfiles] = useState([]);
  const [followerProfiles, setFollowerProfiles] = useState([]);
  const [followingWeekEvents, setFollowingWeekEvents] = useState([]);
  const [selectedFollowingUserId, setSelectedFollowingUserId] = useState(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialRefresh, setSocialRefresh] = useState(0);
  const [pendingFollowUsername, setPendingFollowUsername] = useState(() => followUsernameFromUrl(window.location.href));
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewQueueLoading, setReviewQueueLoading] = useState(false);
  const [reviewQueueError, setReviewQueueError] = useState('');
  const [reviewQueueRefresh, setReviewQueueRefresh] = useState(0);
  const [activityRefresh, setActivityRefresh] = useState(0);
  const [adminSaving, setAdminSaving] = useState(false);
  // Keep Plan controls responsive while the directory catches up with a changed filter.
  const deferredFilters = useDeferredValue(filters);
  const selectedCategorySet = useMemo(
    () => new Set(deferredFilters.interests),
    [deferredFilters.interests],
  );
  const allCategoriesSelected = selectedCategorySet.size === activityInterestOptions.length;
  const hiddenActivityIdSet = useMemo(
    () => new Set(hiddenActivityIds.map(String)),
    [hiddenActivityIds],
  );
  const selectedSourceSet = useMemo(
    () => new Set(deferredFilters.source),
    [deferredFilters.source],
  );
  const isAdmin = adminEmails.has(session?.user?.email?.toLowerCase());
  const signedInUser = session?.user || null;

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysISO(filters.weekStart, index)),
    [filters.weekStart],
  );
  const calendarDays = useMemo(() => calendarDaysForMonth(calendarMonth), [calendarMonth]);
  const activeSlot = slotKey(selectedDate, selectedWindow);
  const allActivities = useMemo(
    () => dedupePublishedActivities(shareListingImages(activities.map(normalizeActivity))),
    [activities],
  );
  const publishedActivityIds = useMemo(
    () => new Set(activities.map((activity) => String(activity.activity_id))),
    [activities],
  );
  const activitiesMissingImages = useMemo(
    () => allActivities
      .filter((activity) => activity.public_listing_status === 'published' && !activity.archive)
      .filter((activity) => !hasActivityCardImage(activity))
      .sort((left, right) => left.activity_name.localeCompare(right.activity_name)),
    [allActivities],
  );
  const activityById = useMemo(
    () => new Map(allActivities.map((activity) => [String(activity.activity_id), activity])),
    [allActivities],
  );

  useEffect(() => {
    if (!supabase || !signedInUser || activeScreen !== 'user') {
      if (!signedInUser) {
        setFollowingProfiles([]);
        setFollowerProfiles([]);
        setFollowingWeekEvents([]);
        setSelectedFollowingUserId(null);
      }
      return undefined;
    }

    let cancelled = false;
    async function loadSocialWeek() {
      setSocialLoading(true);
      const userId = signedInUser.id;
      const [{ data: followingRows, error: followingError }, { data: followerRows, error: followerError }] = await Promise.all([
        supabase.from('user_follows').select('followed_user_id').eq('follower_user_id', userId),
        supabase.from('user_follows').select('follower_user_id').eq('followed_user_id', userId),
      ]);
      if (cancelled) return;
      if (followingError || followerError) {
        setNotice('Your parent connections could not be loaded just now.');
        setSocialLoading(false);
        return;
      }

      const followingIds = (followingRows || []).map((row) => row.followed_user_id);
      const followerIds = (followerRows || []).map((row) => row.follower_user_id);
      const profileIds = [...new Set([...followingIds, ...followerIds])];
      let profiles = [];
      if (profileIds.length) {
        const { data, error } = await supabase
          .from('user_table')
          .select('user_id,user_name,display_name,avatar_url,followers,following,default_calendar_visibility')
          .in('user_id', profileIds);
        if (error) {
          setNotice('Parent profiles could not be loaded just now.');
        } else {
          profiles = data || [];
        }
      }
      if (cancelled) return;

      const profilesById = new Map(profiles.map((item) => [String(item.user_id), item]));
      setFollowingProfiles(followingIds.map((id) => profilesById.get(String(id))).filter(Boolean));
      setFollowerProfiles(followerIds.map((id) => profilesById.get(String(id))).filter(Boolean));
      setSelectedFollowingUserId((current) => (
        current && followingIds.some((id) => String(id) === String(current)) ? current : null
      ));

      if (!followingIds.length) {
        setFollowingWeekEvents([]);
        setSocialLoading(false);
        return;
      }

      const { data: events, error: eventsError } = await supabase
        .from('calendar_events')
        .select('calendar_event_id,user_id,activity_id,planned_date,day_window,start_time,end_time,status,visibility,title_override,notes')
        .in('user_id', followingIds)
        .gte('planned_date', filters.weekStart)
        .lte('planned_date', addDaysISO(filters.weekStart, 6))
        .order('planned_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (cancelled) return;
      if (eventsError) {
        setNotice('Shared plans could not be loaded just now.');
      } else {
        setFollowingWeekEvents((events || [])
          .map((event) => ({
            ...event,
            local_id: event.calendar_event_id,
            activity: activityById.get(String(event.activity_id)) || null,
            profile: profilesById.get(String(event.user_id)) || null,
          }))
          .filter((event) => event.activity));
      }
      setSocialLoading(false);
    }

    loadSocialWeek();
    return () => { cancelled = true; };
  }, [activeScreen, activityById, filters.weekStart, signedInUser, socialRefresh]);

  useEffect(() => {
    if (
      !supabase
      || !signedInUser
      || !profile?.user_id
      || calendarSyncedUserId === signedInUser.id
      || loading
      || activities.length === 0
    ) return;
    let cancelled = false;

    async function syncSavedPlan() {
      const visibility = profile.default_calendar_visibility || 'followers';
      const savedEvents = calendarEventsRef.current.filter((event) => {
        const isForCurrentUser = !event.user_id || String(event.user_id) === String(signedInUser.id);
        const isKnownActivity = event.activity_id && publishedActivityIds.has(String(event.activity_id));
        const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(String(event.planned_date || ''));
        return isForCurrentUser && isKnownActivity && hasDate;
      });
      if (!savedEvents.length) {
        if (!cancelled) setCalendarSyncedUserId(signedInUser.id);
        return;
      }

      const results = await Promise.all(savedEvents.map(async (event) => {
        const { data, error } = await supabase
          .from('calendar_events')
          .upsert(
            calendarEventRecord(event, signedInUser.id, event.visibility || visibility),
            { onConflict: 'user_id,planned_date,day_window' },
          )
          .select('calendar_event_id,activity_id,planned_date,day_window,status,visibility')
          .single();
        return { event, data, error };
      }));
      if (cancelled) return;

      const failed = results.filter((result) => result.error);
      if (failed.length) {
        console.warn('Some calendar plans could not sync.', failed.map(({ error }) => error));
      }
      const savedBySlot = new Map(results
        .filter((result) => result.data)
        .map(({ data }) => [`${data.planned_date}:${data.day_window}`, data]));
      setCalendarEvents((current) => current.map((event) => {
        const saved = savedBySlot.get(`${event.planned_date}:${event.day_window}`);
        return saved ? { ...event, ...saved, local_id: saved.calendar_event_id, user_id: signedInUser.id } : event;
      }));
      setCalendarSyncedUserId(signedInUser.id);
    }

    syncSavedPlan();
    return () => { cancelled = true; };
  }, [activities.length, calendarSyncedUserId, loading, profile?.default_calendar_visibility, profile?.user_id, publishedActivityIds, signedInUser]);
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

  const sourceOptions = useMemo(
    () => [...new Set(allActivities.map(activitySourceLabel))].sort((left, right) => left.localeCompare(right)),
    [allActivities],
  );
  const baseFilteredActivities = useMemo(
    () => activitiesWithDistance.filter((activity) => {
      return activity.public_listing_status === 'published'
        && !activity.archive
        && !hiddenActivityIdSet.has(String(activity.activity_id))
        && activityMatchesInterests(activity, selectedCategorySet, allCategoriesSelected)
        && (selectedSourceSet.size === 0 || selectedSourceSet.has(activitySourceLabel(activity)))
        && activityMatchesAge(activity, deferredFilters.ageRange)
        && activityMatchesSearch(activity, deferredFilters.activitySearch);
    }),
    [activitiesWithDistance, hiddenActivityIdSet, selectedCategorySet, allCategoriesSelected, deferredFilters.activitySearch, deferredFilters.ageRange, selectedSourceSet],
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

  useEffect(() => {
    // The deck only displays one card, so warm a small look-ahead cache before it is shown.
    preloadActivityImages(deckActivities);
  }, [deckActivities]);

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
  useEffect(() => saveStored('hidden-activity-ids', hiddenActivityIds), [hiddenActivityIds]);
  useEffect(() => saveStored('calendar-events', calendarEvents), [calendarEvents]);
  useEffect(() => { calendarEventsRef.current = calendarEvents; }, [calendarEvents]);

  useEffect(() => {
    if (!notice) return undefined;
    // Confirm actions without leaving an overlay on top of shortlist controls.
    const timeout = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
    if (!Capacitor.isNativePlatform()) return undefined;
    let active = true;
    let listener = null;

    const receiveFollowLink = (url) => {
      const userName = followUsernameFromUrl(url);
      if (userName) setPendingFollowUsername(userName);
    };

    NativeApp.getLaunchUrl()
      .then((launch) => {
        if (active && launch?.url) receiveFollowLink(launch.url);
      })
      .catch(() => undefined);
    Promise.resolve(NativeApp.addListener('appUrlOpen', ({ url }) => receiveFollowLink(url)))
      .then((handle) => { listener = handle; })
      .catch(() => undefined);

    return () => {
      active = false;
      listener?.remove();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !signedInUser) {
      setProfile(null);
      setCalendarSyncedUserId(null);
      return undefined;
    }

    let cancelled = false;
    async function loadCommunity() {
      const userId = signedInUser.id;
      let { data: ownProfile } = await supabase
        .from('user_table')
        .select('user_id,user_name,display_name,avatar_url,followers,following,default_calendar_visibility')
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
            default_calendar_visibility: 'followers',
          }, { onConflict: 'user_id' })
          .select('user_id,user_name,display_name,avatar_url,followers,following,default_calendar_visibility')
          .maybeSingle();
        ownProfile = data;
      }

      if (cancelled) return;
      setProfile(ownProfile || null);
    }

    loadCommunity();
    return () => {
      cancelled = true;
    };
  }, [signedInUser]);

  const followPendingProfile = useEffectEvent((userName) => {
    void followProfileByUsername(userName);
  });

  const handleNativeBack = useEffectEvent(({ canGoBack }) => {
    if (notice) {
      setNotice('');
      return;
    }
    if (shareSheetActivity || shareSheetApp) {
      setShareSheetActivity(null);
      setShareSheetApp(false);
      return;
    }
    if (reportSheetActivity) {
      setReportSheetActivity(null);
      return;
    }
    if (duplicateSubmission) {
      setDuplicateSubmission(null);
      return;
    }
    if (activeScreen === 'activity') {
      closeActivity();
      return;
    }
    if (activeScreen === 'review') {
      navigate('add');
      return;
    }
    if (activeScreen !== 'start') {
      navigate('start');
      return;
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void NativeApp.minimizeApp();
  });

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const receiveNativeBack = () => handleNativeBack({ canGoBack: false });
    window.addEventListener('tinyoutingsback', receiveNativeBack);
    return () => window.removeEventListener('tinyoutingsback', receiveNativeBack);
  }, [handleNativeBack]);

  useEffect(() => {
    if (!pendingFollowUsername || !signedInUser || !profile?.user_id) return;
    const userName = pendingFollowUsername;
    setPendingFollowUsername(null);
    followPendingProfile(userName);
  }, [followPendingProfile, pendingFollowUsername, profile?.user_id, signedInUser]);

  useEffect(() => {
    if (!sharedActivityId || openedSharedActivity || allActivities.length === 0) return;
    const sharedActivity = allActivities.find(
      (activity) => String(activity.activity_id) === String(sharedActivityId),
    );
    if (!sharedActivity) return;
    setReturnScreen('start');
    setSelectedActivity(sharedActivity);
    setActiveScreen('activity');
    setOpenedSharedActivity(true);
  }, [allActivities, openedSharedActivity, sharedActivityId]);

  useEffect(() => {
    const weekEnd = addDaysISO(filters.weekStart, 6);
    if (selectedDate < filters.weekStart || selectedDate > weekEnd) {
      setSelectedDate(filters.weekStart);
    }
  }, [filters.weekStart, selectedDate]);

  useEffect(() => {
    if (activeScreen !== 'swipe' && activeScreen !== 'map') return;
    window.requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  }, [activeScreen]);

  useEffect(() => {
    if (!isAdmin && activeScreen === 'review') setActiveScreen('start');
  }, [activeScreen, isAdmin]);

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
          .eq('archive', false)
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

      const uploadedImageByActivityId = new Map();
      if (!error) {
        // A parent-uploaded photo is the most current view of an outing.
        for (let from = 0; ; from += pageSize) {
          const response = await supabase
            .from('activity_photos')
            .select('activity_id,photo_url')
            .eq('source_provider', 'user_upload')
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1);

          if (response.error) break;
          for (const photo of response.data || []) {
            if (photo.activity_id && photo.photo_url && !uploadedImageByActivityId.has(String(photo.activity_id))) {
              uploadedImageByActivityId.set(String(photo.activity_id), photo.photo_url);
            }
          }
          if ((response.data || []).length < pageSize) break;
        }
      }

      if (cancelled) return;

      if (error) {
        setNotice(`We could not refresh outings just now: ${error.message}`);
      } else {
        setActivities(data.map((activity) => ({
          ...activity,
          user_uploaded_image_url: uploadedImageByActivityId.get(String(activity.activity_id)) || null,
        })));
      }
      setLoading(false);
    }

    loadActivities();
    return () => {
      cancelled = true;
    };
  }, [activityRefresh]);

  useEffect(() => {
    // Realtime updates can be delayed when a phone puts the app in the
    // background. Refresh on return so newly archived listings disappear.
    const refreshVisibleActivities = () => {
      if (document.visibilityState === 'visible') {
        setActivityRefresh((current) => current + 1);
      }
    };
    window.addEventListener('focus', refreshVisibleActivities);
    document.addEventListener('visibilitychange', refreshVisibleActivities);
    return () => {
      window.removeEventListener('focus', refreshVisibleActivities);
      document.removeEventListener('visibilitychange', refreshVisibleActivities);
    };
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;

    const channel = supabase
      .channel('tiny-outings-activity-cards')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'activities' },
        ({ new: changedActivity }) => {
          const updatedActivity = normalizeActivity(changedActivity);
          const isVisible = updatedActivity.public_listing_status === 'published' && !updatedActivity.archive;

          setActivities((current) => {
            const exists = current.some((item) => String(item.activity_id) === String(updatedActivity.activity_id));
            if (!isVisible) {
              return current.filter((item) => String(item.activity_id) !== String(updatedActivity.activity_id));
            }
            return exists
              ? current.map((item) => (String(item.activity_id) === String(updatedActivity.activity_id) ? updatedActivity : item))
              : [...current, updatedActivity];
          });

          setSelectedActivity((current) => (
            String(current?.activity_id) === String(updatedActivity.activity_id)
              ? (isVisible ? updatedActivity : null)
              : current
          ));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadReviewQueue() {
      if (!supabase || !isAdmin) {
        if (!cancelled) {
          setReviewQueue([]);
          setReviewQueueError('');
        }
        return;
      }
      if (activeScreen !== 'review') return;

      if (!cancelled) {
        setReviewQueueLoading(true);
        setReviewQueueError('');
      }
      try {
        const { data: queueRows, error: queueError } = await supabase
          .from('activity_review_queue')
          .select('review_queue_id,activity_id,queue_type,status,summary,changes,source_name,data_source,created_at')
          .eq('status', 'pending')
          .order('created_at', { ascending: true });
        if (cancelled) return;
        if (queueError) {
          setReviewQueueError(queueError.message || 'We could not load the review queue.');
          setNotice(`Review queue could not be loaded: ${queueError.message}`);
          return;
        }

        const activityIds = [...new Set((queueRows || []).map((item) => item.activity_id).filter(Boolean))];
        let activitiesById = new Map();
        if (activityIds.length) {
          const { data: queueActivities, error: activitiesError } = await supabase
            .from('activities')
            .select(activitySelectColumns)
            .in('activity_id', activityIds);
          if (cancelled) return;
          if (activitiesError) {
            setReviewQueueError(activitiesError.message || 'We could not load queued activities.');
            setNotice(`Review queue could not be loaded: ${activitiesError.message}`);
            return;
          }
          activitiesById = new Map((queueActivities || []).map((activity) => [
            String(activity.activity_id),
            normalizeActivity(activity),
          ]));
        }

        setReviewQueue((queueRows || []).map((item) => ({
          ...item,
          activity: activitiesById.get(String(item.activity_id)) || null,
        })));
      } catch {
        if (!cancelled) {
          setReviewQueueError('We could not load the review queue.');
          setNotice('Review queue could not be loaded. Try again in a moment.');
        }
      } finally {
        if (!cancelled) setReviewQueueLoading(false);
      }
    }

    loadReviewQueue();
    return () => {
      cancelled = true;
    };
  }, [activeScreen, isAdmin, reviewQueueRefresh]);

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

  function hideActivityFromBrowsing(activity) {
    if (!activity) return;
    const activityId = String(activity.activity_id);
    setHiddenActivityIds((current) => (current.includes(activityId) ? current : [...current, activityId]));
    setSwipes((current) => Object.fromEntries(
      Object.entries(current).map(([key, items]) => [
        key,
        (items || []).filter((item) => String(item.activity_id) !== activityId),
      ]),
    ));
    setShortlists((current) => Object.fromEntries(
      Object.entries(current).map(([key, ids]) => [
        key,
        (ids || []).filter((id) => String(id) !== activityId),
      ]),
    ));
    setStatuses((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.endsWith(`:${activityId}`)),
    ));
    setDragState({ activityId: null, startX: null, offsetX: 0 });
    if (String(selectedActivity?.activity_id) === activityId) closeActivity();
    setNotice(`${activity.activity_name} will not appear in your browsing again.`);
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
      user_id: session?.user?.id || null,
      activity_id: activity.activity_id,
      activity,
      planned_date: selectedDate,
      day_window: selectedWindow,
      start_time: activity.start_time,
      end_time: activity.end_time,
      status,
      visibility: profile?.default_calendar_visibility || 'followers',
      created_at: new Date().toISOString(),
    };

    setCalendarEvents((current) => {
      const existingIndex = current.findIndex((item) => item.local_id === event.local_id);
      if (existingIndex === -1) return [...current, event];
      return current.map((item) => (item.local_id === event.local_id ? { ...item, ...event } : item));
    });

    setLocalStatus(activity, status);
    void persistCalendarEvent(event);
    setNotice(`${activity.activity_name} added to your week as ${statusLabels[status].toLowerCase()}.`);
  }

  function updateEvent(event, changes) {
    const nextEvent = { ...event, ...changes };
    setCalendarEvents((current) =>
      current.map((item) => (item.local_id === event.local_id ? nextEvent : item)),
    );
    void persistCalendarEvent(nextEvent);
  }

  function removeEvent(event) {
    setCalendarEvents((current) => current.filter((item) => item.local_id !== event.local_id));
    if (supabase && session?.user?.id) {
      supabase
        .from('calendar_events')
        .delete()
        .eq('user_id', session.user.id)
        .eq('planned_date', event.planned_date)
        .eq('day_window', event.day_window)
        .then(({ error }) => {
          if (error) setNotice('The plan was removed on this device but could not be updated online.');
        });
    }
    setNotice(`${event.activity.activity_name} removed from your calendar.`);
  }

  async function persistCalendarEvent(event) {
    if (!supabase || !session?.user?.id || !event?.activity_id) return;
    const visibility = event.visibility || profile?.default_calendar_visibility || 'followers';
    const { data, error } = await supabase
      .from('calendar_events')
      .upsert(calendarEventRecord(event, session.user.id, visibility), { onConflict: 'user_id,planned_date,day_window' })
      .select('calendar_event_id,user_id,activity_id,planned_date,day_window,start_time,end_time,status,visibility,title_override,notes')
      .single();
    if (error) {
      setNotice('Your plan is saved here, but could not be shared yet.');
      return;
    }
    setCalendarEvents((current) => current.map((item) => (
      item.local_id === event.local_id
        ? { ...item, ...data, local_id: data.calendar_event_id, activity: item.activity || event.activity }
        : item
    )));
    setSocialRefresh((current) => current + 1);
  }

  function navigate(screen) {
    if (screen === 'review' && !isAdmin) return;
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

  function openDraftForReview(activity) {
    setReturnScreen('review');
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

    if (!Capacitor.isNativePlatform()) {
      setNotice('Google sign-in is available in the installed Android app.');
      return;
    }

    setAuthLoading(true);
    try {
      const data = await signInWithNativeGoogle({
        supabaseClient: supabase,
        nativeGoogle: NativeGoogleSignIn,
      });
      setSession(data.session);
      setEntryChoice('google');
    } catch (error) {
      setNotice(googleSignInErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }

  function continueAsGuest() {
    setEntryChoice('guest');
  }

  function completeOnboarding() {
    saveStored(onboardingStorageKey, true);
    setHasCompletedOnboarding(true);
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(`Could not sign out: ${error.message}`);
    else {
      if (Capacitor.isNativePlatform()) {
        try {
          await NativeGoogleSignIn.signOut();
        } catch {
          // The Supabase session is closed even if Android credential cleanup fails.
        }
      }
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
        default_calendar_visibility: values.default_calendar_visibility || 'followers',
      })
      .eq('user_id', session.user.id)
      .select('user_id,user_name,display_name,avatar_url,followers,following,default_calendar_visibility')
      .single();
    setProfileSaving(false);
    if (error) {
      setNotice(`Profile could not be saved: ${error.message}`);
      return;
    }
    setProfile(data);
    if (data.default_calendar_visibility !== profile?.default_calendar_visibility) {
      const { error: visibilityError } = await supabase
        .from('calendar_events')
        .update({ visibility: data.default_calendar_visibility })
        .eq('user_id', session.user.id);
      if (visibilityError) {
        setNotice('Profile saved, but your existing week visibility could not be updated yet.');
        return;
      }
      setCalendarEvents((current) => current.map((event) => ({
        ...event,
        visibility: data.default_calendar_visibility,
      })));
      setSocialRefresh((current) => current + 1);
    }
    setNotice('Profile saved.');
  }

  async function searchProfilesByUsername(value) {
    const userName = usernameSearchValue(value);
    if (!supabase || !session?.user?.id || !userName) {
      setNotice('Enter a username to search.');
      return [];
    }

    const { data, error } = await supabase
      .from('user_table')
      .select('user_id,user_name,display_name,avatar_url,followers,following,default_calendar_visibility')
      .ilike('user_name', `${userName}%`)
      .neq('user_id', session.user.id)
      .order('user_name', { ascending: true })
      .limit(8);
    if (error) {
      setNotice('Username search is unavailable just now. Try again in a moment.');
      return [];
    }
    return data || [];
  }

  async function followProfile(target) {
    if (!supabase || !session?.user?.id || !target?.user_id) {
      setNotice('Sign in to follow a parent.');
      return null;
    }
    if (String(target.user_id) === String(session.user.id)) {
      setNotice('That is your own profile.');
      return null;
    }

    const { error } = await supabase
      .from('user_follows')
      .upsert({ follower_user_id: session.user.id, followed_user_id: target.user_id }, { onConflict: 'follower_user_id,followed_user_id' });
    if (error) {
      setNotice(`Could not follow ${target.display_name || target.user_name}.`);
      return null;
    }
    setSelectedFollowingUserId(target.user_id);
    setSocialRefresh((current) => current + 1);
    setNotice(`You are following ${target.display_name || target.user_name}.`);
    return target;
  }

  async function followProfileByUsername(value) {
    const userName = usernameSearchValue(value);
    if (!supabase || !session?.user?.id || !userName) {
      setNotice('Sign in to follow a parent.');
      return null;
    }
    if (userName === profile?.user_name?.toLowerCase()) {
      setNotice('That is your own profile.');
      return null;
    }

    const { data: target, error: targetError } = await supabase
      .from('user_table')
      .select('user_id,user_name,display_name,avatar_url,followers,following,default_calendar_visibility')
      .ilike('user_name', userName)
      .maybeSingle();
    if (targetError || !target) {
      setNotice('We could not find that Tiny Outings parent.');
      return null;
    }
    return followProfile(target);
  }

  async function unfollowProfile(target) {
    if (!supabase || !session?.user?.id || !target?.user_id) return;
    const { error } = await supabase
      .from('user_follows')
      .delete()
      .eq('follower_user_id', session.user.id)
      .eq('followed_user_id', target.user_id);
    if (error) {
      setNotice(`Could not unfollow ${target.display_name || target.user_name}.`);
      return;
    }
    setSelectedFollowingUserId((current) => (
      String(current) === String(target.user_id) ? null : current
    ));
    setSocialRefresh((current) => current + 1);
    setNotice(`You unfollowed ${target.display_name || target.user_name}.`);
  }

  async function shareProfile() {
    if (!profile?.user_name) {
      setNotice('Create a username before sharing your profile.');
      return;
    }
    const data = profileShareData(profile);
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share(data);
        return;
      }
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard?.writeText(data.text);
      setNotice('Follow code copied.');
    } catch (error) {
      if (error?.name !== 'AbortError') setNotice('Could not open sharing right now.');
    }
  }

  async function shareActivity(activity) {
    const shareData = activityShareData(activity);
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

  async function shareApp() {
    const shareData = appShareData();
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard?.writeText(`${shareData.text} ${shareData.url}`);
      setNotice('Tiny Outings link copied.');
    } catch (error) {
      if (error?.name !== 'AbortError') setNotice('Could not open sharing on this device.');
    }
  }

  function openShareSheet(activity) {
    setShareSheetApp(false);
    setShareSheetActivity(activity);
  }

  function openAppShareSheet() {
    setShareSheetActivity(null);
    setShareSheetApp(true);
  }

  function openReportSheet(activity) {
    setShareSheetActivity(null);
    setReportText('');
    setReportSheetActivity(activity);
  }

  async function copyActivityLink(activity) {
    try {
      await navigator.clipboard?.writeText(`${activityShareText(activity)} ${activityShareUrl(activity)}`);
      setNotice('Activity link copied.');
    } catch {
      setNotice('Could not copy the link on this device.');
    }
  }

  async function copyAppLink() {
    try {
      const shareData = appShareData();
      await navigator.clipboard?.writeText(`${shareData.text} ${shareData.url}`);
      setNotice('Tiny Outings link copied.');
    } catch {
      setNotice('Could not copy the link on this device.');
    }
  }

  async function submitActivityReport(event) {
    event.preventDefault();
    if (!reportSheetActivity || !reportText.trim()) return;
    if (!supabase) {
      setNotice('Reporting is not ready in this build yet.');
      return;
    }
    setReportSubmitting(true);
    const { error } = await supabase.from('activity_bug_reports').insert({
      activity_id: reportSheetActivity.activity_id,
      reported_by_user_id: session?.user?.id || null,
      report_text: reportText.trim(),
      source_url: activityShareUrl(reportSheetActivity),
    });
    setReportSubmitting(false);
    if (error) {
      setNotice(`Could not send the report: ${error.message}`);
      return;
    }
    setReportSheetActivity(null);
    setReportText('');
    setNotice('Thanks. We will check this listing.');
  }

  async function saveAdminActivityEdits(activity, values, coverImageFile = null) {
    if (!supabase || !isAdmin) return;
    let adminCoverImageUrl = activity.admin_cover_image_url || null;
    const updates = adminActivityUpdates(activity, values);
    setAdminSaving(true);

    if (coverImageFile) {
      const [acceptedCoverImage] = acceptedPhotoFiles([coverImageFile]);
      if (!acceptedCoverImage) {
        setAdminSaving(false);
        setNotice('Choose a JPG, PNG or WebP cover image under 8 MB.');
        return;
      }

      const path = adminCoverPhotoPath(activity.activity_id, acceptedCoverImage);
      const { error: uploadError } = await supabase.storage
        .from('activity-photos')
        .upload(path, acceptedCoverImage, { contentType: acceptedCoverImage.type, upsert: false });
      if (uploadError) {
        setAdminSaving(false);
        setNotice(`Cover image could not be uploaded: ${uploadError.message}`);
        return;
      }
      const { data: coverImage } = supabase.storage.from('activity-photos').getPublicUrl(path);
      adminCoverImageUrl = coverImage.publicUrl;
    }

    updates.admin_cover_image_url = adminCoverImageUrl;
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
    setReviewQueue((current) => current.map((item) => (
      String(item.activity_id) === String(updatedActivity.activity_id)
        ? { ...item, activity: updatedActivity }
        : item
    )));
    setSelectedActivity(updatedActivity);
    setNotice('Listing correction saved for future importer review.');
  }

  async function archiveAdminActivity(activity) {
    if (!supabase || !isAdmin) return;
    if (!window.confirm(`Archive ${activity.activity_name}? It will no longer appear in the app.`)) return;

    setAdminSaving(true);
    const { error } = await supabase.rpc('archive_tiny_outings_activity', {
      target_activity_id: activity.activity_id,
    });
    setAdminSaving(false);
    if (error) {
      setNotice(`Listing could not be archived: ${error.message}`);
      return;
    }

    setActivities((current) => current.filter((item) => String(item.activity_id) !== String(activity.activity_id)));
    setReviewQueue((current) => current.filter((item) => String(item.activity_id) !== String(activity.activity_id)));
    closeActivity();
    setNotice('Listing archived.');
  }

  async function resolveReviewQueueItems(activityId, status = 'reviewed') {
    if (!supabase || !isAdmin || !activityId) return false;
    const { error } = await supabase
      .from('activity_review_queue')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by_user_id: session?.user?.id || null,
      })
      .eq('activity_id', activityId)
      .eq('status', 'pending');
    if (error) {
      setNotice(`The listing changed, but its review item could not be updated: ${error.message}`);
      return false;
    }
    setReviewQueue((current) => current.filter((item) => String(item.activity_id) !== String(activityId)));
    return true;
  }

  async function markReviewQueueItemReviewed(item) {
    if (!supabase || !isAdmin || !item?.review_queue_id) return;
    setAdminSaving(true);
    const { error } = await supabase
      .from('activity_review_queue')
      .update({
        status: 'reviewed',
        reviewed_at: new Date().toISOString(),
        reviewed_by_user_id: session?.user?.id || null,
      })
      .eq('review_queue_id', item.review_queue_id)
      .eq('status', 'pending');
    setAdminSaving(false);
    if (error) {
      setNotice(`Review item could not be updated: ${error.message}`);
      return;
    }
    setReviewQueue((current) => current.filter((queuedItem) => queuedItem.review_queue_id !== item.review_queue_id));
    setNotice('Importer review marked as complete.');
  }

  async function reviewSubmittedActivity(activity, status, values = {}) {
    if (!supabase || !isAdmin) return;
    const label = status === 'published' ? 'approve' : 'archive';
    if (!window.confirm(`${label[0].toUpperCase()}${label.slice(1)} ${activity.activity_name}?`)) return;

    if (status === 'archived') {
      setAdminSaving(true);
      const { error } = await supabase.rpc('archive_tiny_outings_activity', {
        target_activity_id: activity.activity_id,
      });
      setAdminSaving(false);
      if (error) {
        setNotice(`Listing could not be archived: ${error.message}`);
        return;
      }
      setReviewQueue((current) => current.filter((item) => String(item.activity_id) !== String(activity.activity_id)));
      await resolveReviewQueueItems(activity.activity_id, 'dismissed');
      closeActivity();
      setNotice('Listing archived.');
      return;
    }

    setAdminSaving(true);
    const updates = adminActivityUpdates(activity, values);
    let coordinates = activityCoordinates(updates);

    if (!coordinates) {
      try {
        coordinates = await resolveActivityCoordinates(updates);
      } catch {
        coordinates = null;
      }
    }

    if (!coordinates) {
      setAdminSaving(false);
      setNotice('Could not confirm this location. Check the address or enter both latitude and longitude in Admin tools, then publish.');
      return;
    }

    const { data, error } = await supabase
      .from('activities')
      .update({
        ...updates,
        lat: coordinates.lat,
        long: coordinates.long,
        public_listing_status: status,
        archive: false,
      })
      .eq('activity_id', activity.activity_id)
      .select(activitySelectColumns)
      .single();
    setAdminSaving(false);
    if (error) {
      setNotice(`Listing could not be ${status === 'published' ? 'approved' : 'archived'}: ${error.message}`);
      return;
    }

    setReviewQueue((current) => current.filter((item) => String(item.activity_id) !== String(activity.activity_id)));
    await resolveReviewQueueItems(activity.activity_id);
    if (status === 'published') {
      const updatedActivity = normalizeActivity(data);
      setActivities((current) => (
        current.some((item) => String(item.activity_id) === String(updatedActivity.activity_id))
          ? current.map((item) => (String(item.activity_id) === String(updatedActivity.activity_id) ? updatedActivity : item))
          : [...current, updatedActivity]
      ));
      setSelectedActivity(updatedActivity);
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

  async function saveSubmittedActivity({ activityId, payload, link, photos }) {
    const { data: insertedActivityData, error: insertError } = await supabase
      .from('activities')
      .insert(payload)
      .select(activitySelectColumns)
      .single();
    if (insertError) {
      setNotice(`The activity details were found, but could not be saved: ${insertError.message}`);
      return;
    }

    try {
      await uploadActivityPhotos(activityId, photos, null, link);
    } catch (photoError) {
      setNotice(`Activity added, but the photos could not be saved: ${photoError.message}`);
      return;
    }

    setLinkForm({ ...emptyLinkForm, photos: [] });
    if (isAdmin && insertedActivityData) {
      setReviewQueueRefresh((current) => current + 1);
    }
    setNotice(`${payload.activity_name} was sent to the review queue.`);
  }

  async function findSubmissionDuplicate(payload) {
    const localMatch = findLikelyDuplicate(payload, allActivities);
    if (localMatch || !supabase) return localMatch;

    // Add can open before the directory has completed its first load. Query a
    // narrow set of title candidates so the duplicate safeguard still applies.
    const [distinctiveToken] = comparisonTokens(payload.activity_name)
      .filter((token) => token.length >= 4)
      .sort((left, right) => right.length - left.length);
    if (!distinctiveToken) return null;

    const { data, error } = await supabase
      .from('activities')
      .select(activitySelectColumns)
      .eq('public_listing_status', 'published')
      .eq('archive', false)
      .ilike('activity_name', `%${distinctiveToken}%`)
      .limit(80);
    if (error) return null;
    return findLikelyDuplicate(payload, (data || []).map(normalizeActivity));
  }

  function openExistingDuplicate() {
    const candidate = duplicateSubmission?.candidate;
    if (!candidate) return;
    setDuplicateSubmission(null);
    setLinkForm({ ...emptyLinkForm, photos: [] });
    setReturnScreen('add');
    setSelectedActivity(candidate);
    setActiveScreen('activity');
    setNotice('This outing is already in Tiny Outings.');
  }

  async function continueDuplicateSubmission() {
    const pending = duplicateSubmission;
    if (!pending) return;
    setDuplicateSubmission(null);
    setLoading(true);
    try {
      await saveSubmittedActivity(pending);
    } catch (error) {
      setNotice(`The activity could not be added: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setLoading(false);
    }
  }

  async function submitActivityLink(event) {
    event.preventDefault();
    const link = submittedActivityLink(linkForm.link);

    if (!link) {
      setNotice('Add a valid activity link first.');
      return;
    }

    if (!supabase) {
      setNotice('Link adding is not ready in this build yet.');
      return;
    }

    setLoading(true);
    try {
      const googlePlacesLink = isGooglePlacesUrl(link) ? link : '';
      const websiteLink = googlePlacesLink ? '' : link;
      let enriched = null;
      try {
        const { data, error } = await supabase.functions.invoke('activity-link-autofill', {
          body: { link },
        });

        if (error) {
          throw error;
        }
        enriched = data?.activity || data;
      } catch {
        // A draft must not be lost just because an individual website blocks
        // metadata extraction. The administrator can complete it in review.
        enriched = fallbackActivityFromSubmittedLink(link, linkForm.category);
        setNotice('The link was saved for review. Some details need checking.');
      }

      if (!enriched?.activity_name) {
        enriched = fallbackActivityFromSubmittedLink(link, linkForm.category);
      }

      const activityId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const payload = {
        ...buildSubmittedPayload(
          enriched,
          link,
          websiteLink,
          googlePlacesLink,
          session?.user?.id || null,
          'draft',
        ),
        activity_id: activityId,
        activity_name: enriched.activity_name,
        category: linkForm.category || enriched.category || enriched.google_primary_type || 'Classes & clubs',
        card_summary: cleanDisplayText(enriched.card_summary) || conciseCardSummary({
          ...enriched,
          category: linkForm.category || enriched.category || enriched.google_primary_type,
        }),
        submission_notes: linkForm.comment.trim() || null,
        submission_rating: numericOrNull(linkForm.rating),
      };
      const duplicate = await findSubmissionDuplicate(payload);
      const pendingSubmission = { activityId, payload, link, photos: linkForm.photos };
      if (duplicate) {
        setDuplicateSubmission({ ...pendingSubmission, candidate: duplicate.activity, confidence: duplicate.score });
        return;
      }

      await saveSubmittedActivity(pendingSubmission);
    } catch (error) {
      setNotice(`The activity could not be added: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setLoading(false);
    }
  }

  async function submitReview(event) {
    event.preventDefault();
    if (!selectedActivity) return;
    if (!session?.user) {
      setNotice('Sign in to leave a rating or comment.');
      return;
    }
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
      const userUploadedImageUrl = uploadedPhotos[0].photo_url;
      setActivities((current) => current.map((activity) => (
        String(activity.activity_id) === String(selectedActivity.activity_id)
          ? { ...activity, user_uploaded_image_url: userUploadedImageUrl }
          : activity
      )));
      setSelectedActivity((current) => current && String(current.activity_id) === String(selectedActivity.activity_id)
        ? { ...current, user_uploaded_image_url: userUploadedImageUrl }
        : current);
    }
    setNotice(uploadedPhotos.length ? 'Review and photo saved.' : 'Review saved.');
  }

  return (
    <div className="phone-app">
      {!hasCompletedOnboarding && (session || entryChoice) ? (
        <OnboardingScreen onComplete={completeOnboarding} />
      ) : !session && !entryChoice ? (
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
              <button className="account-profile-button" type="button" onClick={() => navigate('user')}>
                <img src={profile?.avatar_url || defaultProfileAvatar} alt="" onError={(event) => { event.currentTarget.src = defaultProfileAvatar; }} />
                <span>{isAdmin ? 'Admin' : (profile?.user_name || 'You')}</span>
              </button>
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
            calendarMonth={calendarMonth}
            setCalendarMonth={setCalendarMonth}
            calendarDays={calendarDays}
            setSelectedDate={setSelectedDate}
            totalActivityCount={weekMatchedActivities.length}
            dayActivityCount={filteredActivities.length}
            slotActivityCount={slotActivities.length}
            onRequestLocation={requestLocation}
            onShowAll={showAllActivities}
            onResetBrowsing={resetBrowsingState}
            onOpenSearch={() => navigate('search')}
            onStart={() => navigate('swipe')}
          />
        )}

        {activeScreen === 'search' && (
          <SearchResultsScreen
            query={filters.activitySearch}
            activities={sharedFilteredActivities}
            onBack={() => navigate('start')}
            onOpenActivity={openActivity}
            onHideActivity={hideActivityFromBrowsing}
          />
        )}

        {activeScreen === 'swipe' && (
          <SwipeScreen
            isAdmin={isAdmin}
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
            onReportActivity={openReportSheet}
            onHideActivity={hideActivityFromBrowsing}
          />
        )}

        {activeScreen === 'calendar' && (
          <CalendarScreen
            weekDays={weekDays}
            calendarEvents={calendarEvents}
            onOpenActivity={openActivity}
            onUpdateEvent={updateEvent}
            onRemoveEvent={removeEvent}
            onShareApp={openAppShareSheet}
          />
        )}

        {activeScreen === 'user' && (
          <UserScreen
            profile={profile}
            signedIn={Boolean(session)}
            profileSaving={profileSaving}
            followingProfiles={followingProfiles}
            followerProfiles={followerProfiles}
            followingWeekEvents={followingWeekEvents}
            selectedFollowingUserId={selectedFollowingUserId}
            socialLoading={socialLoading}
            onOpenActivity={openActivity}
            onSaveProfile={saveProfile}
            onSignIn={signInWithGoogle}
            onShareProfile={shareProfile}
            onSearchProfiles={searchProfilesByUsername}
            onFollowProfile={followProfile}
            onSelectFollowingProfile={(person) => setSelectedFollowingUserId(person?.user_id || null)}
            onUnfollow={unfollowProfile}
          />
        )}

        {activeScreen === 'map' && (
          <ActivityMapScreen activities={allActivities.filter((activity) => activity.public_listing_status === 'published' && !activity.archive)} />
        )}

        {activeScreen === 'add' && (
          <AddActivityScreen
            form={linkForm}
            setForm={setLinkForm}
            onSubmit={submitActivityLink}
            loading={loading}
          />
        )}

        {activeScreen === 'review' && isAdmin && (
          <ReviewScreen
            reviewQueue={reviewQueue}
            reviewQueueLoading={reviewQueueLoading}
            reviewQueueError={reviewQueueError}
            adminSaving={adminSaving}
            onOpenReview={openDraftForReview}
            onResolveQueueItem={markReviewQueueItemReviewed}
            missingImageActivities={activitiesMissingImages}
            onRefresh={() => {
              setReviewQueueRefresh((current) => current + 1);
              setActivityRefresh((current) => current + 1);
            }}
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
            signedIn={Boolean(session)}
            onSignIn={signInWithGoogle}
            isAdmin={isAdmin}
            adminSaving={adminSaving}
            onSaveAdminEdits={saveAdminActivityEdits}
            onArchive={archiveAdminActivity}
            onReviewDraft={reviewSubmittedActivity}
            onOpenShare={openShareSheet}
            onReport={openReportSheet}
            onHideActivity={hideActivityFromBrowsing}
            onClose={closeActivity}
          />
        )}
      </main>

      {(shareSheetActivity || shareSheetApp) && (
        <ShareSheet
          shareData={shareSheetActivity ? activityShareData(shareSheetActivity) : appShareData()}
          onClose={() => { setShareSheetActivity(null); setShareSheetApp(false); }}
          onShare={() => (shareSheetActivity ? shareActivity(shareSheetActivity) : shareApp())}
          onCopy={() => (shareSheetActivity ? copyActivityLink(shareSheetActivity) : copyAppLink())}
          onReport={shareSheetActivity ? () => openReportSheet(shareSheetActivity) : null}
        />
      )}
      {reportSheetActivity && (
        <ReportSheet
          activity={reportSheetActivity}
          value={reportText}
          submitting={reportSubmitting}
          onChange={setReportText}
          onClose={() => setReportSheetActivity(null)}
          onSubmit={submitActivityReport}
        />
      )}
      {duplicateSubmission && (
        <DuplicateSubmissionSheet
          activity={duplicateSubmission.candidate}
          onClose={() => setDuplicateSubmission(null)}
          onUseExisting={openExistingDuplicate}
          onContinue={continueDuplicateSubmission}
        />
      )}

      <BottomNav activeScreen={activeScreen} setActiveScreen={navigate} isAdmin={isAdmin} />
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
      <p className="welcome-kicker">Tiny Outings - London family planner</p>
      <h1>Small plans.<br />Big days.</h1>
      <p className="welcome-copy">Discover family-friendly London outings, then build your week one outing at a time.</p>
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

function OnboardingScreen({ onComplete }) {
  return (
    <main className="onboarding-screen" aria-labelledby="onboarding-title">
      <div className="onboarding-doodle onboarding-doodle-sun" aria-hidden="true" />
      <div className="onboarding-doodle onboarding-doodle-scribble" aria-hidden="true" />
      <p className="onboarding-kicker">A quick tour</p>
      <h1 id="onboarding-title">Your week, made easier.</h1>
      <p className="onboarding-intro">Tiny Outings helps London families turn a blank week into small, good plans.</p>

      <ol className="onboarding-steps">
        <li>
          <span className="onboarding-step-number">1</span>
          <div><strong>Plan your week</strong><p>Choose a week, your distance and the kinds of outing you fancy.</p></div>
        </li>
        <li>
          <span className="onboarding-step-number">2</span>
          <div><strong>Swipe through ideas</strong><p>Swipe right to save an idea for morning, afternoon or evening. Swipe left to pass.</p></div>
        </li>
        <li>
          <span className="onboarding-step-number">3</span>
          <div><strong>Pick your favourites</strong><p>Choose from your saved shortlist and see the finished plan in Week.</p></div>
        </li>
        <li>
          <span className="onboarding-step-number">4</span>
          <div><strong>Explore and share</strong><p>Use Where to spot nearby activity hubs, then share a plan when it is ready.</p></div>
        </li>
      </ol>

      <div className="onboarding-actions">
        <button className="onboarding-start" type="button" onClick={onComplete}>Let's plan</button>
        <button className="onboarding-skip" type="button" onClick={onComplete}>Skip for now</button>
      </div>
      <p className="onboarding-note">You can sign in whenever you want to follow parents, review places and save your profile.</p>
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
  calendarMonth,
  setCalendarMonth,
  calendarDays,
  setSelectedDate,
  totalActivityCount,
  dayActivityCount,
  slotActivityCount,
  onRequestLocation,
  onShowAll,
  onResetBrowsing,
  onOpenSearch,
  onStart,
}) {
  const isWalkMode = filters.distanceMode === 'walk';
  const isDriveMode = filters.distanceMode === 'drive';
  const chosenInterests = filters.interests || [];

  function toggleInterest(interest) {
    setFilters((current) => {
      const exists = current.interests.includes(interest);
      const allSelected = current.interests.length === activityInterestOptions.length;

      // The initial state means "browse everything". The first category tap
      // should narrow the deck, rather than silently removing one category.
      if (allSelected) {
        return { ...current, interests: [interest] };
      }

      const interests = exists
        ? current.interests.filter((item) => item !== interest)
        : [...current.interests, interest];
      return {
        ...current,
        // Keep at least one clear browsing state instead of an empty deck.
        interests: interests.length ? interests : [...activityInterestOptions],
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
          <p>Choose any day to plan its week.</p>
          <div className="week-calendar" aria-label="Choose a planning week">
            <div className="week-calendar-header">
              <button
                type="button"
                className="calendar-month-button"
                aria-label="Previous month"
                onClick={() => setCalendarMonth((current) => addMonthsISO(current, -1))}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <strong>
                {new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
                  new Date(`${calendarMonth}T12:00:00`),
                )}
              </strong>
              <button
                type="button"
                className="calendar-month-button"
                aria-label="Next month"
                onClick={() => setCalendarMonth((current) => addMonthsISO(current, 1))}
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
            <div className="week-calendar-weekdays" aria-hidden="true">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
                <span key={`${day}-${index}`}>{day}</span>
              ))}
            </div>
            <div className="week-calendar-days" role="grid" aria-label="Calendar days">
              {calendarDays.map((day) => {
                const dayWeekStart = startOfWeekISO(day.iso);
                const isSelectedWeek = dayWeekStart === filters.weekStart;
                const isToday = day.iso === todayISO();
                return (
                  <button
                    key={day.iso}
                    type="button"
                    role="gridcell"
                    aria-label={`${formatDay(day.iso, 'long')}${isSelectedWeek ? ', selected week' : ''}`}
                    aria-selected={isSelectedWeek}
                    className={classNames(
                      'week-calendar-day',
                      !day.inMonth && 'is-outside-month',
                      isSelectedWeek && 'is-selected-week',
                      isToday && 'is-today',
                    )}
                    onClick={() => {
                      setFilters((current) => ({ ...current, weekStart: dayWeekStart }));
                      setSelectedDate(dayWeekStart);
                    }}
                  >
                    {Number(day.iso.slice(-2))}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="week-selection-label" aria-live="polite">
            <strong>{relativeWeekLabel(filters.weekStart)}</strong>
            <span>{formatDay(filters.weekStart)} to {formatDay(addDaysISO(filters.weekStart, 6))}</span>
          </div>
          <div className="week-preview" aria-label={`${relativeWeekLabel(filters.weekStart)} weekdays`}>
            {weekDays.map((day) => (
              <span key={day}>{weekdayName(day).slice(0, 3)}</span>
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

        <label className="field-group activity-search-field">
          <span>Find an activity</span>
          <input
            type="search"
            value={filters.activitySearch || ''}
            onChange={(event) => setFilters((current) => ({ ...current, activitySearch: event.target.value }))}
            placeholder="Try a name, place or activity"
          />
          <button className="search-results-button" type="button" onClick={onOpenSearch}>
            Search directory
          </button>
        </label>

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
          <small>{dayActivityCount} today. {slotActivityCount} in this slot.</small>
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

function SearchResultsScreen({ query, activities, onBack, onOpenActivity, onHideActivity }) {
  const searchTerm = cleanDisplayText(query);
  return (
    <section className="app-screen search-results-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Directory search</span>
        <h1>{searchTerm ? `Results for ${searchTerm}` : 'All matching outings'}</h1>
        <p>{activities.length} outing{activities.length === 1 ? '' : 's'} match your current filters.</p>
      </div>

      <button className="secondary-button search-back-button" type="button" onClick={onBack}>Back to plan</button>

      {activities.length ? (
        <div className="search-results-list">
          {activities.map((activity, index) => (
            <article className="search-result-card" key={activity.activity_id}>
              <button className="search-result-open" type="button" onClick={() => onOpenActivity(activity)}>
                <ActivityPhoto activity={activity} className="search-result-photo" priority={index < 3} />
                <span className="search-result-copy">
                  <small>{activityPlanLabel(activity)} - {activitySourceLabel(activity)}</small>
                  <strong>{activity.activity_name}</strong>
                  <span>{isFlexibleActivity(activity) ? 'Anytime' : `${activity.start_time} to ${activity.end_time}`}</span>
                </span>
              </button>
              <button
                className="search-result-hide"
                type="button"
                onClick={() => onHideActivity(activity)}
                aria-label={`Do not show ${activity.activity_name} again`}
              >
                Hide
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-list">
          <strong>No matching outings</strong>
          <span>Try a different name or loosen one of the Plan filters.</span>
        </div>
      )}
    </section>
  );
}

function SwipeScreen({
  isAdmin,
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
  onReportActivity,
  onHideActivity,
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
              aria-label={formatDay(day, 'long')}
            >
              <span>{formatDay(day).split(',')[0]}</span>
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
              isAdmin={isAdmin}
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
              onReportActivity={onReportActivity}
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
      <button
        className="hide-activity-button"
        type="button"
        disabled={!topActivity}
        onClick={() => onHideActivity(topActivity)}
      >
        Don't show this again
      </button>

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
  isAdmin,
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
  onReportActivity,
}) {
  const rotate = offset / 22;
  const stackOffset = stackIndex * 12;
  const cost = activityCost(activity);
  const flexible = isFlexibleActivity(activity);
  const sourceLabel = activitySourceLabel(activity);
  const termTimeOnly = isTermTimeOnly(activity);
  const imageSourceField = activity.shared_card_image_source || 'category_placeholder';

  return (
    <article
      className={classNames('swipe-card', isTop && 'is-top', !isTop && 'is-stacked', decisionClass)}
      style={{
        transform: `translateX(${offset}px) translateY(${stackOffset}px) scale(${1 - stackIndex * 0.035}) rotate(${rotate}deg)`,
        zIndex: 10 - stackIndex,
      }}
      onClick={() => isTop && Math.abs(offset) < 8 && onOpenActivity(activity)}
      onPointerDown={(event) => isTop && onStartDrag(event, activity)}
      onPointerMove={(event) => isTop && onMoveDrag(event, activity)}
      onPointerUp={() => isTop && onEndDrag(activity)}
      onPointerCancel={() => isTop && onEndDrag(activity)}
    >
      <span className="decision-stamp yes">Save</span>
      <span className="decision-stamp no">Skip</span>

      <ActivityPhoto activity={activity} className="card-photo" priority={isTop}>
        {isAdmin && (
          <span className="admin-image-source">Image: {imageSourceField}</span>
        )}
      </ActivityPhoto>

      <div className="card-content">
        <div className="card-kicker">
          <div className="card-tags card-primary-tags">
            <span>{activityPlanLabel(activity)}</span>
            {termTimeOnly && <span className="term-time-badge">Term time</span>}
          </div>
          <div className="card-source-row">
            <span className="status-pill is-ghost">{sourceLabel}</span>
            {status && <StatusPill status={status} />}
          </div>
          <button
            className="card-report-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onReportActivity(activity); }}
          >
            Report
          </button>
        </div>
        <h2>{activity.activity_name}</h2>
        <p className="card-description">
          {activity.card_summary || activity.description || 'Tap for the latest details.'}
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

function ProfileQrCode({ userName }) {
  const [imageUrl, setImageUrl] = useState('');
  const followUrl = profileQrUrl(userName);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(followUrl, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#24443d', light: '#fffdf6' },
    })
      .then((url) => {
        if (!cancelled) setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setImageUrl('');
      });
    return () => { cancelled = true; };
  }, [followUrl]);

  return imageUrl ? <img className="profile-qr-code" src={imageUrl} alt={`QR code to follow ${userName} on Tiny Outings`} /> : <div className="profile-qr-placeholder" aria-label="Preparing follow code" />;
}

function FollowingWeekSection({ profile, events, loading, onOpenActivity }) {
  const plans = profile
    ? events.filter((event) => String(event.user_id) === String(profile.user_id))
    : [];

  return (
    <section className="following-week-card">
      <div className="section-heading">
        <span>Following</span>
        <h2>{profile ? `${profile.display_name || profile.user_name}'s week` : 'Shared weeks'}</h2>
      </div>
      {loading ? <p className="social-empty">Loading shared plans...</p> : !profile ? (
        <p className="social-empty">Choose someone you follow to see the week they share.</p>
      ) : (
        <article className="following-week-person">
          <div className="following-week-person-heading">
            <img className="community-avatar" src={profile.avatar_url || defaultProfileAvatar} alt="" onError={(event) => { event.currentTarget.src = defaultProfileAvatar; }} />
            <div><strong>{profile.display_name || profile.user_name}</strong><small>@{profile.user_name}</small></div>
          </div>
          {plans.length ? (
            <div className="following-plan-list">
              {plans.map((event) => (
                <button type="button" key={event.calendar_event_id} onClick={() => onOpenActivity(event.activity)}>
                  <span>{formatDay(event.planned_date, 'short')} - {event.day_window}</span>
                  <strong>{event.title_override || event.activity.activity_name}</strong>
                </button>
              ))}
            </div>
          ) : <small className="social-empty">No shared plans for this week.</small>}
        </article>
      )}
    </section>
  );
}

function UserScreen({
  profile,
  signedIn,
  profileSaving,
  followingProfiles,
  followerProfiles,
  followingWeekEvents,
  selectedFollowingUserId,
  socialLoading,
  onOpenActivity,
  onSaveProfile,
  onSignIn,
  onShareProfile,
  onSearchProfiles,
  onFollowProfile,
  onSelectFollowingProfile,
  onUnfollow,
}) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [form, setForm] = useState({ user_name: '', display_name: '', avatar_url: '', default_calendar_visibility: 'followers' });
  const [followUsername, setFollowUsername] = useState('');
  const [usernameResults, setUsernameResults] = useState([]);
  const [usernameSearchMessage, setUsernameSearchMessage] = useState('');
  const [usernameSearching, setUsernameSearching] = useState(false);

  useEffect(() => {
    setForm({
      user_name: profile?.user_name || '',
      display_name: profile?.display_name || '',
      avatar_url: profile?.avatar_url || '',
      default_calendar_visibility: profile?.default_calendar_visibility || 'followers',
    });
  }, [profile]);

  async function searchUsernames(event) {
    event.preventDefault();
    setUsernameSearching(true);
    setUsernameSearchMessage('');
    const results = await onSearchProfiles(followUsername);
    setUsernameResults(results);
    setUsernameSearchMessage(results.length ? '' : 'No matching parent yet. Check the username and try again.');
    setUsernameSearching(false);
  }

  async function chooseSearchResult(person) {
    const alreadyFollowing = followingProfiles.some((item) => String(item.user_id) === String(person.user_id));
    if (alreadyFollowing) {
      onSelectFollowingProfile(person);
    } else {
      const followed = await onFollowProfile(person);
      if (!followed) return;
      onSelectFollowingProfile(followed);
    }
    setFollowUsername('');
    setUsernameResults([]);
    setUsernameSearchMessage('');
  }

  return (
    <section className="app-screen user-screen">
      <div className="screen-title compact">
        <span className="eyebrow">User</span>
        <h1>Your profile</h1>
        <p>Share your code and plan with your people.</p>
      </div>

      <section className="profile-card">
        <img
          src={profile?.avatar_url || defaultProfileAvatar}
          alt="Your profile"
          className="profile-avatar"
          onError={(event) => { event.currentTarget.src = defaultProfileAvatar; }}
        />
        <div className="profile-summary">
          <span className="eyebrow">Your account</span>
          <strong>{profile?.display_name || profile?.user_name || 'Plan together'}</strong>
          <small>{profile?.user_name ? `@${profile.user_name}` : 'Sign in to create your profile'}</small>
          {profile && <small>{profile.followers || 0} followers - {profile.following || 0} following</small>}
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
          <label className="wide"><span>Who can see your week</span><select value={form.default_calendar_visibility} onChange={(event) => setForm((current) => ({ ...current, default_calendar_visibility: event.target.value }))}><option value="followers">People who follow you</option><option value="private">Only you</option><option value="public">Everyone</option></select></label>
          <button className="primary-action wide" type="submit" disabled={profileSaving}>{profileSaving ? 'Saving...' : 'Save profile'}</button>
        </form>
      )}

      {signedIn && profile?.user_name && (
        <section className="profile-qr-card">
          <ProfileQrCode userName={profile.user_name} />
          <div>
            <span className="eyebrow">Plan together</span>
            <strong>Share your follow code</strong>
            <small>Parents who scan can follow you and see the week you share.</small>
            <button type="button" className="secondary-button" onClick={onShareProfile}>Share profile</button>
          </div>
        </section>
      )}

      {signedIn && (
        <section className="community-card user-community-card">
          <div className="section-heading">
            <span>Parents</span>
            <h2>{socialLoading ? 'Loading your people...' : `${followerProfiles.length} followers - ${followingProfiles.length} following`}</h2>
          </div>
          <form className="follow-parent-form" onSubmit={searchUsernames}>
            <input
              value={followUsername}
              onChange={(event) => {
                setFollowUsername(event.target.value);
                setUsernameResults([]);
                setUsernameSearchMessage('');
              }}
              placeholder="Search a username, e.g. @sam"
              required
            />
            <button type="submit" className="primary-action" disabled={usernameSearching}>{usernameSearching ? 'Searching...' : 'Search'}</button>
          </form>
          {(usernameResults.length > 0 || usernameSearchMessage) && (
            <div className="username-search-results" role="status">
              {usernameResults.map((person) => {
                const alreadyFollowing = followingProfiles.some((item) => String(item.user_id) === String(person.user_id));
                return (
                  <button type="button" className="username-search-result" key={person.user_id} onClick={() => chooseSearchResult(person)}>
                    <img className="community-avatar" src={person.avatar_url || defaultProfileAvatar} alt="" onError={(event) => { event.currentTarget.src = defaultProfileAvatar; }} />
                    <span><strong>{person.display_name || person.user_name}</strong><small>@{person.user_name}</small></span>
                    <em>{alreadyFollowing ? 'Show week' : 'Follow'}</em>
                  </button>
                );
              })}
              {usernameSearchMessage && <small className="social-empty">{usernameSearchMessage}</small>}
            </div>
          )}
          <div className="social-lists">
            <div>
              <strong>Following</strong>
              {followingProfiles.length ? followingProfiles.map((person) => (
                <div className="community-person is-selectable" key={person.user_id}>
                  <button
                    type="button"
                    className={`community-person-select${String(selectedFollowingUserId) === String(person.user_id) ? ' is-selected' : ''}`}
                    onClick={() => onSelectFollowingProfile(person)}
                    aria-pressed={String(selectedFollowingUserId) === String(person.user_id)}
                  >
                    <img className="community-avatar" src={person.avatar_url || defaultProfileAvatar} alt="" onError={(event) => { event.currentTarget.src = defaultProfileAvatar; }} />
                    <span className="community-person-copy"><strong>{person.display_name || person.user_name}</strong><small>@{person.user_name}</small></span>
                  </button>
                  <button type="button" className="follow-button is-following" onClick={() => onUnfollow(person)}>Following</button>
                </div>
              )) : <small className="social-empty">Scan a parent code or add their username.</small>}
            </div>
            <div>
              <strong>Followers</strong>
              {followerProfiles.length ? followerProfiles.map((person) => (
                <div className="community-person" key={person.user_id}>
                  <img className="community-avatar" src={person.avatar_url || defaultProfileAvatar} alt="" onError={(event) => { event.currentTarget.src = defaultProfileAvatar; }} />
                  <div><strong>{person.display_name || person.user_name}</strong><small>@{person.user_name}</small></div>
                </div>
              )) : <small className="social-empty">No followers yet. Share your code.</small>}
            </div>
          </div>
        </section>
      )}

      {signedIn && (
        <FollowingWeekSection
          profile={followingProfiles.find((person) => String(person.user_id) === String(selectedFollowingUserId)) || null}
          events={followingWeekEvents}
          loading={socialLoading}
          onOpenActivity={onOpenActivity}
        />
      )}
    </section>
  );
}

function CalendarScreen({
  weekDays,
  calendarEvents,
  onOpenActivity,
  onUpdateEvent,
  onRemoveEvent,
  onShareApp,
}) {
  const weekEvents = calendarEvents.filter((event) => weekDays.includes(event.planned_date));
  const [exportingCalendar, setExportingCalendar] = useState(false);

  async function exportCalendar(events, filename) {
    setExportingCalendar(true);
    try {
      await downloadICS(events, filename);
    } catch (error) {
      window.alert(`Calendar export could not start: ${error.message}`);
    } finally {
      setExportingCalendar(false);
    }
  }

  return (
    <section className="app-screen calendar-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Week</span>
        <h1>Your plan</h1>
        <p>Booked and maybe plans.</p>
      </div>

      <div className="week-export-card">
        <div>
          <strong>Take your week with you</strong>
          <small>{weekEvents.length ? `${weekEvents.length} plans ready to import.` : 'Add plans to export them.'}</small>
        </div>
        <button
          type="button"
          disabled={weekEvents.length === 0 || exportingCalendar}
          onClick={() => exportCalendar(weekEvents, `tiny-outings-week-${weekDays[0]}.ics`)}
        >
          {exportingCalendar ? 'Preparing...' : 'Export for Google Calendar'}
        </button>
      </div>

      <section className="week-share-card">
        <div>
          <span>Invite a parent</span>
          <strong>Share Tiny Outings</strong>
          <small>Send the app to someone planning their week too.</small>
        </div>
        <button type="button" onClick={onShareApp}>
          <span aria-hidden="true">+</span> Share app
        </button>
      </section>

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
}) {
  return (
    <section className="app-screen form-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Add</span>
        <h1>Add a spot.</h1>
        <p>Share the basics. Every new listing is checked before it appears.</p>
      </div>

      <form className="app-form link-only-form" onSubmit={onSubmit}>
        <label className="wide">
          <span>Activity link</span>
          <input
            type="url"
            required
            value={form.link}
            onChange={(event) => setForm((current) => ({ ...current, link: event.target.value }))}
            placeholder="https://activity-website..."
          />
          <small>Paste the activity website or its Google Maps link.</small>
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
          <span>Comment <em>Optional</em></span>
          <textarea
            value={form.comment}
            onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))}
            placeholder="Anything an admin should know..."
          />
        </label>
        <label>
          <span>Rating <em>Optional</em></span>
          <select
            value={form.rating}
            onChange={(event) => setForm((current) => ({ ...current, rating: event.target.value }))}
          >
            <option value="">No rating</option>
            {[1, 2, 3, 4, 5].map((rating) => (
              <option key={rating} value={rating}>{rating} out of 5</option>
            ))}
          </select>
        </label>

        <label className="wide photo-upload-field">
          <span>Photo <em>Optional</em></span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setForm((current) => ({
              ...current,
              photos: acceptedPhotoFiles(event.target.files),
            }))}
          />
          <small>{form.photos.length ? 'Photo ready to upload' : 'JPG, PNG, or WebP up to 8 MB'}</small>
        </label>

        <button className="primary-action wide" type="submit" disabled={loading}>
          {loading ? 'Reading...' : 'Add'}
        </button>
      </form>

    </section>
  );
}

function ReviewScreen({
  reviewQueue,
  reviewQueueLoading,
  reviewQueueError,
  adminSaving,
  onOpenReview,
  onResolveQueueItem,
  missingImageActivities,
  onRefresh,
}) {
  return (
    <section className="app-screen form-screen review-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Admin</span>
        <h1>Review listings.</h1>
        <p>Check incoming listings and give every card a useful image.</p>
      </div>

      <section className="review-queue" aria-live="polite">
        <div className="section-heading">
          <div>
            <span>Review queue</span>
            <h2>{reviewQueueLoading ? 'Loading review queue...' : `${reviewQueue.length} items to check`}</h2>
          </div>
          <button className="queue-refresh" type="button" onClick={onRefresh} disabled={reviewQueueLoading || adminSaving}>
            Refresh
          </button>
        </div>
        <p className="queue-intro">User submissions stay private until approved. Importer changes are logged here too.</p>
        {reviewQueueError && (
          <p className="queue-error">The review queue could not load. Tap Refresh to try again.</p>
        )}
        {!reviewQueueLoading && !reviewQueueError && reviewQueueSections.map((section) => {
          const items = reviewQueue.filter((item) => item.queue_type === section.type);
          return (
            <section key={section.type} className="review-subsection">
              <div className="review-group-heading">
                <div>
                  <span>{section.title}</span>
                  <small>{section.description}</small>
                </div>
                <strong>{items.length}</strong>
              </div>
              {items.length === 0 ? (
                <p className="queue-empty">Nothing waiting.</p>
              ) : (
                <div className="review-list">
                  {items.map((item) => {
                    const activity = item.activity;
                    const isUserSubmission = item.queue_type === 'user_submission';
                    return (
                      <article key={item.review_queue_id} className="review-item">
                        {activity ? (
                          <ActivityPhoto activity={activity} className="review-photo" />
                        ) : (
                          <div className="review-photo review-photo-placeholder" aria-hidden="true">+</div>
                        )}
                        <div>
                          <strong>{activity?.activity_name || item.summary}</strong>
                          <small>{activity ? `${activityPlanLabel(activity)} - ${activity.address || 'Address to review'}` : (item.source_name || 'Listing no longer available')}</small>
                          <small>{isUserSubmission ? (activity?.submission_notes || 'No parent note') : reviewQueueChangeSummary(item)}</small>
                        </div>
                        <div className="review-actions">
                          {activity && (
                            <button type="button" onClick={() => onOpenReview(activity)} disabled={adminSaving}>
                              {isUserSubmission ? 'Review submission' : 'View listing'}
                            </button>
                          )}
                          {!isUserSubmission && (
                            <button type="button" onClick={() => onResolveQueueItem(item)} disabled={adminSaving}>
                              Mark reviewed
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </section>

      <section className="review-queue image-review-queue" aria-live="polite">
        <div className="section-heading">
          <div>
            <span>Image audit</span>
            <h2>{`${missingImageActivities.length} cards need an image`}</h2>
          </div>
        </div>
        <p className="queue-intro">These listings currently use an illustration. Open one to upload a cover image or add an image URL.</p>
        {missingImageActivities.length === 0 ? (
          <p className="queue-empty">Every published card has an image.</p>
        ) : (
          <div className="review-list image-review-list">
            {missingImageActivities.map((activity) => (
              <article key={activity.activity_id} className="review-item">
                <div className="review-photo review-photo-placeholder" aria-hidden="true">No image</div>
                <div>
                  <strong>{activity.activity_name}</strong>
                  <small>{`${activityPlanLabel(activity)} - ${activity.address || 'Address to review'}`}</small>
                  <small>{`Source: ${activitySourceLabel(activity)}`}</small>
                </div>
                <div className="review-actions">
                  <button type="button" onClick={() => onOpenReview(activity)} disabled={adminSaving}>Add image</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function ActivityMapScreen({ activities }) {
  const concentrations = useMemo(() => activityConcentrations(activities), [activities]);
  const mappedActivityCount = activities.filter((activity) => activity.lat != null && activity.long != null).length;

  return (
    <section className="app-screen map-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Where are we</span>
        <h1>London hotspots.</h1>
        <p>Each bubble is a neighbourhood. Bigger means more outings.</p>
      </div>

      <div className="london-landmark-doodles" aria-hidden="true">
        <svg className="doodle-big-ben" viewBox="0 0 72 118" fill="none">
          <path d="M20 108h32M25 108l4-66h14l4 66M24 42h24L36 13 24 42Z" />
          <path d="M29 42h14v17H29zM31 48h10" />
          <path d="M34 13V5m0 0 5 5m-5-5-5 5M24 108l-4 7m32-7 4 7" />
        </svg>
        <svg className="doodle-eye" viewBox="0 0 120 112" fill="none">
          <circle cx="60" cy="49" r="35" />
          <circle cx="60" cy="49" r="5" />
          <path d="M60 14v70M25 49h70M35 24l50 50M85 24 35 74M52 84l-13 20m29-20 13 20M20 104h80" />
        </svg>
        <svg className="doodle-bridge" viewBox="0 0 146 70" fill="none">
          <path d="M8 58h130M23 58V25m18 33V25m64 33V25m18 33V25" />
          <path d="M23 25h18l-9-15-9 15Zm82 0h18l-9-15-9 15ZM41 37h64M41 25l64 33M105 25 41 58" />
          <path d="M12 65c12-8 24 8 36 0s24 8 36 0 24 8 36 0" />
        </svg>
      </div>

      <div className="map-summary">
        <span><strong>{mappedActivityCount.toLocaleString()}</strong> activities on the map</span>
      </div>

      <div className="bubble-map-legend" aria-label="Map bubble size legend">
        <i className="is-small" aria-hidden="true" /><span>Fewer</span>
        <i className="is-large" aria-hidden="true" /><span>More</span>
      </div>

      <div className="london-map-shell">
        <MapContainer
          center={[51.5074, -0.1278]}
          zoom={10}
          zoomSnap={0.25}
          minZoom={9}
          maxZoom={15}
          maxBounds={[[51.24, -0.56], [51.78, 0.38]]}
          scrollWheelZoom={false}
          className="london-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <ActivityBubbleLayer concentrations={concentrations} />
        </MapContainer>
      </div>
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
  signedIn,
  onSignIn,
  isAdmin,
  adminSaving,
  onSaveAdminEdits,
  onArchive,
  onReviewDraft,
  onOpenShare,
  onReport,
  onHideActivity,
  onClose,
}) {
  const googlePlacesUrl = activityShareUrl(activity);
  const mapEmbedUrl = googleMapEmbedUrl(activity);
  const websiteUrl = activityWebsiteUrl(activity);
  const organiserWebsiteUrl = !isOfficialWebsiteUrl(activity.organiser_website) || sameExternalUrl(activity.website, activity.organiser_website)
    ? null
    : activity.organiser_website || null;
  const cost = activityCost(activity);
  const flexible = isFlexibleActivity(activity);
  const isDraft = activity.public_listing_status === 'draft';

  return (
    <section className="app-screen activity-detail-screen">
      <button className="sheet-close detail-back-button" type="button" onClick={onClose}>
        Back
      </button>

      <div className="detail-hero">
        <div className="detail-gallery" aria-label={`${activity.activity_name} photos`}>
          <ActivityPhoto activity={activity} className="detail-photo is-main" priority />
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
        {isDraft && isAdmin && (
          <div className="draft-review-banner">
            <strong>Draft submission</strong>
            <span>Check the full card, correct anything needed, then publish or archive it.</span>
          </div>
        )}
        <p className="eyebrow">{activityPlanLabel(activity)}</p>
        <h1>{activity.activity_name}</h1>
        <p className="detail-description">
          {activity.description || 'Description coming soon. Check the links for the latest details.'}
        </p>
        {isDraft && activity.submission_notes && (
          <p className="draft-submission-note"><strong>Parent note</strong>{activity.submission_notes}</p>
        )}
        {isDraft && activity.submission_rating != null && (
          <p className="draft-submission-rating">Parent rating: {activity.submission_rating} out of 5</p>
        )}

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
            <span>View map</span>
          </button>
        )}

        <div className="external-links detail-links">
          {websiteUrl && <a href={websiteUrl} target="_blank" rel="noreferrer">Website</a>}
          {organiserWebsiteUrl && (
            <a href={organiserWebsiteUrl} target="_blank" rel="noreferrer">Organiser site</a>
          )}
          <a href={googlePlacesUrl} target="_blank" rel="noreferrer">Google Places</a>
        </div>

        <div className="detail-actions">
          <button className="share-launcher" type="button" onClick={() => onOpenShare(activity)}>
            <span aria-hidden="true">+</span>
            <span><strong>Share</strong><small>Send this outing</small></span>
          </button>
          <button className="report-launcher" type="button" onClick={() => onReport(activity)}>
            Report a listing
          </button>
          <button className="hide-activity-button" type="button" onClick={() => onHideActivity(activity)}>
            Don't show this again
          </button>
        </div>
      </div>

      {isAdmin && (
        <ActivityAdminEditor
          activity={activity}
          saving={adminSaving}
          onSave={onSaveAdminEdits}
          onArchive={onArchive}
          onPublishDraft={isDraft ? (values) => onReviewDraft(activity, 'published', values) : null}
        />
      )}

      {!isDraft && signedIn ? (
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
      ) : !isDraft ? (
        <section className="review-card review-signin-card">
          <div><h3>Have you been</h3><p>Sign in to leave a rating or comment.</p></div>
          <button className="primary-action" type="button" onClick={onSignIn}>Sign in to review</button>
        </section>
      ) : null}
    </section>
  );
}

function ShareSheet({ shareData, onClose, onShare, onCopy, onReport }) {
  const openProvider = (provider) => {
    if (provider === 'instagram') {
      onShare();
      return;
    }
    window.open(socialShareUrl(provider, shareData), '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="share-sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="share-sheet" role="dialog" aria-modal="true" aria-label="Share options" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="share-sheet-heading">
          <span>Send to</span>
          <button type="button" onClick={onClose} aria-label="Close share options">x</button>
        </div>
        <p className="share-sheet-title">{shareData.title}</p>
        <div className="share-row">
          <button className="share-option native-share" type="button" onClick={onShare}><i>+</i><span>Share</span></button>
          <button className="share-option whatsapp" type="button" onClick={() => openProvider('whatsapp')}><i>W</i><span>WhatsApp</span></button>
          <button className="share-option instagram" type="button" onClick={() => openProvider('instagram')}><i>IG</i><span>Instagram</span></button>
          <button className="share-option facebook" type="button" onClick={() => openProvider('facebook')}><i>f</i><span>Facebook</span></button>
          <button className="share-option sms" type="button" onClick={() => openProvider('sms')}><i>SMS</i><span>Messages</span></button>
        </div>
        <div className="share-tools">
          <button type="button" onClick={onCopy}><i>Link</i><span>Copy link</span></button>
          {onReport && <button type="button" onClick={onReport}><i>!</i><span>Report</span></button>}
        </div>
      </section>
    </div>
  );
}

function ReportSheet({ activity, value, submitting, onChange, onClose, onSubmit }) {
  return (
    <div className="share-sheet-backdrop" role="presentation" onClick={onClose}>
      <form className="report-sheet" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="share-sheet-heading"><span>Report a listing</span><button type="button" onClick={onClose} aria-label="Close report form">x</button></div>
        <p>Tell us what needs fixing for <strong>{activity.activity_name}</strong>.</p>
        <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder="Wrong details, broken link, unsuitable listing..." required />
        <button className="primary-action wide" type="submit" disabled={submitting}>{submitting ? 'Sending...' : 'Send report'}</button>
      </form>
    </div>
  );
}

function DuplicateSubmissionSheet({ activity, onClose, onUseExisting, onContinue }) {
  return (
    <div className="share-sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="duplicate-submission-sheet" role="dialog" aria-modal="true" aria-label="Possible duplicate activity" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="share-sheet-heading">
          <span>Already listed</span>
          <button type="button" onClick={onClose} aria-label="Close duplicate check">x</button>
        </div>
        <p>We found an outing that looks like the same activity. Is this the one you mean</p>
        <article className="duplicate-activity-preview">
          <ActivityPhoto activity={activity} className="duplicate-activity-photo" />
          <div>
            <strong>{activity.activity_name}</strong>
            <small>{activity.address || activity.borough || 'London'}</small>
            <small>{activity.card_summary || activity.description || 'View the existing listing for details.'}</small>
          </div>
        </article>
        <div className="duplicate-submission-actions">
          <button className="primary-action" type="button" onClick={onUseExisting}>Yes, show this one</button>
          <button className="secondary-button" type="button" onClick={onContinue}>No, add mine</button>
        </div>
      </section>
    </div>
  );
}

function ActivityAdminEditor({ activity, saving, onSave, onArchive, onPublishDraft }) {
  const [coverImageFile, setCoverImageFile] = useState(null);
  const [form, setForm] = useState({
    activity_name: activity.activity_name || '',
    address: activity.address || '',
    borough: activity.borough || '',
    lat: String(activity.lat ?? ''),
    long: String(activity.long ?? ''),
    category: activityPlanLabel({ ...activity, plan_label: null }),
    start_time: String(activity.start_time || '').slice(0, 5),
    end_time: String(activity.end_time || '').slice(0, 5),
    description: activity.description || '',
    cost: activity.cost || '',
    age_suitability: activity.age_suitability || '',
    user_image_url: activity.user_image_url || '',
    website: activity.website || '',
    organiser_website: activity.organiser_website || '',
    google_link: activity.google_place_uri || activity.google_link || '',
  });

  useEffect(() => {
    setCoverImageFile(null);
    setForm({
      activity_name: activity.activity_name || '',
      address: activity.address || '',
      borough: activity.borough || '',
      lat: String(activity.lat ?? ''),
      long: String(activity.long ?? ''),
      category: activityPlanLabel({ ...activity, plan_label: null }),
      start_time: String(activity.start_time || '').slice(0, 5),
      end_time: String(activity.end_time || '').slice(0, 5),
      description: activity.description || '',
      cost: activity.cost || '',
      age_suitability: activity.age_suitability || '',
      user_image_url: activity.user_image_url || '',
      website: activity.website || '',
      organiser_website: activity.organiser_website || '',
      google_link: activity.google_place_uri || activity.google_link || '',
    });
  }, [activity]);

  function formValues() {
    return Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim()]),
    );
  }

  function submit(event) {
    event.preventDefault();
    const values = formValues();
    onSave(activity, values, coverImageFile);
  }

  function publish() {
    onPublishDraft(formValues());
  }

  return (
    <form className="admin-editor" onSubmit={submit}>
      <div>
        <span className="eyebrow">Admin tools</span>
        <h2>Check this listing</h2>
        <p>Corrections are saved as importer feedback.</p>
      </div>
      <label className="wide">
        <span>Activity name</span>
        <input
          value={form.activity_name}
          onChange={(event) => setForm((current) => ({ ...current, activity_name: event.target.value }))}
          required
        />
      </label>
      <label className="wide">
        <span>Address</span>
        <input
          value={form.address}
          onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
          required
        />
      </label>
      <label>
        <span>Borough</span>
        <input
          value={form.borough}
          onChange={(event) => setForm((current) => ({ ...current, borough: event.target.value }))}
          placeholder="e.g. Hackney"
        />
      </label>
      <label>
        <span>Latitude</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={form.lat}
          onChange={(event) => setForm((current) => ({ ...current, lat: event.target.value }))}
          placeholder="Auto-filled on publish"
        />
      </label>
      <label>
        <span>Longitude</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={form.long}
          onChange={(event) => setForm((current) => ({ ...current, long: event.target.value }))}
          placeholder="Auto-filled on publish"
        />
      </label>
      <label>
        <span>Category</span>
        <select
          value={form.category}
          onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
        >
          {activityInterestOptions.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Start time</span>
        <input
          type="time"
          value={form.start_time}
          onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))}
        />
      </label>
      <label>
        <span>End time</span>
        <input
          type="time"
          value={form.end_time}
          onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))}
        />
      </label>
      <label>
        <span>Price</span>
        <input
          value={form.cost}
          onChange={(event) => setForm((current) => ({ ...current, cost: event.target.value }))}
          placeholder="Free or GBP 8"
        />
      </label>
      <label>
        <span>Age suitability</span>
        <input
          value={form.age_suitability}
          onChange={(event) => setForm((current) => ({ ...current, age_suitability: event.target.value }))}
          placeholder="e.g. Under 5s"
        />
      </label>
      <label className="wide">
        <span>Description</span>
        <textarea
          value={form.description}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          placeholder="What parents can expect"
        />
      </label>
      <label className="wide photo-upload-field">
        <span>Upload cover image</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => setCoverImageFile(event.target.files?.[0] || null)}
        />
        <small>{coverImageFile ? coverImageFile.name : activity.admin_cover_image_url ? 'Current admin cover image stays until replaced' : 'JPG, PNG or WebP up to 8 MB'}</small>
      </label>
      <label>
        <span>Admin image URL</span>
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
      {onPublishDraft && (
        <button className="primary-action" type="button" onClick={publish} disabled={saving}>
          Publish listing
        </button>
      )}
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

function BottomNav({ activeScreen, setActiveScreen, isAdmin }) {
  const items = [
    ['start', 'Plan'],
    ['swipe', 'Swipe'],
    ['calendar', 'Week'],
    ['map', 'Where'],
    ['add', 'Add'],
    ...(isAdmin ? [['review', 'Review']] : []),
  ];

  return (
    <nav className={classNames('bottom-nav', isAdmin && 'has-review')} aria-label="App navigation">
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
