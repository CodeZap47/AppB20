import { useEffect, useState, type FormEvent } from 'react';
import { useDataSource, useSnapshot } from '../data/DataContext';
import type { MemberProfile, MemberProfileInput } from '../data/communityTypes';
import type { Member } from '../data/types';
import { cleanMemberProfile, profileList, profilePhotoError } from '../lib/profiles';
import { Avatar } from './Avatar';
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

export function ProfilePresentationEditor({ profile, onDone }: { profile?: MemberProfile; onDone: () => void }) {
  const source = useDataSource();
  const { subjects } = useSnapshot();
  const { error, pending, run } = useAction();
  const [preferredName, setPreferredName] = useState(profile?.preferredName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [interests, setInterests] = useState(profile?.interests.join(', ') ?? '');
  const [learningGoals, setLearningGoals] = useState(profile?.learningGoals ?? '');
  const [skills, setSkills] = useState(profile?.skills.join(', ') ?? '');
  const [helpTopics, setHelpTopics] = useState(profile?.helpTopics.join(', ') ?? '');
  const [portfolio, setPortfolio] = useState(profile?.portfolioLinks.join('\n') ?? '');
  const [subjectIds, setSubjectIds] = useState(profile?.subjectIds ?? []);
  const [photo, setPhoto] = useState<File>();
  const [removePhoto, setRemovePhoto] = useState(false);
  const [progress, setProgress] = useState<number>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run(async () => {
      if (photo) { const problem = profilePhotoError(photo); if (problem) throw new Error(problem); }
      const input: MemberProfileInput = cleanMemberProfile({
        preferredName, bio, interests: profileList(interests), learningGoals,
        skills: profileList(skills), helpTopics: profileList(helpTopics),
        portfolioLinks: portfolio.split('\n').map((link) => link.trim()).filter(Boolean), subjectIds,
        photoFileId: removePhoto ? undefined : profile?.photoFileId,
        expectedVersion: profile?.version ?? 0,
      });
      const id = await source.saveMemberProfile(input);
      if (photo) {
        const latest = source.getSnapshot().memberProfiles.find((entry) => entry.id === id);
        await source.attachResourceFile('profile', id, photo, latest?.version ?? input.expectedVersion + 1, {
          onProgress: (transferredBytes, totalBytes) => setProgress(totalBytes ? Math.round(transferredBytes / totalBytes * 100) : 0),
        });
      }
      return true;
    });
    if (result) onDone();
  };
  return <form className="panel form" onSubmit={submit}>
    <h2>Editar presentación</h2>
    <p className="muted">Todos los campos son voluntarios y solo los verá el grupo. La foto se guarda de forma privada y no se envía a Gemini.</p>
    <label className="field"><span className="field__label">Nombre preferido</span><input value={preferredName} onChange={(event) => setPreferredName(event.target.value)} maxLength={80} /></label>
    <label className="field"><span className="field__label">Presentación</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={1000} rows={3} /></label>
    <label className="field"><span className="field__label">Intereses, separados por comas</span><input value={interests} onChange={(event) => setInterests(event.target.value)} /></label>
    <label className="field"><span className="field__label">Objetivos de aprendizaje</span><textarea value={learningGoals} onChange={(event) => setLearningGoals(event.target.value)} maxLength={1000} rows={2} /></label>
    <label className="field"><span className="field__label">Temas que puedes explicar, separados por comas</span><input value={skills} onChange={(event) => setSkills(event.target.value)} /></label>
    <label className="field"><span className="field__label">Temas en los que buscas ayuda, separados por comas</span><input value={helpTopics} onChange={(event) => setHelpTopics(event.target.value)} /></label>
    <label className="field"><span className="field__label">Enlaces HTTPS de portafolio, uno por renglón</span><textarea value={portfolio} onChange={(event) => setPortfolio(event.target.value)} rows={3} /></label>
    <fieldset><legend>Materias que cursas</legend><div className="chips">{subjects.map((subject) => <label key={subject.id}><input type="checkbox" checked={subjectIds.includes(subject.id)} onChange={(event) => setSubjectIds((current) => event.target.checked ? [...current, subject.id] : current.filter((id) => id !== subject.id))} /> {subject.name}</label>)}</div></fieldset>
    <label className="field"><span className="field__label">Foto de perfil (PNG, JPEG o WebP, máximo 5 MiB)</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setPhoto(event.target.files?.[0]); setRemovePhoto(false); }} /></label>
    {profile?.photoFileId && <label><input type="checkbox" checked={removePhoto} onChange={(event) => { setRemovePhoto(event.target.checked); setPhoto(undefined); }} /> Quitar mi foto actual</label>}
    {progress !== undefined && pending && <p role="status">Subiendo foto: {progress}%</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form__actions"><button type="button" className="secondary" disabled={pending} onClick={onDone}>Cancelar</button><button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar presentación'}</button></div>
  </form>;
}
