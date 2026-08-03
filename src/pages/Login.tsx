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
  const [demoOpen, setDemoOpen] = useState(false);

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
    setDemoOpen(true);
    window.setTimeout(() => {
      document.getElementById('demo-access')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
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
    <main className="min-h-screen bg-[#e4efff] lg:grid lg:grid-cols-[minmax(500px,1.2fr)_minmax(480px,0.8fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#073b8f] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between 2xl:px-16 2xl:py-12">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="login-orb-drift-a absolute -right-44 -top-40 h-[480px] w-[480px] rounded-full bg-[#5e9aeb]/[0.18] blur-[14px] shadow-[inset_0_0_80px_rgba(184,216,255,0.12)]" />
          <div className="login-orb-drift-b absolute right-12 top-[23%] h-44 w-44 rounded-full bg-[#75b6ff]/[0.20] blur-[10px] shadow-[inset_0_0_38px_rgba(204,229,255,0.14)]" />
          <div className="login-orb-drift-c absolute -bottom-56 -left-48 h-[520px] w-[520px] rounded-full bg-[#347ad5]/[0.34] blur-[18px] shadow-[inset_0_0_90px_rgba(137,190,255,0.10)]" />
        </div>

        <div className="relative z-10">
          <img src="/logo/logo.png" alt="Microgenesis" className="h-auto w-[205px] object-contain object-left" />
        </div>

        <div className="relative z-10 max-w-md pb-8">
          <p className="mb-4 text-sm font-medium text-blue-200">Internal business system</p>
          <h1 className="text-[38px] font-semibold leading-[1.14] tracking-[-0.025em] 2xl:text-[44px]">
            Sales Reimbursement System
          </h1>
          <p className="mt-5 max-w-sm text-[16px] leading-7 text-blue-100">
            Submit, approve, and track employee reimbursements in one workspace.
          </p>
        </div>

        <div className="relative z-10 border-t border-white/15 pt-5 text-xs text-blue-200">
          <p>Microgenesis Business Systems</p>
          <p className="mt-1 text-blue-300">Authorized employees only</p>
        </div>
      </section>

      <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-6 sm:px-8 lg:px-10 lg:py-5">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="login-orb-drift-b absolute -right-32 -top-40 h-[430px] w-[430px] rounded-full bg-[#2d7be8]/[0.14] blur-[18px] shadow-[inset_0_0_80px_rgba(255,255,255,0.35)]" />
          <div className="login-orb-drift-a absolute -bottom-52 right-[8%] h-[390px] w-[390px] rounded-full bg-[#66a3f2]/[0.13] blur-[20px] shadow-[inset_0_0_80px_rgba(255,255,255,0.38)]" />
        </div>

        <div className="relative z-10 w-full max-w-[430px]">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <div>
              <p className="text-lg font-bold tracking-[-0.02em] text-[#073b8f]">MICROGENESIS</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-outline">Sales Reimbursement System</p>
            </div>
          </div>

          <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-[0_10px_30px_rgba(15,39,84,0.07)]">
            <div className="mb-7">
              <p className="mb-2 text-sm font-semibold text-primary">Sales Reimbursement System</p>
              <h2 className="text-[28px] font-semibold leading-9 tracking-[-0.025em] text-on-surface">Welcome back</h2>
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
                  className="flex h-12 w-full items-center justify-center gap-3 rounded-lg bg-primary px-4 text-[15px] font-semibold text-white transition hover:bg-[#003da5] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <MicrosoftMark />
                  Sign in with Microsoft
                </button>
                <p className="mt-2.5 flex items-center justify-center gap-1.5 text-xs text-outline">
                  <span className="material-symbols-outlined text-[15px]">lock</span>
                  Use your Microgenesis work account.
                </p>

                {notice && (
                  <div className="mt-4 flex gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-5 text-blue-900" role="status">
                    <span className="material-symbols-outlined mt-0.5 text-[18px]">info</span>
                    <p>{notice}</p>
                  </div>
                )}

                {config?.demoLoginEnabled && (
                  <div id="demo-access" className={`${notice ? 'mt-4' : 'mt-6'} border-t border-[#e4e8ef] pt-5`}>
                    <button
                      type="button"
                      onClick={() => setDemoOpen(open => !open)}
                      aria-expanded={demoOpen}
                      aria-controls="demo-access-panel"
                      className="flex w-full items-center justify-between gap-4 rounded-lg p-2 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    >
                      <span>
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-on-surface">Demo access</span>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800">Development only</span>
                        </span>
                        <span className="mt-1 block text-xs text-outline">Preview the system with a test role.</span>
                      </span>
                      <span className="material-symbols-outlined text-[20px] text-outline">{demoOpen ? 'expand_less' : 'expand_more'}</span>
                    </button>

                    {demoOpen && <div id="demo-access-panel" className="mt-4 rounded-lg border border-[#e1e6ee] bg-[#f8fafc] p-4">
                    <label className="block text-xs font-semibold text-on-surface-variant" htmlFor="demo-role">Role</label>
                    <div className="relative mt-2">
                      <select
                        id="demo-role"
                        value={selectedRole}
                        onChange={event => chooseRole(event.target.value)}
                        className="h-11 w-full appearance-none rounded-lg border border-[#cbd2dc] bg-white pl-4 pr-10 text-sm font-medium text-on-surface outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                      >
                        {roles.map(role => <option key={role} value={role}>{ROLE_META[role]?.label || role}</option>)}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-outline">expand_more</span>
                    </div>

                    <label className="mt-4 block text-xs font-semibold text-on-surface-variant" htmlFor="demo-account">Demo account</label>
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
                      className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary bg-white px-4 text-sm font-semibold text-primary transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Launch demo as {ROLE_META[selectedRole]?.label || selectedRole}
                      <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                    </button>
                    </div>}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-outline lg:hidden">
            <span className="inline-flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">lock</span>Authorized users only</span>
            <span>Need access? Contact your administrator.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
