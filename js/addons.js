/* Lector · sistema de add-ons (fuentes) y gestor de descargas.
   Formato de un add-on: ver docs/ADDONS.md. Dos tipos:
   - streaming: un catálogo con búsqueda; se puede ver/leer online o descargar.
   - telegram:  uno de tus bots; se le piden cosas y lo que manda entra en la biblioteca.
*/
const Addons = (() => {
  async function list() { return (await DB.all('addons')).sort((a, b) => (a.builtin ? 1 : 0) - (b.builtin ? 1 : 0) || a.name.localeCompare(b.name)); }

  function validate(m) {
    if (!m || typeof m !== 'object') throw new Error('El add-on no es un JSON válido');
    if (!m.name) throw new Error('Falta "name"');
    if (!['streaming', 'telegram'].includes(m.type)) throw new Error('"type" debe ser "streaming" o "telegram"');
    if (m.type === 'streaming' && !m.search) throw new Error('Un add-on de streaming necesita "search"');
    if (m.type === 'telegram' && !m.bot) throw new Error('Un add-on de Telegram necesita "bot" (ej. @mibot)');
    return m;
  }

  async function install(source) {
    let m;
    if (typeof source === 'string') {
      const s = source.trim();
      if (s.startsWith('{')) m = JSON.parse(s);
      else { const r = await fetch(s); if (!r.ok) throw new Error('No se pudo descargar el add-on (' + r.status + ')'); m = await r.json(); m.manifestUrl = s; }
    } else m = source;
    validate(m);
    m.id = m.id || DB.uid();
    m.enabled = m.enabled !== false;
    m.installedAt = Date.now();
    await DB.put('addons', m);
    return m;
  }

  async function toggle(id) { const a = await DB.get('addons', id); a.enabled = !a.enabled; await DB.put('addons', a); return a; }
  async function remove(id) { await DB.del('addons', id); }

  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] ?? ''));

  /* Busca en todos los add-ons de streaming activos a la vez */
  async function search(q, kind) {
    const out = [];
    for (const a of (await list()).filter(a => a.enabled && a.type === 'streaming')) {
      try {
        let results;
        if (a.id === 'demo-stream') {
          const ql = q.toLowerCase();
          results = Demo.CATALOG.filter(c => !ql || c.title.toLowerCase().includes(ql));
        } else {
          const r = await fetch(fill(a.search, { q, kind: kind || '' }));
          results = (await r.json()).results || [];
        }
        if (kind) results = results.filter(r => !r.kind || r.kind === kind);
        out.push({ addon: a, results });
      } catch (e) { out.push({ addon: a, results: [], error: e.message }); }
    }
    return out;
  }

  /* Ficha completa de una serie de un add-on (con episodios/capítulos) */
  async function series(addon, id) {
    if (addon.id === 'demo-stream') {
      const c = Demo.CATALOG.find(c => c.id === id);
      return { ...c, items: Array.from({ length: c.count }, (_, i) => ({ num: i + 1, title: (c.kind === 'anime' ? 'Episodio ' : 'Capítulo ') + (i + 1), demo: true, size: c.kind === 'anime' ? 2.8e8 : 2e7 })) };
    }
    const r = await fetch(fill(addon.series, { id }));
    return r.json();
  }

  return { list, install, toggle, remove, search, series, validate };
})();

/* ---------- Descargas ---------- */
const Downloads = (() => {
  const jobs = [];            // {id, title, sub, total, got, state:'cola'|'bajando'|'hecho'|'error', err}
  let running = 0;
  const MAX = 2;
  const listeners = new Set();
  const emit = () => listeners.forEach(f => f());

  function on(f) { listeners.add(f); return () => listeners.delete(f); }
  function active() { return jobs.filter(j => j.state === 'cola' || j.state === 'bajando').length; }

  /* Añade a la biblioteca la serie (si no existe) y pone en cola sus elementos */
  async function enqueue(addon, s, items) {
    const sid = 'src-' + addon.id + '-' + s.id;
    if (!(await DB.get('series', sid))) {
      await DB.put('series', { id: sid, title: s.title, kind: s.kind, cover: s.cover, desc: s.desc || '', source: addon.name, demo: !!addon.builtin, hue: s.hue, addedAt: Date.now(), lastAt: 0, mode: s.kind === 'manga' ? 'rtl' : undefined });
    }
    for (const it of items) {
      const iid = sid + '-' + it.num;
      if (await DB.get('items', iid)) continue;
      jobs.push({ id: iid, sid, addon, s, it, title: s.title, sub: it.title, total: it.size || 0, got: 0, state: 'cola' });
    }
    emit(); pump();
  }

  async function pump() {
    while (running < MAX) {
      const j = jobs.find(j => j.state === 'cola');
      if (!j) break;
      running++; j.state = 'bajando'; emit();
      run(j).then(() => { j.state = 'hecho'; }, e => { j.state = 'error'; j.err = e.message; })
        .finally(() => { running--; emit(); pump(); });
    }
  }

  async function run(j) {
    const base = { id: j.id, seriesId: j.sid, num: j.it.num, title: j.it.title, kind: j.s.kind, pos: 0, done: false, lastAt: 0 };
    if (j.it.demo) {
      // Simulación para el catálogo de ejemplo
      j.total = j.it.size;
      while (j.got < j.total) { await new Promise(r => setTimeout(r, 120)); j.got = Math.min(j.total, j.got + j.total / 18); emit(); }
      await DB.put('items', { ...base, demo: true, size: j.total, total: j.s.kind === 'anime' ? 1440 : 18 });
      return;
    }
    if (j.it.pages) { // capítulo de manga como lista de imágenes
      const key = 'f-' + j.id; const blobs = [];
      j.total = j.it.pages.length;
      for (const u of j.it.pages) { blobs.push(await (await fetch(u)).blob()); j.got++; emit(); }
      const keys = [];
      for (const [i, b] of blobs.entries()) { const k = key + '-' + i; keys.push(k); await DB.put('files', { key: k, blob: b, name: 'p' + i, type: b.type }); }
      await DB.put('items', { ...base, pageKeys: keys, size: blobs.reduce((a, b) => a + b.size, 0), total: keys.length });
      return;
    }
    const r = await fetch(j.it.url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    j.total = +r.headers.get('content-length') || j.total;
    const reader = r.body.getReader(); const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); j.got += value.length; emit(); }
    const blob = new Blob(chunks, { type: j.it.type || r.headers.get('content-type') || '' });
    const key = 'f-' + j.id;
    await DB.put('files', { key, blob, name: j.it.title, type: blob.type });
    await DB.put('items', { ...base, fileKey: key, size: blob.size, total: 0 });
  }

  function clearDone() { for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].state === 'hecho') jobs.splice(i, 1); emit(); }
  function cancel(id) { const i = jobs.findIndex(j => j.id === id && j.state === 'cola'); if (i >= 0) jobs.splice(i, 1); emit(); }

  return { jobs, on, enqueue, active, clearDone, cancel };
})();
