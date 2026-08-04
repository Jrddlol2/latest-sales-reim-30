import { useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { MomClientPreviewModal } from '../../components/shared/MomClientPreviewModal';
import { useAppContext } from '../../components/AppContext';
import { uploadUrl, sendMomToClient } from '../../lib/api';
import { formatDateTime } from '../../lib/date';
import { DOCUMENT_TYPE_LABEL, MomDocumentType } from '../../types';
import { exportMomPdf, exportMomWord } from '../../lib/momExport';
import { contactsFromMom } from '../../lib/momContacts';
import { useToast } from '../../components/shared/ToastContext';

export function MomDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { moms, claims, currentUser, users } = useAppContext();
  const { addToast } = useToast();
  const [exporting, setExporting] = useState<'pdf' | 'word' | null>(null);
  const [showClientPreview, setShowClientPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const exportMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenuRef = useRef<HTMLDetailsElement>(null);

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
  // Mirrors the PUT /api/moms/:id guard: the owner, or the owner's approver, can
  // edit — so the client's minutes can be corrected before (or after) sending.
  const owner = users.find(u => u.id === mom.requestorId);
  const canEdit = mom.requestorId === currentUser.id || (Boolean(owner) && owner!.reportsTo === currentUser.id);
  // The server's /send route is owner-only.
  const isOwner = mom.requestorId === currentUser.id;
  const clientRecipients = (mom.contactPersonEmail || '').split(',').map(e => e.trim()).filter(Boolean);
  const clientContacts = contactsFromMom(mom.contactPerson, mom.contactPersonDesignation);
  const fileUrl = uploadUrl(mom.fileUrl);
  const showAttachment = Boolean(fileUrl);

  const internalParticipants = mom.participantsInternal?.split(',').map(p => p.trim()).filter(Boolean) || [];
  const externalParticipants = mom.participantsExternal?.split(',').map(p => p.trim()).filter(Boolean) || [];
  const handleExport = async (format: 'pdf' | 'word', audience: 'internal' | 'client' = 'internal') => {
    exportMenuRef.current?.removeAttribute('open');
    setExporting(format);
    try {
      if (format === 'pdf') await exportMomPdf(mom, audience);
      else exportMomWord(mom, audience);
      const copyLabel = audience === 'client' ? 'client copy' : 'your copy';
      addToast(`${DOCUMENT_TYPE_LABEL[docType]} exported as ${format === 'pdf' ? 'PDF' : 'Word'} (${copyLabel}).`, 'success');
    } catch (error: any) {
      addToast(error?.message || 'Could not export this document.', 'error');
    } finally {
      setExporting(null);
    }
  };

  const handleSendToClient = async () => {
    if (clientRecipients.length === 0) {
      addToast('Add a client email to this record before sending.', 'error');
      return;
    }
    setSending(true);
    try {
      await sendMomToClient(mom.id);
      setSent(true);
      addToast(`Client copy sent to ${clientRecipients.join(', ')}.`, 'success');
    } catch (error: any) {
      addToast(error?.message || 'Could not send the client copy.', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <nav className="flex gap-2 text-on-surface-variant font-label-sm">
        <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/moms')}>Minutes &amp; Agreements</span>
        <span>/</span>
        <span className="text-on-surface font-semibold">{mom.companyName || 'Untitled meeting'}</span>
      </nav>

      <Card className="overflow-hidden">
        <CardHeader className="flex-col lg:flex-row items-start lg:items-center gap-4 bg-surface-container-low/60 border-b border-outline-variant">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-headline-md font-semibold text-brand-slate">
                {mom.companyName || 'Unknown Company'}
              </h2>
              <span
                title={DOCUMENT_TYPE_LABEL[docType]}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${docType === 'LOA' ? 'bg-tertiary-container/50 text-tertiary' : 'bg-primary-container/40 text-on-primary-container'}`}
              >
                {docType === 'LOA' ? 'LOA' : 'MoM'}
              </span>
              <span className="inline-flex items-center rounded-md bg-surface-container-highest px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                {mom.status === 'Completed' ? 'Finalized' : (mom.status || 'Draft')}
              </span>
            </div>
            <p className="text-body-sm text-outline mt-1">
              {mom.typeOfAccount || mom.preparedBy} &bull; {dateStr}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {linkedClaim && (
              <Button className="gap-2" onClick={() => navigate(`/claims/${linkedClaim.id}`)}>
                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                View Claim
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" className="gap-2" onClick={() => navigate(`/moms/${mom.id}/edit`)}>
                <span className="material-symbols-outlined text-[18px]">edit</span>
                Edit
              </Button>
            )}
            <Button variant="outline" className="gap-2" onClick={() => setShowClientPreview(true)}>
              <span className="material-symbols-outlined text-[18px]">visibility</span>
              Preview client copy
            </Button>
            <details ref={exportMenuRef} className="relative">
              <summary className="list-none inline-flex h-10 cursor-pointer items-center gap-2 rounded-btn border border-outline-variant bg-white px-4 font-label-md text-on-surface hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="material-symbols-outlined text-[18px]">download</span>
                {exporting ? 'Exporting…' : 'Export'}
                <span className="material-symbols-outlined text-[17px]">expand_more</span>
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-outline-variant bg-white p-1.5 shadow-lg">
                <p className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-outline">Your copy</p>
                <button disabled={exporting !== null} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-container-low disabled:opacity-50" onClick={() => handleExport('pdf', 'internal')}>
                  <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>PDF document
                </button>
                <button disabled={exporting !== null} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-container-low disabled:opacity-50" onClick={() => handleExport('word', 'internal')}>
                  <span className="material-symbols-outlined text-[18px]">description</span>Word document
                </button>
                <div className="my-1.5 border-t border-outline-variant" />
                <p className="px-3 pt-0.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-outline">Client copy</p>
                <p className="px-3 pb-1.5 text-[11px] text-outline">Omits Type of Account.</p>
                <button disabled={exporting !== null} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-container-low disabled:opacity-50" onClick={() => handleExport('pdf', 'client')}>
                  <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>PDF for client
                </button>
                <button disabled={exporting !== null} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-container-low disabled:opacity-50" onClick={() => handleExport('word', 'client')}>
                  <span className="material-symbols-outlined text-[18px]">description</span>Word for client
                </button>
              </div>
            </details>
            {fileUrl && (
              <details ref={moreMenuRef} className="relative">
                <summary aria-label="More actions" className="list-none inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-btn border border-outline-variant bg-white text-on-surface hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="material-symbols-outlined">more_vert</span>
                </summary>
                <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-lg border border-outline-variant bg-white p-1.5 shadow-lg">
                  <a href={fileUrl} target="_blank" rel="noreferrer" onClick={() => moreMenuRef.current?.removeAttribute('open')} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-container-low">
                    <span className="material-symbols-outlined text-[18px]">open_in_new</span>Open original file
                  </a>
                  <a href={fileUrl} download={mom.fileName} onClick={() => moreMenuRef.current?.removeAttribute('open')} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-container-low">
                    <span className="material-symbols-outlined text-[18px]">download</span>Download original
                  </a>
                </div>
              </details>
            )}
          </div>
        </CardHeader>
        <CardContent>

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
              <h3 className="text-label-sm uppercase tracking-wider text-outline mb-3">{clientContacts.length > 1 ? 'Contact Persons' : 'Contact Person'}</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                <div>
                  <dt className="text-label-sm text-outline">Name & Designation</dt>
                  <dd className="text-body-base font-medium mt-1">
                    {clientContacts.length > 0 ? (
                      <ul className="space-y-1">
                        {clientContacts.map((contact, i) => (
                          <li key={i}>{contact.name}{contact.designation ? ` (${contact.designation})` : ''}</li>
                        ))}
                      </ul>
                    ) : '-'}
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
              <div className="space-y-4 bg-surface-container-lowest border border-brand-border rounded-btn p-4">
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

          {showAttachment && (
            <section className="mt-6 border-t border-outline-variant pt-6">
              <h3 className="text-label-sm uppercase tracking-wider text-outline mb-3">Supporting file</h3>
              <div className="flex flex-col gap-3 rounded-btn border border-brand-border bg-surface-container-lowest p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="material-symbols-outlined rounded-lg bg-primary/10 p-2 text-primary">description</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{mom.fileName || 'Attached meeting document'}</p>
                    <p className="text-xs text-outline">Uploaded minutes · Opens in a new tab</p>
                  </div>
                </div>
                <a href={fileUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-outline-variant px-3 text-xs font-semibold text-on-surface hover:bg-surface-container-low">
                  <span className="material-symbols-outlined text-[17px]">open_in_new</span>
                  Open file
                </a>
              </div>
            </section>
          )}

        </CardContent>
      </Card>

      {showClientPreview && (
        <MomClientPreviewModal
          mom={mom}
          onClose={() => setShowClientPreview(false)}
          footer={
            <>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1" disabled={exporting !== null} onClick={() => handleExport('pdf', 'client')}>
                  <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span> PDF
                </Button>
                <Button variant="outline" size="sm" className="gap-1" disabled={exporting !== null} onClick={() => handleExport('word', 'client')}>
                  <span className="material-symbols-outlined text-[16px]">description</span> Word
                </Button>
              </div>
              {isOwner && (
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={sending || sent || clientRecipients.length === 0}
                  onClick={handleSendToClient}
                >
                  <span className="material-symbols-outlined text-[16px]">{sent ? 'check' : 'send'}</span>
                  {sent ? 'Sent' : sending ? 'Sending…' : 'Send to client'}
                </Button>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
