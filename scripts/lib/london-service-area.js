import { readFileSync } from 'node:fs';

// Checked-in GLA boundary snapshot. Imports make no geocoding or API call.
const boundary = JSON.parse(readFileSync(new URL('../../data/greater-london-boundary.generated.geojson', import.meta.url), 'utf8'));
const polygons = boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates;

function inRing(latitude, longitude, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > latitude) !== (yj > latitude)
      && longitude < ((xj - xi) * (latitude - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function distanceToRingMetres(latitude, longitude, ring) {
  const metresPerLon = 111320 * Math.cos(latitude * Math.PI / 180);
  let minimum = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const dx = (x2 - x1) * metresPerLon;
    const dy = (y2 - y1) * 111320;
    const px = (longitude - x1) * metresPerLon;
    const py = (latitude - y1) * 111320;
    const fraction = dx * dx + dy * dy > 0
      ? Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy))) : 0;
    minimum = Math.min(minimum, Math.hypot(px - fraction * dx, py - fraction * dy));
  }
  return minimum;
}

export function isWithinGreaterLondon(latitude, longitude, toleranceMetres = 20) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)
    || latitude == null || longitude == null) return false;

  return polygons.some((rings) => {
    if (inRing(lat, lon, rings[0]) && !rings.slice(1).some((hole) => inRing(lat, lon, hole))) return true;
    return toleranceMetres > 0 && rings.some((ring) => distanceToRingMetres(lat, lon, ring) <= toleranceMetres);
  });
}
