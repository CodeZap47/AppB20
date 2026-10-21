import type { TeachingPersonal, TeachingPractice, TeachingRevision } from './types';

interface Store {
  history: Map<string, TeachingRevision[]>;
  receipts: Map<string, { fingerprint: string; version: number }>;
}

// Las sesiones de una misma demo comparten los recibos y el historial. Al dejar de
// utilizar su estado, WeakMap permite liberar también estos datos privados.
const stores = new WeakMap<object, Store>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DemoTeachingVersions {
  constructor(private state: () => object) {}

  private get data(): Store {
    let value = stores.get(this.state());
    if (!value) {
      value = { history: new Map(), receipts: new Map() };
      stores.set(this.state(), value);
    }
    return value;
  }

  replay(actor: string, requestId: string | undefined, input: unknown): number | undefined {
    if (!requestId || !UUID.test(requestId)) throw new Error('Actualiza la aplicación: indica la versión y el identificador de guardado.');
    const prior = this.data.receipts.get(`${actor}:${requestId.toLowerCase()}`);
    if (prior !== undefined && prior.fingerprint !== JSON.stringify(input)) throw new Error('Este envío ya se utilizó para otro cambio.');
    return prior?.version;
  }

  remember(actor: string, requestId: string, input: unknown, version: number): void {
    this.data.receipts.set(`${actor}:${requestId.toLowerCase()}`, { fingerprint: JSON.stringify(input), version });
  }

  capture(practice: TeachingPractice, personal: TeachingPersonal): void {
    const history = this.data.history.get(practice.id) ?? [];
    const version = practice.version ?? 1;
    if (history.some((row) => row.version === version)) return;
    history.push(structuredClone({ version, initial: practice.initial, revised: practice.revised,
      reflection: personal.reflection, topicsToReview: personal.topicsToReview,
      status: practice.status, at: practice.updatedAt }));
    this.data.history.set(practice.id, history);
  }

  history(practice: TeachingPractice, personal: TeachingPersonal): TeachingRevision[] {
    this.capture(practice, personal);
    return structuredClone([...(this.data.history.get(practice.id) ?? [])].sort((a, b) => b.version - a.version).slice(0, 30));
  }
}
