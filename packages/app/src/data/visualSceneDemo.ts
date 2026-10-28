import { cleanVisualSceneDocument, emptyVisualSceneDocument, parseGlb, validateVisualSceneAssets, visualSceneAssetIds,
  VISUAL_SCENE_LIMITS, type VisualScene, type VisualSceneInput, type VisualSceneDocument, type VisualModelAsset, type VisualProject } from '@b20/core';
import type { Member, ResourceFile, ResourceTransferOptions } from './types';
import type { VisualProjectsDemoState } from './visualProjectsDemo';
import { VisualDemoPersistence } from './visualScenePersistence';

interface SceneRecord { projectId: string; version: number; document: VisualSceneDocument; updatedAt: number; requestId: string; payload: string }
interface SavedState {
  revision: number; projects: VisualProject[]; projectRequests: VisualProjectsDemoState['visualProjectRequests'];
  scenes: SceneRecord[]; assets: VisualModelAsset[]; files: ResourceFile[]; requests: [string, string][];
  covers?: ResourceFile[];
}
interface Shared { scenes: SceneRecord[]; assets: VisualModelAsset[]; files: ResourceFile[]; requests: Map<string, string>; blobs: Map<string, Blob>; revision: number; chain: Promise<unknown> }
const stores = new WeakMap<object, Shared>();
interface Context {
  state(): VisualProjectsDemoState; active(): Member; now(): Date; emit(): void;
  existingFiles(): readonly ResourceFile[]; persistenceKey?: string;
  covers?(): { files: ResourceFile[]; blobs: Map<string, Blob> };
  restoreCovers?(files: ResourceFile[], blobs: Map<string, Blob>): void;
}
const copy = <T,>(value: T): T => structuredClone(value);
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Cancelaste la importación.', 'AbortError'); };
const cloneAsset = (value: VisualModelAsset) => copy(value);

/** Native-equivalent behavior for synthetic projects. No production credentials or binary caches. */
export class DemoVisualSceneStore {
  private data: Shared;
  private persistence?: VisualDemoPersistence<SavedState>;
  private channel?: BroadcastChannel;
  private disposed = false;
  readonly ready: Promise<void>;
  constructor(private ctx: Context) {
    this.data = stores.get(ctx.state()) ?? { scenes: [], assets: [], files: [], requests: new Map(), blobs: new Map(), revision: 0, chain: Promise.resolve() };
    stores.set(ctx.state(), this.data);
    if (ctx.persistenceKey) this.persistence = new VisualDemoPersistence(ctx.persistenceKey);
    this.ready = this.persistence
      ? this.refresh().then(() => { if (!this.disposed) ctx.emit(); })
      : Promise.resolve();
    // Keep initialization rejection handled until the first explicit operation can show it.
    void this.ready.catch(() => undefined);
    if (ctx.persistenceKey && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`b20-visual-demo:${ctx.persistenceKey}`);
      this.channel.onmessage = () => { void this.ready.then(() => this.data.chain).then(() => this.refresh()).then(() => { if (!this.disposed) ctx.emit(); }).catch(() => undefined); };
    }
  }
  private snapshot(): SavedState {
    return { revision: this.data.revision, projects: copy(this.ctx.state().visualProjects), projectRequests: copy(this.ctx.state().visualProjectRequests),
      scenes: copy(this.data.scenes), assets: copy(this.data.assets), files: copy(this.data.files), requests: [...this.data.requests], covers: copy(this.ctx.covers?.().files ?? []) };
  }
  private apply(saved: SavedState) {
    this.ctx.state().visualProjects = saved.projects; this.ctx.state().visualProjectRequests = saved.projectRequests;
    this.data.scenes = saved.scenes; this.data.assets = saved.assets; this.data.files = saved.files;
    this.data.requests = new Map(saved.requests); this.data.revision = saved.revision;
  }
  private async refresh() {
    const saved = await this.persistence?.read();
    if (saved && saved.revision > this.data.revision) {
      this.apply(saved);
      const blobs = new Map<string, Blob>();
      await Promise.all((saved.covers ?? []).map(async file => { const blob = await this.persistence?.readBlob(file.id); if (blob) blobs.set(file.id, blob); }));
      this.ctx.restoreCovers?.(saved.covers ?? [], blobs);
    }
  }
  async transaction<T>(action: () => T | Promise<T>, writes = new Map<string, Blob>(), removed: string[] = []): Promise<T> {
    const execute = async () => {
      await this.ready; await this.refresh(); this.ctx.active();
      const before = this.snapshot(); const beforeBlobs = new Map(this.data.blobs); const beforeCoverBlobs = this.ctx.covers?.().blobs ?? new Map<string, Blob>();
      try {
        this.purgeExpired(removed);
        const value = await action();
        const next = this.snapshot(); next.revision++;
        const binaryWrites = new Map([...this.ctx.covers?.().blobs ?? [], ...writes]);
        await this.persistence?.write(next, before.revision, binaryWrites, removed);
        this.data.revision = next.revision;
        this.ctx.emit(); this.channel?.postMessage({ revision: next.revision });
        return value;
      } catch (error) {
        this.apply(before); this.data.blobs = beforeBlobs;
        this.ctx.restoreCovers?.(before.covers ?? [], beforeCoverBlobs);
        await this.refresh().catch(() => undefined); this.ctx.emit(); throw error;
      }
    };
    const next = this.data.chain.then(execute, execute); this.data.chain = next.catch(() => undefined); return next;
  }
  private project(id: string, editable = false) {
    const actor = this.ctx.active(); const project = this.ctx.state().visualProjects.find(row => row.id === id);
    if (!project || project.authorId !== actor.id && (project.visibility !== 'group' || project.archived)) throw new Error('El proyecto no está disponible.');
    if (editable && (project.authorId !== actor.id || project.archived)) throw new Error('Solo el autor modifica una escena activa.');
    return project;
  }
  private referenced(projectId: string): Set<string> {
    const document = this.data.scenes.find(row => row.projectId === projectId)?.document;
    return new Set(document ? visualSceneAssetIds(document) : []);
  }
  private quota() {
    return { limitBytes: 256 * 1024 * 1024, reservedBytes: this.ctx.existingFiles().reduce((sum, file) => sum + file.size, 0)
      + this.data.assets.filter(asset => asset.state === 'ready').reduce((sum, asset) => sum + (asset.bytes ?? 0), 0) };
  }
  private result(projectId: string): VisualScene {
    const project = this.project(projectId); const row = this.data.scenes.find(row => row.projectId === projectId);
    const own = project.authorId === this.ctx.active().id; const references = this.referenced(projectId);
    return { projectId, version: row?.version ?? 0, document: copy(row?.document ?? emptyVisualSceneDocument()),
      assets: this.data.assets.filter(asset => asset.projectId === projectId && asset.state !== 'purged' && (own || asset.state === 'ready' && references.has(asset.id))).map(cloneAsset),
      capacity: this.quota(), updatedAt: row?.updatedAt ?? project.updatedAt };
  }
  async get(projectId: string) { await this.ready; await this.data.chain; await this.refresh(); return this.result(projectId); }
  async createAsset(projectId: string, requestId: string, name: string) {
    return this.transaction(() => {
      this.project(projectId, true);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId) || !/\.glb$/i.test(name.trim()) || name.trim().length > 200) throw new Error('Selecciona un nombre GLB válido para el modelo.');
      const key = `${this.ctx.active().id}:${requestId}`;
      const previous = this.data.assets.find(asset => asset.id === this.data.requests.get(key));
      if (previous) { if (previous.projectId !== projectId || previous.name !== name.trim()) throw new Error('Esta solicitud ya corresponde a otro modelo.'); return cloneAsset(previous); }
      if (this.data.assets.filter(asset => asset.projectId === projectId && asset.state !== 'purged').length >= 20) throw new Error('Libera modelos sin uso antes de preparar más archivos.');
      const asset: VisualModelAsset = { id: `model-${crypto.randomUUID()}`, projectId, name: name.trim(), state: 'pending', version: 1, createdAt: this.ctx.now().getTime(), unreferencedSince: this.ctx.now().getTime() };
      this.data.assets.push(asset); this.data.requests.set(key, asset.id); return cloneAsset(asset);
    });
  }
  async save(input: VisualSceneInput) {
    await this.transaction(() => {
      this.project(input.projectId, true); const document = cleanVisualSceneDocument(input.document);
      if (input.requestId !== undefined && !/^[A-Za-z0-9_-]{1,100}$/.test(input.requestId)) throw new Error('La solicitud de guardado no es válida.');
      const previous = this.data.scenes.find(row => row.projectId === input.projectId);
      const payload = JSON.stringify(document);
      if (input.requestId && previous?.requestId === input.requestId) {
        if (previous.payload !== payload) throw new Error('Esta solicitud ya guardó otra escena.'); return;
      }
      if ((previous?.version ?? 0) !== input.expectedVersion) throw new Error('La escena cambió. Conservamos tu borrador; revisa la versión guardada.');
      const assets = this.data.assets.filter(asset => asset.projectId === input.projectId);
      validateVisualSceneAssets(document, assets);
      const now = this.ctx.now().getTime(); const references = new Set(visualSceneAssetIds(document));
      for (const asset of assets) if (asset.state === 'ready') asset.unreferencedSince = references.has(asset.id) ? undefined : asset.unreferencedSince ?? now;
      const row: SceneRecord = { projectId: input.projectId, version: (previous?.version ?? 0) + 1, document, updatedAt: now, requestId: input.requestId ?? '', payload };
      this.data.scenes = [...this.data.scenes.filter(row => row.projectId !== input.projectId), row];
    });
    return this.result(input.projectId);
  }
  async upload(assetId: string, file: File, expectedVersion: number | undefined, transfer: ResourceTransferOptions = {}) {
    const writes = new Map<string, Blob>();
    return this.transaction(async () => {
      const asset = this.data.assets.find(row => row.id === assetId);
      if (!asset) throw new Error('El modelo no existe.');
      this.project(asset.projectId, true); const actor = this.ctx.active().id;
      if (asset.state === 'purged') throw new Error('El modelo se descartó. Vuelve a importarlo.');
      if (asset.state !== 'ready' && asset.version !== expectedVersion) throw new Error('El modelo cambió. Revisa la importación antes de reintentar.');
      if (!/\.glb$/i.test(file.name) || file.size <= 0 || file.size > VISUAL_SCENE_LIMITS.modelBytes) throw new Error('Selecciona un archivo GLB de hasta 50 MiB.');
      const capacity = this.quota(); if (asset.state !== 'ready' && capacity.reservedBytes + file.size > capacity.limitBytes) throw new Error('No hay espacio suficiente. Libera modelos sin uso antes de importar.');
      abort(transfer.signal); transfer.onProgress?.(0, file.size);
      const bytes = new Uint8Array(await file.arrayBuffer()); abort(transfer.signal);
      const manifest = parseGlb(bytes);
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
      const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      if (this.ctx.active().id !== actor) throw new Error('Tu sesión cambió. Reabre el proyecto.');
      this.project(asset.projectId, true); abort(transfer.signal);
      if (asset.state === 'ready') {
        if (asset.sha256 !== sha256 || asset.bytes !== file.size || !asset.fileId) throw new Error('El archivo del modelo es inmutable. Importa otro modelo para sustituirlo.');
        return asset.fileId;
      }
      const currentCapacity = this.quota();
      if (currentCapacity.reservedBytes + file.size > currentCapacity.limitBytes) throw new Error('El espacio disponible cambió. Libera modelos sin uso antes de reintentar.');
      const fileId = `visual-${crypto.randomUUID()}`; const blob = new Blob([new Uint8Array(bytes)], { type: 'model/gltf-binary' });
      asset.state = 'ready'; asset.version++; asset.fileId = fileId; asset.manifest = manifest; asset.bytes = file.size;
      asset.sha256 = sha256; asset.unreferencedSince = this.ctx.now().getTime();
      this.data.blobs.set(fileId, blob); writes.set(fileId, blob);
      this.data.files.push({ id: fileId, targetKind: 'visual_model', targetId: asset.id, name: file.name, size: file.size, contentType: 'model/gltf-binary', uploadedBy: actor, createdAt: this.ctx.now() });
      transfer.onProgress?.(file.size, file.size); return fileId;
    }, writes);
  }
  async discard(projectId: string, requested: { id: string; expectedVersion: number }[]) {
    const removed: string[] = [];
    await this.transaction(() => {
      this.project(projectId, true); const references = this.referenced(projectId);
      if (new Set(requested.map(row => row.id)).size !== requested.length) throw new Error('No repitas modelos al liberar espacio.');
      const assets = requested.map(input => {
        const asset = this.data.assets.find(row => row.id === input.id && row.projectId === projectId);
        if (!asset || asset.version !== input.expectedVersion) throw new Error('El modelo cambió. Actualiza la lista antes de liberar espacio.');
        if (references.has(asset.id)) throw new Error('Un modelo sigue utilizado por la escena, una vista o un paso.'); return asset;
      });
      for (const asset of assets) this.purge(asset, removed);
    }, new Map(), removed);
  }
  private purge(asset: VisualModelAsset, removed: string[]) {
    if (asset.state === 'purged') return;
    if (asset.fileId) { removed.push(asset.fileId); this.data.blobs.delete(asset.fileId); this.data.files = this.data.files.filter(file => file.id !== asset.fileId); }
    asset.state = 'purged'; asset.version++; delete asset.fileId; delete asset.manifest; delete asset.sha256; delete asset.bytes;
  }
  private purgeExpired(removed: string[]) {
    const now = this.ctx.now().getTime();
    for (const asset of this.data.assets) if (asset.state !== 'purged' && asset.unreferencedSince !== undefined
      && now - asset.unreferencedSince >= VISUAL_SCENE_LIMITS.unusedDays * 86400000 && !this.referenced(asset.projectId).has(asset.id)) this.purge(asset, removed);
  }
  ownsFile(id: string) { return this.data.files.some(file => file.id === id); }
  resources(): ResourceFile[] { return this.data.files.filter(file => this.fileVisible(file.id)); }
  fileVisible(id: string): boolean {
    const asset = this.data.assets.find(row => row.fileId === id && row.state === 'ready'); if (!asset) return false;
    try { const project = this.project(asset.projectId); return project.authorId === this.ctx.active().id || this.referenced(project.id).has(asset.id); } catch { return false; }
  }
  async download(id: string, transfer: ResourceTransferOptions = {}): Promise<Blob> {
    await this.ready; await this.refresh(); const actor = this.ctx.active().id;
    if (!this.fileVisible(id)) throw new Error('El modelo no está disponible.'); abort(transfer.signal);
    const blob = this.data.blobs.get(id) ?? await this.persistence?.readBlob(id);
    if (!blob || !this.fileVisible(id) || this.ctx.active().id !== actor) throw new Error('El modelo no está disponible.');
    abort(transfer.signal); transfer.onProgress?.(blob.size, blob.size); return blob;
  }
  summaries(projects: VisualProject[]): VisualProject[] {
    return projects.map(project => { const row = this.data.scenes.find(row => row.projectId === project.id);
      return { ...project, hasScene: Boolean(row && visualSceneAssetIds(row.document).length), sceneVersion: row?.version ?? 0,
        updatedAt: Math.max(project.updatedAt, row?.updatedAt ?? 0) }; });
  }
  dispose() { this.disposed = true; this.channel?.close(); }
}
