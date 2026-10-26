export type LatLng = { lat: number; lng: number };

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number | null): string {
  if (km === null) return '';
  if (km < 1) return `${Math.max(50, Math.round(km * 20) * 50)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
