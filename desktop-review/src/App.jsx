import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from './supabase.js';
import {
  QUEUES,
  activitiesForQueue,
  bestLocation,
  clean,
  currentImage,
  domain,
  listingSearchText,
  openListingUrl,
  providerLabel,
  queueCounts,
  searchQueries,
} from './reviewData.js';

const ADMIN_EMAILS = new Set([
  'talkingmeowth06@gmail.com',
  'talkingmeowtho6@gmail.com',
  'benfielden@gmail.com',
]);

const activityColumns = [
  'activity_id', 'activity_name', 'address', 'postcode', 'borough', 'category', 'age_suitability',
  'description', 'card_summary', 'website', 'organiser_website', 'source_url', 'source_name', 'image_source_url',
  'google_place_uri', 'google_link', 'public_listing_status', 'archive', 'audit_image_status',
  'admin_cover_image_url', 'reviewed_image_url', 'reviewed_image_source_url', 'reviewed_image_original_url',
  'reviewed_image_selected_at', 'reviewed_image_model', 'user_image_url', 'audit_image_url', 'audit_image_source_url',
  'organiser_website_downloaded_image', 'website_downloaded_image', 'wikimedia_image_url', 'website_image_url',
  'listing_image_url', 'codex_image_candidates', 'codex_image_search_query', 'codex_image_searched_at',
  'codex_image_search_model', 'created_at', 'updated_at',
].join(',');

const isDemo = import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1';

const demoCandidates = Array.from({ length: 16 }, (_, index) => ({
  image_url: `https://picsum.photos/seed/tiny-outings-${index + 1}/1200/800`,
  thumbnail_url: `https://picsum.photos/seed/tiny-outings-${index + 1}/520/360`,
  source_page_url: `https://example.org/venue/gallery-${index + 1}`,
  source_domain: index % 3 === 0 ? 'venue.example' : index % 3 === 1 ? 'visitlondon.com' : 'provider.example',
  title: index % 2 ? 'Venue gallery and activity room' : 'Family activity at the venue',
  width: 1200,
  height: 800,
  relevance_reason: index % 3 === 0 ? 'Clear wide view of the venue and seating.' : 'Plausibly shows the named activity at this location.',
}));

const demoActivities = [
  {
    activity_id: 'demo-missing', activity_name: 'Baby Sensory Leyton', address: 'Leyton, London E10 5AB', borough: 'Waltham Forest',
    category: 'Baby & toddler classes', age_suitability: '0–13 months', public_listing_status: 'published', archive: false,
    organiser_website: 'https://babysensory.com/leyton', source_url: 'https://example.org/baby-sensory-leyton',
    codex_image_candidates: demoCandidates, codex_image_search_query: 'Baby Sensory Leyton',
    codex_image_searched_at: new Date().toISOString(), codex_image_search_model: 'SerpAPI Google Images — top 20 unfiltered',
  },
  {
    activity_id: 'demo-unsuitable', activity_name: 'Yardarm family café', address: '238 Francis Road, Leyton, London E10 6NQ',
    borough: 'Waltham Forest', category: 'Cafes & food', public_listing_status: 'published', archive: false,
    audit_image_status: 'needs_replacement', website_image_url: 'https://picsum.photos/seed/old-cafe/900/600',
    website: 'https://yardarm.london', codex_image_candidates: demoCandidates.slice(0, 12),
    codex_image_search_query: 'Yardarm family café Leyton', codex_image_searched_at: new Date().toISOString(),
    codex_image_search_model: 'SerpAPI Google Images — top 20 unfiltered',
  },
  {
    activity_id: 'demo-draft', activity_name: 'Mini Mozart Hackney', address: 'Hackney, London E8', borough: 'Hackney',
    category: 'Music & movement', age_suitability: '0–4 years', public_listing_status: 'draft', archive: false,
    organiser_website: 'https://minimozart.com', codex_image_candidates: [],
  },
];

function formatDate(value) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not yet' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function compactNumber(value) {
  return new Intl.NumberFormat('en-GB').format(Number(value || 0));
}

async function loadAllActivities() {
  const pageSize = 1000;
  const activities = [];
  for (let from = 0; ; from += pageSize) {
    const response = await supabase.from('activities').select(activityColumns).eq('archive', false)
      .order('activity_name', { ascending: true }).order('activity_id', { ascending: true }).range(from, from + pageSize - 1);
    if (response.error) throw response.error;
    activities.push(...(response.data || []));
    if ((response.data || []).length < pageSize) break;
  }

  const userImageByActivity = new Map();
  for (let from = 0; ; from += pageSize) {
    const response = await supabase.from('activity_photos').select('activity_id,photo_url')
      .eq('source_provider', 'user_upload').order('created_at', { ascending: false }).range(from, from + pageSize - 1);
    if (response.error) break;
    for (const photo of response.data || []) {
      if (photo.activity_id && photo.photo_url && !userImageByActivity.has(String(photo.activity_id))) {
        userImageByActivity.set(String(photo.activity_id), photo.photo_url);
      }
    }
    if ((response.data || []).length < pageSize) break;
  }
  return activities.map((activity) => ({
    ...activity,
    user_uploaded_image_url: userImageByActivity.get(String(activity.activity_id)) || null,
  }));
}

function SignIn({ message }) {
  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
    });
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">TO</div>
        <p className="eyebrow">Tiny Outings internal tools</p>
        <h1>Image Review Queue</h1>
        <p>Sign in with an approved administrator account to review listing images on desktop.</p>
        {message ? <p className="alert error">{message}</p> : null}
        <button className="primary-button" type="button" onClick={signIn}>Continue with Google</button>
      </section>
    </main>
  );
}

function CandidateCard({ candidate, index, selected, onSelect }) {
  const imageUrl = clean(candidate.thumbnail_url) || clean(candidate.image_url);
  const sourceDomain = clean(candidate.source_domain) || domain(candidate.source_page_url) || domain(candidate.image_url);
  const dimensions = candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : 'Size unavailable';
  return (
    <button className={`candidate-card${selected ? ' selected' : ''}`} type="button" onClick={() => onSelect(index)}>
      <span className="candidate-image-wrap">
        <img src={imageUrl} alt={clean(candidate.title) || `Candidate ${index + 1}`} loading="lazy" />
        <span className="candidate-index">{index + 1}</span>
        {selected ? <span className="selected-badge">Selected</span> : null}
      </span>
      <span className="candidate-details">
        <strong>{sourceDomain || 'Unknown source'}</strong>
        <span>{dimensions}</span>
        {candidate.title ? <span className="candidate-title">{candidate.title}</span> : null}
        {candidate.relevance_reason ? <span className="candidate-reason">{candidate.relevance_reason}</span> : null}
      </span>
    </button>
  );
}

function App() {
  const [session, setSession] = useState(isDemo ? { user: { id: 'demo', email: 'tinyoutings-qa-admin@tinyoutings.test' } } : null);
  const [authReady, setAuthReady] = useState(isDemo);
  const [activities, setActivities] = useState(isDemo ? demoActivities : []);
  const [loading, setLoading] = useState(!isDemo);
  const [activeQueue, setActiveQueue] = useState('missing_published');
  const [selectedId, setSelectedId] = useState(isDemo ? demoActivities[0].activity_id : '');
  const [filter, setFilter] = useState('');
  const deferredFilter = useDeferredValue(filter);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [candidateRequest, setCandidateRequest] = useState(null);
  const [customQuery, setCustomQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const isAdmin = isDemo || ADMIN_EMAILS.has(clean(session?.user?.email).toLowerCase());

  useEffect(() => {
    if (isDemo || !supabase) return undefined;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const refreshActivities = useCallback(async () => {
    if (isDemo || !isAdmin) return;
    setLoading(true);
    try {
      setActivities(await loadAllActivities());
      setNotice('');
    } catch (error) {
      setNotice(`Could not load listings: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    refreshActivities();
  }, [refreshActivities]);

  const counts = useMemo(() => queueCounts(activities), [activities]);
  const queueActivities = useMemo(() => {
    const queue = activitiesForQueue(activities, activeQueue);
    const needle = deferredFilter.toLowerCase().trim();
    if (!needle) return queue;
    return queue.filter((activity) => listingSearchText(activity).includes(needle));
  }, [activities, activeQueue, deferredFilter]);

  useEffect(() => {
    if (!queueActivities.length) {
      setSelectedId('');
      return;
    }
    if (!queueActivities.some((activity) => activity.activity_id === selectedId)) {
      setSelectedId(queueActivities[0].activity_id);
    }
  }, [queueActivities, selectedId]);

  const selectedActivity = queueActivities.find((activity) => activity.activity_id === selectedId)
    || activities.find((activity) => activity.activity_id === selectedId)
    || null;
  const queries = useMemo(() => selectedActivity ? searchQueries(selectedActivity) : null, [selectedActivity]);
  const candidates = Array.isArray(selectedActivity?.codex_image_candidates) ? selectedActivity.codex_image_candidates.slice(0, 20) : [];
  const activeImage = selectedActivity ? currentImage(selectedActivity) : null;

  const refreshCandidateState = useCallback(async () => {
    if (isDemo || !selectedActivity || !supabase) return;
    const [activityResponse, requestResponse] = await Promise.all([
      supabase.from('activities').select('activity_id,codex_image_candidates,codex_image_search_query,codex_image_searched_at,codex_image_search_model').eq('activity_id', selectedActivity.activity_id).single(),
      supabase.from('codex_image_candidate_requests').select('*').eq('activity_id', selectedActivity.activity_id).order('requested_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!activityResponse.error && activityResponse.data) {
      setActivities((current) => current.map((activity) => activity.activity_id === selectedActivity.activity_id
        ? { ...activity, ...activityResponse.data }
        : activity));
    }
    if (!requestResponse.error) setCandidateRequest(requestResponse.data || null);
  }, [selectedActivity]);

  const requestCandidates = useCallback(async (variant = 'activity_location', requestedQuery = '') => {
    if (!selectedActivity || !session?.user) return;
    const query = clean(requestedQuery) || queries?.[variant] || queries?.activity_location;
    if (!query) return;
    setBusy('request');
    setNotice('');
    setSelectedCandidate(null);
    if (isDemo) {
      setCandidateRequest({ status: 'pending', requested_query: query, request_variant: variant, requested_at: new Date().toISOString() });
      setTimeout(() => setCandidateRequest({ status: 'completed', requested_query: query, request_variant: variant, requested_at: new Date().toISOString(), candidate_count: demoCandidates.length, codex_model: 'SerpAPI Google Images — top 20 unfiltered' }), 600);
      setBusy('');
      return;
    }
    try {
      await supabase.from('codex_image_candidate_requests').update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('activity_id', selectedActivity.activity_id).in('status', ['pending', 'in_progress']);
      const response = await supabase.from('codex_image_candidate_requests').insert({
        activity_id: selectedActivity.activity_id,
        requested_query: query.slice(0, 240),
        request_variant: variant,
        requested_by_user_id: session.user.id,
      }).select('*').single();
      if (response.error) throw response.error;
      setCandidateRequest({ ...response.data, status: 'in_progress' });
      const searchResponse = await supabase.functions.invoke('image-review-admin', {
        body: {
          action: 'search',
          activity_id: selectedActivity.activity_id,
          candidate_request_id: response.data.candidate_request_id,
          query,
        },
      });
      if (searchResponse.error || searchResponse.data?.error) {
        throw new Error(searchResponse.data?.error || searchResponse.error?.message || 'SerpAPI search failed.');
      }
      setActivities((current) => current.map((activity) => activity.activity_id === selectedActivity.activity_id ? {
        ...activity,
        codex_image_candidates: searchResponse.data.candidates,
        codex_image_search_query: searchResponse.data.query,
        codex_image_searched_at: searchResponse.data.searchedAt,
        codex_image_search_model: searchResponse.data.source,
      } : activity));
      setCandidateRequest({
        ...response.data,
        status: 'completed',
        completed_at: searchResponse.data.searchedAt,
        candidate_count: searchResponse.data.candidates.length,
        codex_model: searchResponse.data.source,
      });
      setNotice(`${searchResponse.data.candidates.length} unfiltered Google Images candidates loaded from SerpAPI.`);
    } catch (error) {
      setNotice(`Could not queue the candidate search: ${error.message}`);
    } finally {
      setBusy('');
    }
  }, [queries, selectedActivity, session]);

  useEffect(() => {
    setSelectedCandidate(null);
    setCandidateRequest(null);
    setCustomQuery(queries?.activity_location || '');
    if (isDemo || !selectedActivity) return undefined;
    let cancelled = false;
    async function loadAndQueue() {
      const response = await supabase.from('codex_image_candidate_requests').select('*')
        .eq('activity_id', selectedActivity.activity_id).order('requested_at', { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      const request = response.error ? null : response.data;
      setCandidateRequest(request);
      const hasCandidates = Array.isArray(selectedActivity.codex_image_candidates) && selectedActivity.codex_image_candidates.length;
      const hasActiveRequest = request && ['pending', 'in_progress'].includes(request.status);
      if (!hasCandidates && !hasActiveRequest) await requestCandidates('activity_location', queries?.activity_location);
    }
    loadAndQueue();
    return () => { cancelled = true; };
  }, [selectedActivity, queries?.activity_location, requestCandidates]);

  useEffect(() => {
    if (isDemo || !candidateRequest || !['pending', 'in_progress'].includes(candidateRequest.status)) return undefined;
    const interval = window.setInterval(refreshCandidateState, 5000);
    return () => window.clearInterval(interval);
  }, [candidateRequest, refreshCandidateState]);

  async function saveSelected() {
    if (!selectedActivity || selectedCandidate == null) return;
    setBusy('save');
    setNotice('');
    if (isDemo) {
      const candidate = candidates[selectedCandidate];
      setActivities((current) => current.map((activity) => activity.activity_id === selectedActivity.activity_id ? {
        ...activity,
        reviewed_image_url: candidate.image_url,
        reviewed_image_source_url: candidate.source_page_url || candidate.image_url,
        reviewed_image_original_url: candidate.image_url,
      } : activity));
      setSelectedCandidate(null);
      setBusy('');
      setNotice('Demo image saved.');
      return;
    }
    const response = await supabase.functions.invoke('image-review-admin', {
      body: {
        action: 'select',
        activity_id: selectedActivity.activity_id,
        candidate_index: selectedCandidate,
        candidate_set_searched_at: selectedActivity.codex_image_searched_at,
      },
    });
    if (response.error || response.data?.error) {
      setNotice(`Could not save the selected image: ${response.data?.error || response.error?.message}`);
    } else {
      setActivities((current) => current.map((activity) => activity.activity_id === selectedActivity.activity_id ? {
        ...activity,
        reviewed_image_url: response.data.reviewedImageUrl,
        reviewed_image_source_url: response.data.sourceUrl,
        reviewed_image_original_url: response.data.candidate?.image_url,
        reviewed_image_selected_at: response.data.selectedAt,
        reviewed_image_model: response.data.model,
      } : activity));
      setSelectedCandidate(null);
      setNotice('Reviewed image downloaded, stored, and applied to the listing.');
    }
    setBusy('');
  }

  async function publishDraft() {
    if (!selectedActivity || selectedActivity.public_listing_status !== 'draft') return;
    setBusy('publish');
    setNotice('');
    if (isDemo) {
      setActivities((current) => current.map((activity) => activity.activity_id === selectedActivity.activity_id
        ? { ...activity, public_listing_status: 'published' }
        : activity));
      setBusy('');
      setNotice('Demo listing published.');
      return;
    }
    const response = await supabase.functions.invoke('image-review-admin', {
      body: { action: 'publish', activity_id: selectedActivity.activity_id },
    });
    if (response.error || response.data?.error) {
      setNotice(`Could not publish this listing: ${response.data?.error || response.error?.message}`);
    } else {
      setActivities((current) => current.map((activity) => activity.activity_id === selectedActivity.activity_id
        ? { ...activity, public_listing_status: 'published', archive: false }
        : activity));
      setNotice('Listing published and moved into the published queues.');
    }
    setBusy('');
  }

  function selectCandidate(index) {
    setSelectedCandidate((current) => current === index ? null : index);
  }

  if (!hasSupabaseConfig && !isDemo) return <SignIn message="Supabase configuration is missing from this deployment." />;
  if (!authReady) return <main className="loading-screen">Checking your admin session…</main>;
  if (!session) return <SignIn />;
  if (!isAdmin) return <SignIn message={`${session.user.email || 'This account'} is not an approved administrator.`} />;

  const selectedQueue = QUEUES.find((queue) => queue.id === activeQueue);
  const requestStatus = candidateRequest?.status || (candidates.length ? 'completed' : 'not_requested');

  return (
    <div className="review-app">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark small">TO</div>
          <div><span>Tiny Outings</span><strong>Image Review Queue</strong></div>
        </div>
        <div className="topbar-actions">
          {isDemo ? <span className="demo-pill">Demo mode</span> : null}
          <button className="secondary-button" type="button" onClick={refreshActivities} disabled={loading}>Refresh data</button>
          <span className="signed-in">{session.user.email}</span>
          {!isDemo ? <button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>Sign out</button> : null}
        </div>
      </header>

      <nav className="queue-bar" aria-label="Image review queues">
        {QUEUES.map((queue) => (
          <button className={`queue-tab${activeQueue === queue.id ? ' active' : ''}`} type="button" key={queue.id} onClick={() => setActiveQueue(queue.id)}>
            <span>{queue.label}</span><strong>{compactNumber(counts[queue.id])}</strong>
          </button>
        ))}
      </nav>

      {notice ? <div className="notice-bar">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button></div> : null}

      <main className="workspace">
        <aside className="listing-column">
          <div className="column-heading">
            <div><p className="eyebrow">Current queue</p><h2>{selectedQueue?.label}</h2></div>
            <span>{compactNumber(queueActivities.length)}</span>
          </div>
          <p className="queue-description">{selectedQueue?.description}</p>
          <label className="search-box">
            <span>Search listings</span>
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Name, provider, area or category" />
          </label>
          <div className="listing-list">
            {loading ? <p className="empty-state">Loading listings…</p> : null}
            {!loading && !queueActivities.length ? <p className="empty-state">No listings in this queue.</p> : null}
            {queueActivities.map((activity) => {
              const image = currentImage(activity);
              return (
                <button type="button" className={`listing-row${selectedId === activity.activity_id ? ' active' : ''}`} key={activity.activity_id} onClick={() => setSelectedId(activity.activity_id)}>
                  <span className="listing-thumb">{image.url ? <img src={image.url} alt="" loading="lazy" /> : <span>No image</span>}</span>
                  <span className="listing-copy">
                    <strong>{activity.activity_name || 'Untitled listing'}</strong>
                    <span>{bestLocation(activity)} · {activity.category || 'Uncategorised'}</span>
                    <small>{activity.public_listing_status === 'draft' ? 'Draft' : image.label}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {!selectedActivity ? (
          <section className="no-selection"><h2>Select a listing</h2><p>Choose an item from the queue to review its image candidates.</p></section>
        ) : (
          <>
            <section className="listing-detail">
              <div className="detail-heading">
                <div>
                  <div className="status-line">
                    <span className={`status-badge ${selectedActivity.public_listing_status}`}>{selectedActivity.public_listing_status === 'draft' ? 'Draft' : 'Published'}</span>
                    {selectedActivity.audit_image_status ? <span className="audit-badge">Audit: {selectedActivity.audit_image_status.replaceAll('_', ' ')}</span> : null}
                  </div>
                  <h1>{selectedActivity.activity_name || 'Untitled listing'}</h1>
                  {providerLabel(selectedActivity) ? <p className="provider-name">{providerLabel(selectedActivity)}</p> : null}
                </div>
                {openListingUrl(selectedActivity) ? <a className="secondary-button link-button" href={openListingUrl(selectedActivity)} target="_blank" rel="noreferrer">Open listing ↗</a> : null}
              </div>

              <dl className="metadata-grid">
                <div><dt>Location</dt><dd>{bestLocation(selectedActivity)}</dd></div>
                <div><dt>Category</dt><dd>{selectedActivity.category || 'Not recorded'}</dd></div>
                <div className="wide"><dt>Full address</dt><dd>{selectedActivity.address || 'Not recorded'}</dd></div>
                <div><dt>Age range</dt><dd>{selectedActivity.age_suitability || 'Not recorded'}</dd></div>
                <div><dt>Listing ID</dt><dd className="mono">{selectedActivity.activity_id}</dd></div>
              </dl>

              <section className="current-image-panel">
                <div className="section-title"><div><p className="eyebrow">Card now</p><h2>Current image</h2></div><span className="source-chip">{activeImage.label}</span></div>
                <div className="current-image-frame">
                  {activeImage.url ? <img src={activeImage.url} alt={`Current card for ${selectedActivity.activity_name}`} /> : <div className="missing-image"><strong>No usable image</strong><span>This listing is using its category placeholder.</span></div>}
                </div>
                <div className="source-details">
                  <span>Field: <strong>{activeImage.field || 'Category placeholder'}</strong></span>
                  {activeImage.sourceUrl ? <a href={activeImage.sourceUrl} target="_blank" rel="noreferrer">{activeImage.sourceDomain || activeImage.sourceUrl} ↗</a> : <span>No source URL stored</span>}
                </div>
              </section>

              <section className="search-panel">
                <div className="section-title"><div><p className="eyebrow">Candidate discovery</p><h2>Search Google Images</h2></div><span className={`request-status ${requestStatus}`}>{requestStatus.replaceAll('_', ' ')}</span></div>
                <p>SerpAPI returns the first 20 Google Images results in their original order. Candidates are shown without quality, logo, resolution, Wikimedia, or relevance filtering.</p>
                <div className="query-row"><input value={customQuery} onChange={(event) => setCustomQuery(event.target.value)} maxLength={240} /><button className="primary-button" type="button" disabled={busy === 'request' || !customQuery.trim()} onClick={() => requestCandidates('custom', customQuery)}>{busy === 'request' ? 'Searching…' : 'Load top 20'}</button></div>
                <div className="query-options">
                  <button type="button" onClick={() => { setCustomQuery(queries.activity_location); requestCandidates('activity_location', queries.activity_location); }}>Activity + location</button>
                  <button type="button" onClick={() => { setCustomQuery(queries.provider_location); requestCandidates('provider_location', queries.provider_location); }}>Provider + location</button>
                  <button type="button" onClick={() => { setCustomQuery(queries.activity_only); requestCandidates('activity_only', queries.activity_only); }}>Activity only</button>
                </div>
                <div className="request-meta">
                  <span>Requested: {formatDate(candidateRequest?.requested_at)}</span>
                  <span>Last completed: {formatDate(selectedActivity.codex_image_searched_at)}</span>
                  <span>Source: {selectedActivity.codex_image_search_model || candidateRequest?.codex_model || 'Waiting for SerpAPI'}</span>
                </div>
              </section>

              {selectedActivity.public_listing_status === 'draft' ? (
                <section className="publish-panel"><div><strong>Ready to make this listing live?</strong><span>Publishing moves it into the published queues immediately.</span></div><button className="publish-button" type="button" disabled={busy === 'publish'} onClick={publishDraft}>{busy === 'publish' ? 'Publishing…' : 'Publish listing'}</button></section>
              ) : null}
            </section>

            <section className="candidate-column">
              <div className="candidate-header">
                <div><p className="eyebrow">Unfiltered Google Images results</p><h2>Candidate gallery <span>{candidates.length}</span></h2></div>
                <div className="candidate-actions"><button className="text-button" type="button" disabled={selectedCandidate == null} onClick={() => setSelectedCandidate(null)}>Clear selection</button><button className="primary-button" type="button" disabled={selectedCandidate == null || busy === 'save'} onClick={saveSelected}>{busy === 'save' ? 'Downloading…' : 'Use selected image'}</button></div>
              </div>
              {candidates.length ? (
                <div className="candidate-grid">
                  {candidates.map((candidate, index) => <CandidateCard key={`${candidate.image_url}-${index}`} candidate={candidate} index={index} selected={selectedCandidate === index} onSelect={selectCandidate} />)}
                </div>
              ) : (
                <div className="waiting-panel">
                  <div className="waiting-icon">⌁</div>
                  <h3>{['pending', 'in_progress'].includes(requestStatus) ? 'Searching Google Images' : 'No candidates yet'}</h3>
                  <p>{requestStatus === 'in_progress' ? 'SerpAPI is fetching the first 20 results now.' : 'Run an activity-and-location search to load the top 20 Google Images results.'}</p>
                  {candidateRequest?.requested_query ? <code>{candidateRequest.requested_query}</code> : null}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
