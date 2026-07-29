import { useState, useEffect } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { fetchAuditHistory, PageResult } from '../../lib/api';
import { formatDateTime } from '../../lib/date';

interface AuditEntry {
  id: string;
  timestamp: string;
  old_status?: string;
  new_status: string;
  reason?: string;
  changedBy?: { name: string; role: string };
  claim?: { claim_number?: string };
  targetUser?: { name: string };
  master_data_key?: string;
}

const PAGE_SIZE = 25;

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Reset to page 1 when the search term changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Debounce the search so every keystroke doesn't fire a request.
    const handle = setTimeout(() => {
      fetchAuditHistory({ page: currentPage, pageSize: PAGE_SIZE, search })
        .then((data: PageResult<AuditEntry>) => {
          if (!alive) return;
          setEntries(data.items || []);
          setTotal(data.total || 0);
        })
        .catch(e => { if (alive) setError(e?.message || 'Could not load the audit history.'); })
        .finally(() => { if (alive) setLoading(false); });
    }, search ? 300 : 0);
    return () => { alive = false; clearTimeout(handle); };
  }, [currentPage, search]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // What the event acted on: a claim, a user, or a catalog entry.
  const subjectOf = (e: AuditEntry) =>
    e.claim?.claim_number ? e.claim.claim_number
    : e.targetUser?.name ? e.targetUser.name
    : e.master_data_key ? e.master_data_key
    : '—';

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">System Administration</span>
          <h1 className="font-display text-display text-on-surface mt-1">Audit Log</h1>
        </div>
        <div className="w-full sm:w-80">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by user, claim, status, or reason..."
            className="w-full bg-white border border-[#CBD5E1] rounded-[6px] px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <div className="flex justify-between items-center w-full">
            <h3 className="font-label-md uppercase tracking-wider text-on-surface">Immutable Event Feed</h3>
            <span className="font-label-sm text-outline">{total} event{total === 1 ? '' : 's'}</span>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Action By</th>
                <th className="px-6 py-4">Subject</th>
                <th className="px-6 py-4">Transition</th>
                <th className="px-6 py-4">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-outline">
                  <span className="material-symbols-outlined animate-spin">sync</span>
                </td></tr>
              ) : error ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-error">{error}</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-outline">
                  <span className="material-symbols-outlined text-4xl mb-2 opacity-50">gavel</span>
                  <p className="font-label-md">No events match.</p>
                </td></tr>
              ) : entries.map(entry => (
                <tr key={entry.id} className="hover:bg-primary-container/5 transition-colors">
                  <td className="px-6 py-5 font-mono-data text-on-surface-variant text-sm whitespace-nowrap">
                    {formatDateTime(entry.timestamp)}
                  </td>
                  <td className="px-6 py-5">
                    {entry.changedBy ? (
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-semibold">
                          {entry.changedBy.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <p className="text-sm font-bold">{entry.changedBy.name}</p>
                          <p className="text-xs text-outline">{entry.changedBy.role}</p>
                        </div>
                      </div>
                    ) : <span className="text-outline text-sm">System</span>}
                  </td>
                  <td className="px-6 py-5 font-mono-data text-primary font-bold">{subjectOf(entry)}</td>
                  <td className="px-6 py-5 text-sm">
                    {entry.old_status && entry.old_status !== entry.new_status ? (
                      <span className="text-on-surface"><span className="text-outline">{entry.old_status}</span> → <span className="font-bold">{entry.new_status}</span></span>
                    ) : (
                      <span className="font-bold text-on-surface">{entry.new_status}</span>
                    )}
                  </td>
                  <td className="px-6 py-5 text-on-surface-variant text-sm max-w-xs truncate" title={entry.reason || ''}>
                    {entry.reason || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </Card>
    </div>
  );
}
