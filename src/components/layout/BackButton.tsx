import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Global "back" affordance. Every page below the app shell renders this just
 * under the Topbar so there's always a way back to the previous view without
 * reloading the module or hunting for a breadcrumb. Hidden on the dashboard
 * root ("/"), which is already home for every role.
 *
 * It prefers real history (navigate(-1)); if the tab was opened straight onto
 * a deep-linked page with nothing to go back to, it falls back to the
 * dashboard so the button can never strand the user outside the app.
 */
export function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  if (location.pathname === '/') return null;

  const goBack = () => {
    // history.length is 1 when this is the only entry (fresh tab / deep link).
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <button
      onClick={goBack}
      className="group inline-flex items-center gap-1.5 mb-4 -ml-1 px-2 py-1 rounded-full text-body-sm font-medium text-on-surface-variant hover:text-primary hover:bg-surface-container-high focus:ring-2 focus:ring-primary focus-visible:outline-none transition-colors"
      aria-label="Go back to the previous page"
    >
      <span className="material-symbols-outlined text-[20px] transition-transform group-hover:-translate-x-0.5">arrow_back</span>
      Back
    </button>
  );
}
