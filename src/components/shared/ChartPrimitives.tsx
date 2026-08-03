import { formatAxisMoney, formatMoney } from '../../lib/money';

export type ChartValueKind = 'currency' | 'count' | 'percent' | 'days';

type TooltipEntry = {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
};

const COUNT_FORMATTER = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });

export function formatChartValue(value: number | string | boolean | null | undefined, kind: ChartValueKind): string {
  const numeric = Number(value) || 0;
  if (kind === 'currency') return formatMoney(numeric);
  if (kind === 'percent') return `${numeric.toFixed(1).replace(/\.0$/, '')}%`;
  if (kind === 'days') return `${numeric.toFixed(1).replace(/\.0$/, '')} days`;
  return COUNT_FORMATTER.format(numeric);
}

export function formatCompactChartValue(value: number | string | boolean | null | undefined, kind: ChartValueKind): string {
  if (kind === 'currency') return formatAxisMoney(Number(value) || 0);
  return formatChartValue(value, kind);
}

export function ChartTooltip({
  active,
  payload,
  label,
  valueTypes = {},
  labels = {},
  defaultValueType = 'currency',
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  valueTypes?: Record<string, ChartValueKind>;
  labels?: Record<string, string>;
  defaultValueType?: ChartValueKind;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="min-w-40 rounded-[var(--radius-container)] border border-outline-variant bg-surface-container-lowest px-3 py-2 shadow-md">
      {label != null && <p className="mb-1.5 text-xs font-semibold text-on-surface">{label}</p>}
      <div className="space-y-1">
        {payload.map((entry, index) => {
          const key = String(entry.dataKey ?? entry.name ?? index);
          return (
            <div key={`${key}-${index}`} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex min-w-0 items-center gap-2 text-outline">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="truncate">{labels[key] ?? entry.name ?? key}</span>
              </span>
              <span className="font-mono-data font-bold text-on-surface">
                {formatChartValue(entry.value, valueTypes[key] ?? defaultValueType)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChartLegend({ payload }: { payload?: Array<{ color?: string; dataKey?: string | number; value?: string }> }) {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 pt-2 text-xs text-on-surface-variant" aria-label="Chart legend">
      {payload.map((entry, index) => (
        <span key={`${entry.dataKey ?? entry.value}-${index}`} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.value}
        </span>
      ))}
    </div>
  );
}

export function ChartSkeleton({ label = 'Loading chart' }: { label?: string }) {
  return (
    <div className="flex h-full animate-pulse flex-col justify-end gap-3" role="status" aria-label={label}>
      <div className="h-3 w-28 rounded bg-surface-container-high" />
      <div className="flex flex-1 items-end gap-3 border-b border-l border-outline-variant px-4 pb-3">
        {[42, 68, 53, 82, 62, 74].map((height, index) => (
          <div key={index} className="flex-1 rounded-t bg-surface-container-high" style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  );
}

export function MetricSkeleton({ label = 'Loading metric' }: { label?: string }) {
  return <span className="inline-block h-7 w-32 animate-pulse rounded bg-surface-container-high align-middle" role="status" aria-label={label} />;
}

export function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center text-outline" role="status">
      <span className="material-symbols-outlined mb-2 text-3xl" aria-hidden="true">bar_chart_off</span>
      <p className="text-sm font-medium text-on-surface-variant">No chart data</p>
      <p className="mt-1 max-w-sm text-xs">{message}</p>
    </div>
  );
}

export function TrendBadge({ value, context = 'vs prior month' }: { value: number | null; context?: string }) {
  if (value == null) return <span className="text-xs text-outline">No prior-period comparison</span>;
  const isUp = value > 0;
  const isFlat = Math.abs(value) < 0.05;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-1 text-xs font-semibold ${isFlat ? 'text-outline' : isUp ? 'text-primary' : 'text-tertiary'}`}>
      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
        {isFlat ? 'trending_flat' : isUp ? 'trending_up' : 'trending_down'}
      </span>
      {isFlat ? 'No change' : `${Math.abs(value).toFixed(1)}% ${isUp ? 'up' : 'down'}`} {context}
    </span>
  );
}
