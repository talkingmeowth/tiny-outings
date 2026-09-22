const safeUrl = (value) => {
  if (typeof value !== 'string') return '';
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
};

export function reviewedChoice(proposal, decision, imageUrl) {
  if (!['approved','rejected','unsure'].includes(decision)) throw Error('Choose approve, reject, or unsure.');
  if (decision !== 'approved') return null;
  const target = safeUrl(imageUrl);
  const options = [proposal.selected_image, ...(proposal.alternatives || []),
    ...(proposal.decision === 'approved' ? [proposal.chosen_image] : [])].filter(Boolean);
  const chosen = target && options.find((candidate) => safeUrl(candidate.image_url) === target);
  if (!chosen) throw Error('Approve only an image from this proposal.');
  return chosen;
}

export function currentActiveProposals(proposals, activities) {
  const current = new Map(activities.map((activity) => [activity.activity_id, activity]));
  return proposals.flatMap((proposal) => {
    const activity = current.get(proposal.activity_id);
    if (!activity || activity.archive || !['draft', 'published'].includes(activity.public_listing_status)) return [];
    return [{ ...proposal, activity_snapshot: {
      ...proposal.activity_snapshot,
      public_listing_status: activity.public_listing_status,
    } }];
  });
}

export function proposalAlternativePage(proposal, offset = 0, limit = 24) {
  const alternatives = Array.isArray(proposal?.alternatives) ? proposal.alternatives : [];
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const safeLimit = Math.max(1, Math.min(48, Math.floor(Number(limit) || 24)));
  return {
    alternatives: alternatives.slice(safeOffset, safeOffset + safeLimit),
    total: alternatives.length,
    next: safeOffset + safeLimit < alternatives.length ? safeOffset + safeLimit : null,
  };
}
