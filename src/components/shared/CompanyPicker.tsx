import { useMemo, useRef, useState } from 'react';
import { Input } from '../ui/Input';
import { Company } from '../../types';
import { findExactMatch, findSimilarCompanies } from '../../lib/companyMatch';

interface CompanyPickerProps {
  id?: string;
  value: string;
  companies: Company[];
  /** Fires when the requestor picks an existing (or near-exact) directory
   *  entry — the caller applies its own defaults-from-company logic (each
   *  form prefills different fields from the record), same as it already
   *  does for the old <Select>. */
  onSelectExisting: (company: Company) => void;
  /** Fires on every keystroke that isn't a click on a suggestion — plain
   *  free-text entry, same as the old <Input onChange>. */
  onChangeText: (name: string) => void;
  placeholder?: string;
}

/**
 * Replaces the old "Choose from directory" <Select> / "Type a new company"
 * <Input> toggle with one always-editable field that live-suggests existing
 * companies as the requestor types — the actual fix for the duplicate-company
 * problem (e.g. "Meralco" / "Meralco Inc." / "MERALCO" ending up as three
 * separate directory rows). An unmatched name is still allowed through: it
 * becomes a new company, immediately usable, marked "Pending review" —
 * matching Company Directory's own badge wording — server-side (see
 * getOrCreateCompany() in server.ts). This component's job
 * is only to steer the requestor onto an existing match *before* that
 * happens, not to block them if it's genuinely new.
 */
export function CompanyPicker({ id, value, companies, onSelectExisting, onChangeText, placeholder }: CompanyPickerProps) {
  const [focused, setFocused] = useState(false);
  const blurTimeout = useRef<number | null>(null);

  const exactMatch = useMemo(() => findExactMatch(value, companies), [value, companies]);
  // An exact-after-normalization match that isn't already the literal
  // selected value is worth surfacing ("you typed 'meralco', did you mean
  // the existing 'Meralco'?"); if it's already identical there's nothing to
  // suggest.
  const showExactSuggestion = exactMatch && exactMatch.name !== value;
  const similar = useMemo(
    () => (showExactSuggestion ? [] : findSimilarCompanies(value, companies)),
    [value, companies, showExactSuggestion]
  );
  const trimmed = value.trim();
  const showAddNew = focused && trimmed.length >= 2 && !exactMatch;
  const showDropdown = focused && trimmed.length >= 2 && (showExactSuggestion || similar.length > 0 || showAddNew);

  const select = (company: Company) => {
    if (blurTimeout.current) window.clearTimeout(blurTimeout.current);
    onSelectExisting(company);
    setFocused(false);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder || 'Type a company name...'}
        onChange={e => onChangeText(e.target.value)}
        onFocus={() => setFocused(true)}
        // Delay the blur-hide so a click on a suggestion registers first —
        // onMouseDown on the option below also cancels this outright.
        onBlur={() => { blurTimeout.current = window.setTimeout(() => setFocused(false), 150); }}
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {showDropdown && (
        <div className="absolute z-20 mt-1 w-full rounded-input border border-outline-variant bg-white shadow-lg overflow-hidden">
          {showExactSuggestion && (
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); select(exactMatch); }}
              className="w-full text-left px-4 py-2.5 hover:bg-primary/5 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px] text-primary">domain</span>
              <span className="text-body-sm">
                Use existing: <span className="font-semibold text-on-surface">{exactMatch.name}</span>
              </span>
            </button>
          )}
          {similar.length > 0 && (
            <div className={showExactSuggestion ? 'border-t border-outline-variant' : ''}>
              <p className="px-4 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-outline">Did you mean?</p>
              {similar.map(match => (
                <button
                  key={match.company.id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); select(match.company); }}
                  className="w-full text-left px-4 py-2 hover:bg-primary/5 flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px] text-outline">domain</span>
                  <span className="text-body-sm text-on-surface">{match.company.name}</span>
                </button>
              ))}
            </div>
          )}
          {showAddNew && (
            <div className={`px-4 py-2.5 text-xs text-outline ${showExactSuggestion || similar.length > 0 ? 'border-t border-outline-variant bg-surface-container-low' : ''}`}>
              <span className="material-symbols-outlined text-[14px] align-middle mr-1">add_circle</span>
              No match found — <span className="font-semibold text-on-surface">"{trimmed}"</span> will be added as a new
              company when you save, marked "Pending review" for an admin to check.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
