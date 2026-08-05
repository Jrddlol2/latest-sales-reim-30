import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useAppContext } from '../../components/AppContext';
import { Pagination } from '../../components/ui/Pagination';
import { GroupByControl, GroupSection, GroupMetric } from '../../components/shared/GroupByControl';
import { FilterBar } from '../../components/shared/FilterBar';
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
  const [preparedByFilter, setPreparedByFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'client' | 'preparedBy'>('none');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const isApprover = currentUser.role === UserRole.APPROVER;
  const reporteeIds = useMemo(
    () => new Set(users.filter(u => u.reportsTo === currentUser.id).map(u => u.id)),
    [users, currentUser.id]
  );
  // Grouping/filtering by the preparer only tells you anything once more than
  // one person's documents are in view — i.e. an approver looking at the team.
  const canSplitByPreparer = isApprover && scope === 'team';
  const showPreparedBy = canSplitByPreparer;

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
  // Preparers in view, as {id, name} so the filter/grouping key is the stable
  // requestorId while the label stays a friendly name (falling back to the
  // free-text preparedBy for legacy rows with no linked user).
  const preparerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of scopedMoms) {
      if (!m.requestorId) continue;
      if (!map.has(m.requestorId)) {
        map.set(m.requestorId, users.find(u => u.id === m.requestorId)?.name || m.preparedBy || 'Unknown preparer');
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedMoms, users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...scopedMoms].filter(m => {
      if (linkFilter === 'linked' && !m.claimId) return false;
      if (linkFilter === 'unlinked' && m.claimId) return false;
      if (statusFilter && m.status !== statusFilter) return false;
      if (docTypeFilter && (m.documentType === 'LOA' ? 'LOA' : 'MoM') !== docTypeFilter) return false;
      if (clientFilter && m.companyName !== clientFilter) return false;
      if (preparedByFilter && m.requestorId !== preparedByFilter) return false;
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
  }, [scopedMoms, query, linkFilter, statusFilter, docTypeFilter, clientFilter, preparedByFilter, locationFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedMOMs = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Grouped view: bucket the filtered records by the active dimension, with a
  // count + finalized tally per group (MoMs carry no monetary amount to total).
  const groups = useMemo(() => {
    if (groupBy === 'none') return [];
    const map = new Map<string, typeof filtered>();
    for (const m of filtered) {
      const key = groupBy === 'client' ? (m.companyName || '—') : (m.requestorId || 'unknown');
      const bucket = map.get(key);
      if (bucket) bucket.push(m);
      else map.set(key, [m]);
    }
    return Array.from(map.entries()).map(([key, items]) => {
      const label = groupBy === 'client'
        ? (key === '—' ? 'No client' : key)
        : (users.find(u => u.id === key)?.name || items[0]?.preparedBy || 'Unknown preparer');
      const finalized = items.filter(m => m.status === 'Completed').length;
      return { key, label, items, finalized };
    }).sort((a, b) => b.items.length - a.items.length);
  }, [filtered, groupBy, users]);

  // "By preparer" stops making sense the moment we're back to a single
  // person's documents, so fall back to a flat list.
  useEffect(() => {
    if (!canSplitByPreparer && groupBy === 'preparedBy') setGroupBy('none');
  }, [canSplitByPreparer, groupBy]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [query, scope, linkFilter, statusFilter, docTypeFilter, clientFilter, preparedByFilter, locationFilter, dateFrom, dateTo]);

  const claimRefFor = (claimId?: string) =>
    claimId ? claims.find(c => c.id === claimId)?.ref : undefined;
  const groupByOptions = [
    { value: 'none', label: 'List', icon: 'view_list' },
    { value: 'client', label: 'By Client', icon: 'domain' },
    ...(canSplitByPreparer ? [{ value: 'preparedBy', label: 'By Prepared By', icon: 'person' }] : []),
  ];

  const renderMomTable = (items: typeof filtered, showPreparer: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
          <tr>
            <th className="px-6 py-4">Type</th>
            <th className="px-6 py-4">Purpose</th>
            <th className="px-6 py-4">Client</th>
            <th className="px-6 py-4">Location of Meeting</th>
            <th className="px-6 py-4">Date of Meeting</th>
            {showPreparer && <th className="px-6 py-4">Prepared By</th>}
            <th className="px-6 py-4">Claim</th>
            <th className="px-6 py-4 text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {items.length === 0 ? (
            <tr>
              <td colSpan={showPreparer ? 8 : 7} className="px-6 py-12 text-center text-outline">
                <span className="material-symbols-outlined text-4xl mb-2 opacity-50">description</span>
                <p className="font-label-md">{moms.length === 0 ? 'No minutes or agreements found.' : 'No records match your search.'}</p>
              </td>
            </tr>
          ) : items.map(mom => {
            const ref = claimRefFor(mom.claimId);
            const dt: MomDocumentType = mom.documentType === 'LOA' ? 'LOA' : 'MoM';
            return (
              <tr
                key={mom.id}
                className="hover:bg-primary-container/5 transition-colors cursor-pointer"
                onClick={() => navigate(`/moms/${mom.id}`)}
              >
                <td className="px-6 py-5">
                  <span
                    title={DOCUMENT_TYPE_LABEL[dt]}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${dt === 'LOA' ? 'bg-tertiary-container/50 text-tertiary' : 'bg-primary-container/40 text-on-primary-container'}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">{dt === 'LOA' ? 'handshake' : 'description'}</span>
                    {dt}
                  </span>
                </td>
                <td className="px-6 py-5">
                  <p className="font-bold text-on-surface">{mom.purposeOfMeeting || 'Untitled meeting'}</p>
                </td>
                <td className="px-6 py-5 text-on-surface-variant text-sm">{mom.companyName || '—'}</td>
                <td className="px-6 py-5 text-on-surface-variant text-sm">{mom.location || '—'}</td>
                <td className="px-6 py-5 font-mono-data text-on-surface-variant text-sm">
                  {mom.meetingDate ? formatDate(mom.meetingDate) : '—'}
                </td>
                {showPreparer && <td className="px-6 py-5 text-on-surface-variant text-sm">{mom.preparedBy || '—'}</td>}
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
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="font-display text-display text-on-surface">Minutes &amp; Agreements</h1>
          <p className="text-body-md text-outline mt-1">Track the meeting minutes and letters of agreement attached to claims.</p>
        </div>
        <Button className="gap-2" onClick={() => navigate('/moms/new')}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          Create Minutes or Agreement
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {isApprover ? (
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
        ) : <span />}
        <GroupByControl value={groupBy} options={groupByOptions} onChange={v => setGroupBy(v as typeof groupBy)} />
      </div>

      <FilterBar
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search minutes and agreements..."
        advancedFilters={[
          {
            type: 'select', key: 'link', label: 'Claim linkage', placeholder: 'All linkages',
            value: linkFilter === 'all' ? '' : linkFilter,
            onChange: v => setLinkFilter((v || 'all') as typeof linkFilter),
            options: [{ value: 'linked', label: 'Linked to claim' }, { value: 'unlinked', label: 'Unlinked' }],
          },
          {
            type: 'select', key: 'status', label: 'Document status', placeholder: 'All statuses',
            value: statusFilter, onChange: setStatusFilter,
            options: [{ value: 'Draft', label: 'Draft' }, { value: 'Completed', label: 'Finalized' }],
          },
          {
            type: 'select', key: 'docType', label: 'Document type', placeholder: 'All types',
            value: docTypeFilter, onChange: v => setDocTypeFilter(v as typeof docTypeFilter),
            options: [{ value: 'MoM', label: 'Minutes of Meeting' }, { value: 'LOA', label: 'Letter of Agreement' }],
          },
          {
            type: 'select', key: 'client', label: 'Client', placeholder: 'All clients',
            value: clientFilter, onChange: setClientFilter,
            options: clientOptions.map(c => ({ value: c, label: c })),
          },
          ...(canSplitByPreparer ? [{
            type: 'select' as const, key: 'preparedBy', label: 'Prepared by', placeholder: 'All preparers',
            value: preparedByFilter, onChange: setPreparedByFilter,
            options: preparerOptions.map(p => ({ value: p.id, label: p.name })),
          }] : []),
          {
            type: 'select', key: 'location', label: 'Location', placeholder: 'All locations',
            value: locationFilter, onChange: setLocationFilter,
            options: locationOptions.map(l => ({ value: l, label: l })),
          },
          {
            type: 'dateRange', key: 'meeting', label: 'Meeting',
            fromValue: dateFrom, toValue: dateTo, onFromChange: setDateFrom, onToChange: setDateTo,
          },
        ]}
      />

      <Card>
        <CardHeader className="bg-surface-container-low">
          <div className="flex justify-between items-center">
            <h3 className="font-label-md uppercase tracking-wider text-on-surface whitespace-nowrap">Records</h3>
            <span className="font-label-sm text-outline whitespace-nowrap">{filtered.length} of {moms.length}</span>
          </div>
        </CardHeader>
        {groupBy === 'none' && (
          <>
            {renderMomTable(paginatedMOMs, showPreparedBy)}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </>
        )}
      </Card>

      {groupBy !== 'none' && (
        <div className="space-y-5">
          <p className="text-sm text-outline">
            {groups.length} {groupBy === 'client' ? (groups.length === 1 ? 'client' : 'clients') : (groups.length === 1 ? 'preparer' : 'preparers')}
            {' · '}{filtered.length} record{filtered.length === 1 ? '' : 's'}
          </p>
          {groups.length === 0 ? (
            <Card className="p-12 text-center text-outline">
              <span className="material-symbols-outlined text-4xl mb-2 opacity-50">description</span>
              <p className="font-label-md">No records match your search.</p>
            </Card>
          ) : groups.map(group => (
            <GroupSection
              key={group.key}
              icon={groupBy === 'client' ? 'domain' : 'person'}
              title={group.label}
              badge={`${group.items.length} document${group.items.length === 1 ? '' : 's'}`}
              metrics={
                <GroupMetric label="Finalized" value={`${group.finalized}/${group.items.length}`} muted />
              }
            >
              {renderMomTable(group.items, groupBy === 'client' && showPreparedBy)}
            </GroupSection>
          ))}
        </div>
      )}
    </div>
  );
}
