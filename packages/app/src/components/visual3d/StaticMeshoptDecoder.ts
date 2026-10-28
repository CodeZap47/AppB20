interface Task { resolve(value: Uint8Array): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

export class StaticMeshoptDecoder {
  readonly supported = typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
  readonly ready = Promise.resolve();
  private worker?: Worker;
  private tasks = new Map<number, Task>();
  private id = 0;
  private disposed = false;

  decodeGltfBufferAsync(count: number, size: number, source: Uint8Array, mode: string, filter?: string): Promise<Uint8Array> {
    if (this.disposed) return Promise.reject(new Error('La carga se canceló.'));
    if (!this.worker) {
      this.worker = new Worker(new URL('./meshopt.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = event => {
        const task = this.tasks.get(event.data.id as number); if (!task) return;
        clearTimeout(task.timer); this.tasks.delete(event.data.id as number);
        if (event.data.error) task.reject(new Error(String(event.data.error))); else task.resolve(event.data.result as Uint8Array);
      };
      this.worker.onerror = event => this.fail(new Error(event.message || 'No se pudo iniciar Meshopt.'));
      this.worker.onmessageerror = () => this.fail(new Error('La respuesta de Meshopt no es válida.'));
    }
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('La decodificación tardó demasiado.')), 45000);
      this.tasks.set(id, { resolve, reject, timer });
      const bytes = new Uint8Array(source);
      this.worker!.postMessage({ id, count, size, source: bytes, mode, filter }, [bytes.buffer]);
    });
  }
  private fail(error: Error) {
    for (const task of this.tasks.values()) { clearTimeout(task.timer); task.reject(error); }
    this.tasks.clear(); this.worker?.terminate(); this.worker = undefined;
  }
  dispose() { this.disposed = true; this.fail(new Error('La carga se canceló.')); }
}
