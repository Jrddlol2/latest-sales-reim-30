import { Button } from './Button';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ currentPage, totalPages, onPageChange, className = '' }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className={`flex items-center justify-between px-6 py-4 border-t border-brand-border bg-surface-container-lowest ${className}`}>
      <div className="text-body-sm text-outline">
        Showing page <span className="font-medium text-brand-slate">{currentPage}</span> of <span className="font-medium text-brand-slate">{totalPages}</span>
      </div>
      <div className="flex gap-2">
        <Button 
          variant="outline" 
          className="px-3 py-1 text-sm h-8"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </Button>
        <Button 
          variant="outline" 
          className="px-3 py-1 text-sm h-8"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
