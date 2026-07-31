import { Claim, ClaimStatus, ExpenseLineItem, User } from '../types';

const ACTIVE_STATUSES: ClaimStatus[] = [
  ClaimStatus.PENDING_APPROVAL,
  ClaimStatus.SUBMITTED,
  ClaimStatus.APPROVED,
  ClaimStatus.PROCESSING,
  ClaimStatus.READY_FOR_CLAIM,
];

export interface TeamMemberAnalytics {
  id: string;
  name: string;
  department: string;
  avatarUrl?: string;
  claimCount: number;
  pendingCount: number;
  receiptCount: number;
  receiptSpend: number;
  paidAmount: number;
  reimbursedThisWeek: number;
}

export interface TeamCategoryAnalytics {
  name: string;
  amount: number;
  receiptCount: number;
}

export interface TeamAnalyticsResult {
  members: TeamMemberAnalytics[];
  categories: TeamCategoryAnalytics[];
  totalClaims: number;
  pendingClaims: number;
  receiptCount: number;
  receiptSpend: number;
  reimbursedThisWeek: number;
}

interface TeamAnalyticsInput {
  members: User[];
  claims: Claim[];
  lineItems: ExpenseLineItem[];
  now?: number;
}

export function calculateTeamAnalytics({
  members,
  claims,
  lineItems,
  now = Date.now(),
}: TeamAnalyticsInput): TeamAnalyticsResult {
  const memberIds = new Set(members.map(member => member.id));
  const teamClaims = claims.filter(claim =>
    memberIds.has(claim.requestorId) && claim.status !== ClaimStatus.DRAFT
  );
  const teamClaimIds = new Set(teamClaims.map(claim => claim.id));
  const teamReceiptItems = lineItems.filter(item =>
    teamClaimIds.has(item.claimId) && Boolean(item.receiptUrl)
  );
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const memberRollups = members
    .map(member => {
      const memberClaims = teamClaims.filter(claim => claim.requestorId === member.id);
      const memberClaimIds = new Set(memberClaims.map(claim => claim.id));
      const memberReceipts = teamReceiptItems.filter(item => memberClaimIds.has(item.claimId));
      const reimbursedThisWeek = memberClaims
        .filter(claim =>
          (claim.type === 'Reimbursement' || claim.type === 'Transport Reimbursement') &&
          claim.paidAmount > 0 &&
          Boolean(claim.paidAt) &&
          new Date(claim.paidAt!).getTime() >= oneWeekAgo &&
          new Date(claim.paidAt!).getTime() <= now
        )
        .reduce((sum, claim) => sum + claim.paidAmount, 0);

      return {
        id: member.id,
        name: member.name,
        department: member.department,
        avatarUrl: member.avatarUrl,
        claimCount: memberClaims.length,
        pendingCount: memberClaims.filter(claim => ACTIVE_STATUSES.includes(claim.status)).length,
        receiptCount: memberReceipts.length,
        receiptSpend: memberReceipts.reduce((sum, item) => sum + item.amount, 0),
        paidAmount: memberClaims.reduce((sum, claim) => sum + claim.paidAmount, 0),
        reimbursedThisWeek,
      };
    })
    .sort((a, b) => b.receiptSpend - a.receiptSpend || a.name.localeCompare(b.name));

  const categoryMap = new Map<string, TeamCategoryAnalytics>();
  teamReceiptItems.forEach(item => {
    const existing = categoryMap.get(item.category) || {
      name: item.category,
      amount: 0,
      receiptCount: 0,
    };
    existing.amount += item.amount;
    existing.receiptCount += 1;
    categoryMap.set(item.category, existing);
  });

  return {
    members: memberRollups,
    categories: Array.from(categoryMap.values()).sort((a, b) => b.amount - a.amount),
    totalClaims: teamClaims.length,
    pendingClaims: teamClaims.filter(claim => ACTIVE_STATUSES.includes(claim.status)).length,
    receiptCount: teamReceiptItems.length,
    receiptSpend: teamReceiptItems.reduce((sum, item) => sum + item.amount, 0),
    reimbursedThisWeek: memberRollups.reduce((sum, member) => sum + member.reimbursedThisWeek, 0),
  };
}
