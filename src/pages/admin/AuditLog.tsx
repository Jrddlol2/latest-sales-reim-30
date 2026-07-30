import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { fetchAuditHistory, fetchOutbox } from '../../lib/api';
import { formatDateTime } from '../../lib/date';

interface ActivityEntry {
  id: string;
  timestamp: string;
  type: 'Audit' | 'Teams' | 'Email';
  actor: string;
  subject: string;
  event: string;
  notes: string;
  deliveryStatus?: string;
}

const PAGE_SIZE = 25;

export function AuditLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    Promise.all([
      fetchAuditHistory({ limit: 2000 }),
      fetchOutbox(),
    ]).then(([history, messages]: [any[], any[]]) => {
      const audit: ActivityEntry[] = (history || []).map(event => ({
        id: `audit-${event.id}`,
        timestamp: event.timestamp,
        type: 'Audit',
        actor: event.changedBy?.name || 'System',
        subject: event.claim?.claim_number || event.targetUser?.name || event.master_data_key || 'System',
        event: event.old_status && event.old_status !== event.new_status
          ? `${event.old_status} → ${event.new_status}`
          : event.new_status || 'System event',
        notes: event.reason || '',
      }));
      const communications: ActivityEntry[] = (messages || []).map(message => ({
        id: `message-${message.id}`,
        timestamp: message.timestamp,
        type: message.channel === 'Email' ? 'Email' : 'Teams',
        actor: message.from || 'Sales Reimbursement System',
        subject: message.to || message.recipient_id || 'Unknown recipient',
        event: message.subject || 'Notification',
        notes: message.body || '',
        deliveryStatus: message.delivery_status || 'Logged',
      }));
      setEntries([...audit, ...communications].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    }).catch(e => setError(e?.message || 'Could not load system activity.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => setCurrentPage(1), [search, typeFilter, actorFilter, dateFrom, dateTo]);

  const actors = useMemo(() => [...new Set(entries.map(e => e.actor).filter(Boolean))].sort(), [entries]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(entry => {
      if (typeFilter && entry.type !== typeFilter) return false;
      if (actorFilter && entry.actor !== actorFilter) return false;
      const timestamp = new Date(entry.timestamp);
      if (dateFrom && timestamp < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && timestamp > new Date(`${dateTo}T23:59:59`)) return false;
      return !q || [entry.actor, entry.subject, entry.event, entry.notes, entry.type]
        .some(value => value.toLowerCase().includes(q));
    });
  }, [entries, search, typeFilter, actorFilter, dateFrom, dateTo]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageEntries = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <span className="font-label-sm text-primary font-bold tracking-wider uppercase">System Administration</span>
        <h1 className="font-display text-display text-on-surface mt-1">System Activity</h1>
        <p className="text-body-md text-outline mt-1">Claim events, status changes, Teams messages, MOM emails, and delivery records in one feed.</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search activity…" />
          <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All event types</option>
            <option value="Audit">Audit events</option>
            <option value="Teams">Teams messages</option>
            <option value="Email">MOM emails</option>
          </Select>
          <Select value={actorFilter} onChange={e => setActorFilter(e.target.value)}>
            <option value="">All users/senders</option>
            {actors.map(actor => <option key={actor} value={actor}>{actor}</option>)}
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-label="From date" />
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} aria-label="To date" />
        </div>
      </Card>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <h3 className="font-label-md uppercase tracking-wider text-on-surface">Unified Event Feed</h3>
          <span className="font-label-sm text-outline">{filtered.length} event{filtered.length === 1 ? '' : 's'}</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr><th className="px-5 py-4">Timestamp</th><th className="px-5 py-4">Type</th><th className="px-5 py-4">User / Sender</th><th className="px-5 py-4">Subject / Recipient</th><th className="px-5 py-4">Event</th><th className="px-5 py-4">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-outline"><span className="material-symbols-outlined animate-spin">sync</span></td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-error">{error}</td></tr>
              ) : pageEntries.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-outline">No events match these filters.</td></tr>
              ) : pageEntries.map(entry => (
                <tr key={entry.id} className="hover:bg-primary-container/5">
                  <td className="px-5 py-4 font-mono-data text-sm whitespace-nowrap">{formatDateTime(entry.timestamp)}</td>
                  <td className="px-5 py-4"><span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-bold">{entry.type}</span></td>
                  <td className="px-5 py-4 text-sm font-semibold">{entry.actor}</td>
                  <td className="px-5 py-4 text-sm text-primary font-mono-data">{entry.subject}</td>
                  <td className="px-5 py-4 text-sm">{entry.event}{entry.deliveryStatus ? <span className="block text-xs text-outline">{entry.deliveryStatus}</span> : null}</td>
                  <td className="px-5 py-4 text-sm text-on-surface-variant max-w-sm truncate" title={entry.notes}>{entry.notes || '—'}</td>
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
