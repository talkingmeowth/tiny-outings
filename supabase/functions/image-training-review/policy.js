export const TRAINING_LABELS = ['acceptable', 'unsuitable', 'unsure', 'unavailable'];
export const REJECTION_REASONS = [
  ['wrong_activity', 'Wrong activity'], ['wrong_location', 'Wrong place / branch'],
  ['wrong_provider', 'Wrong provider'], ['logo_graphic', 'Logo, poster or graphic'],
  ['poor_quality', 'Blurry / too small'], ['poor_representation', 'Does not show the experience'],
  ['other', 'Other'],
];
export const TRAINING_OUTCOMES = ['selected', 'none_suitable', 'needs_candidates', 'cannot_verify'];

export function validateTrainingReview(reviewCase, input) {
  if (input.candidate_set_hash !== reviewCase.candidate_set_hash) throw Error('This case changed. Reload it before saving.');
  if (!TRAINING_OUTCOMES.includes(input.outcome)) throw Error('Choose a review outcome.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.request_id || '')) throw Error('Missing save identifier.');
  if (!Array.isArray(input.labels) || input.labels.length > reviewCase.candidates.length) throw Error('Invalid image labels.');
  const candidates = new Map(reviewCase.candidates.map((c) => [c.candidate_id, c]));
  const seen = new Set();
  const labels = input.labels.map((row) => {
    if (!candidates.has(row.candidate_id) || seen.has(row.candidate_id)) throw Error('An image does not belong to this case or was labelled twice.');
    seen.add(row.candidate_id);
    if (!TRAINING_LABELS.includes(row.label)) throw Error('Choose a valid image label.');
    if (row.label === 'unsuitable' && !REJECTION_REASONS.some(([key]) => key === row.reason)) throw Error('Give a reason for each unsuitable image.');
    return { candidate_id: row.candidate_id, label: row.label, reason: row.label === 'unsuitable' ? row.reason : null };
  });
  const accepted = labels.filter((r) => r.label === 'acceptable');
  const preferred = input.preferred_candidate_id || null;
  if (input.outcome === 'selected' && (!preferred || !accepted.some((r) => r.candidate_id === preferred))) throw Error('Mark a photo usable and choose your favourite.');
  if (input.outcome !== 'selected' && (preferred || accepted.length)) throw Error('Save your usable photo choices, or clear them before choosing no suitable photo.');
  if (input.outcome === 'none_suitable' && !labels.some((r) => r.label === 'unsuitable')) throw Error('Label the unsuitable photos first; use “Need more images” if nothing loads.');
  return { request_id: input.request_id, labels, preferred_candidate_id: preferred, outcome: input.outcome,
    notes: String(input.notes || '').trim().slice(0, 2000), candidate_set_hash: input.candidate_set_hash };
}

export function trainingLabelCounts(labels) {
  return TRAINING_LABELS.reduce((counts, key) => ({ ...counts, [key]: Object.values(labels || {}).filter((r) => r.label === key).length }), {});
}
