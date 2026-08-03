import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { KPICard } from '../../components/ui/KPICard';
import { Button } from '../../components/ui/Button';
import { Select, Input, Label } from '../../components/ui/Input';
import { Modal } from '../../components/shared/Modal';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { UserRole, ClaimStatus, SupportRequestStatus } from '../../types';
import { fetchAuditHistory, runFallbackCheck, reassignApprover } from '../../lib/api';
import { CHART_COLORS } from '../../lib/chartTheme';

function statusDistributionColor(status: string): string {
  if ([ClaimStatus.COMPLETED, ClaimStatus.CLOSED, ClaimStatus.LIQUIDATED].includes(status as ClaimStatus)) return CHART_COLORS.success;
  if (status === ClaimStatus.REJECTED) return CHART_COLORS.error;
  if (status === ClaimStatus.RETURNED) return CHART_COLORS.tertiary;
  if ([ClaimStatus.APPROVED, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM, ClaimStatus.RELEASED, ClaimStatus.REVIEWED].includes(status as ClaimStatus)) return CHART_COLORS.primary;
  return CHART_COLORS.secondary;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  new_status: string;
  reason?: string;
  changedBy?: { name: string; role: string };
  claim?: { claim_number?: string };
  targetUser?: { name: string };
  master_data_key?: string;
}

const TERMINAL_STATUSES: string[] = [
  ClaimStatus.COMPLETED, ClaimStatus.REJECTED, ClaimStatus.LIQUIDATED, ClaimStatus.CLOSED,
];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function describeEntry(e: AuditEntry): string {
  if (e.claim?.claim_number) return `${e.claim.claim_number} → ${e.new_status}`;
  if (e.targetUser?.name) return `${e.targetUser.name}: ${e.new_status}`;
  if (e.master_data_key) return `${e.master_data_key}: ${e.new_status}`;
  return e.reason || e.new_status;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const { users, claims, masterData, supportRequests, refresh } = useAppContext();
  const { addToast } = useToast();

  const [recentAudit, setRecentAudit] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState('');
  const [runningFallback, setRunningFallback] = useState(false);
  const [reassigningClaimId, setReassigningClaimId] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [submittingReassign, setSubmittingReassign] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAuditHistory({ limit: 5 })
      .then((data: AuditEntry[]) => { if (alive) setRecentAudit(data || []); })
      .catch((e: any) => { if (alive) setAuditError(e?.message || 'Could not load recent activity.'); });
    return () => { alive = false; };
  }, []);

  const activeClaims = useMemo(
    () => claims.filter(c => !TERMINAL_STATUSES.includes(c.status)).length,
    [claims]
  );
  const openSupportRequests = useMemo(
    () => supportRequests.filter(s => s.status !== SupportRequestStatus.RESOLVED).length,
    [supportRequests]
  );
  const inactiveMasterData = useMemo(
    () => masterData.filter(d => !d.active).length,
    [masterData]
  );

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    claims.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [claims]);

  const statusTotal = useMemo(() => statusBreakdown.reduce((acc, [, n]) => acc + n, 0), [statusBreakdown]);
  // Org-change fallback (docs/hierarchy-sync-design.md §5): a claim whose
  // approver went stale and nobody transferred it within the fallback window
  // needs an admin to step in. This is normally a cron; there's no scheduler
  // in this prototype, so the sweep is a manual trigger.
  const staleClaims = useMemo(
    () => claims.filter(c => c.approverStaleSince && !c.escalatedToAdmin),
    [claims]
  );
  const approvers = useMemo(() => users.filter(u => u.role === UserRole.APPROVER), [users]);

  const handleRunFallbackCheck = async () => {
    setRunningFallback(true);
    try {
      const result = await runFallbackCheck(true);
      await refresh();
      addToast(`Fallback check ran — ${result.escalatedCount} claim(s) escalated.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not run the fallback check.', 'error');
    } finally {
      setRunningFallback(false);
    }
  };

  const openReassign = (claimId: string) => {
    setReassigningClaimId(claimId);
    setReassignTarget('');
    setReassignReason('');
  };

  const handleReassign = async () => {
    if (!reassigningClaimId) return;
    if (!reassignTarget || !reassignReason.trim()) {
      addToast('Pick a new approver and give a reason.', 'error');
      return;
    }
    setSubmittingReassign(true);
    try {
      await reassignApprover(reassigningClaimId, reassignTarget, reassignReason.trim());
      await refresh();
      addToast('Claim reassigned.', 'success');
      setReassigningClaimId(null);
    } catch (err: any) {
      addToast(err?.message || 'Could not reassign this claim.', 'error');
    } finally {
      setSubmittingReassign(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="font-display text-display text-on-surface">System Administration</h1>
          <p className="text-body-md text-outline mt-1">Global platform metrics, settings, and health.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => navigate('/settings?tab=demo-data')}>
            <span className="material-symbols-outlined text-[18px]">tune</span>
            Demo Data
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => navigate('/settings')}>
            <span className="material-symbols-outlined text-[18px]">settings</span>
            System Settings
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard title="Total Users" value={users.length.toString()} icon="group" iconColorClass="bg-blue-100 text-blue-700" />
        <KPICard title="Active Claims" value={activeClaims.toString()} icon="receipt_long" iconColorClass="bg-indigo-100 text-indigo-700" trend="In flight (not yet terminal)" />
        <KPICard
          title="Open Support Requests"
          value={openSupportRequests.toString()}
          icon="support_agent"
          iconColorClass={openSupportRequests > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}
          trend={openSupportRequests > 0 ? 'Needs attention' : 'All clear'}
          trendColorClass={openSupportRequests > 0 ? 'text-red-600' : 'text-green-600'}
          trendIcon={openSupportRequests > 0 ? 'trending_down' : 'trending_up'}
        />
        <KPICard
          title="Inactive Master Data"
          value={inactiveMasterData.toString()}
          icon="database"
          iconColorClass="bg-amber-100 text-amber-700"
          trend={inactiveMasterData > 0 ? 'Review recommended' : 'All active'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="p-6">
          <div className="flex justify-between items-start mb-5">
            <div>
              <h4 className="font-headline-md text-on-surface">Claims by status</h4>
              <p className="mt-1 text-xs text-outline">Distribution of all {statusTotal} claims across their current workflow state.</p>
            </div>
            <span className="material-symbols-outlined text-primary">bar_chart</span>
          </div>
          {statusBreakdown.length === 0 ? (
            <p className="text-body-sm text-outline">No claims in the system yet.</p>
          ) : (
            <div role="img" aria-label={`${statusTotal} claims grouped by status. The list provides each status count and share.`}>
              <div className="mb-5 flex h-3 w-full overflow-hidden rounded-full bg-surface-container-high" aria-hidden="true">
                {statusBreakdown.map(([status, count]) => (
                  <span
                    key={status}
                    style={{ width: `${(count / statusTotal) * 100}%`, backgroundColor: statusDistributionColor(status) }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {statusBreakdown.map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-container-low">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusDistributionColor(status) }} />
                      <span className="text-sm text-on-surface-variant truncate">{status}</span>
                    </div>
                    <div className="flex items-baseline gap-2 flex-shrink-0">
                      <span className="font-label-md text-on-surface">{count}</span>
                      <span className="text-[12px] text-outline w-9 text-right">{Math.round((count / statusTotal) * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h4 className="font-headline-md text-on-surface">Recent Activity</h4>
            <span className="material-symbols-outlined text-outline">gavel</span>
          </div>
          {auditError ? (
            <p className="text-body-sm text-error">{auditError}</p>
          ) : recentAudit.length === 0 ? (
            <p className="text-body-sm text-outline">No recent activity.</p>
          ) : (
            <div className="space-y-4">
              {recentAudit.map((e, i) => (
                <div key={e.id} className={`flex items-start gap-3 ${i < recentAudit.length - 1 ? 'border-b border-outline-variant pb-3' : ''}`}>
                  <span className="material-symbols-outlined text-secondary">history</span>
                  <div>
                    <p className="font-label-md text-on-surface">{describeEntry(e)}</p>
                    {e.changedBy?.name && <p className="text-body-sm text-outline">by {e.changedBy.name}</p>}
                    <p className="text-[12px] text-outline mt-1">{timeAgo(e.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="pt-4 mt-2 border-t border-outline-variant">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/admin/audit')}>
              View full audit log <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Button>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h4 className="font-headline-md text-on-surface">Stale Approvals — Org-Change Fallback</h4>
            <p className="text-body-sm text-outline mt-1">Claims whose approver went stale after an org-chart change and haven't been transferred yet.</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleRunFallbackCheck} disabled={runningFallback}>
            {runningFallback ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : <span className="material-symbols-outlined text-[16px]">bolt</span>}
            Run Fallback Check
          </Button>
        </div>
        {staleClaims.length === 0 ? (
          <p className="text-body-sm text-outline">No unresolved stale approvals right now.</p>
        ) : (
          <div className="space-y-2">
            {staleClaims.map(c => {
              const currentApprover = users.find(u => u.id === c.approverId);
              return (
                <div key={c.id} className="flex items-center justify-between p-3 bg-tertiary-container/10 border border-tertiary/20 rounded-lg">
                  <div>
                    <p className="font-label-md text-on-surface cursor-pointer hover:text-primary" onClick={() => navigate(`/claims/${c.id}`)}>{c.ref}</p>
                    <p className="text-body-sm text-outline">Routed to {currentApprover?.name || '(unknown)'} — {c.approverStaleReason || 'org change'}</p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openReassign(c.id)}>
                    <span className="material-symbols-outlined text-[16px]">manage_accounts</span> Reassign
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {reassigningClaimId && (
        <Modal isOpen onClose={() => setReassigningClaimId(null)} titleId="reassign-approver-title" className="max-w-md">
            <div className="bg-surface-container-lowest rounded-xl w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-outline-variant pb-3">
                <h3 id="reassign-approver-title" className="font-headline-sm text-on-surface">Reassign Approver</h3>
                <button aria-label="Close reassign approver dialog" onClick={() => setReassigningClaimId(null)} className="text-outline hover:text-on-surface">
                  <span aria-hidden="true" className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div>
                <Label required>New Approver</Label>
                <Select value={reassignTarget} onChange={e => setReassignTarget(e.target.value)}>
                  <option value="">-- Select --</option>
                  {approvers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </div>
              <div>
                <Label required>Reason</Label>
                <Input value={reassignReason} onChange={e => setReassignReason(e.target.value)} placeholder="Why is this being reassigned?" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
                <Button variant="ghost" onClick={() => setReassigningClaimId(null)} disabled={submittingReassign}>Cancel</Button>
                <Button onClick={handleReassign} disabled={submittingReassign} className="gap-2">
                  {submittingReassign ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : null}
                  Reassign
                </Button>
              </div>
            </div>
        </Modal>
      )}
    </div>
  );
}
