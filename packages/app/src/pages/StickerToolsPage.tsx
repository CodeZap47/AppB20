import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_STICKERS_PER_PACK } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import { Icon } from '../components/Icon';
import { useAction } from '../components/useAction';
import { memberName } from '../lib/format';
import { prepareStickers, type PreparedStickers } from '../lib/stickerImport';
import { StickerImage } from '../components/StickerImage';
import { FilePicker } from '../components/FilePicker';
import { UploadFileList, type UploadFileItem } from '../components/uploads/UploadFileList';
import { ChatButton } from '../components/messaging/Messaging';
import { ToolPage } from '../components/messaging/ChatToolLayout';
import { StickerHelp } from '../components/messaging/StickerHelp';
import '../components/uploads/consumers.css';

/** Importar paquetes de stickers (de WhatsApp u otros) y decidir cuáles comparte el grupo. */
export function StickersPage() {
  const source = useDataSource();
  const { me, members, stickerPacks, stickers } = useSnapshot();
  const { error, run } = useAction();
  const { error: packError, run: runPack } = useAction();
  const [prepared, setPrepared] = useState<PreparedStickers | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [rows, setRows] = useState<UploadFileItem[]>([]);
  const [stage, setStage] = useState<'preparing' | 'importing'>();
  const working = useRef(false);
  const attempt = useRef<{ name: string; files: File[] } | null>(null);
  const packRequests = useRef(new Set<string>());
  const [busyPacks, setBusyPacks] = useState<ReadonlySet<string>>(new Set());

  const changePack = async (packId: string, action: () => unknown | Promise<unknown>) => {
    if (packRequests.current.has(packId)) return;
    packRequests.current.add(packId);
    setBusyPacks(new Set(packRequests.current));
    try { await runPack(action); }
    finally {
      packRequests.current.delete(packId);
      setBusyPacks(new Set(packRequests.current));
    }
  };

  const take = async (list: File[]) => {
    if (!list.length || working.current || attempt.current) return;
    working.current = true;
    setDone('');
    setPrepared(null);
    setBusy(true);
    setStage('preparing');
    setRows(list.map((file, index) => ({ id: `sticker-${index}`, name: file.name, size: file.size, type: file.type, state: 'preparing', progress: 0 })));
    try {
      const result = await run(() => prepareStickers(list));
      if (result) {
        setPrepared(result);
        setName((current) => current || result.packName || '');
        setRows(result.files.map((file, index) => ({ id: `sticker-${index}`, name: file.name, size: file.size,
          type: file.type, state: 'selected', progress: 0 })));
      } else setRows((current) => current.map((item) => ({ ...item, state: 'failed', error: 'No se pudo preparar este paquete.' })));
    } finally {
      working.current = false;
      setStage(undefined);
      setBusy(false);
    }
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!prepared?.files.length || working.current || (!attempt.current && !name.trim())) return;
    working.current = true;
    attempt.current ??= { name: name.trim(), files: prepared.files };
    const pending = attempt.current;
    setBusy(true);
    setStage('importing');
    setRows((current) => current.map((item) => ({ ...item, state: 'preparing', progress: 0, error: undefined })));
    try {
      const imported = await run(async () => { await source.importStickers(pending.name, pending.files); return true; });
      if (!imported) {
        setRows((current) => current.map((item) => ({ ...item, state: 'failed', error: 'La importación no terminó. Reintenta el paquete completo.' })));
        return;
      }
      const n = pending.files.length;
      setDone(
        `${n === 1 ? 'Se importó 1 sticker' : `Se importaron ${n} stickers`} en «${pending.name}». Por ahora solo tú lo ves.`,
      );
      setRows((current) => current.map((item) => ({ ...item, state: 'complete', progress: 100 })));
      attempt.current = null;
      setPrepared(null);
      setName('');
    } finally {
      working.current = false;
      setStage(undefined);
      setBusy(false);
    }
  };

  const mine = stickerPacks.filter((p) => p.ownerId === me?.id);
  const shared = stickerPacks.filter((p) => p.ownerId !== me?.id);
  const count = (packId: string) => stickers.filter((s) => s.packId === packId).length;
  const cover = (packId: string) => stickers.filter((s) => s.packId === packId).slice(0, 4);

  return (
    <ToolPage
      title="Stickers"
      subtitle="Trae tus stickers de WhatsApp para usarlos en los chats del grupo"
    >
      <section className="panel messaging-tool-panel sticker-import-panel">
        <div className="sticker-section-heading"><span className="sticker-section-icon"><Icon name="upload" /></span><div><h3>Importar un paquete</h3><p>Dale un nombre a tus reacciones favoritas y úsalas en cualquier chat.</p></div><span className="sticker-private-badge"><Icon name="lock" size={13} />Solo tú</span></div>
        <form className="form" onSubmit={(e) => void submit(e)}>
          <div className="b20-upload b20-upload--stickers">
            <FilePicker onFiles={(files) => { void take(files); }} disabled={busy || Boolean(attempt.current)}
              accept=".webp,.png,.gif,.jpg,.jpeg,.wastickers,.zip,image/webp,image/png,image/gif,image/jpeg"
              maxSize={Infinity} label="Importar stickers" hint={`Imágenes WebP, PNG, GIF o JPEG, hasta 1 MiB cada una, o paquetes .wastickers y .zip. Máximo ${MAX_STICKERS_PER_PACK} stickers.`} />
            <UploadFileList items={rows} onRetry={prepared && !busy ? () => { void submit(); } : undefined} />
            {busy && <p role="status">{stage === 'preparing' ? 'Preparando stickers…' : 'Importando stickers…'}</p>}
          </div>
          <div className="sticker-formats" aria-label="Formatos permitidos"><span>WebP</span><span>PNG</span><span>GIF</span><span>JPEG</span><span>.wastickers</span><span>.zip</span></div>

          {prepared && (
            <>
              {prepared.files.length > 0 && (
                <section className="sticker-review" aria-label="Revisar paquete">
                  <div className="sticker-review__heading"><h4>Vista previa</h4><span>{stickerCount(prepared.files.length)} de {MAX_STICKERS_PER_PACK}</span></div>
                  <div className="sticker-preview" aria-label="Stickers listos para importar">
                    {prepared.files.map((f, i) => <figure key={`${f.name}-${i}`}><PreviewImage file={f} /><figcaption>{f.name}</figcaption>{!busy && !attempt.current && <ChatButton variant="tertiary" className="icon-button sticker-preview__remove" aria-label={`Quitar de la selección ${f.name}`} onClick={() => {
                      setPrepared((current) => current ? { ...current, files: current.files.filter((_, index) => index !== i) } : null);
                      setRows((current) => current.filter((_, index) => index !== i));
                    }}><Icon name="close" size={13} /></ChatButton>}</figure>)}
                  </div>
                </section>
              )}
              {prepared.skipped.length > 0 && (
                <ul className="file-picker__rejected" role="alert">
                  {prepared.skipped.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
              {prepared.files.length > 0 && (
                <>
                  <label className="field">
                    <span className="field__label">Nombre del paquete</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Por ejemplo: Reacciones del salón"
                      maxLength={60}
                      required
                      disabled={busy || Boolean(attempt.current)}
                    />
                  </label>
                  <div className="form__actions">
                    <ChatButton
                      type="button"
                      variant="secondary"
                      onClick={() => { setPrepared(null); setRows([]); attempt.current = null; }}
                      disabled={busy}
                    >
                      Descartar
                    </ChatButton>
                    <ChatButton type="submit" loading={busy} disabled={busy || !name.trim()}>
                      {busy
                        ? 'Importando…'
                        : prepared.files.length === 1
                          ? 'Importar 1 sticker'
                          : `Importar ${prepared.files.length} stickers`}
                    </ChatButton>
                  </div>
                </>
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="success" role="status">
              <Icon name="check" size={16} /> {done}
            </p>
          )}
        </form>

      </section>

      <StickerHelp />

      <section className="sticker-library" aria-busy={busyPacks.size > 0}>
        <div className="sticker-library__heading"><h3>Tus paquetes</h3><span>{mine.length}</span></div>
        {packError && <p className="error" role="alert">{packError}</p>}
        {mine.length === 0 ? (
          <div className="sticker-library__empty"><Icon name="smile" size={28} /><strong>Tus stickers, a un clic</strong><p>Importa tu primer paquete para darle vida a las conversaciones.</p></div>
        ) : (
          <ul className="packs">
            {mine.map((p) => (
              <li key={p.id} className="pack">
                <span className="pack__cover" aria-hidden="true">
                  {cover(p.id).map((s) => (
                    <StickerImage key={s.id} id={s.id} size={40} alt="" />
                  ))}
                </span>
                <span className="pack__body">
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {stickerCount(count(p.id))} · {p.shared ? 'Lo ve todo el grupo' : 'Solo tú'}
                  </span>
                </span>
                <span className="pack__actions">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={p.shared}
                      aria-label={`Compartir ${p.name} con el grupo`}
                      disabled={busyPacks.has(p.id)}
                      onChange={(e) => {
                        const shared = e.currentTarget.checked;
                        void changePack(p.id, () => source.setStickerPackShared(p.id, shared));
                      }}
                    />
                    {busyPacks.has(p.id) ? 'Guardando…' : 'Compartir con el grupo'}
                  </label>
                  <ChatButton
                    type="button"
                    variant="tertiary"
                    className="icon-button"
                    aria-label={`Quitar el paquete ${p.name}`}
                    title="Quitar paquete"
                    disabled={busyPacks.has(p.id)}
                    onClick={() => {
                      if (
                        confirm(
                          `¿Quitar «${p.name}»? Los mensajes donde ya se usó seguirán mostrándolo.`,
                        )
                      ) {
                        void changePack(p.id, () => source.removeStickerPack(p.id));
                      }
                    }}
                  >
                    <Icon name="trash" size={18} />
                  </ChatButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {shared.length > 0 && (
        <section className="sticker-library">
          <div className="sticker-library__heading"><h3>Compartidos por el grupo</h3><span>{shared.length}</span></div>
          <ul className="packs">
            {shared.map((p) => (
              <li key={p.id} className="pack">
                <span className="pack__cover" aria-hidden="true">
                  {cover(p.id).map((s) => (
                    <StickerImage key={s.id} id={s.id} size={40} alt="" />
                  ))}
                </span>
                <span className="pack__body">
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {stickerCount(count(p.id))} · de {memberName(members, p.ownerId)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ToolPage>
  );
}

const stickerCount = (n: number) => (n === 1 ? '1 sticker' : `${n} stickers`);

function PreviewImage({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
    setUrl(next);
    return () => { if (next) URL.revokeObjectURL(next); };
  }, [file]);
  return <img src={url} alt={file.name} width={64} height={64} />;
}
