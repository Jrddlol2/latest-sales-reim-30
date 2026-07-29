import React from "react";
import { useState, useRef } from 'react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/shared/ToastContext';
import { useAppContext } from '../../components/AppContext';
import { importHistoricalClaims, HistoricalImportRecord } from '../../lib/api';

/** Expected columns, in order. RequestorEmail resolves to a real user server-side needs a requestor_id for. */
const TEMPLATE_HEADERS = ['Date', 'Amount', 'Category', 'Vendor', 'Purpose', 'RequestorEmail'];

/** Minimal CSV split — the template has no embedded commas or quoted fields to worry about. */
function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.split(',').map(cell => cell.trim()));
}

export function HistoricalImport() {
  const [isUploading, setIsUploading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();
  const { users, refresh } = useAppContext();

  const log = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setLogs([]);
    log(`Starting import for ${file.name}...`);

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) {
        throw new Error('File has no data rows.');
      }

      const header = rows[0].map(h => h.toLowerCase());
      const idx = (name: string) => header.indexOf(name.toLowerCase());
      const dateIdx = idx('Date');
      const amountIdx = idx('Amount');
      const categoryIdx = idx('Category');
      const vendorIdx = idx('Vendor');
      const purposeIdx = idx('Purpose');
      const emailIdx = idx('RequestorEmail');

      if (dateIdx === -1 || amountIdx === -1 || emailIdx === -1) {
        throw new Error(`Missing required column(s). Expected: ${TEMPLATE_HEADERS.join(', ')}`);
      }

      const dataRows = rows.slice(1);
      log(`Found ${dataRows.length} record(s). Validating against Master Data...`);

      const records: HistoricalImportRecord[] = [];
      const problems: string[] = [];

      dataRows.forEach((cells, i) => {
        const rowNum = i + 2; // account for header + 1-based rows
        const email = cells[emailIdx]?.toLowerCase();
        const requestor = users.find(u => u.email?.toLowerCase() === email);
        const amount = Number(cells[amountIdx]);

        if (!requestor) {
          problems.push(`Row ${rowNum}: no user found for "${cells[emailIdx] || ''}" — skipped.`);
          return;
        }
        if (!amount || isNaN(amount) || amount <= 0) {
          problems.push(`Row ${rowNum}: invalid amount "${cells[amountIdx] || ''}" — skipped.`);
          return;
        }

        const expenseDate = cells[dateIdx] || new Date().toISOString().split('T')[0];
        const category = cells[categoryIdx] || 'Other';
        const vendor = cells[vendorIdx] || 'Unknown';
        const purpose = cells[purposeIdx] || 'Historical import';

        records.push({
          requestor_id: requestor.id,
          total_amount: amount,
          expense_category: category,
          remarks: purpose,
          created_at: expenseDate ? new Date(expenseDate).toISOString() : undefined,
          lineItems: [{
            expense_date: expenseDate,
            vendor,
            category,
            amount,
            payment_method: 'Corporate Card',
            business_purpose: purpose,
          }],
        });
      });

      if (problems.length > 0) {
        problems.forEach(p => log(`error: ${p}`));
      }

      if (records.length === 0) {
        throw new Error('No valid records to import after validation.');
      }

      log(`Validation passed for ${records.length} of ${dataRows.length} record(s). Importing...`);
      const batch = await importHistoricalClaims(file.name, records);
      await refresh();
      log(`Import completed successfully! ${batch.total_records} claim(s) added to history (batch ${String(batch.id).slice(0, 8)}).`);
      addToast('Historical data imported successfully', 'success');
    } catch (err: any) {
      log(`error: ${err?.message || 'Import failed.'}`);
      addToast(err?.message || 'Could not import the file.', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-display text-on-surface">Historical Import</h1>
          <p className="text-body-md text-outline mt-1">Migrate legacy claims data via CSV import.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <CardContent className="p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
            <span className="material-symbols-outlined text-[64px] text-primary mb-6">upload_file</span>
            <h3 className="font-headline-md text-on-surface mb-2">Upload CSV Export</h3>
            <p className="text-body-md text-outline mb-8 max-w-sm">Upload a CSV file containing legacy claims. Columns: {TEMPLATE_HEADERS.join(', ')}.</p>

            <input
              type="file"
              accept=".csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
              disabled={isUploading}
            />

            <div className="flex gap-4">
              <Button variant="outline" onClick={() => {
                const csv = `${TEMPLATE_HEADERS.join(',')}\n2024-01-01,150.00,Meals,Acme Corp,Client Dinner,mia.fernandez@company.com`;
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'claims_import_template.csv';
                a.click();
                URL.revokeObjectURL(url);
                addToast('Template downloaded', 'success');
              }}>Download Template</Button>
              <Button
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <>
                    <span className="material-symbols-outlined animate-spin">refresh</span>
                    Importing...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined">upload</span>
                    Select File
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-surface-container-low/50 border-b border-outline-variant">
            <h4 className="font-headline-md text-on-surface">Import Log</h4>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[300px] overflow-y-auto bg-surface-container-lowest p-6 font-mono-data text-sm">
              {logs.length === 0 ? (
                <p className="text-outline italic">No active imports. Upload a file to begin.</p>
              ) : (
                <div className="space-y-2">
                  {logs.map((log, idx) => (
                    <p key={idx} className={log.includes('error') ? 'text-error' : log.includes('successfully') ? 'text-green-600' : 'text-on-surface-variant'}>
                      {log}
                    </p>
                  ))}
                  {isUploading && (
                    <p className="text-primary animate-pulse">Processing...</p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
