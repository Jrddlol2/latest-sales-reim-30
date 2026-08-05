import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input, Label, Select } from '../../components/ui/Input';
import { DynamicFieldRenderer } from '../../components/shared/DynamicFieldRenderer';
import { MomClientPreviewModal } from '../../components/shared/MomClientPreviewModal';
import { ContactPersonsField } from '../../components/shared/ContactPersonsField';
import { CompanyPicker } from '../../components/shared/CompanyPicker';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { createMom, updateMom } from '../../lib/api';
import { validateDynamicFields } from '../../lib/dynamicFieldValidation';
import { exportMomPdf, exportMomWord } from '../../lib/momExport';
import { MomContact, contactsFromMom, serializeContacts, joinDesignations } from '../../lib/momContacts';
import { MOM, MomDocumentType, DOCUMENT_TYPE_LABEL, MinutesSource } from '../../types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The client copy can be sent to several attendees, so client emails are stored
// as a comma-separated list in the single contact_person_email column.
function splitEmails(value?: string): string[] {
  return (value || '').split(',').map(e => e.trim()).filter(Boolean);
}

export function CreateMom() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { companies, moms, currentUser, refresh, fieldDefinitions } = useAppContext();
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewExporting, setPreviewExporting] = useState<'pdf' | 'word' | null>(null);
  const clientEmailInputRef = useRef<HTMLInputElement>(null);

  const editing = moms.find(m => m.id === id);
  const isEdit = Boolean(id);

  const [documentType, setDocumentType] = useState<MomDocumentType>(
    editing?.documentType === 'LOA' ? 'LOA' : 'MoM',
  );
  const [customFields, setCustomFields] = useState<Record<string, string>>(editing?.customFields || {});
  const initialContacts = contactsFromMom(editing?.contactPerson, editing?.customFields?.contact_person_designation);
  const [contacts, setContacts] = useState<MomContact[]>(initialContacts.length ? initialContacts : [{ name: '', designation: '' }]);
  const [clientEmails, setClientEmails] = useState<string[]>(splitEmails(editing?.contactPersonEmail));
  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState('');
  const [form, setForm] = useState({
    client: editing?.companyName || '',
    purpose: editing?.purposeOfMeeting || '',
    meetingDate: editing?.meetingDate || new Date().toISOString().split('T')[0],
    location: editing?.location || '',
    discussion: editing?.description || '',
    actionItems: editing?.actionItems || '',
    ccClient: editing?.ccClient ?? false,
  });

  // Guard the edit route: only render the form once we've matched the record.
  const notFound = isEdit && !editing;

  const selectCompany = (name: string) => {
    const company = companies.find(item => item.name === name);
    setForm(current => ({
      ...current,
      client: name,
      location: current.location || company?.address || '',
    }));
    // Prefill the first contact's name from the directory only when it's still
    // blank — never overwrite what the user typed, and never touch designations.
    if (company?.contactPerson) {
      setContacts(current => {
        const [first, ...rest] = current.length ? current : [{ name: '', designation: '' }];
        if (first.name.trim()) return current;
        return [{ ...first, name: company.contactPerson || '' }, ...rest];
      });
    }
    // Deliberately do NOT prefill the client email from the company record —
    // the meeting contact is often a different person than the company's
    // default, and a wrong address would send the minutes to the wrong client.
  };

  const addEmail = (raw: string) => {
    const email = raw.trim().replace(/,$/, '');
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setEmailError(`"${email}" doesn't look like a valid email address.`);
      return;
    }
    if (clientEmails.some(e => e.toLowerCase() === email.toLowerCase())) {
      setEmailError(`${email} is already in the list.`);
      setEmailDraft('');
      return;
    }
    setClientEmails(current => [...current, email]);
    setEmailDraft('');
    setEmailError('');
  };

  const removeEmail = (email: string) =>
    setClientEmails(current => current.filter(e => e !== email));

  const emailFieldId = useMemo(() => `client-emails-${id || 'new'}`, [id]);

  // Lets the user check the exact client-facing document before it's saved.
  const previewMom: MOM = {
    id: id || 'preview',
    claimId: '',
    documentType,
    companyName: form.client,
    purposeOfMeeting: form.purpose,
    meetingDate: form.meetingDate,
    location: form.location,
    contactPerson: serializeContacts(contacts),
    contactPersonEmail: [...clientEmails, ...(emailDraft.trim() && EMAIL_RE.test(emailDraft.trim()) ? [emailDraft.trim()] : [])].join(', '),
    description: form.discussion,
    actionItems: form.actionItems,
    preparedBy: editing?.preparedBy || currentUser.name,
    typeOfAccount: customFields['type_of_account'],
    customFields,
  };

  const save = async (status: 'Draft' | 'Completed') => {
    if (!form.client.trim() || !form.purpose.trim() || !form.meetingDate) {
      addToast('Client, purpose, and date of meeting are required.', 'error');
      return;
    }
    // Validate the dynamic MoM fields exactly as DynamicFieldRenderer shows them
    // (entity 'mom', active, minus the excluded legacy designation column).
    const activeMomFields = fieldDefinitions.filter(
      fd => fd.entity === 'mom' && fd.active && fd.key !== 'contact_person_designation',
    );
    const { firstError } = validateDynamicFields(activeMomFields, customFields);
    if (firstError) {
      addToast(firstError.message, 'error');
      return;
    }
    // Fold a half-typed address in the box into the list before validating.
    const pending = emailDraft.trim().replace(/,$/, '');
    const emails = pending && EMAIL_RE.test(pending) && !clientEmails.includes(pending)
      ? [...clientEmails, pending]
      : clientEmails;
    if (form.ccClient && emails.length === 0) {
      addToast('Add at least one client email before enabling client notifications.', 'error');
      window.setTimeout(() => clientEmailInputRef.current?.focus(), 0);
      return;
    }
    setSaving(true);
    try {
      // contact_person_designation stays in sync as a comma-joined legacy
      // field for any consumer still reading the old single-designation shape.
      const mergedCustomFields = { ...customFields, contact_person_designation: joinDesignations(contacts) };
      const payload = {
        ...form,
        contactPerson: serializeContacts(contacts),
        contactPersonEmail: emails.join(', '),
        documentType,
        customFields: mergedCustomFields,
        status,
        source: MinutesSource.TEMPLATE,
      };
      if (isEdit && id) {
        await updateMom(id, payload);
      } else {
        await createMom(payload);
      }
      await refresh();
      if (pending) setEmailDraft('');
      addToast(
        isEdit
          ? 'Changes saved.'
          : status === 'Draft'
            ? `${DOCUMENT_TYPE_LABEL[documentType]} draft saved.`
            : `${DOCUMENT_TYPE_LABEL[documentType]} finalized.`,
        'success',
      );
      navigate(isEdit && id ? `/moms/${id}` : '/moms');
    } catch (error: any) {
      addToast(error?.message || 'Could not save the meeting record.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (notFound) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <Card className="p-12 text-center text-outline">
          <span className="material-symbols-outlined text-[48px] mb-3">meeting_room</span>
          <p className="font-headline-sm text-on-surface mb-1">Record not found</p>
          <p className="text-sm mb-4">This meeting record doesn't exist, or you don't have access to it.</p>
          <Button variant="outline" onClick={() => navigate('/moms')}>Back to Minutes &amp; Agreements</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">Personal meeting record</span>
          <h1 className="font-display text-display text-on-surface mt-1">
            {isEdit ? 'Edit Minutes or Agreement' : 'Create Minutes or Agreement'}
          </h1>
          <p className="text-body-md text-outline mt-1">
            {isEdit
              ? 'Update this record — for example if the client asks for a correction before you send it.'
              : 'This remains private unless you attach it to a filed claim.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setShowPreview(true)} disabled={!form.client.trim()}>
            <span className="material-symbols-outlined text-[18px]">visibility</span>
            Preview client copy
          </Button>
          <Button variant="outline" onClick={() => navigate(isEdit && id ? `/moms/${id}` : '/moms')}>Cancel</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">
          <div className="max-w-sm">
            <Label>Document Type</Label>
            <Select value={documentType} onChange={event => setDocumentType(event.target.value as MomDocumentType)}>
              <option value="MoM">Minutes of Meeting</option>
              <option value="LOA">Letter of Agreement</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label required htmlFor="mom-client">Client / Company</Label>
              <CompanyPicker
                id="mom-client"
                value={form.client}
                companies={companies}
                onSelectExisting={company => selectCompany(company.name)}
                onChangeText={name => setForm(current => ({ ...current, client: name }))}
                placeholder="Who did you meet with?"
              />
            </div>
            <div>
              <Label required>Purpose of Meeting</Label>
              <Input value={form.purpose} onChange={event => setForm(current => ({ ...current, purpose: event.target.value }))} />
            </div>
            <div>
              <Label required>Date of Meeting</Label>
              <Input type="date" value={form.meetingDate} onChange={event => setForm(current => ({ ...current, meetingDate: event.target.value }))} />
            </div>
            <div>
              <Label>Location of Meeting</Label>
              <Input value={form.location} onChange={event => setForm(current => ({ ...current, location: event.target.value }))} />
            </div>
          </div>

          <section className="pt-5 border-t border-outline-variant space-y-5">
            <div>
              <h2 className="font-headline-sm text-on-surface">Client contact</h2>
              <p className="text-body-sm text-outline mt-1">Keep the attendee and notification details together.</p>
            </div>
            <ContactPersonsField contacts={contacts} onChange={setContacts} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor={emailFieldId} required={form.ccClient}>Client Email(s) — who gets the client copy</Label>
                  {clientEmails.length > 0 && (
                    <span className="text-xs font-semibold text-primary">{clientEmails.length} added</span>
                  )}
                </div>
                <div className={`flex flex-wrap items-center gap-2 rounded-input border bg-white px-3 py-2 min-h-11 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary ${emailError || (form.ccClient && clientEmails.length === 0) ? 'border-tertiary' : 'border-brand-field-border'}`}>
                  {clientEmails.map(email => (
                    <span key={email} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-2.5 py-1 text-xs font-semibold">
                      {email}
                      <button type="button" aria-label={`Remove ${email}`} onClick={() => removeEmail(email)} className="hover:text-on-surface">
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </span>
                  ))}
                  <input
                    id={emailFieldId}
                    ref={clientEmailInputRef}
                    type="email"
                    className="flex-1 min-w-[160px] outline-none text-sm bg-transparent"
                    placeholder={clientEmails.length ? 'Add another email…' : 'name@client.com'}
                    value={emailDraft}
                    onChange={event => { setEmailDraft(event.target.value); if (emailError) setEmailError(''); }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ',') {
                        event.preventDefault();
                        addEmail(emailDraft);
                      } else if (event.key === 'Backspace' && !emailDraft && clientEmails.length) {
                        removeEmail(clientEmails[clientEmails.length - 1]);
                      }
                    }}
                    onBlur={() => emailDraft.trim() && addEmail(emailDraft)}
                  />
                  <button
                    type="button"
                    onClick={() => addEmail(emailDraft)}
                    disabled={!emailDraft.trim()}
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-primary/10 px-2.5 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-40 disabled:hover:bg-primary/10"
                  >
                    <span className="material-symbols-outlined text-[15px]">add</span>Add
                  </button>
                </div>
                {emailError ? (
                  <p className="text-xs text-tertiary mt-1 font-semibold">{emailError}</p>
                ) : (
                  <p className="text-xs text-outline mt-1">Type an address, then press Enter, comma, or Add. Add as many client recipients as need a copy.</p>
                )}
              </div>
            </div>
            <label className={`flex items-start gap-3 min-h-11 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${form.ccClient ? 'border-primary/40 bg-primary/8' : 'border-outline-variant bg-surface-container-low hover:border-primary/30'}`}>
              <input
                type="checkbox"
                checked={form.ccClient}
                onChange={event => {
                  const checked = event.target.checked;
                  setForm(current => ({ ...current, ccClient: checked }));
                  if (checked && clientEmails.length === 0) window.setTimeout(() => clientEmailInputRef.current?.focus(), 0);
                }}
                className="h-4 w-4 mt-0.5 accent-primary"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-body-sm font-semibold text-on-surface">
                  <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-primary">mail</span>
                  Send a copy of these minutes to the client
                </span>
                <span className="block text-xs text-outline mt-1">The client copy leaves out internal fields (e.g. Type of Account). At least one client email is required when this is on.</span>
              </span>
            </label>
          </section>

          <section className="pt-5 border-t border-outline-variant space-y-5">
            <div>
              <h2 className="font-headline-sm text-on-surface">Meeting classification</h2>
              <p className="text-body-sm text-outline mt-1">Add the account and reporting details used to categorize this meeting.</p>
            </div>
            <DynamicFieldRenderer entity="mom" values={customFields} onChange={(key, value) => setCustomFields(current => ({ ...current, [key]: value }))} excludeKeys={['contact_person_designation']} />
          </section>

          <section className="pt-5 border-t border-outline-variant space-y-5">
            <div>
              <h2 className="font-headline-sm text-on-surface">Full meeting record</h2>
              <p className="text-body-sm text-outline mt-1">Capture the discussion first, then the owners and next steps.</p>
            </div>
            <div>
              <Label>Discussion</Label>
              <textarea rows={6} className="w-full bg-white border border-brand-field-border rounded-input px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={form.discussion} onChange={event => setForm(current => ({ ...current, discussion: event.target.value }))} />
            </div>
            <div>
              <Label>Action Items</Label>
              <textarea rows={4} className="w-full bg-white border border-brand-field-border rounded-input px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={form.actionItems} onChange={event => setForm(current => ({ ...current, actionItems: event.target.value }))} />
            </div>
          </section>

          <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
            {!isEdit && <Button variant="outline" onClick={() => save('Draft')} disabled={saving}>Save Draft</Button>}
            <Button onClick={() => save(isEdit ? (editing?.status === 'Completed' ? 'Completed' : 'Draft') : 'Completed')} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Finalize Record'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {showPreview && (
        <MomClientPreviewModal
          mom={previewMom}
          onClose={() => setShowPreview(false)}
          footer={
            <>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={previewExporting !== null}
                  onClick={async () => {
                    setPreviewExporting('pdf');
                    try { await exportMomPdf(previewMom, 'client'); } finally { setPreviewExporting(null); }
                  }}
                >
                  <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span> PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={previewExporting !== null}
                  onClick={() => { setPreviewExporting('word'); try { exportMomWord(previewMom, 'client'); } finally { setPreviewExporting(null); } }}
                >
                  <span className="material-symbols-outlined text-[16px]">description</span> Word
                </Button>
              </div>
              <p className="text-xs text-outline">{isEdit ? 'Save your changes' : 'Save this record'} to send it directly to the client.</p>
            </>
          }
        />
      )}
    </div>
  );
}
