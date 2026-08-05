import { useRef, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Label, Select } from '../../components/ui/Input';
import { useToast } from '../../components/shared/ToastContext';
import { useAppContext } from '../../components/AppContext';
import { createCompany, importCompanies, updateCompany } from '../../lib/api';
import { Company } from '../../types';

export function CompanyDirectory() {
  const { addToast } = useToast();
  const { companies, refresh } = useAppContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [completenessFilter, setCompletenessFilter] = useState('');
  const [reviewFilter, setReviewFilter] = useState<'' | 'pending' | 'reviewed'>('');
  const [sortOrder, setSortOrder] = useState<'name' | 'industry'>('name');
  const [markingReviewedId, setMarkingReviewedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const industries = Array.from(new Set(companies.map(company => company.industry).filter((value): value is string => Boolean(value)))).sort();
  const pendingCount = companies.filter(c => c.pendingReview).length;
  const filtered = companies.filter(c => {
    const matchesSearch = [c.name, c.industry, c.notes, c.address, c.contactPerson, c.contactEmail].some(v => (v || '').toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesIndustry = !industryFilter || c.industry === industryFilter;
    const isComplete = Boolean(c.contactPerson && c.contactEmail && c.address);
    const matchesCompleteness = !completenessFilter || (completenessFilter === 'complete' ? isComplete : !isComplete);
    const matchesReview = !reviewFilter || (reviewFilter === 'pending' ? Boolean(c.pendingReview) : !c.pendingReview);
    return matchesSearch && matchesIndustry && matchesCompleteness && matchesReview;
  }).sort((a, b) => sortOrder === 'industry'
    ? (a.industry || '').localeCompare(b.industry || '') || a.name.localeCompare(b.name)
    : a.name.localeCompare(b.name));
  const hasFilters = Boolean(industryFilter || completenessFilter || reviewFilter);

  const markReviewed = async (company: Company) => {
    setMarkingReviewedId(company.id);
    try {
      await updateCompany(company.id, { pending_review: false });
      await refresh();
      addToast(`${company.name} marked as reviewed.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not update the company.', 'error');
    } finally {
      setMarkingReviewedId(null);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setName(''); setIndustry(''); setNotes(''); setAddress(''); setContactPerson(''); setContactEmail('');
    setShowModal(true);
  };

  const openEdit = (c: Company) => {
    setEditing(c);
    setName(c.name); setIndustry(c.industry || ''); setNotes(c.notes || '');
    setAddress(c.address || ''); setContactPerson(c.contactPerson || ''); setContactEmail(c.contactEmail || '');
    setShowModal(true);
  };

  /** Demo/presenter aid — fill the create form with a plausible sample company
   *  in one click. Hidden unless demo mode is on (`?demo=1`). */
  const autofillDemo = () => {
    const n = companies.length + 1;
    setName(`Northwind Trading ${n}`);
    setIndustry('Wholesale Distribution');
    setContactPerson('Jane Dela Cruz');
    setContactEmail(`contact${n}@northwind.example`);
    setAddress('Bonifacio Global City, Taguig, Philippines');
    setNotes('Added via demo autofill — key account, quarterly review cadence.');
  };

  const handleSave = async () => {
    if (!name.trim()) {
      addToast('Company name is required.', 'error');
      return;
    }
    setSaving(true);
    const body = { name, industry, notes, address, contact_person: contactPerson, contact_email: contactEmail };
    try {
      if (editing) {
        await updateCompany(editing.id, body);
        addToast(`Updated ${name}.`, 'success');
      } else {
        await createCompany(body);
        addToast(`Added ${name} to the directory.`, 'success');
      }
      await refresh();
      setShowModal(false);
    } catch (err: any) {
      // Server enforces name required + uniqueness.
      addToast(err?.message || 'Could not save the company.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) throw new Error('The CSV must include a header and at least one company.');
      const parseLine = (line: string) => {
        const values: string[] = [];
        let value = '';
        let quoted = false;
        for (let index = 0; index < line.length; index++) {
          const char = line[index];
          if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index++; }
          else if (char === '"') quoted = !quoted;
          else if (char === ',' && !quoted) { values.push(value.trim()); value = ''; }
          else value += char;
        }
        values.push(value.trim());
        return values;
      };
      const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');
      const headers = parseLine(lines[0]).map(normalize);
      if (!headers.includes('name') && !headers.includes('company_name')) {
        throw new Error('The CSV needs a "name" or "company_name" column.');
      }
      const rows = lines.slice(1).map(line => {
        const values = parseLine(line);
        const row: Record<string, string> = {};
        headers.forEach((header, index) => { row[header === 'company_name' ? 'name' : header] = values[index] || ''; });
        return row;
      });
      const result = await importCompanies(rows);
      await refresh();
      const errorText = result.errors.length ? ` ${result.errors.length} row(s) had errors.` : '';
      addToast(`Import complete: ${result.inserted} added, ${result.updated} updated, ${result.skipped} unchanged.${errorText}`, result.errors.length ? 'info' : 'success');
    } catch (error: any) {
      addToast(error?.message || 'Could not import the company CSV.', 'error');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">System Administration</span>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1 className="font-display text-display text-on-surface">Company Directory</h1>
            {pendingCount > 0 && (
              <button
                onClick={() => setReviewFilter('pending')}
                className="inline-flex items-center gap-1.5 rounded-full bg-tertiary-container/60 text-on-tertiary-container px-3 py-1 text-xs font-bold hover:bg-tertiary-container transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">pending_actions</span>
                {pendingCount} pending review
              </button>
            )}
          </div>
          <p className="text-body-md text-outline mt-1">Client and partner entities — auto-created from meeting minutes and editable here.</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={event => handleImport(event.target.files?.[0])}
          />
          <Button variant="outline" className="gap-2" disabled={importing} onClick={() => importInputRef.current?.click()}>
            <span className={`material-symbols-outlined ${importing ? 'animate-spin' : ''}`}>{importing ? 'sync' : 'upload_file'}</span>
            Import CSV
          </Button>
          <Button className="gap-2" onClick={openAdd}>
            <span className="material-symbols-outlined">add</span> Add Company
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1 max-w-xl"><Input type="text" placeholder="Search name, contact, location, or notes..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
          <Button variant="outline" className="gap-2" onClick={() => setShowFilters(open => !open)}><span className="material-symbols-outlined text-[18px]">filter_list</span>Filters{hasFilters ? ' (active)' : ''}</Button>
          <Select className="w-40" value={sortOrder} onChange={e => setSortOrder(e.target.value as typeof sortOrder)} aria-label="Sort company directory"><option value="name">Name A–Z</option><option value="industry">Industry A–Z</option></Select>
          {(searchTerm || hasFilters || sortOrder !== 'name') && <button className="text-xs font-semibold text-primary hover:underline" onClick={() => { setSearchTerm(''); setIndustryFilter(''); setCompletenessFilter(''); setReviewFilter(''); setSortOrder('name'); }}>Clear all</button>}
        </div>
        {showFilters && <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-outline-variant pt-4">
          <div><Label>Industry</Label><Select value={industryFilter} onChange={e => setIndustryFilter(e.target.value)}><option value="">All industries</option>{industries.map(item => <option key={item}>{item}</option>)}</Select></div>
          <div><Label>Directory Details</Label><Select value={completenessFilter} onChange={e => setCompletenessFilter(e.target.value)}><option value="">Any completeness</option><option value="complete">Complete contact details</option><option value="missing">Missing contact details</option></Select></div>
          <div><Label>Review status</Label><Select value={reviewFilter} onChange={e => setReviewFilter(e.target.value as typeof reviewFilter)}><option value="">Any status</option><option value="pending">Pending review</option><option value="reviewed">Reviewed</option></Select></div>
        </div>}
        {hasFilters && <div className="mt-3 flex flex-wrap gap-2">
          {industryFilter && <button onClick={() => setIndustryFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{industryFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          {completenessFilter && <button onClick={() => setCompletenessFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{completenessFilter === 'complete' ? 'Complete details' : 'Missing details'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          {reviewFilter && <button onClick={() => setReviewFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{reviewFilter === 'pending' ? 'Pending review' : 'Reviewed'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
        </div>}
      </Card>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <h3 className="font-label-md uppercase tracking-wider text-on-surface">Registered Entities</h3>
          <span className="font-label-sm text-outline">{filtered.length} of {companies.length}</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr>
                <th className="px-6 py-4">Company Name</th>
                <th className="px-6 py-4">Industry</th>
                <th className="px-6 py-4">Contact Person</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Location</th>
                <th className="px-6 py-4">Notes</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">business</span>
                    <p className="font-label-md">{companies.length === 0 ? 'No companies yet.' : 'No companies match your search.'}</p>
                  </td>
                </tr>
              ) : filtered.map(company => (
                <tr key={company.id} className="hover:bg-primary-container/5 transition-colors">
                  <td className="px-6 py-4 font-bold text-on-surface">
                    <div className="flex items-center gap-2">
                      {company.name}
                      {company.pendingReview && (
                        <span
                          title="Auto-created from a requestor's meeting minutes — not yet reviewed by an admin."
                          className="inline-flex items-center gap-1 rounded-full bg-tertiary-container/60 text-on-tertiary-container px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
                        >
                          Pending review
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm">{company.industry || '—'}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm">{company.contactPerson || '—'}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm">{company.contactEmail || '—'}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm max-w-[200px] truncate" title={company.address}>{company.address || '—'}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm max-w-[200px] truncate" title={company.notes}>{company.notes || '—'}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {company.pendingReview && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={markingReviewedId === company.id}
                          onClick={() => markReviewed(company)}
                        >
                          {markingReviewedId === company.id ? 'Marking…' : 'Mark reviewed'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => openEdit(company)}>Edit</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <Modal isOpen onClose={() => setShowModal(false)} titleId="company-editor-title" className="max-w-md">
            <div className="bg-surface-container-lowest rounded-xl w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-outline-variant pb-3">
                <h3 id="company-editor-title" className="font-headline-sm text-on-surface">{editing ? 'Edit Company' : 'Add New Company'}</h3>
                <div className="flex items-center gap-2">
                  {!editing && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={autofillDemo}>
                      <span className="material-symbols-outlined text-[16px]">bolt</span> Autofill
                    </Button>
                  )}
                  <button aria-label="Close company editor" onClick={() => setShowModal(false)} className="text-outline hover:text-on-surface">
                    <span aria-hidden="true" className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="font-label-sm block mb-1">Company Name</label>
                  <Input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme Corporation" />
                </div>
                <div>
                  <label className="font-label-sm block mb-1">Industry</label>
                  <Input type="text" value={industry} onChange={e => setIndustry(e.target.value)} placeholder="e.g. Manufacturing" />
                </div>
                <div>
                  <label className="font-label-sm block mb-1">Contact Person</label>
                  <Input type="text" value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="e.g. Jane Doe" />
                </div>
                <div>
                  <label className="font-label-sm block mb-1">Contact Email</label>
                  <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="e.g. jane@acme.com" />
                </div>
                <div>
                  <label className="font-label-sm block mb-1">Location</label>
                  <Input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. Makati City, Philippines" />
                </div>
                <div>
                  <label className="font-label-sm block mb-1">Notes</label>
                  <textarea
                    rows={3}
                    className="w-full bg-white border border-brand-field-border rounded-input px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
                <Button variant="outline" onClick={() => setShowModal(false)} disabled={saving}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                  {saving ? <span className="material-symbols-outlined animate-spin text-[18px]">sync</span> : null}
                  Save Company
                </Button>
              </div>
            </div>
        </Modal>
      )}
    </div>
  );
}
