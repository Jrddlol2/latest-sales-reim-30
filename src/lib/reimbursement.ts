export const REIMBURSEMENT_CAP = 1000;

export function reimbursableAmount(claimedAmount: number): number {
  return Math.min(Math.max(Number(claimedAmount) || 0, 0), REIMBURSEMENT_CAP);
}

export function isPurchaseOlderThan30Days(purchaseDate?: string, filedDate = new Date()): boolean {
  if (!purchaseDate) return false;
  const purchase = new Date(`${purchaseDate}T00:00:00`);
  if (Number.isNaN(purchase.getTime())) return false;
  return filedDate.getTime() - purchase.getTime() > 30 * 24 * 60 * 60 * 1000;
}
