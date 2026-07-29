import { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ 
  icon = 'inbox_customize', 
  title, 
  description, 
  action, 
  className = '' 
}: EmptyStateProps) {
  return (
    <div className={`p-8 text-center text-outline flex flex-col items-center justify-center min-h-[200px] border border-brand-border border-dashed rounded-lg bg-surface-container-lowest ${className}`}>
      <span className="material-symbols-outlined text-[48px] mb-3 opacity-50">{icon}</span>
      <h3 className="text-body-lg font-semibold text-brand-slate">{title}</h3>
      <p className="text-body-sm mt-2 max-w-sm">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
