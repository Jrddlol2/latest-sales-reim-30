import { useAppContext } from '../AppContext';
import { Input, Select, Label } from '../ui/Input';
import { FieldDefinitionEntity, ClaimType } from '../../types';

interface DynamicFieldRendererProps {
  entity: FieldDefinitionEntity;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  errors?: Record<string, string>;
  claimType?: ClaimType;
}

export function DynamicFieldRenderer({ entity, values, onChange, errors = {}, claimType }: DynamicFieldRendererProps) {
  const { fieldDefinitions, masterData } = useAppContext();

  const activeFields = fieldDefinitions
    .filter(fd => fd.entity === entity && fd.active)
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
      {activeFields.map(fd => {
        const options = fd.master_data_entity 
          ? masterData.filter(m => m.type === fd.master_data_entity && m.active).map(m => m.name)
          : fd.options || [];
        
        return (
          <div key={fd.id} className={fd.input_type === 'textarea' ? "md:col-span-2" : ""}>
            <Label required={fd.required}>{fd.label}</Label>
            {fd.input_type === 'dropdown' ? (
              <Select 
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
                className={`w-full bg-white border ${errors[fd.key] ? 'border-error' : 'border-[#CBD5E1]'} rounded-[6px] px-4 py-2.5 text-body-base focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none`}
                rows={3}
                value={values[fd.key] || ''} 
                onChange={e => onChange(fd.key, e.target.value)} 
              />
            ) : (
              // TODO: validation not enforced yet
              <Input 
                type={fd.input_type} 
                value={values[fd.key] || ''} 
                onChange={e => onChange(fd.key, e.target.value)} 
                className={errors[fd.key] ? 'border-error' : ''}
              />
            )}
            {errors[fd.key] && (
              <p className="text-error text-xs mt-1">{errors[fd.key]}</p>
            )}
          </div>
        )
      })}
    </div>
  );
}
