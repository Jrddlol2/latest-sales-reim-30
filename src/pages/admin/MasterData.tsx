import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { createMasterData, updateMasterData } from '../../lib/api';
import { MasterData as IMasterData } from '../../types';
import { Pagination } from '../../components/ui/Pagination';

// Plausible sample values per catalog, used by the demo-mode autofill.
const DEMO_SAMPLES: Record<string, { name: string; code: string; notes: string }> = {
  department: { name: 'Corporate Sales', code: 'CSALES', notes: 'Demo sample department' },
  costCenter: { name: 'CC — Field Operations', code: 'CC-4200', notes: 'Demo sample cost center' },
  businessUnit: { name: 'Enterprise Solutions', code: 'BU-ENT', notes: 'Demo sample business unit' },
  branch: { name: 'Cebu Branch', code: 'BR-CEB', notes: 'Demo sample branch' },
  projectCode: { name: 'Project Horizon', code: 'PRJ-HZN', notes: 'Demo sample project code' },
  vendor: { name: 'Northwind Supplies Inc.', code: 'VND-NW', notes: 'Demo sample vendor' },
};

const ITEMS_PER_PAGE = 15;

export function MasterData() {
  const { masterData, refresh } = useAppContext();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<'department' | 'costCenter' | 'businessUnit' | 'branch' | 'projectCode' | 'vendor'>('department');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<IMasterData>>({});
  const [saving, setSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const displayedData = masterData.filter(d => d.type === activeTab);
  const totalPages = Math.ceil(displayedData.length / ITEMS_PER_PAGE);
  const paginatedData = displayedData.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  const handleSave = async () => {
    const body = {
      name: editForm.name,
      code: editForm.code,
      notes: editForm.notes,
      active: editForm.active ?? true,
    };
    setSaving(true);
    try {
      if (editingId === 'new') {
        await createMasterData(activeTab, body);
      } else if (editingId) {
        await updateMasterData(activeTab, editingId, body);
      }
      await refresh();
      addToast('Saved.', 'success');
      setEditingId(null);
      setEditForm({});
    } catch (err: any) {
      // Server enforces required name + case-insensitive uniqueness.
      addToast(err?.message || 'Could not save the record.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-display text-on-surface">Master Data</h1>
          <p className="text-body-md text-outline mt-1">Manage catalogs: Departments, Cost Centers, Business Units, Branches, Project Codes, Vendors.</p>
        </div>
        <Button className="gap-2" onClick={() => { setEditingId('new'); setEditForm({ active: true }); }}>
          <span className="material-symbols-outlined">add</span>
          New Entry
        </Button>
      </div>

      <div className="flex gap-2 border-b border-outline-variant overflow-x-auto pb-2">
        {['department', 'costCenter', 'businessUnit', 'branch', 'projectCode', 'vendor'].map(tab => (
          <button 
            key={tab} 
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-2 font-label-md capitalize rounded-t-lg transition-colors ${activeTab === tab ? 'bg-primary-container text-on-primary-container border-b-2 border-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}
          >
            {tab.replace(/([A-Z])/g, ' $1').trim()}
          </button>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Code</th>
                <th className="px-6 py-4">Notes</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {displayedData.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-outline">
                    <p className="font-label-md">No records found for this catalog.</p>
                  </td>
                </tr>
              ) : paginatedData.map(item => (
                <tr key={item.id} className="hover:bg-primary-fixed/5 transition-colors">
                  {editingId === item.id ? (
                    <>
                      <td className="px-6 py-3"><Input value={editForm.name || ''} onChange={e => setEditForm(p => ({...p, name: e.target.value}))} /></td>
                      <td className="px-6 py-3"><Input value={editForm.code || ''} onChange={e => setEditForm(p => ({...p, code: e.target.value}))} /></td>
                      <td className="px-6 py-3"><Input value={editForm.notes || ''} onChange={e => setEditForm(p => ({...p, notes: e.target.value}))} /></td>
                      <td className="px-6 py-3 text-center">
                        <input type="checkbox" checked={editForm.active} onChange={e => setEditForm(p => ({...p, active: e.target.checked}))} className="w-4 h-4 text-primary" />
                      </td>
                      <td className="px-6 py-3 text-right">
                         <div className="flex justify-end gap-2">
                           <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={saving}>Cancel</Button>
                           <Button size="sm" onClick={handleSave} disabled={saving}>Save</Button>
                         </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-4 font-body-base text-on-surface font-semibold">{item.name}</td>
                      <td className="px-6 py-4 font-mono-data text-on-surface-variant">{item.code || '-'}</td>
                      <td className="px-6 py-4 font-body-sm text-on-surface-variant">{item.notes || '-'}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${item.active ? 'bg-green-100 text-green-800' : 'bg-surface-container-high text-on-surface-variant'}`}>
                          {item.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                         <Button size="sm" variant="outline" onClick={() => { setEditingId(item.id); setEditForm(item); }}>Edit</Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {editingId === 'new' && (
                <tr className="bg-primary/5">
                   <td className="px-6 py-3"><Input placeholder="Name" value={editForm.name || ''} onChange={e => setEditForm(p => ({...p, name: e.target.value}))} /></td>
                   <td className="px-6 py-3"><Input placeholder="Code" value={editForm.code || ''} onChange={e => setEditForm(p => ({...p, code: e.target.value}))} /></td>
                   <td className="px-6 py-3"><Input placeholder="Notes" value={editForm.notes || ''} onChange={e => setEditForm(p => ({...p, notes: e.target.value}))} /></td>
                   <td className="px-6 py-3 text-center">
                     <input type="checkbox" checked={editForm.active !== false} onChange={e => setEditForm(p => ({...p, active: e.target.checked}))} className="w-4 h-4 text-primary" />
                   </td>
                   <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditForm(p => ({ ...p, ...DEMO_SAMPLES[activeTab], active: p.active ?? true }))}>
                          <span className="material-symbols-outlined text-[16px]">bolt</span> Autofill
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        <Button size="sm" onClick={handleSave}>Save</Button>
                      </div>
                   </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </Card>
    </div>
  );
}
