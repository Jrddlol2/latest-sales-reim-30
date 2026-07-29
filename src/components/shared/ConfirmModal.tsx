import { ReactNode, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Portal } from './Portal';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'error' | 'warning';
  disabled?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  disabled = false
}: ConfirmModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const getVariantStyles = () => {
    if (variant === 'error') return 'bg-error text-white hover:bg-error/90';
    if (variant === 'warning') return 'bg-tertiary text-on-tertiary hover:bg-tertiary/90';
    return '';
  };

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md animate-in slide-in-from-bottom-4 duration-300">
        <Card className="shadow-lg">
          <div className="p-6">
            <h2 className="font-headline-md text-on-surface mb-4">{title}</h2>
            <div className="text-body-md text-on-surface-variant mb-6">
              {children}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={onClose}>{cancelLabel}</Button>
              <Button className={getVariantStyles()} onClick={onConfirm} disabled={disabled}>{confirmLabel}</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
    </Portal>
  );
}
