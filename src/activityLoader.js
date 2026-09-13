export const ACTIVITY_PAGE_SIZE = 250;

export function isTransientActivityLoadError(error, status) {
  const statusCode = Number(status);
  if (Number.isFinite(statusCode) && statusCode >= 500) return true;
  return /timeout|timed out|failed to fetch|network|gateway|temporar/i.test(
    String(error?.message || error || ''),
  );
}

export async function loadActivityPageWithRetries(
  loadPage,
  { maxAttempts = 3, wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)) } = {},
) {
  let response;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    response = await loadPage();
    if (!response?.error) return response;
    if (!isTransientActivityLoadError(response.error, response.status) || attempt === maxAttempts - 1) {
      return response;
    }
    await wait(400 * (2 ** attempt));
  }
  return response;
}
