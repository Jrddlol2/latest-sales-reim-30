import React from "react";
import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input, Select, Label } from '../../components/ui/Input';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { cn } from '../../components/ui/Button';
import { useAppContext } from '../../components/AppContext';
import { DynamicFieldRenderer } from '../../components/shared/DynamicFieldRenderer';
import { useToast } from '../../components/shared/ToastContext';
import { MinutesSource, ClaimStatus } from '../../types';
import { submitClaimFlow, submitCashAdvanceFlow, submitLiquidationFlow, DraftLineItem } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { EXPENSE_CATEGORIES } from '../../lib/expenseCategories';
import { FieldDefinition, FieldDefinitionEntity } from '../../types';

const TYPE_PARAM_MAP: Record<string, 'Reimbursement' | 'Cash Advance' | 'Liquidation'> = {
  reimbursement: 'Reimbursement',
  advance: 'Cash Advance',
  liquidation: 'Liquidation',
};

export function SubmitClaim() {
  const navigate = useNavigate();
  const { currentUser, fieldDefinitions, users, claims, companies, masterData, highValueThreshold, categoryLimits, paymentMethods, refresh } = useAppContext();
  const { addToast } = useToast();
  const [searchParams] = useSearchParams();
  const typeFromQuery = TYPE_PARAM_MAP[searchParams.get('type') ?? ''];

  const [claimType, setClaimType] = useState<'Reimbursement' | 'Cash Advance' | 'Liquidation'>(typeFromQuery ?? 'Reimbursement');
  // Step 0 is Type Selection. A Reimbursement now opens on the Minutes of
  // Meeting step (2) rather than Details & Items (1) — see stepFlow below.
  const [step, setStep] = useState(typeFromQuery ? (typeFromQuery === 'Reimbursement' ? 2 : 1) : 0);
  const [loading, setLoading] = useState(false);
  const momFileInputRef = useRef<HTMLInputElement>(null);

  // Form State. Holds the real File alongside the preview URL â€” the server
  // needs the bytes, and an object URL can't be re-read after a reload.
  const [lineItemsLocal, setLineItemsLocal] = useState<DraftLineItem[]>([
    { expenseDate: new Date().toISOString().split('T')[0], amount: 0, paymentMethod: 'Personal Card', vendor: '', category: 'Meals' }
  ]);
  const [momCore, setMomCore] = useState({
    client: '', purpose: '', location: '', contactPerson: '', contactPersonEmail: '', discussion: '',
  });
  // A known Company Directory entry can pre-fill the meeting details below
  // (mirrors the original system's "Company Auto-Fill" MOM behavior). Default
  // to the picker when companies exist; fall back to free text otherwise.
  const [clientMode, setClientMode] = useState<'select' | 'custom'>('select');
  const [momFile, setMomFile] = useState<File | undefined>();
  const [cashAdvanceId, setCashAdvanceId] = useState<string>('');
  const [cashAdvanceAmount, setCashAdvanceAmount] = useState<number>(0);
  const [cashAdvancePurpose, setCashAdvancePurpose] = useState('');
  // How the requestor intends to return an over-advance (refund due). Only
  // relevant to a Liquidation whose actual spend came in under the advance.
  const [refundMethod, setRefundMethod] = useState('');
  const [momSource, setMomSource] = useState<MinutesSource>(MinutesSource.TEMPLATE);
  const [momData, setMomData] = useState<Record<string, any>>({});
  const [claimCustomFields, setClaimCustomFields] = useState<Record<string, string>>({});
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('');

  // Declared in the order a Reimbursement actually visits them (MOM before
  // Details & Items) — the stepper dots and the "Step X of Y" label below
  // both read off this array's order, not the numeric `num`.
  const steps = [
    { num: 2, title: 'Minutes of Meeting' },
    { num: 1, title: 'Details & Items' },
    { num: 3, title: 'Schedule Review' },
    { num: 4, title: 'Review & Submit' }
  ];

  // A Cash Advance is just an amount + purpose, and a Liquidation has no MOM
  // or review-meeting concept of its own — both skip straight from Details to
  // Review & Submit. A Reimbursement captures the Minutes of Meeting first,
  // then the expense details/items, so the approver's context (who, why) is
  // already on record before line items are entered.
  const stepFlow = claimType === 'Reimbursement' ? [2, 1, 3, 4] : [1, 4];
  const flowPosition = stepFlow.indexOf(step);

  const handleNext = () => {
    if (step === 1 && claimType === 'Reimbursement' && lineItemsLocal.length === 0) {
      addToast('Please add at least one line item', 'error');
      return;
    }
    // Company spending policy — block advancing past Details with an over-cap line.
    if (step === 1 && claimType !== 'Cash Advance' && firstOverLimit) {
      addToast(`${firstOverLimit.category} is capped at ${formatMoney(limitFor(firstOverLimit.category))} per item by company policy.`, 'error');
      return;
    }
    if (step === 1 && claimType === 'Cash Advance') {
      if (!cashAdvanceAmount || cashAdvanceAmount <= 0) {
        addToast('Please enter the amount you\'re requesting', 'error');
        return;
      }
      if (!cashAdvancePurpose.trim()) {
        addToast('Please enter a purpose for this Cash Advance', 'error');
        return;
      }
    }
    if (step === 1 && claimType === 'Liquidation') {
      if (!cashAdvanceId) {
        addToast('Please select the Cash Advance to liquidate', 'error');
        return;
      }
      if (lineItemsLocal.length === 0) {
        addToast('Please add at least one expense line item', 'error');
        return;
      }
      if (varianceType === 'RefundDue' && !refundMethod) {
        addToast('Choose how you\'ll return the refund before continuing.', 'error');
        return;
      }
    }
    if (step === 1 && claimType === 'Reimbursement') {
      // Must mirror DynamicFieldRenderer's own filter exactly â€” validating a
      // field the renderer hides leaves the user blocked by an invisible input.
      const activeClaimFields = fieldDefinitions.filter(fd =>
        fd.entity === 'claim' && fd.active &&
        (!fd.applicableClaimTypes || fd.applicableClaimTypes.length === 0 || fd.applicableClaimTypes.includes(claimType))
      );
      const missingRequired = activeClaimFields.find(fd => fd.required && (!claimCustomFields[fd.key] || claimCustomFields[fd.key].trim() === ''));
      if (missingRequired) {
        addToast(`Please fill required field: ${missingRequired.label}`, 'error');
        return;
      }
    }
    if (step === 2 && momSource === MinutesSource.TEMPLATE) {
      const activeMomFields = fieldDefinitions.filter(fd => fd.entity === 'mom' && fd.active);
      const missingRequired = activeMomFields.find(fd => fd.required && (!momData[fd.key] || momData[fd.key].trim() === ''));
      if (missingRequired) {
        addToast(`Please fill required field: ${missingRequired.label}`, 'error');
        return;
      }
    }
    const nextIndex = flowPosition + 1;
    if (nextIndex < stepFlow.length) setStep(stepFlow[nextIndex]);
  };
  const handleBack = () => {
    const prevIndex = flowPosition - 1;
    setStep(prevIndex >= 0 ? stepFlow[prevIndex] : 0);
  };

  const totalAmount = claimType === 'Cash Advance'
    ? Number(cashAdvanceAmount) || 0
    : lineItemsLocal.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const flaggedHighValue = lineItemsLocal.some(item => (Number(item.amount) || 0) > highValueThreshold);

  /** Company spending policy: the cap for a line's category, or 0 if none. */
  const limitFor = (category?: string) => (category && categoryLimits[category]) || 0;
  const overLimit = (item: DraftLineItem) => {
    const cap = limitFor(item.category);
    return cap > 0 && (Number(item.amount) || 0) > cap;
  };
  const firstOverLimit = lineItemsLocal.find(overLimit);
  
  let varianceAmount = 0;
  let varianceType: 'Settled' | 'RefundDue' | 'ReimbursementDue' = 'Settled';
  if (claimType === 'Liquidation' && cashAdvanceId) {
    const parentCa = claims.find(c => c.id === cashAdvanceId);
    if (parentCa) {
      varianceAmount = totalAmount - parentCa.total;
      if (varianceAmount > 0) varianceType = 'ReimbursementDue';
      else if (varianceAmount < 0) varianceType = 'RefundDue';
    }
  }

  const handleFileUploadForLineItem = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLineItemsLocal(prev => prev.map((li, i) =>
      i === index ? { ...li, receiptFile: file, receiptUrl: URL.createObjectURL(file) } : li
    ));
  };

  /** Selecting a known company pre-fills Location/Contact from its directory
   *  record — only into fields the user hasn't already typed something into. */
  const applyCompanyDefaults = (companyName: string) => {
    const company = companies.find(c => c.name === companyName);
    if (!company) return;
    setMomCore(p => ({
      ...p,
      client: companyName,
      location: p.location || company.address || '',
      contactPerson: p.contactPerson || company.contactPerson || '',
      contactPersonEmail: p.contactPersonEmail || company.contactEmail || '',
    }));
  };

  const handleFileUploadForMOM = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMomFile(file);
    setMomData(p => ({ ...p, fileName: file.name }));
  };

  /** Presenter convenience (the header "Autofill" button): fill the ENTIRE
   *  flow — Minutes of Meeting, admin-configured custom fields, expense line
   *  items (with a mock receipt, since the server rejects any expense line
   *  without one) and the review meeting — in one click, so a full claim can be
   *  filled and submitted while presenting instead of typing every field. */
  const today = () => new Date().toISOString().split('T')[0];

  /** Produce a plausible value for one admin-configured custom field, matching
   *  its input type so dropdowns land on a real option and the renderer's own
   *  required-field checks pass. */
  const sampleFieldValue = (fd: FieldDefinition): string => {
    if (fd.default_value) return fd.default_value;
    if (fd.input_type === 'dropdown') {
      const options = fd.master_data_entity
        ? masterData.filter(m => m.type === fd.master_data_entity && m.active).map(m => m.name)
        : fd.options || [];
      if (options.length > 0) return options[0];
      if (fd.allow_other) return 'Other';
      return '';
    }
    if (fd.input_type === 'number') return '100';
    if (fd.input_type === 'date') return today();
    return `${fd.label} (demo)`;
  };

  /** Build a values map for every active custom field of an entity, filling the
   *  required ones (and any with a sensible default) so validation never blocks
   *  a demo. Filters claim fields by the current claim type, mirroring the
   *  DynamicFieldRenderer so we only fill fields that are actually shown. */
  const fillCustomFields = (entity: FieldDefinitionEntity): Record<string, string> => {
    const out: Record<string, string> = {};
    fieldDefinitions
      .filter(fd => fd.entity === entity && fd.active)
      .filter(fd => entity !== 'claim' || !fd.applicableClaimTypes || fd.applicableClaimTypes.length === 0 || fd.applicableClaimTypes.includes(claimType))
      .forEach(fd => {
        if (fd.required || fd.default_value) {
          const v = sampleFieldValue(fd);
          if (v) out[fd.key] = v;
        }
      });
    return out;
  };

  /** Generate a small, valid PNG receipt entirely in the browser. The server
   *  rejects any expense line without an image/PDF receipt, and generating one
   *  here (rather than fetching a file from /public) means the autofill never
   *  depends on a placeholder asset being present in the deployed build. */
  const makeReceiptBlob = (): Promise<Blob> => new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 520;
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('no canvas context')); return; }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('DEMO RECEIPT', 28, 56);
    ctx.fillStyle = '#475569';
    ctx.font = '14px sans-serif';
    ctx.fillText('Sample receipt — autofilled for demo', 28, 86);
    ctx.fillText(`Date: ${today()}`, 28, 130);
    ctx.fillText('Vendor: Cafe Manila', 28, 156);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('TOTAL: PHP 850.00', 28, 200);
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
  });

  const [autofilling, setAutofilling] = useState(false);
  const handleAutofillTestData = async () => {
    setAutofilling(true);
    try {
      const blob = await makeReceiptBlob();
      const mockReceipt = (name: string) => new File([blob], name, { type: 'image/png' });

      if (claimType === 'Cash Advance') {
        setCashAdvanceAmount(5000);
        setCashAdvancePurpose('Client site visit — travel and meals advance');
      } else if (claimType === 'Liquidation') {
        if (!cashAdvanceId && myCashAdvances.length > 0) setCashAdvanceId(myCashAdvances[0].id);
        setLineItemsLocal([
          { expenseDate: today(), amount: 1200, paymentMethod: 'Personal Card', vendor: 'Grand Hotel', category: 'Travel', businessPurpose: 'Accommodation during client visit', receiptFile: mockReceipt('receipt_1.png'), receiptUrl: URL.createObjectURL(mockReceipt('receipt_1.png')) },
        ]);
        setClaimCustomFields(fillCustomFields('claim'));
      } else {
        // Reimbursement — fill the whole multi-step flow at once.
        setLineItemsLocal([
          { expenseDate: today(), amount: 850, paymentMethod: 'Personal Card', vendor: 'Cafe Manila', category: 'Meals', businessPurpose: 'Client lunch meeting', receiptFile: mockReceipt('receipt_1.png'), receiptUrl: URL.createObjectURL(mockReceipt('receipt_1.png')) },
        ]);
        setClaimCustomFields(fillCustomFields('claim'));
        if (companies.length > 0) {
          setClientMode('select');
          applyCompanyDefaults(companies[0].name);
        } else {
          setMomCore(p => ({ ...p, client: p.client || 'Acme Corporation' }));
        }
        setMomCore(p => ({
          ...p,
          purpose: p.purpose || 'Quarterly account review',
          location: p.location || 'Makati City, Philippines',
          contactPerson: p.contactPerson || 'Jane Dela Cruz',
          contactPersonEmail: p.contactPersonEmail || 'jane@client.com',
          discussion: p.discussion || 'Reviewed pipeline, agreed next steps and follow-up schedule.',
        }));
        setMomData(p => ({ ...p, ...fillCustomFields('mom') }));
        const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        setMeetingDate(d => d || inThreeDays.toISOString().split('T')[0]);
        setMeetingTime(t => t || '14:00');
      }
      addToast('Form filled with demo data.', 'success');
    } catch {
      addToast('Could not generate the demo receipt for autofill.', 'error');
    } finally {
      setAutofilling(false);
    }
  };

  /** Shared by Save Draft and Submit â€” same three server writes, different finality. */
  /**
   * Each claim type owns a genuinely different server-side flow (AUDIT #1-2:
   * both used to be silently forced through the reimbursement endpoint,
   * which the server rejects for anything without expense line items).
   */
  const send = async (isDraft: boolean) => {
    setLoading(true);
    try {
      if (claimType === 'Cash Advance') {
        await submitCashAdvanceFlow({
          amount: cashAdvanceAmount,
          purpose: cashAdvancePurpose,
          isDraft,
        });
      } else if (claimType === 'Liquidation') {
        await submitLiquidationFlow({
          cashAdvanceId,
          lineItems: lineItemsLocal,
          refundMethod: varianceType === 'RefundDue' ? refundMethod : undefined,
          isDraft,
        });
      } else {
        await submitClaimFlow({
          lineItems: lineItemsLocal,
          mom: {
            ...momCore,
            meetingDate,
            meetingTime,
            source: momSource,
            file: momFile,
          },
          customFields: { ...momData, ...claimCustomFields },
          meetingDate,
          meetingTime,
          remarks: momCore.purpose,
          isDraft,
        });
      }
      await refresh();
      addToast(isDraft ? 'Saved as draft.' : `${claimType} submitted successfully!`, 'success');
      navigate('/claims');
    } catch (err: any) {
      // Server-side workflow rules (missing receipt, unscheduled review meeting,
      // no assigned manager) surface here verbatim rather than being guessed at.
      addToast(err?.message || `Could not submit the ${claimType.toLowerCase()}.`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = () => send(true);
  const handleSubmit = () => send(false);

  const approver = users.find(u => u.id === currentUser.reportsTo);
  const myCashAdvances = claims.filter(c => c.requestorId === currentUser.id && c.type === 'Cash Advance' && c.status === ClaimStatus.RELEASED);

  if (step === 0) {
    return (
      <div className="max-w-[800px] mx-auto py-12 px-6">
        <h2 className="font-headline-lg mb-6">What would you like to submit?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <Card className="hover:border-primary cursor-pointer transition-colors" onClick={() => { setClaimType('Reimbursement'); setStep(2); }}>
            <CardContent className="p-6 text-center">
              <span className="material-symbols-outlined text-[48px] text-primary mb-4">receipt_long</span>
              <h3 className="font-headline-sm">Reimbursement</h3>
              <p className="text-sm text-on-surface-variant mt-2">Claim business expenses already paid for.</p>
            </CardContent>
          </Card>
          <Card className="hover:border-primary cursor-pointer transition-colors" onClick={() => { setClaimType('Cash Advance'); setStep(1); }}>
            <CardContent className="p-6 text-center">
              <span className="material-symbols-outlined text-[48px] text-primary mb-4">payments</span>
              <h3 className="font-headline-sm">Cash Advance</h3>
              <p className="text-sm text-on-surface-variant mt-2">Request funds before an upcoming expense.</p>
            </CardContent>
          </Card>
          <Card className="hover:border-primary cursor-pointer transition-colors" onClick={() => { setClaimType('Liquidation'); setStep(1); }}>
            <CardContent className="p-6 text-center">
              <span className="material-symbols-outlined text-[48px] text-primary mb-4">account_balance_wallet</span>
              <h3 className="font-headline-sm">Liquidation</h3>
              <p className="text-sm text-on-surface-variant mt-2">Settle an existing cash advance.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto animate-in fade-in duration-500 pb-12 px-6">
      <div className="mb-10">
        <div className="flex items-center gap-2 text-on-surface-variant mb-2">
          <span className="font-label-sm uppercase tracking-wider">Claims Management</span>
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          <span className="font-label-sm uppercase tracking-wider text-primary">New {claimType}</span>
        </div>
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="font-headline-lg text-on-surface">Submit {claimType}</h2>
            <p className="font-body-base text-on-surface-variant md:hidden">Step {flowPosition + 1} of {stepFlow.length}: {steps.find(s => s.num === step)?.title}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" className="gap-2" onClick={handleAutofillTestData} disabled={autofilling}>
              <span className="material-symbols-outlined text-[16px]">bolt</span>
              {autofilling ? 'Filling…' : 'Autofill'}
            </Button>
            <div className="text-right hidden sm:block">
              <span className="font-label-sm text-primary uppercase">Draft mode</span>
            </div>
          </div>
        </div>

        {/* Stepper â€” only renders the steps this claim type actually visits */}
        <div className="hidden md:flex relative items-center justify-between w-full max-w-4xl mx-auto pt-6">
          <div className="absolute top-[44px] left-0 w-full h-[2px] bg-outline-variant -z-10"></div>
          <div
            className="absolute top-[44px] left-0 h-[2px] bg-primary -z-10 transition-all duration-500"
            style={{ width: stepFlow.length > 1 ? `${(flowPosition / (stepFlow.length - 1)) * 100}%` : '0%' }}
          ></div>

          {steps.filter(s => stepFlow.includes(s.num)).map((s, idx) => {
            const isActive = step === s.num;
            const isCompleted = flowPosition > idx;
            return (
              <div key={s.num} className="relative z-10 flex flex-col items-center">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center font-bold text-label-md transition-colors",
                  isCompleted ? "bg-primary text-on-primary shadow-sm" :
                  isActive ? "bg-primary-container text-on-primary-container ring-4 ring-primary-container/20 border-2 border-primary" :
                  "bg-surface-container-highest text-on-surface-variant border-2 border-outline-variant"
                )}>
                  {isCompleted ? <span className="material-symbols-outlined" style={{ fontVariationSettings: "'wght' 700" }}>check</span> : idx + 1}
                </div>
                <span className={cn("absolute -bottom-8 font-label-sm whitespace-nowrap", isActive ? "block text-primary font-bold" : "hidden sm:block", isCompleted && !isActive ? "text-on-surface font-bold" : "text-on-surface-variant")}>
                  {s.title}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8 md:mt-16 pb-24 md:pb-0">
        {step === 1 && (
          <Card>
            <CardHeader>
              <h3 className="font-headline-md text-on-surface">{claimType} Details</h3>
              <div className="flex items-center gap-2">
              {claimType !== 'Cash Advance' && (
                <Button size="sm" className="gap-2" onClick={() => setLineItemsLocal(p => [...p, { expenseDate: new Date().toISOString().split('T')[0], amount: 0, paymentMethod: 'Personal Card', vendor: '', category: 'Meals' }])}>
                  <span className="material-symbols-outlined text-[18px]">add</span> Add Row
                </Button>
              )}
              </div>
            </CardHeader>
            <CardContent>
              {claimType === 'Liquidation' && (
                <div className="mb-6 max-w-md">
                  <Label required>Select Cash Advance to Liquidate</Label>
                  <Select value={cashAdvanceId} onChange={e => setCashAdvanceId(e.target.value)}>
                    <option value="">-- Select --</option>
                    {myCashAdvances.map(ca => <option key={ca.id} value={ca.id}>{ca.ref} - {formatMoney(ca.total)} ({ca.purpose})</option>)}
                  </Select>
                </div>
              )}

              {/* A Cash Advance has no expense lines of its own — it's an
                  amount requested up front, settled later by a Liquidation. */}
              {claimType === 'Cash Advance' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mb-6">
                  <div>
                    <Label required>Requested Amount</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant">₱</span>
                      <Input type="number" value={cashAdvanceAmount || ''} onChange={e => setCashAdvanceAmount(Number(e.target.value))} className="pl-6" />
                    </div>
                  </div>
                  <div>
                    <Label required>Purpose</Label>
                    <Input value={cashAdvancePurpose} onChange={e => setCashAdvancePurpose(e.target.value)} placeholder="What is this advance for?" />
                  </div>
                </div>
              )}

              {claimType !== 'Cash Advance' && (
              <div className="mb-6">
                <DynamicFieldRenderer
                  entity="claim"
                  claimType={claimType}
                  values={claimCustomFields}
                  onChange={(key, value) => setClaimCustomFields(p => ({ ...p, [key]: value }))}
                />
              </div>
              )}
              {claimType !== 'Cash Advance' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[900px]">
                  <thead className="bg-brand-table-header text-on-surface-variant font-label-sm uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-3 sticky left-0 bg-brand-table-header z-20 shadow-[1px_0_0_var(--color-brand-border)]">Date</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Vendor / Supplier</th>
                      <th className="px-3 py-3">Payment Method</th>
                      <th className="px-3 py-3">Purpose</th>
                      <th className="px-3 py-3 text-right">Amount</th>
                      <th className="px-3 py-3">Receipt / OR Attachment</th>
                      <th className="px-3 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-border">
                    {lineItemsLocal.map((item, idx) => (
                      <tr key={idx} className="hover:bg-brand-row-hover transition-colors group">
                        <td className="px-3 py-3 sticky left-0 bg-white z-10 shadow-[1px_0_0_var(--color-brand-border)] group-hover:bg-brand-row-hover">
                          <Input type="date" value={item.expenseDate || ''} onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, expenseDate: e.target.value } : li))} className="py-1 px-2 text-xs" />
                        </td>
                        <td className="px-3 py-3">
                          <Select className="py-1 px-2 text-xs" value={item.category || ''} onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, category: e.target.value } : li))}>
                            <option value="">Select Category</option>
                            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </Select>
                        </td>
                        <td className="px-3 py-3">
                          <Input type="text" value={item.vendor || ''} onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, vendor: e.target.value } : li))} className="py-1 px-2 text-xs" placeholder="Vendor..." />
                        </td>
                        <td className="px-3 py-3">
                          <Select className="py-1 px-2 text-xs" value={item.paymentMethod || 'Personal Card'} onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, paymentMethod: e.target.value } : li))}>
                            <option>Personal Card</option>
                            <option>Company Card</option>
                            <option>Cash</option>
                            <option>Bank Transfer</option>
                          </Select>
                        </td>
                        <td className="px-3 py-3">
                          <Input type="text" value={item.businessPurpose || ''} onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, businessPurpose: e.target.value } : li))} className="py-1 px-2 text-xs" placeholder="Purpose..." />
                        </td>
                        <td className="px-3 py-3">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-outline-variant text-xs">₱</span>
                            <Input type="number" value={item.amount || ''} onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, amount: Number(e.target.value) } : li))} className={cn("pl-5 py-1 px-2 text-right font-mono-data text-xs", overLimit(item) && "border-error text-error")} />
                          </div>
                          {overLimit(item) && (
                            <p className="text-error text-[11px] mt-1 whitespace-nowrap flex items-center gap-0.5">
                              <span className="material-symbols-outlined text-[13px]">error</span>
                              Max {formatMoney(limitFor(item.category))}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            {item.receiptFile ? (
                              <div className="flex items-center gap-1 bg-surface-container px-2 py-1 rounded text-xs">
                                <span className="material-symbols-outlined text-[14px] text-primary">description</span>
                                <span className="truncate max-w-[100px]">{item.receiptFile.name}</span>
                                <button type="button" onClick={() => setLineItemsLocal(prev => prev.map((li, i) =>
                                  i === idx ? { ...li, receiptFile: undefined, receiptUrl: undefined } : li
                                ))} className="text-error hover:opacity-80">
                                  <span className="material-symbols-outlined text-[14px]">close</span>
                                </button>
                              </div>
                            ) : (
                              <label className="cursor-pointer inline-flex items-center gap-1 text-xs text-primary font-semibold hover:underline">
                                <span className="material-symbols-outlined text-[16px]">upload_file</span> Attach OR/Receipt
                                <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => handleFileUploadForLineItem(idx, e)} />
                              </label>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={() => setLineItemsLocal(p => p.filter((_, i) => i !== idx))} className="text-error hover:opacity-70"><span className="material-symbols-outlined">delete_outline</span></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
              <div className="mt-6 flex justify-end gap-8 bg-surface-container-low p-6 rounded-lg">
                {claimType !== 'Cash Advance' && (
                  <div className="text-right">
                    <span className="font-label-sm text-on-surface-variant uppercase">Total Items</span>
                    <p className="font-headline-md">{lineItemsLocal.length}</p>
                  </div>
                )}
                {claimType === 'Liquidation' && cashAdvanceId && (
                  <div className="text-right">
                    <span className="font-label-sm text-on-surface-variant uppercase">Advance</span>
                    <p className="font-headline-md">{formatMoney(claims.find(c => c.id === cashAdvanceId)?.total || 0)}</p>
                  </div>
                )}
                <div className="text-right bg-primary-container text-on-primary-container px-6 py-3 rounded-lg">
                  <span className="font-label-sm uppercase opacity-80">{claimType === 'Liquidation' ? varianceType : 'Total Amount'}</span>
                  <p className="text-[28px] font-bold leading-none mt-1">{formatMoney(claimType === 'Liquidation' ? Math.abs(varianceAmount) : totalAmount)}</p>
                </div>
              </div>

              {/* Refund due: the requestor spent less than the advance and owes
                  the balance back. Let them declare how they'll return it — the
                  custodian confirms this method when they collect. */}
              {claimType === 'Liquidation' && varianceType === 'RefundDue' && (
                <div className="mt-4 p-5 rounded-lg border border-tertiary/40 bg-tertiary-container/20">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-tertiary mt-0.5">undo</span>
                    <div className="flex-1">
                      <p className="font-label-md text-on-surface">
                        You need to return {formatMoney(Math.abs(varianceAmount))} to the company.
                      </p>
                      <p className="text-body-sm text-outline mt-0.5 mb-3">
                        How will you pay this refund back? The custodian confirms it when they collect.
                      </p>
                      <div className="max-w-xs">
                        <label className="block text-label-sm text-on-surface mb-1">Refund Method <span className="text-error">*</span></label>
                        <Select value={refundMethod} onChange={e => setRefundMethod(e.target.value)}>
                          <option value="">Select how you'll refund…</option>
                          {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        
        {step === 2 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <Card className="lg:col-span-12">
              <CardContent>
                <div className="flex justify-between items-center mb-6">
                  <h4 className="font-headline-md text-on-surface">Minutes of Meeting</h4>
                  <Select value={momSource} onChange={(e) => setMomSource(e.target.value as MinutesSource)} className="w-auto">
                    <option value={MinutesSource.TEMPLATE}>Fill Template</option>
                    <option value={MinutesSource.UPLOADED}>Upload File</option>
                  </Select>
                </div>
                
                {momSource === MinutesSource.UPLOADED ? (
                  <div className="border-2 border-dashed border-outline-variant rounded-lg p-12 text-center flex flex-col items-center justify-center bg-surface-container-low">
                    <input 
                      type="file" 
                      accept=".pdf,.doc,.docx,image/*" 
                      className="hidden" 
                      ref={momFileInputRef}
                      onChange={handleFileUploadForMOM}
                    />
                    {momData.fileName ? (
                      <div className="flex flex-col items-center">
                        <span className="material-symbols-outlined text-[56px] text-primary mb-3">description</span>
                        <p className="font-bold text-on-surface mb-1">{momData.fileName}</p>
                        <p className="text-xs text-green-700 bg-green-100 px-3 py-1 rounded-full mb-4">File attached ready for submission</p>
                        <Button variant="outline" size="sm" onClick={() => setMomData(p => ({...p, fileName: undefined, fileUrl: undefined}))}>Remove File</Button>
                      </div>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[48px] text-outline mb-4">cloud_upload</span>
                        <p className="font-bold text-on-surface mb-2">Drag and drop MOM document</p>
                        <p className="text-sm text-on-surface-variant mb-6">PDF, DOCX, or JPG up to 10MB</p>
                        <Button variant="outline" onClick={() => momFileInputRef.current?.click()}>Browse Files</Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Core minutes fields. These are first-class columns on the
                        server's MOM record, not admin-configurable extras, so
                        they're rendered explicitly rather than via field defs. */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <div className="flex items-center justify-between">
                          <Label required>Client / Company</Label>
                          {companies.length > 0 && (
                            <button
                              type="button"
                              className="text-[12px] text-primary font-semibold hover:underline mb-1"
                              onClick={() => setClientMode(m => m === 'select' ? 'custom' : 'select')}
                            >
                              {clientMode === 'select' ? 'Type a new company' : 'Choose from directory'}
                            </button>
                          )}
                        </div>
                        {clientMode === 'select' && companies.length > 0 ? (
                          <Select
                            value={companies.some(c => c.name === momCore.client) ? momCore.client : ''}
                            onChange={e => applyCompanyDefaults(e.target.value)}
                          >
                            <option value="">-- Select a company --</option>
                            {companies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                          </Select>
                        ) : (
                          <Input value={momCore.client} onChange={e => setMomCore(p => ({ ...p, client: e.target.value }))} placeholder="Who did you meet with?" />
                        )}
                      </div>
                      <div>
                        <Label required>Purpose of Meeting</Label>
                        <Input value={momCore.purpose} onChange={e => setMomCore(p => ({ ...p, purpose: e.target.value }))} placeholder="Why did you meet?" />
                      </div>
                      <div>
                        <Label>Location</Label>
                        <Input value={momCore.location} onChange={e => setMomCore(p => ({ ...p, location: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Contact Person</Label>
                        <Input value={momCore.contactPerson} onChange={e => setMomCore(p => ({ ...p, contactPerson: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Contact Email</Label>
                        <Input type="email" value={momCore.contactPersonEmail} onChange={e => setMomCore(p => ({ ...p, contactPersonEmail: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <Label>Discussion</Label>
                      <textarea
                        rows={3}
                        className="w-full bg-white border border-[#CBD5E1] rounded-[6px] px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                        value={momCore.discussion}
                        onChange={e => setMomCore(p => ({ ...p, discussion: e.target.value }))}
                      />
                    </div>
                    <DynamicFieldRenderer entity="mom" values={momData} onChange={(key, value) => setMomData(p => ({ ...p, [key]: value }))} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
        
        {step === 3 && (
          <Card className="max-w-2xl mx-auto">
            <CardContent>
              <h4 className="font-headline-md text-on-surface mb-6">Schedule Review Meeting</h4>
              <p className="text-on-surface-variant mb-8">Select a time to review this claim with your approver ({approver?.name || 'Assigned Approver'}).</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label required>Date</Label>
                  <Input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} />
                </div>
                <div>
                  <Label required>Time</Label>
                  <Input type="time" value={meetingTime} onChange={e => setMeetingTime(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card className="max-w-3xl mx-auto text-center py-12">
            <span className="material-symbols-outlined text-[48px] text-primary mb-4">fact_check</span>
            <h4 className="font-headline-md text-on-surface mb-2">Ready to Submit</h4>
            <p className="text-on-surface-variant mb-6">Review your {claimType} before submission.</p>
            <div className="bg-surface-container p-6 rounded-lg text-left inline-block w-full max-w-md">
              <div className="flex justify-between mb-2"><span className="text-on-surface-variant">Type:</span><span className="font-bold">{claimType}</span></div>
              <div className="flex justify-between mb-2"><span className="text-on-surface-variant">Total Amount:</span><span className="font-mono-data font-bold">{formatMoney(totalAmount)}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Approver:</span><span className="font-bold">{approver?.name || 'Assigned Approver'}</span></div>
            </div>
          </Card>
        )}
      </div>

      <div className="fixed md:static bottom-0 left-0 w-full md:w-auto bg-surface z-40 p-4 md:p-0 md:mt-8 flex justify-between items-center border-t border-brand-border md:pt-8 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] md:shadow-none">
        <Button variant="outline" className="gap-2" onClick={handleBack}>
          <span className="material-symbols-outlined">arrow_back</span> Back
        </Button>
        <div className="flex gap-4">
          {step > 0 && <Button variant="ghost" onClick={handleSaveDraft} className="hidden md:inline-flex">Save Draft</Button>}
          {step > 0 && step < 4 ? (
            <Button className="gap-2 px-8" onClick={handleNext}>Next Step <span className="material-symbols-outlined hidden sm:inline-block">arrow_forward</span></Button>
          ) : step === 4 ? (
            <Button className="gap-2 px-8" onClick={handleSubmit} disabled={loading}>
              {loading ? <span className="material-symbols-outlined animate-spin">sync</span> : null} Submit <span className="hidden sm:inline-block ml-1">{claimType}</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

