import { Button } from '../../ui/Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ 
  title = 'Something went wrong', 
  message = 'An error occurred while loading this content. Please try again.', 
  onRetry, 
  className = '' 
}: ErrorStateProps) {
  return (
    <div className={`p-8 text-center flex flex-col items-center justify-center min-h-[200px] border border-error/20 rounded-lg bg-error/5 ${className}`}>
      <span className="material-symbols-outlined text-[48px] mb-3 text-error/60">error</span>
      <h3 className="text-body-lg font-semibold text-error">{title}</h3>
      <p className="text-body-sm mt-2 max-w-sm text-on-surface-variant">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-6 border-error text-error hover:bg-error/10">
          <span className="material-symbols-outlined mr-2 text-[18px]">refresh</span>
          Try Again
        </Button>
      )}
    </div>
  );
}
