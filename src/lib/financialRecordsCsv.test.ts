import { describe, expect, it } from 'vitest';
import { Claim, ClaimStatus, User, UserRole } from '../types';
import { buildFinancialRecordsCsv, FINANCIAL_RECORD_CSV_HEADERS } from './financialRecordsCsv';

const financeRecord: Claim = {
  id: 'claim-1',
  ref: 'REIM-2026-000001',
  requestorId: 'user-1',
  status: ClaimStatus.PROCESSING,
  total: 25000,
  claimedAmount: 25000,
  approvedAmount: 1000,
  paidAmount: 250,
  submittedAt: '2026-08-02T09:30:00.000Z',
  createdAt: '2026-08-01T09:30:00.000Z',
  type: 'Reimbursement',
  purpose: 'Client dinner, "Q3 review"',
  client: '=UNSAFE()',
  location: 'Makati',
};

const requestor: User = {
  id: 'user-1',
  name: 'Mia Fernandez',
  email: 'mia@mgenesis.com',
  role: UserRole.REQUESTOR,
  department: 'Marketing',
  jobTitle: 'Marketing Specialist',
  employmentStatus: 'Active',
  canApproveReimbursements: false,
};

describe('buildFinancialRecordsCsv', () => {
  it('exports finance-grade amount columns and the submitted date', () => {
    const csv = buildFinancialRecordsCsv([financeRecord], [requestor]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(FINANCIAL_RECORD_CSV_HEADERS.map(header => `"${header}"`).join(','));
    expect(csv).toContain('"2026-08-02",25000,1000,250,750');
    expect(csv).toContain('"Mia Fernandez","Marketing"');
  });

  it('escapes quotes and neutralizes spreadsheet formulas', () => {
    const csv = buildFinancialRecordsCsv([financeRecord], [requestor]);

    expect(csv).toContain('"Client dinner, ""Q3 review"""');
    expect(csv).toContain("\"'=UNSAFE()\"");
  });
});
