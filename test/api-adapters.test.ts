import { describe, expect, it } from 'vitest';
import {
  fromServerCashAdvance,
  fromServerExpense,
  fromServerLiquidation,
} from '../src/lib/api';
import { ClaimStatus } from '../src/types';

describe('workspace API adapters', () => {
  it('keeps an OR number separate from the receipt filename', () => {
    const expense = fromServerExpense({
      id: 'expense-1',
      expense_date: '2026-01-01',
      vendor: 'Vendor',
      category: 'Travel',
      amount: 500,
      payment_method: 'Cash',
      business_purpose: 'Client visit',
      receipt_url: '/uploads/receipt-scan.pdf',
      or_number: 'OR-12345',
    }, 'claim-1');

    expect(expense.receiptFileName).toBe('receipt-scan.pdf');
    expect(expense.orNumber).toBe('OR-12345');
  });

  it('uses real cash-advance history timestamps and explicit amounts', () => {
    const advance = fromServerCashAdvance({
      id: 'ca-1',
      requestorId: 'u1',
      approverId: 'u2',
      amount: 3000,
      purpose: 'Field work',
      status: 'Released',
      createdAt: '2026-01-01T00:00:00.000Z',
      approvedAt: '2026-01-02T00:00:00.000Z',
      releaseDate: '2026-01-03T00:00:00.000Z',
      paidAmount: 3000,
      history: [
        { new_status: 'Submitted', timestamp: '2026-01-01T08:00:00.000Z' },
        { new_status: 'Approved', timestamp: '2026-01-02T00:00:00.000Z' },
      ],
    });

    expect(advance.submittedAt).toBe('2026-01-01T08:00:00.000Z');
    expect(advance.approvedAmount).toBe(3000);
    expect(advance.paidAmount).toBe(3000);
    expect(advance.paidAt).toBe('2026-01-03T00:00:00.000Z');
  });

  it('does not count liquidation spend as a second payment', () => {
    const liquidation = fromServerLiquidation({
      id: 'liq-1',
      requestorId: 'u1',
      cashAdvanceId: 'ca-1',
      totalSpent: 2800,
      varianceAmount: 200,
      varianceType: 'RefundDue',
      status: 'Reviewed',
      createdAt: '2026-01-04T00:00:00.000Z',
      history: [
        { new_status: 'Submitted', timestamp: '2026-01-05T00:00:00.000Z' },
        { new_status: 'Reviewed', timestamp: '2026-01-06T00:00:00.000Z' },
      ],
    });

    expect(liquidation.status).toBe(ClaimStatus.REVIEWED);
    expect(liquidation.approvedAmount).toBe(2800);
    expect(liquidation.paidAmount).toBe(0);
  });
});
