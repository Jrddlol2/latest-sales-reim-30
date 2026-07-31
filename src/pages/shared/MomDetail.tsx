import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useAppContext } from '../../components/AppContext';
import { uploadUrl } from '../../lib/api';
import { formatDateTime } from '../../lib/date';
import { DOCUMENT_TYPE_LABEL, MomDocumentType } from '../../types';
import { exportMomPdf, exportMomWord } from '../../lib/momExport';
import { useToast } from '../../components/shared/ToastContext';

export function MomDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { moms, claims } = useAppContext();
  const { addToast } = useToast();

  const mom = moms.find(m => m.id === id);

  if (!mom) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <nav className="flex gap-2 text-on-surface-variant font-label-sm">
          <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/moms')}>Minutes &amp; Agreements</span>
        </nav>
        <Card className="p-12 text-center text-outline">
          <span className="material-symbols-outlined text-[48px] mb-3">meeting_room</span>
          <p className="font-headline-sm text-on-surface mb-1">Not found</p>
          <p className="text-sm">This record doesn't exist, or you don't have access to it.</p>
        </Card>
      </div>
    );
  }

  const dateStr = mom.meetingDate ? formatDateTime(mom.meetingDate) : 'No date specified';
  const docType: MomDocumentType = mom.documentType === 'LOA' ? 'LOA' : 'MoM';
  const linkedClaim = mom.claimId ? claims.find(c => c.id === mom.claimId) : undefined;
  const fileUrl = uploadUrl(mom.fileUrl);
  const showAttachment = Boolean(fileUrl);

  const internalParticipants = mom.participantsInternal?.split(',').map(p => p.trim()).filter(Boolean) || [];
  const externalParticipants = mom.participantsExternal?.split(',').map(p => p.trim()).filter(Boolean) || [];
  const exportWord = () => {
    const escape = (value?: string) => String(value || '-')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(mom.companyName)}</title>
      <style>body{font-family:Arial,sans-serif;color:#172033;line-height:1.5;margin:40px}h1{color:#034fc7}h2{font-size:14px;text-transform:uppercase;color:#667085;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:24px}table{border-collapse:collapse;width:100%}td{padding:7px;border-bottom:1px solid #eee;vertical-align:top}td:first-child{font-weight:bold;width:180px}</style>
      </head><body><h1>${escape(DOCUMENT_TYPE_LABEL[docType])}</h1>
      <h2>Meeting Details</h2><table>
      <tr><td>Company</td><td>${escape(mom.companyName)}</td></tr>
      <tr><td>Date of Meeting</td><td>${escape(mom.meetingDate?.split('T')[0])}</td></tr>
      <tr><td>Location of Meeting</td><td>${escape(mom.location)}</td></tr>
      <tr><td>Purpose</td><td>${escape(mom.purposeOfMeeting)}</td></tr>
      <tr><td>Contact Person</td><td>${escape(mom.contactPerson)}</td></tr>
      <tr><td>Contact Email</td><td>${escape(mom.contactPersonEmail)}</td></tr>
      <tr><td>Prepared By</td><td>${escape(mom.preparedBy)}</td></tr></table>
      <h2>Discussion</h2><p>${escape(mom.description || mom.summary)}</p>
      <h2>Agreements</h2><p>${escape(mom.agreements)}</p>
      <h2>Action Items</h2><p>${escape(mom.actionItems)}</p>
      </body></html>`;
    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(mom.companyName || 'meeting-minutes').replace(/[^a-z0-9]+/gi, '-')}.doc`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <nav className="flex gap-2 text-on-surface-variant font-label-sm">
        <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/moms')}>Minutes &amp; Agreements</span>
        <span>/</span>
        <span className="text-on-surface font-semibold">{mom.companyName || 'Untitled meeting'}</span>
      </nav>

      <Card className="overflow-hidden">
        <CardHeader className="flex-col xl:flex-row items-start xl:items-center gap-5 bg-surface-container-low/60 border-b border-outline-variant">
          <div>
            <h2 className="text-headline-md font-semibold text-brand-slate">
              {mom.companyName || 'Unknown Company'}
            </h2>
            <p className="text-body-sm text-outline mt-1">
              {mom.typeOfAccount || mom.preparedBy} &bull; {dateStr}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="gap-2" onClick={exportWord}>
              <span className="material-symbols-outlined text-[18px]">download</span>
              Export document
            </Button>
            <span
              title={DOCUMENT_TYPE_LABEL[docType]}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-[6px] text-[12px] font-bold uppercase tracking-wider ${docType === 'LOA' ? 'bg-tertiary-container/50 text-tertiary' : 'bg-primary-container/40 text-on-primary-container'}`}
            >
              <span className="material-symbols-outlined text-[15px]">{docType === 'LOA' ? 'handshake' : 'description'}</span>
              {DOCUMENT_TYPE_LABEL[docType]}
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-[6px] text-[12px] font-bold uppercase tracking-wider bg-surface-container-highest text-on-surface-variant">
              {mom.status || 'Draft'}
            </span>
            {linkedClaim && (
              <Button variant="outline" className="gap-2" onClick={() => navigate(`/claims/${linkedClaim.id}`)}>
                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                View Claim ({linkedClaim.ref})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className={showAttachment ? "grid grid-cols-1 md:grid-cols-2 gap-8" : "block"}>

          <div className="space-y-6">
            <section>
              <h3 className="text-label-sm uppercase tracking-wider text-outline mb-3">Meeting Details</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                <div>
                  <dt className="text-label-sm text-outline">Purpose</dt>
                  <dd className="text-body-base font-medium mt-1">{mom.purposeOfMeeting || '-'}</dd>
                </div>
                <div>
                  <dt className="text-label-sm text-outline">Location of Meeting</dt>
                  <dd className="text-body-base font-medium mt-1">{mom.location || '-'}</dd>
                </div>
                <div>
                  <dt className="text-label-sm text-outline">Meeting Type</dt>
                  <dd className="text-body-base font-medium mt-1">{mom.meetingType || '-'}</dd>
                </div>
                <div>
                  <dt className="text-label-sm text-outline">Category</dt>
                  <dd className="text-body-base font-medium mt-1">{mom.category || '-'}</dd>
                </div>
                <div>
                  <dt className="text-label-sm text-outline">Prepared By</dt>
                  <dd className="text-body-base font-medium mt-1">{mom.preparedBy || '-'}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h3 className="text-label-sm uppercase tracking-wider text-outline mb-3">Contact Person</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                <div>
                  <dt className="text-label-sm text-outline">Name & Designation</dt>
                  <dd className="text-body-base font-medium mt-1">
                    {mom.contactPerson || '-'}
                    {mom.contactPersonDesignation ? ` (${mom.contactPersonDesignation})` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-label-sm text-outline">Email</dt>
                  <dd className="text-body-base font-medium mt-1">{mom.contactPersonEmail || '-'}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h3 className="text-label-sm uppercase tracking-wider text-outline mb-3">Participants</h3>
              <div className="space-y-3">
                <div>
                  <span className="text-label-sm text-outline block mb-2">Internal</span>
                  {internalParticipants.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {internalParticipants.map((p, i) => (
                        <span key={i} className="px-3 py-1 bg-surface-container-high rounded-full text-label-sm">
                          {p}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-body-sm text-outline">None listed</span>
                  )}
                </div>
                <div>
                  <span className="text-label-sm text-outline block mb-2">External</span>
                  {externalParticipants.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {externalParticipants.map((p, i) => (
                        <span key={i} className="px-3 py-1 bg-surface-container-high rounded-full text-label-sm border border-brand-border">
                          {p}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-body-sm text-outline">None listed</span>
                  )}
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-label-sm uppercase tracking-wider text-outline mb-3">Discussion & Outcomes</h3>
              <div className="space-y-4 bg-surface-container-lowest border border-brand-border rounded-[10px] p-4">
                <div>
                  <h4 className="text-label-sm font-semibold mb-1">Summary / Description</h4>
                  <p className="text-body-sm text-on-surface-variant whitespace-pre-wrap">{mom.description || mom.summary || 'No description provided.'}</p>
                </div>

                {mom.agreements && (
                  <div>
                    <h4 className="text-label-sm font-semibold mb-1">Agreements</h4>
                    <p className="text-body-sm text-on-surface-variant whitespace-pre-wrap">{mom.agreements}</p>
                  </div>
                )}

                {mom.actionItems && (
                  <div>
                    <h4 className="text-label-sm font-semibold mb-1">Action Items</h4>
                    <p className="text-body-sm text-on-surface-variant whitespace-pre-wrap">{mom.actionItems}</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          {showAttachment && <div className="space-y-6">
             <section className="h-full flex flex-col">
                <h3 className="text-label-sm uppercase tracking-wider text-outline mb-3">Attached Document</h3>

                {fileUrl ? (
                  <div className="flex flex-col flex-1 border border-brand-border rounded-[10px] overflow-hidden bg-surface-container-low min-h-[400px]">
                    <div className="p-3 border-b border-brand-border flex items-center justify-between bg-surface-container-lowest">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-outline">description</span>
                        <span className="text-label-sm font-medium truncate max-w-[200px] sm:max-w-[300px]">
                          {mom.fileName || 'document.pdf'}
                        </span>
                      </div>
                      <a href={fileUrl} target="_blank" rel="noreferrer" download={mom.fileName}>
                        <Button size="sm" variant="outline" className="gap-2">
                          <span className="material-symbols-outlined text-[16px]">download</span>
                          Download
                        </Button>
                      </a>
                    </div>

                    <div className="flex-1 flex items-center justify-center p-4">
                      {mom.fileName?.match(/\.(jpeg|jpg|gif|png)$/i) ? (
                        <img src={fileUrl} alt="Attachment Preview" className="max-w-full max-h-full object-contain rounded" />
                      ) : mom.fileName?.match(/\.pdf$/i) ? (
                        <iframe title="MOM attachment" src={fileUrl} className="w-full h-full min-h-[350px] rounded border border-brand-border" />
                      ) : (
                        <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center bg-surface-container rounded border border-brand-border border-dashed text-center text-outline">
                          <span className="material-symbols-outlined text-[48px] mb-2 opacity-50">description</span>
                          <p className="text-body-sm">Preview not available for this file type.</p>
                          <p className="text-[12px] mt-1">Use Download to open it.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-[200px] border border-brand-border border-dashed rounded-[10px] bg-surface-container-low flex flex-col items-center justify-center p-6 text-center text-outline">
                    <span className="material-symbols-outlined text-[32px] mb-2 opacity-50">draft</span>
                    <p className="text-body-sm font-medium">No file attached</p>
                    <p className="text-[12px] mt-1 max-w-[250px]">
                      This MOM was created via the template form — the fields on the left are the record.
                    </p>
                  </div>
                )}
             </section>
          </div>}

        </CardContent>
      </Card>
    </div>
  );
}
