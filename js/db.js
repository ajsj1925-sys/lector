/* Lector · almacenamiento local (IndexedDB). Todo se guarda en el propio dispositivo.
   Almacenes:
   - series   {id, title, kind:'anime'|'manga', cover, desc, source, addedAt, lastAt}
   - items    {id, seriesId, num, title, kind, fileKey, size, pos, total, done, lastAt}
   - files    {key, blob, name, type}          ← los archivos de verdad (vídeos, cbz, imágenes)
   - addons   {id, name, type:'telegram'|'streaming', enabled, ...}
   - kv       {k, v}                           ← ajustes sueltos
*/
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('lector', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('series', { keyPath: 'id' });
        const it = d.createObjectStore('items', { keyPath: 'id' });
        it.createIndex('seriesId', 'seriesId');
        d.createObjectStore('files', { keyPath: 'key' });
        d.createObjectStore('addons', { keyPath: 'id' });
        d.createObjectStore('kv', { keyPath: 'k' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  async function store(name, mode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name); }

  return {
    async all(name) { return wrap((await store(name)).getAll()); },
    async get(name, key) { return wrap((await store(name)).get(key)); },
    async put(name, val) { return wrap((await store(name, 'readwrite')).put(val)); },
    async del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },
    async byIndex(name, index, val) { return wrap((await store(name)).index(index).getAll(val)); },
    async getKV(k, def) { const r = await this.get('kv', k); return r ? r.v : def; },
    async setKV(k, v) { return this.put('kv', { k, v }); },
    uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
  };
})();
