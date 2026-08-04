import { ReactNode, useEffect, useState } from 'react';
import { Modal } from './Modal';
import { MOM } from '../../types';
import { buildMomPdfBlob } from '../../lib/momExport';

interface MomClientPreviewModalProps {
  mom: MOM;
  onClose: () => void;
  /** Action buttons rendered in the footer — differs between the create form (export only) and the saved record (export + send). */
  footer?: ReactNode;
}

// Shared by CreateMom (checking before you save) and MomDetail (checking
// before you send) so both show the exact same rendering of the client copy.
// Renders the literal PDF buildMomPdfBlob() produces — the same bytes
// "Export -> PDF for client" saves to disk — rather than an HTML
// approximation, since only the PDF copy is what actually gets emailed.
export function MomClientPreviewModal({ mom, onClose, footer }: MomClientPreviewModalProps) {
  const clientRecipients = (mom.contactPersonEmail || '').split(',').map(e => e.trim()).filter(Boolean);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Regenerates on every mom change (e.g. live edits in CreateMom's form)
  // rather than memoizing past it, so the preview never goes stale.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setPdfUrl(null);
    setError(null);

    buildMomPdfBlob(mom, 'client')
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError('Could not generate the PDF preview.');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mom]);

  return (
    <Modal isOpen onClose={onClose} titleId="client-preview-title" className="max-w-3xl">
      <div className="bg-surface-container-lowest rounded-xl w-full shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant p-5">
          <div className="min-w-0">
            <h3 id="client-preview-title" className="font-headline-sm text-on-surface">Client copy preview</h3>
            <p className="text-xs text-outline mt-1">This is the exact PDF the client receives — internal fields like Type of Account are left out.</p>
          </div>
          <button aria-label="Close preview" onClick={onClose} className="text-outline hover:text-on-surface">
            <span aria-hidden="true" className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-outline-variant bg-surface-container-low/50">
          <p className="text-label-sm uppercase tracking-wider text-outline mb-1.5">Recipients</p>
          {clientRecipients.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {clientRecipients.map(email => (
                <span key={email} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-2.5 py-1 text-xs font-semibold">
                  <span className="material-symbols-outlined text-[14px]">mail</span>{email}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-tertiary">No client email added yet — this record won't be sendable until you add one.</p>
          )}
        </div>

        <div className="flex-1 min-h-[70vh] bg-surface-container-low">
          {error ? (
            <div className="flex h-full min-h-[70vh] items-center justify-center p-6 text-center text-body-sm text-error">{error}</div>
          ) : pdfUrl ? (
            <iframe title="Client copy PDF preview" src={pdfUrl} className="w-full h-full min-h-[70vh] border-0" />
          ) : (
            <div className="flex h-full min-h-[70vh] items-center justify-center p-6 text-center text-body-sm text-outline">Generating preview…</div>
          )}
        </div>

        {footer && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant p-4">
            {footer}
          </div>
        )}
      </div>
    </Modal>
  );
}
