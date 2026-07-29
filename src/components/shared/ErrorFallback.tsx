import { useState } from 'react';
import { Button } from '../ui/Button';

export interface ErrorFallbackProps {
  error: Error;
  onReset: () => void;
}

/** Presentational only — no routing/boundary logic; see ErrorBoundary for that. */
export function ErrorFallback({ error, onReset }: ErrorFallbackProps) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-sm p-8">
        <span className="material-symbols-outlined text-[48px] text-error/60 mb-3">error</span>
        <h2 className="font-headline-md text-on-surface mb-2">Something went wrong</h2>
        <p className="text-body-sm text-on-surface-variant mb-6">
          This page hit an unexpected error. Your data is safe — try again, or head back
          to the dashboard.
        </p>
        <Button onClick={onReset} className="gap-2">
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Try again
        </Button>

        <div className="mt-6 text-left">
          <button
            type="button"
            className="text-xs text-on-surface-variant hover:text-on-surface underline"
            onClick={() => setShowDetail(v => !v)}
          >
            {showDetail ? 'Hide technical details' : 'Show technical details'}
          </button>
          {showDetail && (
            <pre className="mt-2 p-3 rounded-lg bg-surface-container-low text-[12px] text-on-surface-variant overflow-auto max-h-40 whitespace-pre-wrap break-words">
              {error.message}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
