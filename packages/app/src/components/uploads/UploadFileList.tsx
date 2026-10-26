import type { ComponentProps } from 'react';
import { FileUpload } from '@b20-ui/components/application/file-upload/file-upload-base';
import './uploads.css';

export type UploadState = 'selected' | 'queued' | 'preparing' | 'uploading' | 'confirming' | 'complete' | 'failed' | 'cancelled';
export interface UploadFileItem {
  id: string;
  name: string;
  size: number;
  type?: string;
  progress: number;
  state: UploadState;
  error?: string;
}

type FileIconType = ComponentProps<typeof FileUpload.ListItemProgressBar>['type'];
function iconType(item: UploadFileItem): FileIconType {
  const extension = item.name.split('.').pop()?.toLowerCase();
  const known: Record<string, FileIconType> = { pdf: 'pdf', png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif',
    svg: 'svg', doc: 'doc', docx: 'docx', xls: 'xls', xlsx: 'xlsx', ppt: 'ppt', pptx: 'pptx', zip: 'zip', txt: 'txt', mp4: 'mp4' };
  return known[extension ?? ''] ?? 'empty';
}

export function UploadFileList({ items, onRemove, onRetry, onCancel, disabled = false }: {
  items: UploadFileItem[];
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  onCancel?: (id: string) => void;
  disabled?: boolean;
}) {
  if (!items.length) return null;
  return <div className="b20-upload"><FileUpload.List aria-label="Archivos adjuntos" className="upload-file-list">
    {items.map((item) => <FileUpload.ListItemProgressBar key={item.id} {...item} type={iconType(item)} isDisabled={disabled}
      onDelete={onRemove ? () => onRemove(item.id) : undefined}
      onRetry={onRetry ? () => onRetry(item.id) : undefined}
      onCancel={onCancel && ['preparing', 'uploading', 'confirming'].includes(item.state) ? () => onCancel(item.id) : undefined} />)}
  </FileUpload.List></div>;
}
