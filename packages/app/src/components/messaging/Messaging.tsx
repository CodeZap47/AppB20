import type { ComponentProps, ComponentPropsWithRef } from 'react';
import { TextField } from 'react-aria-components';
import { Avatar } from '@b20-ui/components/base/avatar/avatar';
import { Button, type ButtonProps } from '@b20-ui/components/base/buttons/button';
import { TextAreaBase } from '@b20-ui/components/base/textarea/textarea';
import { initials } from '../../lib/format';

/** Presentation shared by conversations and study rooms; their permissions stay with callers. */
export function ChatAvatar({ name, src, size = 'sm', className = '' }: {
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  return <Avatar size={size} src={src} initials={initials(name)} alt="" className={`messaging-avatar ${className}`} />;
}

export function ChatBubble({ className = '', ...props }: ComponentProps<'div'>) {
  return <div {...props} className={`bubble messaging-bubble ${className}`} />;
}

/** Retains native events and refs for drafts, IME, shortcuts and automatic height. */
export function ChatTextArea({ disabled, required, className = '', ...props }: ComponentPropsWithRef<'textarea'>) {
  return (
    <TextField
      className="messaging-text-field"
      aria-label={props['aria-label'] ?? props.placeholder ?? 'Mensaje'}
      isDisabled={disabled}
      isRequired={required}
    >
      <TextAreaBase {...props} disabled={disabled} required={required} className={`messaging-textarea resize-none ${className}`} />
    </TextField>
  );
}

export function ChatButton({ variant = 'primary', loading = false, disabled, type = 'button', className = '', ...props }:
  Omit<ButtonProps, 'color' | 'size' | 'isDisabled' | 'isLoading'> & {
    disabled?: boolean;
    title?: string;
    variant?: 'primary' | 'secondary' | 'tertiary' | 'danger';
    loading?: boolean;
  }) {
  return (
    <Button
      {...props}
      type={type}
      color={variant === 'danger' ? 'primary-destructive' : variant}
      size="sm"
      isDisabled={disabled || loading}
      isLoading={loading}
      showTextWhileLoading
      className={`messaging-button messaging-button--${variant} ${className}`}
    />
  );
}
