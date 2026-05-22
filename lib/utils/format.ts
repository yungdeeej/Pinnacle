export function centsToCAD(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 2,
  }).format(dollars);
}

export function pct(value: number, digits = 1): string {
  return `${value >= 0 ? '' : ''}${value.toFixed(digits)}%`;
}

export function signedPct(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function relativeTime(timestamp: number | Date): string {
  const ms = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const future = diff > 0;
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) return future ? `in ${days}d` : `${days}d ago`;
  if (hours >= 1) return future ? `in ${hours}h` : `${hours}h ago`;
  if (minutes >= 1) return future ? `in ${minutes}m` : `${minutes}m ago`;
  return future ? 'soon' : 'just now';
}

export function formatGameTime(timestamp: number | Date, tz = 'America/Edmonton'): string {
  const d = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}
