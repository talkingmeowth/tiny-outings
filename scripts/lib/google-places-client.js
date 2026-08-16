import process from 'node:process';

// Google Places applies a per-project request-per-minute quota. Keep each
// importer below that rate and treat a 429 as a cooldown, not a missing place.
let nextRequestAt = 0;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function googlePlacesJson(url, apiKey, options = {}) {
  if (!apiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.');

  const minimumIntervalMs = positiveInteger(process.env.GOOGLE_PLACES_MIN_INTERVAL_MS, 300);
  const maxRetries = positiveInteger(process.env.GOOGLE_PLACES_MAX_RETRIES, 5);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const pause = nextRequestAt - Date.now();
    if (pause > 0) await wait(pause);
    nextRequestAt = Date.now() + minimumIntervalMs;

    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30000),
        headers: { ...(options.headers || {}), 'X-Goog-Api-Key': apiKey },
      });
      if (response.ok) return response.json();

      const body = (await response.text()).slice(0, 500);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxRetries) {
        throw new Error(`Google Places returned ${response.status}: ${body}`);
      }

      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const retryDelay = Number.isFinite(retryAfterSeconds)
        ? Math.max(1000, retryAfterSeconds * 1000)
        : response.status === 429
          ? Math.min(120000, 65000 * (attempt + 1))
          : Math.min(30000, 1500 * (2 ** attempt));
      nextRequestAt = Math.max(nextRequestAt, Date.now() + retryDelay);
      await wait(retryDelay);
    } catch (error) {
      if (attempt === maxRetries || /Google Places returned \d{3}/.test(String(error?.message || ''))) throw error;
      const retryDelay = Math.min(30000, 1500 * (2 ** attempt));
      nextRequestAt = Math.max(nextRequestAt, Date.now() + retryDelay);
      await wait(retryDelay);
    }
  }

  throw new Error('Google Places request exhausted retries.');
}
