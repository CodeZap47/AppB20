import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { DEFAULT_PROFILE_COVER, PROFILE_COVER_PRESETS, profileCoverGradient } from '@b20/core';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { MemberProfile, MemberProfileInput, ProfileCover as Cover } from '../data/communityTypes';
import type { Id, Member } from '../data/types';
import { cleanMemberProfile, profileImageError, profileList } from '../lib/profiles';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { useAction } from './useAction';

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
    {profile?.photoFileId && loaded?.key !== key && <button className="link-button" type="button" disabled={pending} onClick={load}>{pending ? 'Cargando foto…' : 'Ver foto'}</button>}
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
  const photoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
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
  const [fileError, setFileError] = useState<string>();
  const [progress, setProgress] = useState<{ label: string; percent: number }>();

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

  const requestClose = () => {
    if (pending) return;
    if (dirty && !window.confirm('¿Descartar los cambios sin guardar?')) return;
    onDone();
  };

  const pickImage = (file: File | undefined, kind: 'foto' | 'portada') => {
    if (!file) return undefined;
    const problem = profileImageError(file, kind);
    setFileError(problem);
    return problem ? undefined : file;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(async () => {
      const input: MemberProfileInput = cleanMemberProfile({
        preferredName, bio, interests, learningGoals, skills, helpTopics,
        portfolioLinks: portfolio.map((link) => link.trim()).filter(Boolean), subjectIds,
        photoFileId: removePhoto ? undefined : profile?.photoFileId,
        expectedVersion: profile?.version ?? 0,
      });
      const id = await source.saveMemberProfile(input);
      const latest = () => source.getSnapshot().memberProfiles.find((entry) => entry.id === id);
      const upload = async (kind: 'profile' | 'profile_cover', file: File, label: string) => {
        setProgress({ label, percent: 0 });
        await source.attachResourceFile(kind, id, file, latest()?.version ?? input.expectedVersion + 1, {
          onProgress: (transferred, total) => setProgress({ label, percent: total ? Math.round(transferred / total * 100) : 0 }),
        });
      };
      if (photo) await upload('profile', photo, 'foto');
      if (coverChanged) {
        if (coverFile) await upload('profile_cover', coverFile, 'portada');
        const saved = latest();
        await source.saveProfileCover({
          preset: coverPreset,
          fileId: coverFile || !removeCoverImage ? saved?.cover?.fileId : undefined,
          expectedVersion: saved?.version ?? input.expectedVersion + 1,
        });
      }
      return true;
    });
    setProgress(undefined);
    if (result) onDone();
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
          <h2 id="profile-editor-title">Editar perfil</h2>
          <button type="button" className="secondary profile-editor__close" aria-label="Cerrar" onClick={requestClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

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
                    onChange={() => {
                      setCoverPreset(preset.id);
                      setCoverFile(undefined);
                      if (profile?.cover?.fileId) setRemoveCoverImage(true);
                    }}
                  />
                  <span className="cover-swatch__color" style={{ backgroundImage: profileCoverGradient(preset.id) }} />
                  <span className="sr-only">{preset.label}</span>
                </label>
              ))}
            </div>
            <div className="row">
              <button type="button" className="secondary with-icon" onClick={() => coverInput.current?.click()}>
                <Icon name="upload" size={16} /> {hasCoverImage ? 'Cambiar imagen' : 'Subir imagen'}
              </button>
              {hasCoverImage && (
                <button type="button" className="secondary" onClick={() => { setCoverFile(undefined); setRemoveCoverImage(Boolean(profile?.cover?.fileId)); }}>
                  Quitar imagen
                </button>
              )}
              <span className="muted profile-editor__hint">PNG, JPEG o WebP, máximo 5 MiB.</span>
            </div>
            <input
              ref={coverInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              aria-label="Imagen de portada"
              onChange={(event) => {
                const file = pickImage(event.target.files?.[0], 'portada');
                if (file) { setCoverFile(file); setRemoveCoverImage(false); }
                event.target.value = '';
              }}
            />
          </Section>

          <Section title="Foto de perfil" description="Se guarda de forma privada y solo la ve el grupo.">
            <div className="row">
              <button type="button" className="secondary with-icon" onClick={() => photoInput.current?.click()}>
                <Icon name="upload" size={16} /> {profile?.photoFileId || photo ? 'Cambiar foto' : 'Subir foto'}
              </button>
              {(photo || (profile?.photoFileId && !removePhoto)) && (
                <button type="button" className="secondary" onClick={() => { setPhoto(undefined); setRemovePhoto(Boolean(profile?.photoFileId)); }}>
                  Quitar foto
                </button>
              )}
              <span className="muted profile-editor__hint">PNG, JPEG o WebP, máximo 5 MiB.</span>
            </div>
            <input
              ref={photoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              aria-label="Foto de perfil"
              onChange={(event) => {
                const file = pickImage(event.target.files?.[0], 'foto');
                if (file) { setPhoto(file); setRemovePhoto(false); }
                event.target.value = '';
              }}
            />
            {fileError && <p className="error" role="alert">{fileError}</p>}
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

        <footer className="profile-editor__footer">
          <p className="muted profile-editor__privacy">
            {progress && pending
              ? <span role="status">Subiendo {progress.label}: {progress.percent} %</span>
              : 'Todo es voluntario y solo lo verá el grupo. Nada de esto se envía a Gemini.'}
          </p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="profile-editor__actions">
            <button type="button" className="secondary" disabled={pending} onClick={requestClose}>Cancelar</button>
            <button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
