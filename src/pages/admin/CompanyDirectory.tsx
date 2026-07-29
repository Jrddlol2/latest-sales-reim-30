import { useState } from 'react';
import { Portal } from '../../components/shared/Portal';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/shared/ToastContext';
import { useAppContext } from '../../components/AppContext';
import { createCompany, updateCompany } from '../../lib/api';
import { Company } from '../../types';

export function CompanyDirectory() {
  const { addToast } = useToast();
  const { companies, refresh } = useAppContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const filtered = companies.filter(c =>
    [c.name, c.industry, c.notes, c.address, c.contactPerson, c.contactEmail].some(v => (v || '').toLowerCase().includes(searchTerm.toLowerCase()))
  );

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

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">System Administration</span>
          <h1 className="font-display text-display text-on-surface mt-1">Company Directory</h1>
          <p className="text-body-md text-outline mt-1">Client and partner entities — auto-created from meeting minutes and editable here.</p>
        </div>
        <Button className="gap-2" onClick={openAdd}>
          <span className="material-symbols-outlined">add</span> Add Company
        </Button>
      </div>

      <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant max-w-md">
        <Input
          type="text"
          placeholder="Search by name, industry, or notes..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <h3 className="font-label-md uppercase tracking-wider text-on-surface">Registered Entities ({filtered.length})</h3>
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
                  <td className="px-6 py-4 font-bold text-on-surface">{company.name}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm">{company.industry || '—'}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm">{company.contactPerson || '—'}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm">{company.contactEmail || '—'}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm max-w-[200px] truncate" title={company.address}>{company.address || '—'}</td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm max-w-[200px] truncate" title={company.notes}>{company.notes || '—'}</td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="outline" size="sm" onClick={() => openEdit(company)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-outline-variant pb-3">
                <h3 className="font-headline-sm text-on-surface">{editing ? 'Edit Company' : 'Add New Company'}</h3>
                <button onClick={() => setShowModal(false)} className="text-outline hover:text-on-surface">
                  <span className="material-symbols-outlined">close</span>
                </button>
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
                    className="w-full bg-white border border-[#CBD5E1] rounded-[6px] px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
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
          </div>
        </Portal>
      )}
    </div>
  );
}
