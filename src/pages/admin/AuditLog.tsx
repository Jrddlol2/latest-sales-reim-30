import { useEffect, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Label, Select } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { fetchSystemActivity, PageResult } from '../../lib/api';
import { formatDateTime } from '../../lib/date';
import { UserRole } from '../../types';

interface ActivityEntry {
  id: string;
  source: 'audit' | 'notification';
  activityType: 'client' | 'system';
  timestamp: string;
  actor?: { name: string; role: string };
  recipient?: { id: string; name: string; email: string };
  subject: string;
  oldStatus?: string;
  newStatus?: string;
  action: string;
  details: string;
  notification?: {
    id: string;
    recipient_id: string;
    from: string;
    to: string;
    subject: string;
    body: string;
    read: boolean;
    timestamp: string;
    channel: 'Email' | 'Teams';
  };
}

const PAGE_SIZE = 25;

function csvCell(value: string | undefined) {
  return `"${(value || '').replace(/"/g, '""')}"`;
}

function downloadActivityCsv(entries: ActivityEntry[]) {
  const headers = ['Timestamp', 'Type', 'Source', 'Person', 'Role', 'Recipient', 'Subject', 'Previous Status', 'Resulting Status', 'Action', 'Details'];
  const rows = entries.map(entry => [
    entry.timestamp,
    entry.activityType === 'client' ? 'User action' : 'System action',
    entry.source,
    entry.actor?.name || 'System',
    entry.actor?.role || '',
    entry.recipient ? `${entry.recipient.name} <${entry.recipient.email}>` : '',
    entry.subject,
    entry.oldStatus || '',
    entry.newStatus || '',
    entry.action,
    entry.details,
  ]);
  const csv = [headers, ...rows].map(row => row.map(value => csvCell(value)).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `system-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to resolve the object URL before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function AuditLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [selected, setSelected] = useState<ActivityEntry | null>(null);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activityType, setActivityType] = useState<'' | 'client' | 'system'>('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const hasSecondaryFilters = Boolean(sourceFilter || roleFilter || statusFilter || dateFrom || dateTo);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activityType, sourceFilter, roleFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const handle = setTimeout(() => {
      fetchSystemActivity({
        page: currentPage,
        pageSize: PAGE_SIZE,
        search,
        activityType,
        source: sourceFilter as '' | 'audit' | 'notification',
        role: roleFilter,
        status: statusFilter,
        dateFrom,
        dateTo,
      })
        .then((data: PageResult<ActivityEntry>) => {
          if (!alive) return;
          setEntries(data.items || []);
          setTotal(data.total || 0);
        })
        .catch(e => { if (alive) setError(e?.message || 'Could not load system activity.'); })
        .finally(() => { if (alive) setLoading(false); });
    }, search ? 300 : 0);
    return () => { alive = false; clearTimeout(handle); };
  }, [currentPage, search, activityType, sourceFilter, roleFilter, statusFilter, dateFrom, dateTo]);

  const clearAll = () => {
    setSearch('');
    setActivityType('');
    setSourceFilter('');
    setRoleFilter('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
  };
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const exportFilteredActivity = async () => {
    setExporting(true);
    setError('');
    try {
      const data = await fetchSystemActivity({
        page: 1,
        pageSize: Math.max(total, PAGE_SIZE),
        search,
        activityType,
        source: sourceFilter as '' | 'audit' | 'notification',
        role: roleFilter,
        status: statusFilter,
        dateFrom,
        dateTo,
      });
      downloadActivityCsv(data.items || []);
    } catch (e: any) {
      setError(e?.message || 'Could not export system activity.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <span className="font-label-sm text-primary font-bold tracking-wider uppercase">System Administration</span>
        <h1 className="font-display text-display text-on-surface mt-1">System Activity</h1>
        <p className="text-body-md text-outline mt-1">User actions, automated events, and sent notifications in one chronological feed.</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
          <div className="min-w-[240px] flex-1 max-w-2xl">
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search person, reference, subject, status, or details..." />
          </div>
          <Select containerClassName="w-full sm:w-44 sm:flex-none" value={activityType} onChange={event => setActivityType(event.target.value as typeof activityType)} aria-label="Filter by activity type">
            <option value="">All activity</option>
            <option value="client">User actions</option>
            <option value="system">System actions</option>
          </Select>
          <Button variant="outline" className="gap-2 sm:flex-none" onClick={() => setShowFilters(open => !open)}>
            <span className="material-symbols-outlined text-[18px]">filter_list</span>
            Filters{hasSecondaryFilters ? ' (active)' : ''}
          </Button>
          <Button variant="outline" className="gap-2 sm:flex-none" onClick={exportFilteredActivity} disabled={loading || exporting || total === 0}>
            <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${exporting ? 'animate-spin' : ''}`}>{exporting ? 'sync' : 'download'}</span>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
          {(search || activityType || hasSecondaryFilters) && <button className="text-xs font-semibold text-primary hover:underline" onClick={clearAll}>Clear all</button>}
        </div>

        {showFilters && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 border-t border-outline-variant pt-4">
            <div><Label>Source</Label><Select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="">All sources</option><option value="audit">Actions and transitions</option><option value="notification">Sent notifications</option></Select></div>
            <div><Label>Actor Role</Label><Select value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">All roles</option>{Object.values(UserRole).map(role => <option key={role} value={role}>{role}</option>)}</Select></div>
            <div><Label>Resulting Status</Label><Select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">All statuses</option>{['Pending Approval', 'Approved', 'Reviewed', 'Processing', 'Ready for Claim', 'Completed', 'Released', 'Returned', 'Rejected', 'Active', 'Expired'].map(status => <option key={status}>{status}</option>)}</Select></div>
            <div><Label>From</Label><Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></div>
            <div><Label>To</Label><Input type="date" min={dateFrom || undefined} value={dateTo} onChange={event => setDateTo(event.target.value)} /></div>
          </div>
        )}

        {(activityType || hasSecondaryFilters) && <div className="mt-3 flex flex-wrap gap-2">
          {activityType && <button onClick={() => setActivityType('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{activityType === 'client' ? 'User actions' : 'System actions'}<span aria-hidden="true" className="material-symbols-outlined text-[14px]">close</span></button>}
          {sourceFilter && <button onClick={() => setSourceFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{sourceFilter === 'audit' ? 'Actions and transitions' : 'Sent notifications'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          {roleFilter && <button onClick={() => setRoleFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{roleFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          {statusFilter && <button onClick={() => setStatusFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{statusFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          {dateFrom && <button onClick={() => setDateFrom('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">From {dateFrom}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          {dateTo && <button onClick={() => setDateTo('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">To {dateTo}<span className="material-symbols-outlined text-[14px]">close</span></button>}
        </div>}
      </Card>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <h3 className="font-label-md uppercase tracking-wider text-on-surface">Unified Activity Feed</h3>
          <span className="font-label-sm text-outline">{total} event{total === 1 ? '' : 's'}</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Person</th>
                <th className="px-6 py-4">Subject</th>
                <th className="px-6 py-4">Activity</th>
                <th className="px-6 py-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-outline"><span className="material-symbols-outlined animate-spin">sync</span></td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-error">{error}</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-outline"><span className="material-symbols-outlined text-4xl mb-2 opacity-50">manage_search</span><p className="font-label-md">No activity matches these filters.</p></td></tr>
              ) : entries.map(entry => {
                const person = entry.actor || (entry.recipient ? { name: entry.recipient.name, role: `Recipient · ${entry.recipient.email}` } : undefined);
                return (
                  <tr
                    key={entry.id}
                    tabIndex={0}
                    onClick={() => setSelected(entry)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelected(entry);
                      }
                    }}
                    className="cursor-pointer hover:bg-primary-container/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                    aria-label={`View activity details for ${entry.subject}`}
                  >
                    <td className="px-6 py-5 font-mono-data text-on-surface-variant text-sm whitespace-nowrap">{formatDateTime(entry.timestamp)}</td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${entry.activityType === 'client' ? 'bg-blue-100 text-blue-800' : 'bg-violet-100 text-violet-800'}`}>
                        {entry.activityType === 'client' ? 'User action' : 'System action'}
                      </span>
                      {entry.source === 'notification' && <span className="block text-[11px] text-outline mt-1">Notification</span>}
                    </td>
                    <td className="px-6 py-5">
                      {person ? <><p className="text-sm font-bold">{person.name}</p><p className="text-xs text-outline">{person.role}</p></> : <span className="text-sm text-outline">System</span>}
                    </td>
                    <td className="px-6 py-5 font-mono-data text-primary font-bold max-w-[220px] truncate" title={entry.subject}>{entry.subject}</td>
                    <td className="px-6 py-5 text-sm font-semibold text-on-surface">{entry.action}</td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm max-w-xs truncate" title={entry.details}>{entry.details}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </Card>

      {selected && (
        <Modal isOpen onClose={() => setSelected(null)} titleId="activity-detail-title" className="ml-auto h-full max-h-none max-w-xl rounded-none">
          <div className="flex h-full w-full flex-col bg-surface-container-lowest shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant p-6">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${selected.activityType === 'client' ? 'bg-blue-100 text-blue-800' : 'bg-violet-100 text-violet-800'}`}>
                    {selected.activityType === 'client' ? 'User action' : 'System action'}
                  </span>
                  <span className="text-xs font-semibold capitalize text-outline">{selected.source}</span>
                </div>
                <h3 id="activity-detail-title" className="font-headline-md text-on-surface">Activity details</h3>
                <p className="mt-1 text-xs text-outline">{formatDateTime(selected.timestamp)}</p>
              </div>
              <button aria-label="Close activity details" onClick={() => setSelected(null)} className="rounded-full p-2 text-outline hover:bg-surface-container-high hover:text-on-surface">
                <span aria-hidden="true" className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              <dl className="grid grid-cols-1 gap-4 rounded-xl border border-outline-variant bg-surface-container-low p-4 sm:grid-cols-2">
                <div><dt className="text-[11px] font-bold uppercase tracking-wider text-outline">Person</dt><dd className="mt-1 text-sm font-semibold text-on-surface">{selected.actor?.name || selected.recipient?.name || 'System'}</dd></div>
                <div><dt className="text-[11px] font-bold uppercase tracking-wider text-outline">Role / Recipient</dt><dd className="mt-1 break-words text-sm text-on-surface-variant">{selected.actor?.role || selected.recipient?.email || 'Automated event'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-[11px] font-bold uppercase tracking-wider text-outline">Subject</dt><dd className="mt-1 break-words font-mono-data text-sm font-bold text-primary">{selected.subject}</dd></div>
                <div><dt className="text-[11px] font-bold uppercase tracking-wider text-outline">Previous status</dt><dd className="mt-1 text-sm text-on-surface-variant">{selected.oldStatus || '—'}</dd></div>
                <div><dt className="text-[11px] font-bold uppercase tracking-wider text-outline">Resulting status</dt><dd className="mt-1 text-sm font-semibold text-on-surface">{selected.newStatus || '—'}</dd></div>
              </dl>

              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-outline">Activity</h4>
                <p className="mt-2 text-sm font-semibold text-on-surface">{selected.action}</p>
              </section>

              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-outline">Details</h4>
                <div className="mt-2 min-h-[120px] whitespace-pre-wrap rounded-xl border border-outline-variant bg-white p-4 text-sm leading-relaxed text-on-surface-variant">{selected.details || 'No additional details were recorded.'}</div>
              </section>

              {selected.notification && (
                <section className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-outline">Notification delivery</h4>
                  <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4 text-sm">
                    <p><span className="font-semibold text-outline">Channel:</span> {selected.notification.channel}</p>
                    <p className="mt-2 break-words"><span className="font-semibold text-outline">From:</span> {selected.notification.from}</p>
                    <p className="mt-2 break-words"><span className="font-semibold text-outline">To:</span> {selected.recipient?.email || selected.notification.to}</p>
                  </div>
                </section>
              )}
            </div>

            <div className="flex justify-end border-t border-outline-variant p-4">
              <Button onClick={() => setSelected(null)}>Close</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
