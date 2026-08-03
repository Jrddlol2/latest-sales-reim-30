import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input, Label, Select } from '../../components/ui/Input';
import { DynamicFieldRenderer } from '../../components/shared/DynamicFieldRenderer';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { createMom, uploadFile } from '../../lib/api';
import { MomDocumentType, DOCUMENT_TYPE_LABEL, MinutesSource } from '../../types';

export function CreateMom() {
  const navigate = useNavigate();
  const { companies, refresh } = useAppContext();
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const clientEmailInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState<MomDocumentType>('MoM');
  const [source, setSource] = useState<MinutesSource>(MinutesSource.TEMPLATE);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    client: '',
    purpose: '',
    meetingDate: new Date().toISOString().split('T')[0],
    location: '',
    contactPerson: '',
    contactPersonEmail: '',
    discussion: '',
    actionItems: '',
    ccClient: false,
  });

  const selectCompany = (name: string) => {
    const company = companies.find(item => item.name === name);
    setForm(current => ({
      ...current,
      client: name,
      location: current.location || company?.address || '',
      contactPerson: current.contactPerson || company?.contactPerson || '',
      contactPersonEmail: current.contactPersonEmail || company?.contactEmail || '',
    }));
  };

  const save = async (status: 'Draft' | 'Completed') => {
    if (!form.client.trim() || !form.purpose.trim() || !form.meetingDate) {
      addToast('Client, purpose, and date of meeting are required.', 'error');
      return;
    }
    if (form.ccClient && !form.contactPersonEmail.trim()) {
      addToast('Enter the client email before enabling client notifications.', 'error');
      window.setTimeout(() => clientEmailInputRef.current?.focus(), 0);
      return;
    }
    if (source === MinutesSource.UPLOADED && !attachment) {
      addToast('Choose the existing minutes file to upload.', 'error');
      fileInputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      let uploaded: { url: string; filename: string } | undefined;
      if (source === MinutesSource.UPLOADED && attachment) {
        uploaded = await uploadFile(attachment);
      }
      await createMom({
        ...form,
        documentType,
        customFields,
        status,
        source,
        fileUrl: uploaded?.url,
        fileName: attachment?.name,
      });
      await refresh();
      addToast(status === 'Draft' ? 'MOM draft saved.' : `${DOCUMENT_TYPE_LABEL[documentType]} finalized.`, 'success');
      navigate('/moms');
    } catch (error: any) {
      addToast(error?.message || 'Could not save the meeting record.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">Personal meeting record</span>
          <h1 className="font-display text-display text-on-surface mt-1">Create Minutes or Agreement</h1>
          <p className="text-body-md text-outline mt-1">This remains private unless you attach it to a filed claim.</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/moms')}>Cancel</Button>
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

          <section className="pt-5 border-t border-outline-variant space-y-4">
            <div>
              <h2 className="font-headline-sm text-on-surface">How do you want to create this record?</h2>
              <p className="text-body-sm text-outline mt-1">Enter the minutes here or attach an existing meeting document.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setSource(MinutesSource.TEMPLATE); setAttachment(null); }}
                className={`min-h-20 rounded-[10px] border p-4 text-left transition-colors ${source === MinutesSource.TEMPLATE ? 'border-primary bg-primary/8 ring-1 ring-primary' : 'border-outline-variant bg-white hover:border-primary/40'}`}
              >
                <span className="flex items-center gap-2 font-semibold text-on-surface">
                  <span className="material-symbols-outlined text-primary">edit_note</span>
                  Fill out the MoM
                </span>
                <span className="mt-1 block text-xs text-outline">Capture discussion and action items in the system.</span>
              </button>
              <button
                type="button"
                onClick={() => setSource(MinutesSource.UPLOADED)}
                className={`min-h-20 rounded-[10px] border p-4 text-left transition-colors ${source === MinutesSource.UPLOADED ? 'border-primary bg-primary/8 ring-1 ring-primary' : 'border-outline-variant bg-white hover:border-primary/40'}`}
              >
                <span className="flex items-center gap-2 font-semibold text-on-surface">
                  <span className="material-symbols-outlined text-primary">upload_file</span>
                  Upload existing minutes
                </span>
                <span className="mt-1 block text-xs text-outline">Attach a PDF, Word document, or image up to 10MB.</span>
              </button>
            </div>

            {source === MinutesSource.UPLOADED && (
              <div className="rounded-[10px] border border-dashed border-outline-variant bg-surface-container-low p-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,image/jpeg,image/png,image/gif,image/webp"
                  className="sr-only"
                  onChange={event => {
                    const file = event.target.files?.[0] || null;
                    if (file && file.size > 10 * 1024 * 1024) {
                      addToast('File is too large. Maximum size is 10MB.', 'error');
                      event.target.value = '';
                      setAttachment(null);
                      return;
                    }
                    setAttachment(file);
                  }}
                />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="material-symbols-outlined text-primary">description</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-on-surface">{attachment?.name || 'No file selected'}</p>
                      <p className="text-xs text-outline">{attachment ? `${(attachment.size / 1024 / 1024).toFixed(1)} MB` : 'PDF, DOC, DOCX, JPG, PNG, GIF, or WEBP'}</p>
                    </div>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    {attachment ? 'Replace file' : 'Choose file'}
                  </Button>
                </div>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label required>Client / Company</Label>
              <Select value={form.client} onChange={event => selectCompany(event.target.value)}>
                <option value="">Select a company</option>
                {companies.map(company => <option key={company.id} value={company.name}>{company.name}</option>)}
              </Select>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Contact Person</Label>
                <Input value={form.contactPerson} onChange={event => setForm(current => ({ ...current, contactPerson: event.target.value }))} />
              </div>
              <DynamicFieldRenderer
                entity="mom"
                values={customFields}
                onChange={(key, value) => setCustomFields(current => ({ ...current, [key]: value }))}
                includeKeys={['contact_person_designation']}
                containerClassName="contents"
              />
              <div>
                <Label required={form.ccClient}>Client Email</Label>
                <Input ref={clientEmailInputRef} type="email" required={form.ccClient} value={form.contactPersonEmail} onChange={event => setForm(current => ({ ...current, contactPersonEmail: event.target.value }))} />
              </div>
            </div>
            <label className={`flex items-start gap-3 min-h-11 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${form.ccClient ? 'border-primary/40 bg-primary/8' : 'border-outline-variant bg-surface-container-low hover:border-primary/30'}`}>
              <input
                type="checkbox"
                checked={form.ccClient}
                onChange={event => {
                  const checked = event.target.checked;
                  setForm(current => ({ ...current, ccClient: checked }));
                  if (checked && !form.contactPersonEmail.trim()) window.setTimeout(() => clientEmailInputRef.current?.focus(), 0);
                }}
                className="h-4 w-4 mt-0.5 accent-primary"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-body-sm font-semibold text-on-surface">
                  <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-primary">priority_high</span>
                  CC client if this record is later used for a claim
                </span>
                <span className="block text-xs text-outline mt-1">Important: client email is required when this option is enabled.</span>
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

          {source === MinutesSource.TEMPLATE && <section className="pt-5 border-t border-outline-variant space-y-5">
            <div>
              <h2 className="font-headline-sm text-on-surface">Full meeting record</h2>
              <p className="text-body-sm text-outline mt-1">Capture the discussion first, then the owners and next steps.</p>
            </div>
            <div>
              <Label>Discussion</Label>
              <textarea rows={6} className="w-full bg-white border border-[#CBD5E1] rounded-[6px] px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={form.discussion} onChange={event => setForm(current => ({ ...current, discussion: event.target.value }))} />
            </div>
            <div>
              <Label>Action Items</Label>
              <textarea rows={4} className="w-full bg-white border border-[#CBD5E1] rounded-[6px] px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={form.actionItems} onChange={event => setForm(current => ({ ...current, actionItems: event.target.value }))} />
            </div>
          </section>}

          <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
            <Button variant="outline" onClick={() => save('Draft')} disabled={saving}>Save Draft</Button>
            <Button onClick={() => save('Completed')} disabled={saving}>{saving ? 'Saving…' : 'Finalize Record'}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
