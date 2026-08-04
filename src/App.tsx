/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AppProvider, useAppContext } from './components/AppContext';
import { ToastProvider } from './components/shared/ToastContext';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { isLoggedIn, applyDeepLinkLogin } from './lib/api';
import { UserRole } from './types';
import { CardSkeleton } from './components/shared/states/Skeleton';

// Route-level code-splitting: every page below Layout is its own chunk,
// fetched on first navigation rather than bundled into the initial load.
// Dashboard is the common landing page. Admin analytics is kept in its own
// chunk because its charting dependency is not needed by other roles.
import { Dashboard } from './pages/Dashboard';
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));

const ClaimsList = lazy(() => import('./pages/shared/ClaimsList').then(m => ({ default: m.ClaimsList })));
const Payouts = lazy(() => import('./pages/shared/Payouts').then(m => ({ default: m.Payouts })));
const SubmitClaim = lazy(() => import('./pages/shared/SubmitClaim').then(m => ({ default: m.SubmitClaim })));
const ClaimDetail = lazy(() => import('./pages/shared/ClaimDetail').then(m => ({ default: m.ClaimDetail })));
const ApprovalQueue = lazy(() => import('./pages/approver/ApprovalQueue').then(m => ({ default: m.ApprovalQueue })));
const ProcessingQueue = lazy(() => import('./pages/custodian/ProcessingQueue').then(m => ({ default: m.ProcessingQueue })));
const ReadyToClaimQueue = lazy(() => import('./pages/custodian/ReadyToClaimQueue').then(m => ({ default: m.ReadyToClaimQueue })));
const TransactionHistory = lazy(() => import('./pages/custodian/TransactionHistory').then(m => ({ default: m.TransactionHistory })));
const CustodianAnalytics = lazy(() => import('./pages/custodian/CustodianAnalytics').then(m => ({ default: m.CustodianAnalytics })));
const SystemActivity = lazy(() => import('./pages/admin/SystemActivity').then(m => ({ default: m.SystemActivity })));
const UserAccounts = lazy(() => import('./pages/admin/UserAccounts').then(m => ({ default: m.UserAccounts })));
const MOMs = lazy(() => import('./pages/shared/MOMs').then(m => ({ default: m.MOMs })));
const MomDetail = lazy(() => import('./pages/shared/MomDetail').then(m => ({ default: m.MomDetail })));
const CreateMom = lazy(() => import('./pages/shared/CreateMom').then(m => ({ default: m.CreateMom })));
const Calendar = lazy(() => import('./pages/shared/Calendar').then(m => ({ default: m.Calendar })));
const Settings = lazy(() => import('./pages/shared/Settings').then(m => ({ default: m.Settings })));
const Support = lazy(() => import('./pages/shared/Support').then(m => ({ default: m.Support })));
const Notifications = lazy(() => import('./pages/shared/Notifications').then(m => ({ default: m.Notifications })));
const CompanyDirectory = lazy(() => import('./pages/admin/CompanyDirectory').then(m => ({ default: m.CompanyDirectory })));
const Receipts = lazy(() => import('./pages/shared/Receipts').then(m => ({ default: m.Receipts })));
// recharts alone is a big chunk only this page needs — the audit's own example.
const AdminReporting = lazy(() => import('./pages/admin/AdminReporting').then(m => ({ default: m.AdminReporting })));
const FinanceAnalytics = lazy(() => import('./pages/admin/AdminReporting').then(m => ({ default: m.FinanceAnalytics })));
const HistoricalImport = lazy(() => import('./pages/admin/HistoricalImport').then(m => ({ default: m.HistoricalImport })));

function RouteFallback() {
  return (
    <div className="p-6">
      <CardSkeleton />
    </div>
  );
}

// A route that throws shouldn't white-screen the whole app, and navigating
// away from the broken page should recover automatically — keying the
// boundary by pathname remounts it (and clears the error) on every nav.
function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>;
}

function RequireRoles({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { currentUser } = useAppContext();
  if (roles.includes(currentUser.role)) return <>{children}</>;

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="rounded-container border border-brand-border bg-surface-container-lowest p-8 text-center shadow-sm">
        <span aria-hidden="true" className="material-symbols-outlined text-[40px] text-outline">lock</span>
        <h1 className="mt-3 font-headline-md text-on-surface">This page is not available for your role</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Your prototype account does not have permission to open this module.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-btn bg-primary px-5 font-label-md text-on-primary"
        >
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}

function RoleBasedRouter() {
  const { currentUser } = useAppContext();
  const requestRoles = [UserRole.REQUESTOR, UserRole.APPROVER];
  const receiptRoles = [UserRole.REQUESTOR, UserRole.APPROVER, UserRole.FINANCE];
  const claimDetailRoles = [UserRole.REQUESTOR, UserRole.APPROVER, UserRole.CUSTODIAN, UserRole.FINANCE, UserRole.ADMIN];

  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route element={<Layout />}>
        {currentUser.role === UserRole.ADMIN ? (
          <Route path="/" element={<AdminDashboard />} />
        ) : (
          <Route path="/" element={<Dashboard />} />
        )}
        
        {/* Requestor / General */}
        <Route path="/claims" element={<RequireRoles roles={[...requestRoles, UserRole.FINANCE]}><ClaimsList /></RequireRoles>} />
        <Route path="/payouts" element={<RequireRoles roles={requestRoles}><Payouts /></RequireRoles>} />
        <Route path="/claims/new" element={<RequireRoles roles={requestRoles}><SubmitClaim /></RequireRoles>} />
        <Route path="/claims/:id" element={<RequireRoles roles={claimDetailRoles}><ClaimDetail /></RequireRoles>} />
        <Route path="/moms" element={<RequireRoles roles={requestRoles}><MOMs /></RequireRoles>} />
        <Route path="/moms/new" element={<RequireRoles roles={requestRoles}><CreateMom /></RequireRoles>} />
        <Route path="/moms/:id" element={<RequireRoles roles={requestRoles}><MomDetail /></RequireRoles>} />
        <Route path="/receipts" element={<RequireRoles roles={receiptRoles}><Receipts /></RequireRoles>} />
        
        {/* Shared */}
        <Route path="/calendar" element={<RequireRoles roles={requestRoles}><Calendar /></RequireRoles>} />
        <Route path="/support" element={<Support />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
        
        {/* Approver */}
        <Route path="/approvals" element={<RequireRoles roles={[UserRole.APPROVER]}><ApprovalQueue /></RequireRoles>} />
        
        {/* Custodian */}
        <Route path="/disbursements" element={<RequireRoles roles={[UserRole.CUSTODIAN]}><ProcessingQueue /></RequireRoles>} />
        <Route path="/ready-to-claim" element={<RequireRoles roles={[UserRole.CUSTODIAN]}><ReadyToClaimQueue /></RequireRoles>} />
        <Route path="/transactions" element={<RequireRoles roles={[UserRole.CUSTODIAN, UserRole.FINANCE]}><TransactionHistory /></RequireRoles>} />
        <Route path="/custodian/analytics" element={<RequireRoles roles={[UserRole.CUSTODIAN]}><CustodianAnalytics /></RequireRoles>} />
        <Route path="/finance/analytics" element={<RequireRoles roles={[UserRole.FINANCE]}><FinanceAnalytics /></RequireRoles>} />
        
        {/* Admin */}
        <Route path="/admin/users" element={<RequireRoles roles={[UserRole.ADMIN]}><UserAccounts /></RequireRoles>} />
        <Route path="/admin/companies" element={<RequireRoles roles={[UserRole.ADMIN]}><CompanyDirectory /></RequireRoles>} />
        <Route path="/admin/import" element={<RequireRoles roles={[UserRole.ADMIN]}><HistoricalImport /></RequireRoles>} />
        <Route path="/admin/reports" element={<RequireRoles roles={[UserRole.ADMIN]}><AdminReporting /></RequireRoles>} />
        <Route path="/admin/activity" element={<RequireRoles roles={[UserRole.ADMIN]}><SystemActivity /></RequireRoles>} />
        <Route path="/admin/audit" element={<RequireRoles roles={[UserRole.ADMIN]}><Navigate to="/admin/activity?tab=audit" replace /></RequireRoles>} />
        <Route path="/admin/emails" element={<RequireRoles roles={[UserRole.ADMIN]}><Navigate to="/admin/activity?tab=messages" replace /></RequireRoles>} />
        
        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export default function App() {
  // The account-picker Login screen is the entry point in every build, dev
  // included. Identity is per-tab (sessionStorage), so each tab can be signed
  // in as a different role against the same backend. A `?role=`/`?uid=` deep
  // link signs this tab straight in — see applyDeepLinkLogin — which is what
  // lets a presenter open one tab per role in a single click each.
  const [loggedIn, setLoggedIn] = useState(() => applyDeepLinkLogin() || isLoggedIn());

  if (!loggedIn) {
    return <Login onLoggedIn={() => setLoggedIn(true)} />;
  }

  return (
    <AppProvider>
      <ToastProvider>
        <BrowserRouter>
          <RouteErrorBoundary>
            <RoleBasedRouter />
          </RouteErrorBoundary>
        </BrowserRouter>
      </ToastProvider>
    </AppProvider>
  );
}

