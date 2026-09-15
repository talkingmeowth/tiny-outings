export const TRAINING_RETURN_KEY = 'tiny-outings-training-return';
export function restoreTrainingRoute(win) {
  try {
    const url = new URL(win.location.href);
    const returning = url.searchParams.has('code') || /access_token=|error_description=/.test(url.hash);
    const stored = win.sessionStorage.getItem(TRAINING_RETURN_KEY);
    if (!returning || !stored) return;
    const target = new URL(stored, url.origin);
    win.sessionStorage.removeItem(TRAINING_RETURN_KEY);
    if (target.origin !== url.origin || target.pathname !== url.pathname || !['training', 'missing'].includes(target.searchParams.get('view'))) return;
    for (const key of ['view', 'batch', 'case']) if (target.searchParams.has(key)) url.searchParams.set(key, target.searchParams.get(key));
    win.history.replaceState(null, '', url.href);
  } catch { /* Restricted storage must not break sign-in. */ }
}
