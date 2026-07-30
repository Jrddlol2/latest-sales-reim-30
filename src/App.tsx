/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
// Dashboard/AdminDashboard stay out of this (they're the landing page for
// every role, so lazy-loading them would just move the wait, not remove it).
import { Dashboard } from './pages/Dashboard';
import { AdminDashboard } from './pages/admin/AdminDashboard';

const ClaimsList = lazy(() => import('./pages/shared/ClaimsList').then(m => ({ default: m.ClaimsList })));
const Payouts = lazy(() => import('./pages/shared/Payouts').then(m => ({ default: m.Payouts })));
const SubmitClaim = lazy(() => import('./pages/shared/SubmitClaim').then(m => ({ default: m.SubmitClaim })));
const ClaimDetail = lazy(() => import('./pages/shared/ClaimDetail').then(m => ({ default: m.ClaimDetail })));
const ApprovalQueue = lazy(() => import('./pages/approver/ApprovalQueue').then(m => ({ default: m.ApprovalQueue })));
const ProcessingQueue = lazy(() => import('./pages/custodian/ProcessingQueue').then(m => ({ default: m.ProcessingQueue })));
const ReadyToClaimQueue = lazy(() => import('./pages/custodian/ReadyToClaimQueue').then(m => ({ default: m.ReadyToClaimQueue })));
const TransactionHistory = lazy(() => import('./pages/custodian/TransactionHistory').then(m => ({ default: m.TransactionHistory })));
const CustodianAnalytics = lazy(() => import('./pages/custodian/CustodianAnalytics').then(m => ({ default: m.CustodianAnalytics })));
const AuditLog = lazy(() => import('./pages/admin/AuditLog').then(m => ({ default: m.AuditLog })));
const UserAccounts = lazy(() => import('./pages/admin/UserAccounts').then(m => ({ default: m.UserAccounts })));
const MOMs = lazy(() => import('./pages/shared/MOMs').then(m => ({ default: m.MOMs })));
const MomDetail = lazy(() => import('./pages/shared/MomDetail').then(m => ({ default: m.MomDetail })));
const Calendar = lazy(() => import('./pages/shared/Calendar').then(m => ({ default: m.Calendar })));
const Settings = lazy(() => import('./pages/shared/Settings').then(m => ({ default: m.Settings })));
const Support = lazy(() => import('./pages/shared/Support').then(m => ({ default: m.Support })));
const Notifications = lazy(() => import('./pages/shared/Notifications').then(m => ({ default: m.Notifications })));
const CompanyDirectory = lazy(() => import('./pages/admin/CompanyDirectory').then(m => ({ default: m.CompanyDirectory })));
const Receipts = lazy(() => import('./pages/shared/Receipts').then(m => ({ default: m.Receipts })));
// recharts alone is a big chunk only this page needs — the audit's own example.
const AdminReporting = lazy(() => import('./pages/admin/AdminReporting').then(m => ({ default: m.AdminReporting })));
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

function RoleBasedRouter() {
  const { currentUser } = useAppContext();

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
        <Route path="/claims" element={<ClaimsList />} />
        <Route path="/payouts" element={<Payouts />} />
        <Route path="/claims/new" element={<SubmitClaim />} />
        <Route path="/claims/:id" element={<ClaimDetail />} />
        <Route path="/moms" element={<MOMs />} />
        <Route path="/moms/:id" element={<MomDetail />} />
        <Route path="/receipts" element={<Receipts />} />
        
        {/* Shared */}
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/support" element={<Support />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
        
        {/* Approver */}
        <Route path="/approvals" element={<ApprovalQueue />} />
        
        {/* Custodian */}
        <Route path="/disbursements" element={<ProcessingQueue />} />
        <Route path="/ready-to-claim" element={<ReadyToClaimQueue />} />
        <Route path="/transactions" element={<TransactionHistory />} />
        <Route path="/custodian/analytics" element={<CustodianAnalytics />} />
        
        {/* Admin */}
        <Route path="/admin/users" element={<UserAccounts />} />
        <Route path="/admin/companies" element={<CompanyDirectory />} />
        <Route path="/admin/import" element={<HistoricalImport />} />
        <Route path="/admin/reports" element={<AdminReporting />} />
        <Route path="/admin/audit" element={<AuditLog />} />
        
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

