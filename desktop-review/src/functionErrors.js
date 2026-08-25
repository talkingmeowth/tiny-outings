export async function edgeFunctionErrorMessage(response, fallback) {
  if (response?.data?.error) return String(response.data.error);
  const context = response?.error?.context;
  try {
    if (typeof context?.json === 'function') {
      const payload = await context.json();
      if (payload?.error) return String(payload.error);
    }
  } catch {
    // Fall back to the client error when the response body is not JSON.
  }
  return response?.error?.message || fallback;
}
