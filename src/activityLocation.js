function coordinate(value, minimum, maximum) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum ? numeric : null;
}

export function activityCoordinates(activity) {
  const lat = coordinate(activity?.lat, -90, 90);
  const long = coordinate(activity?.long, -180, 180);
  return lat !== null && long !== null ? { lat, long } : null;
}

function locationQueries(activity) {
  const name = String(activity?.activity_name || '').trim();
  const address = String(activity?.address || '').trim();
  const borough = String(activity?.borough || '').trim();
  return [...new Set([
    [name, address].filter(Boolean).join(', '),
    address,
    [name, borough, 'London'].filter(Boolean).join(', '),
  ])].filter(Boolean);
}

// Photon is an OpenStreetMap geocoder with browser CORS support. This runs
// only when an administrator publishes a draft lacking coordinates.
export async function resolveActivityCoordinates(activity, fetchImpl = fetch) {
  const existing = activityCoordinates(activity);
  if (existing) return existing;

  for (const query of locationQueries(activity)) {
    const params = new URLSearchParams({
      q: query,
      limit: '1',
      // Keep automatic publishing within the London area Tiny Outings covers.
      bbox: '-0.56,51.24,0.38,51.78',
    });
    const response = await fetchImpl(`https://photon.komoot.io/api/?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) continue;

    const body = await response.json();
    const coordinates = body?.features?.[0]?.geometry?.coordinates;
    const resolved = activityCoordinates({ long: coordinates?.[0], lat: coordinates?.[1] });
    if (resolved) return resolved;
  }

  return null;
}
