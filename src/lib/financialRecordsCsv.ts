import { Claim, User } from '../types';

export const FINANCIAL_RECORD_CSV_HEADERS = [
  'Reference',
  'Requestor',
  'Department',
  'Type',
  'Purpose',
  'Client',
  'Location',
  'Submitted Date',
  'Expense / Requested Total (PHP)',
  'Approved Amount (PHP)',
  'Paid / Released Amount (PHP)',
  'Outstanding Amount (PHP)',
  'Status',
] as const;

function csvCell(value: string | number | undefined): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';

  const text = value || '';
  // Prevent spreadsheet applications from evaluating user-controlled text as
  // a formula when the export is opened in Excel or similar tools.
  const safeText = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function buildFinancialRecordsCsv(claims: Claim[], users: User[]): string {
  const rows = claims.map(claim => {
    const requestor = users.find(user => user.id === claim.requestorId);
    const approvedAmount = claim.approvedAmount || 0;
    const paidAmount = claim.paidAmount || 0;

    return [
      claim.ref,
      requestor?.name || 'Unknown',
      requestor?.department || '',
      claim.type,
      claim.purpose,
      claim.client || '',
      claim.location || '',
      (claim.submittedAt || claim.createdAt).slice(0, 10),
      claim.claimedAmount,
      approvedAmount,
      paidAmount,
      Math.max(approvedAmount - paidAmount, 0),
      claim.status,
    ];
  });

  // The BOM keeps UTF-8 names and symbols intact when opened directly in Excel.
  return `\uFEFF${[FINANCIAL_RECORD_CSV_HEADERS, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\n')}`;
}
