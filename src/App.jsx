import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from './supabaseClient';
import { boroughs, categories, sampleActivities, sampleParents } from './sampleData';

const windows = ['morning', 'afternoon', 'evening'];
const storagePrefix = 'little-week';

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
  website: '',
  google_link: '',
  age_suitability: 'Under 5s',
  borough: 'Waltham Forest',
  description: '',
  cost: 'Free',
};

function loadStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(`${storagePrefix}:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    window.localStorage.setItem(`${storagePrefix}:${key}`, JSON.stringify(value));
  } catch {
    // Local storage is nice-to-have; the app still works without it.
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

function formatDay(dateISO) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${dateISO}T12:00:00`));
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
    start_time: String(activity.start_time || '09:00').slice(0, 5),
    end_time: String(activity.end_time || '10:00').slice(0, 5),
    time_window: activity.time_window || toWindow(activity.start_time),
    followerNames: activity.followerNames || [],
  };
}

function slotKey(date, windowName) {
  return `${date}:${windowName}`;
}

function milesBetween(a, b) {
  if (!a || !b || a.lat == null || a.long == null || b.lat == null || b.long == null) return null;
  const radiusMiles = 3958.8;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.long - a.long);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * radiusMiles * Math.asin(Math.sqrt(x));
}

function formatDistance(miles) {
  if (miles == null) return 'Distance unknown';
  if (miles < 0.1) return 'Very nearby';
  return `${miles.toFixed(1)} mi`;
}

function dateStampForCalendar(dateISO, time) {
  return `${dateISO.replaceAll('-', '')}T${String(time).replace(':', '')}00`;
}

function buildGoogleCalendarUrl(event) {
  const activity = event.activity;
  const dates = `${dateStampForCalendar(event.planned_date, event.start_time)}/${dateStampForCalendar(
    event.planned_date,
    event.end_time,
  )}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title_override || activity.activity_name,
    details: `${activity.description || ''}\n\nPlanned in Little Week. Status: ${event.status}.`,
    location: activity.address,
    dates,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildICS(event) {
  const activity = event.activity;
  const created = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const start = dateStampForCalendar(event.planned_date, event.start_time);
  const end = dateStampForCalendar(event.planned_date, event.end_time);
  const title = event.title_override || activity.activity_name;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Little Week//Parent Planner//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.calendar_event_id || event.local_id}@little-week`,
    `DTSTAMP:${created}`,
    `DTSTART;TZID=Europe/London:${start}`,
    `DTEND;TZID=Europe/London:${end}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${activity.description || 'Planned in Little Week'}`,
    `LOCATION:${activity.address}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadICS(event) {
  const blob = new Blob([buildICS(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.planned_date}-${event.day_window}-little-week.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function classNames(...names) {
  return names.filter(Boolean).join(' ');
}

export default function App() {
  const [activeTab, setActiveTab] = useState('plan');
  const [activities, setActivities] = useState(sampleActivities.map(normalizeActivity));
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState('sign-in');
  const [authForm, setAuthForm] = useState({ email: '', password: '', user_name: '' });
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [activityForm, setActivityForm] = useState(emptyActivityForm);
  const [reviewForm, setReviewForm] = useState({ rating: 5, text: '', photo_url: '' });
  const [filters, setFilters] = useState({
    categories: ['baby stay and play', 'sensory play', 'coffee', 'museum'],
    borough: 'Waltham Forest',
    radiusMiles: 3,
    walkMinutes: 35,
    query: '',
    useLocation: true,
  });
  const [userLocation, setUserLocation] = useState({ lat: 51.5845, long: -0.021 });
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [selectedWindow, setSelectedWindow] = useState('morning');
  const [deckIndexes, setDeckIndexes] = useState({});
  const [swipes, setSwipes] = useState(() => loadStorage('swipes', {}));
  const [shortlist, setShortlist] = useState(() => loadStorage('shortlist', {}));
  const [calendarEvents, setCalendarEvents] = useState(() => loadStorage('calendar-events', []));
  const [localDrafts, setLocalDrafts] = useState(() => loadStorage('activity-drafts', []));
  const [parents, setParents] = useState(sampleParents);

  const weekDays = Array.from({ length: 7 }, (_, index) => addDaysISO(todayISO(), index));
  const currentUser = session?.user;
  const visibleActivities = [...activities, ...localDrafts.map(normalizeActivity)];

  useEffect(() => {
    saveStorage('swipes', swipes);
  }, [swipes]);

  useEffect(() => {
    saveStorage('shortlist', shortlist);
  }, [shortlist]);

  useEffect(() => {
    saveStorage('calendar-events', calendarEvents);
  }, [calendarEvents]);

  useEffect(() => {
    saveStorage('activity-drafts', localDrafts);
  }, [localDrafts]);

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
        setNotice(`Supabase is configured, but activities could not load: ${error.message}`);
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

  const filteredActivities = visibleActivities
    .map((activity) => {
      const distance = filters.useLocation
        ? milesBetween(userLocation, { lat: Number(activity.lat), long: Number(activity.long) })
        : null;
      return { ...activity, distance };
    })
    .filter((activity) => {
      const categoryMatch =
        filters.categories.length === 0 || filters.categories.includes(activity.category);
      const boroughMatch = filters.borough === 'All' || activity.borough === filters.borough;
      const query = filters.query.trim().toLowerCase();
      const queryMatch =
        !query ||
        `${activity.activity_name} ${activity.address} ${activity.category} ${activity.description}`
          .toLowerCase()
          .includes(query);
      const distanceLimit = Math.min(Number(filters.radiusMiles), Number(filters.walkMinutes) / 20);
      const distanceMatch =
        !filters.useLocation || activity.distance == null || activity.distance <= distanceLimit;
      return categoryMatch && boroughMatch && queryMatch && distanceMatch;
    });

  const slotActivities = filteredActivities.filter((activity) => activity.time_window === selectedWindow);
  const currentSlotKey = slotKey(selectedDate, selectedWindow);
  const currentIndex = deckIndexes[currentSlotKey] || 0;
  const currentActivity = slotActivities.length ? slotActivities[currentIndex % slotActivities.length] : null;
  const currentShortlist = shortlist[currentSlotKey] || [];
  const chosenForSlot = calendarEvents.find(
    (event) => event.planned_date === selectedDate && event.day_window === selectedWindow,
  );

  function updateFilterCategory(category) {
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
      setNotice('Location is not available in this browser, so Walthamstow remains the planning centre.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          long: position.coords.longitude,
        });
        setNotice('Location updated. Your filters are now centred on your current position.');
      },
      () => {
        setNotice('I could not access location, so Walthamstow remains the planning centre.');
      },
    );
  }

  async function persistSwipe(activity, decision) {
    if (!supabase || !currentUser || String(activity.activity_id).startsWith('sample')) return;
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

  async function persistShortlist(activity, swipeId = null) {
    if (!supabase || !currentUser || String(activity.activity_id).startsWith('sample')) return;
    await supabase.from('activity_shortlist').upsert(
      {
        user_id: currentUser.id,
        activity_id: activity.activity_id,
        planned_date: selectedDate,
        day_window: selectedWindow,
        added_from_swipe_id: swipeId,
      },
      { onConflict: 'user_id,activity_id,planned_date,day_window' },
    );
  }

  function handleSwipe(decision) {
    if (!currentActivity) return;
    const activity = currentActivity;
    const key = currentSlotKey;
    const swipeRecord = {
      activity_id: activity.activity_id,
      decision,
      created_at: new Date().toISOString(),
    };

    setSwipes((current) => ({
      ...current,
      [key]: [...(current[key] || []), swipeRecord],
    }));

    if (decision === 'yes') {
      setShortlist((current) => {
        const existing = current[key] || [];
        if (existing.some((item) => item.activity_id === activity.activity_id)) return current;
        return {
          ...current,
          [key]: [...existing, activity],
        };
      });
      persistShortlist(activity);
    }

    persistSwipe(activity, decision);
    setDeckIndexes((current) => ({ ...current, [key]: currentIndex + 1 }));
  }

  async function chooseActivity(activity) {
    const event = {
      local_id: `${selectedDate}-${selectedWindow}-${activity.activity_id}`,
      user_id: currentUser?.id || 'demo-user',
      activity_id: activity.activity_id,
      activity,
      planned_date: selectedDate,
      day_window: selectedWindow,
      start_time: activity.start_time,
      end_time: activity.end_time,
      status: 'booked',
      visibility: profile?.default_calendar_visibility || 'private',
      created_at: new Date().toISOString(),
    };

    setCalendarEvents((current) => [
      ...current.filter(
        (item) => !(item.planned_date === selectedDate && item.day_window === selectedWindow),
      ),
      event,
    ]);

    if (supabase && currentUser && !String(activity.activity_id).startsWith('sample')) {
      await supabase.from('activity_user_statuses').upsert(
        {
          user_id: currentUser.id,
          activity_id: activity.activity_id,
          planned_date: selectedDate,
          day_window: selectedWindow,
          status: 'booked',
          visibility: event.visibility,
          source: 'shortlist',
          selected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,activity_id,planned_date,day_window' },
      );

      await supabase.from('calendar_events').upsert(
        {
          user_id: currentUser.id,
          activity_id: activity.activity_id,
          planned_date: selectedDate,
          day_window: selectedWindow,
          start_time: activity.start_time,
          end_time: activity.end_time,
          status: 'booked',
          visibility: event.visibility,
        },
        { onConflict: 'user_id,planned_date,day_window' },
      );
    }

    setNotice(`${activity.activity_name} is now in your ${selectedWindow} calendar slot.`);
  }

  function updateEventVisibility(event, visibility) {
    setCalendarEvents((current) =>
      current.map((item) =>
        item.local_id === event.local_id ? { ...item, visibility } : item,
      ),
    );
  }

  async function handleAuth(event) {
    event.preventDefault();
    if (!supabase) {
      setNotice('Add your Supabase URL and anon key before using real accounts.');
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

    if (error) {
      setNotice(error.message);
    } else {
      setNotice(authMode === 'sign-up' ? 'Check your email to confirm your account.' : 'Signed in.');
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setNotice('Signed out.');
  }

  function applyLinkAutofill() {
    if (!activityForm.activity_link) {
      setNotice('Paste a source link first and I will use it as the website/source.');
      return;
    }
    const url = activityForm.activity_link;
    let guessedName = activityForm.activity_name;
    try {
      const parsed = new URL(url);
      guessedName =
        guessedName ||
        parsed.pathname
          .split('/')
          .filter(Boolean)
          .pop()
          ?.replaceAll('-', ' ')
          ?.replace(/\b\w/g, (letter) => letter.toUpperCase()) ||
        '';
    } catch {
      // Leave the form unchanged if the pasted value is not a URL.
    }
    setActivityForm((current) => ({
      ...current,
      website: current.website || url,
      activity_name: guessedName,
    }));
    setNotice('I filled what I can from the link. Full scraping can be added with a server function later.');
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
      google_link: activityForm.google_link || null,
      website: activityForm.website || activityForm.activity_link || null,
      child_friendly_score: null,
      app_rating: null,
      number_of_reviews: 0,
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
      setNotice('Activity saved locally. Connect Supabase and sign in to submit it for real.');
    }

    setActivityForm(emptyActivityForm);
  }

  async function submitReview(event) {
    event.preventDefault();
    if (!selectedActivity) return;

    if (supabase && currentUser && !String(selectedActivity.activity_id).startsWith('sample')) {
      if (reviewForm.text.trim()) {
        await supabase.from('activity_reviews').upsert(
          {
            activity_id: selectedActivity.activity_id,
            user_id: currentUser.id,
            rating: Number(reviewForm.rating),
            review_text: reviewForm.text,
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
      setNotice('Review/photo saved.');
    } else {
      setNotice('Review saved for this demo session. Connect Supabase and sign in to save real reviews.');
    }
    setReviewForm({ rating: 5, text: '', photo_url: '' });
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <nav className="top-nav" aria-label="Primary navigation">
          <button className="brand-mark" type="button" onClick={() => setActiveTab('plan')}>
            <span>Little</span>
            <strong>Week</strong>
          </button>
          <div className="nav-pills">
            {['plan', 'add', 'search', 'calendar', 'profile'].map((tab) => (
              <button
                key={tab}
                className={classNames('nav-pill', activeTab === tab && 'is-active')}
                type="button"
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </nav>

        <section className="hero-grid">
          <div>
            <p className="eyebrow">Maternity and paternity leave, with a little less guesswork</p>
            <h1>Plan a week that has rhythm, wiggle room, and somewhere to get a coffee.</h1>
            <p className="hero-copy">
              Filter baby-friendly activities, swipe for each morning, afternoon, and evening,
              then turn your shortlist into a calendar you can export.
            </p>
            <div className="hero-actions">
              <button type="button" className="primary-button" onClick={() => setActiveTab('plan')}>
                Start swiping
              </button>
              <button type="button" className="ghost-button" onClick={() => setActiveTab('calendar')}>
                View calendar
              </button>
            </div>
          </div>
          <div className="hero-card" aria-label="Planner summary">
            <span className="mini-label">This week</span>
            <strong>{calendarEvents.length}</strong>
            <p>activities planned across morning, afternoon, and evening windows.</p>
            <div className="sync-chip">
              {hasSupabaseConfig ? 'Supabase connected' : 'Demo mode until env vars are added'}
            </div>
          </div>
        </section>
      </header>

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </div>
      )}

      <main>
        {activeTab === 'plan' && (
          <PlanScreen
            activities={slotActivities}
            allFilteredActivities={filteredActivities}
            categories={categories}
            boroughs={boroughs}
            filters={filters}
            setFilters={setFilters}
            updateFilterCategory={updateFilterCategory}
            useBrowserLocation={useBrowserLocation}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            weekDays={weekDays}
            selectedWindow={selectedWindow}
            setSelectedWindow={setSelectedWindow}
            currentActivity={currentActivity}
            currentIndex={currentIndex}
            handleSwipe={handleSwipe}
            currentShortlist={currentShortlist}
            chooseActivity={chooseActivity}
            chosenForSlot={chosenForSlot}
            loading={loading}
            setSelectedActivity={setSelectedActivity}
          />
        )}

        {activeTab === 'add' && (
          <AddActivityScreen
            form={activityForm}
            setForm={setActivityForm}
            categories={categories}
            boroughs={boroughs}
            onAutofill={applyLinkAutofill}
            onSubmit={submitActivity}
            currentUser={currentUser}
          />
        )}

        {activeTab === 'search' && (
          <SearchScreen
            activities={visibleActivities}
            setSelectedActivity={setSelectedActivity}
            reviewForm={reviewForm}
            setReviewForm={setReviewForm}
            submitReview={submitReview}
          />
        )}

        {activeTab === 'calendar' && (
          <CalendarScreen
            weekDays={weekDays}
            calendarEvents={calendarEvents}
            setSelectedActivity={setSelectedActivity}
            updateEventVisibility={updateEventVisibility}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileScreen
            session={session}
            profile={profile}
            parents={parents}
            setParents={setParents}
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

      {selectedActivity && (
        <ActivityDrawer
          activity={selectedActivity}
          onClose={() => setSelectedActivity(null)}
          reviewForm={reviewForm}
          setReviewForm={setReviewForm}
          submitReview={submitReview}
        />
      )}
    </div>
  );
}

function PlanScreen({
  activities,
  allFilteredActivities,
  categories: categoryOptions,
  boroughs: boroughOptions,
  filters,
  setFilters,
  updateFilterCategory,
  useBrowserLocation,
  selectedDate,
  setSelectedDate,
  weekDays,
  selectedWindow,
  setSelectedWindow,
  currentActivity,
  currentIndex,
  handleSwipe,
  currentShortlist,
  chooseActivity,
  chosenForSlot,
  loading,
  setSelectedActivity,
}) {
  const [dragState, setDragState] = useState({ startX: null, offsetX: 0 });
  const swipeIntent =
    dragState.offsetX > 64 ? 'yes' : dragState.offsetX < -64 ? 'no' : null;

  function beginDrag(event) {
    if (event.target.closest('button, a, input, select, textarea')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragState({ startX: event.clientX, offsetX: 0 });
  }

  function moveDrag(event) {
    if (dragState.startX == null) return;
    setDragState((current) => ({
      ...current,
      offsetX: Math.max(Math.min(event.clientX - current.startX, 160), -160),
    }));
  }

  function endDrag() {
    if (dragState.offsetX > 90) {
      handleSwipe('yes');
    } else if (dragState.offsetX < -90) {
      handleSwipe('no');
    }
    setDragState({ startX: null, offsetX: 0 });
  }

  return (
    <section className="screen-grid plan-grid">
      <aside className="panel filter-panel">
        <div className="section-heading">
          <span className="mini-label">Start screen</span>
          <h2>Set your day shape</h2>
        </div>

        <label className="field">
          <span>Search</span>
          <input
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="Try stay and play, coffee, museum"
          />
        </label>

        <label className="field">
          <span>Borough</span>
          <select
            value={filters.borough}
            onChange={(event) => setFilters((current) => ({ ...current, borough: event.target.value }))}
          >
            <option>All</option>
            {boroughOptions.map((borough) => (
              <option key={borough}>{borough}</option>
            ))}
          </select>
        </label>

        <div className="toggle-cloud">
          {categoryOptions.map((category) => (
            <button
              key={category}
              className={classNames('filter-chip', filters.categories.includes(category) && 'is-selected')}
              type="button"
              onClick={() => updateFilterCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="range-stack">
          <label>
            <span>Within {filters.radiusMiles} miles</span>
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
            <span>Within {filters.walkMinutes} minutes walking</span>
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
          <label className="switch-row">
            <input
              type="checkbox"
              checked={filters.useLocation}
              onChange={(event) =>
                setFilters((current) => ({ ...current, useLocation: event.target.checked }))
              }
            />
            <span>Use location filter</span>
          </label>
          <button type="button" className="small-button" onClick={useBrowserLocation}>
            Use my location
          </button>
        </div>

        <div className="stat-strip">
          <strong>{allFilteredActivities.length}</strong>
          <span>matching activities</span>
        </div>
      </aside>

      <section className="panel swipe-panel">
        <div className="date-tabs">
          {weekDays.map((day) => (
            <button
              key={day}
              type="button"
              className={classNames('date-tab', selectedDate === day && 'is-active')}
              onClick={() => setSelectedDate(day)}
            >
              {formatDay(day)}
            </button>
          ))}
        </div>

        <div className="window-tabs">
          {windows.map((windowName) => (
            <button
              key={windowName}
              type="button"
              className={classNames('window-tab', selectedWindow === windowName && 'is-active')}
              onClick={() => setSelectedWindow(windowName)}
            >
              {windowName}
            </button>
          ))}
        </div>

        <div className="swipe-stage">
          {loading && <div className="empty-card">Loading activities from Supabase...</div>}
          {!loading && !currentActivity && (
            <div className="empty-card">
              <h3>No activities for this slot yet</h3>
              <p>Loosen a filter or add a new activity. The baby planning goblin demands options.</p>
            </div>
          )}
          {!loading && currentActivity && (
            <article
              className={classNames(
                'activity-card',
                dragState.startX != null && 'is-dragging',
                swipeIntent && `swipe-${swipeIntent}`,
              )}
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                transform:
                  dragState.offsetX === 0
                    ? undefined
                    : `translateX(${dragState.offsetX}px) rotate(${dragState.offsetX / 18}deg)`,
              }}
            >
              <div className="swipe-intent" aria-hidden="true">
                {swipeIntent === 'yes' && 'Yes'}
                {swipeIntent === 'no' && 'No'}
              </div>
              <div className="card-map-strip">
                <span>{currentActivity.borough}</span>
                <strong>{formatDistance(currentActivity.distance)}</strong>
              </div>
              <div className="card-body">
                <p className="eyebrow">{currentActivity.category}</p>
                <h2>{currentActivity.activity_name}</h2>
                <p>{currentActivity.description}</p>
                <div className="meta-grid">
                  <span>{currentActivity.start_time} to {currentActivity.end_time}</span>
                  <span>{currentActivity.age_suitability || 'Age TBC'}</span>
                  <span>{currentActivity.cost || 'Cost TBC'}</span>
                  <span>{currentActivity.app_rating || 'New'} rating</span>
                </div>
                {currentActivity.followerNames?.length > 0 && (
                  <div className="friend-signal">
                    {currentActivity.followerNames.join(', ')} selected this
                  </div>
                )}
                <p className="swipe-hint">Drag the card right for yes or left for no.</p>
              </div>
              <div className="card-footer">
                <button type="button" className="no-button" onClick={() => handleSwipe('no')}>
                  Swipe left: no
                </button>
                <button type="button" className="ghost-button" onClick={() => setSelectedActivity(currentActivity)}>
                  Details
                </button>
                <button type="button" className="yes-button" onClick={() => handleSwipe('yes')}>
                  Swipe right: yes
                </button>
              </div>
              <span className="deck-count">
                Card {(currentIndex % Math.max(activities.length, 1)) + 1} of {activities.length}
              </span>
            </article>
          )}
        </div>
      </section>

      <aside className="panel shortlist-panel">
        <div className="section-heading">
          <span className="mini-label">Shortlist</span>
          <h2>{selectedWindow} on {formatDay(selectedDate)}</h2>
        </div>

        {chosenForSlot && (
          <div className="chosen-banner">
            <span>Chosen</span>
            <strong>{chosenForSlot.activity.activity_name}</strong>
          </div>
        )}

        {currentShortlist.length === 0 ? (
          <p className="muted">Swipe right on activities to build a shortlist for this slot.</p>
        ) : (
          <div className="shortlist-stack">
            {currentShortlist.map((activity) => (
              <article key={activity.activity_id} className="shortlist-card">
                <button type="button" onClick={() => setSelectedActivity(activity)}>
                  <strong>{activity.activity_name}</strong>
                  <span>{activity.start_time} to {activity.end_time}</span>
                </button>
                <button type="button" className="small-button" onClick={() => chooseActivity(activity)}>
                  Choose
                </button>
              </article>
            ))}
          </div>
        )}
      </aside>
    </section>
  );
}

function AddActivityScreen({ form, setForm, categories: categoryOptions, boroughs: boroughOptions, onAutofill, onSubmit, currentUser }) {
  return (
    <section className="screen-grid two-column">
      <div className="panel">
        <div className="section-heading">
          <span className="mini-label">Submit an activity</span>
          <h2>Add the thing you wish everyone knew about</h2>
        </div>
        <p className="muted">
          Signed-in users submit activities as drafts. Unsigned users can still save local ideas while we are in MVP mode.
        </p>
        {!currentUser && <div className="soft-warning">Sign in to submit this to Supabase for review.</div>}

        <form className="activity-form" onSubmit={onSubmit}>
          <label className="field wide-field">
            <span>Activity link</span>
            <div className="inline-field">
              <input
                value={form.activity_link}
                onChange={(event) => setForm((current) => ({ ...current, activity_link: event.target.value }))}
                placeholder="https://..."
              />
              <button type="button" className="small-button" onClick={onAutofill}>
                Autofill
              </button>
            </div>
          </label>

          <label className="field">
            <span>Name</span>
            <input
              required
              value={form.activity_name}
              onChange={(event) => setForm((current) => ({ ...current, activity_name: event.target.value }))}
            />
          </label>

          <label className="field">
            <span>Category</span>
            <select
              value={form.category}
              onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
            >
              {categoryOptions.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>

          <label className="field wide-field">
            <span>Address</span>
            <input
              required
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
            />
          </label>

          <label className="field">
            <span>Postcode</span>
            <input
              value={form.postcode}
              onChange={(event) => setForm((current) => ({ ...current, postcode: event.target.value }))}
            />
          </label>

          <label className="field">
            <span>Borough</span>
            <select
              value={form.borough}
              onChange={(event) => setForm((current) => ({ ...current, borough: event.target.value }))}
            >
              {boroughOptions.map((borough) => (
                <option key={borough}>{borough}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Latitude</span>
            <input
              value={form.lat}
              onChange={(event) => setForm((current) => ({ ...current, lat: event.target.value }))}
              placeholder="51.584"
            />
          </label>

          <label className="field">
            <span>Longitude</span>
            <input
              value={form.long}
              onChange={(event) => setForm((current) => ({ ...current, long: event.target.value }))}
              placeholder="-0.021"
            />
          </label>

          <label className="field">
            <span>Start</span>
            <input
              type="time"
              required
              value={form.start_time}
              onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))}
            />
          </label>

          <label className="field">
            <span>End</span>
            <input
              type="time"
              required
              value={form.end_time}
              onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))}
            />
          </label>

          <label className="field">
            <span>Age suitability</span>
            <input
              value={form.age_suitability}
              onChange={(event) => setForm((current) => ({ ...current, age_suitability: event.target.value }))}
            />
          </label>

          <label className="field">
            <span>Cost</span>
            <input
              value={form.cost}
              onChange={(event) => setForm((current) => ({ ...current, cost: event.target.value }))}
            />
          </label>

          <label className="field wide-field">
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <button className="primary-button wide-field" type="submit">
            Save activity
          </button>
        </form>
      </div>

      <div className="panel preview-panel">
        <span className="mini-label">Preview</span>
        <h2>{form.activity_name || 'A new parent-friendly activity'}</h2>
        <p>{form.description || 'Add a short description and it will appear here.'}</p>
        <div className="meta-grid">
          <span>{form.category}</span>
          <span>{form.start_time} to {form.end_time}</span>
          <span>{form.borough}</span>
          <span>{form.age_suitability}</span>
        </div>
      </div>
    </section>
  );
}

function SearchScreen({ activities, setSelectedActivity, reviewForm, setReviewForm, submitReview }) {
  const [query, setQuery] = useState('');
  const results = activities.filter((activity) =>
    `${activity.activity_name} ${activity.category} ${activity.address}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <section className="screen-grid two-column">
      <div className="panel">
        <div className="section-heading">
          <span className="mini-label">Search</span>
          <h2>Find an activity by name</h2>
        </div>
        <label className="field wide-field">
          <span>Activity name</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Walthamstow library" />
        </label>

        <div className="result-list">
          {results.map((activity) => (
            <button key={activity.activity_id} type="button" onClick={() => setSelectedActivity(activity)}>
              <strong>{activity.activity_name}</strong>
              <span>{activity.category} - {activity.address}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <span className="mini-label">Reviews and photos</span>
          <h2>Add community texture</h2>
        </div>
        <p className="muted">Open an activity first, then add a quick review or photo URL from the detail drawer.</p>
        <form className="review-form" onSubmit={submitReview}>
          <label className="field">
            <span>Rating</span>
            <input
              type="number"
              min="1"
              max="5"
              value={reviewForm.rating}
              onChange={(event) => setReviewForm((current) => ({ ...current, rating: event.target.value }))}
            />
          </label>
          <label className="field wide-field">
            <span>Review</span>
            <textarea
              value={reviewForm.text}
              onChange={(event) => setReviewForm((current) => ({ ...current, text: event.target.value }))}
              placeholder="Good buggy space, tiny lift, excellent biscuits..."
            />
          </label>
          <label className="field wide-field">
            <span>Photo URL</span>
            <input
              value={reviewForm.photo_url}
              onChange={(event) => setReviewForm((current) => ({ ...current, photo_url: event.target.value }))}
              placeholder="https://..."
            />
          </label>
          <button className="primary-button wide-field" type="submit">
            Save review/photo
          </button>
        </form>
      </div>
    </section>
  );
}

function CalendarScreen({ weekDays, calendarEvents, setSelectedActivity, updateEventVisibility }) {
  return (
    <section className="panel calendar-panel">
      <div className="section-heading">
        <span className="mini-label">In-app calendar</span>
        <h2>Your week, lightly held</h2>
      </div>
      <div className="calendar-grid">
        <div className="calendar-corner">Slot</div>
        {weekDays.map((day) => (
          <div key={day} className="calendar-day-heading">
            {formatDay(day)}
          </div>
        ))}
        {windows.map((windowName) => (
          <CalendarRow
            key={windowName}
            windowName={windowName}
            weekDays={weekDays}
            calendarEvents={calendarEvents}
            setSelectedActivity={setSelectedActivity}
            updateEventVisibility={updateEventVisibility}
          />
        ))}
      </div>
    </section>
  );
}

function CalendarRow({ windowName, weekDays, calendarEvents, setSelectedActivity, updateEventVisibility }) {
  return (
    <>
      <div className="calendar-window-heading">{windowName}</div>
      {weekDays.map((day) => {
        const event = calendarEvents.find(
          (item) => item.planned_date === day && item.day_window === windowName,
        );
        return (
          <div key={`${day}-${windowName}`} className={classNames('calendar-cell', event && 'has-event')}>
            {event ? (
              <article>
                <button type="button" onClick={() => setSelectedActivity(event.activity)}>
                  <strong>{event.activity.activity_name}</strong>
                  <span>{event.start_time} to {event.end_time}</span>
                </button>
                <select
                  value={event.visibility}
                  onChange={(changeEvent) => updateEventVisibility(event, changeEvent.target.value)}
                >
                  <option value="private">private</option>
                  <option value="followers">followers</option>
                  <option value="public">public</option>
                </select>
                <div className="export-row">
                  <a href={buildGoogleCalendarUrl(event)} target="_blank" rel="noreferrer">
                    Google
                  </a>
                  <button type="button" onClick={() => downloadICS(event)}>
                    ICS
                  </button>
                </div>
              </article>
            ) : (
              <span className="empty-slot">Open</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function ProfileScreen({
  session,
  profile,
  parents,
  setParents,
  authMode,
  setAuthMode,
  authForm,
  setAuthForm,
  handleAuth,
  signOut,
  hasSupabaseConfig: isConfigured,
}) {
  function toggleFollow(parent) {
    setParents((current) =>
      current.map((item) =>
        item.user_id === parent.user_id ? { ...item, following: item.following + 1 } : item,
      ),
    );
  }

  return (
    <section className="screen-grid two-column">
      <div className="panel">
        <div className="section-heading">
          <span className="mini-label">User account</span>
          <h2>{session ? profile?.display_name || profile?.user_name || 'Signed in parent' : 'Sign in or make an account'}</h2>
        </div>

        {!isConfigured && (
          <div className="soft-warning">
            Add Supabase environment variables before live auth works. The rest of the app runs in demo mode.
          </div>
        )}

        {session ? (
          <div className="profile-card">
            <p>{session.user.email}</p>
            <div className="stat-pair">
              <span>{profile?.followers ?? 0} followers</span>
              <span>{profile?.following ?? 0} following</span>
            </div>
            <button className="ghost-button" type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleAuth}>
            <div className="window-tabs compact">
              <button
                type="button"
                className={classNames('window-tab', authMode === 'sign-in' && 'is-active')}
                onClick={() => setAuthMode('sign-in')}
              >
                Sign in
              </button>
              <button
                type="button"
                className={classNames('window-tab', authMode === 'sign-up' && 'is-active')}
                onClick={() => setAuthMode('sign-up')}
              >
                Sign up
              </button>
            </div>
            {authMode === 'sign-up' && (
              <label className="field">
                <span>Username</span>
                <input
                  value={authForm.user_name}
                  onChange={(event) => setAuthForm((current) => ({ ...current, user_name: event.target.value }))}
                  placeholder="walthamstow_parent"
                />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={authForm.email}
                onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            <button className="primary-button" type="submit">
              {authMode === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        )}
      </div>

      <div className="panel">
        <div className="section-heading">
          <span className="mini-label">Follow people</span>
          <h2>Parent signals while swiping</h2>
        </div>
        <div className="parent-list">
          {parents.map((parent) => (
            <article key={parent.user_id} className="parent-card">
              <div>
                <strong>{parent.display_name}</strong>
                <span>@{parent.user_name}</span>
              </div>
              <button className="small-button" type="button" onClick={() => toggleFollow(parent)}>
                Follow
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActivityDrawer({ activity, onClose, reviewForm, setReviewForm, submitReview }) {
  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true">
      <aside className="activity-drawer">
        <button className="drawer-close" type="button" onClick={onClose}>
          Close
        </button>
        <div className="photo-placeholder">
          <span>Google photos later</span>
        </div>
        <p className="eyebrow">{activity.category}</p>
        <h2>{activity.activity_name}</h2>
        <p>{activity.description}</p>
        <div className="detail-list">
          <span><strong>Address</strong>{activity.address}</span>
          <span><strong>Time</strong>{activity.start_time} to {activity.end_time}</span>
          <span><strong>Age</strong>{activity.age_suitability || 'TBC'}</span>
          <span><strong>Child friendly</strong>{activity.child_friendly_score || 'Not rated yet'}</span>
          <span><strong>App rating</strong>{activity.app_rating || 'Not rated yet'}</span>
          <span><strong>Reviews</strong>{activity.number_of_reviews || 0}</span>
        </div>
        <div className="drawer-actions">
          {activity.website && (
            <a className="small-button" href={activity.website} target="_blank" rel="noreferrer">
              Website
            </a>
          )}
          {activity.google_link && (
            <a className="small-button" href={activity.google_link} target="_blank" rel="noreferrer">
              Google Maps
            </a>
          )}
        </div>

        <form className="review-form drawer-review" onSubmit={submitReview}>
          <h3>Add a quick review or photo</h3>
          <label className="field">
            <span>Rating</span>
            <input
              type="number"
              min="1"
              max="5"
              value={reviewForm.rating}
              onChange={(event) => setReviewForm((current) => ({ ...current, rating: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Review</span>
            <textarea
              value={reviewForm.text}
              onChange={(event) => setReviewForm((current) => ({ ...current, text: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Photo URL</span>
            <input
              value={reviewForm.photo_url}
              onChange={(event) => setReviewForm((current) => ({ ...current, photo_url: event.target.value }))}
            />
          </label>
          <button className="primary-button" type="submit">
            Save
          </button>
        </form>
      </aside>
    </div>
  );
}
