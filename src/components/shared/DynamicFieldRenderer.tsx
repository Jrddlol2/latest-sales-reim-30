import { useAppContext } from '../AppContext';
import { Input, Select, Label } from '../ui/Input';
import { FieldDefinitionEntity, ClaimType } from '../../types';

interface DynamicFieldRendererProps {
  entity: FieldDefinitionEntity;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  errors?: Record<string, string>;
  claimType?: ClaimType;
  includeKeys?: string[];
  excludeKeys?: string[];
  containerClassName?: string;
}

export function DynamicFieldRenderer({ entity, values, onChange, errors = {}, claimType, includeKeys, excludeKeys, containerClassName }: DynamicFieldRendererProps) {
  const { fieldDefinitions, masterData } = useAppContext();

  const activeFields = fieldDefinitions
    .filter(fd => fd.entity === entity && fd.active)
    .filter(fd => !includeKeys || includeKeys.includes(fd.key))
    .filter(fd => !excludeKeys?.includes(fd.key))
    .filter(fd => {
      if (!claimType) return true; // Only apply extra filter if claimType is provided
      // If provided, require that it either applies to all types (empty array/undefined) or includes this type
      return !fd.applicableClaimTypes || fd.applicableClaimTypes.length === 0 || fd.applicableClaimTypes.includes(claimType);
    })
    .sort((a, b) => a.display_order - b.display_order);

  if (activeFields.length === 0) {
    return null;
  }

  return (
    <div className={containerClassName || "grid grid-cols-1 md:grid-cols-2 gap-6 w-full"}>
      {activeFields.map(fd => {
        const options = fd.master_data_entity 
          ? masterData.filter(m => m.type === fd.master_data_entity && m.active).map(m => m.name)
          : fd.options || [];
        const fieldId = `dynamic-${entity}-${fd.key}`.replace(/[^a-zA-Z0-9_-]/g, '-');
        const errorId = `${fieldId}-error`;
        const accessibilityProps = {
          id: fieldId,
          'aria-invalid': Boolean(errors[fd.key]),
          'aria-describedby': errors[fd.key] ? errorId : undefined,
          required: fd.required,
        };
        
        return (
          <div key={fd.id} className={fd.input_type === 'textarea' ? "md:col-span-2" : ""}>
            <Label htmlFor={fieldId} required={fd.required}>{fd.label}</Label>
            {fd.input_type === 'dropdown' ? (
              <Select 
                {...accessibilityProps}
                value={values[fd.key] || ''} 
                onChange={e => onChange(fd.key, e.target.value)}
                className={errors[fd.key] ? 'border-error' : ''}
              >
                <option value="">Select...</option>
                {options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                {fd.allow_other && <option value="Other">Other (Specify)</option>}
              </Select>
            ) : fd.input_type === 'textarea' ? (
              <textarea 
                {...accessibilityProps}
                className={`w-full bg-white border ${errors[fd.key] ? 'border-error' : 'border-brand-field-border'} rounded-input px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none`}
                rows={3}
                value={values[fd.key] || ''} 
                onChange={e => onChange(fd.key, e.target.value)} 
              />
            ) : (
              // Type/format enforcement lives in the submitting form via
              // validateDynamicFields(); this input only paints the error state
              // it's handed through `errors`.
              <Input
                {...accessibilityProps}
                type={fd.input_type} 
                value={values[fd.key] || ''} 
                onChange={e => onChange(fd.key, e.target.value)} 
                className={errors[fd.key] ? 'border-error' : ''}
              />
            )}
            {errors[fd.key] && (
              <p id={errorId} role="alert" className="text-error text-xs mt-1">{errors[fd.key]}</p>
            )}
          </div>
        )
      })}
    </div>
  );
}
