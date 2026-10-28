import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { DEFAULT_PROFILE_COVER, PROFILE_COVER_PRESETS, profileCoverGradient } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { MemberProfile, MemberProfileInput, ProfileCover as Cover } from '../data/communityTypes';
import type { Id, Member } from '../data/types';
import { cleanMemberProfile, profileImageError, profileList, PROFILE_PHOTO_MAX_BYTES } from '../lib/profiles';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { useAction } from './useAction';
import { FilePicker } from './FilePicker';
import { UploadFileList, type UploadFileItem } from './uploads/UploadFileList';
import './uploads/consumers.css';

/** La foto no es una URL pública ni se descarga al recibir los metadatos del perfil. */
export function ProfilePhoto({ member, profile, size = 88 }: { member: Member; profile?: MemberProfile; size?: number }) {
  const source = useDataSource();
  const { me } = useSnapshot();
  const [loaded, setLoaded] = useState<{ key: string; url: string }>();
  const { error, pending, run } = useAction();
  const key = `${me?.id}:${member.id}:${profile?.photoFileId ?? ''}`;
  useEffect(() => () => { if (loaded) URL.revokeObjectURL(loaded.url); }, [loaded]);
  const load = async () => {
    const fileId = profile?.photoFileId;
    if (!fileId) return;
    const blob = await run(() => source.downloadResourceFile(fileId));
    if (!blob || source.getSnapshot().me?.id !== me?.id) return;
    setLoaded({ key, url: URL.createObjectURL(blob) });
  };
  return <div>
    {loaded?.key === key
      ? <img className="avatar" src={loaded.url} alt={`Foto de ${member.displayName}`} width={size} height={size} />
      : <Avatar member={{ ...member, photoUrl: undefined }} size={size} />}
    {profile?.photoFileId && loaded?.key !== key && <button className="link-button" type="button" aria-label={`${pending ? 'Cargando' : 'Ver'} foto de ${member.displayName}`} disabled={pending} onClick={load}>{pending ? 'Cargando foto…' : 'Ver foto'}</button>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

/** Descarga una imagen privada del perfil y la expone como URL temporal mientras se use. */
function useResourceImage(fileId?: Id): string | undefined {
  const source = useDataSource();
  const [loaded, setLoaded] = useState<{ fileId: Id; url: string }>();
  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let url: string | undefined;
    source.downloadResourceFile(fileId).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setLoaded({ fileId, url });
    }, () => {
      // Sin la imagen se queda el degradado; no interrumpe el perfil.
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, source]);
  return fileId && loaded?.fileId === fileId ? loaded.url : undefined;
}

/** Vista previa local de un archivo elegido, sin subirlo. */
function useFileUrl(file?: File): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) { setUrl(undefined); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/** Portada del perfil: la imagen vigente si la hay; mientras carga, o sin ella, el degradado elegido. */
export function ProfileCover({ cover, imageUrl, className = 'profile-cover' }: { cover?: Cover; imageUrl?: string; className?: string }) {
  const downloaded = useResourceImage(imageUrl ? undefined : cover?.fileId);
  const url = imageUrl ?? downloaded;
  return <div className={className} aria-hidden="true" style={{ backgroundImage: url ? `url("${url}")` : profileCoverGradient(cover?.preset) }} />;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="profile-editor__section">
      <header>
        <h3>{title}</h3>
        {description && <p className="muted">{description}</p>}
      </header>
      <div className="profile-editor__fields">{children}</div>
    </section>
  );
}

/** Etiquetas cortas: Enter o coma agrega, ✕ quita y Retroceso con el campo vacío borra la última. */
function TagField({ label, placeholder, values, onChange, max = 20 }: { label: string; placeholder: string; values: string[]; onChange: (values: string[]) => void; max?: number }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const commit = () => {
    if (!draft.trim()) return;
    onChange(profileList([...values, draft].join(',')).slice(0, max));
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="tag-field">
        {values.map((value) => (
          <span key={value} className="tag-field__tag">
            {value}
            <button type="button" aria-label={`Quitar ${value}`} onClick={() => onChange(values.filter((entry) => entry !== value))}>
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={values.length >= max ? `Máximo ${max}` : placeholder}
          disabled={values.length >= max}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

function CountedLabel({ htmlFor, label, length, max }: { htmlFor: string; label: string; length: number; max: number }) {
  return (
    <span className="profile-editor__label-row">
      <label className="field__label" htmlFor={htmlFor}>{label}</label>
      <span className={`profile-editor__count${length > max ? ' profile-editor__count--over' : ''}`}>{length}/{max}</span>
    </span>
  );
}

/** Editor de la presentación, la foto y la portada en una ventana modal con vista previa. */
export function ProfileEditor({ member, profile, onDone }: { member: Member; profile?: MemberProfile; onDone: () => void }) {
  const source = useDataSource();
  const { subjects } = useSnapshot();
  const { error, pending, run } = useAction();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const saved = useRef<{ id: Id; version: number; metadataKey: string; photoFile?: File; photoId?: Id;
    coverFile?: File; coverId?: Id; coverKey?: string;
    photoAttempt?: { file: File; expectedVersion: number }; coverAttempt?: { file: File; expectedVersion: number } } | null>(null);
  const nameId = useId();
  const bioId = useId();
  const goalsId = useId();

  const [initial] = useState(() => ({
    preferredName: profile?.preferredName ?? '',
    bio: profile?.bio ?? '',
    interests: profile?.interests ?? [],
    learningGoals: profile?.learningGoals ?? '',
    skills: profile?.skills ?? [],
    helpTopics: profile?.helpTopics ?? [],
    portfolio: profile?.portfolioLinks.length ? profile.portfolioLinks : [''],
    subjectIds: profile?.subjectIds ?? [],
    coverPreset: profile?.cover?.preset ?? DEFAULT_PROFILE_COVER,
  }));
  const [preferredName, setPreferredName] = useState(initial.preferredName);
  const [bio, setBio] = useState(initial.bio);
  const [interests, setInterests] = useState(initial.interests);
  const [learningGoals, setLearningGoals] = useState(initial.learningGoals);
  const [skills, setSkills] = useState(initial.skills);
  const [helpTopics, setHelpTopics] = useState(initial.helpTopics);
  const [portfolio, setPortfolio] = useState(initial.portfolio);
  const [subjectIds, setSubjectIds] = useState(initial.subjectIds);
  const [coverPreset, setCoverPreset] = useState(initial.coverPreset);
  const [photo, setPhoto] = useState<File>();
  const [removePhoto, setRemovePhoto] = useState(false);
  const [coverFile, setCoverFile] = useState<File>();
  const [removeCoverImage, setRemoveCoverImage] = useState(false);
  const [uploads, setUploads] = useState<Partial<Record<'photo' | 'cover', UploadFileItem>>>({});
  const [notice, setNotice] = useState<string>();

  const currentPhotoUrl = useResourceImage(removePhoto || photo ? undefined : profile?.photoFileId);
  const newPhotoUrl = useFileUrl(photo);
  const newCoverUrl = useFileUrl(coverFile);
  const hasCoverImage = Boolean(coverFile || (profile?.cover?.fileId && !removeCoverImage));
  const coverChanged = Boolean(coverFile) || removeCoverImage || coverPreset !== initial.coverPreset;
  const dirty = coverChanged || Boolean(photo) || removePhoto || JSON.stringify([preferredName, bio, interests, learningGoals, skills, helpTopics, portfolio, subjectIds])
    !== JSON.stringify([initial.preferredName, initial.bio, initial.interests, initial.learningGoals, initial.skills, initial.helpTopics, initial.portfolio, initial.subjectIds]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // jsdom y navegadores antiguos no implementan showModal; el atributo basta para mostrarla.
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    return () => { if (typeof dialog.close === 'function' && dialog.open) dialog.close(); };
  }, []);
  useEffect(() => () => uploadController.current?.abort(), []);

  const requestClose = async () => {
    if (pending) return;
    if (dirty && !window.confirm('¿Descartar los cambios sin guardar?')) return;
    if (!await clearImage('photo') || !await clearImage('cover')) return;
    onDone();
  };

  const clearImage = async (key: 'photo' | 'cover') => {
    if (submitting.current) return false;
    const record = saved.current;
    const attempt = key === 'photo' ? record?.photoAttempt : record?.coverAttempt;
    const confirmed = key === 'photo' ? record?.photoFile : record?.coverFile;
    if (record && attempt && attempt.file !== confirmed) {
      submitting.current = true;
      try {
        const discarded = await run(async () => {
          const ready = await source.discardResourceUpload(key === 'photo' ? 'profile' : 'profile_cover', record.id, attempt.file);
          if (ready) {
            setNotice(`La ${key === 'photo' ? 'foto' : 'portada'} ya estaba guardada y se conservó en tu perfil.`);
            record.version = Math.max(record.version, attempt.expectedVersion + 1);
            if (key === 'photo') { record.photoFile = attempt.file; record.photoId = ready; }
            else { record.coverFile = attempt.file; record.coverId = ready; }
          }
          if (key === 'photo') record.photoAttempt = undefined; else record.coverAttempt = undefined;
          return true;
        });
        if (!discarded) return false;
      } finally { submitting.current = false; }
    }
    if (key === 'photo') setPhoto(undefined); else setCoverFile(undefined);
    setUploads((current) => ({ ...current, [key]: undefined }));
    return true;
  };

  const selectImage = async (key: 'photo' | 'cover', file: File) => {
    if (!await clearImage(key)) return;
    setNotice(undefined);
    if (key === 'photo') { setPhoto(file); setRemovePhoto(false); }
    else { setCoverFile(file); setRemoveCoverImage(false); }
    setUploads((current) => ({ ...current, [key]: { id: key, name: file.name, size: file.size,
      type: file.type, progress: 0, state: 'selected' } }));
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const controller = new AbortController();
    uploadController.current = controller;
    let currentKey: 'photo' | 'cover' | undefined;
    const updateUpload = (key: 'photo' | 'cover', change: Partial<UploadFileItem>) => {
      setUploads((current) => ({ ...current, [key]: current[key] ? { ...current[key]!, ...change } : undefined }));
    };
    try {
      const result = await run(async () => {
        const currentProfile = source.getSnapshot().memberProfiles.find((entry) => entry.memberId === member.id) ?? profile;
        const input: MemberProfileInput = cleanMemberProfile({
          preferredName, bio, interests, learningGoals, skills, helpTopics,
          portfolioLinks: portfolio.map((link) => link.trim()).filter(Boolean), subjectIds,
          photoFileId: removePhoto ? undefined : saved.current?.photoId ?? currentProfile?.photoFileId,
          expectedVersion: saved.current?.version ?? currentProfile?.version ?? 0,
      });
      const metadataKey = JSON.stringify({ ...input, expectedVersion: undefined, photoFileId: undefined, removePhoto });
        const unresolved = saved.current && (
          (saved.current.photoAttempt && saved.current.photoAttempt.file !== saved.current.photoFile) ||
          (saved.current.coverAttempt && saved.current.coverAttempt.file !== saved.current.coverFile)
        );
        const deferMetadata = Boolean(unresolved && saved.current?.metadataKey !== metadataKey);
        if (!saved.current || (!deferMetadata && saved.current.metadataKey !== metadataKey)) {
        const id = await source.saveMemberProfile(input);
        saved.current = { ...saved.current, id, metadataKey, version: input.expectedVersion + 1 };
      }
      const record = saved.current;
      const latest = () => source.getSnapshot().memberProfiles.find((entry) => entry.id === record.id);
      const version = () => Math.max(record.version, latest()?.version ?? 0);
      const upload = async (kind: 'profile' | 'profile_cover', key: 'photo' | 'cover', file: File) => {
        if ((key === 'photo' ? record.photoFile : record.coverFile) === file) return;
        currentKey = key;
        updateUpload(key, { state: 'preparing', progress: 0, error: undefined });
        const previous = key === 'photo' ? record.photoAttempt : record.coverAttempt;
        const expectedVersion = previous?.file === file ? previous.expectedVersion : version();
        if (key === 'photo') record.photoAttempt = { file, expectedVersion };
        else record.coverAttempt = { file, expectedVersion };
        let resultingVersion: number | undefined;
        const fileId = await source.attachResourceFile(kind, record.id, file, expectedVersion, {
          signal: controller.signal,
          onConfirmed: (_fileId, confirmedVersion) => { resultingVersion = confirmedVersion; },
          onProgress: (transferred, total) => updateUpload(key, {
            state: total > 0 && transferred >= total ? 'confirming' : 'uploading',
            progress: total > 0 ? Math.min(99, Math.round(transferred / total * 100)) : 0,
          }),
        });
        record.version = Math.max(record.version, resultingVersion ?? expectedVersion + 1);
        if (key === 'photo') { record.photoFile = file; record.photoId = fileId; }
        else { record.coverFile = file; record.coverId = fileId; }
        updateUpload(key, { state: 'complete', progress: 100 });
        currentKey = undefined;
      };
      if (photo) await upload('profile', 'photo', photo);
      if (controller.signal.aborted) throw new DOMException('Cancelaste la subida. Puedes guardar de nuevo para continuar.', 'AbortError');
      if (coverChanged) {
        if (coverFile) await upload('profile_cover', 'cover', coverFile);
        if (controller.signal.aborted) throw new DOMException('Cancelaste la subida. Puedes guardar de nuevo para continuar.', 'AbortError');
        const fileId = removeCoverImage ? undefined : coverFile ? record.coverId : latest()?.cover?.fileId ?? profile?.cover?.fileId;
        const coverKey = JSON.stringify({ preset: coverPreset, fileId });
        if (record.coverKey !== coverKey) {
          currentKey = coverFile ? 'cover' : undefined;
          if (currentKey) updateUpload(currentKey, { state: 'confirming', progress: 99 });
          const expectedVersion = version();
          await source.saveProfileCover({ preset: coverPreset, fileId, expectedVersion });
          record.version = expectedVersion + 1;
          record.coverKey = coverKey;
          if (currentKey) updateUpload(currentKey, { state: 'complete', progress: 100 });
        }
      }
        if (deferMetadata) {
          const expectedVersion = version();
          await source.saveMemberProfile({ ...input, expectedVersion,
            photoFileId: removePhoto ? undefined : record.photoId ?? latest()?.photoFileId ?? profile?.photoFileId });
          record.version = expectedVersion + 1;
          record.metadataKey = metadataKey;
        }
      return true;
      });
      if (result) onDone();
      else if (currentKey) updateUpload(currentKey, { state: controller.signal.aborted ? 'cancelled' : 'failed',
        error: controller.signal.aborted ? 'Subida cancelada. Puedes reintentar.' : 'No se pudo confirmar este archivo. Vuelve a guardar para reintentar.' });
    } finally {
      if (uploadController.current === controller) uploadController.current = null;
      submitting.current = false;
    }
  };

  const previewName = preferredName.trim() || member.displayName;
  const previewPhoto = newPhotoUrl ?? currentPhotoUrl;

  return (
    <dialog
      ref={dialogRef}
      className="profile-editor"
      aria-labelledby="profile-editor-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <form className="profile-editor__form" onSubmit={submit} noValidate>
        <header className="profile-editor__header">
          <div><h2 id="profile-editor-title">Personaliza tu perfil</h2><p>Elige cómo te verá el grupo: portada, foto, presentación e intereses.</p></div>
          <button type="button" className="secondary profile-editor__close" aria-label="Cerrar" onClick={requestClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <fieldset className="profile-editor__upload-fields" disabled={pending}>
        <div className="profile-editor__body">
          <div className="profile-editor__preview" aria-label="Vista previa">
            <ProfileCover
              className="profile-editor__preview-cover"
              cover={{ preset: coverPreset, fileId: removeCoverImage ? undefined : profile?.cover?.fileId }}
              imageUrl={newCoverUrl}
            />
            <div className="profile-editor__preview-person">
              {previewPhoto
                ? <img className="avatar" src={previewPhoto} alt="" width={72} height={72} />
                : <Avatar member={{ ...member, photoUrl: undefined }} size={72} />}
              <strong>{previewName}</strong>
            </div>
            <p className="profile-editor__preview-caption">Así se verá tu perfil en el grupo.</p>
          </div>

          <Section title="Portada" description="Elige un degradado o sube una imagen horizontal (se recomienda 1500 × 500).">
            <div className="cover-swatches" role="radiogroup" aria-label="Degradado de portada">
              {PROFILE_COVER_PRESETS.map((preset) => (
                <label key={preset.id} className="cover-swatch" title={preset.label}>
                  <input
                    type="radio"
                    name="cover-preset"
                    value={preset.id}
                    checked={!hasCoverImage && coverPreset === preset.id}
                    onChange={async () => {
                      if (!await clearImage('cover')) return;
                      setCoverPreset(preset.id);
                      if (profile?.cover?.fileId || saved.current?.coverId) setRemoveCoverImage(true);
                    }}
                  />
                  <span className="cover-swatch__color" style={{ backgroundImage: profileCoverGradient(preset.id) }} />
                  <span className="sr-only">{preset.label}</span>
                </label>
              ))}
            </div>
            <div className="b20-upload b20-upload--profile">
              <FilePicker multiple={false} accept="image/png,image/jpeg,image/webp" maxSize={PROFILE_PHOTO_MAX_BYTES}
                label="Imagen de portada" hint="PNG, JPEG o WebP, máximo 5 MiB." disabled={pending}
                validate={(file) => profileImageError(file, 'portada')} onFiles={(files) => { if (files[0]) selectImage('cover', files[0]); }} />
              <UploadFileList items={uploads.cover ? [uploads.cover] : []}
                onRemove={!pending && uploads.cover?.state !== 'complete' ? () => { void clearImage('cover'); } : undefined}
                onRetry={!pending ? () => { void submit(); } : undefined} />
              {hasCoverImage && (
                <button type="button" className="secondary" onClick={async () => { if (await clearImage('cover')) setRemoveCoverImage(Boolean(profile?.cover?.fileId || saved.current?.coverId)); }}>
                  Quitar imagen
                </button>
              )}
            </div>
          </Section>

          <Section title="Foto de perfil" description="Se guarda de forma privada y solo la ve el grupo.">
            <div className="b20-upload b20-upload--profile">
              <FilePicker multiple={false} accept="image/png,image/jpeg,image/webp" maxSize={PROFILE_PHOTO_MAX_BYTES}
                label="Foto de perfil" hint="PNG, JPEG o WebP, máximo 5 MiB." disabled={pending}
                validate={(file) => profileImageError(file, 'foto')} onFiles={(files) => { if (files[0]) selectImage('photo', files[0]); }} />
              <UploadFileList items={uploads.photo ? [uploads.photo] : []}
                onRemove={!pending && uploads.photo?.state !== 'complete' ? () => { void clearImage('photo'); } : undefined}
                onRetry={!pending ? () => { void submit(); } : undefined} />
              {(photo || (profile?.photoFileId && !removePhoto)) && (
                <button type="button" className="secondary" onClick={async () => { if (await clearImage('photo')) setRemovePhoto(Boolean(profile?.photoFileId || saved.current?.photoId)); }}>
                  Quitar foto
                </button>
              )}
            </div>
          </Section>

          <Section title="Sobre ti">
            <div className="field">
              <CountedLabel htmlFor={nameId} label="Nombre preferido" length={preferredName.length} max={80} />
              <input id={nameId} value={preferredName} onChange={(event) => setPreferredName(event.target.value)} maxLength={80} placeholder={member.displayName} />
            </div>
            <div className="field">
              <CountedLabel htmlFor={bioId} label="Presentación" length={bio.length} max={1000} />
              <textarea id={bioId} value={bio} onChange={(event) => setBio(event.target.value)} maxLength={1000} rows={4} placeholder="Cuéntale al grupo quién eres y qué te gusta." />
            </div>
          </Section>

          <Section title="Aprendizaje" description="Ayuda a que el grupo sepa en qué puedes apoyar y en qué buscas ayuda.">
            <TagField label="Intereses" placeholder="Escribe y presiona Enter" values={interests} onChange={setInterests} />
            <TagField label="Temas que puedes explicar" placeholder="Escribe y presiona Enter" values={skills} onChange={setSkills} />
            <TagField label="Temas en los que buscas ayuda" placeholder="Escribe y presiona Enter" values={helpTopics} onChange={setHelpTopics} />
            <div className="field">
              <CountedLabel htmlFor={goalsId} label="Objetivos de aprendizaje" length={learningGoals.length} max={1000} />
              <textarea id={goalsId} value={learningGoals} onChange={(event) => setLearningGoals(event.target.value)} maxLength={1000} rows={3} />
            </div>
          </Section>

          {subjects.length > 0 && (
            <Section title="Materias que cursas">
              <div className="chips" role="group" aria-label="Materias que cursas">
                {subjects.map((subject) => {
                  const selected = subjectIds.includes(subject.id);
                  return (
                    <button
                      key={subject.id}
                      type="button"
                      className="chip"
                      aria-pressed={selected}
                      onClick={() => setSubjectIds((current) => selected ? current.filter((id) => id !== subject.id) : [...current, subject.id])}
                    >
                      {selected && <Icon name="check" size={14} />} {subject.name}
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          <Section title="Portafolio" description="Enlaces HTTPS a tus proyectos, repositorios o trabajos (máximo 10).">
            {portfolio.map((link, index) => (
              <div key={index} className="profile-editor__link">
                <input
                  type="url"
                  inputMode="url"
                  value={link}
                  placeholder="https://"
                  aria-label={`Enlace ${index + 1} del portafolio`}
                  onChange={(event) => setPortfolio((current) => current.map((entry, i) => i === index ? event.target.value : entry))}
                />
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Quitar enlace ${index + 1}`}
                  onClick={() => setPortfolio((current) => current.length > 1 ? current.filter((_, i) => i !== index) : [''])}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="secondary with-icon" disabled={portfolio.length >= 10} onClick={() => setPortfolio((current) => [...current, ''])}>
                <Icon name="plus" size={16} /> Agregar enlace
              </button>
            </div>
          </Section>
        </div>
        </fieldset>

        <footer className="profile-editor__footer">
          <p className="muted profile-editor__privacy">
            Todo es voluntario y solo lo verá el grupo. Nada de esto se envía a Gemini.
          </p>
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          <div className="profile-editor__actions">
            {pending && (uploads.photo || uploads.cover) && <button type="button" className="secondary" onClick={() => uploadController.current?.abort()}>Cancelar subida</button>}
            <button type="button" className="secondary" disabled={pending} onClick={requestClose}>Cancelar</button>
            <button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
