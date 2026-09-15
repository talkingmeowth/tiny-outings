import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareChatImages } from './lib/astra-image-selector.js';
import { allImageCandidates, hasHumanImage, selectionContext } from '../supabase/functions/image-review-simple/policy.js';
import { imageDbQuery, sqlString } from './lib/image-chat-db.js';
const root = resolve(import.meta.dirname, '..');
const arg = (key) => { const i = process.argv.indexOf(key); return i < 0 ? null : process.argv[i + 1]; };
const evaluation = process.argv.includes('--evaluation');
const out = resolve(root, evaluation ? 'output/chat-image-evaluation' : 'output/chat-image-selection'); await mkdir(out, { recursive: true });
const limit = Math.max(1, Number(arg('--limit') || 20));
let cases;
if (evaluation) {
  const manifest = JSON.parse(await readFile(resolve(root, 'output/image-training-2026-09/manifest.json')));
  const feedback = JSON.parse(await readFile(resolve(root, 'output/image-training-feedback/feedback.json')));
  const labels = [...feedback.training_examples, ...feedback.calibration_examples, ...feedback.holdout_examples];
  const ids = new Set(labels.map((l) => l.case_id));
  cases = manifest.cases.filter((c) => ids.has(c.case_id)).slice(0, limit).map((c) => ({
    activity: { ...c.activity_snapshot, activity_id: c.activity_id }, candidates: c.candidates,
  })); // No answers, split assignments or previous model scores in the bundles.
} else {
  const after = arg('--created-after'); const id = arg('--activity-id');
  if (!after && !id && !process.argv.includes('--pending')) throw Error('Specify --created-after, --activity-id or --pending. No implicit historical backfill.');
  if (after && !Number.isFinite(Date.parse(after))) throw Error('Invalid --created-after timestamp.');
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw Error('Invalid activity ID.');
  const rows = imageDbQuery(root, `select to_jsonb(a) || jsonb_build_object('user_uploaded_image_url',(select photo_url from public.activity_photos p where p.activity_id=a.activity_id and p.source_provider='user_upload' order by created_at desc limit 1), 'user_uploaded_image_candidates', (select coalesce(jsonb_agg(jsonb_build_object('image_url',photo_url,'title',caption)),'[]') from public.activity_photos p where p.activity_id=a.activity_id and p.source_provider='user_upload')) as activity
    from public.activities a where not a.archive and a.public_listing_status in ('draft','published')
    ${after ? `and a.created_at >= ${sqlString(after)}::timestamptz` : ''} ${id ? `and a.activity_id=${sqlString(id)}::uuid` : ''}
    and not a.use_category_image and nullif(trim(a.admin_cover_image_url),'') is null and nullif(trim(a.reviewed_image_url),'') is null and nullif(trim(a.user_image_url),'') is null
    and not exists(select 1 from public.activity_photos p where p.activity_id=a.activity_id and p.source_provider='user_upload')
    and not exists(select 1 from public.activity_image_chat_reviews r where r.activity_id=a.activity_id and r.applied_at>=a.updated_at)
    order by a.created_at desc, a.activity_id limit ${Math.min(limit,1000)};`);
  cases = rows.map((r) => ({ activity: r.activity, candidates: allImageCandidates(r.activity) })).filter((c) => !hasHumanImage(c.activity));
}
const bundles = [];
for (const c of cases) {
  const b = await prepareChatImages(selectionContext(c.activity), c.candidates, { directory: out });
  b.expected_updated_at = c.activity.updated_at || null;
  await writeFile(resolve(out, b.input_hash, 'bundle.json'), JSON.stringify(b, null, 2));
  bundles.push({ activity_id: c.activity.activity_id, activity_name: c.activity.activity_name, input_hash: b.input_hash,
    path: resolve(out, b.input_hash, 'bundle.json'), sheets: b.sheets, status: b.status, readable: b.available.length, total: b.candidates.length });
}
const report = { prepared_at: new Date().toISOString(), assessment_channel: 'codex_chat', llm_calls: 0,
  status: 'awaiting_chat_review', evaluation_only: evaluation, maximum_cases: limit, prepared: bundles.length, bundles,
  note: 'Preparation is not inference. Open these sheets in the current Codex chat, inspect metadata and full-size finalists, then record and validate the chat decision. No API or separate model process is called. Remaining records stay eligible for --pending.' };
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(report, null, 2));
await mkdir(resolve(root, 'data'), { recursive: true });
if (!evaluation) await writeFile(resolve(root, 'data/chat_image_selection_queue.generated.json'), JSON.stringify(report, null, 2));
console.log(`Prepared ${bundles.length} cases for this chat; zero LLM/API calls. ${out}`);
