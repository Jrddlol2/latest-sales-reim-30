import { ReactNode } from 'react';
import { Modal } from './Modal';
import { MOM, MomDocumentType } from '../../types';
import { momSections } from '../../lib/momExport';

interface MomClientPreviewModalProps {
  mom: MOM;
  onClose: () => void;
  /** Action buttons rendered in the footer — differs between the create form (export only) and the saved record (export + send). */
  footer?: ReactNode;
}

// Shared by CreateMom (checking before you save) and MomDetail (checking
// before you send) so both show the exact same rendering of the client copy.
export function MomClientPreviewModal({ mom, onClose, footer }: MomClientPreviewModalProps) {
  const docType: MomDocumentType = mom.documentType === 'LOA' ? 'LOA' : 'MoM';
  const clientRecipients = (mom.contactPersonEmail || '').split(',').map(e => e.trim()).filter(Boolean);
  const clientSections = momSections(mom, 'client');

  return (
    <Modal isOpen onClose={onClose} titleId="client-preview-title" className="max-w-2xl">
      <div className="bg-surface-container-lowest rounded-xl w-full shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant p-5">
          <div className="min-w-0">
            <h3 id="client-preview-title" className="font-headline-sm text-on-surface">Client copy preview</h3>
            <p className="text-xs text-outline mt-1">This is exactly what the client receives — internal fields like Type of Account are left out.</p>
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

        {/* WYSIWYG of the client-facing document */}
        <div className="overflow-y-auto p-6 space-y-5">
          <div className="text-center border-b border-outline-variant pb-4">
            <p className="text-label-sm uppercase tracking-wider text-outline">{docType === 'LOA' ? 'Letter of Agreement' : 'Minutes of Meeting'}</p>
            <h4 className="font-headline-md text-on-surface mt-1">{mom.companyName || 'Untitled meeting'}</h4>
          </div>
          {clientSections.map(section => (
            <section key={section.heading}>
              <h5 className="text-label-sm font-bold uppercase tracking-wider text-primary mb-2">{section.heading}</h5>
              {section.rows && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {section.rows.map(([label, value]) => (
                    <div key={label} className="flex flex-col">
                      <dt className="text-xs text-outline">{label}</dt>
                      <dd className="text-body-sm text-on-surface font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {section.paragraphs && section.paragraphs.map((p, i) => (
                <p key={i} className="text-body-sm text-on-surface-variant whitespace-pre-wrap">{p}</p>
              ))}
            </section>
          ))}
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
