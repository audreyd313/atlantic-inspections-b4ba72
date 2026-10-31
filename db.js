// Tiny IndexedDB wrapper. Stores: entities, inspections, photos, kv (settings).
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('property-inspections', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('entities', { keyPath: 'id' });
        d.createObjectStore('inspections', { keyPath: 'id' }).createIndex('entityId', 'entityId');
        d.createObjectStore('photos', { keyPath: 'id' }).createIndex('inspectionId', 'inspectionId');
        d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    get: (s, k) => tx(s, 'readonly', st => st.get(k)),
    put: (s, v, k) => tx(s, 'readwrite', st => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
    all: s => tx(s, 'readonly', st => st.getAll()),
    byIndex: (s, idx, v) => tx(s, 'readonly', st => st.index(idx).getAll(v)),
    clear: s => tx(s, 'readwrite', st => st.clear()),
  };
})();
