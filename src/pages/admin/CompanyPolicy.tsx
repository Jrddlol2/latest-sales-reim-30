import { useState, useMemo } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { updateAdminSettings } from '../../lib/api';
import { EXPENSE_CATEGORIES } from '../../lib/expenseCategories';
import { formatMoney } from '../../lib/money';

/**
 * Company Policy — admins set the maximum a requestor can spend on a single
 * expense line item, per category (e.g. Meals ≤ ₱2,000). The claim and
 * liquidation submit routes enforce these caps server-side; the Submit Claim
 * form also warns as the requestor types. A blank/zero limit means "no cap".
 */
export function CompanyPolicy() {
  const { categoryLimits, highValueThreshold, refresh } = useAppContext();
  const { addToast } = useToast();

  // Local editable copy — string-keyed so an empty field reads as "no cap".
  const [limits, setLimits] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    EXPENSE_CATEGORIES.forEach(c => { seed[c] = categoryLimits[c] ? String(categoryLimits[c]) : ''; });
    return seed;
  });
  const [threshold, setThreshold] = useState<string>(String(highValueThreshold || ''));
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    const thresholdChanged = (Number(threshold) || 0) !== (highValueThreshold || 0);
    const limitsChanged = EXPENSE_CATEGORIES.some(c => (Number(limits[c]) || 0) !== (categoryLimits[c] || 0));
    return thresholdChanged || limitsChanged;
  }, [limits, threshold, categoryLimits, highValueThreshold]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const categoryLimitsPayload: Record<string, number> = {};
      EXPENSE_CATEGORIES.forEach(c => {
        const n = Number(limits[c]);
        if (Number.isFinite(n) && n > 0) categoryLimitsPayload[c] = n;
      });
      const body: Record<string, unknown> = { categoryLimits: categoryLimitsPayload };
      const t = Number(threshold);
      if (Number.isFinite(t) && t > 0) body.highValueThreshold = t;
      await updateAdminSettings(body);
      await refresh();
      addToast('Company policy updated.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not save the policy.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">System Administration</span>
          <h1 className="font-display text-display text-on-surface mt-1">Company Policy</h1>
          <p className="text-body-md text-outline mt-1 max-w-2xl">
            Set the most a requestor may spend on a single expense line, per category. Claims and
            liquidations that exceed a cap are blocked at submission. Leave a field blank for no limit.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || !dirty} className="gap-2">
          {saving ? <span className="material-symbols-outlined animate-spin text-[18px]">sync</span> : <span className="material-symbols-outlined text-[18px]">save</span>}
          Save Policy
        </Button>
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <h3 className="font-label-md uppercase tracking-wider text-on-surface">Per-Category Spending Limits</h3>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Max per line item (₱)</th>
                <th className="px-6 py-4">Current policy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {EXPENSE_CATEGORIES.map(cat => (
                <tr key={cat} className="hover:bg-primary-container/5 transition-colors">
                  <td className="px-6 py-4 font-label-md text-on-surface">{cat}</td>
                  <td className="px-6 py-4">
                    <div className="relative max-w-[200px]">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant">₱</span>
                      <Input
                        type="number"
                        min="0"
                        className="pl-6"
                        placeholder="No limit"
                        value={limits[cat]}
                        onChange={e => setLimits(p => ({ ...p, [cat]: e.target.value }))}
                      />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-on-surface-variant text-sm">
                    {categoryLimits[cat] ? formatMoney(categoryLimits[cat]) : <span className="text-outline">No limit</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <h3 className="font-label-md uppercase tracking-wider text-on-surface">High-Value Flag</h3>
        </CardHeader>
        <div className="p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="font-label-md text-on-surface">Flag line items above</p>
            <p className="text-body-sm text-outline">Claims with a line over this amount are marked <span className="font-semibold">High Value</span> for extra scrutiny (not blocked).</p>
          </div>
          <div className="relative max-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant">₱</span>
            <Input type="number" min="0" className="pl-6" value={threshold} onChange={e => setThreshold(e.target.value)} />
          </div>
        </div>
      </Card>
    </div>
  );
}
