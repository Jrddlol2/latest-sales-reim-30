import { ReactNode } from 'react';

export interface GroupByOption {
  value: string;
  label: string;
  icon?: string;
}

interface GroupByControlProps {
  value: string;
  options: GroupByOption[];
  onChange: (value: string) => void;
  /** Leading label; defaults to "View by". */
  label?: string;
  className?: string;
}

/**
 * A prominent segmented "View by" control for switching a list between a flat
 * view and grouped-by-dimension views (e.g. by client, by requestor). Mirrors
 * the grouping affordance the Receipts module already exposes, surfaced as a
 * first-class control rather than buried in a filter popover so the client /
 * account-manager breakdowns are easy to reach.
 */
export function GroupByControl({ value, options, onChange, label = 'View by', className = '' }: GroupByControlProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label && <span className="font-label-sm text-outline uppercase tracking-wider hidden sm:inline">{label}</span>}
      <div className="inline-flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-low p-1" role="group" aria-label={label}>
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-label-sm font-semibold transition-colors ${
              value === option.value ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {option.icon && <span className="material-symbols-outlined text-[16px]">{option.icon}</span>}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface GroupSectionProps {
  icon: string;
  title: string;
  /** Small pill beside the title, e.g. the record count. */
  badge?: string;
  /** Right-aligned metric blocks (subtotals, coverage, etc.). */
  metrics?: ReactNode;
  children: ReactNode;
}

/** One collapsible-looking group card: a header bar (icon + title + metrics)
 *  over an arbitrary body (usually a table). Shared by every grouped list so
 *  the grouped views look identical across modules. */
export function GroupSection({ icon, title, badge, metrics, children }: GroupSectionProps) {
  return (
    <div className="rounded-xl border border-outline-variant overflow-hidden bg-surface-container-lowest">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-container-low/50 px-5 py-3 border-b border-outline-variant">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="material-symbols-outlined text-[20px] text-primary">{icon}</span>
          <span className="font-headline-sm text-on-surface truncate">{title}</span>
          {badge && <span className="rounded-full bg-primary/8 text-primary px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">{badge}</span>}
        </div>
        {metrics && <div className="flex items-center gap-6">{metrics}</div>}
      </div>
      {children}
    </div>
  );
}

/** A single right-aligned label/value metric block for a GroupSection header. */
export function GroupMetric({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="text-right">
      <p className="font-label-sm text-outline uppercase tracking-wider text-[11px]">{label}</p>
      <p className={`font-mono-data font-bold ${muted ? 'text-on-surface' : 'text-primary'}`}>{value}</p>
    </div>
  );
}
