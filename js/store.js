// Almacenamiento local en el teléfono (IndexedDB): proyectos, datos en caché,
// ajustes y observaciones pendientes de enviar. Funciona sin señal.

let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('recorrido-obra', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('obs', { keyPath: 'id' }).createIndex('proyecto', 'proyecto');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    t.onerror = () => rej(t.error);
  });
}

export const kv = {
  get: (k) => tx('kv', 'readonly', (s) => s.get(k)),
  set: (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)),
  del: (k) => tx('kv', 'readwrite', (s) => s.delete(k)),
};

export const obsDB = {
  todas: (proyecto) => tx('obs', 'readonly', (s) => s.index('proyecto').getAll(proyecto)),
  get: (id) => tx('obs', 'readonly', (s) => s.get(id)),
  guardar: (o) => tx('obs', 'readwrite', (s) => s.put(o)),
  borrar: (id) => tx('obs', 'readwrite', (s) => s.delete(id)),
};

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 13);
}
