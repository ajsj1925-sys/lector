/* Lector · copia de seguridad y sincronización del progreso.
   Backup.data()   → objeto con biblioteca (sin los archivos pesados), progreso, listas, notas, add-ons y ajustes.
   Backup.merge(o) → mezcla una copia con lo que hay: por cada capítulo gana el progreso más reciente.
   Se usa para: exportar/importar un archivo .json y para sincronizar por Telegram (Mensajes guardados). */
const Backup = (() => {
  const KV = ['readerPrefs', 'playerPrefs', 'theme', 'lists', 'subOn', 'autoClean', 'autoMeta', 'follow'];
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  async function data({ settings = true } = {}) {
    const series = (await DB.all('series')).filter(s => !s.demo);
    const ids = new Set(series.map(s => s.id));
    const items = (await DB.all('items')).filter(i => ids.has(i.seriesId)).map(i => ({
      id: i.id, seriesId: i.seriesId, num: i.num, title: i.title, kind: i.kind, pos: i.pos, total: i.total, done: i.done, lastAt: i.lastAt, size: i.size, src: i.src,
    }));
    const out = { app: 'lector', v: 1, date: new Date().toISOString(), device: navigator.userAgent.slice(0, 120), series, items };
    if (settings) {
      out.kv = {}; for (const k of KV) { const v = await DB.getKV(k); if (v !== undefined) out.kv[k] = v; }
      out.addons = (await DB.all('addons')).filter(a => !a.builtin);
    }
    return out;
  }

  async function merge(o, { settings = true } = {}) {
    if (!o || o.app !== 'lector') throw new Error('Este archivo no es una copia de Lector');
    const local = await DB.all('series');
    const map = {}; let newSeries = 0, updated = 0;
    for (const s of o.series || []) {
      let m = local.find(l => l.id === s.id) || local.find(l => l.kind === s.kind && norm(l.title) === norm(s.title));
      if (!m) { const { items, doneCount, size, ...clean } = s; await DB.put('series', { ...clean }); map[s.id] = s.id; newSeries++; continue; }
      map[s.id] = m.id;
      // datos de la serie: listas, nota, valoración, info de AniList (gana lo más reciente / lo que falte)
      const merged = { ...m };
      merged.lists = [...new Set([...(m.lists || []), ...(s.lists || [])])];
      if ((s.noteAt || 0) > (m.noteAt || 0)) { merged.note = s.note; merged.noteAt = s.noteAt; }
      if ((s.rateAt || 0) > (m.rateAt || 0)) { merged.rating = s.rating; merged.rateAt = s.rateAt; }
      if (!m.meta && s.meta) { merged.meta = s.meta; merged.desc = s.desc; if (!m.realCover) merged.cover = s.cover; merged.banner = s.banner; }
      if (s.reader && !m.reader) merged.reader = s.reader;
      merged.lastAt = Math.max(m.lastAt || 0, s.lastAt || 0);
      merged.follow = m.follow || s.follow;
      await DB.put('series', merged);
    }
    const localItems = await DB.all('items');
    for (const it of o.items || []) {
      const sid = map[it.seriesId]; if (!sid) continue;
      const m = localItems.find(l => l.seriesId === sid && l.num === it.num);
      if (!m) { await DB.put('items', { ...it, id: sid + '-r' + it.num, seriesId: sid, remote: true, size: 0 }); updated++; continue; }
      if ((it.lastAt || 0) > (m.lastAt || 0)) { m.pos = it.pos; m.total = it.total || m.total; m.done = it.done; m.lastAt = it.lastAt; await DB.put('items', m); updated++; }
    }
    if (settings && o.kv) for (const [k, v] of Object.entries(o.kv)) if (k !== 'theme' || !(await DB.getKV('theme'))) await DB.setKV(k, v);
    if (settings) for (const a of o.addons || []) if (!(await DB.get('addons', a.id))) await DB.put('addons', a);
    return { newSeries, updated };
  }

  function download(obj, name) {
    const b = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function exportFile() {
    const d = new Date().toISOString().slice(0, 10);
    download(await data(), `lector-copia-${d}.json`);
  }
  function importFile() {
    return new Promise((res, rej) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => { try { const f = inp.files[0]; if (!f) return res(null); res(await merge(JSON.parse(await f.text()))); } catch (e) { rej(e); } };
      inp.click();
    });
  }
  return { data, merge, exportFile, importFile };
})();
