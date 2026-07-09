import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from './supabaseClient';
import { boroughs, categories, sampleActivities, sampleParents } from './sampleData';

const dayWindows = ['morning', 'afternoon', 'evening'];
const storagePrefix = 'tiny-outings';
const visibilityOptions = ['private', 'followers', 'public'];
const statusOptions = ['booked', 'tentative'];
const statusLabels = {
  booked: 'Booked',
  tentative: 'Tentative',
  not_selected: 'Not selected',
};

const emptyActivityForm = {
  activity_name: '',
  activity_link: '',
  address: '',
  postcode: '',
  lat: '',
  long: '',
  category: 'baby stay and play',
  start_time: '10:00',
  end_time: '11:00',
  google_link: '',
  website: '',
  child_friendly_score: '',
  app_rating: '',
  number_of_reviews: '0',
  age_suitability: 'Under 5s',
  borough: 'Waltham Forest',
  description: '',
  cost: 'Free',
};

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
    // Local storage is a convenience layer. The app can still run without it.
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

function toWindow(startTime) {
  const hour = Number(String(startTime || '09:00').slice(0, 2));
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function normalizeActivity(activity) {
  return {
    ...activity,
    activity_id: String(activity.activity_id),
    start_time: String(activity.start_time || '09:00').slice(0, 5),
    end_time: String(activity.end_time || '10:00').slice(0, 5),
    time_window: activity.time_window || toWindow(activity.start_time),
    category: activity.category || 'baby stay and play',
    borough: activity.borough || 'Waltham Forest',
    days_of_week: activity.days_of_week || [],
    followerNames: activity.followerNames || [],
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

function isPersistableActivity(activity) {
  return activity && !String(activity.activity_id).startsWith('sample') && !String(activity.activity_id).startsWith('local');
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState('start');
  const [activities, setActivities] = useState(sampleActivities.map(normalizeActivity));
  const [localDrafts, setLocalDrafts] = useState(() => loadStored('activity-drafts', []));
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedWindow, setSelectedWindow] = useState('morning');
  const [filters, setFilters] = useState(() =>
    loadStored('filters', {
      categories: ['baby stay and play', 'coffee', 'museum', 'sensory play'],
      borough: 'Waltham Forest',
      radiusMiles: 3,
      walkMinutes: 35,
      useLocation: true,
    }),
  );
  const [userLocation, setUserLocation] = useState({ lat: 51.5845, long: -0.021 });
  const [swipes, setSwipes] = useState(() => loadStored('swipes', {}));
  const [shortlists, setShortlists] = useState(() => loadStored('shortlists', {}));
  const [statuses, setStatuses] = useState(() => loadStored('statuses', {}));
  const [calendarEvents, setCalendarEvents] = useState(() => loadStored('calendar-events', []));
  const [followedParentIds, setFollowedParentIds] = useState(() => loadStored('followed-parents', ['maya', 'noor']));
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState('sign-in');
  const [authForm, setAuthForm] = useState({ email: '', password: '', user_name: '' });
  const [activityForm, setActivityForm] = useState(emptyActivityForm);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comments: '', photo_url: '' });
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [dragState, setDragState] = useState({ activityId: null, startX: null, offsetX: 0 });

  const currentUser = session?.user;
  const weekDays = Array.from({ length: 7 }, (_, index) => addDaysISO(todayISO(), index));
  const activeSlot = slotKey(selectedDate, selectedWindow);
  const allActivities = [...localDrafts, ...activities].map(normalizeActivity);
  const activityById = new Map(allActivities.map((activity) => [String(activity.activity_id), activity]));
  const followedNames = sampleParents
    .filter((parent) => followedParentIds.includes(parent.user_id))
    .map((parent) => parent.display_name);
  const selectedWeekday = weekdayName(selectedDate);

  const filteredActivities = allActivities
    .map((activity) => ({
      ...activity,
      distance: filters.useLocation
        ? milesBetween(userLocation, { lat: activity.lat, long: activity.long })
        : null,
    }))
    .filter((activity) => {
      const categoryMatch =
        filters.categories.length === 0 || filters.categories.includes(activity.category);
      const boroughMatch = filters.borough === 'All' || activity.borough === filters.borough;
      const distanceLimit = Math.min(Number(filters.radiusMiles), Number(filters.walkMinutes) / 20);
      const distanceMatch =
        !filters.useLocation || activity.distance == null || activity.distance <= distanceLimit;
      const dayMatch =
        !activity.days_of_week?.length || activity.days_of_week.includes(selectedWeekday);
      return categoryMatch && boroughMatch && distanceMatch && dayMatch;
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
  useEffect(() => saveStored('activity-drafts', localDrafts), [localDrafts]);
  useEffect(() => saveStored('swipes', swipes), [swipes]);
  useEffect(() => saveStored('shortlists', shortlists), [shortlists]);
  useEffect(() => saveStored('statuses', statuses), [statuses]);
  useEffect(() => saveStored('calendar-events', calendarEvents), [calendarEvents]);
  useEffect(() => saveStored('followed-parents', followedParentIds), [followedParentIds]);

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
      } else if (data?.length) {
        setActivities(data.map(normalizeActivity));
      }
      setLoading(false);
    }

    loadActivities();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    if (!supabase) return;
    const { data } = await supabase
      .from('user_table')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    setProfile(data || null);
  }

  function updateCategory(category) {
    setFilters((current) => {
      const exists = current.categories.includes(category);
      return {
        ...current,
        categories: exists
          ? current.categories.filter((item) => item !== category)
          : [...current.categories, category],
      };
    });
  }

  function useBrowserLocation() {
    if (!navigator.geolocation) {
      setNotice('Location is not available, so Walthamstow remains the centre point.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          long: position.coords.longitude,
        });
        setFilters((current) => ({ ...current, useLocation: true }));
        setNotice('Location updated. Your activity deck is now centred on you.');
      },
      () => setNotice('I could not access location, so Walthamstow remains the centre point.'),
    );
  }

  async function persistSwipe(activity, decision) {
    if (!supabase || !currentUser || !isPersistableActivity(activity)) return;
    await supabase.from('activity_swipes').upsert(
      {
        user_id: currentUser.id,
        activity_id: activity.activity_id,
        planned_date: selectedDate,
        day_window: selectedWindow,
        decision,
      },
      { onConflict: 'user_id,activity_id,planned_date,day_window' },
    );
  }

  async function persistShortlist(activity) {
    if (!supabase || !currentUser || !isPersistableActivity(activity)) return;
    await supabase.from('activity_shortlist').upsert(
      {
        user_id: currentUser.id,
        activity_id: activity.activity_id,
        planned_date: selectedDate,
        day_window: selectedWindow,
        position: currentShortlist.length,
      },
      { onConflict: 'user_id,activity_id,planned_date,day_window' },
    );
  }

  async function persistStatus(activity, status, visibility = profile?.default_calendar_visibility || 'private') {
    if (!supabase || !currentUser || !isPersistableActivity(activity)) return;
    await supabase.from('activity_user_statuses').upsert(
      {
        user_id: currentUser.id,
        activity_id: activity.activity_id,
        planned_date: selectedDate,
        day_window: selectedWindow,
        status,
        visibility,
        source: status === 'not_selected' ? 'swipe_no' : 'swipe_yes',
        selected_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,activity_id,planned_date,day_window' },
    );
  }

  async function persistCalendarEvent(event) {
    if (!supabase || !currentUser || !isPersistableActivity(event.activity)) return;
    await supabase.from('calendar_events').upsert(
      {
        user_id: currentUser.id,
        activity_id: event.activity.activity_id,
        planned_date: event.planned_date,
        day_window: event.day_window,
        start_time: event.start_time,
        end_time: event.end_time,
        status: event.status,
        visibility: event.visibility,
      },
      { onConflict: 'user_id,planned_date,day_window' },
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
      persistShortlist(activity);
      setNotice(`${activity.activity_name} was added to this ${selectedWindow} shortlist.`);
    } else {
      setNotice(`${activity.activity_name} marked as not selected for this slot.`);
    }

    setLocalStatus(activity, nextStatus);
    persistSwipe(activity, decision);
    persistStatus(activity, nextStatus);
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
    if (dragState.offsetX > 96) {
      handleSwipe(activity, 'yes');
    } else if (dragState.offsetX < -96) {
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
      user_id: currentUser?.id || 'demo-user',
      activity_id: activity.activity_id,
      activity,
      planned_date: selectedDate,
      day_window: selectedWindow,
      start_time: activity.start_time,
      end_time: activity.end_time,
      status,
      visibility: profile?.default_calendar_visibility || 'private',
      created_at: new Date().toISOString(),
    };

    setCalendarEvents((current) => [
      ...current.filter(
        (item) => !(item.planned_date === selectedDate && item.day_window === selectedWindow),
      ),
      event,
    ]);

    setLocalStatus(activity, status);
    persistStatus(activity, status, event.visibility);
    persistCalendarEvent(event);
    setNotice(`${activity.activity_name} is now ${statusLabels[status].toLowerCase()} in your calendar.`);
  }

  function updateEvent(event, changes) {
    const nextEvent = { ...event, ...changes };
    setCalendarEvents((current) =>
      current.map((item) => (item.local_id === event.local_id ? nextEvent : item)),
    );
    persistCalendarEvent(nextEvent);
  }

  function removeEvent(event) {
    setCalendarEvents((current) => current.filter((item) => item.local_id !== event.local_id));
    setNotice(`${event.activity.activity_name} removed from your calendar.`);
  }

  function applyLinkAutofill() {
    if (!activityForm.activity_link.trim()) {
      setNotice('Paste an activity link first.');
      return;
    }

    let guessedName = activityForm.activity_name;
    try {
      const parsed = new URL(activityForm.activity_link);
      guessedName =
        guessedName ||
        parsed.pathname
          .split('/')
          .filter(Boolean)
          .pop()
          ?.replaceAll('-', ' ')
          ?.replace(/\b\w/g, (letter) => letter.toUpperCase()) ||
        parsed.hostname.replace(/^www\./, '');
    } catch {
      guessedName = guessedName || activityForm.activity_link;
    }

    setActivityForm((current) => ({
      ...current,
      activity_name: guessedName,
      website: current.website || current.activity_link,
      google_link:
        current.google_link ||
        `https://www.google.com/search?q=${encodeURIComponent(`${guessedName} ${current.borough}`)}`,
    }));
    setNotice('I filled what can be safely inferred from the link. A server scraper can enrich this later.');
  }

  async function submitActivity(event) {
    event.preventDefault();
    const payload = {
      activity_name: activityForm.activity_name,
      address: activityForm.address,
      postcode: activityForm.postcode,
      lat: activityForm.lat ? Number(activityForm.lat) : null,
      long: activityForm.long ? Number(activityForm.long) : null,
      category: activityForm.category,
      start_time: activityForm.start_time,
      end_time: activityForm.end_time,
      time_window: toWindow(activityForm.start_time),
      google_link: activityForm.google_link || null,
      website: activityForm.website || activityForm.activity_link || null,
      child_friendly_score: activityForm.child_friendly_score
        ? Number(activityForm.child_friendly_score)
        : null,
      app_rating: activityForm.app_rating ? Number(activityForm.app_rating) : null,
      number_of_reviews: Number(activityForm.number_of_reviews || 0),
      age_suitability: activityForm.age_suitability,
      borough: activityForm.borough,
      days_of_week: [],
      description: activityForm.description,
      cost: activityForm.cost,
      source_url: activityForm.activity_link || null,
      public_listing_status: currentUser ? 'draft' : 'published',
      submitted_by_user_id: currentUser?.id || null,
    };

    if (supabase && currentUser) {
      const { data, error } = await supabase.from('activities').insert(payload).select().single();
      if (error) {
        setNotice(`Could not submit activity: ${error.message}`);
        return;
      }
      setActivities((current) => [normalizeActivity(data), ...current]);
      setNotice('Activity submitted as a draft for review.');
    } else {
      const localActivity = normalizeActivity({
        ...payload,
        activity_id: `local-${Date.now()}`,
        public_listing_status: 'draft',
        followerNames: [],
      });
      setLocalDrafts((current) => [localActivity, ...current]);
      setNotice('Activity saved locally. Sign in with Supabase to submit it for real.');
    }

    setActivityForm(emptyActivityForm);
  }

  async function submitReview(event) {
    event.preventDefault();
    if (!selectedActivity) {
      setNotice('Open an activity first, then add a review or photo.');
      return;
    }

    if (supabase && currentUser && isPersistableActivity(selectedActivity)) {
      if (reviewForm.comments.trim()) {
        await supabase.from('comments_table').insert({
          activity_id: selectedActivity.activity_id,
          user_id: currentUser.id,
          comments: reviewForm.comments,
        });

        await supabase.from('activity_reviews').upsert(
          {
            activity_id: selectedActivity.activity_id,
            user_id: currentUser.id,
            rating: Number(reviewForm.rating),
            review_text: reviewForm.comments,
          },
          { onConflict: 'activity_id,user_id' },
        );
      }

      if (reviewForm.photo_url.trim()) {
        await supabase.from('activity_photos').insert({
          activity_id: selectedActivity.activity_id,
          user_id: currentUser.id,
          photo_url: reviewForm.photo_url,
          source_provider: 'user_upload',
        });
      }
    }

    setNotice('Review/photo saved for this activity.');
    setReviewForm({ rating: 5, comments: '', photo_url: '' });
  }

  async function handleAuth(event) {
    event.preventDefault();
    if (!supabase) {
      setNotice('Add the Supabase URL and anon key before live accounts can sign in.');
      return;
    }

    const credentials = {
      email: authForm.email,
      password: authForm.password,
      options: authMode === 'sign-up' ? { data: { user_name: authForm.user_name } } : undefined,
    };

    const { error } =
      authMode === 'sign-up'
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);

    setNotice(error ? error.message : authMode === 'sign-up' ? 'Check your email to confirm your account.' : 'Signed in.');
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setNotice('Signed out.');
  }

  function toggleFollow(parentId) {
    setFollowedParentIds((current) =>
      current.includes(parentId) ? current.filter((id) => id !== parentId) : [...current, parentId],
    );
  }

  return (
    <div className="phone-app">
      <header className="app-topbar">
        <button className="brand-lockup" type="button" onClick={() => setActiveScreen('start')}>
          <span>Tiny</span>
          <strong>Outings</strong>
        </button>
        <div className="topbar-actions">
          <span className="sync-dot">{hasSupabaseConfig ? 'Live' : 'Demo'}</span>
          <button className="icon-button" type="button" onClick={() => setActiveScreen('profile')}>
            Me
          </button>
        </div>
      </header>

      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>
            Close
          </button>
        </div>
      )}

      <main className="app-main">
        {activeScreen === 'start' && (
          <StartScreen
            filters={filters}
            setFilters={setFilters}
            updateCategory={updateCategory}
            useBrowserLocation={useBrowserLocation}
            activityCount={filteredActivities.length}
            loading={loading}
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
            slotActivities={slotActivities}
            currentShortlist={currentShortlist}
            chosenForSlot={chosenForSlot}
            statuses={statuses}
            dragState={dragState}
            followedNames={followedNames}
            onStartDrag={startDrag}
            onMoveDrag={moveDrag}
            onEndDrag={endDrag}
            onSwipe={handleSwipe}
            onChoose={chooseActivity}
            onOpenActivity={setSelectedActivity}
            onReset={resetCurrentSlot}
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
            form={activityForm}
            setForm={setActivityForm}
            onAutofill={applyLinkAutofill}
            onSubmit={submitActivity}
            currentUser={currentUser}
          />
        )}

        {activeScreen === 'search' && (
          <SearchScreen activities={allActivities} onOpenActivity={setSelectedActivity} />
        )}

        {activeScreen === 'profile' && (
          <ProfileScreen
            session={session}
            profile={profile}
            parents={sampleParents}
            followedParentIds={followedParentIds}
            toggleFollow={toggleFollow}
            authMode={authMode}
            setAuthMode={setAuthMode}
            authForm={authForm}
            setAuthForm={setAuthForm}
            handleAuth={handleAuth}
            signOut={signOut}
            hasSupabaseConfig={hasSupabaseConfig}
          />
        )}
      </main>

      <BottomNav activeScreen={activeScreen} setActiveScreen={setActiveScreen} />

      {selectedActivity && (
        <ActivityDetail
          activity={selectedActivity}
          followedNames={followedNames}
          reviewForm={reviewForm}
          setReviewForm={setReviewForm}
          submitReview={submitReview}
          onClose={() => setSelectedActivity(null)}
        />
      )}
    </div>
  );
}

function StartScreen({
  filters,
  setFilters,
  updateCategory,
  useBrowserLocation,
  activityCount,
  loading,
  onStart,
}) {
  return (
    <section className="app-screen start-screen">
      <div className="screen-title">
        <span className="eyebrow">Plan maternity and paternity days</span>
        <h1>Pick a day shape before the chaos wakes up.</h1>
        <p>
          Set your borough, activity types, radius, and walking limit. Then swipe through activities
          for morning, afternoon, and evening.
        </p>
      </div>

      <div className="filter-card">
        <div className="field-group">
          <label>Activity types</label>
          <div className="chip-grid">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={classNames('filter-chip', filters.categories.includes(category) && 'is-on')}
                onClick={() => updateCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="field-group">
          <label>Borough</label>
          <div className="segmented-grid">
            {['All', ...boroughs].map((borough) => (
              <button
                key={borough}
                type="button"
                className={classNames('segment', filters.borough === borough && 'is-on')}
                onClick={() => setFilters((current) => ({ ...current, borough }))}
              >
                {borough}
              </button>
            ))}
          </div>
        </div>

        <div className="range-card">
          <label>
            <span>{filters.radiusMiles} mile radius</span>
            <input
              type="range"
              min="1"
              max="10"
              value={filters.radiusMiles}
              onChange={(event) =>
                setFilters((current) => ({ ...current, radiusMiles: Number(event.target.value) }))
              }
            />
          </label>
          <label>
            <span>{filters.walkMinutes} minute walk</span>
            <input
              type="range"
              min="10"
              max="90"
              step="5"
              value={filters.walkMinutes}
              onChange={(event) =>
                setFilters((current) => ({ ...current, walkMinutes: Number(event.target.value) }))
              }
            />
          </label>
        </div>

        <div className="location-row">
          <button type="button" className="secondary-button" onClick={useBrowserLocation}>
            Use current location
          </button>
          <button
            type="button"
            className={classNames('secondary-button', filters.useLocation && 'is-on')}
            onClick={() => setFilters((current) => ({ ...current, useLocation: !current.useLocation }))}
          >
            {filters.useLocation ? 'Location filter on' : 'Location filter off'}
          </button>
        </div>
      </div>

      <div className="start-summary">
        <div>
          <span>Deck ready</span>
          <strong>{loading ? '...' : activityCount}</strong>
          <small>matching activities</small>
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
  slotActivities,
  currentShortlist,
  chosenForSlot,
  statuses,
  dragState,
  followedNames,
  onStartDrag,
  onMoveDrag,
  onEndDrag,
  onSwipe,
  onChoose,
  onOpenActivity,
  onReset,
}) {
  const topActivity = deckActivities[0];

  return (
    <section className="app-screen swipe-screen">
      <div className="planner-strip">
        <div className="date-strip">
          {weekDays.map((day) => (
            <button
              key={day}
              type="button"
              className={classNames('date-pill', day === selectedDate && 'is-on')}
              onClick={() => setSelectedDate(day)}
            >
              <span>{formatDay(day).split(' ')[0]}</span>
              <strong>{formatDay(day).replace(/^\S+\s/, '')}</strong>
            </button>
          ))}
        </div>

        <div className="window-switcher">
          {dayWindows.map((windowName) => (
            <button
              key={windowName}
              type="button"
              className={classNames('window-pill', windowName === selectedWindow && 'is-on')}
              onClick={() => setSelectedWindow(windowName)}
            >
              {windowName}
            </button>
          ))}
        </div>
      </div>

      <div className="swipe-status-bar">
        <div>
          <span>{formatDay(selectedDate, 'long')}</span>
          <strong>{selectedWindow} deck</strong>
        </div>
        <button type="button" onClick={onReset}>
          Reset slot
        </button>
      </div>

      <div className="tinder-stage">
        {deckActivities.length === 0 ? (
          <div className="empty-deck">
            <span>No cards left</span>
            <h2>{slotActivities.length ? 'You swiped through this slot.' : 'No matching activities yet.'}</h2>
            <p>Change filters, pick another time window, or reset this slot to swipe again.</p>
          </div>
        ) : (
          deckActivities.slice(0, 3).map((activity, index) => (
            <SwipeCard
              key={activity.activity_id}
              activity={activity}
              index={index}
              isTop={index === 0}
              dragState={dragState}
              followedNames={followedNames}
              status={statuses[statusKey(selectedDate, selectedWindow, activity.activity_id)]}
              onStartDrag={onStartDrag}
              onMoveDrag={onMoveDrag}
              onEndDrag={onEndDrag}
              onOpenActivity={onOpenActivity}
            />
          ))
        )}
      </div>

      <div className="swipe-controls">
        <button
          type="button"
          className="swipe-button no"
          disabled={!topActivity}
          onClick={() => onSwipe(topActivity, 'no')}
        >
          No
        </button>
        <button
          type="button"
          className="swipe-button info"
          disabled={!topActivity}
          onClick={() => onOpenActivity(topActivity)}
        >
          Details
        </button>
        <button
          type="button"
          className="swipe-button yes"
          disabled={!topActivity}
          onClick={() => onSwipe(topActivity, 'yes')}
        >
          Yes
        </button>
      </div>

      <ShortlistPanel
        selectedDate={selectedDate}
        selectedWindow={selectedWindow}
        shortlist={currentShortlist}
        chosenForSlot={chosenForSlot}
        onChoose={onChoose}
        onOpenActivity={onOpenActivity}
      />
    </section>
  );
}

function SwipeCard({
  activity,
  index,
  isTop,
  dragState,
  followedNames,
  status,
  onStartDrag,
  onMoveDrag,
  onEndDrag,
  onOpenActivity,
}) {
  const isDragging = dragState.activityId === activity.activity_id;
  const offset = isDragging ? dragState.offsetX : 0;
  const tilt = Math.max(-18, Math.min(18, offset / 14));
  const signalNames = activity.followerNames.filter((name) => followedNames.includes(name));
  const cardStyle = {
    zIndex: 10 - index,
    transform: isTop
      ? `translate3d(${offset}px, 0, 0) rotate(${tilt}deg)`
      : `translate3d(0, ${index * 14}px, 0) scale(${1 - index * 0.045})`,
  };

  return (
    <article
      className={classNames(
        'swipe-card',
        isTop && 'is-top',
        offset > 36 && 'is-yes',
        offset < -36 && 'is-no',
      )}
      style={cardStyle}
      onPointerDown={isTop ? (event) => onStartDrag(event, activity) : undefined}
      onPointerMove={isTop ? (event) => onMoveDrag(event, activity) : undefined}
      onPointerUp={isTop ? () => onEndDrag(activity) : undefined}
      onPointerCancel={isTop ? () => onEndDrag(activity) : undefined}
    >
      <div className="decision-stamp yes">Yes</div>
      <div className="decision-stamp no">No</div>

      <div className="card-photo">
        <span>Google photos</span>
        <strong>{activity.borough}</strong>
      </div>

      <div className="card-content">
        <div className="card-kicker">
          <span>{activity.category}</span>
          <StatusPill status={status || 'tentative'} ghost={!status} />
        </div>
        <h2>{activity.activity_name}</h2>
        <p>{activity.description || 'Parent-friendly activity details will appear here.'}</p>

        {signalNames.length > 0 && (
          <div className="friend-signal">
            {signalNames.join(', ')} {signalNames.length === 1 ? 'has' : 'have'} selected this
          </div>
        )}

        <div className="activity-facts">
          <span>{activity.start_time} to {activity.end_time}</span>
          <span>{formatDistance(activity.distance)}</span>
          <span>{activity.age_suitability || 'Age TBC'}</span>
          <span>{activity.app_rating ? `${activity.app_rating}/5` : 'No rating yet'}</span>
        </div>

        <button type="button" className="link-button" onClick={() => onOpenActivity(activity)}>
          Open activity
        </button>
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

function AddActivityScreen({ form, setForm, onAutofill, onSubmit, currentUser }) {
  return (
    <section className="app-screen form-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Add an activity</span>
        <h1>Submit a local find</h1>
        <p>Paste a link, fill the core activity table fields, and save it for review.</p>
      </div>

      {!currentUser && (
        <div className="soft-note">You are in demo mode. Sign in to submit activities to Supabase.</div>
      )}

      <form className="app-form" onSubmit={onSubmit}>
        <label className="wide">
          <span>Activity link</span>
          <div className="inline-control">
            <input
              value={form.activity_link}
              onChange={(event) => setForm((current) => ({ ...current, activity_link: event.target.value }))}
              placeholder="https://..."
            />
            <button type="button" onClick={onAutofill}>Autofill</button>
          </div>
        </label>

        <label className="wide">
          <span>Activity name</span>
          <input
            required
            value={form.activity_name}
            onChange={(event) => setForm((current) => ({ ...current, activity_name: event.target.value }))}
          />
        </label>

        <label>
          <span>Category</span>
          <select
            value={form.category}
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
          >
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Borough</span>
          <select
            value={form.borough}
            onChange={(event) => setForm((current) => ({ ...current, borough: event.target.value }))}
          >
            {boroughs.map((borough) => (
              <option key={borough} value={borough}>{borough}</option>
            ))}
          </select>
        </label>

        <label className="wide">
          <span>Address</span>
          <input
            required
            value={form.address}
            onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
          />
        </label>

        <label>
          <span>Latitude</span>
          <input
            value={form.lat}
            onChange={(event) => setForm((current) => ({ ...current, lat: event.target.value }))}
            placeholder="51.584"
          />
        </label>

        <label>
          <span>Longitude</span>
          <input
            value={form.long}
            onChange={(event) => setForm((current) => ({ ...current, long: event.target.value }))}
            placeholder="-0.021"
          />
        </label>

        <label>
          <span>Start time</span>
          <input
            type="time"
            required
            value={form.start_time}
            onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))}
          />
        </label>

        <label>
          <span>End time</span>
          <input
            type="time"
            required
            value={form.end_time}
            onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))}
          />
        </label>

        <label>
          <span>Child friendly score</span>
          <input
            type="number"
            min="1"
            max="5"
            step="0.1"
            value={form.child_friendly_score}
            onChange={(event) => setForm((current) => ({ ...current, child_friendly_score: event.target.value }))}
          />
        </label>

        <label>
          <span>App rating</span>
          <input
            type="number"
            min="1"
            max="5"
            step="0.1"
            value={form.app_rating}
            onChange={(event) => setForm((current) => ({ ...current, app_rating: event.target.value }))}
          />
        </label>

        <label>
          <span>Reviews</span>
          <input
            type="number"
            min="0"
            value={form.number_of_reviews}
            onChange={(event) => setForm((current) => ({ ...current, number_of_reviews: event.target.value }))}
          />
        </label>

        <label>
          <span>Age suitability</span>
          <input
            value={form.age_suitability}
            onChange={(event) => setForm((current) => ({ ...current, age_suitability: event.target.value }))}
          />
        </label>

        <label className="wide">
          <span>Website</span>
          <input
            value={form.website}
            onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))}
          />
        </label>

        <label className="wide">
          <span>Google link</span>
          <input
            value={form.google_link}
            onChange={(event) => setForm((current) => ({ ...current, google_link: event.target.value }))}
          />
        </label>

        <label className="wide">
          <span>Description</span>
          <textarea
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          />
        </label>

        <button className="primary-action wide" type="submit">Save activity</button>
      </form>
    </section>
  );
}

function SearchScreen({ activities, onOpenActivity }) {
  const [query, setQuery] = useState('');
  const results = activities.filter((activity) =>
    `${activity.activity_name} ${activity.category} ${activity.address} ${activity.borough}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <section className="app-screen search-screen">
      <div className="screen-title compact">
        <span className="eyebrow">Search</span>
        <h1>Find and review</h1>
        <p>Search an activity by name, then open it to add photos, reviews, or comments.</p>
      </div>

      <label className="search-box">
        <span>Activity name</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Walthamstow library, baby yoga..."
        />
      </label>

      <div className="result-list">
        {results.map((activity) => (
          <button key={activity.activity_id} type="button" onClick={() => onOpenActivity(activity)}>
            <strong>{activity.activity_name}</strong>
            <span>{activity.category} - {activity.borough}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProfileScreen({
  session,
  profile,
  parents,
  followedParentIds,
  toggleFollow,
  authMode,
  setAuthMode,
  authForm,
  setAuthForm,
  handleAuth,
  signOut,
  hasSupabaseConfig: isConfigured,
}) {
  return (
    <section className="app-screen profile-screen">
      <div className="screen-title compact">
        <span className="eyebrow">User account</span>
        <h1>{session ? profile?.display_name || profile?.user_name || 'Your account' : 'Sign in'}</h1>
        <p>Follow other parents and see their activity signals while swiping.</p>
      </div>

      {!isConfigured && (
        <div className="soft-note">Supabase env vars are not active here, so accounts are in demo mode.</div>
      )}

      {session ? (
        <div className="account-card">
          <span>{session.user.email}</span>
          <div className="stat-row">
            <strong>{profile?.followers ?? 0}</strong>
            <span>followers</span>
            <strong>{profile?.following ?? followedParentIds.length}</strong>
            <span>following</span>
          </div>
          <button type="button" className="secondary-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      ) : (
        <form className="auth-card" onSubmit={handleAuth}>
          <div className="auth-tabs">
            <button
              type="button"
              className={classNames(authMode === 'sign-in' && 'is-on')}
              onClick={() => setAuthMode('sign-in')}
            >
              Sign in
            </button>
            <button
              type="button"
              className={classNames(authMode === 'sign-up' && 'is-on')}
              onClick={() => setAuthMode('sign-up')}
            >
              Sign up
            </button>
          </div>
          {authMode === 'sign-up' && (
            <label>
              <span>Username</span>
              <input
                value={authForm.user_name}
                onChange={(event) => setAuthForm((current) => ({ ...current, user_name: event.target.value }))}
                placeholder="walthamstow_parent"
              />
            </label>
          )}
          <label>
            <span>Email</span>
            <input
              type="email"
              value={authForm.email}
              onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={authForm.password}
              onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>
          <button className="primary-action" type="submit">
            {authMode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      )}

      <div className="people-list">
        <h2>Parents to follow</h2>
        {parents.map((parent) => {
          const isFollowing = followedParentIds.includes(parent.user_id);
          return (
            <article key={parent.user_id} className="person-card">
              <div>
                <strong>{parent.display_name}</strong>
                <span>@{parent.user_name}</span>
              </div>
              <button
                type="button"
                className={classNames('secondary-button', isFollowing && 'is-on')}
                onClick={() => toggleFollow(parent.user_id)}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ActivityDetail({
  activity,
  followedNames,
  reviewForm,
  setReviewForm,
  submitReview,
  onClose,
}) {
  const signalNames = activity.followerNames.filter((name) => followedNames.includes(name));

  return (
    <div className="detail-backdrop" role="dialog" aria-modal="true">
      <aside className="detail-sheet">
        <button className="sheet-close" type="button" onClick={onClose}>Close</button>
        <div className="detail-photo">
          <span>Google photos</span>
          <small>Connect Google Places Photos API for live images</small>
        </div>

        <p className="eyebrow">{activity.category}</p>
        <h2>{activity.activity_name}</h2>
        <p>{activity.description || 'No description yet.'}</p>

        {signalNames.length > 0 && (
          <div className="friend-signal wide">
            {signalNames.join(', ')} selected this activity
          </div>
        )}

        <div className="detail-grid">
          <span><strong>Time</strong>{activity.start_time} to {activity.end_time}</span>
          <span><strong>Address</strong>{activity.address}</span>
          <span><strong>Age</strong>{activity.age_suitability || 'TBC'}</span>
          <span><strong>Child friendly</strong>{activity.child_friendly_score || 'Not rated'}</span>
          <span><strong>App rating</strong>{activity.app_rating || 'Not rated'}</span>
          <span><strong>Reviews</strong>{activity.number_of_reviews || 0}</span>
        </div>

        <div className="external-links">
          {activity.website && <a href={activity.website} target="_blank" rel="noreferrer">Website</a>}
          {activity.google_link && <a href={activity.google_link} target="_blank" rel="noreferrer">Google</a>}
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
    ['start', 'Filters'],
    ['swipe', 'Swipe'],
    ['calendar', 'Calendar'],
    ['add', 'Add'],
    ['search', 'Search'],
    ['profile', 'Me'],
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
