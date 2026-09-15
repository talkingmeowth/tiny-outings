import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { edgeFunctionErrorMessage } from './functionErrors.js';
import { prepareActivities, preparedActivitiesForQueue, imageCandidateSections, storedImageCandidates, googlePlacesUrl, fullReviewUrl } from './reviewData.js';
import { categoryIllustrationCandidate } from './categoryIllustrations.js';
import { TRAINING_RETURN_KEY } from './trainingRoute.js';
import './missingImages.css';

const admins = new Set(['talkingmeowth06@gmail.com', 'talkingmeowtho6@gmail.com', 'benfielden@gmail.com']);
const demo = import.meta.env.DEV && new URLSearchParams(location.search).get('demo') === '1';
const demoRows = ['Baby Sensory', 'Local stay & play'].map((name, i) => ({ activity_id: `demo-${i}`, activity_name: name, category: 'Classes & clubs', address: 'London · demonstration only', public_listing_status: i ? 'draft' : 'published', archive: false,
  website_image_candidates: [{ image_url: `${import.meta.env.BASE_URL}images/park-placeholder.svg`, title: 'Demo candidate (artwork, not an actual photo)' }] }));
const safeLink = (v) => { try { const u = new URL(v); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
async function api(body, name = 'image-review-simple') {
  const result = await supabase.functions.invoke(name, { body });
  if (result.error || result.data?.error) throw Error(await edgeFunctionErrorMessage(result, 'Could not save. Please try again.'));
  return result.data;
}
function Link({ href, children }) { return safeLink(href) ? <a href={safeLink(href)} target="_blank" rel="noopener noreferrer">{children} ↗</a> : null; }
async function jpegUpload(file) {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type) || file.size > 12 * 1024 * 1024) throw Error('Choose a JPG, PNG, WebP or AVIF photo smaller than 12MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (Math.min(bitmap.width, bitmap.height) < 300 || bitmap.width * bitmap.height < 180000) throw Error('Choose a clearer photo, at least 300px on each side.');
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .9); // Decode/re-encode, stripping EXIF/location metadata.
  } finally { bitmap.close(); }
}
export default function MissingImagesApp() {
  const [session, setSession] = useState(demo ? { user: { email: 'demo@local' } } : null);
  const [authReady, setAuthReady] = useState(demo); const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true); const [loaded, setLoaded] = useState(false); const [detail, setDetail] = useState(null);
  const [skipped, setSkipped] = useState([]); const [choice, setChoice] = useState(null);
  const [upload, setUpload] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); const [revision, setRevision] = useState(0); const [zoom, setZoom] = useState(null);
  const [shown, setShown] = useState(20); const cache = useRef(new Map()); const dialog = useRef(null);
  const isAdmin = demo || admins.has(session?.user?.email?.toLowerCase());
  useEffect(() => {
    if (demo || !supabase) { setAuthReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => { if (active) { setSession(data.session); setAuthReady(true); if (error) setError(error.message); } }).catch((e) => { if (active) { setError(e.message); setAuthReady(true); } });
    const { data } = supabase.auth.onAuthStateChange((_event, value) => { setSession(value); setAuthReady(true); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!session || !isAdmin) return;
    let active = true; setLoading(true); setError('');
    (async () => {
      if (demo) return demoRows;
      const first = await api({ action: 'list', offset: 0 }); const result = [...first.activities];
      // Lightweight rows only. Candidate arrays are loaded for one listing,
      // never for every queue and never via another paid image search.
      for (let offset = first.next; offset !== null;) {
        const pages = await Promise.all([0,1,2,3].map((i) => api({ action: 'list', offset: offset + i * 300 })));
        for (const p of pages) result.push(...p.activities);
        offset = pages.some((p) => p.next === null) ? null : pages.at(-1).next;
      }
      return result;
    })().then((data) => { if (active) { setRows(data); setLoaded(true); } }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.user?.email, isAdmin, revision]);
  const missing = useMemo(() => preparedActivitiesForQueue(prepareActivities(rows), 'missing_images')
    .sort((a, b) => Number(b.public_listing_status === 'published') - Number(a.public_listing_status === 'published') || a.activity_name.localeCompare(b.activity_name)), [rows]);
  const current = missing.find((a) => !skipped.includes(a.activity_id));
  useEffect(() => {
    let active = true; setDetail(null); setChoice(null); setUpload(null); setShown(20); setError('');
    if (!current) return;
    const id = current.activity_id;
    if (!cache.current.has(id)) cache.current.set(id, demo ? Promise.resolve({ activity: demoRows.find((a) => a.activity_id === id) }) : api({ action: 'detail', activity_id: id }).catch((e) => { cache.current.delete(id); throw e; }));
    cache.current.get(id).then(({ activity }) => { if (active) setDetail(activity); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [current?.activity_id, revision]);
  useEffect(() => { if (zoom && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [zoom]);
  const candidates = useMemo(() => detail ? [...storedImageCandidates(detail), ...imageCandidateSections(detail).flatMap((s) => s.candidates)] : [], [detail]);
  async function save() {
    if (!detail || (!choice && !upload) || busy) return;
    setBusy(true); setError('');
    try {
      let result;
      if (demo) result = { reviewedImageUrl: upload || choice.image_url };
      else if (upload) result = await api({ action: 'upload', activity_id: detail.activity_id, expected_updated_at: detail.updated_at, jpeg_base64: upload.split(',')[1] });
      else result = await api({ action: 'select', activity_id: detail.activity_id, selection_kind: choice.selection_kind,
        source_field: choice.source_field, candidate_source: choice.candidate_source, candidate_index: choice.candidate_index,
        candidate_set_fetched_at: choice.candidate_source === 'codex_image_candidates' ? detail.codex_image_searched_at : choice.candidate_source === 'website_image_candidates' ? detail.website_image_candidates_fetched_at : detail.serpapi_image_candidates_fetched_at }, 'image-review-admin');
      setRows((all) => all.map((a) => a.activity_id === detail.activity_id ? { ...a, reviewed_image_url: result.reviewedImageUrl, use_category_image: false } : a));
      cache.current.delete(detail.activity_id); setNotice(`${detail.activity_name}: photo saved${demo ? ' (demo only)' : ''}.`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function signIn() {
    setError(''); try {
      sessionStorage.setItem(TRAINING_RETURN_KEY, `${location.origin}${import.meta.env.BASE_URL}?view=missing`);
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${import.meta.env.BASE_URL}` } }); if (error) throw error;
    } catch (e) { setError(e.message); }
  }
  return <div className="training-app missing-app">
    <header className="training-header"><strong>Tiny Outings · Missing images</strong><nav><a href={import.meta.env.BASE_URL}>All review tools</a>{session && <button onClick={() => { cache.current.clear(); setSkipped([]); setRevision((r) => r + 1); }} disabled={busy || loading}>Refresh</button>}</nav></header>
    <main className="training-main">
      {error && <div role="alert" className="missing-error">{error} <button onClick={() => { cache.current.clear(); setRevision((r) => r + 1); }}>Retry</button></div>}
      {notice && <p role="status">{notice}</p>}
      {!authReady ? <p>Checking sign-in…</p> : !session ? <><h1>Fill the gaps.</h1><p>Choose a photo or upload one. Save and move on.</p><button onClick={signIn} disabled={!supabase}>Sign in with Google</button></> : !isAdmin ? <p>Administrator access is required.</p> : <>
        <div className="missing-heading"><div><h1>Missing images</h1><p>{loading ? 'Loading listings…' : !loaded ? 'Queue not loaded — please retry.' : `${missing.length} need a photo · published listings first`}</p></div>
          {detail && <label className="missing-upload">Upload a photo<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy} onChange={async (e) => {
            const file = e.target.files?.[0]; if (!file) return; setBusy(true); setError('');
            try { const data = await jpegUpload(file); setUpload(data); setChoice(null); } catch (e) { setError(e.message); } finally { setBusy(false); }
            e.target.value = '';
          }} /></label>}
        </div>
        {!loading && loaded && !current ? <><h2>{missing.length ? 'All remaining items skipped for now.' : 'No missing images.'}</h2>{missing.length > 0 && <button onClick={() => setSkipped([])}>Show skipped listings</button>}</> : current && <>
          <section className="training-activity"><small>{current.public_listing_status === 'published' ? 'PUBLISHED' : 'DRAFT'} · {current.category}</small><h2>{current.activity_name}</h2><p>{current.address}</p>
            {detail?.description && <p>{detail.description}</p>}<div className="training-links"><Link href={detail?.organiser_website || detail?.website}>Website</Link><Link href={detail ? googlePlacesUrl(detail) : ''}>Google Places</Link>
              <Link href={fullReviewUrl(location.href, current.activity_id, 'missing_images')}>Full review</Link></div>
          </section>
          {!detail ? <p role="status">Loading stored image options…</p> : <>
            {upload && <div className="missing-preview"><img src={upload} alt="Your uploaded photo, ready to save" /><button onClick={() => setUpload(null)} disabled={busy}>Remove upload</button></div>}
            <div className="training-gallery-heading"><h2>Choose a photo</h2><span>{candidates.length} stored options · source shown below each image</span></div>
            {!candidates.length && <p>No stored candidates. Upload a photo, or use full review to find more.</p>}
            <div className="training-gallery">{candidates.slice(0, shown).map((c, i) => <article key={`${c.source_field}-${i}`} className={`training-photo ${choice === c ? 'preferred' : ''}`}>
              <button className="training-photo-open" disabled={busy} aria-label={`Select photo ${i + 1}`} aria-pressed={choice === c} onClick={() => { setChoice(c); setUpload(null); }}>
                <img src={c.thumbnail_url || c.image_url} alt={c.title || `Photo ${i + 1}`} loading={i < 4 ? 'eager' : 'lazy'} onError={(e) => { e.currentTarget.style.opacity = '.15'; }} />
                <span className="training-photo-number">{choice === c ? '✓ Selected' : i + 1}</span>
              </button><div className="training-photo-info"><strong>{c.source_label}</strong><small>{c.source_domain} {c.width && c.height ? `· ${c.width} × ${c.height}` : ''}</small><p>{c.title}</p>
                <div className="training-links"><button onClick={() => setZoom(c)}>View large</button><Link href={c.source_page_url}>Source</Link></div></div>
            </article>)}</div>
            {shown < candidates.length && <button className="missing-more" onClick={() => setShown((n) => n + 20)}>Show 20 more</button>}
            <details className="missing-art"><summary>Category artwork fallback</summary><img src={categoryIllustrationCandidate(detail).image_url} alt="Category artwork" /><p>Artwork stays visible until a photo is saved. Skipping does not change the listing.</p></details>
            <footer className="missing-actions"><button disabled={busy} onClick={() => { setSkipped((s) => [...s, detail.activity_id]); setNotice('Skipped for now. No image changed.'); }}>Skip for now</button>
              <button className="missing-save" disabled={busy || (!choice && !upload)} onClick={save}>{busy ? 'Saving…' : 'Save photo & next'}</button></footer>
          </>}
        </>}
      </>}
    </main>
    {zoom && <dialog className="training-zoom" ref={dialog} onCancel={() => setZoom(null)} onClick={(e) => { if (e.target === dialog.current) setZoom(null); }}><button className="training-zoom-close" autoFocus onClick={() => setZoom(null)}>Close ×</button><img src={zoom.image_url} alt={zoom.title || 'Full size candidate'} /><Link href={zoom.source_page_url}>Open source</Link></dialog>}
  </div>;
}
