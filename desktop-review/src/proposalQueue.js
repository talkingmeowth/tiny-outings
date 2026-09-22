export function mergeProposalPage(existing, page) {
  const byActivity = new Map(existing.map((row) => [row.activity_id, row]));
  for (const row of page) {
    if (row?.activity_id) byActivity.set(row.activity_id, row);
  }
  return [...byActivity.values()];
}

export function remainingProposalPageOffsets(total, next, pageSize = 200) {
  if (!Number.isFinite(total) || !Number.isFinite(next) || pageSize < 1) return [];
  const offsets = [];
  for (let offset = next; offset < total; offset += pageSize) offsets.push(offset);
  return offsets;
}
