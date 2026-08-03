export const CHART_COLORS = {
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  tertiary: 'var(--color-tertiary)',
  success: 'var(--color-success)',
  error: 'var(--color-error)',
  axis: 'var(--color-outline)',
  grid: 'var(--color-outline-variant)',
  muted: 'var(--color-surface-dim)',
} as const;

// Centralized categorical colors for status and slice charts. The ordering
// avoids placing easily confused red/green hues next to one another.
export const CHART_CATEGORICAL_COLORS = [
  '#004ac6',
  '#943700',
  '#7c3aed',
  '#0d9488',
  '#c2410c',
  '#2563eb',
  '#a16207',
  '#be185d',
  '#475569',
  '#0891b2',
] as const;

export const CHART_AXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  stroke: CHART_COLORS.axis,
  fontSize: 12,
} as const;

export const CHART_GRID_PROPS = {
  stroke: CHART_COLORS.grid,
  strokeDasharray: '3 3',
} as const;

export const CHART_ANIMATION_PROPS = {
  isAnimationActive: true,
  animationDuration: 350,
  animationEasing: 'ease-out' as const,
};

export function calculatePercentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
