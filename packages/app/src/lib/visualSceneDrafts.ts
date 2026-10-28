import { cleanVisualSceneDocument, type VisualSceneDocument } from '@b20/core';

export interface VisualSceneDraft { ownerId: string; projectId: string; version: number; document: VisualSceneDocument; savedAt: number }
const DATABASE = 'b20-visual-scene-drafts-v1';
const STORE = 'drafts';
const memory = new Map<string, VisualSceneDraft>();
let database: Promise<IDBDatabase> | undefined;
const key = (ownerId: string, projectId: string) => JSON.stringify([ownerId, projectId]);

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Este navegador no permite conservar borradores.'));
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error ?? new Error('No se pudo abrir el borrador.')); };
    request.onblocked = () => { database = undefined; reject(new Error('Cierra otra pestaña para recuperar el borrador.')); };
  });
  return database;
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode); const request = operation(tx.objectStore(STORE));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('No se pudo conservar el borrador.'));
    tx.onerror = () => reject(tx.error ?? new Error('No se pudo conservar el borrador.'));
  });
}
export async function readVisualSceneDraft(ownerId: string, projectId: string): Promise<VisualSceneDraft | undefined> {
  let value: VisualSceneDraft | undefined;
  try { value = await transaction('readonly', store => store.get(key(ownerId, projectId))); }
  catch { value = memory.get(key(ownerId, projectId)); }
  if (!value || value.ownerId !== ownerId || value.projectId !== projectId || !Number.isInteger(value.version)) return undefined;
  try { return { ...value, document: cleanVisualSceneDocument(value.document) }; } catch { return undefined; }
}
export async function writeVisualSceneDraft(value: VisualSceneDraft): Promise<boolean> {
  const copy = { ...value, document: cleanVisualSceneDocument(value.document) };
  memory.set(key(value.ownerId, value.projectId), copy);
  try { await transaction('readwrite', store => store.put(copy, key(value.ownerId, value.projectId))); return true; }
  catch { return false; }
}
export async function deleteVisualSceneDraft(ownerId: string, projectId: string): Promise<void> {
  memory.delete(key(ownerId, projectId));
  try { await transaction('readwrite', store => store.delete(key(ownerId, projectId))); } catch { /* In-memory drafts are already removed. */ }
}
/** Private production drafts must never survive a change of signed-in account. */
export async function clearVisualSceneDrafts(): Promise<void> {
  memory.clear();
  try { await transaction('readwrite', store => store.clear()); } catch { /* IndexedDB may be unavailable. */ }
}
