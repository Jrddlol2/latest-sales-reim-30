import { MomContact } from '../../lib/momContacts';
import { Input, Label } from '../ui/Input';

interface ContactPersonsFieldProps {
  contacts: MomContact[];
  onChange: (contacts: MomContact[]) => void;
}

// A repeatable Name + Designation list. Always keeps at least one row so the
// form never collapses to nothing, and only the first row shows column labels.
export function ContactPersonsField({ contacts, onChange }: ContactPersonsFieldProps) {
  const rows = contacts.length ? contacts : [{ name: '', designation: '' }];

  const update = (index: number, patch: Partial<MomContact>) =>
    onChange(rows.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)));

  const add = () => onChange([...rows, { name: '', designation: '' }]);

  const remove = (index: number) =>
    onChange(rows.length > 1 ? rows.filter((_, i) => i !== index) : [{ name: '', designation: '' }]);

  return (
    <div className="space-y-3">
      {rows.map((contact, index) => (
        <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-3 md:items-end">
          <div>
            {index === 0 && <Label>Contact Person</Label>}
            <Input
              value={contact.name}
              placeholder="Full name"
              aria-label={`Contact person ${index + 1} name`}
              onChange={e => update(index, { name: e.target.value })}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              {index === 0 && <Label>Designation</Label>}
              <Input
                value={contact.designation}
                placeholder="e.g. Procurement Manager"
                aria-label={`Contact person ${index + 1} designation`}
                onChange={e => update(index, { designation: e.target.value })}
              />
            </div>
            <button
              type="button"
              aria-label={`Remove contact person ${index + 1}`}
              onClick={() => remove(index)}
              disabled={rows.length === 1 && !contact.name && !contact.designation}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-btn border border-outline-variant text-outline hover:border-tertiary hover:text-tertiary disabled:opacity-30 disabled:hover:border-outline-variant disabled:hover:text-outline"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        Add another contact person
      </button>
    </div>
  );
}
