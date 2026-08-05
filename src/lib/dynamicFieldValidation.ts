import { FieldDefinition } from '../types';

export interface DynamicFieldError {
  key: string;
  label: string;
  message: string;
}

export interface DynamicFieldValidationResult {
  /** Per-field error map, suitable for DynamicFieldRenderer's `errors` prop. */
  errors: Record<string, string>;
  /** First error in field order, for a single toast. `null` when all pass. */
  firstError: DynamicFieldError | null;
}

/**
 * Validates user-entered values against a set of *active* dynamic field
 * definitions. This is the enforcement that DynamicFieldRenderer's inputs
 * intentionally leave to the submitting form (the renderer only paints error
 * state it's handed).
 *
 * It checks, in order per field:
 *  1. required-ness (empty required field → error),
 *  2. the field's `input_type` — `number` must parse to a finite number,
 *     `date` must be a real `YYYY-MM-DD` calendar date, and
 *  3. any optional `validation` constraints on the definition
 *     (`min`/`max` for numbers, `minLength`/`maxLength`/`pattern` for text),
 *     which were previously modelled on FieldDefinition but never applied.
 *
 * Callers should pass the fields already filtered to what's actually shown
 * (same `entity`/`active`/`applicableClaimTypes`/exclude filter the matching
 * DynamicFieldRenderer uses) so validation never blocks a user on a field the
 * form doesn't render.
 */
export function validateDynamicFields(
  fields: FieldDefinition[],
  values: Record<string, string>,
): DynamicFieldValidationResult {
  const errors: Record<string, string> = {};
  let firstError: DynamicFieldError | null = null;

  const fail = (fd: FieldDefinition, message: string) => {
    if (errors[fd.key]) return; // one message per field; keep the first
    errors[fd.key] = message;
    if (!firstError) firstError = { key: fd.key, label: fd.label, message };
  };

  for (const fd of fields) {
    const value = (values[fd.key] ?? '').trim();

    if (value === '') {
      if (fd.required) fail(fd, `${fd.label} is required.`);
      continue; // optional-and-empty has nothing left to validate
    }

    if (fd.input_type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        fail(fd, `${fd.label} must be a number.`);
        continue;
      }
      if (fd.validation?.min !== undefined && n < fd.validation.min) {
        fail(fd, `${fd.label} must be at least ${fd.validation.min}.`);
        continue;
      }
      if (fd.validation?.max !== undefined && n > fd.validation.max) {
        fail(fd, `${fd.label} must be at most ${fd.validation.max}.`);
        continue;
      }
    } else if (fd.input_type === 'date') {
      // Native <input type="date"> yields YYYY-MM-DD. Reject anything else, and
      // anything that isn't a real calendar date — note the Date constructor
      // silently *rolls over* impossible days (2026-02-30 → Mar 2), so we
      // round-trip the parsed components back and require they match.
      const shaped = /^\d{4}-\d{2}-\d{2}$/.test(value);
      let validDate = false;
      if (shaped) {
        const [y, m, d] = value.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        validDate = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
      }
      if (!validDate) {
        fail(fd, `${fd.label} must be a valid date.`);
        continue;
      }
    }

    // Length/pattern constraints apply to any text-bearing value.
    if (fd.validation?.minLength !== undefined && value.length < fd.validation.minLength) {
      fail(fd, `${fd.label} must be at least ${fd.validation.minLength} characters.`);
      continue;
    }
    if (fd.validation?.maxLength !== undefined && value.length > fd.validation.maxLength) {
      fail(fd, `${fd.label} must be at most ${fd.validation.maxLength} characters.`);
      continue;
    }
    if (fd.validation?.pattern) {
      let re: RegExp | null = null;
      try {
        re = new RegExp(fd.validation.pattern);
      } catch {
        re = null; // a mis-configured pattern must not hard-block the user
      }
      if (re && !re.test(value)) {
        fail(fd, `${fd.label} is not in the expected format.`);
        continue;
      }
    }
  }

  return { errors, firstError };
}
