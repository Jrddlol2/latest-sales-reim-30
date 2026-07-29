/**
 * The canonical list of expense categories a requestor can pick for a line item.
 * Shared by the Submit Claim line-item dropdown and the admin Company Policy
 * editor so the categories you can spend against and the categories you can set
 * a spending cap on never drift apart.
 */
export const EXPENSE_CATEGORIES = [
  'Meals',
  'Travel',
  'Supplies',
  'Lodging',
  'Transportation',
  'Utilities',
  'Entertainment',
] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
