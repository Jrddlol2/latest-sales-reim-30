/**
 * Single source of truth for date/time formatting — mirrors money.ts. Route
 * every timestamp render through one of these instead of an ad hoc
 * toLocaleDateString()/toLocaleString() call, which is how the app ended up
 * with several visibly different date styles across pages.
 *
 * These render in the viewer's local timezone (the browser default) — the
 * server always sends ISO/UTC timestamps, so "unpinned timezone" here means
 * "always the viewer's own", which is what every use site actually wants.
 */

function toDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  const d = typeof input === 'string' ? new Date(input) : input;
  return isNaN(d.getTime()) ? null : d;
}

/** Compact date with year, e.g. "Jul 26, 2026". */
export function formatDate(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Month + day only, no year — for space-constrained list rows, e.g. "Jul 26". */
export function formatDateShort(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Date + time, e.g. "Jul 26, 2026, 2:30 PM". */
export function formatDateTime(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Full weekday date for page headers, e.g. "Wednesday, July 29, 2026". */
export function formatLongDate(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** Full weekday date + time, for a single-message detail view, e.g. "Wednesday, July 29, 2026 at 2:30 PM". */
export function formatFullDateTime(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
}
