import React from "react";
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input, Select, Label } from '../../components/ui/Input';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { cn } from '../../components/ui/Button';
import { useAppContext } from '../../components/AppContext';
import { DynamicFieldRenderer } from '../../components/shared/DynamicFieldRenderer';
import { useToast } from '../../components/shared/ToastContext';
import { ConfirmModal } from '../../components/shared/ConfirmModal';
import { ClaimStatus, ClaimType, MomDocumentType, DOCUMENT_TYPE_LABEL } from '../../types';
import { submitClaimFlow, submitCashAdvanceFlow, submitLiquidationFlow, DraftLineItem } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { EXPENSE_CATEGORIES } from '../../lib/expenseCategories';
import {
  getReimbursementDateError,
  getTodayIsoDate,
  REIMBURSEMENT_FILING_WINDOW_DAYS,
  shiftIsoDate,
  validateReimbursementPurchaseDate,
} from '../../lib/reimbursementPolicy';
import { FieldDefinition, FieldDefinitionEntity } from '../../types';

const TYPE_PARAM_MAP: Record<string, ClaimType> = {
  reimbursement: 'Reimbursement',
  transport: 'Transport Reimbursement',
  advance: 'Cash Advance',
  liquidation: 'Liquidation',
};
const REIMBURSEMENT_CAP = 1000;

export function SubmitClaim() {
  const navigate = useNavigate();
  const { currentUser, fieldDefinitions, users, claims, companies, masterData, paymentMethods, refresh } = useAppContext();
  const { addToast } = useToast();
  const [searchParams] = useSearchParams();
  const typeFromQuery = TYPE_PARAM_MAP[searchParams.get('type') ?? ''];
  const reimbursementIntent = searchParams.get('intent') === 'reimbursement';

  const [claimType, setClaimType] = useState<ClaimType>(typeFromQuery ?? 'Reimbursement');
  // Step 0 is Type Selection. A Reimbursement now opens on the Minutes of
  // Meeting step (2) rather than Details & Items (1) — see stepFlow below.
  const [step, setStep] = useState(typeFromQuery ? (typeFromQuery === 'Reimbursement' ? 2 : 1) : 0);
  const [loading, setLoading] = useState(false);

  // Form State. Holds the real File alongside the preview URL â€” the server
  // needs the bytes, and an object URL can't be re-read after a reload.
  const [lineItemsLocal, setLineItemsLocal] = useState<DraftLineItem[]>([
    { expenseDate: '', amount: 0, paymentMethod: 'Personal Card', vendor: '', category: 'Meals' }
  ]);
  const [dateValidationAttempted, setDateValidationAttempted] = useState(false);
  const [dateBlockMessage, setDateBlockMessage] = useState('');
  const invalidDateInputRefs = React.useRef<Array<HTMLInputElement | null>>([]);
  const clientEmailInputRef = React.useRef<HTMLInputElement>(null);
  const [momCore, setMomCore] = useState({
    client: '', purpose: '', meetingDate: '', location: '', contactPerson: '', contactPersonEmail: '',
    discussion: '', actionItems: '', ccClient: false,
  });
  // A known Company Directory entry can pre-fill the meeting details below
  // (mirrors the original system's "Company Auto-Fill" MOM behavior). Default
  // to the picker when companies exist; fall back to free text otherwise.
  const [clientMode, setClientMode] = useState<'select' | 'custom'>('select');
  const [cashAdvanceId, setCashAdvanceId] = useState<string>('');
  const [cashAdvanceAmount, setCashAdvanceAmount] = useState<number>(0);
  const [cashAdvancePurpose, setCashAdvancePurpose] = useState('');
  // How the requestor intends to return an over-advance (refund due). Only
  // relevant to a Liquidation whose actual spend came in under the advance.
  const [refundMethod, setRefundMethod] = useState('');
  // Whether this claim is anchored to Minutes of Meeting or a Letter of
  // Agreement — same record, different intent/labelling.
  const [documentType, setDocumentType] = useState<MomDocumentType>('MoM');
  const [momData, setMomData] = useState<Record<string, any>>({});
  const [claimCustomFields, setClaimCustomFields] = useState<Record<string, string>>({});

  // Declared in the order a Reimbursement actually visits them (MOM before
  // Details & Items) — the stepper dots and the "Step X of Y" label below
  // both read off this array's order, not the numeric `num`.
  const steps = [
    { num: 2, title: DOCUMENT_TYPE_LABEL[documentType] },
    { num: 1, title: 'Details & Items' },
    { num: 4, title: 'Review & Submit' }
  ];

  // A Cash Advance is just an amount + purpose, and a Liquidation has no MOM
  // or review-meeting concept of its own — both skip straight from Details to
  // Review & Submit. A Reimbursement captures the Minutes of Meeting first,
  // then the expense details/items, so the approver's context (who, why) is
  // already on record before line items are entered.
  const stepFlow = claimType === 'Reimbursement' ? [2, 1, 4] : [1, 4];
  const flowPosition = stepFlow.indexOf(step);
  const isReimbursement = claimType === 'Reimbursement' || claimType === 'Transport Reimbursement';
  const filingDate = getTodayIsoDate();
  const earliestEligiblePurchaseDate = shiftIsoDate(filingDate, -REIMBURSEMENT_FILING_WINDOW_DAYS);
  const invalidReimbursementDateIndex = isReimbursement
    ? lineItemsLocal.findIndex(item => !validateReimbursementPurchaseDate(item.expenseDate, filingDate).valid)
    : -1;
  const hasInvalidReimbursementDate = invalidReimbursementDateIndex !== -1;

  const showReimbursementDateError = () => {
    if (!hasInvalidReimbursementDate) return false;
    setDateValidationAttempted(true);
    const message = getReimbursementDateError(
      lineItemsLocal[invalidReimbursementDateIndex]?.expenseDate,
      filingDate,
    );
    setDateBlockMessage(`Expense row ${invalidReimbursementDateIndex + 1}: ${message}`);
    return true;
  };

  const closeDateBlockDialog = () => {
    setDateBlockMessage('');
    window.setTimeout(() => invalidDateInputRefs.current[invalidReimbursementDateIndex]?.focus(), 0);
  };

  const handleNext = () => {
    if (step === 2 && momCore.ccClient && !momCore.contactPersonEmail.trim()) {
      addToast('Enter the client email to send claim status notifications.', 'error');
      window.setTimeout(() => clientEmailInputRef.current?.focus(), 0);
      return;
    }
    if (step === 1 && (claimType === 'Reimbursement' || claimType === 'Transport Reimbursement') && lineItemsLocal.length === 0) {
      addToast('Please add at least one line item', 'error');
      return;
    }
    if (step === 1 && isReimbursement && showReimbursementDateError()) {
      return;
    }
    // Company spending policy — block advancing past Details with an over-cap line.
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
    if (step === 1 && (claimType === 'Reimbursement' || claimType === 'Transport Reimbursement')) {
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
    if (step === 2) {
      if (!momCore.client.trim() || !momCore.purpose.trim() || !momCore.meetingDate) {
        addToast('Client, purpose, and date of meeting are required.', 'error');
        return;
      }
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
  const reimbursableAmount = claimType === 'Reimbursement' || claimType === 'Transport Reimbursement'
    ? Math.min(totalAmount, REIMBURSEMENT_CAP)
    : totalAmount;
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

  /** Presenter convenience (the header "Autofill" button): fill the ENTIRE
   *  flow — Minutes of Meeting, admin-configured custom fields, expense line
   *  items (with a mock receipt, since the server rejects any expense line
   *  without one) and the review meeting — in one click, so a full claim can be
   *  filled and submitted while presenting instead of typing every field. */
  const today = () => getTodayIsoDate();

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
        setCashAdvancePurpose('Client site visit — transportation and meals advance');
      } else if (claimType === 'Liquidation') {
        if (!cashAdvanceId && myCashAdvances.length > 0) setCashAdvanceId(myCashAdvances[0].id);
        setLineItemsLocal([
          { expenseDate: today(), amount: 1200, paymentMethod: 'Personal Card', vendor: 'Grand Hotel', category: 'Transportation', businessPurpose: 'Accommodation during client visit', receiptFile: mockReceipt('receipt_1.png'), receiptUrl: URL.createObjectURL(mockReceipt('receipt_1.png')) },
        ]);
        setClaimCustomFields(fillCustomFields('claim'));
      } else if (claimType === 'Transport Reimbursement') {
        setLineItemsLocal([
          { expenseDate: today(), amount: 850, paymentMethod: 'Personal Card', vendor: 'Grab', category: 'Transportation', businessPurpose: 'Business transport', orNumber: 'OR-DEMO-001', receiptFile: mockReceipt('transport_receipt.png'), receiptUrl: URL.createObjectURL(mockReceipt('transport_receipt.png')) },
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
          actionItems: p.actionItems || 'Send the revised proposal and confirm the next meeting date.',
          meetingDate: p.meetingDate || today(),
        }));
        setMomData(p => ({ ...p, ...fillCustomFields('mom') }));
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
    if (!isDraft && isReimbursement && showReimbursementDateError()) return;
    if (claimType === 'Reimbursement' && momCore.ccClient && !momCore.contactPersonEmail.trim()) {
      addToast('Enter the client email to send claim status notifications.', 'error');
      setStep(2);
      window.setTimeout(() => clientEmailInputRef.current?.focus(), 0);
      return;
    }
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
          claimType,
          lineItems: lineItemsLocal,
          mom: claimType === 'Reimbursement' ? {
            ...momCore,
            documentType,
          } : undefined,
          customFields: { ...momData, ...claimCustomFields },
          remarks: claimType === 'Transport Reimbursement' ? 'Transport reimbursement' : momCore.purpose,
          isDraft,
        });
      }
      await refresh();
      addToast(isDraft ? 'Saved as draft.' : `${claimType} submitted successfully!`, 'success');
      navigate('/claims');
    } catch (err: any) {
      // Server-side workflow rules surface here verbatim rather than being guessed at.
      addToast(err?.message || `Could not submit the ${claimType.toLowerCase()}.`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = () => send(true);
  const handleSubmit = () => send(false);

  const approver = users.find(u => u.id === currentUser.reportsTo);
  // A Released advance stays Released until its liquidation is fully closed, so
  // "Released" alone isn't enough — one that already has a liquidation (draft or
  // in-flight) can't be liquidated again, and offering it here only leads to a
  // dead-end "A Liquidation already exists" error at submit. Exclude those.
  const liquidatedCaIds = new Set(
    claims.filter(c => c.type === 'Liquidation' && c.cashAdvanceId).map(c => c.cashAdvanceId)
  );
  const myCashAdvances = claims.filter(c =>
    c.requestorId === currentUser.id &&
    c.type === 'Cash Advance' &&
    c.status === ClaimStatus.RELEASED &&
    !liquidatedCaIds.has(c.id)
  );
  // A liquidation must settle an actual released advance — with none available
  // there's nothing to file, so we hide the expense form and the Next button
  // rather than letting someone build a liquidation against no advance.
  const liquidationBlocked = claimType === 'Liquidation' && myCashAdvances.length === 0;

  if (step === 0) {
    return (
      <div className="max-w-[800px] mx-auto py-12 px-6">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm font-semibold text-on-surface-variant hover:text-primary mb-6"
          onClick={() => navigate(-1)}
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Back
        </button>
        <div className="mb-8">
          <span className="font-label-sm text-primary font-bold uppercase tracking-wider">
            {reimbursementIntent ? 'New reimbursement' : 'New request'}
          </span>
          <h2 className="font-display text-display text-on-surface mt-1">
            {reimbursementIntent ? 'What are you claiming?' : 'What would you like to submit?'}
          </h2>
          <p className="text-body-md text-outline mt-2">
            {reimbursementIntent
              ? 'Choose the option that matches the expense. We will tailor the form and requirements for you.'
              : 'Choose a request type to start the correct workflow.'}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <Card
            role="button"
            tabIndex={0}
            aria-label="Start a general reimbursement"
            className="group h-full border-2 hover:border-primary hover:shadow-lg cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => { setClaimType('Reimbursement'); setStep(2); }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setClaimType('Reimbursement');
                setStep(2);
              }
            }}
          >
            <CardContent className="p-7">
              <div className="w-12 h-12 rounded-xl bg-primary-container/30 text-primary flex items-center justify-center mb-5">
                <span className="material-symbols-outlined text-[28px]">receipt_long</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-headline-sm">General Reimbursement</h3>
                  <p className="text-sm text-on-surface-variant mt-2">Meals, accommodation, supplies, and other business expenses.</p>
                </div>
                <span className="material-symbols-outlined text-outline group-hover:text-primary group-hover:translate-x-1 transition-all">arrow_forward</span>
              </div>
              <p className="text-xs text-outline mt-5 pt-4 border-t border-outline-variant">Includes meeting details and supporting minutes.</p>
            </CardContent>
          </Card>
          <Card
            role="button"
            tabIndex={0}
            aria-label="Start a transport reimbursement"
            className="group h-full border-2 hover:border-primary hover:shadow-lg cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => {
            setClaimType('Transport Reimbursement');
            setLineItemsLocal([{ expenseDate: '', amount: 0, paymentMethod: 'Personal Card', vendor: '', category: 'Transportation' }]);
            setStep(1);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setClaimType('Transport Reimbursement');
                setLineItemsLocal([{ expenseDate: '', amount: 0, paymentMethod: 'Personal Card', vendor: '', category: 'Transportation' }]);
                setStep(1);
              }
            }}
          >
            <CardContent className="p-7">
              <div className="w-12 h-12 rounded-xl bg-secondary-container/60 text-on-secondary-container flex items-center justify-center mb-5">
                <span className="material-symbols-outlined text-[28px]">local_taxi</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-headline-sm">Transport Reimbursement</h3>
                  <p className="text-sm text-on-surface-variant mt-2">Fares, mileage, tolls, parking, and other business transport.</p>
                </div>
                <span className="material-symbols-outlined text-outline group-hover:text-primary group-hover:translate-x-1 transition-all">arrow_forward</span>
              </div>
              <p className="text-xs text-outline mt-5 pt-4 border-t border-outline-variant">A faster receipt-based flow with no meeting minutes required.</p>
            </CardContent>
          </Card>
          {!reimbursementIntent && <Card
            role="button"
            tabIndex={0}
            aria-label="Start a cash advance request"
            className="group h-full border-2 hover:border-primary hover:shadow-lg cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => { setClaimType('Cash Advance'); setStep(1); }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setClaimType('Cash Advance');
                setStep(1);
              }
            }}
          >
            <CardContent className="p-7">
              <div className="w-12 h-12 rounded-xl bg-primary-container/30 text-primary flex items-center justify-center mb-5">
                <span className="material-symbols-outlined text-[28px]">payments</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-headline-sm">Cash Advance</h3>
                  <p className="text-sm text-on-surface-variant mt-2">Request company funds before an upcoming business expense.</p>
                </div>
                <span className="material-symbols-outlined text-outline group-hover:text-primary group-hover:translate-x-1 transition-all">arrow_forward</span>
              </div>
              <p className="text-xs text-outline mt-5 pt-4 border-t border-outline-variant">The released amount must be liquidated after the expense.</p>
            </CardContent>
          </Card>}
          {!reimbursementIntent && <Card
            role="button"
            tabIndex={0}
            aria-label="Start a liquidation"
            className="group h-full border-2 hover:border-primary hover:shadow-lg cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => { setClaimType('Liquidation'); setStep(1); }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setClaimType('Liquidation');
                setStep(1);
              }
            }}
          >
            <CardContent className="p-7">
              <div className="w-12 h-12 rounded-xl bg-secondary-container/60 text-on-secondary-container flex items-center justify-center mb-5">
                <span className="material-symbols-outlined text-[28px]">account_balance_wallet</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-headline-sm">Liquidation</h3>
                  <p className="text-sm text-on-surface-variant mt-2">Submit receipts and settle an existing cash advance.</p>
                </div>
                <span className="material-symbols-outlined text-outline group-hover:text-primary group-hover:translate-x-1 transition-all">arrow_forward</span>
              </div>
              <p className="text-xs text-outline mt-5 pt-4 border-t border-outline-variant">Available when you have a released advance to settle.</p>
            </CardContent>
          </Card>}
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
        <div className={cn(
          "hidden md:flex relative items-center justify-between w-full mx-auto pt-6",
          // A 2-step flow (Cash Advance / Liquidation) shouldn't stretch its two
          // dots across the full 4xl width — cap it so they sit sensibly close.
          stepFlow.length <= 2 ? "max-w-sm" : "max-w-4xl"
        )}>
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
              {claimType !== 'Cash Advance' && !liquidationBlocked && (
                <Button size="sm" className="gap-2" onClick={() => setLineItemsLocal(p => [...p, {
                  expenseDate: '',
                  amount: 0,
                  paymentMethod: 'Personal Card',
                  vendor: '',
                  category: claimType === 'Transport Reimbursement' ? 'Transportation' : 'Meals',
                }])}>
                  <span className="material-symbols-outlined text-[18px]">add</span> Add Row
                </Button>
              )}
              </div>
            </CardHeader>
            <CardContent>
              {claimType === 'Liquidation' && (
                myCashAdvances.length === 0 ? (
                  <div className="mb-6 p-6 rounded-lg border border-outline-variant bg-surface-container-low text-center">
                    <span className="material-symbols-outlined text-[36px] text-outline mb-2">check_circle</span>
                    <p className="font-label-md text-on-surface mb-1">No cash advances to liquidate</p>
                    <p className="text-body-sm text-outline">
                      You have no released cash advances awaiting liquidation. Any advance you've already
                      started liquidating won't appear here.
                    </p>
                  </div>
                ) : (
                  <div className="mb-6 max-w-md">
                    <Label required>Select Cash Advance to Liquidate</Label>
                    <Select value={cashAdvanceId} onChange={e => setCashAdvanceId(e.target.value)}>
                      <option value="">-- Select --</option>
                      {myCashAdvances.map(ca => <option key={ca.id} value={ca.id}>{ca.ref} - {formatMoney(ca.total)} ({ca.purpose})</option>)}
                    </Select>
                  </div>
                )
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

              {claimType !== 'Cash Advance' && !liquidationBlocked && (
              <div className="mb-6">
                <DynamicFieldRenderer
                  entity="claim"
                  claimType={claimType}
                  values={claimCustomFields}
                  onChange={(key, value) => setClaimCustomFields(p => ({ ...p, [key]: value }))}
                />
              </div>
              )}
              {claimType !== 'Cash Advance' && !liquidationBlocked && (
              <div className="overflow-x-auto">
                {isReimbursement && (
                  <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                    <span className="material-symbols-outlined text-primary text-[20px]">event_available</span>
                    <div>
                      <p className="text-sm font-semibold text-on-surface">30-day filing window</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Receipt purchases must be dated from {earliestEligiblePurchaseDate} through {filingDate}. Older receipts cannot proceed to review.
                      </p>
                    </div>
                  </div>
                )}
                <table className="w-full text-left min-w-[1080px]">
                  <thead className="bg-brand-table-header text-on-surface-variant font-label-sm uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-3 sticky left-0 bg-brand-table-header z-20 shadow-[1px_0_0_var(--color-brand-border)]">Date of Purchase</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Vendor / Supplier</th>
                      <th className="px-3 py-3">Payment Method</th>
                      <th className="px-3 py-3">Purpose</th>
                      <th className="px-3 py-3">OR Number</th>
                      <th className="px-3 py-3 text-right">Amount</th>
                      <th className="px-3 py-3">Receipt / OR Attachment</th>
                      <th className="px-3 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-border">
                    {lineItemsLocal.map((item, idx) => (
                      <tr key={idx} className="hover:bg-brand-row-hover transition-colors group">
                        <td className="px-3 py-3 sticky left-0 bg-white z-10 shadow-[1px_0_0_var(--color-brand-border)] group-hover:bg-brand-row-hover">
                          <Input
                            ref={element => { invalidDateInputRefs.current[idx] = element; }}
                            id={`expense-date-${idx}`}
                            type="date"
                            value={item.expenseDate || ''}
                            max={isReimbursement ? filingDate : undefined}
                            aria-invalid={dateValidationAttempted && isReimbursement && !validateReimbursementPurchaseDate(item.expenseDate, filingDate).valid}
                            aria-describedby={
                              dateValidationAttempted && isReimbursement && getReimbursementDateError(item.expenseDate, filingDate)
                                ? `expense-date-error-${idx}`
                                : undefined
                            }
                            onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, expenseDate: e.target.value } : li))}
                            className={cn(
                              "py-1 px-2 text-xs",
                              dateValidationAttempted && isReimbursement && !validateReimbursementPurchaseDate(item.expenseDate, filingDate).valid && "border-error focus:ring-error",
                            )}
                          />
                          {dateValidationAttempted && isReimbursement && getReimbursementDateError(item.expenseDate, filingDate) && (
                            <p id={`expense-date-error-${idx}`} className="text-error text-[11px] mt-1 max-w-[190px] flex items-start gap-1">
                              <span aria-hidden="true" className="material-symbols-outlined text-[13px] mt-px">error</span>
                              {getReimbursementDateError(item.expenseDate, filingDate)}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Select disabled={claimType === 'Transport Reimbursement'} className="py-1 px-2 text-xs" value={item.category || ''} onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, category: e.target.value } : li))}>
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
                          <Input
                            type="text"
                            value={item.orNumber || ''}
                            onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, orNumber: e.target.value } : li))}
                            className="py-1 px-2 text-xs"
                            placeholder="Official receipt no."
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-outline-variant text-xs">₱</span>
                            <Input type="number" value={item.amount || ''} onChange={e => setLineItemsLocal(prev => prev.map((li, i) => i === idx ? { ...li, amount: Number(e.target.value) } : li))} className="pl-5 py-1 px-2 text-right font-mono-data text-xs" />
                          </div>
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
              {!liquidationBlocked && (
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
              )}

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
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
                  <h4 className="font-headline-md text-on-surface">{DOCUMENT_TYPE_LABEL[documentType]}</h4>
                  <div className="flex items-center gap-2">
                    <Select value={documentType} onChange={(e) => setDocumentType(e.target.value as MomDocumentType)} className="w-auto" aria-label="Document type">
                      <option value="MoM">Minutes of Meeting</option>
                      <option value="LOA">Letter of Agreement</option>
                    </Select>
                  </div>
                </div>
                
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
                        <Label required>Date of Meeting</Label>
                        <Input type="date" value={momCore.meetingDate} onChange={e => setMomCore(p => ({ ...p, meetingDate: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Location of Meeting</Label>
                        <Input value={momCore.location} onChange={e => setMomCore(p => ({ ...p, location: e.target.value }))} />
                      </div>
                    </div>
                    <section className="pt-6 border-t border-outline-variant space-y-5">
                      <div>
                        <h5 className="font-headline-sm text-on-surface">Client contact</h5>
                        <p className="text-body-sm text-outline mt-1">Who attended on behalf of the client and where should updates be sent?</p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <Label>Contact Person</Label>
                          <Input value={momCore.contactPerson} onChange={e => setMomCore(p => ({ ...p, contactPerson: e.target.value }))} />
                        </div>
                        <DynamicFieldRenderer
                          entity="mom"
                          values={momData}
                          onChange={(key, value) => setMomData(p => ({ ...p, [key]: value }))}
                          includeKeys={['contact_person_designation']}
                          containerClassName="contents"
                        />
                        <div>
                          <Label required={momCore.ccClient}>Client Email</Label>
                          <Input ref={clientEmailInputRef} type="email" required={momCore.ccClient} value={momCore.contactPersonEmail} onChange={e => setMomCore(p => ({ ...p, contactPersonEmail: e.target.value }))} />
                        </div>
                      </div>
                      <label className={`flex items-start gap-3 min-h-11 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${momCore.ccClient ? 'border-primary/40 bg-primary/8' : 'border-outline-variant bg-surface-container-low hover:border-primary/30'}`}>
                        <input
                          type="checkbox"
                          checked={momCore.ccClient}
                          onChange={e => {
                            const checked = e.target.checked;
                            setMomCore(p => ({ ...p, ccClient: checked }));
                            if (checked && !momCore.contactPersonEmail.trim()) window.setTimeout(() => clientEmailInputRef.current?.focus(), 0);
                          }}
                          className="h-4 w-4 mt-0.5 accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-body-sm font-semibold text-on-surface">
                            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-primary">priority_high</span>
                            CC client on claim status notifications
                          </span>
                          <span className="block text-xs text-outline mt-1">Important: enable this when the client should receive status updates. Client email becomes required.</span>
                        </span>
                      </label>
                    </section>
                    <section className="pt-6 border-t border-outline-variant space-y-5">
                      <div>
                        <h5 className="font-headline-sm text-on-surface">Meeting classification</h5>
                        <p className="text-body-sm text-outline mt-1">Add the account and reporting details used to categorize this meeting.</p>
                      </div>
                      <DynamicFieldRenderer entity="mom" values={momData} onChange={(key, value) => setMomData(p => ({ ...p, [key]: value }))} excludeKeys={['contact_person_designation']} />
                    </section>
                    <section className="pt-6 border-t border-outline-variant space-y-5">
                      <div>
                        <h5 className="font-headline-sm text-on-surface">Full meeting record</h5>
                        <p className="text-body-sm text-outline mt-1">Capture the discussion first, followed by clear owners and next steps.</p>
                      </div>
                    <div>
                      <Label>Discussion</Label>
                      <textarea
                        rows={6}
                        className="w-full bg-white border border-brand-field-border rounded-input px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                        value={momCore.discussion}
                        onChange={e => setMomCore(p => ({ ...p, discussion: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Action Items</Label>
                      <textarea
                        rows={4}
                        className="w-full bg-white border border-brand-field-border rounded-input px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                        value={momCore.actionItems}
                        onChange={e => setMomCore(p => ({ ...p, actionItems: e.target.value }))}
                        placeholder="List owners, next steps, and target dates."
                      />
                    </div>
                    </section>
                  </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {step === 4 && (
          <Card className="max-w-3xl mx-auto text-center py-12">
            <span className="material-symbols-outlined text-[48px] text-primary mb-4">fact_check</span>
            <h4 className="font-headline-md text-on-surface mb-2">Ready to Submit</h4>
            <p className="text-on-surface-variant mb-6">Review your {claimType} before submission.</p>
            <div className="bg-surface-container p-6 rounded-lg text-left inline-block w-full max-w-md">
              <div className="flex justify-between mb-2"><span className="text-on-surface-variant">Type:</span><span className="font-bold">{claimType}</span></div>
              <div className="flex justify-between mb-2"><span className="text-on-surface-variant">Claimed Amount:</span><span className="font-mono-data font-bold">{formatMoney(totalAmount)}</span></div>
              {(claimType === 'Reimbursement' || claimType === 'Transport Reimbursement') && (
                <div className="flex justify-between mb-2">
                  <span className="text-on-surface-variant">Maximum Reimbursable:</span>
                  <span className="font-mono-data font-bold text-primary">{formatMoney(reimbursableAmount)}</span>
                </div>
              )}
              <div className="flex justify-between mb-2"><span className="text-on-surface-variant">Date Filed:</span><span className="font-mono-data font-bold">{today()}</span></div>
              <div className="flex justify-between"><span className="text-on-surface-variant">Approver:</span><span className="font-bold">{approver?.name || 'Assigned Approver'}</span></div>
              {totalAmount > REIMBURSEMENT_CAP && (claimType === 'Reimbursement' || claimType === 'Transport Reimbursement') && (
                <p className="text-body-sm text-tertiary mt-4 pt-4 border-t border-outline-variant">
                  You may file the full amount, but current policy limits reimbursement to {formatMoney(REIMBURSEMENT_CAP)} per claim.
                </p>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="fixed md:static bottom-0 left-0 w-full md:w-auto bg-surface z-40 p-4 md:p-0 md:mt-8 flex justify-between items-center border-t border-brand-border md:pt-8 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] md:shadow-none">
        <Button variant="outline" className="gap-2" onClick={handleBack}>
          <span className="material-symbols-outlined">arrow_back</span> Back
        </Button>
        <div className="flex gap-4">
          {step > 0 && !liquidationBlocked && <Button variant="ghost" onClick={handleSaveDraft} className="hidden md:inline-flex">Save Draft</Button>}
          {step > 0 && step < 4 && !liquidationBlocked ? (
            <Button
              className="gap-2 px-8"
              onClick={handleNext}
            >
              Next Step <span className="material-symbols-outlined hidden sm:inline-block">arrow_forward</span>
            </Button>
          ) : step === 4 ? (
            <Button className="gap-2 px-8" onClick={handleSubmit} disabled={loading || hasInvalidReimbursementDate}>
              {loading ? <span className="material-symbols-outlined animate-spin">sync</span> : null} Submit <span className="hidden sm:inline-block ml-1">{claimType}</span>
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(dateBlockMessage)}
        onClose={closeDateBlockDialog}
        onConfirm={closeDateBlockDialog}
        title="Claim outside the filing window"
        confirmLabel="Review purchase date"
        variant="warning"
        showCancel={false}
      >
        <p>{dateBlockMessage}</p>
        <p className="mt-3">
          Reimbursement receipts must be dated within {REIMBURSEMENT_FILING_WINDOW_DAYS} days of the filing date. Update the purchase date before continuing.
        </p>
      </ConfirmModal>
    </div>
  );
}

