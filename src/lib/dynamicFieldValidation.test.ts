import { describe, it, expect } from 'vitest';
import { validateDynamicFields } from './dynamicFieldValidation';
import { FieldDefinition } from '../types';

function field(partial: Partial<FieldDefinition> & Pick<FieldDefinition, 'key' | 'input_type'>): FieldDefinition {
  return {
    id: partial.key,
    entity: 'claim',
    label: partial.key,
    required: false,
    active: true,
    display_order: 0,
    ...partial,
  } as FieldDefinition;
}

describe('validateDynamicFields', () => {
  it('passes when every field is valid or optional-and-empty', () => {
    const fields = [
      field({ key: 'name', input_type: 'text', required: true }),
      field({ key: 'note', input_type: 'text' }),
      field({ key: 'qty', input_type: 'number' }),
    ];
    const { errors, firstError } = validateDynamicFields(fields, { name: 'Ada', qty: '3' });
    expect(firstError).toBeNull();
    expect(errors).toEqual({});
  });

  it('flags an empty required field and reports it as the first error', () => {
    const fields = [field({ key: 'ref', label: 'Reference', input_type: 'text', required: true })];
    const { errors, firstError } = validateDynamicFields(fields, { ref: '   ' });
    expect(errors.ref).toBe('Reference is required.');
    expect(firstError?.key).toBe('ref');
  });

  it('does not flag an empty optional field', () => {
    const fields = [field({ key: 'note', input_type: 'number' })];
    const { firstError } = validateDynamicFields(fields, {});
    expect(firstError).toBeNull();
  });

  it('rejects a non-numeric value in a number field', () => {
    const fields = [field({ key: 'qty', label: 'Quantity', input_type: 'number' })];
    const { errors } = validateDynamicFields(fields, { qty: 'abc' });
    expect(errors.qty).toBe('Quantity must be a number.');
  });

  it('enforces numeric min/max bounds', () => {
    const fields = [field({ key: 'qty', label: 'Quantity', input_type: 'number', validation: { min: 1, max: 10 } })];
    expect(validateDynamicFields(fields, { qty: '0' }).errors.qty).toBe('Quantity must be at least 1.');
    expect(validateDynamicFields(fields, { qty: '11' }).errors.qty).toBe('Quantity must be at most 10.');
    expect(validateDynamicFields(fields, { qty: '5' }).firstError).toBeNull();
  });

  it('rejects impossible or malformed dates but accepts a real one', () => {
    const fields = [field({ key: 'd', label: 'Date', input_type: 'date' })];
    expect(validateDynamicFields(fields, { d: '2026-02-30' }).errors.d).toBe('Date must be a valid date.');
    expect(validateDynamicFields(fields, { d: '02/30/2026' }).errors.d).toBe('Date must be a valid date.');
    expect(validateDynamicFields(fields, { d: '2026-08-05' }).firstError).toBeNull();
  });

  it('enforces text length and pattern constraints', () => {
    const short = [field({ key: 't', label: 'Code', input_type: 'text', validation: { minLength: 3 } })];
    expect(validateDynamicFields(short, { t: 'ab' }).errors.t).toBe('Code must be at least 3 characters.');

    const pat = [field({ key: 't', label: 'Code', input_type: 'text', validation: { pattern: '^[A-Z]+$' } })];
    expect(validateDynamicFields(pat, { t: 'abc' }).errors.t).toBe('Code is not in the expected format.');
    expect(validateDynamicFields(pat, { t: 'ABC' }).firstError).toBeNull();
  });

  it('ignores a mis-configured regex pattern instead of blocking the user', () => {
    const fields = [field({ key: 't', input_type: 'text', validation: { pattern: '([' } })];
    expect(validateDynamicFields(fields, { t: 'anything' }).firstError).toBeNull();
  });
});
