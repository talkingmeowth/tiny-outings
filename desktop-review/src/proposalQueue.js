export function mergeProposalPage(existing, page) {
  const byActivity = new Map(existing.map((row) => [row.activity_id, row]));
  for (const row of page) {
    if (row?.activity_id) byActivity.set(row.activity_id, row);
  }
  return [...byActivity.values()];
}
