// Thin promise wrapper around IndexedDB.
// Stores: projects (metadata + frame order), frames (image blobs), blobs (audio, backgrounds).

const DB_NAME = 'mesora-studio';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('frames')) {
        db.createObjectStore('frames', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const complete = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error);
});

export async function put(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return complete(tx);
}

export async function get(store, key) {
  const db = await openDB();
  return request(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await openDB();
  return request(db.transaction(store).objectStore(store).getAll());
}

export async function keysByIndex(store, index, value) {
  const db = await openDB();
  return request(db.transaction(store).objectStore(store).index(index).getAllKeys(value));
}

export async function del(store, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  if (!list.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const k of list) os.delete(k);
  return complete(tx);
}

export async function estimate() {
  try { return await navigator.storage?.estimate?.(); } catch { return null; }
}

export async function persist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
