import { createHash } from 'node:crypto';
import { activityImageFamilyKey, activityImageGroupKey } from '../../src/activityDuplicates.js';

export const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const httpUrl = (value) => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
const domain = (value) => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; } };
export const stableUuid = (value) => { const h = hash(value); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const imageFields = ['admin_cover_image_url', 'reviewed_image_url', 'user_image_url', 'user_uploaded_image_url',
  'model_selected_url', 'model_selected_original_url', 'scraped_image_url', 'audit_image_url', 'audit_image_original_url',
  'organiser_website_downloaded_image', 'website_downloaded_image', 'wikimedia_image_url', 'website_image_url', 'listing_image_url'];

// No quality filtering and no scores/previous decisions are exposed to the reviewer.
// Every URL keeps all its provenance, but references are deliberately neutrally labelled.
export function trainingCandidates(activity, evidence = []) {
  const pool = new Map();
  function add(raw, origin) {
    if (typeof raw === 'string') raw = { image_url: raw };
    if (!raw) return;
    const imageUrl = httpUrl(raw.image_url || raw.original || raw.url);
    if (!imageUrl) return;
    const page = httpUrl(raw.source_page_url || raw.link || raw.page_url);
    const c = pool.get(imageUrl) || { candidate_id: hash(imageUrl).slice(0, 24), image_url: imageUrl,
      thumbnail_url: httpUrl(raw.thumbnail_url || raw.thumbnail), source_page_url: page,
      source_domain: domain(page) || domain(imageUrl), title: String(raw.title || raw.alt || '').slice(0, 400),
      width: Number(raw.width || raw.original_width) || null, height: Number(raw.height || raw.original_height) || null,
      origins: [] };
    if (!c.origins.includes(origin)) c.origins.push(origin);
    if (!c.source_page_url && page) { c.source_page_url = page; c.source_domain = domain(page); }
    pool.set(imageUrl, c);
  }
  for (const [field, label] of [['serpapi_image_candidates', 'Google Images'], ['website_image_candidates', 'Website'],
    ['organiser_website_image_candidates', 'Organiser website'], ['codex_image_candidates', 'Cached image search']]) {
    for (const c of Array.isArray(activity[field]) ? activity[field] : []) add(c, c.source_kind === 'organiser_website' ? 'Organiser website' : label);
  }
  for (const field of imageFields) add(activity[field], 'Saved activity photo');
  for (const row of evidence) for (const url of [row.image_url, row.original_image_url]) add({ image_url: url, source_page_url: row.source_page_url }, 'Saved activity photo');
  // Round-robin source groups, stable shuffled order within each group. This
  // stops 20 near-identical website variants hiding the other sources.
  const groups = new Map();
  for (const c of [...pool.values()].sort((a, b) => hash(activity.activity_id + a.candidate_id).localeCompare(hash(activity.activity_id + b.candidate_id)))) {
    const key = c.origins[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const lists = [...groups.entries()].sort(([a], [b]) => hash(activity.activity_id + a).localeCompare(hash(activity.activity_id + b))).map(([, list]) => list);
  const result = [];
  while (lists.some((list) => list.length)) for (const list of lists) if (list.length) result.push(list.shift());
  return result;
}

export function trainingContext(activity) {
  const keys = ['activity_name', 'description', 'category', 'address', 'postcode', 'borough', 'location', 'age_range',
    'provider_name', 'organiser_name', 'website', 'organiser_website', 'source_url', 'source_name', 'google_summary',
    'google_primary_type', 'google_place_id', 'google_place_uri', 'google_link', 'public_listing_status'];
  return Object.fromEntries(keys.map((key) => [key, activity[key] ?? null]));
}

export function buildTrainingBatch(snapshot, benchmark = {}, rejections = [], { batchId = 'image-training-2026-09', development = 200, calibration = 25, holdout = 25 } = {}) {
  const activities = snapshot.activities.filter((a) => !a.archive && ['published', 'draft'].includes(a.public_listing_status));
  const byId = new Map(activities.map((a) => [a.activity_id, a]));
  const evidenceById = new Map();
  for (const r of [...(snapshot.groundTruth || []), ...rejections]) {
    if (!evidenceById.has(r.activity_id)) evidenceById.set(r.activity_id, []);
    evidenceById.get(r.activity_id).push(r);
  }
  // Connected components prevent related locations/recurrences and shared
  // reference images appearing on both sides of the evaluation boundary.
  const parents = new Map(activities.map((a) => [a.activity_id, a.activity_id]));
  function root(id) { const p = parents.get(id); if (p !== id) parents.set(id, root(p)); return parents.get(id); }
  function union(a, b) { if (parents.has(a) && parents.has(b)) parents.set(root(a), root(b)); }
  const keys = new Map();
  for (const a of activities) {
    const values = [activityImageFamilyKey(a), activityImageGroupKey(a)].filter(Boolean);
    for (const r of evidenceById.get(a.activity_id) || []) for (const u of [r.image_url, r.original_image_url]) if (httpUrl(u)) values.push(`image:${httpUrl(u)}`);
    for (const key of values) { if (keys.has(key)) union(a.activity_id, keys.get(key)); else keys.set(key, a.activity_id); }
  }
  const known = new Set([...evidenceById.keys()].filter((id) => byId.has(id)).map(root));
  const old = new Map((benchmark.predictions?.baseline || []).map((p) => [p.activity_id, p]));
  const revised = new Map((benchmark.predictions?.revised || []).map((p) => [p.activity_id, p]));
  const rejected = new Set(rejections.map((r) => r.activity_id));
  function priority(a) {
    const b = old.get(a.activity_id); const r = revised.get(a.activity_id);
    if (rejected.has(a.activity_id)) return [100, 'Previously rejected model image'];
    if (b?.correct && r && !r.correct) return [95, 'Regression against existing reference'];
    if (/Fun For All|Baby Feeding Session|Get Together|Sutton Sports Village|mini mozart|monkey music|baby sensory/i.test(a.activity_name)) return [90, 'Reported semantic / shared-class risk'];
    if (b && r && b.image_url !== r.image_url) return [85, 'Model disagreement'];
    if (r && !r.retrieval) return [75, 'Reference missing from automatic pool'];
    if (!a.model_selected_url || a.use_category_image || Number(a.model_selected_confidence) < .65) return [70, 'Missing or low-confidence image'];
    if (/family hub|best start|better start|stay.*play/i.test(`${a.source_name} ${a.category}`)) return [60, 'Weak timetable / family-hub segment'];
    return [30, 'Cross-source coverage control'];
  }
  const used = new Set(); const chosen = [];
  function take(pool, count, split, ordered) {
    let list = [...pool].sort((a, b) => ordered ? priority(b)[0] - priority(a)[0] || hash(batchId + a.activity_id).localeCompare(hash(batchId + b.activity_id)) : hash(batchId + a.activity_id).localeCompare(hash(batchId + b.activity_id)));
    if (!ordered) { // Sample across importer/category strata, not alphabetical activity names.
      const strata = new Map();
      for (const a of list) { const k = `${a.category}|${a.source_name}`; if (!strata.has(k)) strata.set(k, []); strata.get(k).push(a); }
      list = []; while ([...strata.values()].some((v) => v.length)) for (const s of strata.values()) if (s.length) list.push(s.shift());
    }
    let n = 0; const categories = new Map(); const reasons = new Map();
    for (const a of list) {
      if (used.has(root(a.activity_id))) continue;
      if (ordered && (categories.get(a.category) || 0) >= Math.ceil(count * .3)) continue;
      const reason = priority(a)[1];
      const reasonLimit = reason === 'Model disagreement' ? .3 : reason === 'Reference missing from automatic pool' ? .175 : 1;
      if (ordered && (reasons.get(reason) || 0) >= Math.ceil(count * reasonLimit)) continue;
      used.add(root(a.activity_id)); categories.set(a.category, (categories.get(a.category) || 0) + 1);
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
      chosen.push({ activity: a, split, group: root(a.activity_id), reason: ordered ? priority(a)[1] : 'Previously unlabelled stratified evaluation sample' });
      if (++n === count) break;
    }
    if (n !== count) throw Error(`Only ${n}/${count} independent ${split} cases available.`);
  }
  const unseen = activities.filter((a) => !known.has(root(a.activity_id)));
  take(unseen, holdout, 'holdout', false);
  take(unseen, calibration, 'calibration', false);
  take(activities, development, 'development', true);
  // Interleave hidden evaluation cases with development cases to avoid a visible split.
  chosen.sort((a, b) => hash(`${batchId}:order:${a.activity.activity_id}`).localeCompare(hash(`${batchId}:order:${b.activity.activity_id}`)));
  const cases = chosen.map(({ activity, split, reason, group }, i) => {
    const context = trainingContext(activity);
    const candidates = trainingCandidates(activity, evidenceById.get(activity.activity_id) || []);
    return { case_id: stableUuid(batchId + activity.activity_id), batch_id: batchId, activity_id: activity.activity_id, sequence: i + 1,
      dataset_split: split, selection_reason: reason, activity_snapshot: context, candidates,
      candidate_set_hash: hash({ context, candidates }), evaluation_group_key: group };
  });
  return { batch_id: batchId, title: 'Help improve image selection', description: 'Review photos for the actual activity. Training only: your live listing images will not change.',
    snapshot_at: snapshot.captured_at, cases };
}
