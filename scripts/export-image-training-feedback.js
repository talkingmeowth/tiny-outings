import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { firstJsonObject } from './lib/active-activity-reader.js';
import { prepareImageTrainingFeedback, diagnoseExistingImageChoices } from './lib/image-training-feedback.js';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'output/image-training-feedback');
mkdirSync(output, { recursive: true });
const sqlFile = resolve(output, 'export.sql');
writeFileSync(sqlFile, `select jsonb_build_object(
 'cases',(select coalesce(jsonb_agg(jsonb_build_object('case_id',case_id,'activity_id',activity_id,'dataset_split',dataset_split,'evaluation_group_key',evaluation_group_key,'candidate_set_hash',candidate_set_hash,'activity_snapshot',activity_snapshot)),'[]') from public.image_training_cases),
 'labels',(select coalesce(jsonb_agg(to_jsonb(e)-'reviewer_id'),'[]') from public.image_training_labelled_examples e),
 'progress',(select coalesce(jsonb_agg(jsonb_build_object('case_id',case_id,'review_status',review_status)),'[]') from public.image_training_case_progress)
) as feedback;`);
const result = process.platform === 'win32'
  ? spawnSync('powershell.exe', ['-NoProfile', '-Command', `npx.cmd supabase db query --linked --output json --file '${sqlFile.replaceAll("'", "''")}'`], { cwd: root, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 })
  : spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--output', 'json', '--file', sqlFile], { cwd: root, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
if (result.status !== 0) throw Error(result.stderr || 'Could not read saved labels.');
const raw = firstJsonObject(result.stdout)?.rows?.[0]?.feedback;
if (!raw) throw Error('Database did not return feedback.');
const feedback = { exported_at: new Date().toISOString(), ...prepareImageTrainingFeedback(raw) };
const snapshot = resolve(root, 'output/image-selection-v5/snapshot.json');
if (existsSync(snapshot)) {
  const previous = JSON.parse(readFileSync(snapshot, 'utf8'));
  feedback.previous_model_snapshot_at = previous.captured_at;
  feedback.development_diagnostic = diagnoseExistingImageChoices(feedback, previous.activities);
}
writeFileSync(resolve(output, 'feedback.json'), JSON.stringify(feedback, null, 2));
const s = feedback.summary;
writeFileSync(resolve(output, 'summary.md'), `# Saved manual image feedback\n\nExported ${feedback.exported_at}.\n\n${s.completed_cases} completed cases and ${s.deferred_cases} deferred cases; ${s.assessed_images} explicitly assessed images.\n\n- Training: ${s.training_images} labels (${s.training_labels.acceptable || 0} usable; ${s.training_labels.unsuitable || 0} unsuitable).\n- Calibration: ${s.calibration_images} labels.\n- Holdout: ${s.holdout_images} labels.\n- Uncertain/unavailable: ${s.uncertainty_images}; excluded from positive/negative training.\n- Additional split protection exclusions: ${s.excluded_for_split_protection}.\n\n${feedback.training_policy}\n\nDevelopment rejection reasons:\n\n${Object.entries(s.training_rejection_reasons).map(([k,v]) => `- ${k}: ${v}`).join('\n')}\n\nThis export is ready for the next supervised training experiment. It does not retrain or deploy a model, change live image choices, call SerpAPI, or claim measured accuracy improvement. The small reserved sample is not enough for reliable confidence-threshold performance estimates.\n`);
console.log(JSON.stringify({ ...s, output, development_diagnostic: feedback.development_diagnostic?.map(({ activity_name, previous_model_assessment, rejection_reason }) => ({ activity_name, previous_model_assessment, rejection_reason })) }, null, 2));
