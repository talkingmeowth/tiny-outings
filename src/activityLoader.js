export const ACTIVITY_PAGE_SIZE = 250;
export const ACTIVITY_LOAD_CONCURRENCY = 4;

// Keep individual queries small, but do not pay a network round trip serially
// for every page. Only publish a complete, ordered directory to callers.
export async function loadActivityPages(loadPage, {
  pageSize = ACTIVITY_PAGE_SIZE,
  concurrency = ACTIVITY_LOAD_CONCURRENCY,
  signal,
} = {}) {
  const checkAborted = () => signal?.throwIfAborted();
  const getPage = async (page) => {
    checkAborted();
    const response = await loadActivityPageWithRetries(
      () => loadPage(page * pageSize, (page + 1) * pageSize - 1, page === 0),
      { signal },
    );
    checkAborted();
    if (response.error) throw response.error;
    return response;
  };
  const first = await getPage(0);
  const pages = [first.data || []];
  if (pages[0].length < pageSize) return pages[0];
  const total = Number.isInteger(first.count) && first.count >= 0
    ? Math.ceil(first.count / pageSize)
    : null;
  let nextPage = 1;
  let endPage = total ?? Infinity;
  let failed = false;
  async function worker() {
    while (!failed && nextPage < endPage) {
      const page = nextPage++;
      try {
        const response = await getPage(page);
        pages[page] = response.data || [];
        if (pages[page].length < pageSize) endPage = Math.min(endPage, page + 1);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 4)) }, worker));
  checkAborted();
  return pages.slice(0, endPage).flat();
}

// Cache and network race independently. A late cache read can never overwrite
// fresh records (including an empty directory after everything was archived).
export async function loadCachedActivityDirectory({ readCache, loadFresh, onData, signal }) {
  let freshLoaded = false;
  const cached = Promise.resolve().then(readCache).then((data) => {
    if (!signal?.aborted && !freshLoaded && Array.isArray(data)) onData(data, false);
  }).catch(() => {});
  try {
    const data = await loadFresh();
    signal?.throwIfAborted();
    freshLoaded = true;
    onData(data, true);
    return data;
  } catch (error) {
    await cached;
    throw error;
  }
}

export function isTransientActivityLoadError(error, status) {
  const statusCode = Number(status);
  if (Number.isFinite(statusCode) && statusCode >= 500) return true;
  return /timeout|timed out|failed to fetch|network|gateway|temporar/i.test(
    String(error?.message || error || ''),
  );
}

export async function loadActivityPageWithRetries(
  loadPage,
  { maxAttempts = 3, wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)), signal } = {},
) {
  let response;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    signal?.throwIfAborted();
    response = await loadPage();
    signal?.throwIfAborted();
    if (!response?.error) return response;
    if (!isTransientActivityLoadError(response.error, response.status) || attempt === maxAttempts - 1) {
      return response;
    }
    await wait(400 * (2 ** attempt));
  }
  return response;
}
