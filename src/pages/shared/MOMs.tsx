import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAppContext } from '../../components/AppContext';
import { Pagination } from '../../components/ui/Pagination';
import { formatDate } from '../../lib/date';
import { DOCUMENT_TYPE_LABEL, MomDocumentType } from '../../types';

export function MOMs() {
  const navigate = useNavigate();
  const { moms, claims } = useAppContext();
  const [query, setQuery] = useState('');
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...moms].sort((a, b) =>
      new Date(b.meetingDate || 0).getTime() - new Date(a.meetingDate || 0).getTime()
    );
    if (!q) return sorted;
    return sorted.filter(m =>
      [m.purposeOfMeeting, m.companyName, m.contactPerson, m.preparedBy]
        .some(v => (v || '').toLowerCase().includes(q))
    );
  }, [moms, query]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedMOMs = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [query]);

  const claimRefFor = (claimId?: string) =>
    claimId ? claims.find(c => c.id === claimId)?.ref : undefined;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="font-display text-display text-on-surface">Minutes &amp; Agreements</h1>
          <p className="text-body-md text-outline mt-1">Track the meeting minutes and letters of agreement attached to claims.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <div className="flex justify-between items-center w-full gap-4">
            <h3 className="font-label-md uppercase tracking-wider text-on-surface whitespace-nowrap">Records</h3>
            <div className="flex items-center gap-3">
              <div className="w-64 max-w-full">
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search purpose, client, contact..."
                  className="py-1.5 text-sm"
                />
              </div>
              <span className="font-label-sm text-outline whitespace-nowrap">{filtered.length} of {moms.length}</span>
            </div>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Purpose</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Prepared By</th>
                <th className="px-6 py-4">Claim</th>
                <th className="px-6 py-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-outline">
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
                      {mom.location && <p className="text-body-sm text-outline mt-0.5">{mom.location}</p>}
                    </td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{mom.companyName || '—'}</td>
                    <td className="px-6 py-5 font-mono-data text-on-surface-variant text-sm">
                      {mom.meetingDate ? formatDate(mom.meetingDate) : '—'}
                    </td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{mom.preparedBy || '—'}</td>
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
                        {mom.status || 'Draft'}
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
