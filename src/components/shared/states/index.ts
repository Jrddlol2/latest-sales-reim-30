export * from './Skeleton';
export * from './EmptyState';
export * from './ErrorState';

/* 
 * USAGE EXAMPLE:
 *
 * import { useState, useEffect } from 'react';
 * import { TableSkeleton, EmptyState, ErrorState } from './states';
 * import { Button } from '../ui/Button';
 * 
 * export function ClaimsListExample() {
 *   const [status, setStatus] = useState<'loading' | 'error' | 'empty' | 'success'>('loading');
 * 
 *   if (status === 'loading') {
 *     return <TableSkeleton rows={5} />;
 *   }
 * 
 *   if (status === 'error') {
 *     return (
 *       <ErrorState 
 *         title="Failed to load claims" 
 *         message="We couldn't retrieve your claims due to a network error."
 *         onRetry={() => setStatus('loading')} 
 *       />
 *     );
 *   }
 * 
 *   if (status === 'empty') {
 *     return (
 *       <EmptyState
 *         icon="receipt_long"
 *         title="No claims found"
 *         description="You haven't submitted any reimbursement claims yet."
 *         action={<Button>New Claim</Button>}
 *       />
 *     );
 *   }
 * 
 *   return <div>... Render actual data table ...</div>;
 * }
 */
