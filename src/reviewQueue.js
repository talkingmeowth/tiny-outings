export function isActiveDraftActivity(activity) {
  return activity?.public_listing_status === 'draft' && !activity?.archive;
}

export function buildAdminDraftReviewQueue(activities) {
  return (activities || [])
    .filter(isActiveDraftActivity)
    .sort((left, right) => (
      String(left.activity_name || '').localeCompare(String(right.activity_name || ''), 'en-GB', { sensitivity: 'base' })
      || String(left.activity_id || '').localeCompare(String(right.activity_id || ''))
    ))
    .map((activity) => ({
      review_queue_id: `draft:${activity.activity_id}`,
      activity_id: activity.activity_id,
      queue_type: 'draft',
      status: 'pending',
      summary: activity.activity_name || 'Draft listing',
      source_name: activity.source_name || null,
      data_source: activity.data_source || null,
      created_at: activity.created_at || null,
      activity,
    }));
}
