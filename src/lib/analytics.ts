import { apiFetch } from './api';
import { ClaimType } from '../types';

export type AnalyticsDateBasis = 'submitted' | 'expense' | 'approved' | 'paid' | 'completed';

export interface AnalyticsFilters {
  dateBasis: AnalyticsDateBasis;
  dateFrom: string;
  dateTo: string;
  type: '' | ClaimType;
  status: string;
  department: string;
  requestorId: string;
  client: string;
  category: string;
  paymentMethod: string;
  search: string;
}

export const DEFAULT_ANALYTICS_FILTERS: AnalyticsFilters = {
  dateBasis: 'submitted',
  dateFrom: '',
  dateTo: '',
  type: '',
  status: '',
  department: '',
  requestorId: '',
  client: '',
  category: '',
  paymentMethod: '',
  search: '',
};

export interface AnalyticsMetricGroup {
  name: string;
  count: number;
  claimedAmount: number;
  approvedAmount: number;
  paidAmount: number;
}

export interface AnalyticsRecord {
  id: string;
  ref: string;
  type: ClaimType;
  status: string;
  requestorId: string;
  requestorName: string;
  department: string;
  purpose: string;
  client?: string;
  claimedAmount: number;
  approvedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  createdAt: string;
  submittedAt?: string;
  approvedAt?: string;
  paidAt?: string;
  completedAt?: string;
  categories: string[];
  paymentMethods: string[];
}

export interface AnalyticsSummary {
  appliedFilters: Partial<AnalyticsFilters>;
  metrics: {
    recordCount: number;
    lineItemCount: number;
    claimedAmount: number;
    approvedAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    avgApprovalTurnaroundDays: number | null;
  };
  breakdowns: {
    byStatus: AnalyticsMetricGroup[];
    byType: AnalyticsMetricGroup[];
    byRequestor: AnalyticsMetricGroup[];
    byDepartment: AnalyticsMetricGroup[];
    byCategory: Array<{ name: string; count: number; amount: number }>;
  };
  dimensions: {
    types: ClaimType[];
    statuses: string[];
    departments: string[];
    requestors: Array<{ id: string; name: string }>;
    clients: string[];
    categories: string[];
    paymentMethods: string[];
  };
  records: AnalyticsRecord[];
}

export function fetchAnalyticsSummary(filters: AnalyticsFilters): Promise<AnalyticsSummary> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return apiFetch(`/api/analytics/summary?${params.toString()}`);
}

function csvCell(value: string | number | undefined): string {
  const normalized = value === undefined ? '' : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function downloadAnalyticsCsv(records: AnalyticsRecord[], filenamePrefix: string): void {
  const headers = [
    'Reference',
    'Type',
    'Status',
    'Requestor',
    'Department',
    'Client',
    'Purpose',
    'Submitted',
    'Approved',
    'Paid',
    'Completed',
    'Claimed Amount',
    'Approved Amount',
    'Paid Amount',
    'Outstanding Amount',
    'Categories',
    'Payment Methods',
  ];
  const rows = records.map(record => [
    record.ref,
    record.type,
    record.status,
    record.requestorName,
    record.department,
    record.client,
    record.purpose,
    record.submittedAt,
    record.approvedAt,
    record.paidAt,
    record.completedAt,
    record.claimedAmount.toFixed(2),
    record.approvedAmount.toFixed(2),
    record.paidAmount.toFixed(2),
    record.outstandingAmount.toFixed(2),
    record.categories.join('; '),
    record.paymentMethods.join('; '),
  ]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
