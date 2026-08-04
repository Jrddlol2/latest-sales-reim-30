import { InputHTMLAttributes, forwardRef, SelectHTMLAttributes, LabelHTMLAttributes } from 'react';
import { cn } from './Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full bg-white border border-brand-field-border rounded-input px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, children, ...props }, ref) => {
    return (
      // `className` is applied to both the wrapper and the <select> — the
      // chevron below is positioned absolute against this wrapper, so if a
      // caller's width utility (e.g. `w-44`) only reached the <select>, the
      // wrapper stayed at its default w-full and the chevron floated off to
      // the wrapper's true right edge instead of sitting inside the visible,
      // narrower control. Non-width classes (padding, text size, etc.)
      // landing on this wrapper too is harmless — it's an invisible div.
      <div className={cn("relative w-full", className, containerClassName)}>
        <select
          ref={ref}
          className={cn(
            "w-full appearance-none bg-white border border-brand-field-border rounded-input pl-4 pr-10 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none disabled:bg-surface-container-low disabled:text-outline",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <span
          aria-hidden="true"
          className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant"
        >
          expand_more
        </span>
      </div>
    );
  }
);
Select.displayName = 'Select';

export const Label = ({ children, className, required, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) => (
  <label className={cn("block font-label-md text-label-md text-on-surface-variant mb-2", className)} {...props}>
    {children}
    {required && (
      <>
        <span aria-hidden="true" className="text-error ml-1">*</span>
        <span className="sr-only"> (required)</span>
      </>
    )}
  </label>
);
