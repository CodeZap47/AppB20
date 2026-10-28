import { useId } from 'react';
import { Link } from 'react-router';
import { profileCoverGradient, PROFILE_COVER_PRESETS } from '@b20/core';
import { useSnapshot } from '../data/DataContext';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import './ProfileCustomizationHint.css';

/** Hace visible la personalización existente sin descargar imágenes privadas del perfil. */
export function ProfileCustomizationHint({ compact = false }: { compact?: boolean }) {
  const { me, memberProfiles } = useSnapshot();
  const titleId = useId();
  if (me?.status !== 'active') return null;
  const profile = memberProfiles.find((item) => item.memberId === me.id);
  const profilePath = `/perfil/${encodeURIComponent(me.id)}`;

  return (
    <section className={`profile-customization${compact ? ' profile-customization--compact' : ''}`} aria-labelledby={titleId}>
      <div className="profile-customization__preview" aria-hidden="true">
        <span className="profile-customization__cover" style={{ backgroundImage: profileCoverGradient(profile?.cover?.preset) }} />
        <Avatar member={{ ...me, photoUrl: undefined }} size={42} />
        <strong>{profile?.preferredName || me.displayName}</strong>
        <span className="profile-customization__line" />
        <div className="profile-customization__swatches">
          {PROFILE_COVER_PRESETS.slice(0, 4).map((preset) => <span key={preset.id} style={{ backgroundImage: profileCoverGradient(preset.id) }} />)}
        </div>
      </div>
      <div className="profile-customization__copy">
        <p className="profile-customization__eyebrow">Tu espacio en B20</p>
        <h2 id={titleId}>{compact ? 'Dale tu estilo a tu perfil' : 'Tu perfil también puede llevar tu estilo'}</h2>
        <p>Elige tu portada y tu foto, escribe una presentación y comparte tus intereses. Así te verá el grupo en Perfiles.</p>
        {!compact && <ul className="profile-customization__features">
          {['Foto y portada', 'Presentación', 'Intereses y habilidades'].map((feature) => <li key={feature}><Icon name="check" size={14} />{feature}</li>)}
        </ul>}
      </div>
      <div className="profile-customization__actions">
        <Link to={`${profilePath}?personalizar=1`} className="button with-icon"><Icon name="edit" size={16} /> Personalizar mi perfil</Link>
        {!compact && <Link to={profilePath} className="profile-customization__view">Ver mi perfil <Icon name="forward" size={14} /></Link>}
      </div>
    </section>
  );
}
