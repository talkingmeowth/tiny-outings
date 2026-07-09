import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from './supabaseClient';

const dayWindows = ['morning', 'afternoon', 'evening'];
const storagePrefix = 'tiny-outings';
const visibilityOptions = ['private', 'public'];
const statusOptions = ['booked', 'tentative'];
const statusLabels = {
  booked: 'Booked',
  tentative: 'Tentative',
  not_selected: 'Not selected',
};

const emptyLinkForm = {
  activity_link: '',
};

const activityInterestOptions = [
  'child friendly cafe',
  'park',
  'child friendly museum',
  'family activity',
  'baby stay and play',
  'story time',
  'sensory play',
  'soft play',
  'family hub',
];

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

  return {
    ...activity,
    activity_id: String(activity.activity_id),
    start_time: String(activity.start_time || '09:00').slice(0, 5),
    end_time: String(activity.end_time || '10:00').slice(0, 5),
    time_window: activity.time_window || toWindow(activity.start_time),
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
  if (miles == null || Number.isNaN(miles)) return 'Distance TBC';
  if (miles < 0.1) return 'Very nearby';
  return `${miles.toFixed(1)} mi`;
}

function estimateWalkMinutes(miles) {
  if (miles == null || Number.isNaN(miles)) return null;
  return Math.max(1, Math.round(miles * 20));
}

function formatWalk(miles) {
  const minutes = estimateWalkMinutes(miles);
  return minutes ? `${minutes} min walk` : 'Walk TBC';
}

function formatAvailability(activity) {
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

function googleDirectionsUrl(activity, userLocation) {
  const destination = activity.lat != null && activity.long != null
    ? `${activity.lat},${activity.long}`
    : activity.address || activity.activity_name;
  const params = new URLSearchParams({
    api: '1',
    destination,
    travelmode: 'walking',
  });

  if (userLocation?.lat != null && userLocation?.long != null) {
    params.set('origin', `${userLocation.lat},${userLocation.long}`);
  }

  if (activity.google_place_id) {
    params.set('destination_place_id', activity.google_place_id);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function activityWebsiteUrl(activity) {
  return activity.website || activity.source_url || activity.google_place_uri || activity.google_link || googleEntryUrl(activity);
}

function activityPhotoUrl(activity) {
  if (activity.google_photo_url) return activity.google_photo_url;
  if (activity.image_url) return activity.image_url;

  const website = activityWebsiteUrl(activity);
  if (!website) return null;
  try {
    const parsed = new URL(website);
    parsed.search = '';
    parsed.hash = '';
    return `https://image.thum.io/get/width/1200/crop/900/${parsed.toString()}`;
  } catch {
    return null;
  }
}

function activityPhotoLabel(activity) {
  if (activity.google_photo_url) return 'Google Places photo';
  if (activity.image_url) return 'Website photo';
  if (activityWebsiteUrl(activity)) return 'Website image';
  return 'Photo pending';
}

function isActivityAvailableOn(activity, dateISO) {
  const weekday = weekdayName(dateISO);
  const explicitDates = activity.available_dates || [];

  if (activity.activity_date === dateISO || explicitDates.includes(dateISO)) return true;

  if (
    ['one_off', 'specific_dates'].includes(activity.availability_type) &&
    (activity.activity_date || explicitDates.length)
  ) {
    return false;
  }

  if (activity.availability_start_date && dateISO < activity.availability_start_date) return false;
  if (activity.availability_end_date && dateISO > activity.availability_end_date) return false;

  const availableDays = activity.available_days_of_week?.length
    ? activity.available_days_of_week
    : activity.days_of_week;

  if (availableDays?.length) return availableDays.includes(weekday);
  return true;
}

function activityMatchesInterests(activity, interests) {
  if (!interests?.length) return true;
  const haystack = `${activity.category} ${activity.activity_name} ${activity.description || ''}`.toLowerCase();
  return interests.some((interest) => haystack.includes(interest.toLowerCase()));
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
  const [activeScreen, setActiveScreen] = useState('start');
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedWindow, setSelectedWindow] = useState('morning');
  const [filters, setFilters] = useState(() => {
    const stored = loadStored('filters', {});
    const storedInterests = Array.isArray(stored.interests) ? stored.interests : [];
    return {
      distanceMode: stored.distanceMode === 'walk' ? 'walk' : 'radius',
      radiusMiles: Number(stored.radiusMiles) || 3,
      walkMinutes: Number(stored.walkMinutes) || 35,
      weekStart: stored.weekStart || startOfWeekISO(todayISO()),
      interests: storedInterests.filter((interest) => activityInterestOptions.includes(interest)),
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
  const [dragState, setDragState] = useState({ activityId: null, startX: null, offsetX: 0 });

  const weekDays = Array.from({ length: 7 }, (_, index) => addDaysISO(filters.weekStart, index));
  const activeSlot = slotKey(selectedDate, selectedWindow);
  const allActivities = activities.map(normalizeActivity);
  const activityById = new Map(allActivities.map((activity) => [String(activity.activity_id), activity]));
  const distanceLimit = filters.distanceMode === 'walk'
    ? Number(filters.walkMinutes) / 20
    : Number(filters.radiusMiles);

  const filteredActivities = allActivities
    .map((activity) => ({
      ...activity,
      distance: milesBetween(userLocation, { lat: activity.lat, long: activity.long }),
    }))
    .filter((activity) => {
      const dayMatch = isActivityAvailableOn(activity, selectedDate);
      const interestMatch = activityMatchesInterests(activity, filters.interests);
      const distanceMatch =
        !userLocation || activity.distance == null || activity.distance <= distanceLimit;
      return activity.public_listing_status === 'published' && dayMatch && interestMatch && distanceMatch;
    });

  const slotActivities = filteredActivities.filter((activity) => activity.time_window === selectedWindow);
  const swipedIds = new Set((swipes[activeSlot] || []).map((item) => String(item.activity_id)));
  const deckActivities = slotActivities.filter((activity) => !swipedIds.has(String(activity.activity_id)));
  const currentShortlist = (shortlists[activeSlot] || [])
    .map((activityId) => activityById.get(String(activityId)))
    .filter(Boolean);
  const chosenForSlot = calendarEvents.find(
    (event) => event.planned_date === selectedDate && event.day_window === selectedWindow,
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
    requestLocation();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadActivities() {
      if (!supabase) return;
      setLoading(true);
      const { data, error } = await supabase
        .from('activities')
        .select('*')
        .eq('public_listing_status', 'published')
        .order('start_time', { ascending: true });

      if (cancelled) return;

      if (error) {
        setNotice(`Supabase is connected, but activities could not load: ${error.message}`);
      } else {
        setActivities((data || []).map(normalizeActivity));
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
        setNotice('Location updated. Your activity deck is centred on you.');
      },
      () => {
        setLocationStatus('blocked');
        setNotice('Location access was not granted. You can still browse all activities.');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout: 12000,
      },
    );
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
      setNotice(`${activity.activity_name} was added to this ${selectedWindow} shortlist.`);
    } else {
      setNotice(`${activity.activity_name} marked as not selected for this slot.`);
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
    setNotice(`Reset ${selectedWindow} on ${formatDay(selectedDate)}.`);
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
      visibility: 'private',
      created_at: new Date().toISOString(),
    };

    setCalendarEvents((current) => [
      ...current.filter(
        (item) => !(item.planned_date === selectedDate && item.day_window === selectedWindow),
      ),
      event,
    ]);

    setLocalStatus(activity, status);
    setNotice(`${activity.activity_name} is now ${statusLabels[status].toLowerCase()} in your calendar.`);
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

  async function submitActivityLink(event) {
    event.preventDefault();
    const link = linkForm.activity_link.trim();

    if (!link) {
      setNotice('Paste a Google Maps or activity link first.');
      return;
    }

    if (!supabase) {
      setNotice('Add your Supabase URL and publishable key before submitting an activity link.');
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke('activity-link-autofill', {
      body: { link },
    });

    if (error) {
      setNotice(`Google autofill could not run yet: ${error.message}`);
      setLoading(false);
      return;
    }

    const enriched = data?.activity || data;
    if (!enriched?.activity_name || !enriched?.address) {
      setNotice('Google Places did not return enough detail for that link. Try the Google Maps place link.');
      setLoading(false);
      return;
    }

    const payload = buildSubmittedPayload(enriched, link);
    const { error: insertError } = await supabase.from('activities').insert(payload);

    setLoading(false);
    if (insertError) {
      setNotice(`The activity was enriched, but could not be saved: ${insertError.message}`);
      return;
    }

    setLinkForm(emptyLinkForm);
    setNotice(`${payload.activity_name} was saved as a real draft activity for review.`);
  }

  async function submitReview(event) {
    event.preventDefault();
    if (!selectedActivity) return;
    if (!supabase) {
      setNotice('Add your Supabase URL and publishable key before saving reviews or photos.');
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
        <button className="brand-lockup" type="button" onClick={() => setActiveScreen('start')}>
          <span>Tiny</span>
          <strong>Outings</strong>
        </button>
        <div className="topbar-actions">
          <span className="sync-dot">{hasSupabaseConfig ? 'Supabase' : 'Set env'}</span>
          <button className="icon-button" type="button" onClick={requestLocation}>
            {locationStatus === 'ready' ? 'Location on' : 'Use location'}
          </button>
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
            locationStatus={locationStatus}
            userLocation={userLocation}
            weekDays={weekDays}
            activityCount={filteredActivities.length}
            onRequestLocation={requestLocation}
            onStart={() => setActiveScreen('swipe')}
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
            shortlist={currentShortlist}
            chosenForSlot={chosenForSlot}
            statuses={statuses}
            selectedDateKey={selectedDate}
            dragState={dragState}
            loading={loading}
            hasActivities={allActivities.length > 0}
            userLocation={userLocation}
            onSwipe={handleSwipe}
            onStartDrag={startDrag}
            onMoveDrag={moveDrag}
            onEndDrag={endDrag}
            onResetSlot={resetCurrentSlot}
            onChoose={chooseActivity}
            onOpenActivity={setSelectedActivity}
          />
        )}

        {activeScreen === 'calendar' && (
          <CalendarScreen
            weekDays={weekDays}
            calendarEvents={calendarEvents}
            onOpenActivity={setSelectedActivity}
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
      </main>

      {selectedActivity && (
        <ActivityDetail
          activity={selectedActivity}
          userLocation={userLocation}
          reviewForm={reviewForm}
          setReviewForm={setReviewForm}
          submitReview={submitReview}
          onClose={() => setSelectedActivity(null)}
        />
      )}

      <BottomNav activeScreen={activeScreen} setActiveScreen={setActiveScreen} />
    </div>
  );
}

function StartScreen({
  filters,
  setFilters,
  locationStatus,
  userLocation,
  weekDays,
  activityCount,
  onRequestLocation,
  onStart,
}) {
  const isWalkMode = filters.distanceMode === 'walk';
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
        <span className="eyebrow">Maternity and paternity leave planner</span>
        <h1>Plan your week by swiping.</h1>
        <p>
          Tiny Outings uses your current location, planning week, and interests to help you pick a
          morning, afternoon, and evening plan with your baby.
        </p>
      </div>

      <div className="filter-card location-card">
        <div className="field-group">
          <span>Planning week</span>
          <strong>{formatWeekRange(filters.weekStart)}</strong>
          <p>Choose the week you want to plan, then swipe through each day.</p>
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
          <span>Activity interests</span>
          <p>Pick what you are interested in booking. Leave everything off to see all activities.</p>
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

        <div className="field-group">
          <span>Current location</span>
          <strong>
            {locationStatus === 'ready' && 'Location active'}
            {locationStatus === 'requesting' && 'Asking permission...'}
            {locationStatus === 'blocked' && 'Location not active'}
            {locationStatus === 'idle' && 'Location not requested'}
          </strong>
          <p>
            {userLocation
              ? 'Activities are filtered around where you are now.'
              : 'Allow location to filter nearby activities. If you skip it, the app shows all real listings.'}
          </p>
          <button className="secondary-button" type="button" onClick={onRequestLocation}>
            Use current location
          </button>
        </div>

        <div className="field-group">
          <span>Distance filter</span>
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
          </div>
        </div>

        <div className="range-card">
          <span>{isWalkMode ? `${filters.walkMinutes} minute walk` : `${filters.radiusMiles} mile radius`}</span>
          {isWalkMode ? (
            <label>
              <span>Maximum walking time</span>
              <input
                type="range"
                min="5"
                max="90"
                step="5"
                value={filters.walkMinutes}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, walkMinutes: Number(event.target.value) }))
                }
              />
            </label>
          ) : (
            <label>
              <span>Maximum radius</span>
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
          <span>Real listings ready</span>
          <strong>{activityCount}</strong>
          <small>No fake activities are shown.</small>
        </div>
        <button className="primary-action" type="button" onClick={onStart}>
          Start swiping
        </button>
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
  shortlist,
  chosenForSlot,
  statuses,
  selectedDateKey,
  dragState,
  loading,
  hasActivities,
  userLocation,
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
          <strong>{shortlist.length} shortlisted</strong>
        </div>
        <button type="button" onClick={onResetSlot}>Reset</button>
      </div>

      <div className="tinder-stage" aria-live="polite">
        {loading && <EmptyDeck title="Loading" message="Pulling real activities from Supabase." />}
        {!loading && !hasActivities && (
          <EmptyDeck
            title="No real activities yet"
            message="Your Supabase activities table is empty. Add or seed real listings to start swiping."
          />
        )}
        {!loading && hasActivities && deckActivities.length === 0 && (
          <EmptyDeck
            title="Deck complete"
            message="You have swiped through the real activities for this slot. Reset the slot or pick from your shortlist."
          />
        )}
        {!loading && deckActivities.slice(0, 3).reverse().map((activity, reverseIndex, visibleDeck) => {
          const stackIndex = visibleDeck.length - reverseIndex - 1;
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
              userLocation={userLocation}
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
          Nope
        </button>
        <button
          className="swipe-button info"
          type="button"
          disabled={!topActivity}
          onClick={() => onOpenActivity(topActivity)}
        >
          Review
        </button>
        <button
          className="swipe-button yes"
          type="button"
          disabled={!topActivity}
          onClick={() => onSwipe(topActivity, 'yes')}
        >
          Yes
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
  userLocation,
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
  const googleUrl = googleEntryUrl(activity);
  const directionsUrl = googleDirectionsUrl(activity, userLocation);
  const websiteUrl = activityWebsiteUrl(activity);

  return (
    <article
      className={classNames('swipe-card', isTop && 'is-top', decisionClass)}
      style={{
        transform: `translateX(${offset}px) translateY(${stackOffset}px) scale(${1 - stackIndex * 0.035}) rotate(${rotate}deg)`,
        zIndex: 10 - stackIndex,
      }}
      onPointerDown={(event) => isTop && onStartDrag(event, activity)}
      onPointerMove={(event) => isTop && onMoveDrag(event, activity)}
      onPointerUp={() => isTop && onEndDrag(activity)}
      onPointerCancel={() => isTop && onEndDrag(activity)}
    >
      <span className="decision-stamp yes">Yes</span>
      <span className="decision-stamp no">No</span>

      <div
        className={classNames('card-photo', photoUrl && 'has-image')}
        style={imageStyle}
      >
        <span>{photoLabel}</span>
      </div>

      <div className="card-content">
        <div className="card-kicker">
          <span>{activity.category}</span>
          <StatusPill status={status || 'tentative'} ghost={!status} />
        </div>
        <h2>{activity.activity_name}</h2>
        <p>{activity.description || activity.address || 'Google Places details will appear here when available.'}</p>

        <div className="activity-facts">
          <span>{activity.start_time} to {activity.end_time}</span>
          <span>{formatAvailability(activity)}</span>
          <span>{formatDistance(activity.distance)} - {formatWalk(activity.distance)}</span>
          <span>{activity.age_suitability || 'Age TBC'}</span>
          <span>
            {activity.google_rating || activity.app_rating
              ? `${activity.google_rating || activity.app_rating}/5 Google`
              : 'Google rating TBC'}
          </span>
        </div>

        <div className="card-links" onPointerDown={(event) => event.stopPropagation()}>
          <a href={websiteUrl} target="_blank" rel="noreferrer">Website</a>
          <a href={googleUrl} target="_blank" rel="noreferrer">Google entry</a>
          <a href={directionsUrl} target="_blank" rel="noreferrer">Walk route</a>
          <button type="button" onClick={() => onOpenActivity(activity)}>Review</button>
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
        <span>Shortlist</span>
        <h2>{selectedWindow} on {formatDay(selectedDate)}</h2>
      </div>

      {chosenForSlot && (
        <div className="chosen-slot-card">
          <span>Calendar pick</span>
          <strong>{chosenForSlot.activity.activity_name}</strong>
          <small>{statusLabels[chosenForSlot.status]} - {chosenForSlot.visibility}</small>
        </div>
      )}

      {shortlist.length === 0 ? (
        <div className="empty-list">
          Swipe right to build a shortlist for this exact day and time window.
        </div>
      ) : (
        <div className="shortlist-list">
          {shortlist.map((activity) => (
            <article key={activity.activity_id} className="shortlist-card">
              <button type="button" onClick={() => onOpenActivity(activity)}>
                <strong>{activity.activity_name}</strong>
                <span>{activity.start_time} to {activity.end_time} - {activity.category}</span>
              </button>
              <div className="shortlist-actions">
                <button type="button" onClick={() => onChoose(activity, 'tentative')}>
                  Tentative
                </button>
                <button type="button" onClick={() => onChoose(activity, 'booked')}>
                  Book
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
        <span className="eyebrow">In-app calendar</span>
        <h1>Your week</h1>
        <p>Chosen activities appear here. Set visibility and export to Google Calendar or ICS.</p>
      </div>

      <div className="calendar-list">
        {weekDays.map((day) => (
          <section key={day} className="calendar-day">
            <h2>{formatDay(day, 'long')}</h2>
            {dayWindows.map((windowName) => {
              const event = calendarEvents.find(
                (item) => item.planned_date === day && item.day_window === windowName,
              );
              return (
                <div key={`${day}-${windowName}`} className="calendar-slot">
                  <span className="slot-name">{windowName}</span>
                  {event ? (
                    <article className="calendar-event">
                      <button type="button" onClick={() => onOpenActivity(event.activity)}>
                        <strong>{event.activity.activity_name}</strong>
                        <span>{event.start_time} to {event.end_time}</span>
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
                        <select
                          value={event.visibility}
                          onChange={(changeEvent) =>
                            onUpdateEvent(event, { visibility: changeEvent.target.value })
                          }
                        >
                          {visibilityOptions.map((visibility) => (
                            <option key={visibility} value={visibility}>{visibility}</option>
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
                  ) : (
                    <span className="open-slot">Open</span>
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
        <span className="eyebrow">Add an activity</span>
        <h1>Paste one link.</h1>
        <p>
          The backend reads the Google/activity link, fills the activity table fields, and saves it as a real draft.
        </p>
      </div>

      <form className="app-form link-only-form" onSubmit={onSubmit}>
        <label className="wide">
          <span>Google Maps or activity link</span>
          <input
            required
            value={form.activity_link}
            onChange={(event) => setForm({ activity_link: event.target.value })}
            placeholder="https://maps.google.com/..."
          />
        </label>

        <button className="primary-action wide" type="submit" disabled={loading}>
          {loading ? 'Autofilling...' : 'Autofill and save draft'}
        </button>
      </form>
    </section>
  );
}

function ActivityDetail({
  activity,
  userLocation,
  reviewForm,
  setReviewForm,
  submitReview,
  onClose,
}) {
  const googleUrl = googleEntryUrl(activity);
  const directionsUrl = googleDirectionsUrl(activity, userLocation);
  const websiteUrl = activityWebsiteUrl(activity);
  const photoUrl = activityPhotoUrl(activity);
  const photoLabel = activityPhotoLabel(activity);
  const photoStyle = photoUrl
    ? { '--card-photo': `url("${photoUrl}")` }
    : undefined;

  return (
    <div className="detail-backdrop" role="dialog" aria-modal="true">
      <aside className="detail-sheet">
        <button className="sheet-close" type="button" onClick={onClose}>Close</button>
        <div
          className={classNames('detail-photo', photoUrl && 'has-image')}
          style={photoStyle}
        >
          <span>{photoLabel}</span>
          <small>{activity.address}</small>
        </div>

        <p className="eyebrow">{activity.category}</p>
        <h2>{activity.activity_name}</h2>
        <p>{activity.description || 'No description yet.'}</p>

        <div className="detail-grid">
          <span><strong>Time</strong>{activity.start_time} to {activity.end_time}</span>
          <span><strong>Available</strong>{formatAvailability(activity)}</span>
          <span><strong>Address</strong>{activity.address}</span>
          <span><strong>Age</strong>{activity.age_suitability || 'TBC'}</span>
          <span><strong>Child friendly</strong>{activity.child_friendly_score || 'Not rated'}</span>
          <span><strong>Google rating</strong>{activity.google_rating || activity.app_rating || 'Not rated'}</span>
          <span><strong>Reviews</strong>{activity.google_user_rating_count || activity.number_of_reviews || 0}</span>
        </div>

        <div className="external-links">
          <a href={websiteUrl} target="_blank" rel="noreferrer">Website</a>
          <a href={googleUrl} target="_blank" rel="noreferrer">Google entry</a>
          <a href={directionsUrl} target="_blank" rel="noreferrer">Walk route</a>
        </div>

        <form className="review-card" onSubmit={submitReview}>
          <h3>Add review or photo</h3>
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
              placeholder="Buggy access, toilets, feeding space, vibe..."
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
          <button className="primary-action" type="submit">Save review/photo</button>
        </form>
      </aside>
    </div>
  );
}

function StatusPill({ status, ghost = false }) {
  return (
    <span className={classNames('status-pill', `status-${status}`, ghost && 'is-ghost')}>
      {ghost ? 'Unseen' : statusLabels[status]}
    </span>
  );
}

function BottomNav({ activeScreen, setActiveScreen }) {
  const items = [
    ['start', 'Start'],
    ['swipe', 'Swipe'],
    ['calendar', 'Calendar'],
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
