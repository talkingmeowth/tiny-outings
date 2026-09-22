import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { edgeFunctionErrorMessage } from './functionErrors.js';
import { mergeProposalPage, remainingProposalPageOffsets } from './proposalQueue.js';

const admins = new Set(['talkingmeowth06@gmail.com', 'talkingmeowtho6@gmail.com', 'benfielden@gmail.com']);
const safeUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
async function api(body) {
  const response = await supabase.functions.invoke('image-model-review', { body });
  if (response.error || response.data?.error) throw Error(await edgeFunctionErrorMessage(response, 'Review service unavailable.'));
  return response.data;
}
function External({ href, children }) { return safeUrl(href) ? <a href={safeUrl(href)} target="_blank" rel="noopener noreferrer">{children} ↗</a> : null; }
function Metadata({ image }) {
  if (!image) return <p>No photo was proposed for this activity.</p>;
  return <>{image.model_assessed === false && <p className="warning">This alternative was not visually ranked by the model. Check it carefully.</p>}
    {image.quality_gate_reasons?.length > 0 && <p className="warning">Model quality warnings: {image.quality_gate_reasons.join(', ')}</p>}
    <dl className="metadata">
    {Object.entries({ Source: image.source_field || image.candidate_source, Domain: image.source_domain, Title: image.title, Alt: image.alt,
      Dimensions: image.width && image.height ? `${image.width} × ${image.height} px` : null, Position: image.source_position,
      'Website kind': image.source_kind, 'Metadata score': image.metadata_score }).map(([key, value]) =>
      <div key={key}><dt>{key}</dt><dd>{value === null || value === undefined || value === '' ? '—' : String(value)}</dd></div>)}
  </dl><div className="links"><External href={image.image_url}>{image.submitted_original_url ? 'Stored image' : 'Original image'}</External><External href={image.submitted_original_url || image.source_page_url}>{image.submitted_original_url ? 'Submitted URL' : 'Hosting page'}</External></div>
    <details><summary>All image metadata</summary><pre>{JSON.stringify(image, null, 2)}</pre></details></>;
}
export default function ReviewApp() {
  const [session, setSession] = useState(null); const [authReady, setAuthReady] = useState(false);
  const [batch, setBatch] = useState(null); const [rows, setRows] = useState([]); const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(''); const [detail, setDetail] = useState(null);
  const [chosenUrl, setChosenUrl] = useState(''); const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [alternatives, setAlternatives] = useState([]); const [alternativeTotal, setAlternativeTotal] = useState(null);
  const [alternativesBusy, setAlternativesBusy] = useState(false);
  const [preparedAssets, setPreparedAssets] = useState(() => new Map());
  const [submittedUrl, setSubmittedUrl] = useState('');
  const [filter, setFilter] = useState('all'); const [reviewFilter, setReviewFilter] = useState('pending');
  const [search, setSearch] = useState(''); const [shown, setShown] = useState(60);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const queueScrollPosition = useRef(0);
  const detailCache = useRef(new Map());
  const detailPromises = useRef(new Map());
  const alternativesCache = useRef(new Map());
  const prepareRequested = useRef(new Set());
  const detailRequest = useRef(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const isAdmin = admins.has(session?.user?.email?.toLowerCase());
  useEffect(() => {
    if (!supabase) { setError('Review configuration unavailable.'); setAuthReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setAuthReady(true); } })
      .catch((e) => { if (active) { setError(e.message); setAuthReady(true); } });
    const { data } = supabase.auth.onAuthStateChange((_event, value) => { setSession(value); setAuthReady(true); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!session || !isAdmin) return;
    let active = true; setError(''); setLoaded(false);
    (async () => {
      const firstPage = await api({ action: 'bootstrap' });
      const latest = firstPage.batch;
      if (!latest) return { latest, proposals: [] };
      if (active) setBatch(latest);
      let proposals = mergeProposalPage([], firstPage.proposals);
      if (active) { setRows(proposals); setLoaded(true); }
      const offsets = remainingProposalPageOffsets(firstPage.total, firstPage.next, 800);
      if (offsets.length) {
        const pages = await Promise.all(offsets.map((offset) => api({ action: 'list', batch_id: latest.batch_id,
          offset, limit: 800, include_total: false })));
        proposals = pages.reduce((all, page) => mergeProposalPage(all, page.proposals), proposals);
      }
      return { latest, proposals };
    })().then(({ latest, proposals }) => { if (active) { setBatch(latest); setRows(proposals); setLoaded(true); } })
      .catch((e) => { if (active) { setError(e.message); setLoaded(true); } });
    return () => { active = false; };
  }, [session, isAdmin]);
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => rows.filter((row) => {
    const activity = row.activity_snapshot || {};
    return (filter === 'all' || activity.public_listing_status === filter)
      && (reviewFilter === 'all' || row.decision === reviewFilter)
      && `${activity.activity_name} ${activity.category} ${activity.address}`.toLowerCase().includes(deferredSearch.toLowerCase());
  }), [rows, filter, reviewFilter, deferredSearch]);
  const batchId = batch?.batch_id;
  useEffect(() => {
    if (!batchId || !rows.length || (selectedId && filtered.some((row) => row.activity_id === selectedId))) return;
    setSelectedId((filtered.find((row) => row.decision === 'pending') || filtered[0])?.activity_id || '');
  }, [batchId, rows, filtered, selectedId]);
  useEffect(() => {
    if (!selectedId || !batchId) { setDetail(null); return; }
    const cacheKey = `${batchId}:${selectedId}`;
    const requestId = ++detailRequest.current;
    const cached = detailCache.current.get(cacheKey);
    const cachedAlternatives = alternativesCache.current.get(cacheKey);
    setDetail(cached || null); setAlternativesOpen(false); setSubmittedUrl('');
    setAlternatives(cachedAlternatives?.items || []); setAlternativeTotal(cachedAlternatives?.total ?? null);
    if (cached) {
      setChosenUrl(cached.chosen_image?.image_url || cached.selected_image?.image_url || '');
      return;
    }
    let active = true;
    let pending = detailPromises.current.get(cacheKey);
    if (!pending) {
      pending = api({ action: 'detail', batch_id: batchId, activity_id: selectedId })
        .then(({ proposal }) => { detailCache.current.set(cacheKey, proposal); return proposal; })
        .finally(() => detailPromises.current.delete(cacheKey));
      detailPromises.current.set(cacheKey, pending);
    }
    pending
      .then((proposal) => { if (active && detailRequest.current === requestId) { setDetail(proposal); setChosenUrl(proposal.chosen_image?.image_url || proposal.selected_image?.image_url || ''); } })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [batchId, selectedId]);
  useEffect(() => {
    if (!batchId || !selectedId || !rows.length) return;
    const currentIndex = rows.findIndex((row) => row.activity_id === selectedId);
    const next = rows.slice(currentIndex + 1).find((row) => row.decision === 'pending')
      || rows.find((row) => row.activity_id !== selectedId && row.decision === 'pending');
    if (!next) return;
    const cacheKey = `${batchId}:${next.activity_id}`;
    if (detailCache.current.has(cacheKey) || detailPromises.current.has(cacheKey)) return;
    const pending = api({ action: 'detail', batch_id: batchId, activity_id: next.activity_id })
      .then(({ proposal }) => { detailCache.current.set(cacheKey, proposal); return proposal; })
      .catch(() => null).finally(() => detailPromises.current.delete(cacheKey));
    detailPromises.current.set(cacheKey, pending);
  }, [batchId, selectedId, rows]);
  useEffect(() => {
    if (!batchId || !selectedId || !rows.length) return;
    const currentIndex = Math.max(0, rows.findIndex((row) => row.activity_id === selectedId));
    const reviewWindow = [...rows.slice(currentIndex), ...rows.slice(0, currentIndex)]
      .filter((row) => row.decision === 'pending' && row.selected_image?.image_url)
      .slice(0, 4);
    const candidates = reviewWindow
      .filter((row) => !row.selected_image.image_url.includes('/storage/v1/object/public/activity-images/'))
      .filter((row) => !preparedAssets.has(row.selected_image.image_url)
        && !prepareRequested.current.has(row.activity_id));
    if (!candidates.length) return;
    candidates.forEach((row) => prepareRequested.current.add(row.activity_id));
    api({ action: 'prepare', batch_id: batchId, activity_ids: candidates.map((row) => row.activity_id) })
      .then(({ prepared = [] }) => setPreparedAssets((current) => {
        const next = new Map(current);
        prepared.forEach((asset) => { if (asset.status === 'ready' && asset.original_url && asset.stored_url) next.set(asset.original_url, asset.stored_url); });
        return next;
      }))
      .catch(() => candidates.forEach((row) => prepareRequested.current.delete(row.activity_id)));
  }, [batchId, selectedId, rows, preparedAssets]);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, mobileDetailOpen ? 0 : queueScrollPosition.current));
    return () => window.cancelAnimationFrame(frame);
  }, [mobileDetailOpen, selectedId]);
  async function decide(decision) {
    if (!detail || busy) return;
    const reviewed = detail;
    const next = filtered.find((row) => row.activity_id !== reviewed.activity_id && row.decision === 'pending');
    const advanceNow = reviewFilter === 'pending' && decision !== 'unsure' && Boolean(next);
    setBusy(true); setError(''); setNotice('');
    if (advanceNow) setSelectedId(next.activity_id);
    try {
      const result = await api({ action: 'decide', batch_id: reviewed.batch_id, activity_id: reviewed.activity_id,
        proposal_hash: reviewed.proposal_hash, decision, image_url: decision === 'approved' ? chosenUrl : null });
      const update = { decision, chosen_image: result.review.chosen_image };
      const updates = new Map((result.updated_proposals || [{ activity_id: reviewed.activity_id, ...update }])
        .map((item) => [item.activity_id, item]));
      setRows((old) => old.map((row) => updates.has(row.activity_id) ? { ...row, ...updates.get(row.activity_id) } : row));
      for (const [activityId, propagatedUpdate] of updates) {
        const cacheKey = `${reviewed.batch_id}:${activityId}`;
        const cached = detailCache.current.get(cacheKey);
        if (cached) detailCache.current.set(cacheKey, { ...cached, ...propagatedUpdate });
      }
      const reviewedUpdate = { ...reviewed, ...update };
      detailCache.current.set(`${reviewed.batch_id}:${reviewed.activity_id}`, reviewedUpdate);
      if (!advanceNow) setDetail(reviewedUpdate);
      setNotice(decision === 'approved'
        ? `Approved · ${result.propagated_count || 0} related listings also cleared from Pending · live card image updated where no higher-priority image exists`
        : `${decision} · live approval removed if this was the latest review`);
      if (reviewFilter === 'pending' && decision !== 'unsure') {
        if (advanceNow) {
          if (updates.has(next.activity_id)) setSelectedId('');
        } else if (next) setSelectedId(next.activity_id);
        else setMobileDetailOpen(false);
      }
    } catch (e) {
      if (advanceNow) setSelectedId(reviewed.activity_id);
      setError(e.message);
    } finally { setBusy(false); }
  }
  async function loadAlternatives() {
    if (!detail || alternativesBusy || alternatives.length >= (alternativeTotal ?? Infinity)) return;
    setAlternativesBusy(true);
    try {
      const page = await api({ action: 'alternatives', batch_id: detail.batch_id,
        activity_id: detail.activity_id, proposal_hash: detail.proposal_hash,
        offset: alternatives.length, limit: 24 });
      const byUrl = new Map(alternatives.map((image) => [image.image_url, image]));
      page.alternatives.forEach((image) => byUrl.set(image.image_url, image));
      const items = [...byUrl.values()];
      setAlternatives(items); setAlternativeTotal(page.total);
      alternativesCache.current.set(`${detail.batch_id}:${detail.activity_id}`, { items, total: page.total });
    } catch (e) { setError(e.message); } finally { setAlternativesBusy(false); }
  }
  function toggleAlternatives() {
    const opening = !alternativesOpen;
    setAlternativesOpen(opening);
    if (opening && alternatives.length === 0 && alternativeTotal !== 0) loadAlternatives();
  }
  async function submitImageUrl(event) {
    event.preventDefault();
    if (!detail || busy || !submittedUrl.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api({ action: 'submit_url', batch_id: detail.batch_id,
        activity_id: detail.activity_id, proposal_hash: detail.proposal_hash,
        image_url: submittedUrl.trim() });
      setDetail(result.proposal);
      detailCache.current.set(`${result.proposal.batch_id}:${result.proposal.activity_id}`, result.proposal);
      setChosenUrl(result.candidate.image_url);
      setAlternatives((current) => {
        const items = current.some((image) => image.image_url === result.candidate.image_url)
          ? current : [...current, result.candidate];
        const total = Math.max(alternativeTotal || 0, items.length);
        alternativesCache.current.set(`${result.proposal.batch_id}:${result.proposal.activity_id}`, { items, total });
        setAlternativeTotal(total);
        return items;
      });
      setSubmittedUrl('');
      setAlternativesOpen(true);
      setNotice('Image URL added and checked. Review the preview, then press Approve photo to use it in the app.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function archiveActivity() {
    if (!detail || busy) return;
    const targetId = detail.activity_id;
    const name = detail.activity_snapshot?.activity_name || 'this activity';
    if (!window.confirm(`Archive ${name}? It will disappear from the public app and this review queue.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { error: archiveError } = await supabase.rpc('archive_tiny_outings_activity', { target_activity_id: targetId });
      if (archiveError) throw archiveError;
      setRows((current) => current.filter((row) => row.activity_id !== targetId));
      detailCache.current.delete(`${detail.batch_id}:${targetId}`);
      setSelectedId((current) => current === targetId ? '' : current);
      setDetail(null);
      setMobileDetailOpen(false);
      setNotice(`${name} archived. It is no longer in the public app or review queue.`);
    } catch (e) { setError(`Could not archive activity: ${e.message}`); } finally { setBusy(false); }
  }
  async function signIn() {
    setError(''); const result = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${import.meta.env.BASE_URL}` } });
    if (result.error) setError(result.error.message);
  }
  const activity = detail?.activity_snapshot || {};
  const options = detail ? [detail.selected_image, ...alternatives].filter(Boolean) : [];
  const chosen = options.find((image) => image.image_url === chosenUrl)
    || (detail?.chosen_image?.image_url === chosenUrl ? detail.chosen_image : detail?.selected_image);
  const imageSrc = (image) => preparedAssets.get(image?.image_url) || image?.image_url || '';
  const nextPending = filtered.find((row) => row.activity_id !== selectedId && row.decision === 'pending');
  const counts = Object.fromEntries(['all', 'published', 'draft'].map((key) => [key, rows.filter((row) => key === 'all' || row.activity_snapshot?.public_listing_status === key).length]));
  return <div className={`review-app ${mobileDetailOpen ? 'mobile-detail-open' : ''}`}><header className="topbar"><div><small>TINY OUTINGS · INTERNAL</small><h1>Image review</h1></div><div className="topright"><span>{busy ? 'Saving previous review…' : 'Approved photos go live'}</span>{session && <button onClick={() => supabase.auth.signOut()}>Sign out</button>}</div></header>
    {error && <div className="alert" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {!authReady ? <main className="empty">Checking sign-in…</main> : !session ? <main className="empty"><h2>Admin sign-in</h2><p>Approved photos become live unless a higher-priority admin image is set.</p><button className="primary" onClick={signIn}>Sign in with Google</button></main> : !isAdmin ? <main className="empty">Administrator access is required.</main> : <>
      <nav className="filters" aria-label="Publication filter">{[['all', 'All'], ['published', 'Published'], ['draft', 'Drafts']].map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => { queueScrollPosition.current = 0; setFilter(key); setShown(60); setMobileDetailOpen(false); }}>{label} <strong>{counts[key]}</strong></button>)}
        <label>Review state <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}><option value="pending">Pending</option><option value="all">All</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="unsure">Unsure</option></select></label>
        <label>Find activity <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, address, category" /></label></nav>
      {!batch && loaded ? <main className="empty"><h2>No model batch yet</h2><p>Proposals will appear after inference finishes.</p></main> : <main className="workspace"><aside className="queue"><div className="queue-title"><strong>{filtered.length} matching</strong><small>{loaded ? `Batch ${batch?.batch_id || 'loading'}` : `Loading ${rows.length}…`}</small></div>
        {filtered.slice(0, shown).map((row) => <button key={row.activity_id} className={`queue-row ${selectedId === row.activity_id ? 'selected' : ''}`} onClick={() => { queueScrollPosition.current = window.scrollY; setSelectedId(row.activity_id); setMobileDetailOpen(true); }}>
          <img src={preparedAssets.get(row.chosen_image?.image_url || row.selected_image?.image_url) || row.chosen_image?.image_url || row.selected_image?.image_url || '/images/family-outing-placeholder.svg'} alt="" loading="lazy" decoding="async" fetchPriority="low" /><span><strong>{row.activity_snapshot?.activity_name}</strong><small>{row.activity_snapshot?.public_listing_status} · {row.activity_snapshot?.category}</small><em>{row.decision === 'pending' ? row.status.replaceAll('_', ' ') : row.decision}</em></span></button>)}
        {shown < filtered.length && <button className="load-more" onClick={() => setShown((n) => n + 60)}>Show 60 more</button>}</aside>
        <section className="case-panel"><div className="mobile-case-nav"><button onClick={() => setMobileDetailOpen(false)}>← Queue</button><span>{activity.activity_name || 'Image review'}</span><button disabled={!nextPending} onClick={() => setSelectedId(nextPending.activity_id)}>Next →</button></div>{!detail ? <div className="empty"><h2>{selectedId ? 'Loading proposal…' : 'Choose an activity'}</h2><p>Approve, reject, or mark the proposed photo unsure.</p></div> : <>
          <div className="case-heading"><div><small>{activity.public_listing_status?.toUpperCase()} · {activity.category}</small><h2>{activity.activity_name}</h2><p>{activity.address || activity.borough}</p><div className="desktop-activity-details"><p>{activity.description}</p>{activity.age_suitability && <p>Age: {activity.age_suitability}</p>}{activity.google_summary && <p>Google Places: {activity.google_summary}</p>}</div><details className="mobile-activity-details"><summary>Activity context</summary><p>{activity.description}</p>{activity.age_suitability && <p>Age: {activity.age_suitability}</p>}{activity.google_summary && <p>Google Places: {activity.google_summary}</p>}</details></div><div className="case-links"><div className="links"><External href={activity.source_url || activity.website || activity.google_link || activity.google_place_uri}>Open activity page</External><External href={activity.website}>Provider website</External><External href={activity.google_place_uri || activity.google_link}>Google Places</External></div><button className="archive-activity" disabled={busy} onClick={archiveActivity}>Archive activity</button></div></div>
          <div className="proposal-layout"><div className="preview"><img src={imageSrc(chosen) || '/images/family-outing-placeholder.svg'} alt={chosen?.title || `Suggested cover for ${activity.activity_name}`} decoding="async" fetchPriority="high" /><small>{chosen ? chosen.submitted_original_url ? 'YOUR URL — NOT YET APPROVED' : chosen.propagated_brand_family ? 'APPROVED FOR SAME PROGRAMME' : chosen.propagated_across_locations ? 'APPROVED FOR SAME CLASS' : chosen.propagated_from_activity_id ? 'APPROVED FOR RELATED SESSION' : chosenUrl === detail.selected_image?.image_url ? 'MODEL CHOICE' : 'ALTERNATIVE SELECTED' : 'NO PHOTO PROPOSED'}</small></div>
            <div className="proposal-info"><h3>{chosen ? 'Selected image' : 'No suitable photo proposed'}</h3><p>{detail.assessed_count} assessed / {detail.candidate_count} stored candidates · {detail.model_version}</p>{detail.source_gaps?.length > 0 && <p className="warning">Incomplete sources: {detail.source_gaps.join(', ')}</p>}
              <button className="alternatives-toggle" disabled={alternativesBusy} onClick={toggleAlternatives}>{alternativesOpen ? 'Hide alternatives' : `Compare alternatives${alternativeTotal === null ? '' : ` (${alternativeTotal})`}`}</button>
              <form className="url-submission" onSubmit={submitImageUrl}><label htmlFor="review-image-url">Have a better photo? Paste its direct image URL</label><div><input id="review-image-url" type="url" inputMode="url" placeholder="https://example.com/photo.jpg" value={submittedUrl} onChange={(event) => setSubmittedUrl(event.target.value)} disabled={busy} required /><button type="submit" disabled={busy || !submittedUrl.trim()}>Add image URL</button></div><small>JPEG, PNG, WebP or AVIF · at least 300px per side · added for review, not live until approved.</small></form>
              <Metadata image={chosen} /><div className="actions"><button className="approve" disabled={busy || !chosen} onClick={() => decide('approved')}>Approve photo</button><button className="reject" disabled={busy} onClick={() => decide('rejected')}>Reject</button><button className="unsure" disabled={busy} onClick={() => { setAlternativesOpen(true); loadAlternatives(); decide('unsure'); }}>Unsure</button><button className="unsure" disabled={!nextPending || busy} onClick={() => setSelectedId(nextPending.activity_id)}>Next pending →</button></div>
              <p className="safety">Approved photos appear in the live app below existing admin and manual images. Pending, rejected and unsure choices do not.</p></div></div>
          {alternativesOpen && <section className="alternatives"><h3>Alternative images</h3><p>All saved non-human image options are available. Images load in small groups to keep review fast. Only model-ranked photos are marked as such.</p>{alternativesBusy && alternatives.length === 0 && <p>Loading alternatives…</p>}<div className="alternative-grid">{options.map((image, index) => <button key={`${image.image_url}-${index}`} className={chosenUrl === image.image_url ? 'selected' : ''} onClick={() => setChosenUrl(image.image_url)}><img src={imageSrc(image)} alt={image.title || `Alternative ${index + 1}`} loading="lazy" decoding="async" fetchPriority="low" /><strong>{index === 0 && detail.selected_image ? 'Model choice' : image.model_assessed ? `Model alternative ${index}` : `Other option ${index}`}</strong><small>{image.source_field || image.candidate_source} · {image.source_domain}</small>{image.quality_gate_reasons?.length > 0 && <small>⚠ {image.quality_gate_reasons.join(', ')}</small>}</button>)}</div>{alternatives.length < (alternativeTotal ?? alternatives.length) && <button className="load-more" disabled={alternativesBusy} onClick={loadAlternatives}>{alternativesBusy ? 'Loading…' : 'Show 24 more images'}</button>}</section>}
          <div className="mobile-actions" aria-label="Review actions"><button className="approve" disabled={busy || !chosen} onClick={() => decide('approved')}>Approve</button><button className="reject" disabled={busy} onClick={() => decide('rejected')}>Reject</button><button className="unsure" disabled={busy} onClick={() => { setAlternativesOpen(true); loadAlternatives(); decide('unsure'); }}>Unsure</button></div>
        </>}</section></main>}
    </>}
  </div>;
}
