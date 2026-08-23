import process from 'node:process';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const retryableStatuses = new Set([429, 500, 502, 503, 504]);

function retryDelayFor(response, attempt) {
  const retryAfterSeconds = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfterSeconds)) return Math.max(1000, retryAfterSeconds * 1000);
  return response.status === 429
    ? Math.min(120000, 65000 * (attempt + 1))
    : Math.min(30000, 1500 * (2 ** attempt));
}

// Every Google Places caller goes through this factory. Keeping the timer in
// the client instance means parallel importers cannot accidentally bypass the
// per-project request limit. The dependency hooks keep retries testable without
// network calls or real timers.
export function createGooglePlacesClient({
  fetchImpl = globalThis.fetch,
  waitImpl = wait,
  now = Date.now,
  minimumIntervalMs = positiveInteger(process.env.GOOGLE_PLACES_MIN_INTERVAL_MS, 300),
  maxRetries = positiveInteger(process.env.GOOGLE_PLACES_MAX_RETRIES, 5),
  timeoutMs = 30000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for Google Places requests.');

  let nextRequestAt = 0;

  return async function googlePlacesJson(url, apiKey, options = {}) {
    if (!apiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.');

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const pause = nextRequestAt - now();
      if (pause > 0) await waitImpl(pause);
      nextRequestAt = now() + minimumIntervalMs;

      try {
        const response = await fetchImpl(url, {
          ...options,
          signal: options.signal || AbortSignal.timeout(timeoutMs),
          headers: { ...(options.headers || {}), 'X-Goog-Api-Key': apiKey },
        });
        if (response.ok) return response.json();

        const body = (await response.text()).slice(0, 500);
        if (!retryableStatuses.has(response.status) || attempt === maxRetries) {
          throw new Error(`Google Places returned ${response.status}: ${body}`);
        }

        const retryDelay = retryDelayFor(response, attempt);
        nextRequestAt = Math.max(nextRequestAt, now() + retryDelay);
        await waitImpl(retryDelay);
      } catch (error) {
        // A response error already has a meaningful status. Retrying it here
        // would mask invalid requests such as a malformed field mask.
        if (attempt === maxRetries || /Google Places returned \d{3}/.test(String(error?.message || ''))) throw error;
        const retryDelay = Math.min(30000, 1500 * (2 ** attempt));
        nextRequestAt = Math.max(nextRequestAt, now() + retryDelay);
        await waitImpl(retryDelay);
      }
    }

    throw new Error('Google Places request exhausted retries.');
  };
}

export const googlePlacesJson = createGooglePlacesClient();
