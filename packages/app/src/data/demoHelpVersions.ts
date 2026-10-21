import type { HelpPost, HelpPostHistory } from './types';

interface Store { history: Map<string, HelpPostHistory[]>; intents: Map<string, { fingerprint: string; id: string }> }
const stores = new WeakMap<object, Store>();
export class DemoHelpVersions {
  constructor(private state: () => object) {}
  private get data() { let value = stores.get(this.state()); if (!value) { value = { history: new Map(), intents: new Map() }; stores.set(this.state(), value); } return value; }
  replay(actor: string, requestId: string | undefined, input: unknown): string | undefined {
    if (!requestId) return undefined;
    if (!requestId.trim() || requestId.length > 128) throw new Error('El identificador de envío no es válido.');
    const prior = this.data.intents.get(`${actor}:${requestId}`);
    if (prior && prior.fingerprint !== JSON.stringify(input)) throw new Error('Este envío ya se utilizó para otro cambio.');
    return prior?.id;
  }
  remember(actor: string, requestId: string | undefined, input: unknown, id: string) { if (requestId) this.data.intents.set(`${actor}:${requestId}`, { fingerprint: JSON.stringify(input), id }); }
  capture(post: HelpPost) {
    const list = this.data.history.get(post.id) ?? [];
    if (list.some(row => row.version === (post.version ?? 1))) return;
    const { kind, subjectId, title, topic, description, level, modality, availability } = post;
    list.push({ version: post.version ?? 1, status: post.status, fields: { kind, subjectId, title, topic, description, level, modality, availability }, at: new Date(post.updatedAt) });
    this.data.history.set(post.id, list);
  }
  history(post: HelpPost): HelpPostHistory[] { this.capture(post); return structuredClone([...(this.data.history.get(post.id) ?? [])].sort((a, b) => b.version - a.version).slice(0, 30)); }
}
