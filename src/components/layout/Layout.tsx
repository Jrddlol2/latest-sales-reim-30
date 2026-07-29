import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ErrorBoundary } from '../shared/ErrorBoundary';

export function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(prev => !prev)}
      />
      <Topbar
        onMenuClick={() => setIsSidebarOpen(true)}
        isCollapsed={isCollapsed}
      />
      <main className={`pt-[64px] min-h-screen transition-all duration-300 ${isCollapsed ? 'lg:pl-[80px]' : 'lg:pl-[220px]'}`}>
        <div className="max-w-[1440px] mx-auto p-6 md:p-8">
          {/* Keyed by pathname so navigating away from a broken page recovers
              the boundary automatically, without losing the sidebar/topbar. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
