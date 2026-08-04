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
  const [docTypeFilter, setDocTypeFilter] = useState<'' | 'MoM' | 'LOA'>('');
  const [clientFilter, setClientFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const isApprover = currentUser.role === UserRole.APPROVER;
  const reporteeIds = useMemo(
    () => new Set(users.filter(u => u.reportsTo === currentUser.id).map(u => u.id)),
    [users, currentUser.id]
  );
  const showPreparedBy = isApprover && scope === 'team';

  const scopedMoms = useMemo(
    () => !isApprover
      ? moms
      : moms.filter(m => scope === 'mine' ? m.requestorId === currentUser.id : !!m.requestorId && reporteeIds.has(m.requestorId)),
    [moms, isApprover, scope, currentUser.id, reporteeIds]
  );
  const clientOptions = useMemo(
    () => Array.from(new Set(scopedMoms.map(m => m.companyName).filter((v): v is string => !!v))).sort(),
    [scopedMoms]
  );
  const locationOptions = useMemo(
    () => Array.from(new Set(scopedMoms.map(m => m.location).filter((v): v is string => !!v))).sort(),
    [scopedMoms]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...scopedMoms].filter(m => {
      if (linkFilter === 'linked' && !m.claimId) return false;
      if (linkFilter === 'unlinked' && m.claimId) return false;
      if (statusFilter && m.status !== statusFilter) return false;
      if (docTypeFilter && (m.documentType === 'LOA' ? 'LOA' : 'MoM') !== docTypeFilter) return false;
      if (clientFilter && m.companyName !== clientFilter) return false;
      if (locationFilter && m.location !== locationFilter) return false;
      const meetingTime = m.meetingDate ? new Date(m.meetingDate).getTime() : undefined;
      if (dateFrom && (meetingTime === undefined || meetingTime < new Date(`${dateFrom}T00:00:00`).getTime())) return false;
      if (dateTo && (meetingTime === undefined || meetingTime > new Date(`${dateTo}T23:59:59`).getTime())) return false;
      return true;
    }).sort((a, b) =>
      new Date(b.meetingDate || 0).getTime() - new Date(a.meetingDate || 0).getTime()
    );
    if (!q) return sorted;
    return sorted.filter(m =>
      [m.purposeOfMeeting, m.companyName, m.location, m.contactPerson, m.preparedBy]
        .some(v => (v || '').toLowerCase().includes(q))
    );
  }, [scopedMoms, query, linkFilter, statusFilter, docTypeFilter, clientFilter, locationFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedMOMs = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [query, scope, linkFilter, statusFilter, docTypeFilter, clientFilter, locationFilter, dateFrom, dateTo]);

  const claimRefFor = (claimId?: string) =>
    claimId ? claims.find(c => c.id === claimId)?.ref : undefined;
  const hasFilters = Boolean(
    linkFilter !== 'all' || statusFilter || docTypeFilter || clientFilter || locationFilter || dateFrom || dateTo
  );
  const clearFilters = () => {
    setQuery('');
    setLinkFilter('all');
    setStatusFilter('');
    setDocTypeFilter('');
    setClientFilter('');
    setLocationFilter('');
    setDateFrom('');
    setDateTo('');
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
                <div>
                  <label className="block text-label-sm text-on-surface mb-1">Document type</label>
                  <Select value={docTypeFilter} onChange={e => setDocTypeFilter(e.target.value as typeof docTypeFilter)}>
                    <option value="">All types</option>
                    <option value="MoM">Minutes of Meeting</option>
                    <option value="LOA">Letter of Agreement</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-label-sm text-on-surface mb-1">Client</label>
                  <Select value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
                    <option value="">All clients</option>
                    {clientOptions.map(client => <option key={client} value={client}>{client}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="block text-label-sm text-on-surface mb-1">Location</label>
                  <Select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
                    <option value="">All locations</option>
                    {locationOptions.map(location => <option key={location} value={location}>{location}</option>)}
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-label-sm text-on-surface mb-1">Meeting from</label>
                    <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-label-sm text-on-surface mb-1">Meeting to</label>
                    <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
            {hasFilters && (
              <div className="mt-3 flex flex-wrap gap-2">
                {linkFilter !== 'all' && <button onClick={() => setLinkFilter('all')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{linkFilter === 'linked' ? 'Linked to claim' : 'Unlinked'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
                {statusFilter && <button onClick={() => setStatusFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{statusFilter === 'Completed' ? 'Finalized' : statusFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
                {docTypeFilter && <button onClick={() => setDocTypeFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{docTypeFilter === 'LOA' ? 'Letter of Agreement' : 'Minutes of Meeting'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
                {clientFilter && <button onClick={() => setClientFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{clientFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
                {locationFilter && <button onClick={() => setLocationFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{locationFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
                {(dateFrom || dateTo) && (
                  <button
                    className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold"
                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                  >
                    {dateFrom || 'Any date'} – {dateTo || 'Today'}
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
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
    </div>
  );
}
