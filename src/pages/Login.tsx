import { useEffect, useState } from 'react';
import { login } from '../lib/api';

interface RawUser {
  id: string;
  name: string;
  role: string;
  department: string;
  job_title: string;
  avatar_url?: string;
}

/**
 * Prototype-level identity gate (PRODUCTION-PASS P0 #1/#2). This is NOT real
 * authentication — there's still no password, and the server still trusts
 * whatever X-User-Id the client sends (see PROJECT-CONTEXT.md §3). What this
 * *does* fix: in a built/production deployment the old Topbar dropdown let
 * anyone become Admin in one click with zero friction. Requiring an explicit
 * "sign in as" step here, gone from the Topbar in prod (see Topbar.tsx), is
 * the honest amount of hardening a header-trust prototype can get without a
 * real session store — the real fix is still P0 #1 (SSO + signed sessions).
 */
export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [users, setUsers] = useState<RawUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/demo-users')
      .then(r => r.json())
      .then(setUsers)
      .catch(() => setError('Could not load accounts.'))
      .finally(() => setLoading(false));
  }, []);

  const grouped: Record<string, RawUser[]> = users.reduce((acc: Record<string, RawUser[]>, u) => {
    (acc[u.role] ||= []).push(u);
    return acc;
  }, {});

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-container-lowest p-6">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <h1 className="font-display text-display text-on-surface mb-2">Sales Reimbursement</h1>
          <p className="text-body-md text-outline">Choose an account to sign in as.</p>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <span className="material-symbols-outlined animate-spin text-primary text-[32px]">sync</span>
          </div>
        )}
        {error && <p className="text-center text-error">{error}</p>}

        {!loading && !error && (
          <>
          {/* Presenter helper: each tab keeps its own signed-in role, so these
              open a fresh tab already signed in as the canonical account for
              that role. Follow one claim across all four without account
              switching. */}
          <div className="mb-6 p-4 rounded-lg border border-outline-variant bg-surface-container-low">
            <p className="text-label-sm text-outline uppercase tracking-wider font-medium mb-2">Presenter mode — open a role in its own tab</p>
            <div className="flex flex-wrap gap-2">
              {[
                { role: 'requestor', label: 'Requestor', icon: 'person' },
                { role: 'approver', label: 'Approver', icon: 'how_to_reg' },
                { role: 'custodian', label: 'Custodian', icon: 'payments' },
                { role: 'finance', label: 'Finance', icon: 'account_balance' },
                { role: 'admin', label: 'Admin', icon: 'admin_panel_settings' },
              ].map(r => (
                <a
                  key={r.role}
                  href={`/?role=${r.role}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-body-sm font-medium hover:bg-primary/20 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">{r.icon}</span>
                  {r.label}
                </a>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            {Object.entries(grouped).map(([role, roleUsers]) => (
              <div key={role}>
                <h3 className="text-label-sm text-outline uppercase tracking-wider font-medium mb-2">{role}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {roleUsers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => { login(u.id); onLoggedIn(); }}
                      className="flex items-center gap-3 p-3 bg-white border border-outline-variant rounded-lg hover:border-primary hover:shadow-sm transition-all text-left"
                    >
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" loading="lazy" width="36" height="36" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-secondary-container flex items-center justify-center font-bold text-on-secondary-container text-sm flex-shrink-0">
                          {u.name.split(' ').map(n => n[0]).join('')}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-label-md text-on-surface truncate">{u.name}</p>
                        <p className="text-body-sm text-outline truncate">{u.job_title}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
