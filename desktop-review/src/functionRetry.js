export function isRetryableFunctionTransportError(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || error || '');
  return name === 'FunctionsFetchError'
    || /failed to send a request|failed to fetch|network request failed|load failed|networkerror/i.test(message);
}

export async function invokeFunctionWithRetry(invoke, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 3);
  const delays = options.delays || [500, 1500];
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let response;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await invoke();
    } catch (error) {
      response = { data: null, error };
    }
    if (!isRetryableFunctionTransportError(response?.error) || attempt === attempts - 1) return response;
    await wait(delays[Math.min(attempt, delays.length - 1)] || 0);
  }
  return response;
}
