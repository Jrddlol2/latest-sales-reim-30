import { useEffect, useState } from 'react';
import { Portal } from '../../components/shared/Portal';
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

export function AuditLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [selected, setSelected] = useState<ActivityEntry | null>(null);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
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

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <span className="font-label-sm text-primary font-bold tracking-wider uppercase">System Administration</span>
        <h1 className="font-display text-display text-on-surface mt-1">System Activity</h1>
        <p className="text-body-md text-outline mt-1">Client actions, automated events, and sent notifications in one chronological feed.</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1 max-w-2xl">
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search person, reference, subject, status, or details..." />
          </div>
          <Select className="w-44" value={activityType} onChange={event => setActivityType(event.target.value as typeof activityType)} aria-label="Filter by activity type">
            <option value="">All activity</option>
            <option value="client">Client actions</option>
            <option value="system">System actions</option>
          </Select>
          <Button variant="outline" className="gap-2" onClick={() => setShowFilters(open => !open)}>
            <span className="material-symbols-outlined text-[18px]">filter_list</span>
            Filters{hasSecondaryFilters ? ' (active)' : ''}
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
          {activityType && <button onClick={() => setActivityType('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{activityType === 'client' ? 'Client actions' : 'System actions'}<span className="material-symbols-outlined text-[14px]">close</span></button>}
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
                  <tr key={entry.id} onClick={() => entry.notification && setSelected(entry)} className={`hover:bg-primary-container/5 transition-colors ${entry.notification ? 'cursor-pointer' : ''}`}>
                    <td className="px-6 py-5 font-mono-data text-on-surface-variant text-sm whitespace-nowrap">{formatDateTime(entry.timestamp)}</td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${entry.activityType === 'client' ? 'bg-blue-100 text-blue-800' : 'bg-violet-100 text-violet-800'}`}>
                        {entry.activityType === 'client' ? 'Client action' : 'System action'}
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

      {selected?.notification && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-surface-container-lowest rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] flex flex-col">
              <div className="flex justify-between items-center border-b border-outline-variant pb-4">
                <div><h3 className="font-headline-sm text-on-surface">{selected.notification.channel} Notification</h3><p className="text-xs text-outline mt-1">Sent {formatDateTime(selected.timestamp)}</p></div>
                <button onClick={() => setSelected(null)} className="text-outline hover:text-on-surface"><span className="material-symbols-outlined">close</span></button>
              </div>
              <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant space-y-2 text-xs">
                <div className="flex"><span className="w-20 text-outline font-semibold">From:</span><span>{selected.notification.from}</span></div>
                <div className="flex"><span className="w-20 text-outline font-semibold">To:</span><span>{selected.recipient?.email || selected.notification.to}</span></div>
                <div className="flex"><span className="w-20 text-outline font-semibold">Subject:</span><span className="font-bold">{selected.notification.subject}</span></div>
              </div>
              <div className="bg-white p-6 rounded-lg border border-outline-variant min-h-[160px] text-sm leading-relaxed whitespace-pre-wrap overflow-y-auto">{selected.notification.body}</div>
              <div className="flex justify-end"><Button onClick={() => setSelected(null)}>Close</Button></div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
