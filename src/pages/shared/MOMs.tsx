import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { useAppContext } from '../../components/AppContext';
import { Pagination } from '../../components/ui/Pagination';
import { formatDate } from '../../lib/date';
import { DOCUMENT_TYPE_LABEL, MomDocumentType, UserRole } from '../../types';

export function MOMs() {
  const navigate = useNavigate();
  const { moms, claims, currentUser, users } = useAppContext();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [linkFilter, setLinkFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const isApprover = currentUser.role === UserRole.APPROVER;
  const reporteeIds = useMemo(
    () => new Set(users.filter(u => u.reportsTo === currentUser.id).map(u => u.id)),
    [users, currentUser.id]
  );
  const showPreparedBy = isApprover && scope === 'team';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scoped = !isApprover
      ? moms
      : moms.filter(m => scope === 'mine' ? m.requestorId === currentUser.id : !!m.requestorId && reporteeIds.has(m.requestorId));
    const sorted = [...scoped].filter(m => {
      if (linkFilter === 'linked' && !m.claimId) return false;
      if (linkFilter === 'unlinked' && m.claimId) return false;
      if (statusFilter && m.status !== statusFilter) return false;
      return true;
    }).sort((a, b) =>
      new Date(b.meetingDate || 0).getTime() - new Date(a.meetingDate || 0).getTime()
    );
    if (!q) return sorted;
    return sorted.filter(m =>
      [m.purposeOfMeeting, m.companyName, m.location, m.contactPerson, m.preparedBy]
        .some(v => (v || '').toLowerCase().includes(q))
    );
  }, [moms, query, isApprover, scope, currentUser.id, reporteeIds, linkFilter, statusFilter]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedMOMs = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [query, scope, linkFilter, statusFilter]);

  const claimRefFor = (claimId?: string) =>
    claimId ? claims.find(c => c.id === claimId)?.ref : undefined;
  const hasFilters = Boolean(linkFilter !== 'all' || statusFilter);
  const clearFilters = () => {
    setQuery('');
    setLinkFilter('all');
    setStatusFilter('');
  };

  const saveStandaloneMom = async () => {
    if (!draft.meetingDate || !draft.client.trim() || !draft.purpose.trim()) {
      addToast('Date of Meeting, Client / Company, and Purpose are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      await createStandaloneMom(draft);
      await refresh();
      setShowCreate(false);
      addToast('Private standalone MOM created.', 'success');
    } catch (error: any) {
      addToast(error?.message || 'Could not create the MOM.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="font-display text-display text-on-surface">Minutes &amp; Agreements</h1>
          <p className="text-body-md text-outline mt-1">Track the meeting minutes and letters of agreement attached to claims.</p>
        </div>
        <Button className="gap-2" onClick={() => navigate('/moms/new')}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          Create MOM
        </Button>
      </div>

      {isApprover && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setScope('mine')}
            className={`px-5 py-2 rounded-full font-label-md transition-colors ${scope === 'mine' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-high text-on-surface-variant'}`}
          >
            My Documents
          </button>
          <button
            onClick={() => setScope('team')}
            className={`px-5 py-2 rounded-full font-label-md transition-colors ${scope === 'team' ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-high text-on-surface-variant'}`}
          >
            Team Documents
          </button>
        </div>
      )}

      <Card>
        <CardHeader className="bg-surface-container-low">
          <div className="w-full">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <h3 className="font-label-md uppercase tracking-wider text-on-surface whitespace-nowrap">Records</h3>
              <div className="flex flex-wrap items-center justify-end gap-3 flex-1">
                <div className="min-w-[240px] flex-1 max-w-md">
                  <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search minutes and agreements..."
                    className="py-1.5 text-sm"
                    aria-label="Search minutes and agreements"
                  />
                </div>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowFilters(open => !open)} aria-expanded={showFilters}>
                  <span className="material-symbols-outlined text-[18px]">filter_list</span>
                  Filters{hasFilters ? ' (active)' : ''}
                </Button>
                {(query || hasFilters) && <button className="text-xs font-semibold text-primary hover:underline" onClick={clearFilters}>Clear all</button>}
                <span className="font-label-sm text-outline whitespace-nowrap">{filtered.length} of {moms.length}</span>
              </div>
            </div>
            {showFilters && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-outline-variant pt-4">
                <div>
                  <label className="block text-label-sm text-on-surface mb-1">Claim linkage</label>
                  <Select value={linkFilter} onChange={e => setLinkFilter(e.target.value as typeof linkFilter)}>
                    <option value="all">All linkages</option>
                    <option value="linked">Linked to claim</option>
                    <option value="unlinked">Unlinked</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-label-sm text-on-surface mb-1">Document status</label>
                  <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="Draft">Draft</option>
                    <option value="Completed">Finalized</option>
                  </Select>
                </div>
              </div>
            )}
            {hasFilters && (
              <div className="mt-3 flex flex-wrap gap-2">
                {linkFilter !== 'all' && <button onClick={() => setLinkFilter('all')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{linkFilter === 'linked' ? 'Linked to claim' : 'Unlinked'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
                {statusFilter && <button onClick={() => setStatusFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{statusFilter === 'Completed' ? 'Finalized' : statusFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
              </div>
            )}
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Purpose</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Location of Meeting</th>
                <th className="px-6 py-4">Date of Meeting</th>
                {showPreparedBy && <th className="px-6 py-4">Prepared By</th>}
                <th className="px-6 py-4">Claim</th>
                <th className="px-6 py-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={showPreparedBy ? 8 : 7} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">description</span>
                    <p className="font-label-md">{moms.length === 0 ? 'No minutes or agreements found.' : 'No records match your search.'}</p>
                  </td>
                </tr>
              ) : paginatedMOMs.map(mom => {
                const ref = claimRefFor(mom.claimId);
                return (
                  <tr
                    key={mom.id}
                    className="hover:bg-primary-container/5 transition-colors cursor-pointer"
                    onClick={() => navigate(`/moms/${mom.id}`)}
                  >
                    <td className="px-6 py-5">
                      {(() => {
                        const dt: MomDocumentType = mom.documentType === 'LOA' ? 'LOA' : 'MoM';
                        return (
                          <span
                            title={DOCUMENT_TYPE_LABEL[dt]}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${dt === 'LOA' ? 'bg-tertiary-container/50 text-tertiary' : 'bg-primary-container/40 text-on-primary-container'}`}
                          >
                            <span className="material-symbols-outlined text-[14px]">{dt === 'LOA' ? 'handshake' : 'description'}</span>
                            {dt}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-5">
                      <p className="font-bold text-on-surface">{mom.purposeOfMeeting || 'Untitled meeting'}</p>
                    </td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{mom.companyName || '—'}</td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{mom.location || '—'}</td>
                    <td className="px-6 py-5 font-mono-data text-on-surface-variant text-sm">
                      {mom.meetingDate ? formatDate(mom.meetingDate) : '—'}
                    </td>
                    {showPreparedBy && <td className="px-6 py-5 text-on-surface-variant text-sm">{mom.preparedBy || '—'}</td>}
                    <td className="px-6 py-5 text-sm">
                      {ref ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/claims/${mom.claimId}`); }}
                          className="text-primary font-semibold hover:underline"
                        >
                          {ref}
                        </button>
                      ) : (
                        <span className="text-outline">Unlinked</span>
                      )}
                    </td>
                    <td className="px-6 py-5 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        mom.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {mom.status === 'Completed' ? 'Finalized' : (mom.status || 'Draft')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination 
          currentPage={currentPage} 
          totalPages={totalPages} 
          onPageChange={setCurrentPage} 
        />
      </Card>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/45 p-4 overflow-y-auto" onMouseDown={() => setShowCreate(false)}>
          <div className="max-w-3xl mx-auto my-8 rounded-xl bg-surface shadow-2xl" onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-outline-variant p-6">
              <div>
                <h2 className="font-headline-md">Create Standalone MOM</h2>
                <p className="text-body-sm text-outline mt-1">Private to you unless it is later attached to a reimbursement.</p>
              </div>
              <button onClick={() => setShowCreate(false)} aria-label="Close"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div><Label required>Date of Meeting</Label><Input type="date" value={draft.meetingDate} onChange={e => setDraft(p => ({ ...p, meetingDate: e.target.value }))} /></div>
                <div />
                <div><Label required>Client / Company</Label><Input value={draft.client} onChange={e => setDraft(p => ({ ...p, client: e.target.value }))} /></div>
                <div><Label>Contact Person</Label><Input value={draft.contactPerson} onChange={e => setDraft(p => ({ ...p, contactPerson: e.target.value }))} /></div>
                <div><Label required>Purpose of Meeting</Label><Input value={draft.purpose} onChange={e => setDraft(p => ({ ...p, purpose: e.target.value }))} /></div>
                <div><Label>Contact Person Designation</Label><Input value={draft.contactPersonDesignation} onChange={e => setDraft(p => ({ ...p, contactPersonDesignation: e.target.value }))} /></div>
                <div><Label>Location of Meeting</Label><Input value={draft.location} onChange={e => setDraft(p => ({ ...p, location: e.target.value }))} /></div>
                <div><Label>Type of Account</Label><Select value={draft.typeOfAccount} onChange={e => setDraft(p => ({ ...p, typeOfAccount: e.target.value }))}><option>Existing</option><option>New Client</option><option>Dormant</option></Select></div>
                <div><Label>Category</Label><Select value={draft.category} onChange={e => setDraft(p => ({ ...p, category: e.target.value }))}><option value="">Select...</option><option>Sales Call</option><option>Client Servicing</option><option>Business Review</option><option>Contract/Negotiation</option><option>Other</option></Select></div>
              </div>
              {[
                ['Discussion', 'discussion'],
                ['Action Items', 'actionItems'],
              ].map(([label, key]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <textarea rows={3} className="w-full rounded-md border border-outline-variant bg-white px-4 py-3" value={draft[key as 'discussion' | 'actionItems']} onChange={e => setDraft(p => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
              <div><Label>Client Email</Label><Input type="email" value={draft.contactPersonEmail} onChange={e => setDraft(p => ({ ...p, contactPersonEmail: e.target.value }))} /></div>
            </div>
            <div className="flex justify-end gap-3 border-t border-outline-variant p-6">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={saveStandaloneMom} disabled={saving}>{saving ? 'Saving…' : 'Create MOM'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
