import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../lib/api';
import { formatDateTime } from '../../lib/date';
import { GlobalSearch } from './GlobalSearch';

interface TopbarProps {
  onMenuClick: () => void;
  isCollapsed?: boolean;
}

export function Topbar({ onMenuClick, isCollapsed = false }: TopbarProps) {
  const { currentUser, emails, markEmailsRead } = useAppContext();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // The bell shows this user's own emails. Admin's outbox is everyone's, so
  // scope to the current user either way.
  const userNotifications = emails
    .filter(e => e.recipientId === currentUser.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 30);
  const unreadCount = userNotifications.filter(n => !n.read).length;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowNotifications(false);
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleSignOut = () => {
    setShowProfileMenu(false);
    logout();
    window.location.reload();
  };

  return (
    <header className={`h-[64px] fixed top-0 right-0 left-0 flex justify-between items-center px-6 bg-surface border-b border-outline-variant shadow-sm z-10 transition-all duration-300 ${isCollapsed ? 'lg:left-[80px]' : 'lg:left-[220px]'}`}>
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <button 
          aria-label="Toggle sidebar"
          className="lg:hidden p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full focus:ring-2 focus:ring-primary focus-visible:outline-none transition-colors"
          onClick={onMenuClick}
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <h2 className="hidden md:block font-headline-md text-headline-md font-semibold text-on-surface">Expense Dashboard</h2>
        
        <GlobalSearch />
      </div>
      
      <div className="flex items-center gap-2 sm:gap-3 md:gap-4 ml-3 md:ml-4">
        <div className="flex items-center gap-2">
          <div className="relative" ref={notificationsRef}>
            <button 
              aria-label="View notifications"
              aria-expanded={showNotifications}
              className="relative p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container-high rounded-full transition-colors focus:ring-2 focus:ring-primary focus-visible:outline-none active:opacity-70"
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowProfileMenu(false);
              }}
            >
              <span className="material-symbols-outlined">notifications</span>
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-error text-white text-[12px] font-bold leading-4 text-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-surface border border-outline-variant rounded-lg shadow-lg overflow-hidden flex flex-col max-h-96">
                <div className="p-3 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
                  <span className="font-semibold text-on-surface text-sm cursor-pointer hover:text-primary" onClick={() => { setShowNotifications(false); navigate('/notifications'); }}>Notifications</span>
                  {currentUser.role === 'Admin' && (
                    <button onClick={() => navigate('/admin/activity?tab=messages')} className="text-xs text-primary hover:underline">System Activity</button>
                  )}
                </div>
                <div className="overflow-y-auto flex-1 p-2 space-y-1">
                  {userNotifications.length === 0 ? (
                    <p className="p-4 text-center text-sm text-on-surface-variant">No notifications.</p>
                  ) : (
                    userNotifications.map(notif => (
                      <div
                        key={notif.id}
                        className={`p-3 text-sm rounded cursor-pointer ${notif.read ? 'bg-transparent hover:bg-surface-container' : 'bg-primary-container/20 font-medium'}`}
                        onClick={() => {
                          if (!notif.read) markEmailsRead([notif.id]);
                          setShowNotifications(false);
                          // Open the full message on the Notifications page, preselected.
                          navigate(`/notifications?id=${notif.id}`);
                        }}
                      >
                        <p className="text-on-surface">{notif.subject || notif.body}</p>
                        <p className="text-xs text-on-surface-variant mt-1">{formatDateTime(notif.timestamp)}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-2 border-t border-outline-variant bg-surface-container-lowest text-center">
                  <button 
                    onClick={() => { setShowNotifications(false); navigate('/notifications'); }}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    View All Notifications
                  </button>
                </div>
              </div>
            )}
          </div>
          <button aria-label="Help and support" className="hidden sm:block p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container-high rounded-full focus:ring-2 focus:ring-primary focus-visible:outline-none transition-colors cursor-pointer active:opacity-70" onClick={() => navigate('/support')}>
            <span className="material-symbols-outlined">help_outline</span>
          </button>
        </div>
        
        <div className="h-8 w-px bg-outline-variant hidden md:block"></div>

        <div className="relative" ref={profileRef}>
          <button
            type="button"
            aria-label={`Open account menu for ${currentUser.name}`}
            aria-haspopup="menu"
            aria-expanded={showProfileMenu}
            className="flex items-center gap-2 rounded-full p-1 pr-1.5 text-left transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => {
              setShowProfileMenu(!showProfileMenu);
              setShowNotifications(false);
            }}
          >
            <span className="hidden xl:block max-w-[180px] text-right">
              <span className="block truncate font-label-md text-label-md text-on-surface">{currentUser.name}</span>
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-outline">{currentUser.role}</span>
            </span>
            {currentUser.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt="" loading="lazy" width="36" height="36" className="h-9 w-9 rounded-full border-2 border-outline-variant object-cover" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary-container font-bold text-on-secondary-container font-label-md">
                {currentUser.name.split(' ').map(n => n[0]).join('')}
              </span>
            )}
            <span aria-hidden="true" className={`hidden sm:block material-symbols-outlined text-[18px] text-outline transition-transform ${showProfileMenu ? 'rotate-180' : ''}`}>expand_more</span>
          </button>

          {showProfileMenu && (
            <div role="menu" className="absolute right-0 mt-2 w-64 overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-lg">
              <div className="border-b border-outline-variant px-4 py-3">
                <p className="truncate font-label-md text-on-surface">{currentUser.name}</p>
                <p className="mt-0.5 truncate text-xs text-on-surface-variant">{currentUser.email}</p>
                <span className="mt-2 inline-flex rounded-full bg-secondary-container px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-on-secondary-container">
                  {currentUser.role}
                </span>
              </div>
              <div className="p-1.5">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => {
                    setShowProfileMenu(false);
                    navigate('/settings');
                  }}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[19px] text-on-surface-variant">manage_accounts</span>
                  Account settings
                </button>
              </div>
              <div className="border-t border-outline-variant p-1.5">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-error transition-colors hover:bg-error-container/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                  onClick={handleSignOut}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[19px]">logout</span>
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
