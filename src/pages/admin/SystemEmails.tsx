import { useState, useEffect } from 'react';
import { Portal } from '../../components/shared/Portal';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { useAppContext } from '../../components/AppContext';
import { fetchOutbox, PageResult, fromServerEmail } from '../../lib/api';
import { SystemEmail } from '../../types';
import { formatDateTime } from '../../lib/date';

const PAGE_SIZE = 25;

export function SystemEmails() {
  const { markEmailsRead, users } = useAppContext();
  const [selected, setSelected] = useState<SystemEmail | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [emails, setEmails] = useState<SystemEmail[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const handle = setTimeout(() => {
      fetchOutbox({ page: currentPage, pageSize: PAGE_SIZE, search: searchTerm })
        .then((data: PageResult<any>) => {
          if (!alive) return;
          const items = (data.items || []).map(fromServerEmail);
          setEmails(items);
          setTotal(data.total || 0);
          setUnread(data.unreadTotal ?? 0);
        })
        .catch(e => { if (alive) setError(e?.message || 'Could not load system emails.'); })
        .finally(() => { if (alive) setLoading(false); });
    }, searchTerm ? 300 : 0);
    return () => { alive = false; clearTimeout(handle); };
  }, [currentPage, searchTerm]);

  const openEmail = (email: SystemEmail) => {
    if (!email.read) {
      markEmailsRead([email.id]);
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, read: true } : e));
      setUnread(u => Math.max(0, u - 1));
    }
    setSelected({ ...email, read: true });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">System Emails</h1>
          <p className="text-body-md text-outline mt-1">Every system-generated notification and transaction email, as sent.</p>
        </div>
        <div className="flex gap-2 text-xs font-semibold">
          <span className="bg-primary-container/20 text-primary px-3 py-1.5 rounded-full">Total: {total}</span>
          <span className="bg-amber-100 text-amber-800 px-3 py-1.5 rounded-full">Unread: {unread}</span>
        </div>
      </div>

      <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant max-w-lg">
        <Input
          type="text"
          placeholder="Search by subject, body, recipient name or email..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low/50 border-b border-outline-variant flex justify-between items-center">
          <h4 className="font-headline-md text-on-surface">Sent Mail Log</h4>
          <span className="font-label-sm text-outline">{total} shown</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-outline font-label-sm uppercase tracking-wider">
              <tr>
                <th className="w-8 px-4 py-4"></th>
                <th className="px-4 py-4">Timestamp</th>
                <th className="px-4 py-4">Recipient</th>
                <th className="px-4 py-4">Subject & Preview</th>
                <th className="px-4 py-4 w-20 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-outline">
                  <span className="material-symbols-outlined animate-spin">sync</span>
                </td></tr>
              ) : error ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-error">{error}</td></tr>
              ) : emails.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-outline">No matching system emails found.</td></tr>
              ) : emails.map(e => {
                const recipient = users.find(u => u.id === e.recipientId);
                return (
                  <tr
                    key={e.id}
                    onClick={() => openEmail(e)}
                    className={`hover:bg-brand-row-hover transition-colors cursor-pointer ${!e.read ? 'bg-primary/5 font-semibold' : ''}`}
                  >
                    <td className="px-4 py-4 text-center">
                      <div className={`w-2 h-2 rounded-full mx-auto ${!e.read ? 'bg-primary animate-pulse' : 'bg-transparent'}`} />
                    </td>
                    <td className="px-4 py-4 font-mono-data text-outline text-xs whitespace-nowrap">{formatDateTime(e.timestamp)}</td>
                    <td className="px-4 py-4 text-on-surface text-xs">
                      <p className="font-bold">{recipient?.name || e.to || e.recipientId}</p>
                      <p className="text-outline text-[12px]">{recipient?.email || e.to}</p>
                    </td>
                    <td className="px-4 py-4 text-xs">
                      <p className="text-on-surface font-semibold truncate max-w-md">{e.subject}</p>
                      <p className="text-outline text-[12px] truncate max-w-md">{e.body}</p>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <Button variant="ghost" size="sm" onClick={(ev) => { ev.stopPropagation(); openEmail(e); }}>View</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </Card>

      {selected && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-surface-container-lowest rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] flex flex-col">
              <div className="flex justify-between items-center border-b border-outline-variant pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-[28px]">mail</span>
                  <div>
                    <h3 className="font-headline-sm text-on-surface">System Email Inspector</h3>
                    <p className="text-xs text-outline">Logged on {formatDateTime(selected.timestamp)}</p>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-outline hover:text-on-surface">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant space-y-2 text-xs shrink-0">
                <div className="flex"><span className="w-20 text-outline font-semibold">From:</span><span className="font-mono-data text-on-surface">{selected.from}</span></div>
                <div className="flex"><span className="w-20 text-outline font-semibold">To:</span><span className="font-mono-data text-on-surface">{users.find(u => u.id === selected.recipientId)?.email || selected.to}</span></div>
                <div className="flex"><span className="w-20 text-outline font-semibold">Subject:</span><span className="font-bold text-on-surface">{selected.subject}</span></div>
              </div>

              <div className="bg-white p-6 rounded-lg border border-outline-variant min-h-[160px] text-sm leading-relaxed text-on-surface whitespace-pre-wrap overflow-y-auto">
                {selected.body}
              </div>

              <div className="flex justify-end gap-3 pt-2 shrink-0">
                <Button onClick={() => setSelected(null)}>Close</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
