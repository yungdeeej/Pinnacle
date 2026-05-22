// Haversine distance in miles
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8; // miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Crude timezone offset lookup — sufficient for NHL cities (no DST nuance needed in MVP).
const TZ_OFFSETS: Record<string, number> = {
  'America/New_York': -5,
  'America/Detroit': -5,
  'America/Toronto': -5,
  'America/Montreal': -5,
  'America/Chicago': -6,
  'America/Winnipeg': -6,
  'America/Denver': -7,
  'America/Edmonton': -7,
  'America/Los_Angeles': -8,
  'America/Vancouver': -8,
  'America/Phoenix': -7,
  'America/Anchorage': -9,
};

export function timezonesCrossed(fromTz: string, toTz: string): number {
  const from = TZ_OFFSETS[fromTz] ?? -5;
  const to = TZ_OFFSETS[toTz] ?? -5;
  return Math.abs(from - to);
}

export function isEastToWest(fromTz: string, toTz: string): boolean {
  const from = TZ_OFFSETS[fromTz] ?? -5;
  const to = TZ_OFFSETS[toTz] ?? -5;
  return from > to; // moving from less-negative to more-negative offset
}
