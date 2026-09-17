import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { edgeFunctionErrorMessage } from './functionErrors.js';
import { mergeProposalPage } from './proposalQueue.js';

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
  </dl><div className="links"><External href={image.image_url}>Original image</External><External href={image.source_page_url}>Hosting page</External></div>
    <details><summary>All image metadata</summary><pre>{JSON.stringify(image, null, 2)}</pre></details></>;
}
export default function ReviewApp() {
  const [session, setSession] = useState(null); const [authReady, setAuthReady] = useState(false);
  const [batch, setBatch] = useState(null); const [rows, setRows] = useState([]); const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(''); const [detail, setDetail] = useState(null);
  const [chosenUrl, setChosenUrl] = useState(''); const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [filter, setFilter] = useState('all'); const [reviewFilter, setReviewFilter] = useState('pending');
  const [search, setSearch] = useState(''); const [shown, setShown] = useState(100);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const queueScrollPosition = useRef(0);
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
      const { batch: latest } = await api({ action: 'batch' });
      if (!latest) return { latest, proposals: [] };
      if (active) setBatch(latest);
      let proposals = [];
      for (let offset = 0; ;) {
        const page = await api({ action: 'list', batch_id: latest.batch_id, offset });
        proposals = mergeProposalPage(proposals, page.proposals);
        if (active) setRows(proposals);
        if (page.next === null) break;
        offset = page.next;
      }
      return { latest, proposals };
    })().then(({ latest, proposals }) => { if (active) { setBatch(latest); setRows(proposals); setLoaded(true); } })
      .catch((e) => { if (active) { setError(e.message); setLoaded(true); } });
    return () => { active = false; };
  }, [session, isAdmin]);
  const filtered = useMemo(() => rows.filter((row) => {
    const activity = row.activity_snapshot || {};
    return (filter === 'all' || activity.public_listing_status === filter)
      && (reviewFilter === 'all' || row.decision === reviewFilter)
      && `${activity.activity_name} ${activity.category} ${activity.address}`.toLowerCase().includes(search.toLowerCase());
  }), [rows, filter, reviewFilter, search]);
  const batchId = batch?.batch_id;
  useEffect(() => {
    if (!batchId || !rows.length || (selectedId && filtered.some((row) => row.activity_id === selectedId))) return;
    setSelectedId((filtered.find((row) => row.decision === 'pending') || filtered[0])?.activity_id || '');
  }, [batchId, rows, filtered, selectedId]);
  useEffect(() => {
    if (!selectedId || !batchId) { setDetail(null); return; }
    let active = true; setDetail(null); setAlternativesOpen(false);
    api({ action: 'detail', batch_id: batchId, activity_id: selectedId })
      .then(({ proposal }) => { if (active) { setDetail(proposal); setChosenUrl(proposal.chosen_image?.image_url || proposal.selected_image?.image_url || ''); } })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [batchId, selectedId]);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, mobileDetailOpen ? 0 : queueScrollPosition.current));
    return () => window.cancelAnimationFrame(frame);
  }, [mobileDetailOpen, selectedId]);
  async function decide(decision) {
    if (!detail || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api({ action: 'decide', batch_id: detail.batch_id, activity_id: detail.activity_id,
        proposal_hash: detail.proposal_hash, decision, image_url: decision === 'approved' ? chosenUrl : null });
      const update = { decision, chosen_image: result.review.chosen_image };
      const updates = new Map((result.updated_proposals || [{ activity_id: detail.activity_id, ...update }])
        .map((item) => [item.activity_id, item]));
      setRows((old) => old.map((row) => updates.has(row.activity_id) ? { ...row, ...updates.get(row.activity_id) } : row));
      setDetail((old) => ({ ...old, ...update }));
      setNotice(decision === 'approved'
        ? `Approved · ${result.propagated_count || 0} matching time slots also cleared from Pending · live cards unchanged`
        : `${decision} · live card unchanged`);
      const next = filtered.find((row) => !updates.has(row.activity_id) && row.decision === 'pending');
      if (reviewFilter === 'pending' && decision !== 'unsure') {
        if (next) setSelectedId(next.activity_id);
        else setMobileDetailOpen(false);
      }
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
  const options = detail ? [detail.selected_image, ...(detail.alternatives || [])].filter(Boolean) : [];
  const chosen = options.find((image) => image.image_url === chosenUrl)
    || (detail?.chosen_image?.image_url === chosenUrl ? detail.chosen_image : detail?.selected_image);
  const nextPending = filtered.find((row) => row.activity_id !== selectedId && row.decision === 'pending');
  const counts = Object.fromEntries(['all', 'published', 'draft'].map((key) => [key, rows.filter((row) => key === 'all' || row.activity_snapshot?.public_listing_status === key).length]));
  return <div className={`review-app ${mobileDetailOpen ? 'mobile-detail-open' : ''}`}><header className="topbar"><div><small>TINY OUTINGS · INTERNAL</small><h1>Image review</h1></div><div className="topright"><span>Proposals only · not live</span>{session && <button onClick={() => supabase.auth.signOut()}>Sign out</button>}</div></header>
    {error && <div className="alert" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {!authReady ? <main className="empty">Checking sign-in…</main> : !session ? <main className="empty"><h2>Admin sign-in</h2><p>Review model choices without changing live images.</p><button className="primary" onClick={signIn}>Sign in with Google</button></main> : !isAdmin ? <main className="empty">Administrator access is required.</main> : <>
      <nav className="filters" aria-label="Publication filter">{[['all', 'All'], ['published', 'Published'], ['draft', 'Drafts']].map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => { queueScrollPosition.current = 0; setFilter(key); setShown(100); setMobileDetailOpen(false); }}>{label} <strong>{counts[key]}</strong></button>)}
        <label>Review state <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}><option value="pending">Pending</option><option value="all">All</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="unsure">Unsure</option></select></label>
        <label>Find activity <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, address, category" /></label></nav>
      {!batch && loaded ? <main className="empty"><h2>No model batch yet</h2><p>Proposals will appear after inference finishes.</p></main> : <main className="workspace"><aside className="queue"><div className="queue-title"><strong>{filtered.length} matching</strong><small>{loaded ? `Batch ${batch?.batch_id || 'loading'}` : `Loading ${rows.length}…`}</small></div>
        {filtered.slice(0, shown).map((row) => <button key={row.activity_id} className={`queue-row ${selectedId === row.activity_id ? 'selected' : ''}`} onClick={() => { queueScrollPosition.current = window.scrollY; setSelectedId(row.activity_id); setMobileDetailOpen(true); }}>
          <img src={row.chosen_image?.image_url || row.selected_image?.image_url || '/images/family-outing-placeholder.svg'} alt="" loading="lazy" /><span><strong>{row.activity_snapshot?.activity_name}</strong><small>{row.activity_snapshot?.public_listing_status} · {row.activity_snapshot?.category}</small><em>{row.decision === 'pending' ? row.status.replaceAll('_', ' ') : row.decision}</em></span></button>)}
        {shown < filtered.length && <button className="load-more" onClick={() => setShown((n) => n + 100)}>Show 100 more</button>}</aside>
        <section className="case-panel"><div className="mobile-case-nav"><button onClick={() => setMobileDetailOpen(false)}>← Queue</button><span>{activity.activity_name || 'Image review'}</span><button disabled={!nextPending} onClick={() => setSelectedId(nextPending.activity_id)}>Next →</button></div>{!detail ? <div className="empty"><h2>{selectedId ? 'Loading proposal…' : 'Choose an activity'}</h2><p>Approve, reject, or mark the proposed photo unsure.</p></div> : <>
          <div className="case-heading"><div><small>{activity.public_listing_status?.toUpperCase()} · {activity.category}</small><h2>{activity.activity_name}</h2><p>{activity.address || activity.borough}</p><div className="desktop-activity-details"><p>{activity.description}</p>{activity.age_suitability && <p>Age: {activity.age_suitability}</p>}{activity.google_summary && <p>Google Places: {activity.google_summary}</p>}</div><details className="mobile-activity-details"><summary>Activity context</summary><p>{activity.description}</p>{activity.age_suitability && <p>Age: {activity.age_suitability}</p>}{activity.google_summary && <p>Google Places: {activity.google_summary}</p>}</details></div><div className="case-links"><div className="links"><External href={activity.source_url || activity.website || activity.google_link || activity.google_place_uri}>Open activity page</External><External href={activity.website}>Provider website</External><External href={activity.google_place_uri || activity.google_link}>Google Places</External></div><button className="archive-activity" disabled={busy} onClick={archiveActivity}>Archive activity</button></div></div>
          <div className="proposal-layout"><div className="preview"><img src={chosen?.image_url || '/images/family-outing-placeholder.svg'} alt={chosen?.title || `Suggested cover for ${activity.activity_name}`} /><small>{chosen ? chosen.propagated_from_activity_id ? 'APPROVED FOR RELATED SESSION' : chosenUrl === detail.selected_image?.image_url ? 'MODEL CHOICE' : 'ALTERNATIVE SELECTED' : 'NO PHOTO PROPOSED'}</small></div>
            <div className="proposal-info"><h3>{chosen ? 'Selected image' : 'No suitable photo proposed'}</h3><p>{detail.assessed_count} assessed / {detail.candidate_count} stored candidates · {detail.model_version}</p>{detail.source_gaps?.length > 0 && <p className="warning">Incomplete sources: {detail.source_gaps.join(', ')}</p>}
              <button className="alternatives-toggle" onClick={() => setAlternativesOpen((value) => !value)}>{alternativesOpen ? 'Hide alternatives' : `Compare alternatives (${options.length - (detail.selected_image ? 1 : 0)})`}</button>
              <Metadata image={chosen} /><div className="actions"><button className="approve" disabled={busy || !chosen} onClick={() => decide('approved')}>Approve photo</button><button className="reject" disabled={busy} onClick={() => decide('rejected')}>Reject</button><button className="unsure" disabled={busy} onClick={() => { setAlternativesOpen(true); decide('unsure'); }}>Unsure</button><button className="unsure" disabled={!nextPending || busy} onClick={() => setSelectedId(nextPending.activity_id)}>Next pending →</button></div>
              <p className="safety">Decisions are saved for review only. They never update the live activity image.</p></div></div>
          {alternativesOpen && <section className="alternatives"><h3>Alternative images</h3><p>All saved non-human image options are shown. Only model-ranked photos are marked as such. Approving one records your choice without changing the live card.</p><div className="alternative-grid">{options.map((image, index) => <button key={`${image.image_url}-${index}`} className={chosenUrl === image.image_url ? 'selected' : ''} onClick={() => setChosenUrl(image.image_url)}><img src={image.image_url} alt={image.title || `Alternative ${index + 1}`} loading="lazy" /><strong>{index === 0 && detail.selected_image ? 'Model choice' : image.model_assessed ? `Model alternative ${index}` : `Other option ${index}`}</strong><small>{image.source_field || image.candidate_source} · {image.source_domain}</small>{image.quality_gate_reasons?.length > 0 && <small>⚠ {image.quality_gate_reasons.join(', ')}</small>}</button>)}</div></section>}
          <div className="mobile-actions" aria-label="Review actions"><button className="approve" disabled={busy || !chosen} onClick={() => decide('approved')}>Approve</button><button className="reject" disabled={busy} onClick={() => decide('rejected')}>Reject</button><button className="unsure" disabled={busy} onClick={() => { setAlternativesOpen(true); decide('unsure'); }}>Unsure</button></div>
        </>}</section></main>}
    </>}
  </div>;
}
