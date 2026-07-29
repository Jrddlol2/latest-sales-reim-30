import { InputHTMLAttributes, forwardRef, SelectHTMLAttributes, ReactNode } from 'react';
import { cn } from './Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full bg-white border border-[#CBD5E1] rounded-[6px] px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "w-full bg-white border border-[#CBD5E1] rounded-[6px] px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none appearance-none",
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';

export const Label = ({ children, className, required }: { children: ReactNode, className?: string, required?: boolean }) => (
  <label className={cn("block font-label-md text-label-md text-on-surface-variant mb-2", className)}>
    {children}
    {required && <span className="text-error ml-1">*</span>}
  </label>
);
