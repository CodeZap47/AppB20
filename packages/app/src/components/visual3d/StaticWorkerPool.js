/** A single static decoder worker, with cancellation and bounded task lifetime. */
export class WorkerPool {
  constructor() { this.queue = []; this.worker = null; this.creator = null; this.task = null; this.id = 0; this.disposed = false; }
  setWorkerLimit() { return this; }
  setWorkerCreator(creator) { this.creator = creator; return this; }
  postMessage(message, transfer = []) {
    if (this.disposed) return Promise.reject(new Error('La carga se canceló.'));
    return new Promise((resolve, reject) => { this.queue.push({ message, transfer, resolve, reject }); this.next(); });
  }
  next() {
    if (this.disposed || this.task || !this.queue.length) return;
    if (!this.worker) {
      this.worker = this.creator();
      this.worker.onmessage = event => {
        if (!this.task || event.data.id !== this.task.id) return;
        const task = this.task; clearTimeout(task.timer); this.task = null;
        if (event.data.type === 'error') task.reject(new Error(event.data.error || 'No se pudo decodificar el modelo.'));
        else task.resolve(event);
        this.next();
      };
      this.worker.onerror = event => this.fail(new Error(event.message || 'No se pudo iniciar el decodificador.'));
      this.worker.onmessageerror = () => this.fail(new Error('La respuesta del decodificador no es válida.'));
    }
    const task = this.queue.shift(); task.id = ++this.id;
    task.timer = setTimeout(() => this.fail(new Error('La decodificación tardó demasiado. Prueba un modelo más ligero.')), 45000);
    this.task = task; this.worker.postMessage({ ...task.message, id: task.id }, task.transfer);
  }
  fail(error) {
    if (this.task) { clearTimeout(this.task.timer); this.task.reject(error); this.task = null; }
    for (const task of this.queue.splice(0)) task.reject(error);
    this.worker?.terminate(); this.worker = null;
  }
  dispose() { this.disposed = true; this.fail(new Error('La carga se canceló.')); }
}
