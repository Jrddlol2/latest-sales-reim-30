import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input, Label, Select } from '../ui/Input';
import {
  AnalyticsFilters as AnalyticsFilterState,
  AnalyticsSummary,
  DEFAULT_ANALYTICS_FILTERS,
} from '../../lib/analytics';

interface AnalyticsFiltersProps {
  value: AnalyticsFilterState;
  dimensions?: AnalyticsSummary['dimensions'];
  onChange: (next: AnalyticsFilterState) => void;
  loading?: boolean;
}

const DATE_BASIS_OPTIONS: Array<{ value: AnalyticsFilterState['dateBasis']; label: string }> = [
  { value: 'submitted', label: 'Filed / Submitted' },
  { value: 'expense', label: 'Expense Date' },
  { value: 'approved', label: 'Approved / Reviewed' },
  { value: 'paid', label: 'Paid / Released' },
  { value: 'completed', label: 'Completed / Closed' },
];

export function AnalyticsFilters({ value, dimensions, onChange, loading = false }: AnalyticsFiltersProps) {
  const [showFilters, setShowFilters] = useState(false);
  const update = <K extends keyof AnalyticsFilterState>(key: K, nextValue: AnalyticsFilterState[K]) => {
    onChange({ ...value, [key]: nextValue });
  };
  const hasFilters = Object.entries(value).some(([key, filterValue]) =>
    key === 'dateBasis' ? filterValue !== DEFAULT_ANALYTICS_FILTERS.dateBasis : Boolean(filterValue)
  );
  const activeFilters: Array<{ key: keyof AnalyticsFilterState; label: string }> = [
    value.type && { key: 'type', label: value.type },
    value.status && { key: 'status', label: value.status },
    value.department && { key: 'department', label: value.department },
    value.requestorId && { key: 'requestorId', label: dimensions?.requestors.find(item => item.id === value.requestorId)?.name || 'Requestor' },
    value.client && { key: 'client', label: value.client },
    value.category && { key: 'category', label: value.category },
    value.paymentMethod && { key: 'paymentMethod', label: value.paymentMethod },
    value.dateFrom && { key: 'dateFrom', label: `From ${value.dateFrom}` },
    value.dateTo && { key: 'dateTo', label: `To ${value.dateTo}` },
  ].filter(Boolean) as Array<{ key: keyof AnalyticsFilterState; label: string }>;

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1 max-w-2xl">
          <Input value={value.search} onChange={event => update('search', event.target.value)} placeholder="Search reference, requestor, client, or purpose..." />
        </div>
        <Select className="w-52" value={value.dateBasis} onChange={event => update('dateBasis', event.target.value as AnalyticsFilterState['dateBasis'])} aria-label="Analytics date basis">
          {DATE_BASIS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Button variant="outline" className="gap-2" onClick={() => setShowFilters(open => !open)}>
          <span className="material-symbols-outlined text-[18px]">filter_list</span>
          Filters{activeFilters.length ? ` (${activeFilters.length})` : ''}
        </Button>
        {hasFilters && <Button size="sm" variant="ghost" disabled={loading} onClick={() => onChange({ ...DEFAULT_ANALYTICS_FILTERS })}>Clear all</Button>}
      </div>

      {showFilters && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 border-t border-outline-variant pt-4">
          <div><Label>From</Label><Input type="date" value={value.dateFrom} onChange={event => update('dateFrom', event.target.value)} /></div>
          <div><Label>To</Label><Input type="date" min={value.dateFrom || undefined} value={value.dateTo} onChange={event => update('dateTo', event.target.value)} /></div>
          <div><Label>Request Type</Label><Select value={value.type} onChange={event => update('type', event.target.value as AnalyticsFilterState['type'])}><option value="">All types</option>{(dimensions?.types || []).map(option => <option key={option} value={option}>{option}</option>)}</Select></div>
          <div><Label>Status</Label><Select value={value.status} onChange={event => update('status', event.target.value)}><option value="">All statuses</option>{(dimensions?.statuses || []).map(option => <option key={option} value={option}>{option}</option>)}</Select></div>
          <div><Label>Department</Label><Select value={value.department} onChange={event => update('department', event.target.value)}><option value="">All departments</option>{(dimensions?.departments || []).map(option => <option key={option} value={option}>{option}</option>)}</Select></div>
          <div><Label>Requestor</Label><Select value={value.requestorId} onChange={event => update('requestorId', event.target.value)}><option value="">All requestors</option>{(dimensions?.requestors || []).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</Select></div>
          <div><Label>Client</Label><Select value={value.client} onChange={event => update('client', event.target.value)}><option value="">All clients</option>{(dimensions?.clients || []).map(option => <option key={option} value={option}>{option}</option>)}</Select></div>
          <div><Label>Expense Category</Label><Select value={value.category} onChange={event => update('category', event.target.value)}><option value="">All categories</option>{(dimensions?.categories || []).map(option => <option key={option} value={option}>{option}</option>)}</Select></div>
          <div><Label>Payment Method</Label><Select value={value.paymentMethod} onChange={event => update('paymentMethod', event.target.value)}><option value="">All payment methods</option>{(dimensions?.paymentMethods || []).map(option => <option key={option} value={option}>{option}</option>)}</Select></div>
        </div>
      )}

      {activeFilters.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
        {activeFilters.map(filter => (
          <button
            key={filter.key}
            onClick={() => onChange({ ...value, [filter.key]: '' })}
            className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold"
          >
            {filter.label}<span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        ))}
      </div>}
      <p className="text-xs text-outline mt-3">{loading ? 'Updating analytics…' : 'Filters update KPIs, charts, records, and exports together.'}</p>
    </div>
  );
}
