import { useState } from 'react';
import { Input, Label, Select } from '../ui/Input';
import { Button } from '../ui/Button';

export interface FilterOption {
  value: string;
  label: string;
}

export interface SelectFilterSpec {
  type: 'select';
  key: string;
  /** Field label shown above the control inside the "More filters" popover. */
  label: string;
  /** The empty-selection option's text, e.g. "All Statuses". */
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  /** Override the chip's display text; defaults to the matching option's label. */
  chipLabel?: (value: string) => string;
}

export interface DateRangeFilterSpec {
  type: 'dateRange';
  key: string;
  /** e.g. "Submitted" renders as "Submitted from" / "Submitted to" field labels. */
  label: string;
  fromValue: string;
  toValue: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

export interface NumberRangeFilterSpec {
  type: 'numberRange';
  key: string;
  /** e.g. "Amount" renders as "Min Amount" / "Max Amount" field labels. */
  label: string;
  minValue: string;
  maxValue: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  /** Formats a raw numeric string for chip display, e.g. money formatting. */
  formatValue?: (value: string) => string;
}

export type FilterSpec = SelectFilterSpec | DateRangeFilterSpec | NumberRangeFilterSpec;

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  /** Rendered inline next to search, always visible (e.g. Status/Type on Claims). */
  quickFilters?: SelectFilterSpec[];
  /** Rendered inside the "More filters" popover, counted in its badge and
   *  reflected as chips below. */
  advancedFilters?: FilterSpec[];
  popoverTitle?: string;
  popoverDescription?: string;
  /** Rendered at the top of the "More filters" popover, above the filter
   *  fields — e.g. Receipts' one-click "Quick views" preset buttons
   *  (Missing receipts, This month, ...) that set several filters at once,
   *  which don't fit the single-field-per-spec FilterSpec shape. */
  popoverExtra?: React.ReactNode;
  /** Extra control rendered at the right end of the toolbar row, e.g. a sort dropdown. */
  extraRight?: React.ReactNode;
}

/**
 * Shared search + quick-filter + "More filters" popover + active-filter-chips
 * bar, extracted from the three independently-built (but structurally
 * identical) filter UIs in ClaimsList.tsx, MOMs.tsx, and Receipts.tsx. Each
 * page keeps its own filter *dimensions* (what's filterable, and how) by
 * passing its own `quickFilters`/`advancedFilters` config — this component
 * only owns the shared shell: layout, popover open/close, badge count, chip
 * rendering, and "Clear all".
 */
export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  quickFilters = [],
  advancedFilters = [],
  popoverTitle = 'More filters',
  popoverDescription,
  popoverExtra,
  extraRight,
}: FilterBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeAdvancedCount = advancedFilters.filter(f => {
    if (f.type === 'select') return Boolean(f.value);
    if (f.type === 'dateRange') return Boolean(f.fromValue || f.toValue);
    return Boolean(f.minValue || f.maxValue);
  }).length;

  const clearAdvanced = () => {
    advancedFilters.forEach(f => {
      if (f.type === 'select') f.onChange('');
      else if (f.type === 'dateRange') { f.onFromChange(''); f.onToChange(''); }
      else { f.onMinChange(''); f.onMaxChange(''); }
    });
  };

  const hasAnyActive = Boolean(searchValue) || quickFilters.some(f => f.value) || activeAdvancedCount > 0;

  const clearAll = () => {
    onSearchChange('');
    quickFilters.forEach(f => f.onChange(''));
    clearAdvanced();
  };

  const chipFor = (f: SelectFilterSpec) => {
    if (f.chipLabel) return f.chipLabel(f.value);
    return f.options.find(o => o.value === f.value)?.label || f.value;
  };

  return (
    <div className="relative rounded-xl border border-outline-variant bg-white p-4">
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1 min-w-0">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
          <Input
            className="pl-10"
            type="text"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>

        {quickFilters.map(f => (
          <Select
            key={f.key}
            aria-label={f.label}
            className="w-full lg:w-44"
            value={f.value}
            onChange={e => f.onChange(e.target.value)}
          >
            <option value="">{f.placeholder}</option>
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ))}

        {advancedFilters.length > 0 && (
          <div className="relative w-full lg:w-auto">
            <Button
              variant="outline"
              className={`w-full lg:w-auto gap-2 justify-center ${activeAdvancedCount > 0 ? 'border-primary text-primary bg-primary/5' : ''}`}
              onClick={() => setShowAdvanced(current => !current)}
              aria-expanded={showAdvanced}
            >
              <span className="material-symbols-outlined text-[18px]">tune</span>
              Filters
              {activeAdvancedCount > 0 && (
                <span className="min-w-5 h-5 px-1 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">
                  {activeAdvancedCount}
                </span>
              )}
            </Button>

            {showAdvanced && (
              <div className="absolute right-0 top-full mt-2 z-30 w-[min(420px,calc(100vw-3rem))] rounded-xl border border-outline-variant bg-white shadow-xl p-5">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <h3 className="font-headline-sm text-on-surface">{popoverTitle}</h3>
                    {popoverDescription && <p className="text-xs text-outline mt-1">{popoverDescription}</p>}
                  </div>
                  <button
                    type="button"
                    aria-label="Close filters"
                    className="text-outline hover:text-on-surface"
                    onClick={() => setShowAdvanced(false)}
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
                {popoverExtra}
                <div className="space-y-4">
                  {advancedFilters.map(f => {
                    if (f.type === 'select') return (
                      <div key={f.key}>
                        <Label>{f.label}</Label>
                        <Select value={f.value} onChange={e => f.onChange(e.target.value)}>
                          <option value="">{f.placeholder}</option>
                          {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      </div>
                    );
                    if (f.type === 'dateRange') return (
                      <div key={f.key} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label>{f.label} from</Label>
                          <Input type="date" value={f.fromValue} onChange={e => f.onFromChange(e.target.value)} />
                        </div>
                        <div>
                          <Label>{f.label} to</Label>
                          <Input type="date" min={f.fromValue || undefined} value={f.toValue} onChange={e => f.onToChange(e.target.value)} />
                        </div>
                      </div>
                    );
                    return (
                      <div key={f.key} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label>Min {f.label}</Label>
                          <Input type="number" value={f.minValue} onChange={e => f.onMinChange(e.target.value)} />
                        </div>
                        <div>
                          <Label>Max {f.label}</Label>
                          <Input type="number" value={f.maxValue} onChange={e => f.onMaxChange(e.target.value)} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-outline-variant">
                  <Button variant="ghost" size="sm" onClick={clearAdvanced} disabled={activeAdvancedCount === 0}>Clear</Button>
                  <Button size="sm" onClick={() => setShowAdvanced(false)}>Done</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {extraRight}
      </div>

      {hasAnyActive && (
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-outline-variant">
          <span className="text-xs font-semibold text-outline">Filtered by</span>
          {quickFilters.filter(f => f.value).map(f => (
            <button
              key={f.key}
              onClick={() => f.onChange('')}
              className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold"
            >
              {chipFor(f)}<span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          ))}
          {advancedFilters.map(f => {
            if (f.type === 'select') {
              if (!f.value) return null;
              return (
                <button
                  key={f.key}
                  onClick={() => f.onChange('')}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold"
                >
                  {chipFor(f)}<span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              );
            }
            if (f.type === 'dateRange') {
              if (!f.fromValue && !f.toValue) return null;
              return (
                <button
                  key={f.key}
                  onClick={() => { f.onFromChange(''); f.onToChange(''); }}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold"
                >
                  {f.fromValue || 'Any date'} – {f.toValue || 'Today'}
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              );
            }
            if (!f.minValue && !f.maxValue) return null;
            const fmt = f.formatValue || ((v: string) => v);
            return (
              <button
                key={f.key}
                onClick={() => { f.onMinChange(''); f.onMaxChange(''); }}
                className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold"
              >
                {f.minValue ? `From ${fmt(f.minValue)}` : 'Any minimum'}{f.maxValue ? ` to ${fmt(f.maxValue)}` : ''}
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            );
          })}
          <button className="text-xs font-semibold text-outline hover:text-primary ml-1" onClick={clearAll}>Clear all</button>
        </div>
      )}
    </div>
  );
}
