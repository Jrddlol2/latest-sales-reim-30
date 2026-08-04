import { MOM } from '../types';
import { ExportSection, buildStructuredPdfBlob, exportStructuredPdf, exportStructuredWord } from './documentExport';
import { formatContactsDisplay } from './momContacts';

function filename(mom: MOM, extension: string) {
  const safe = (mom.companyName || 'meeting').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `MOM-${safe || 'meeting'}-${mom.meetingDate || 'undated'}.${extension}`;
}

// The client-facing copy hides internal-only classification. Right now that's
// just Type of Account, but keep the list in one place so it's easy to extend.
const INTERNAL_ONLY_ROWS = new Set(['Type of Account']);

// `audience: 'client'` produces the version we send to the client; 'internal'
// (default) is the preparer's own full copy. Exported so the on-screen client
// preview renders the exact same content that gets exported/sent.
export function momSections(mom: MOM, audience: 'internal' | 'client' = 'internal'): ExportSection[] {
  const meetingRows: [string, string][] = [
    ['Date of Meeting', mom.meetingDate || '—'],
    ['Purpose of Meeting', mom.purposeOfMeeting || '—'],
    ['Location of Meeting', mom.location || '—'],
    ['Type of Account', mom.typeOfAccount || '—'],
    ['Contact Person', formatContactsDisplay(mom.contactPerson, mom.contactPersonDesignation) || '—'],
    ['Client Email', mom.contactPersonEmail || '—'],
    ['Prepared By', mom.preparedBy || '—'],
  ];
  return [
    {
      heading: 'Meeting Details',
      rows: audience === 'client'
        ? meetingRows.filter(([label]) => !INTERNAL_ONLY_ROWS.has(label))
        : meetingRows,
    },
    { heading: 'Discussion', paragraphs: [mom.description || mom.summary || '—'] },
    { heading: 'Agreements', paragraphs: [mom.agreements || '—'] },
    { heading: 'Action Items', paragraphs: [mom.actionItems || '—'] },
  ];
}

export function exportMomWord(mom: MOM, audience: 'internal' | 'client' = 'internal') {
  exportStructuredWord(
    filename(mom, 'doc').replace(/\.doc$/, '') + (audience === 'client' ? '-client' : ''),
    mom.documentType === 'LOA' ? 'Letter of Agreement' : 'Minutes of Meeting',
    mom.companyName || 'Untitled meeting',
    momSections(mom, audience),
  );
}

export async function exportMomPdf(mom: MOM, audience: 'internal' | 'client' = 'internal') {
  await exportStructuredPdf(
    filename(mom, 'pdf').replace(/\.pdf$/, '') + (audience === 'client' ? '-client' : ''),
    mom.documentType === 'LOA' ? 'Letter of Agreement' : 'Minutes of Meeting',
    mom.companyName || 'Untitled meeting',
    momSections(mom, audience),
  );
}

/**
 * Same PDF bytes exportMomPdf saves to disk, returned as a Blob instead —
 * lets the client-copy preview modal render the literal PDF that "Send to
 * client" would attach, rather than a separate HTML approximation of it.
 */
export async function buildMomPdfBlob(mom: MOM, audience: 'internal' | 'client' = 'internal'): Promise<Blob> {
  return buildStructuredPdfBlob(
    mom.documentType === 'LOA' ? 'Letter of Agreement' : 'Minutes of Meeting',
    mom.companyName || 'Untitled meeting',
    momSections(mom, audience),
  );
}
