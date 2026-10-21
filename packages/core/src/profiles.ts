/** Degradados disponibles para la portada del perfil; `lavanda` es la portada predeterminada. */
export const PROFILE_COVER_PRESETS = [
  { id: 'lavanda', label: 'Lavanda', from: '#aebcf0', to: '#f0c6e8' },
  { id: 'oceano', label: 'Océano', from: '#7fb3f5', to: '#8de0d6' },
  { id: 'atardecer', label: 'Atardecer', from: '#f7a978', to: '#e57ca8' },
  { id: 'menta', label: 'Menta', from: '#a8e6cf', to: '#dcedc1' },
  { id: 'durazno', label: 'Durazno', from: '#ffd3a5', to: '#fd9f85' },
  { id: 'aurora', label: 'Aurora', from: '#84fab0', to: '#8fd3f4' },
  { id: 'bosque', label: 'Bosque', from: '#5a8f6a', to: '#a7c79a' },
  { id: 'cielo', label: 'Cielo', from: '#a1c4fd', to: '#c2e9fb' },
  { id: 'rosa', label: 'Rosa', from: '#fbc2eb', to: '#f6a5c0' },
  { id: 'grafito', label: 'Grafito', from: '#4b5563', to: '#9ca3af' },
] as const;

export type ProfileCoverPreset = (typeof PROFILE_COVER_PRESETS)[number]['id'];
export const DEFAULT_PROFILE_COVER: ProfileCoverPreset = 'lavanda';

export function isProfileCoverPreset(value: string): value is ProfileCoverPreset {
  return PROFILE_COVER_PRESETS.some((preset) => preset.id === value);
}

/** El fondo CSS del degradado; un valor desconocido usa la portada predeterminada. */
export function profileCoverGradient(preset: string | undefined): string {
  const found = PROFILE_COVER_PRESETS.find((entry) => entry.id === preset) ?? PROFILE_COVER_PRESETS[0];
  return `linear-gradient(180deg, ${found.from} 0%, ${found.to} 100%)`;
}
