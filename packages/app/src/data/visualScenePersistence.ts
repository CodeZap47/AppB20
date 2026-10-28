/** Dedicated synthetic data only. Production model bytes never enter this database. */
export class VisualDemoPersistence<T extends { revision: number }> {
  private database?: Promise<IDBDatabase>;
  constructor(readonly namespace: string) {}
  private open() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('La demostración necesita IndexedDB para conservar los modelos.'));
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('b20-visual-demo-v1', 1);
      request.onupgradeneeded = () => {
        for (const name of ['state', 'models']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
      request.onblocked = () => { this.database = undefined; reject(new Error('Cierra otra pestaña para actualizar el almacenamiento de la demostración.')); };
    });
    return this.database;
  }
  async read(): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readonly'); const request = tx.objectStore('state').get(this.namespace);
      request.onsuccess = () => resolve(request.result as T | undefined); request.onerror = () => reject(request.error);
    });
  }
  async readBlob(fileId: string): Promise<Blob | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readonly'); const request = tx.objectStore('models').get(`${this.namespace}:${fileId}`);
      request.onsuccess = () => resolve(request.result as Blob | undefined); request.onerror = () => reject(request.error);
    });
  }
  async write(value: T, previousRevision: number, blobs = new Map<string, Blob>(), removed: string[] = []): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['state', 'models'], 'readwrite');
      let failure: Error | undefined;
      const state = tx.objectStore('state'); const request = state.get(this.namespace);
      request.onsuccess = () => {
        const existing = request.result as T | undefined;
        if ((existing?.revision ?? 0) !== previousRevision) {
          failure = new Error('La demostración cambió en otra pestaña. Conservamos tu borrador; revisa la escena guardada.'); tx.abort(); return;
        }
        state.put(value, this.namespace);
        for (const [id, blob] of blobs) tx.objectStore('models').put(blob, `${this.namespace}:${id}`);
        for (const id of removed) tx.objectStore('models').delete(`${this.namespace}:${id}`);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(failure ?? tx.error ?? new Error('No se pudo guardar la demostración. Comprueba el espacio del navegador.'));
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('No se pudo guardar la demostración. Comprueba el espacio del navegador.'));
    });
  }
}
