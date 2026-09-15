import { useEffect, useRef, useState } from 'react';
import { supabase, hasSupabaseConfig } from './supabase.js';
import { edgeFunctionErrorMessage } from './functionErrors.js';
import { TRAINING_RETURN_KEY } from './trainingRoute.js';
import { categoryIllustrationCandidate } from './categoryIllustrations.js';
import { REJECTION_REASONS, trainingLabelCounts, validateTrainingReview } from '../../supabase/functions/image-training-review/policy.js';

const admins = new Set(['talkingmeowth06@gmail.com', 'talkingmeowtho6@gmail.com', 'benfielden@gmail.com']);
const params = new URLSearchParams(window.location.search);
const demo = import.meta.env.DEV && params.get('demo') === '1';
const url = (value) => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
const emptyDraft = { labels: {}, preferred: null, outcome: 'selected', notes: '' };
const draftKey = (user, reviewCase) => `image-training:${user}:${reviewCase.case_id}:${reviewCase.candidate_set_hash}`;
const draftFromReview = (review) => review ? { labels: Object.fromEntries(review.labels.map((r) => [r.candidate_id, r])),
  preferred: review.preferred_candidate_id, outcome: review.outcome, notes: review.notes || '' } : { ...emptyDraft };

async function api(body) {
  const response = await supabase.functions.invoke('image-training-review', { body });
  if (response.error || response.data?.error) throw Error(await edgeFunctionErrorMessage(response, 'Could not reach the review service. Your draft is still here.'));
  return response.data;
}

function External({ href, children }) { return url(href) ? <a href={url(href)} target="_blank" rel="noopener noreferrer">{children} ↗</a> : null; }

function Zoom({ candidate, close }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="training-zoom" onCancel={close} onClick={(e) => { if (e.target === dialog.current) close(); }}>
    <button className="training-zoom-close" autoFocus onClick={close}>Close ×</button>
    <img src={candidate.image_url} alt={candidate.title || 'Full-size candidate'} />
    <p>If the full image does not load, open the original or source page. A thumbnail alone cannot establish image quality.</p>
    <div className="training-links"><External href={candidate.image_url}>Original image</External><External href={candidate.source_page_url}>Source page</External></div>
  </dialog>;
}

function Photo({ candidate: c, index, value, preferred, setLabel, choose, zoom, disabled }) {
  const [failed, setFailed] = useState(false);
  const [thumbnail, setThumbnail] = useState(false);
  const fallback = c.thumbnail_url && c.thumbnail_url !== c.image_url;
  return <article className={`training-photo ${value?.label || ''} ${preferred ? 'preferred' : ''}`}>
    <button className="training-photo-open" onClick={zoom} aria-label={`Enlarge photo ${index + 1}`}>
      {!failed ? <img src={thumbnail ? c.thumbnail_url : c.image_url} loading={index < 2 ? 'eager' : 'lazy'} decoding="async" alt={c.title || `Candidate ${index + 1}`}
        onError={() => { if (!thumbnail && fallback) setThumbnail(true); else setFailed(true); }} /> : <span>Image could not load<br />Try the source page</span>}
      <span className="training-photo-number">{index + 1}{preferred ? ' · Favourite ★' : ''}</span><span className="training-enlarge">Enlarge ↗</span>
    </button>
    <div className="training-photo-info">
      <strong>{c.source_domain}</strong>
      <small>{c.origins.join(' · ')} · {c.width && c.height ? `${c.width} × ${c.height}` : 'Dimensions unknown'}</small>
      {thumbnail && <small className="training-warning">Thumbnail only — verify the original before judging quality.</small>}
      {c.title && <p>{c.title}</p>}
      <div className="training-links"><External href={c.source_page_url}>Source page</External><External href={c.image_url}>Original image</External></div>
    </div>
    <fieldset className="training-labels" disabled={disabled} aria-label={`Assessment of photo ${index + 1}`}>
      <div className="training-photo-actions">
        <button aria-pressed={value?.label === 'acceptable'} onClick={() => setLabel(value?.label === 'acceptable' ? null : 'acceptable')}>✓ Usable</button>
        <button aria-pressed={preferred} onClick={choose}>★ Favourite</button>
      </div>
      <label className="training-reason-label">Unsuitable because…
        <select aria-label={`Reason photo ${index + 1} is unsuitable`} value={value?.label === 'unsuitable' ? value.reason : ''} onChange={(e) => setLabel(e.target.value ? 'unsuitable' : null, e.target.value)}>
          <option value="">Select a reason</option>{REJECTION_REASONS.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
      </label>
      <div className="training-photo-actions subtle">
        <button aria-pressed={value?.label === 'unsure'} onClick={() => setLabel(value?.label === 'unsure' ? null : 'unsure')}>Not sure</button>
        <button aria-pressed={value?.label === 'unavailable'} onClick={() => setLabel(value?.label === 'unavailable' ? null : 'unavailable')}>Can't view</button>
        {value && <button onClick={() => setLabel(null)}>Clear</button>}
      </div>
    </fieldset>
  </article>;
}

function demoCases() {
  return [1, 2, 3].map((n) => ({ case_id: `00000000-0000-4000-8000-00000000000${n}`, batch_id: 'demo', activity_id: `demo-${n}`, sequence: n,
    candidate_set_hash: `demo-${n}`, activity: { activity_name: ['Baby Sensory — demonstration', 'Mini Mozart — demonstration', 'London park — demonstration'][n - 1],
      category: 'Classes & clubs', address: 'London · test data only', description: 'A demonstration case for testing review controls. These are illustrations, not actual candidate photos. Nothing will be saved to the database.' },
    candidates: Array.from({ length: 24 }, (_, i) => ({ candidate_id: `demo-${i}`, image_url: `${import.meta.env.BASE_URL}images/park-placeholder.svg`, source_domain: 'Demo artwork', origins: ['Demo'], title: `Test image ${i + 1}` })) }));
}

export default function TrainingApp() {
  const [session, setSession] = useState(demo ? { user: { id: 'demo', email: 'demo@local' } } : null);
  const [authReady, setAuthReady] = useState(demo);
  const [batch, setBatch] = useState(null); const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState(params.get('case') || '');
  const [reviewCase, setReviewCase] = useState(null); const [draft, setDraft] = useState(emptyDraft);
  const [dirty, setDirty] = useState(false); const [savedAt, setSavedAt] = useState(null);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [shown, setShown] = useState(20); const [zoom, setZoom] = useState(null);
  const [filter, setFilter] = useState('pending'); const [search, setSearch] = useState('');
  const [online, setOnline] = useState(navigator.onLine); const [retry, setRetry] = useState(0);
  const cache = useRef(new Map()); const saveAttempt = useRef(null); const demoData = useRef(demo ? demoCases() : []);
  const isAdmin = demo || admins.has(session?.user?.email?.toLowerCase());

  useEffect(() => {
    if (demo || !supabase) { setAuthReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data, error: authError }) => { if (active) { setSession(data.session); setAuthReady(true); if (authError) setError(authError.message); } }).catch((e) => { if (active) { setError(e.message); setAuthReady(true); } });
    const { data } = supabase.auth.onAuthStateChange((_event, value) => { setSession(value); setAuthReady(true); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);

  useEffect(() => {
    if (!session || !isAdmin) return;
    let active = true; setLoading(true); setError('');
    const promise = demo ? Promise.resolve({ batch: { batch_id: 'demo', title: 'Demonstration review' }, cases: demoData.current.map((c) => ({ ...c, activity_name: c.activity.activity_name, review_status: 'pending', candidate_count: c.candidates.length })) })
      : api({ action: 'list', batch_id: params.get('batch') || undefined });
    promise.then((data) => { if (!active) return; setBatch(data.batch); setCases(data.cases);
      setSelected((id) => data.cases.some((c) => c.case_id === id) ? id : (data.cases.find((c) => c.review_status === 'pending') || data.cases[0])?.case_id || '');
    }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.user?.id, isAdmin, retry]);

  async function getCase(id) {
    if (!cache.current.has(id)) cache.current.set(id, demo ? Promise.resolve({ case: demoData.current.find((c) => c.case_id === id), review: null }) : api({ action: 'case', case_id: id }).catch((e) => { cache.current.delete(id); throw e; }));
    return cache.current.get(id);
  }
  useEffect(() => {
    if (!selected || !session || !isAdmin) return;
    let active = true; setLoading(true); setReviewCase(null); setDirty(false); setError(''); setShown(20); setZoom(null);
    getCase(selected).then((data) => {
      if (!active) return;
      setReviewCase(data.case); setSavedAt(data.review?.submitted_at || null);
      let value = draftFromReview(data.review);
      try { const local = JSON.parse(localStorage.getItem(draftKey(session.user.id, data.case)) || 'null');
        if (local && (!data.review?.submitted_at || local.updatedAt > data.review.submitted_at)) { value = local.draft; setDirty(true); setNotice('Restored your unfinished draft from this device.'); }
      } catch { /* Continue without browser persistence. */ }
      setDraft(value);
      const next = cases.filter((c) => c.review_status === 'pending' && c.case_id !== selected).slice(0, 2);
      next.forEach((c) => getCase(c.case_id).catch(() => {}));
      const link = new URL(window.location.href); link.searchParams.set('case', selected); if (batch) link.searchParams.set('batch', batch.batch_id); window.history.replaceState(null, '', link);
    }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected, session?.user?.id, isAdmin, retry]);

  useEffect(() => {
    if (!dirty || !reviewCase || !session) return;
    try { localStorage.setItem(draftKey(session.user.id, reviewCase), JSON.stringify({ updatedAt: new Date().toISOString(), draft })); }
    catch { setNotice('Device storage is unavailable. Keep this page open until you save.'); }
  }, [draft, dirty, reviewCase, session]);
  useEffect(() => { const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);

  function edit(change) { setDraft((old) => ({ ...old, ...change(old) })); setDirty(true); setError(''); }
  function label(id, value, reason = null) { edit((old) => { const labels = { ...old.labels }; if (value) labels[id] = { candidate_id: id, label: value, reason }; else delete labels[id];
    return { labels, preferred: old.preferred === id && value !== 'acceptable' ? null : old.preferred, ...(value === 'acceptable' ? { outcome: 'selected' } : {}) }; }); }
  function choose(id) { edit((old) => ({ preferred: old.preferred === id ? null : id, outcome: 'selected', labels: { ...old.labels, [id]: { candidate_id: id, label: 'acceptable', reason: null } } })); }
  function navigate(id) { if (saving || (dirty && !window.confirm('Leave this case? Unsaved labels stay as a draft on this device, but are not submitted.'))) return; setNotice(''); setSelected(id); window.scrollTo(0, 0); }

  async function save() {
    if (!reviewCase || saving) return;
    setError('');
    const body = { action: 'save', case_id: reviewCase.case_id, candidate_set_hash: reviewCase.candidate_set_hash,
      labels: Object.values(draft.labels), preferred_candidate_id: draft.preferred, outcome: draft.outcome, notes: draft.notes };
    const signature = JSON.stringify(body);
    if (saveAttempt.current?.signature !== signature) saveAttempt.current = { signature, request_id: crypto.randomUUID() };
    body.request_id = saveAttempt.current.request_id;
    try { validateTrainingReview(reviewCase, body); } catch (e) { setError(e.message); return; }
    setSaving(true);
    try {
      const result = demo ? { saved: true, submitted_at: new Date().toISOString() } : await api(body);
      if (!result.saved) throw Error('The server did not confirm your save. Please retry.');
      const time = result.submitted_at || new Date().toISOString();
      const status = ['selected', 'none_suitable'].includes(body.outcome) ? 'completed' : 'deferred';
      const updated = cases.map((c) => c.case_id === selected ? { ...c, review_status: status, outcome: body.outcome, submitted_at: time } : c);
      setCases(updated); setDirty(false); setSavedAt(time); saveAttempt.current = null;
      try { localStorage.removeItem(draftKey(session.user.id, reviewCase)); } catch { /* Already saved remotely. */ }
      cache.current.set(selected, Promise.resolve({ case: reviewCase, review: { ...body, submitted_at: time } }));
      setNotice(demo ? 'Demo saved locally only — no database changes.' : 'Review saved. Live listing images have not changed.');
      const next = updated.find((c) => c.sequence > reviewCase.sequence && c.review_status === 'pending') || updated.find((c) => c.review_status === 'pending');
      if (next) { setSelected(next.case_id); window.scrollTo(0, 0); } else setNotice('All pending cases are reviewed. You can revisit saved cases or return to those needing help.');
    } catch (e) { setError(`${e.message} Your labels have not been submitted; keep this page open or retry.`); }
    finally { setSaving(false); }
  }

  async function signIn() {
    try { sessionStorage.setItem(TRAINING_RETURN_KEY, window.location.href); } catch { /* The user can reopen the shared link after sign-in. */ }
    const { error: signInError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` } });
    if (signInError) setError(signInError.message);
  }
  const totals = { completed: cases.filter((c) => c.review_status === 'completed').length, deferred: cases.filter((c) => c.review_status === 'deferred').length };
  const counts = trainingLabelCounts(draft.labels);
  const matching = cases.filter((c) => (filter === 'all' || c.review_status === filter) && `${c.activity_name} ${c.address || ''}`.toLowerCase().includes(search.toLowerCase()));
  const a = reviewCase?.activity;
  const maps = a && (a.google_place_uri || a.google_link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.activity_name} ${a.address || ''}`)}${a.google_place_id ? `&query_place_id=${encodeURIComponent(a.google_place_id)}` : ''}`);

  return <div className="training-app">
    <header className="training-header"><div className="brand-lockup"><div className="brand-mark small">TO</div><div><span>Tiny Outings</span><strong>Help choose better images</strong></div></div>
      <nav><a href={`${import.meta.env.BASE_URL}?view=quick`}>Desktop queues</a>{session && !demo && <button onClick={() => { if (!dirty || window.confirm('Sign out? Your unfinished draft will stay on this device for this account.')) supabase.auth.signOut(); }}>Sign out</button>}</nav>
    </header>
    {!authReady ? <p className="training-message" role="status">Checking your sign-in…</p>
      : (!hasSupabaseConfig && !demo) || !session || !isAdmin ? <section className="training-login"><h1>Image training review</h1><p>Help us choose accurate, useful photos. Your labels train and test the selector; they do not change live listings.</p>
        <p>{!hasSupabaseConfig && !demo ? 'The sign-in service could not load. Please refresh.' : session && !isAdmin ? 'This tool is for approved administrators only.' : 'Sign in with your administrator Google account. You can review on your phone or laptop.'}</p>
        {!session && hasSupabaseConfig && <button className="training-primary" onClick={signIn}>Continue with Google</button>}{error && <p role="alert">{error}</p>}</section>
      : <main className="training-main">
        <section className="training-intro"><p className="training-kicker">{demo ? 'DEMO · no database writes' : 'Manual labels · no live image changes'}</p><h1>What should this activity look like?</h1>
          <div className="training-progress"><strong>{totals.completed} / {cases.length} reviewed</strong><span>{totals.deferred} need help</span><progress aria-label="Review progress" value={totals.completed} max={cases.length || 1} /></div>
          <details><summary>How to review — please read first</summary><ol>
            <li>Read the name, description, location and age information. If the identity is unclear, check the official website or Google Places.</li>
            <li>Mark <strong>Usable</strong> on every photo you inspect that accurately represents the activity and is clear enough for a large cover. For cafés, favour seating/interior/exterior; for classes, show the actual class experience, not a staff headshot or unrelated venue.</li>
            <li>Choose one <strong>Favourite</strong>. A photo must match the provider and activity. A shared branded class photo may work across branches; a photo of a different physical venue does not.</li>
            <li>For bad photos, choose an <strong>Unsuitable</strong> reason. Use <strong>Not sure</strong> for uncertain identity and <strong>Can't view</strong> for broken images. Neither counts as a rejection.</li>
            <li>Check the first 20 and use <strong>Show 20 more</strong> when useful. Unmarked images are not treated as bad. If none you checked works, choose that outcome; category artwork is the fallback. Then <strong>Save & next</strong>.</li>
          </ol><p>You can stop and return using this link. Saved reviews sync between devices; unfinished drafts stay on the current device. Previous model choices are hidden to avoid influencing your judgement.</p></details>
        </section>
        <div className="training-browser"><label>Cases<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="pending">Not reviewed</option><option value="all">All cases</option><option value="completed">Reviewed</option><option value="deferred">Need help</option></select></label>
          <label>Find a case<input type="search" placeholder="Name or location" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label>Jump to listing<select aria-label="Jump to listing" value={matching.some((c) => c.case_id === selected) ? selected : ''} onChange={(e) => e.target.value && navigate(e.target.value)} disabled={saving}><option value="">{matching.length} matching cases</option>{matching.map((c) => <option key={c.case_id} value={c.case_id}>{c.sequence}. {c.activity_name}{c.review_status !== 'pending' ? ` · ${c.review_status}` : ''}</option>)}</select></label>
        </div>
        {!online && <p className="training-banner" role="status">You're offline. Your draft stays on this device; reconnect before saving.</p>}
        {notice && <p className="training-banner" role="status">{notice}</p>}
        {error && <div className="training-error" role="alert">{error}{!reviewCase && <button onClick={() => setRetry((n) => n + 1)}>Retry loading</button>}</div>}
        {loading ? <p className="training-message" role="status">Loading review case…</p> : !reviewCase ? <p className="training-message">{batch ? 'No case selected.' : 'No review batch is available yet.'}</p> : <>
          <section className="training-activity"><p className="training-kicker">Case {reviewCase.sequence} of {cases.length} · {a.public_listing_status || 'Training example'} · {a.category}</p>
            <h2>{a.activity_name}</h2><p>{a.address || [a.location, a.borough, a.postcode].filter(Boolean).join(' · ')}</p>
            {(a.provider_name || a.organiser_name || a.age_range) && <p>{[a.provider_name || a.organiser_name, a.age_range].filter(Boolean).join(' · ')}</p>}
            <p className="training-description">{a.description || 'No description stored. Check the activity source before deciding.'}</p>
            {a.google_summary && <p><strong>Google Places:</strong> {a.google_summary}</p>}
            <div className="training-links"><External href={a.website || a.source_url}>Activity website</External><External href={a.organiser_website}>Organiser</External><External href={maps}>Google Places</External></div>
          </section>
          <div className="training-gallery-heading"><h2>Photo candidates</h2><span>{Math.min(shown, reviewCase.candidates.length)} of {reviewCase.candidates.length} · {Object.keys(draft.labels).length} labelled</span></div>
          <div className="training-gallery">{reviewCase.candidates.slice(0, shown).map((c, i) => <Photo key={c.candidate_id} candidate={c} index={i} value={draft.labels[c.candidate_id]} preferred={draft.preferred === c.candidate_id} disabled={saving}
            setLabel={(value, reason) => label(c.candidate_id, value, reason)} choose={() => choose(c.candidate_id)} zoom={() => setZoom(c)} />)}</div>
          {shown < reviewCase.candidates.length && <button className="training-load-more" onClick={() => setShown((n) => n + 20)}>Show 20 more ({reviewCase.candidates.length - shown} remaining)</button>}
          {!reviewCase.candidates.length && <p>No cached photos in this case. Choose “Need more images” below.</p>}
          <section className="training-outcome"><h2>Your decision</h2><label>Outcome<select value={draft.outcome} disabled={saving} onChange={(e) => edit(() => ({ outcome: e.target.value }))}>
            <option value="selected">I have chosen a favourite photo</option><option value="none_suitable">None I checked is suitable — use category art</option><option value="needs_candidates">Need more images / nothing viewable</option><option value="cannot_verify">I cannot verify this activity or its photos</option>
          </select></label><p>“None suitable” applies only to images you explicitly labelled. It does not reject unseen photos or change the live cover.</p>
            {draft.outcome === 'none_suitable' && <img className="training-category-preview" src={categoryIllustrationCandidate(a).image_url} alt="Illustrated category fallback" />}
            <label>Optional notes<textarea value={draft.notes} maxLength={2000} disabled={saving} placeholder="e.g. This is the wrong branch, or the website shows a different age group." onChange={(e) => edit(() => ({ notes: e.target.value }))} /></label>
          </section>
          <footer className="training-save-bar"><div><strong>{counts.acceptable} usable · {counts.unsuitable} unsuitable</strong><small>{dirty ? 'Unsubmitted draft · this device only' : savedAt ? 'Saved to review history' : 'No labels saved yet'}</small></div>
            <button className="training-primary" disabled={saving || !online} onClick={save}>{saving ? 'Saving…' : 'Save & next'}</button>
          </footer>
        </>}
      </main>}
    {zoom && <Zoom candidate={zoom} close={() => setZoom(null)} />}
  </div>;
}
