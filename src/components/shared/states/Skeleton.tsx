import { HTMLAttributes } from 'react';
import { Card, CardContent, CardHeader } from '../../ui/Card';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-pulse rounded-md bg-surface-container-highest/50 ${className}`}
      {...props}
    />
  );
}

export function CardSkeleton() {
  return (
    <Card>
      <CardHeader className="gap-4 border-b border-brand-border">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-1/4" />
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[90%]" />
        <Skeleton className="h-4 w-[80%]" />
      </CardContent>
    </Card>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-brand-border bg-surface-container-lowest">
      <div className="flex bg-surface-container-low px-6 py-3">
        <Skeleton className="h-4 w-1/4 mr-4" />
        <Skeleton className="h-4 w-1/4 mr-4" />
        <Skeleton className="h-4 w-1/4 mr-4" />
        <Skeleton className="h-4 w-1/4" />
      </div>
      <div className="divide-y divide-brand-border bg-surface-container-lowest">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex px-6 py-4">
            <Skeleton className="h-4 w-1/4 mr-4" />
            <Skeleton className="h-4 w-1/4 mr-4" />
            <Skeleton className="h-4 w-1/4 mr-4" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
