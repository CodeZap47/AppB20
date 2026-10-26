import { AiError } from './ai';
export const PRESENTATION_AUDIO_LIMITS = { bytes: 10 * 1024 * 1024, seconds: 20 * 60, chunkBytes: 1024 * 1024, ttlMs: 24 * 60 * 60 * 1000 } as const;
export const PRESENTATION_AUDIO_MIMES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/aac'] as const;
export interface PresentationAudio {
  id: string; attemptId: string; name: string; mime: string; bytes: number; sha256: string; durationSeconds?: number;
  state: 'pending' | 'ready' | 'deleted' | 'cancelled' | 'expired'; chunkCount: number; received: number[]; shared: boolean;
}
export function presentationAudioMime(value: string): string {
  const declared = value.toLowerCase().split(';')[0]!.trim();
  const mime = declared === 'video/mp4' ? 'audio/mp4' : declared === 'video/webm' ? 'audio/webm' : declared;
  if (!(PRESENTATION_AUDIO_MIMES as readonly string[]).includes(mime)) throw new AiError('invalid', 'Elige audio WebM, M4A, MP3, OGG o WAV.');
  return mime === 'audio/x-wav' ? 'audio/wav' : mime;
}
export function validatePresentationAudioSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > PRESENTATION_AUDIO_LIMITS.bytes) throw new AiError('quota', 'El audio admite hasta 10 MiB.');
}
export function validatePresentationAudioDuration(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > PRESENTATION_AUDIO_LIMITS.seconds) throw new AiError('invalid', 'El audio admite hasta 20 minutos.');
}
