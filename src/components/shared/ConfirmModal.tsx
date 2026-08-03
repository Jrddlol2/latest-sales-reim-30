import { ReactNode, useId } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from './Modal';

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
  showCancel?: boolean;
  closeOnBackdrop?: boolean;
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
  disabled = false,
  showCancel = true,
  closeOnBackdrop = false,
}: ConfirmModalProps) {
  const titleId = useId();
  const descriptionId = useId();

  const getVariantStyles = () => {
    if (variant === 'error') return 'bg-error text-white hover:bg-error/90';
    if (variant === 'warning') return 'bg-tertiary text-on-tertiary hover:bg-tertiary/90';
    return '';
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId={titleId}
      descriptionId={descriptionId}
      closeOnBackdrop={closeOnBackdrop}
    >
      <Card className="shadow-lg">
        <div className="p-6">
          <h2 id={titleId} className="font-headline-md text-on-surface mb-4">{title}</h2>
          <div id={descriptionId} className="text-body-md text-on-surface-variant mb-6">
            {children}
          </div>
          <div className="flex justify-end gap-3 mt-6">
            {showCancel && <Button variant="outline" onClick={onClose}>{cancelLabel}</Button>}
            <Button className={getVariantStyles()} onClick={onConfirm} disabled={disabled}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </Card>
    </Modal>
  );
}
