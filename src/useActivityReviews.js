import { useEffect, useState } from 'react';
import { loadActivityReviews, reviewSummary } from './activityReviewData';

export function useActivityReviews(client, activityId, refresh) {
  const [state, setState] = useState({ rows: [], loading: true, error: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ rows: [], loading: true, error: '' });
    loadActivityReviews(client, activityId, controller.signal).then((rows) => {
      if (!controller.signal.aborted) setState({ rows, loading: false, error: '' });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ rows: [], loading: false, error: 'Could not load reviews.' });
    });
    return () => controller.abort();
  }, [client, activityId, refresh, retry]);
  return { ...state, summary: reviewSummary(state.rows), retry: () => setRetry((n) => n + 1) };
}
