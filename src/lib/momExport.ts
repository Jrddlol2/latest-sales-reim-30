import { MOM } from '../types';
import { ExportSection, exportStructuredPdf, exportStructuredWord } from './documentExport';

function filename(mom: MOM, extension: string) {
  const safe = (mom.companyName || 'meeting').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `MOM-${safe || 'meeting'}-${mom.meetingDate || 'undated'}.${extension}`;
}

function momSections(mom: MOM): ExportSection[] {
  return [
    {
      heading: 'Meeting Details',
      rows: [
        ['Date of Meeting', mom.meetingDate || '—'],
        ['Purpose of Meeting', mom.purposeOfMeeting || '—'],
        ['Location of Meeting', mom.location || '—'],
        ['Type of Account', mom.typeOfAccount || '—'],
        ['Contact Person', mom.contactPerson || '—'],
        ['Client Email', mom.contactPersonEmail || '—'],
        ['Prepared By', mom.preparedBy || '—'],
      ],
    },
    { heading: 'Discussion', paragraphs: [mom.description || mom.summary || '—'] },
    { heading: 'Agreements', paragraphs: [mom.agreements || '—'] },
    { heading: 'Action Items', paragraphs: [mom.actionItems || '—'] },
  ];
}

export function exportMomWord(mom: MOM) {
  exportStructuredWord(
    filename(mom, 'doc').replace(/\.doc$/, ''),
    mom.documentType === 'LOA' ? 'Letter of Agreement' : 'Minutes of Meeting',
    mom.companyName || 'Untitled meeting',
    momSections(mom),
  );
}

export async function exportMomPdf(mom: MOM) {
  await exportStructuredPdf(
    filename(mom, 'pdf').replace(/\.pdf$/, ''),
    mom.documentType === 'LOA' ? 'Letter of Agreement' : 'Minutes of Meeting',
    mom.companyName || 'Untitled meeting',
    momSections(mom),
  );
}
