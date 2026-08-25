import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { hasSupabaseConfig, supabase } from './supabase.js';
import { edgeFunctionErrorMessage } from './functionErrors.js';
import {
  QUEUES,
  activitiesToPreload,
  bestLocation,
  clean,
  currentImage,
  domain,
  googlePlacesUrl,
  listingSearchText,
  openListingUrl,
  prepareActivities,
  preparedActivitiesForQueue,
  providerLabel,
  queueCountsFromPrepared,
  searchQueries,
} from './reviewData.js';

const ADMIN_EMAILS = new Set([
  'talkingmeowth06@gmail.com',
  'talkingmeowtho6@gmail.com',
  'benfielden@gmail.com',
]);
const PRELOAD_QUEUE_IDS = ['missing_published', 'unsuitable_audit', 'all_published', 'all_draft'];
const PRELOAD_PER_QUEUE = 20;
const PRELOAD_CONCURRENCY = 6;

const activityColumns = [
  'activity_id', 'activity_name', 'address', 'postcode', 'borough', 'category', 'age_suitability',
  'description', 'card_summary', 'website', 'organiser_website', 'source_url', 'source_name', 'image_source_url',
  'google_place_uri', 'google_link', 'public_listing_status', 'archive', 'audit_image_status',
  'admin_cover_image_url', 'reviewed_image_url', 'reviewed_image_source_url', 'reviewed_image_original_url',
  'reviewed_image_selected_at', 'reviewed_image_model', 'user_image_url', 'audit_image_url', 'audit_image_source_url',
  'organiser_website_downloaded_image', 'website_downloaded_image', 'wikimedia_image_url', 'website_image_url',
  'listing_image_url', 'codex_image_search_query', 'codex_image_searched_at',
  'codex_image_search_model', 'image_review_ignored_at', 'image_review_ignored_by_user_id', 'created_at', 'updated_at',
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
  async function loadPages(queryPage, windowSize = 4) {
    const rows = [];
    for (let base = 0; ; base += pageSize * windowSize) {
      const responses = await Promise.all(Array.from({ length: windowSize }, (_, index) => queryPage(base + (index * pageSize))));
      const failed = responses.find((response) => response.error);
      if (failed?.error) throw failed.error;
      for (const response of responses) {
        const pageRows = response.data || [];
        rows.push(...pageRows);
        if (pageRows.length < pageSize) return rows;
      }
    }
  }

  const activitiesPromise = loadPages((from) => supabase.from('activities')
    .select(activityColumns)
    .eq('archive', false)
    .order('activity_name', { ascending: true })
    .order('activity_id', { ascending: true })
    .range(from, from + pageSize - 1));
  const photosPromise = loadPages((from) => supabase.from('activity_photos')
    .select('activity_id,photo_url')
    .eq('source_provider', 'user_upload')
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1), 1).catch(() => []);
  const [activities, photos] = await Promise.all([activitiesPromise, photosPromise]);

  const userImageByActivity = new Map();
  for (const photo of photos) {
    if (photo.activity_id && photo.photo_url && !userImageByActivity.has(String(photo.activity_id))) {
      userImageByActivity.set(String(photo.activity_id), photo.photo_url);
    }
  }
  return activities.map((activity) => ({
    ...activity,
    candidate_set_loaded: false,
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

function CandidateCard({ candidate, index, selected, onSelect, onZoom }) {
  const imageUrl = clean(candidate.thumbnail_url) || clean(candidate.image_url);
  const sourceDomain = clean(candidate.source_domain) || domain(candidate.source_page_url) || domain(candidate.image_url);
  const sourceUrl = clean(candidate.source_page_url) || clean(candidate.image_url);
  const dimensions = candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : 'Size unavailable';
  return (
    <article className={`candidate-card${selected ? ' selected' : ''}`}>
      <button className="candidate-select" type="button" onClick={() => onSelect(index)} aria-label={`Select candidate ${index + 1}`}>
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
      <div className="candidate-card-actions">
        <button type="button" onClick={() => onZoom(candidate, index)}>View large</button>
        {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a> : <span>Source unavailable</span>}
      </div>
    </article>
  );
}

function CandidateLightbox({ candidate, index, onClose }) {
  const fullImageUrl = clean(candidate.image_url) || clean(candidate.thumbnail_url);
  const thumbnailUrl = clean(candidate.thumbnail_url);
  const sourceUrl = clean(candidate.source_page_url);
  const sourceDomain = clean(candidate.source_domain) || domain(sourceUrl) || domain(fullImageUrl);
  const dimensions = candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : 'Dimensions unavailable';

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  function useThumbnailFallback(event) {
    if (thumbnailUrl && event.currentTarget.src !== thumbnailUrl) event.currentTarget.src = thumbnailUrl;
  }

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={`Candidate ${index + 1} enlarged`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="image-lightbox-panel">
        <div className="image-lightbox-stage">
          <img src={fullImageUrl} alt={clean(candidate.title) || `Candidate ${index + 1} enlarged`} onError={useThumbnailFallback} />
        </div>
        <aside className="image-lightbox-details">
          <button className="lightbox-close" type="button" onClick={onClose} aria-label="Close enlarged image">×</button>
          <p className="eyebrow">Candidate {index + 1}</p>
          <h2>{candidate.title || sourceDomain || 'Image candidate'}</h2>
          <dl>
            <div><dt>Source</dt><dd>{sourceDomain || 'Unknown source'}</dd></div>
            <div><dt>Image size</dt><dd>{dimensions}</dd></div>
            {candidate.relevance_reason ? <div><dt>Search position</dt><dd>{candidate.relevance_reason}</dd></div> : null}
          </dl>
          <div className="lightbox-links">
            {sourceUrl ? <a className="primary-button" href={sourceUrl} target="_blank" rel="noreferrer">Open source webpage ↗</a> : null}
            {fullImageUrl ? <a className="secondary-button" href={fullImageUrl} target="_blank" rel="noreferrer">Open original image ↗</a> : null}
          </div>
          <p className="lightbox-hint">Press Escape or click outside the preview to close.</p>
        </aside>
      </section>
    </div>
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
  const [zoomedCandidate, setZoomedCandidate] = useState(null);
  const [candidateRequest, setCandidateRequest] = useState(null);
  const [customQuery, setCustomQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [preloadStatus, setPreloadStatus] = useState({ status: 'idle', ready: 0, total: 0, apiCalls: 0, failed: 0 });
  const selectedIdRef = useRef(selectedId);
  const candidateLoadsRef = useRef(new Set());
  const candidateSearchesRef = useRef(new Set());
  const candidateSearchSequenceRef = useRef(0);
  const preloadStartedRef = useRef(false);
  const preloadRunRef = useRef(0);

  const isAdmin = isDemo || ADMIN_EMAILS.has(clean(session?.user?.email).toLowerCase());

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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
    preloadStartedRef.current = false;
    preloadRunRef.current += 1;
    setPreloadStatus({ status: 'idle', ready: 0, total: 0, apiCalls: 0, failed: 0 });
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

  const preparedActivities = useMemo(() => prepareActivities(activities), [activities]);
  const counts = useMemo(() => queueCountsFromPrepared(preparedActivities), [preparedActivities]);
  const preloadTargets = useMemo(
    () => activitiesToPreload(preparedActivities, PRELOAD_QUEUE_IDS, PRELOAD_PER_QUEUE),
    [preparedActivities],
  );
  const queueActivities = useMemo(() => {
    const queue = preparedActivitiesForQueue(preparedActivities, activeQueue);
    const needle = deferredFilter.toLowerCase().trim();
    if (!needle) return queue;
    return queue.filter((activity) => listingSearchText(activity).includes(needle));
  }, [preparedActivities, activeQueue, deferredFilter]);

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
    || preparedActivities.find((activity) => activity.activity_id === selectedId)
    || null;
  const queries = useMemo(() => selectedActivity ? searchQueries(selectedActivity) : null, [selectedActivity]);
  const candidates = Array.isArray(selectedActivity?.codex_image_candidates) ? selectedActivity.codex_image_candidates.slice(0, 20) : [];
  const activeImage = selectedActivity ? currentImage(selectedActivity) : null;

  const requestCandidates = useCallback(async (activity, variant = 'activity_location', requestedQuery = '', background = false) => {
    if (!activity || !session?.user) return;
    const activityId = activity.activity_id;
    if (candidateSearchesRef.current.has(activityId)) return;
    const activityQueries = searchQueries(activity);
    const query = clean(requestedQuery) || activityQueries[variant] || activityQueries.activity_location;
    if (!query) return;
    candidateSearchesRef.current.add(activityId);
    const requestSequence = background ? null : candidateSearchSequenceRef.current + 1;
    if (!background) candidateSearchSequenceRef.current = requestSequence;
    const requestedAt = new Date().toISOString();
    if (!background) {
      setBusy('request');
      setNotice('');
      setSelectedCandidate(null);
    }
    if (selectedIdRef.current === activityId) {
      setCandidateRequest({ status: 'in_progress', requested_query: query, request_variant: variant, requested_at: requestedAt });
    }
    if (isDemo) {
      setTimeout(() => {
        const completedAt = new Date().toISOString();
        setActivities((current) => current.map((currentActivity) => currentActivity.activity_id === activityId ? {
          ...currentActivity,
          codex_image_candidates: demoCandidates,
          codex_image_search_query: query,
          codex_image_searched_at: completedAt,
          codex_image_search_model: 'SerpAPI Google Images — top 20 unfiltered',
          candidate_set_loaded: true,
        } : currentActivity));
        if (selectedIdRef.current === activityId) setCandidateRequest({ status: 'completed', requested_query: query, request_variant: variant, requested_at: requestedAt, completed_at: completedAt, candidate_count: demoCandidates.length, codex_model: 'SerpAPI Google Images — top 20 unfiltered' });
        candidateSearchesRef.current.delete(activityId);
        if (!background) setBusy('');
      }, 600);
      return true;
    }
    try {
      const searchResponse = await supabase.functions.invoke('image-review-admin', {
        body: {
          action: 'search',
          activity_id: activityId,
          query,
          request_variant: variant,
        },
      });
      if (searchResponse.error || searchResponse.data?.error) {
        throw new Error(await edgeFunctionErrorMessage(searchResponse, 'SerpAPI search failed.'));
      }
      setActivities((current) => current.map((currentActivity) => currentActivity.activity_id === activityId ? {
        ...currentActivity,
        codex_image_candidates: searchResponse.data.candidates,
        codex_image_search_query: searchResponse.data.query,
        codex_image_searched_at: searchResponse.data.searchedAt,
        codex_image_search_model: searchResponse.data.source,
        candidate_set_loaded: true,
      } : currentActivity));
      if (selectedIdRef.current === activityId) {
        setCandidateRequest(searchResponse.data.request || {
          status: 'completed',
          requested_query: searchResponse.data.query,
          requested_at: requestedAt,
          completed_at: searchResponse.data.searchedAt,
          candidate_count: searchResponse.data.candidates.length,
          codex_model: searchResponse.data.source,
        });
        if (!background) setNotice(`${searchResponse.data.candidates.length} unfiltered Google Images candidates loaded from SerpAPI.`);
      }
      return true;
    } catch (error) {
      if (selectedIdRef.current === activityId) {
        setCandidateRequest((current) => ({
          ...current,
          status: 'failed',
          completed_at: new Date().toISOString(),
          failure_reason: error.message,
        }));
        if (!background) setNotice(`Could not load image candidates from SerpAPI: ${error.message}`);
      }
      return false;
    } finally {
      candidateSearchesRef.current.delete(activityId);
      if (!background && candidateSearchSequenceRef.current === requestSequence) setBusy('');
    }
  }, [session]);

  useEffect(() => {
    if (isDemo || loading || !isAdmin || !preloadTargets.length || preloadStartedRef.current) return undefined;
    preloadStartedRef.current = true;
    const runId = preloadRunRef.current + 1;
    preloadRunRef.current = runId;
    const isCurrentRun = () => preloadRunRef.current === runId;
    async function preloadCandidateSets() {
      const targetIds = preloadTargets.map((activity) => activity.activity_id);
      setPreloadStatus({ status: 'loading', ready: 0, total: targetIds.length, apiCalls: 0, failed: 0 });
      try {
        const response = await supabase.from('activities')
          .select('activity_id,codex_image_candidates,codex_image_search_query,codex_image_searched_at,codex_image_search_model')
          .in('activity_id', targetIds);
        if (response.error) throw response.error;
        const savedById = new Map((response.data || []).map((activity) => [activity.activity_id, activity]));
        setActivities((current) => current.map((activity) => {
          const saved = savedById.get(activity.activity_id);
          return saved ? { ...activity, ...saved, candidate_set_loaded: true } : activity;
        }));
        const missing = preloadTargets
          .map((activity) => ({ ...activity, ...(savedById.get(activity.activity_id) || {}), candidate_set_loaded: true }))
          .filter((activity) => !Array.isArray(activity.codex_image_candidates) || !activity.codex_image_candidates.length);
        let ready = targetIds.length - missing.length;
        let failed = 0;
        let nextIndex = 0;
        if (isCurrentRun()) setPreloadStatus({ status: missing.length ? 'searching' : 'complete', ready, total: targetIds.length, apiCalls: missing.length, failed });
        async function worker() {
          while (nextIndex < missing.length) {
            const activity = missing[nextIndex];
            nextIndex += 1;
            const query = searchQueries(activity).activity_location;
            const loaded = await requestCandidates(activity, 'activity_location', query, true);
            if (loaded === false) failed += 1;
            else ready += 1;
            const finished = ready + failed === targetIds.length;
            if (isCurrentRun()) setPreloadStatus({ status: finished ? (failed ? 'failed' : 'complete') : 'searching', ready, total: targetIds.length, apiCalls: missing.length, failed });
          }
        }
        await Promise.all(Array.from({ length: Math.min(PRELOAD_CONCURRENCY, missing.length) }, worker));
      } catch (error) {
        if (isCurrentRun()) {
          setPreloadStatus((current) => ({ ...current, status: 'failed' }));
          setNotice(`Could not preload candidate images: ${error.message}`);
        }
      }
    }
    preloadCandidateSets();
    return undefined;
  }, [isAdmin, loading, preloadTargets, requestCandidates]);

  useEffect(() => {
    setSelectedCandidate(null);
    setZoomedCandidate(null);
    setCandidateRequest(null);
    setCustomQuery(queries?.activity_location || '');
  }, [selectedActivity?.activity_id, queries?.activity_location]);

  useEffect(() => {
    if (isDemo || !selectedActivity || !supabase) return undefined;
    const activityId = selectedActivity.activity_id;
    if (selectedActivity.candidate_set_loaded) {
      if (!candidates.length && !selectedActivity.image_review_ignored_at) requestCandidates(selectedActivity, 'activity_location', queries?.activity_location);
      return undefined;
    }
    if (candidateLoadsRef.current.has(activityId)) return undefined;
    candidateLoadsRef.current.add(activityId);
    async function loadSavedCandidates() {
      try {
        const response = await supabase.from('activities')
          .select('activity_id,codex_image_candidates,codex_image_search_query,codex_image_searched_at,codex_image_search_model')
          .eq('activity_id', activityId)
          .single();
        if (response.error) throw response.error;
        setActivities((current) => current.map((activity) => activity.activity_id === activityId
          ? { ...activity, ...response.data, candidate_set_loaded: true }
          : activity));
        if (selectedIdRef.current === activityId && Array.isArray(response.data.codex_image_candidates) && response.data.codex_image_candidates.length) {
          setCandidateRequest({
            status: 'completed',
            requested_query: response.data.codex_image_search_query,
            completed_at: response.data.codex_image_searched_at,
            candidate_count: response.data.codex_image_candidates.length,
            codex_model: response.data.codex_image_search_model,
          });
        }
      } catch (error) {
        if (selectedIdRef.current === activityId) setNotice(`Could not load saved image candidates: ${error.message}`);
      } finally {
        candidateLoadsRef.current.delete(activityId);
      }
    }
    loadSavedCandidates();
    return undefined;
  }, [candidates.length, queries?.activity_location, requestCandidates, selectedActivity]);

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
      setNotice(`Could not save the selected image: ${await edgeFunctionErrorMessage(response, 'Image review failed.')}`);
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
      setNotice(`Could not publish this listing: ${await edgeFunctionErrorMessage(response, 'Publishing failed.')}`);
    } else {
      setActivities((current) => current.map((activity) => activity.activity_id === selectedActivity.activity_id
        ? { ...activity, public_listing_status: 'published', archive: false }
        : activity));
      setNotice('Listing published and moved into the published queues.');
    }
    setBusy('');
  }

  async function setIgnored(ignored) {
    if (!selectedActivity) return;
    const activityId = selectedActivity.activity_id;
    setBusy('ignore');
    setNotice('');
    if (isDemo) {
      const ignoredAt = ignored ? new Date().toISOString() : null;
      setActivities((current) => current.map((activity) => activity.activity_id === activityId
        ? { ...activity, image_review_ignored_at: ignoredAt, image_review_ignored_by_user_id: ignored ? 'demo' : null }
        : activity));
      setBusy('');
      setNotice(ignored ? 'Listing moved to Ignored.' : 'Listing returned to the active review queues.');
      return;
    }
    const response = await supabase.functions.invoke('image-review-admin', {
      body: { action: 'ignore', activity_id: activityId, ignored },
    });
    if (response.error || response.data?.error) {
      setNotice(`Could not change the review status: ${await edgeFunctionErrorMessage(response, 'Image review status update failed.')}`);
    } else {
      setActivities((current) => current.map((activity) => activity.activity_id === activityId
        ? { ...activity, ...response.data.activity }
        : activity));
      setNotice(ignored ? 'Listing moved to Ignored.' : 'Listing returned to the active review queues.');
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
  const requestStatus = candidateRequest?.status || (candidates.length ? 'completed' : selectedActivity?.candidate_set_loaded ? 'not_requested' : 'loading');
  const candidateSource = candidates.length
    ? selectedActivity.codex_image_search_model || candidateRequest?.codex_model || 'Saved image candidates'
    : 'SerpAPI Google Images';
  const preloadLabel = preloadStatus.status === 'loading'
    ? 'Loading saved candidates…'
    : preloadStatus.status === 'searching'
      ? `Preloading candidates ${preloadStatus.ready}/${preloadStatus.total}`
      : preloadStatus.status === 'complete'
        ? `Candidates ready ${preloadStatus.ready}/${preloadStatus.total}`
        : preloadStatus.status === 'failed'
          ? `Candidate preload incomplete ${preloadStatus.ready}/${preloadStatus.total}`
          : '';

  return (
    <div className="review-app">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark small">TO</div>
          <div><span>Tiny Outings</span><strong>Image Review Queue</strong></div>
        </div>
        <div className="topbar-actions">
          {isDemo ? <span className="demo-pill">Demo mode</span> : null}
          {preloadLabel ? <span className={`preload-pill ${preloadStatus.status}`}>{preloadLabel}</span> : null}
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
                    {selectedActivity.image_review_ignored_at ? <span className="ignored-badge">Ignored</span> : null}
                  </div>
                  <h1>{selectedActivity.activity_name || 'Untitled listing'}</h1>
                  {providerLabel(selectedActivity) ? <p className="provider-name">{providerLabel(selectedActivity)}</p> : null}
                </div>
                <div className="detail-actions">
                  {openListingUrl(selectedActivity) ? <a className="secondary-button link-button" href={openListingUrl(selectedActivity)} target="_blank" rel="noreferrer">Open listing ↗</a> : null}
                  <a className="places-button link-button" href={googlePlacesUrl(selectedActivity)} target="_blank" rel="noreferrer">Google Places ↗</a>
                  <button className={selectedActivity.image_review_ignored_at ? 'restore-button' : 'ignore-button'} type="button" disabled={busy === 'ignore'} onClick={() => setIgnored(!selectedActivity.image_review_ignored_at)}>
                    {busy === 'ignore' ? 'Updating…' : selectedActivity.image_review_ignored_at ? 'Return to review' : 'Ignore'}
                  </button>
                </div>
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
                <div className="query-row"><input value={customQuery} onChange={(event) => setCustomQuery(event.target.value)} maxLength={240} /><button className="primary-button" type="button" disabled={busy === 'request' || !customQuery.trim()} onClick={() => requestCandidates(selectedActivity, 'custom', customQuery)}>{busy === 'request' ? 'Searching…' : 'Load top 20'}</button></div>
                <div className="query-options">
                  <button type="button" onClick={() => { setCustomQuery(queries.activity_location); requestCandidates(selectedActivity, 'activity_location', queries.activity_location); }}>Activity + location</button>
                  <button type="button" onClick={() => { setCustomQuery(queries.provider_location); requestCandidates(selectedActivity, 'provider_location', queries.provider_location); }}>Provider + location</button>
                  <button type="button" onClick={() => { setCustomQuery(queries.activity_only); requestCandidates(selectedActivity, 'activity_only', queries.activity_only); }}>Activity only</button>
                </div>
                <div className="request-meta">
                  <span>Requested: {formatDate(candidateRequest?.requested_at)}</span>
                  <span>Last completed: {formatDate(selectedActivity.codex_image_searched_at)}</span>
                  <span>Source: {candidateSource}</span>
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
                  {candidates.map((candidate, index) => <CandidateCard key={`${candidate.image_url}-${index}`} candidate={candidate} index={index} selected={selectedCandidate === index} onSelect={selectCandidate} onZoom={(imageCandidate, candidateIndex) => setZoomedCandidate({ candidate: imageCandidate, index: candidateIndex })} />)}
                </div>
              ) : (
                <div className="waiting-panel">
                  <div className="waiting-icon">⌁</div>
                  <h3>{requestStatus === 'loading' ? 'Loading saved candidates' : ['pending', 'in_progress'].includes(requestStatus) ? 'Searching Google Images' : 'No candidates yet'}</h3>
                  <p>{requestStatus === 'loading' ? 'Checking this listing, then SerpAPI will run automatically if no candidates are saved.' : requestStatus === 'in_progress' ? 'SerpAPI is fetching the first 20 results now.' : 'Run an activity-and-location search to load the top 20 Google Images results.'}</p>
                  {candidateRequest?.requested_query ? <code>{candidateRequest.requested_query}</code> : null}
                </div>
              )}
            </section>
          </>
        )}
      </main>
      {zoomedCandidate ? <CandidateLightbox candidate={zoomedCandidate.candidate} index={zoomedCandidate.index} onClose={() => setZoomedCandidate(null)} /> : null}
    </div>
  );
}

export default App;
