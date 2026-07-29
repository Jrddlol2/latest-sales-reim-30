import { ButtonHTMLAttributes, forwardRef } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-label-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 active:scale-95 duration-200',
          {
            'bg-primary text-on-primary hover:brightness-110 shadow-sm rounded-[10px]': variant === 'primary',
            'bg-white border border-brand-border text-brand-slate hover:bg-surface-container rounded-[10px]': variant === 'secondary',
            'border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low rounded-[10px]': variant === 'outline',
            'hover:bg-surface-container-high text-on-surface-variant rounded-[10px]': variant === 'ghost',
            'h-8 px-3 text-xs': size === 'sm',
            'h-10 px-5 py-2.5': size === 'md',
            'h-12 px-8 py-3': size === 'lg',
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
