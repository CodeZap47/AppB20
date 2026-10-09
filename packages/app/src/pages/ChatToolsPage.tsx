import { useId, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { commandNameError, MAX_STICKERS_PER_PACK, normalizeCommandName } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { ChatCommand } from '../data/types';
import { Empty } from '../components/Empty';
import { Icon } from '../components/Icon';
import { useAction } from '../components/useAction';
import { memberName } from '../lib/format';
import { prepareStickers, type PreparedStickers } from '../lib/stickerImport';

function ToolHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="thread__header">
      <Link
        to="/m/mensajes/directos"
        className="icon-button thread__back"
        aria-label="Ver todas las conversaciones"
      >
        <Icon name="back" />
      </Link>
      <div className="thread__heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <Link to="/m/mensajes" className="button secondary thread__action">
        Volver al chat
      </Link>
    </header>
  );
}

function ToolPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <>
      <ToolHeader title={title} subtitle={subtitle} />
      <div className="chat-tool">{children}</div>
    </>
  );
}

/** Importar paquetes de stickers (de WhatsApp u otros) y decidir cuáles comparte el grupo. */
export function StickersPage() {
  const source = useDataSource();
  const { me, members, stickerPacks, stickers } = useSnapshot();
  const { error, run } = useAction();
  const inputId = useId();
  const [prepared, setPrepared] = useState<PreparedStickers | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [done, setDone] = useState('');

  const take = async (list: FileList | null) => {
    if (!list?.length) return;
    setDone('');
    setBusy(true);
    try {
      const result = await prepareStickers([...list]);
      setPrepared(result);
      setName((current) => current || result.packName || '');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!prepared?.files.length) return;
    setBusy(true);
    try {
      await source.importStickers(name, prepared.files);
      const n = prepared.files.length;
      setDone(
        `${n === 1 ? 'Se importó 1 sticker' : `Se importaron ${n} stickers`} en «${name.trim()}». Por ahora solo tú lo ves.`,
      );
      setPrepared(null);
      setName('');
    } catch (err) {
      run(() => {
        throw err;
      });
    } finally {
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
      <section className="panel">
        <h3 className="label">Importar un paquete</h3>
        <form className="form" onSubmit={(e) => void submit(e)}>
          <label
            htmlFor={inputId}
            className={['dropzone', over && 'dropzone--over', busy && 'dropzone--disabled']
              .filter(Boolean)
              .join(' ')}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <input
              id={inputId}
              type="file"
              multiple
              className="sr-only"
              accept=".webp,.png,.gif,.jpg,.jpeg,.wastickers,.zip,image/webp,image/png,image/gif,image/jpeg"
              disabled={busy}
              onChange={(e) => {
                void take(e.target.files);
                e.target.value = '';
              }}
            />
            <Icon name="upload" size={24} />
            <strong>Elige o suelta stickers aquí</strong>
            <span className="muted">
              Imágenes .webp, .png o .gif (hasta 1 MB cada una) o un paquete .wastickers. Máximo{' '}
              {MAX_STICKERS_PER_PACK} por paquete.
            </span>
          </label>

          {prepared && (
            <>
              {prepared.files.length > 0 && (
                <div className="sticker-preview" aria-label="Stickers listos para importar">
                  {prepared.files.map((f, i) => (
                    <PreviewImage key={`${f.name}-${i}`} file={f} />
                  ))}
                </div>
              )}
              {prepared.skipped.length > 0 && (
                <ul className="file-picker__rejected">
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
                    />
                  </label>
                  <div className="form__actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setPrepared(null)}
                      disabled={busy}
                    >
                      Descartar
                    </button>
                    <button type="submit" disabled={busy || !name.trim()}>
                      {busy
                        ? 'Importando…'
                        : prepared.files.length === 1
                          ? 'Importar 1 sticker'
                          : `Importar ${prepared.files.length} stickers`}
                    </button>
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

        <details className="howto">
          <summary>¿Cómo saco mis stickers de WhatsApp?</summary>
          <dl>
            <dt>Android</dt>
            <dd>
              Abre la app Archivos y entra a{' '}
              <em>Android › media › com.whatsapp › WhatsApp › Media › WhatsApp Stickers</em>. Ahí
              están como .webp: elige los que quieras desde este celular.
            </dd>
            <dt>Computadora (WhatsApp Web o Escritorio)</dt>
            <dd>
              Abre el chat donde está el sticker, haz clic derecho sobre él y elige «Guardar imagen
              como…». Después suelta los archivos aquí.
            </dd>
            <dt>iPhone</dt>
            <dd>
              WhatsApp no guarda los stickers como archivos en el iPhone. Usa WhatsApp Web en una
              computadora, o un paquete .wastickers.
            </dd>
            <dt>Paquetes .wastickers</dt>
            <dd>
              Son los que exportan las apps para crear stickers. Se importan completos, con su
              nombre.
            </dd>
          </dl>
          <p className="muted">
            Los paquetes empiezan privados. Compártelos con el grupo solo si tienes derecho a
            hacerlo.
          </p>
        </details>
      </section>

      <section>
        <h3 className="label">Tus paquetes</h3>
        {mine.length === 0 ? (
          <p className="muted">Todavía no importas ninguno.</p>
        ) : (
          <ul className="packs">
            {mine.map((p) => (
              <li key={p.id} className="pack">
                <span className="pack__cover" aria-hidden="true">
                  {cover(p.id).map((s) => (
                    <img key={s.id} src={s.url} alt="" width={40} height={40} />
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
                      onChange={(e) =>
                        run(() => source.setStickerPackShared(p.id, e.target.checked))
                      }
                    />
                    Compartir con el grupo
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Quitar el paquete ${p.name}`}
                    title="Quitar paquete"
                    onClick={() => {
                      if (
                        confirm(
                          `¿Quitar «${p.name}»? Los mensajes donde ya se usó seguirán mostrándolo.`,
                        )
                      ) {
                        run(() => source.removeStickerPack(p.id));
                      }
                    }}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {shared.length > 0 && (
        <section>
          <h3 className="label">Compartidos por el grupo</h3>
          <ul className="packs">
            {shared.map((p) => (
              <li key={p.id} className="pack">
                <span className="pack__cover" aria-hidden="true">
                  {cover(p.id).map((s) => (
                    <img key={s.id} src={s.url} alt="" width={40} height={40} />
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
  const [url] = useState(() =>
    typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
  );
  return (
    <img src={url} alt={file.name} width={64} height={64} onLoad={() => URL.revokeObjectURL(url)} />
  );
}

const EMPTY = { name: '', description: '', text: '' };

/** Comandos propios: escribir `/nombre` en cualquier chat inserta su texto. */
export function CommandsPage() {
  const source = useDataSource();
  const { chatCommands } = useSnapshot();
  const { error, run } = useAction();
  const [editing, setEditing] = useState<ChatCommand | null>(null);
  const [form, setForm] = useState(EMPTY);
  const name = normalizeCommandName(form.name);
  const nameProblem = form.name
    ? commandNameError(
        name,
        chatCommands.filter((c) => c.id !== editing?.id).map((c) => c.name),
      )
    : undefined;
  const sorted = [...chatCommands].sort((a, b) => a.name.localeCompare(b.name));

  const startEdit = (command: ChatCommand) => {
    setEditing(command);
    setForm({ name: command.name, description: command.description, text: command.text });
  };

  const reset = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (run(() => source.saveChatCommand({ id: editing?.id, ...form }))) reset();
  };

  return (
    <ToolPage title="Comandos" subtitle="Atajos que escribes con «/» en cualquier chat">
      <section className="panel">
        <h3 className="label">Comandos de la app</h3>
        <ul className="commands">
          <li>
            <code>/tarea</code> <code>/trabajo</code> <code>/clase</code> <code>/nota</code>{' '}
            <code>/pregunta</code>
            <span className="muted">
              Cita algo de los otros módulos. Escribe una palabra después para buscar.
            </span>
          </li>
          <li>
            <code>/sticker</code>
            <span className="muted">Abre tus stickers.</span>
          </li>
          <li>
            <code>/codigo</code>
            <span className="muted">Inserta un bloque de código.</span>
          </li>
        </ul>
      </section>

      <section className="panel">
        <h3 className="label">{editing ? `Editar /${editing.name}` : 'Crear un comando'}</h3>
        <form className="form" onSubmit={submit}>
          <div className="form__grid">
            <label className="field">
              <span className="field__label">Nombre</span>
              <span className="command-input">
                <span aria-hidden="true">/</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="saludo"
                  maxLength={25}
                  required
                  aria-invalid={Boolean(nameProblem)}
                />
              </span>
              <span className={nameProblem ? 'field__hint error' : 'field__hint'}>
                {nameProblem ?? 'Minúsculas, números o guiones, sin espacios.'}
              </span>
            </label>
            <label className="field">
              <span className="field__label">
                Descripción <span className="field__optional">opcional</span>
              </span>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Para qué sirve"
                maxLength={80}
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Texto que inserta</span>
            <textarea
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              rows={4}
              maxLength={2000}
              required
            />
            <span className="field__hint">
              Puedes incluir enlaces o código. Después de insertarlo puedes editarlo antes de
              enviar.
            </span>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form__actions">
            {editing && (
              <button type="button" className="secondary" onClick={reset}>
                Cancelar
              </button>
            )}
            <button
              type="submit"
              disabled={!form.name || !form.text.trim() || Boolean(nameProblem)}
            >
              {editing ? 'Guardar cambios' : 'Crear comando'}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h3 className="label">Tus comandos</h3>
        {sorted.length === 0 ? (
          <Empty icon="chat" title="Todavía no tienes comandos">
            Crea uno para lo que escribes seguido: un saludo, el enlace del repositorio del equipo o
            una plantilla.
          </Empty>
        ) : (
          <ul className="packs">
            {sorted.map((c) => (
              <li key={c.id} className="pack">
                <span className="pack__body">
                  <strong>
                    <code>/{c.name}</code>{' '}
                    {c.description && <span className="muted">· {c.description}</span>}
                  </strong>
                  <span className="pack__text">{c.text}</span>
                </span>
                <span className="pack__actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Editar /${c.name}`}
                    onClick={() => startEdit(c)}
                  >
                    <Icon name="edit" size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Borrar /${c.name}`}
                    onClick={() => {
                      if (confirm(`¿Borrar /${c.name}?`)) {
                        run(() => source.removeChatCommand(c.id));
                        if (editing?.id === c.id) reset();
                      }
                    }}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ToolPage>
  );
}
