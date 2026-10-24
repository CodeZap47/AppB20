import { useEffect, useId, useState, type ComponentPropsWithRef } from 'react';
import { Eye, EyeOff } from '@untitledui/icons';
import './PasswordField.css';

type PasswordFieldProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'className' | 'value'> & {
  label: string;
  value: string;
  className?: string;
  visibilityLabel?: string;
};

/** Campo controlado; solo conserva la visibilidad mientras permanece montado. */
export function PasswordField({ label, value, className, visibilityLabel = 'contraseña', id, disabled, ...inputProps }: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!value) setVisible(false); }, [value]);
  const action = `${visible ? 'Ocultar' : 'Mostrar'} ${visibilityLabel}`;
  const VisibilityIcon = visible ? EyeOff : Eye;

  return <div className={['password-field', className].filter(Boolean).join(' ')}>
    <label htmlFor={inputId}>{label}</label>
    <div className="password-field__control">
      <input autoCapitalize="none" autoCorrect="off" spellCheck={false} {...inputProps}
        id={inputId} className="password-field__input" type={visible ? 'text' : 'password'} value={value} disabled={disabled} />
      <button type="button" className="password-field__toggle" aria-label={action} title={action} aria-controls={inputId}
        disabled={disabled} onClick={() => setVisible((current) => !current)}>
        <VisibilityIcon width={20} height={20} aria-hidden="true" focusable="false" />
      </button>
    </div>
  </div>;
}
