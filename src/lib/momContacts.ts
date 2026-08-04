// A meeting can have several client contacts, each with their own designation.
// The server only has a single `contact_person` text column, so the list is
// encoded there as "Name (Designation), Name2 (Designation2)". This keeps the
// existing schema and round-trips cleanly (parse ⇄ serialize).

export interface MomContact {
  name: string;
  designation: string;
}

// Split on commas that are NOT inside parentheses, so a designation like
// "Manager (Finance)" won't be torn apart.
const SPLIT_RE = /,\s*(?![^(]*\))/;
const NAME_DESG_RE = /^(.*?)\s*\(([^)]*)\)\s*$/;

export function parseContacts(raw?: string): MomContact[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(SPLIT_RE)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = part.match(NAME_DESG_RE);
      if (match) return { name: match[1].trim(), designation: match[2].trim() };
      return { name: part, designation: '' };
    });
}

export function serializeContacts(contacts: MomContact[]): string {
  return contacts
    .map(c => ({ name: c.name.trim(), designation: c.designation.trim() }))
    .filter(c => c.name)
    .map(c => (c.designation ? `${c.name} (${c.designation})` : c.name))
    .join(', ');
}

// Reconstruct the contact list from a stored MOM. Legacy records kept a single
// name in `contact_person` and the designation in a separate custom field, so
// fold that in when the encoded string didn't carry a designation itself.
export function contactsFromMom(contactPerson?: string, legacyDesignation?: string): MomContact[] {
  const parsed = parseContacts(contactPerson);
  if (legacyDesignation && parsed.length === 1 && !parsed[0].designation) {
    return [{ name: parsed[0].name, designation: legacyDesignation.trim() }];
  }
  return parsed;
}

// Comma-joined designations, kept in sync into the legacy custom field so
// anything still reading it shows something sensible.
export function joinDesignations(contacts: MomContact[]): string {
  return contacts.map(c => c.designation.trim()).filter(Boolean).join(', ');
}

// One-line display, e.g. "Alice Reyes (Buyer), Bob Santos (CFO)".
export function formatContactsDisplay(contactPerson?: string, legacyDesignation?: string): string {
  return contactsFromMom(contactPerson, legacyDesignation)
    .map(c => (c.designation ? `${c.name} (${c.designation})` : c.name))
    .join(', ');
}
