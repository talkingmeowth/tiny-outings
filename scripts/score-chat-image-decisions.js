import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { validateChatDecision } from './lib/chat-image-decision.js';
const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,'output/chat-image-evaluation');
const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json')));
const feedback=JSON.parse(await readFile(resolve(root,'output/image-training-feedback/feedback.json')));
const labels=[...feedback.training_examples,...feedback.calibration_examples,...feedback.holdout_examples];
const results=[];
for(const entry of manifest.bundles) {
  let decision;
  try { decision=JSON.parse(await readFile(resolve(dirname(entry.path),'chat-decision.json'))); }
  catch(error) { if(error.code==='ENOENT') continue; throw error; }
  const bundle=JSON.parse(await readFile(entry.path));
  const receipt=await validateChatDecision(bundle,decision);
  const own=labels.filter(l=>l.activity_id===bundle.activity.activity_id);
  const label=own.find(l=>l.candidate.image_url===receipt.selected?.image_url);
  results.push({activity_id:bundle.activity.activity_id,activity_name:bundle.activity.activity_name,
    selected_url:receipt.selected?.image_url||null,confidence_score:receipt.confidence,reason:receipt.reason,
    readable:bundle.available.length,total_candidates:bundle.candidates.length,input_hash:bundle.input_hash,
    dataset_split:own[0]?.dataset_split,human_label:label?.label||(receipt.selected?'unlabelled':'abstained'),
    known_acceptable_exists:own.some(l=>l.label==='acceptable')});
}
function thresholds(rows) { return [.65,.75,.85,.9,.95].map(threshold=>{
  const chosen=rows.filter(r=>r.selected_url && r.confidence_score>=threshold);
  const scored=chosen.filter(r=>['acceptable','unsuitable'].includes(r.human_label));
  return {threshold,cases:rows.length,photos:chosen.length,coverage:rows.length?chosen.length/rows.length:null,
    labelled_photos:scored.length,acceptable:scored.filter(r=>r.human_label==='acceptable').length,
    unsuitable:scored.filter(r=>r.human_label==='unsuitable').length,unlabelled:chosen.length-scored.length};
});}
const report={assessed_in:'current Codex chat',separate_model_calls:0,live_image_writes:0,cases:results.length,
  prepared_but_not_assessed:manifest.bundles.length-results.length,results,thresholds:thresholds(results),
  reserved_thresholds:thresholds(results.filter(r=>['calibration','holdout'].includes(r.dataset_split))),
  limitations:'Small, deliberately selected diagnostic, not a population accuracy estimate. Partial labels and unreadable images limit evaluation. Confidence scores are uncalibrated. This conversation has already seen some feedback: not a pristine blind holdout. No unknown image is counted correct and abstentions are reported.'};
await writeFile(resolve(directory,'diagnostic.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({cases:results.length,thresholds:report.thresholds,prepared_but_not_assessed:report.prepared_but_not_assessed},null,2));
