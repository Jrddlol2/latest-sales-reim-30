import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../lib/api';
import { formatDateTime } from '../../lib/date';

interface TopbarProps {
  onMenuClick: () => void;
  isCollapsed?: boolean;
}

export function Topbar({ onMenuClick, isCollapsed = false }: TopbarProps) {
  const { currentUser, emails, markEmailsRead } = useAppContext();
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
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
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className={`h-[64px] fixed top-0 right-0 left-0 flex justify-between items-center px-6 bg-surface border-b border-outline-variant shadow-sm z-10 transition-all duration-300 ${isCollapsed ? 'lg:left-[80px]' : 'lg:left-[220px]'}`}>
      <div className="flex items-center gap-4 flex-1">
        <button 
          aria-label="Toggle sidebar"
          className="lg:hidden p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full focus:ring-2 focus:ring-primary focus-visible:outline-none transition-colors"
          onClick={onMenuClick}
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <h2 className="hidden md:block font-headline-md text-headline-md font-semibold text-on-surface">Expense Dashboard</h2>
        
        <div className="relative w-full max-w-md ml-0 md:ml-8" title="Global search coming soon">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
          <input 
            type="text" 
            placeholder="Global search coming soon..." 
            disabled
            className="w-full pl-10 pr-4 py-2 bg-surface-container border border-outline-variant rounded-[6px] text-body-base font-body-base text-outline-variant cursor-not-allowed transition-all"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-6 ml-4">
        {/* Sign out — the account-picker Login screen is the only way back
            in, in every build. See App.tsx. */}
        <button
          aria-label="Sign out"
          title={`Signed in as ${currentUser.name}`}
          className="hidden sm:flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-primary transition-colors"
          onClick={() => { logout(); window.location.reload(); }}
        >
          <span className="material-symbols-outlined text-[18px]">logout</span> Sign out
        </button>

        <div className="flex items-center gap-2">
          <div className="relative" ref={dropdownRef}>
            <button 
              aria-label="View notifications"
              className="relative p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container-high rounded-full transition-colors focus:ring-2 focus:ring-primary focus-visible:outline-none active:opacity-70"
              onClick={() => setShowNotifications(!showNotifications)}
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
                    <button onClick={() => navigate('/admin/emails')} className="text-xs text-primary hover:underline">System Emails</button>
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
        
        <div className="h-8 w-[1px] bg-outline-variant hidden md:block"></div>
        
        <div className="hidden md:flex items-center gap-3">
          <div className="text-right hidden xl:block">
            <p className="font-label-md text-label-md text-on-surface">{currentUser.name}</p>
            <p className="text-[12px] text-outline font-semibold uppercase tracking-wider">{currentUser.role}</p>
          </div>
          {currentUser.avatarUrl ? (
            <img src={currentUser.avatarUrl} alt={currentUser.name} loading="lazy" width="40" height="40" className="w-10 h-10 rounded-full border-2 border-outline-variant object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center font-bold text-on-secondary-container font-label-md">
              {currentUser.name.split(' ').map(n => n[0]).join('')}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
