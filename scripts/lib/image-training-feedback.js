import { activityImageFamilyKey, activityImageGroupKey } from '../../src/activityDuplicates.js';

const identityKeys = (row) => [row.evaluation_group_key,
  activityImageFamilyKey({ ...row.activity_snapshot, activity_id: row.activity_id }),
  activityImageGroupKey({ ...row.activity_snapshot, activity_id: row.activity_id })].filter(Boolean);
const imageKey = (value) => String(value || '').trim().replace(/^http:\/\//i, 'https://');

// This export deliberately does not turn a partial gallery review into a
// choose-one-from-the-entire-pool training example. Unknown images stay unknown.
export function prepareImageTrainingFeedback({ cases, labels, progress = [] }) {
  const byCase = new Map(cases.map((c) => [c.case_id, c]));
  const reserved = cases.filter((c) => c.dataset_split !== 'development');
  const protectedKeys = new Set(reserved.flatMap(identityKeys));
  const protectedPhotos = new Set(labels.filter((r) => r.dataset_split !== 'development').map((r) => imageKey(r.candidate.image_url)));
  const buckets = { training_examples: [], calibration_examples: [], holdout_examples: [], uncertain_or_unavailable: [], excluded_for_split_protection: [] };
  const seen = new Set();
  for (const row of labels) {
    const c = byCase.get(row.case_id);
    if (!c || row.dataset_split !== c.dataset_split || row.candidate_set_hash !== c.candidate_set_hash) throw Error('Stale case or mismatched dataset split.');
    if (!['acceptable', 'unsuitable', 'unsure', 'unavailable'].includes(row.label)) throw Error('Unknown review label.');
    if (!row.candidate?.candidate_id || !/^https?:\/\//i.test(row.candidate.image_url)) throw Error('Invalid candidate.');
    const id = `${row.case_id}:${row.review_id}:${row.candidate.candidate_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const example = { example_id: id, activity_id: row.activity_id, case_id: row.case_id, review_id: row.review_id,
      reviewed_at: row.submitted_at, evaluation_group_key: c.evaluation_group_key, dataset_split: row.dataset_split,
      activity: { ...row.activity_snapshot, activity_id: row.activity_id }, candidate: row.candidate,
      label: row.label, rejection_reason: row.reason || null, preferred: row.is_preferred === true,
      candidate_set_hash: row.candidate_set_hash, evidence_type: 'explicit_human_image_assessment' };
    if (row.label === 'unsure' || row.label === 'unavailable') buckets.uncertain_or_unavailable.push(example);
    else if (row.dataset_split === 'calibration') buckets.calibration_examples.push(example);
    else if (row.dataset_split === 'holdout') buckets.holdout_examples.push(example);
    else if (identityKeys(c).some((key) => protectedKeys.has(key)) || protectedPhotos.has(imageKey(row.candidate.image_url))) buckets.excluded_for_split_protection.push(example);
    else buckets.training_examples.push(example);
  }
  const counted = (field, rows) => rows.reduce((s, r) => ({ ...s, [r[field]]: (s[r[field]] || 0) + 1 }), {});
  return { format_version: 'explicit-image-feedback-v1', ...buckets,
    training_policy: 'Train only on training_examples. Multiple acceptable images are positives. Use only explicit unsuitable labels as negatives. Keep preferred as a separate ranking target. Do not label other candidates negative. Do not relabel these human judgements as LLM vision receipts.',
    protected_groups: reserved.map((c) => ({ activity_id: c.activity_id, evaluation_group_key: c.evaluation_group_key, identity_keys: identityKeys(c) })),
    summary: { completed_cases: progress.filter((r) => r.review_status === 'completed').length,
      deferred_cases: progress.filter((r) => r.review_status === 'deferred').length,
      assessed_images: seen.size, all_labels: counted('label', labels),
      training_images: buckets.training_examples.length, training_labels: counted('label', buckets.training_examples),
      calibration_images: buckets.calibration_examples.length, holdout_images: buckets.holdout_examples.length,
      uncertainty_images: buckets.uncertain_or_unavailable.length, excluded_for_split_protection: buckets.excluded_for_split_protection.length,
      training_rejection_reasons: counted('rejection_reason', buckets.training_examples.filter((r) => r.label === 'unsuitable')) } };
}

// Check old predictions without training on the new answers. A model photo
// absent from the explicitly labelled URLs is unknown, NOT an error/success.
export function diagnoseExistingImageChoices(feedback, activities) {
  const byActivity = new Map(activities.map((a) => [a.activity_id, a]));
  const grouped = new Map();
  for (const row of feedback.training_examples) {
    if (!grouped.has(row.activity_id)) grouped.set(row.activity_id, []);
    grouped.get(row.activity_id).push(row);
  }
  return [...grouped].map(([id, rows]) => {
    const activity = byActivity.get(id);
    const urls = new Set([activity?.model_selected_url, activity?.model_selected_original_url].filter(Boolean).map(imageKey));
    const matches = rows.filter((r) => urls.has(imageKey(r.candidate.image_url)));
    const decisions = new Set(matches.map((r) => r.label));
    return { activity_id: id, activity_name: rows[0].activity.activity_name,
      previous_model_assessment: !urls.size ? 'no_model_image' : decisions.size > 1 ? 'conflicting_variant_labels'
        : matches[0]?.label || 'not_explicitly_labelled', rejection_reason: matches.find((r) => r.label === 'unsuitable')?.rejection_reason || null,
      candidate_url_caveat: 'URL match only; visually re-encoded copies may not match. Development diagnostic, not a held-out performance estimate.' };
  });
}
