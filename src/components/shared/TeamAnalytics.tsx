import { Claim, ExpenseLineItem, User } from '../../types';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAxisMoney, formatMoney } from '../../lib/money';
import { calculateTeamAnalytics } from '../../lib/teamAnalytics';
import { Card } from '../ui/Card';

interface TeamAnalyticsProps {
  members: User[];
  claims: Claim[];
  lineItems: ExpenseLineItem[];
  title?: string;
  description?: string;
  showSpendCharts?: boolean;
}

interface TeamMemberSpendingProps {
  members: User[];
  claims: Claim[];
  lineItems: ExpenseLineItem[];
}

export function TeamMemberSpending({ members, claims, lineItems }: TeamMemberSpendingProps) {
  const analytics = calculateTeamAnalytics({ members, claims, lineItems });
  const maxMemberSpend = Math.max(...analytics.members.map(member => member.receiptSpend), 1);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h4 className="font-headline-md text-on-surface">Team Member Spending</h4>
          <p className="text-xs text-outline mt-1">Receipt-supported spend by direct report.</p>
        </div>
        <span className="text-xs text-outline">{analytics.receiptCount} receipts</span>
      </div>
      {analytics.members.length === 0 ? (
        <div className="py-10 text-center text-outline text-body-sm">No direct-report expenses are available.</div>
      ) : (
        <div className="space-y-3">
          {analytics.members.map(member => (
            <div key={member.id} className="rounded-lg border border-outline-variant p-3 bg-surface-container-lowest">
              <div className="flex items-center gap-3">
                {member.avatarUrl ? (
                  <img src={member.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary-container text-primary flex items-center justify-center font-bold text-xs">
                    {member.name.split(' ').map(part => part[0]).join('').slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-label-md text-on-surface truncate">{member.name}</p>
                      <p className="text-[11px] text-outline">{member.claimCount} requests · {member.pendingCount} open · {member.receiptCount} receipts</p>
                    </div>
                    <p className="font-mono-data font-bold text-on-surface">{formatMoney(member.receiptSpend)}</p>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-container-high mt-2 overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, (member.receiptSpend / maxMemberSpend) * 100)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function TeamAnalytics({
  members,
  claims,
  lineItems,
  title = 'Team Analytics',
  description = 'Direct-report activity and receipt-supported spend.',
  showSpendCharts = true,
}: TeamAnalyticsProps) {
  const analytics = calculateTeamAnalytics({ members, claims, lineItems });
  const maxMemberSpend = Math.max(...analytics.members.map(member => member.receiptSpend), 1);
  const maxCategorySpend = Math.max(...analytics.categories.map(category => category.amount), 1);

  if (members.length === 0) {
    return (
      <Card className="p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-outline mb-2">group_off</span>
        <p className="font-headline-sm text-on-surface">No direct reports found</p>
        <p className="text-body-sm text-outline mt-1">Team analytics will appear when people report to this approver.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-6 border-b border-outline-variant bg-surface-container-low/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">groups</span>
            <h3 className="font-headline-md text-on-surface">{title}</h3>
          </div>
          <p className="text-body-sm text-outline mt-1">{description}</p>
        </div>
        <div className="grid grid-cols-3 gap-3 min-w-full sm:min-w-[470px] lg:min-w-[520px]">
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-outline">Team members</p>
            <p className="font-headline-sm text-on-surface mt-1">{members.length}</p>
          </div>
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-outline">Open requests</p>
            <p className="font-headline-sm text-tertiary mt-1">{analytics.pendingClaims}</p>
          </div>
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-outline">Reimbursed 7d</p>
            <p className="font-mono-data font-bold text-primary mt-1">{formatMoney(analytics.reimbursedThisWeek)}</p>
          </div>
        </div>
      </div>

      {showSpendCharts && (
        <div className="grid grid-cols-1 xl:grid-cols-5 border-b border-outline-variant">
          <div className="xl:col-span-3 p-6 xl:border-r border-outline-variant">
            <div className="mb-4">
              <h4 className="font-label-lg text-on-surface">Team spend and payouts</h4>
              <p className="text-xs text-outline mt-1">Receipt-supported spend compared with actual company reimbursements</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.members.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" axisLine={false} tickLine={false} fontSize={11} stroke="#667085" tickFormatter={formatAxisMoney} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} fontSize={11} stroke="#667085" width={112} />
                  <Tooltip formatter={(value: number, key: string) => [formatMoney(value), key === 'receiptSpend' ? 'Supported spend' : 'Paid']} />
                  <Bar dataKey="receiptSpend" fill="#004ac6" radius={[0, 5, 5, 0]} barSize={13} />
                  <Bar dataKey="paidAmount" fill="#0d9488" radius={[0, 5, 5, 0]} barSize={13} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="xl:col-span-2 p-6 bg-surface-container-low/20">
            <div className="mb-4">
              <h4 className="font-label-lg text-on-surface">Category mix</h4>
              <p className="text-xs text-outline mt-1">Where receipt-backed team spend is concentrated</p>
            </div>
            {analytics.categories.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-sm text-outline">No team receipts are available.</div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.categories.slice(0, 6)} margin={{ top: 8, right: 4, bottom: 8, left: 4 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} stroke="#667085" interval={0} angle={-18} textAnchor="end" height={54} />
                    <YAxis axisLine={false} tickLine={false} fontSize={11} stroke="#667085" tickFormatter={formatAxisMoney} width={58} />
                    <Tooltip formatter={(value: number) => [formatMoney(value), 'Supported spend']} />
                    <Bar dataKey="amount" fill="#943700" radius={[6, 6, 0, 0]} barSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-0">
        <div className="xl:col-span-3 p-6 xl:border-r border-outline-variant">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-label-lg text-on-surface">Team member comparison</h4>
            <span className="text-xs text-outline">{analytics.receiptCount} supported receipts</span>
          </div>
          <div className="space-y-3">
            {analytics.members.map(member => (
              <div key={member.id} className="rounded-lg border border-outline-variant p-3 bg-surface-container-lowest">
                <div className="flex items-center gap-3">
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-primary-container text-primary flex items-center justify-center font-bold text-xs">
                      {member.name.split(' ').map(part => part[0]).join('').slice(0, 2)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-label-md text-on-surface truncate">{member.name}</p>
                        <p className="text-[11px] text-outline">{member.claimCount} requests · {member.pendingCount} open · {member.receiptCount} receipts</p>
                      </div>
                      <p className="font-mono-data font-bold text-on-surface">{formatMoney(member.receiptSpend)}</p>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-container-high mt-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(3, (member.receiptSpend / maxMemberSpend) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="xl:col-span-2 p-6 bg-surface-container-low/20">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-label-lg text-on-surface">Supported spend by category</h4>
            <span className="font-mono-data text-xs text-primary">{formatMoney(analytics.receiptSpend)}</span>
          </div>
          {analytics.categories.length === 0 ? (
            <div className="py-10 text-center text-outline text-body-sm">No team receipts are available.</div>
          ) : (
            <div className="space-y-4">
              {analytics.categories.slice(0, 6).map(category => (
                <div key={category.name}>
                  <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                    <span className="font-medium text-on-surface truncate">{category.name}</span>
                    <span className="font-mono-data text-on-surface-variant whitespace-nowrap">{formatMoney(category.amount)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                    <div
                      className="h-full rounded-full bg-tertiary"
                      style={{ width: `${Math.max(3, (category.amount / maxCategorySpend) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-outline mt-1">{category.receiptCount} receipt{category.receiptCount === 1 ? '' : 's'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
