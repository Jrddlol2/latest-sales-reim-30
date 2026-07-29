import { useState, useEffect } from 'react';
import { Portal } from '../../components/shared/Portal';

import { Card, CardContent } from '../../components/ui/Card';
import { formatMoney } from '../../lib/money';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { useAppContext } from '../../components/AppContext';
import { uploadUrl } from '../../lib/api';
import { UserRole } from '../../types';

interface ReceiptRecord {
  id: string;
  fileName: string;
  fileUrl: string;
  category: string;
  vendor: string;
  amount: number;
  date: string;
  claimRef?: string;
  claimId?: string;
  requestorId?: string;
}

export function Receipts() {
  const { lineItems, claims, currentUser, users } = useAppContext();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptRecord | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Approvers manage their own submissions plus whatever's routed through
  // them; split the archive so "my receipts" isn't buried in the team's.
  const isApprover = currentUser.role === UserRole.APPROVER;
  const reporteeIds = new Set(users.filter(u => u.reportsTo === currentUser.id).map(u => u.id));
  const [scope, setScope] = useState<'mine' | 'team'>('mine');

  // Derive real receipts from line items in context
  const derivedReceipts: ReceiptRecord[] = lineItems
    .filter(item => item.receiptUrl)
    .map(item => {
      const parentClaim = claims.find(c => c.id === item.claimId);
      return {
        id: item.id,
        fileName: item.receiptFileName || `Receipt_${item.vendor || item.category}.pdf`,
        fileUrl: item.receiptUrl!,
        category: item.category,
        vendor: item.vendor || 'Vendor N/A',
        amount: item.amount,
        date: item.expenseDate,
        claimRef: parentClaim?.ref,
        claimId: item.claimId,
        requestorId: parentClaim?.requestorId,
      };
    });

  const scopedReceipts = !isApprover ? derivedReceipts : derivedReceipts.filter(r =>
    scope === 'mine' ? r.requestorId === currentUser.id : r.requestorId && reporteeIds.has(r.requestorId)
  );

  const filteredReceipts = scopedReceipts.filter(r => {
    const matchesSearch =
      r.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.vendor.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.claimRef && r.claimRef.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = !selectedCategory || r.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const totalPages = Math.ceil(filteredReceipts.length / itemsPerPage);
  const paginatedReceipts = filteredReceipts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory, scope]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">Receipt Archive</h1>
          <p className="text-body-md text-outline mt-1">Searchable library of verified receipt documents & official receipts, attached during claim submission.</p>
        </div>
      </div>

      {isApprover && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setScope('mine')}
            className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${scope === 'mine' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}
          >
            My Receipts
          </button>
          <button
            onClick={() => setScope('team')}
            className={`px-5 py-2 rounded-full font-label-md transition-colors shadow-sm ${scope === 'team' ? 'bg-primary text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-outline-variant'}`}
          >
            Team Receipts
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4 bg-surface-container-low p-4 rounded-xl border border-outline-variant">
        <div className="flex-1">
          <Input 
            type="text" 
            placeholder="Search by filename, vendor, or claim ref..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
            <option value="">All Categories</option>
            <option value="Meals">Meals</option>
            <option value="Travel">Travel</option>
            <option value="Supplies">Supplies</option>
            <option value="Lodging">Lodging</option>
            <option value="Transportation">Transportation</option>
            <option value="Utilities">Utilities</option>
          </Select>
        </div>
      </div>

      {/* Receipts Grid */}
      {filteredReceipts.length === 0 ? (
        <Card className="p-12 text-center text-outline">
          <span className="material-symbols-outlined text-[48px] mb-3">folder_open</span>
          <p className="font-headline-sm text-on-surface mb-1">No Receipts Found</p>
          <p className="text-sm">Upload receipts during claim submission or directly to this archive.</p>
        </Card>
      ) : (
        <Card>
        <div className="p-6 pb-2 flex justify-end">
          <span className="font-label-sm text-outline whitespace-nowrap">{filteredReceipts.length} of {scopedReceipts.length}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-6 pt-4">
          {paginatedReceipts.map(receipt => (
            <Card 
              key={receipt.id} 
              className="overflow-hidden hover:border-primary transition-all cursor-pointer group hover:shadow-md"
              onClick={() => setSelectedReceipt(receipt)}
            >
              <div className="h-36 bg-surface-container-high flex flex-col items-center justify-center relative p-4">
                <span className="material-symbols-outlined text-4xl text-primary mb-1">receipt_long</span>
                <span className="text-xs font-mono-data font-semibold text-on-surface text-center truncate max-w-full px-2">
                  {receipt.fileName}
                </span>
                <span className="text-[12px] uppercase font-bold text-outline mt-1 bg-surface-container px-2 py-0.5 rounded">
                  {receipt.category}
                </span>
              </div>
              <CardContent className="p-4 bg-surface-container-lowest">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-label-md text-on-surface font-semibold truncate">{receipt.vendor}</p>
                  <p className="font-mono-data font-bold text-primary">{formatMoney(receipt.amount)}</p>
                </div>
                <div className="flex justify-between items-center text-xs text-outline mt-2 pt-2 border-t border-outline-variant/40">
                  <span>{receipt.date}</span>
                  {receipt.claimRef && (
                    <span className="bg-primary-container/20 text-primary font-mono-data px-1.5 py-0.5 rounded text-[12px]">
                      {receipt.claimRef}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
        </Card>
      )}

      {/* Preview Modal */}
      {selectedReceipt && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-surface-container-lowest rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-outline-variant pb-3">
              <div>
                <h3 className="font-headline-sm text-on-surface">{selectedReceipt.fileName}</h3>
                <p className="text-xs text-outline">{selectedReceipt.vendor} • {selectedReceipt.date}</p>
              </div>
              <button onClick={() => setSelectedReceipt(null)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="bg-surface-container-low border border-outline-variant rounded-lg p-8 flex flex-col items-center justify-center min-h-[260px]">
              {(() => {
                const url = uploadUrl(selectedReceipt.fileUrl) ?? '';
                if (url.startsWith('data:image') || url.startsWith('blob:') || url.match(/\.(jpeg|jpg|gif|png)($|\?)/i)) {
                  return <img src={url} alt="Receipt preview" className="max-h-64 object-contain rounded" />;
                }
                if (url.match(/\.pdf($|\?)/i)) {
                  return <iframe title="Receipt attachment" src={url} className="w-full h-64 rounded border border-outline-variant" />;
                }
                return (
                  <div className="text-center space-y-2">
                    <span className="material-symbols-outlined text-[64px] text-primary">description</span>
                    <p className="font-bold text-on-surface">{selectedReceipt.fileName}</p>
                    <p className="text-xs text-outline">Document attachment linked to {selectedReceipt.claimRef || 'Receipt Archive'}</p>
                  </div>
                );
              })()}
            </div>
            <div className="flex justify-between items-center text-sm pt-2">
              <div>
                <span className="text-outline">Category:</span> <span className="font-semibold text-on-surface">{selectedReceipt.category}</span>
                <span className="ml-4 text-outline">Amount:</span> <span className="font-mono-data font-bold text-primary">{formatMoney(selectedReceipt.amount)}</span>
              </div>
              <div className="flex gap-2">
                <a href={uploadUrl(selectedReceipt.fileUrl)} target="_blank" rel="noreferrer" download={selectedReceipt.fileName}>
                  <Button variant="outline" size="sm" className="gap-1">
                    <span className="material-symbols-outlined text-[16px]">download</span> Download
                  </Button>
                </a>
                <Button size="sm" onClick={() => setSelectedReceipt(null)}>Close</Button>
              </div>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}