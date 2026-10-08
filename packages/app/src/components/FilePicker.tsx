import { useId, useState, type DragEvent } from 'react';
import { fileSizeError, MAX_FILE_MB } from '@b20/core';
import { Icon } from './Icon';

/**
 * Zona para elegir o soltar archivos. Entrega solo los que caben en el límite de 50 MB y
 * explica por qué descartó los demás, antes de intentar subirlos.
 */
export function FilePicker({
  onFiles,
  disabled = false,
  busy = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Hay una subida en curso. */
  busy?: boolean;
}) {
  const hintId = useId();
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const blocked = disabled || busy;

  const take = (list: FileList | null) => {
    const accepted: File[] = [];
    const problems: string[] = [];
    for (const file of list ?? []) {
      const problem = fileSizeError(file.name, file.size);
      if (problem) problems.push(problem);
      else accepted.push(file);
    }
    setRejected(problems);
    if (accepted.length) onFiles(accepted);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!blocked) take(e.dataTransfer.files);
  };

  return (
    <div className="file-picker">
      <label
        className={['dropzone', over && 'dropzone--over', blocked && 'dropzone--disabled']
          .filter(Boolean)
          .join(' ')}
        onDragOver={(e) => {
          e.preventDefault();
          if (!blocked) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          multiple
          className="sr-only"
          disabled={blocked}
          aria-describedby={hintId}
          onChange={(e) => {
            take(e.target.files);
            // Permite volver a elegir el mismo archivo después de quitarlo.
            e.target.value = '';
          }}
        />
        <Icon name="upload" size={22} />
        <span>
          <strong>{busy ? 'Subiendo…' : 'Elige archivos'}</strong>
          {!busy && <span className="dropzone__drag"> o suéltalos aquí</span>}
          <span className="dropzone__hint" id={hintId}>
            Hasta {MAX_FILE_MB} MB por archivo
          </span>
        </span>
      </label>
      {rejected.length > 0 && (
        <ul className="file-picker__errors error" role="alert">
          {rejected.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
