import { useState } from 'react';
import { fileSizeError, formatBytes, MAX_FILE_BYTES, MAX_FILE_MB } from '@b20/core';
import { FileUpload } from '@b20-ui/components/application/file-upload/file-upload-base';
import './uploads/uploads.css';

export interface FilePickerProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  busy?: boolean;
  accept?: string;
  multiple?: boolean;
  maxSize?: number;
  validate?: (file: File) => string | undefined;
  label?: string;
  hint?: string;
  onErrors?: (errors: string[]) => void;
  hideErrors?: boolean;
}

/** El selector y el arrastre usan la misma validación y conservan los archivos reales. */
export function FilePicker({ onFiles, disabled = false, busy = false, accept, multiple = true,
  maxSize = MAX_FILE_BYTES, validate, label = 'Adjuntar archivos', hint, onErrors, hideErrors = false }: FilePickerProps) {
  const [errors, setErrors] = useState<string[]>([]);
  const check = (file: File) => {
    const ownError = validate?.(file);
    if (ownError) return ownError;
    if (!file.size) return `«${file.name}» está vacío.`;
    if (file.size > maxSize) return maxSize === MAX_FILE_BYTES ? fileSizeError(file.name, file.size)
      : `«${file.name}» supera el límite de ${formatBytes(maxSize)}.`;
    if (!file.name.trim() || file.name.length > 200) return 'El nombre del archivo debe tener entre 1 y 200 caracteres.';
    return undefined;
  };
  return <div className="b20-upload file-picker">
    <FileUpload.DropZone className="dropzone" label={label} isDisabled={disabled || busy}
      accept={accept} allowsMultiple={multiple} maxSize={maxSize} validate={check} onDropFiles={onFiles}
      onErrors={(messages) => { setErrors(messages); onErrors?.(messages); }}
      hint={hint ?? `Imágenes y documentos · Hasta ${maxSize === MAX_FILE_BYTES ? `${MAX_FILE_MB} MB` : formatBytes(maxSize)} por archivo`} />
    {!hideErrors && errors.length > 0 && <ul className="upload-errors" role="alert">{errors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>}
  </div>;
}
