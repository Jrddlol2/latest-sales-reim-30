import { Claim, ExpenseLineItem, MOM } from '../types';
import { ExportSection, exportStructuredPdf, exportStructuredWord } from './documentExport';
import { formatContactsDisplay } from './momContacts';

const money = (value?: number) =>
  `PHP ${(Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function claimSections(
  claim: Claim,
  items: ExpenseLineItem[],
  mom: MOM | undefined,
  requestorName: string,
): ExportSection[] {
  const sections: ExportSection[] = [
    {
      heading: 'Claim Summary',
      rows: [
        ['Reference', claim.ref],
        ['Request Type', claim.type],
        ['Requestor', requestorName],
        ['Status', claim.status],
        ['Purpose', claim.purpose],
        ['Client', claim.client || '—'],
        ['Date Filed', claim.submittedAt || claim.createdAt],
        ['Claimed Amount', money(claim.claimedAmount)],
        ['Maximum Reimbursable', money(claim.approvedAmount ?? Math.min(claim.claimedAmount, 1000))],
        ['Paid Amount', money(claim.paidAmount)],
      ],
    },
    {
      heading: 'Expense Line Items',
      paragraphs: items.length
        ? items.map((item, index) =>
          `${index + 1}. ${item.expenseDate} | ${item.category} | ${item.vendor} | OR ${item.orNumber || '—'} | ${item.paymentMethod} | ${money(item.amount)}\n${item.businessPurpose || '—'}`
        )
        : ['No expense line items.'],
    },
  ];

  if (mom) {
    sections.push(
      {
        heading: 'Meeting Details',
        rows: [
          ['Company', mom.companyName || '—'],
          ['Date of Meeting', mom.meetingDate || '—'],
          ['Location of Meeting', mom.location || '—'],
          ['Purpose of Meeting', mom.purposeOfMeeting || '—'],
          ['Contact Person', formatContactsDisplay(mom.contactPerson, mom.contactPersonDesignation) || '—'],
          ['Client Email', mom.contactPersonEmail || '—'],
          ['Prepared By', mom.preparedBy || '—'],
        ],
      },
      { heading: 'Discussion', paragraphs: [mom.description || mom.summary || '—'] },
      { heading: 'Agreements', paragraphs: [mom.agreements || '—'] },
      { heading: 'Action Items', paragraphs: [mom.actionItems || '—'] },
    );
  }

  return sections;
}

export function exportClaimWord(
  claim: Claim,
  items: ExpenseLineItem[],
  mom: MOM | undefined,
  requestorName: string,
) {
  exportStructuredWord(
    `Claim-${claim.ref}`,
    'Reimbursement Claim',
    `${claim.ref} — ${claim.purpose}`,
    claimSections(claim, items, mom, requestorName),
  );
}

export async function exportClaimPdf(
  claim: Claim,
  items: ExpenseLineItem[],
  mom: MOM | undefined,
  requestorName: string,
) {
  await exportStructuredPdf(
    `Claim-${claim.ref}`,
    'Reimbursement Claim',
    `${claim.ref} — ${claim.purpose}`,
    claimSections(claim, items, mom, requestorName),
  );
}
