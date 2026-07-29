/**
 * Single source of truth for money formatting. The backend has always run
 * in PHP (every generated email says "PHP 33,956"); the UI used to hardcode
 * `$` everywhere it rendered an amount. Route every money render through
 * this helper instead of a literal `$`/`.toFixed(2)`.
 */
const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number | null | undefined): string {
  return PHP_FORMATTER.format(Number(amount) || 0);
}

export function formatAxisMoney(val: number): string {
  if (val >= 1000000) return `₱${(val / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (val >= 1000) return `₱${(val / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `₱${val}`;
}
