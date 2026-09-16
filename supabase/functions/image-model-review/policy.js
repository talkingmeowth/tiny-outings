const safeUrl = (value) => {
  if (typeof value !== 'string') return '';
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
};

export function reviewedChoice(proposal, decision, imageUrl) {
  if (!['approved','rejected','unsure'].includes(decision)) throw Error('Choose approve, reject, or unsure.');
  if (decision !== 'approved') return null;
  const target = safeUrl(imageUrl);
  const options = [proposal.selected_image, ...(proposal.alternatives || [])].filter(Boolean);
  const chosen = target && options.find((candidate) => safeUrl(candidate.image_url) === target);
  if (!chosen) throw Error('Approve only an image from this proposal.');
  return chosen;
}
