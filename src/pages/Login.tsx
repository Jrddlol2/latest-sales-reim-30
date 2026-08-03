import { useEffect, useMemo, useState } from 'react';
import { login } from '../lib/api';

interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  job_title: string;
  avatar_url?: string;
}

interface AuthConfig {
  provider: 'microsoft';
  mode: 'demo' | 'microsoft';
  demoLoginEnabled: boolean;
  microsoft: {
    configured: boolean;
    loginUrl: string;
  };
}

const ROLE_META: Record<string, { label: string; icon: string }> = {
  requestor: { label: 'Requestor', icon: 'person' },
  approver: { label: 'Approver', icon: 'approval' },
  custodian: { label: 'Custodian', icon: 'payments' },
  finance: { label: 'Finance', icon: 'account_balance' },
  admin: { label: 'Administrator', icon: 'admin_panel_settings' },
};

const MicrosoftMark = () => (
  <span className="grid h-[18px] w-[18px] grid-cols-2 gap-[2px]" aria-hidden="true">
    <span className="bg-[#f25022]" />
    <span className="bg-[#7fba00]" />
    <span className="bg-[#00a4ef]" />
    <span className="bg-[#ffb900]" />
  </span>
);

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [selectedRole, setSelectedRole] = useState('requestor');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;

    async function loadLogin() {
      try {
        const configResponse = await fetch('/api/auth/config');
        if (!configResponse.ok) throw new Error('Could not load sign-in configuration.');
        const nextConfig = await configResponse.json() as AuthConfig;
        if (!active) return;
        setConfig(nextConfig);

        if (nextConfig.demoLoginEnabled) {
          const usersResponse = await fetch('/api/demo-users');
          if (!usersResponse.ok) throw new Error('Could not load demo accounts.');
          const nextUsers = await usersResponse.json() as DemoUser[];
          if (!active) return;
          setUsers(nextUsers);
          const requestor = nextUsers.find(user => user.role.toLowerCase() === 'requestor');
          setSelectedUserId(requestor?.id || nextUsers[0]?.id || '');
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load sign-in.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadLogin();
    return () => { active = false; };
  }, []);

  const roles = useMemo(() => {
    const available = Array.from(new Set(users.map(user => user.role.toLowerCase())));
    return Object.keys(ROLE_META).filter(role => available.includes(role));
  }, [users]);

  const roleUsers = useMemo(
    () => users.filter(user => user.role.toLowerCase() === selectedRole),
    [selectedRole, users],
  );

  const selectedUser = users.find(user => user.id === selectedUserId);

  const chooseRole = (role: string) => {
    setSelectedRole(role);
    setSelectedUserId(users.find(user => user.role.toLowerCase() === role)?.id || '');
  };

  const startMicrosoftSignIn = () => {
    if (config?.microsoft.configured) {
      window.location.assign(config.microsoft.loginUrl);
      return;
    }
    setNotice('Microsoft sign-in is awaiting your organization\'s Entra setup. Use a demo account below for now.');
    document.getElementById('demo-access')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const continueAsDemo = () => {
    if (!selectedUserId) return;

    // Give every role its own sessionStorage-backed browser context. The
    // launcher stays on this screen so a presenter can immediately choose the
    // next role and open another independent tab.
    const demoTab = window.open('about:blank', '_blank');
    if (!demoTab) {
      setNotice('Your browser blocked the demo tab. Allow pop-ups for this site and try again.');
      return;
    }

    try {
      login(selectedUserId, demoTab.sessionStorage);
      demoTab.opener = null;
      demoTab.location.replace('/');
      setNotice(`${selectedUser?.name || 'The selected account'} opened in a new demo tab.`);
    } catch {
      demoTab.close();
      setNotice('The demo tab could not be prepared. Please try again.');
    }
  };

  return (
    <main className="min-h-screen bg-[#f6f8fc] lg:grid lg:grid-cols-[minmax(420px,0.92fr)_minmax(560px,1.08fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#073b8f] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between 2xl:px-16 2xl:py-12">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -right-36 -top-28 h-[430px] w-[430px] rounded-full border border-white/10" />
          <div className="absolute -right-16 -top-8 h-[300px] w-[300px] rounded-full border border-white/10" />
          <div className="absolute -bottom-52 -left-40 h-[520px] w-[520px] rounded-full bg-[#1459bd]" />
          <div className="absolute bottom-24 left-20 h-28 w-28 rounded-full bg-[#f3bd18]/90 blur-[1px]" />
        </div>

        <div className="relative z-10">
          <img src="/logo/logo.png" alt="Microgenesis" className="h-auto w-[230px] object-contain object-left" />
        </div>

        <div className="relative z-10 max-w-xl pb-8">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-blue-50">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ffd13b]" />
            Sales operations
          </p>
          <h1 className="max-w-lg text-[40px] font-semibold leading-[1.12] tracking-[-0.025em] 2xl:text-[48px]">
            Reimbursements that move as fast as your team.
          </h1>
          <p className="mt-5 max-w-lg text-[16px] leading-7 text-blue-100">
            Submit expenses, route approvals, and track every payment from one secure workspace.
          </p>

          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3 border-t border-white/15 pt-7 text-sm text-blue-100">
            <div><span className="material-symbols-outlined mb-2 block text-[23px] text-white">verified_user</span>Secure access</div>
            <div><span className="material-symbols-outlined mb-2 block text-[23px] text-white">route</span>Clear workflow</div>
            <div><span className="material-symbols-outlined mb-2 block text-[23px] text-white">monitoring</span>Live tracking</div>
          </div>
        </div>

        <p className="relative z-10 text-xs text-blue-200">Microgenesis Business Systems</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-8 lg:px-12">
        <div className="w-full max-w-[520px]">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <div>
              <p className="text-lg font-bold tracking-[-0.02em] text-[#073b8f]">MICROGENESIS</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-outline">Expense Management</p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-primary">Sales operations</span>
          </div>

          <div className="rounded-2xl border border-[#dde3ee] bg-white p-6 shadow-[0_18px_55px_rgba(15,39,84,0.10)] sm:p-9 lg:p-5 2xl:p-9">
            <div className="mb-7 lg:mb-4 2xl:mb-7">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">Sales Reimbursement System</p>
              <h2 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-on-surface">Welcome back</h2>
              <p className="mt-2 text-sm leading-6 text-outline">Sign in with your work account to continue.</p>
            </div>

            {loading ? (
              <div className="flex min-h-64 items-center justify-center" role="status" aria-label="Loading sign-in options">
                <span className="material-symbols-outlined animate-spin text-[30px] text-primary">progress_activity</span>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-error/25 bg-error-container/50 p-4 text-sm text-on-error-container" role="alert">
                <p className="font-semibold">Sign-in could not be loaded</p>
                <p className="mt-1">{error}</p>
                <button type="button" onClick={() => window.location.reload()} className="mt-3 font-semibold text-error underline underline-offset-2">Try again</button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={startMicrosoftSignIn}
                  className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-[#8c939d] bg-white px-4 text-[15px] font-semibold text-[#1f2328] transition hover:border-[#545b65] hover:bg-[#f8f9fb] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <MicrosoftMark />
                  Sign in with Microsoft
                </button>

                {notice && (
                  <div className="mt-4 flex gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-5 text-blue-900" role="status">
                    <span className="material-symbols-outlined mt-0.5 text-[18px]">info</span>
                    <p>{notice}</p>
                  </div>
                )}

                {config?.demoLoginEnabled && (
                  <div id="demo-access" className={`${notice ? 'mt-4' : 'mt-7 lg:mt-5 2xl:mt-7'} border-t border-[#e4e8ef] pt-6 lg:pt-4 2xl:pt-6`}>
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-on-surface">Demo access</h3>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">Development only</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-outline">Preview a role while Microsoft access is being configured.</p>
                      </div>
                    </div>

                    <fieldset>
                      <legend className="mb-2 text-xs font-semibold text-on-surface-variant">Choose a role</legend>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {roles.map(role => {
                          const meta = ROLE_META[role] || { label: role, icon: 'person' };
                          const active = selectedRole === role;
                          return (
                            <button
                              type="button"
                              key={role}
                              onClick={() => chooseRole(role)}
                              aria-pressed={active}
                              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-[11px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 lg:min-h-14 2xl:min-h-16 ${active ? 'border-primary bg-blue-50 text-primary' : 'border-[#dce1e9] text-outline hover:border-[#aeb7c5] hover:bg-slate-50'}`}
                            >
                              <span className="material-symbols-outlined text-[20px]">{meta.icon}</span>
                              {meta.label}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>

                    <label className="mt-4 block text-xs font-semibold text-on-surface-variant lg:mt-3 2xl:mt-4" htmlFor="demo-account">Demo account</label>
                    <div className="relative mt-2">
                      <select
                        id="demo-account"
                        value={selectedUserId}
                        onChange={event => setSelectedUserId(event.target.value)}
                        className="h-12 w-full appearance-none rounded-lg border border-[#cbd2dc] bg-white pl-12 pr-10 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                      >
                        {roleUsers.map(user => <option key={user.id} value={user.id}>{user.name} — {user.job_title}</option>)}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-outline">badge</span>
                      <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-outline">expand_more</span>
                    </div>

                    {selectedUser && (
                      <p className="mt-2 truncate text-xs text-outline">{selectedUser.department} · {selectedUser.email}</p>
                    )}

                    <button
                      type="button"
                      onClick={continueAsDemo}
                      disabled={!selectedUserId}
                      className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition hover:bg-[#003da5] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:mt-4 2xl:mt-5"
                    >
                      Open demo in new tab
                      <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-outline lg:hidden 2xl:flex">
            <span className="inline-flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">lock</span>Authorized users only</span>
            <span>Need access? Contact your administrator.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
