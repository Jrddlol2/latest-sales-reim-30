import { MOM } from '../types';

const escapeHtml = (value?: string) =>
  (value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function momDocument(mom: MOM): string {
  const row = (label: string, value?: string) =>
    `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value || '—')}</td></tr>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Minutes of Meeting</title>
<style>
body{font-family:Arial,sans-serif;color:#172033;max-width:820px;margin:40px auto;line-height:1.5}
h1{color:#123b72;margin-bottom:4px} .subtitle{color:#667085;margin-bottom:28px}
table{border-collapse:collapse;width:100%;margin:18px 0}th,td{border:1px solid #d0d5dd;padding:10px;text-align:left;vertical-align:top}
th{width:210px;background:#f2f4f7;color:#344054}section{margin-top:24px}h2{font-size:16px;color:#123b72;border-bottom:2px solid #123b72;padding-bottom:5px}
p{white-space:pre-wrap}
@media print{body{margin:0.45in}}
</style></head><body>
<h1>${mom.documentType === 'LOA' ? 'Letter of Agreement' : 'Minutes of Meeting'}</h1>
<div class="subtitle">${escapeHtml(mom.companyName || 'Untitled meeting')}</div>
<table>
${row('Date of Meeting', mom.meetingDate)}
${row('Purpose of Meeting', mom.purposeOfMeeting)}
${row('Location of Meeting', mom.location)}
${row('Type of Account', mom.typeOfAccount)}
${row('Contact Person', mom.contactPerson)}
${row('Client Email', mom.contactPersonEmail)}
${row('Prepared By', mom.preparedBy)}
</table>
<section><h2>Discussion</h2><p>${escapeHtml(mom.description || mom.summary || '—')}</p></section>
<section><h2>Agreements</h2><p>${escapeHtml(mom.agreements || '—')}</p></section>
<section><h2>Action Items</h2><p>${escapeHtml(mom.actionItems || '—')}</p></section>
</body></html>`;
}

function filename(mom: MOM, extension: string) {
  const safe = (mom.companyName || 'meeting').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `MOM-${safe || 'meeting'}-${mom.meetingDate || 'undated'}.${extension}`;
}

export function exportMomWord(mom: MOM) {
  const blob = new Blob([momDocument(mom)], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename(mom, 'doc');
  link.click();
  URL.revokeObjectURL(url);
}

export function exportMomPdf(mom: MOM) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Allow pop-ups to export this MOM as PDF.');
  popup.opener = null;
  popup.document.open();
  popup.document.write(momDocument(mom));
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 250);
}
