/* Lector · sistema de add-ons (fuentes) y gestor de descargas.
   Formato de un add-on: ver docs/ADDONS.md. Tres tipos:
   - streaming: un catálogo con búsqueda (formato propio); se puede ver/leer online o descargar.
   - stremio:   cualquier add-on con el protocolo abierto de Stremio (se instala con la URL de su manifest.json).
   - telegram:  uno de tus bots; se le piden cosas y lo que manda entra en la biblioteca.
   Lector no trae ningún add-on de contenido: cada uno instala los suyos.
*/
const Addons = (() => {
  async function list() { return (await DB.all('addons')).sort((a, b) => (a.builtin ? 1 : 0) - (b.builtin ? 1 : 0) || a.name.localeCompare(b.name)); }

  function validate(m) {
    if (!m || typeof m !== 'object') throw new Error('El add-on no es un JSON válido');
    if (!m.name) throw new Error('Falta "name"');
    if (!['streaming', 'telegram', 'stremio'].includes(m.type)) throw new Error('"type" debe ser "streaming", "stremio" o "telegram"');
    if (m.type === 'stremio' && !m.base) throw new Error('Falta la dirección del add-on de Stremio');
    if (m.type === 'streaming' && !m.search) throw new Error('Un add-on de streaming necesita "search"');
    if (m.type === 'telegram' && !m.bot) throw new Error('Un add-on de Telegram necesita "bot" (ej. @mibot)');
    return m;
  }

  async function install(source) {
    let m;
    if (typeof source === 'string') {
      const s = source.trim();
      if (s.startsWith('{')) m = JSON.parse(s);
      else {
        let u = s.replace(/^stremio:\/\//i, 'https://');
        let r;
        try { r = await fetch(u); } catch { throw new Error('No se pudo abrir esa dirección (sin conexión o la fuente no permite el acceso desde apps web)'); }
        if (!r.ok && !/\.json(\?|$)/.test(u)) { const u2 = u.replace(/\/$/, '') + '/manifest.json'; const r2 = await fetch(u2).catch(() => null); if (r2?.ok) { u = u2; r = r2; } }
        if (!r.ok) throw new Error('No se pudo descargar el add-on (' + r.status + ')');
        m = await r.json(); m.manifestUrl = u;
      }
    } else m = source;
    if (!m.type && (m.resources || m.catalogs)) m = fromStremio(m);
    validate(m);
    m.id = m.id || DB.uid();
    m.enabled = m.enabled !== false;
    m.installedAt = Date.now();
    await DB.put('addons', m);
    return m;
  }

  /* Manifest de Stremio → add-on de Lector */
  function fromStremio(man) {
    const base = (man.manifestUrl || '').replace(/\/manifest\.json(\?.*)?$/, '');
    const res = (man.resources || []).map(r => typeof r === 'string' ? r : r.name);
    return {
      type: 'stremio', id: 'st-' + String(man.id || DB.uid()).replace(/[^\w.-]/g, '_'), name: man.name || 'Add-on', version: man.version, desc: man.description || '',
      logo: man.logo, base, manifestUrl: man.manifestUrl, catalogs: (man.catalogs || []).slice(0, 12), hasMeta: res.includes('meta'), hasStream: res.includes('stream'),
    };
  }
  const stFetch = async (a, path) => { const r = await fetch(a.base + '/' + path); if (!r.ok) throw new Error('La fuente respondió ' + r.status); return r.json(); };
  const stCard = (type, m) => ({ id: type + '|' + m.id, title: m.name, kind: 'anime', cover: m.poster || m.logo || '', desc: m.description || '' });
  const needsExtra = c => (c.extra || []).some(e => e.isRequired) || (c.extraRequired || []).length;
  const canSearch = c => (c.extra || []).some(e => e.name === 'search') || (c.extraSupported || []).includes('search');

  /* Primeras filas de cada add-on (lo que se ve en Explorar sin buscar nada) */
  async function home() {
    const out = [];
    for (const a of (await list()).filter(a => a.enabled && (a.type === 'stremio' || (a.type === 'streaming' && a.catalog)))) {
      try {
        if (a.type === 'streaming') { const r = await fetch(a.catalog); out.push({ addon: a, title: a.name, results: (await r.json()).results || [] }); continue; }
        for (const c of a.catalogs.filter(c => !needsExtra(c)).slice(0, 3)) {
          const j = await stFetch(a, `catalog/${c.type}/${encodeURIComponent(c.id)}.json`);
          out.push({ addon: a, title: a.name + ' · ' + (c.name || c.type), results: (j.metas || []).map(m => stCard(c.type, m)) });
        }
      } catch (e) { out.push({ addon: a, title: a.name, results: [], error: e.message }); }
    }
    return out;
  }

  /* Enlaces de vídeo de un episodio (Stremio) */
  async function streams(a, it) {
    const j = await stFetch(a, `stream/${it.stype}/${encodeURIComponent(it.vid)}.json`);
    return (j.streams || []).map(s => ({
      label: [s.name, s.title || s.description].filter(Boolean).join(' · ').replace(/\n/g, ' ') || 'Enlace',
      url: s.url, yt: s.ytId, ext: s.externalUrl, torrent: !!s.infoHash, hls: /\.m3u8(\?|$)/i.test(s.url || ''),
    }));
  }

  async function toggle(id) { const a = await DB.get('addons', id); a.enabled = !a.enabled; await DB.put('addons', a); return a; }
  async function remove(id) { await DB.del('addons', id); }

  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] ?? ''));

  /* Busca en todos los add-ons de streaming activos a la vez */
  async function search(q, kind) {
    const out = [];
    for (const a of (await list()).filter(a => a.enabled && (a.type === 'streaming' || (a.type === 'stremio' && q && a.catalogs.some(canSearch))))) {
      try {
        let results;
        if (a.id === 'demo-stream') {
          const ql = q.toLowerCase();
          results = Demo.CATALOG.filter(c => !ql || c.title.toLowerCase().includes(ql));
        } else if (a.type === 'stremio') {
          results = [];
          for (const c of a.catalogs.filter(canSearch).slice(0, 4)) {
            const j = await stFetch(a, `catalog/${c.type}/${encodeURIComponent(c.id)}/search=${encodeURIComponent(q)}.json`);
            results.push(...(j.metas || []).map(m => stCard(c.type, m)));
          }
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
    if (addon.type === 'stremio') {
      const [type, mid] = [id.slice(0, id.indexOf('|')), id.slice(id.indexOf('|') + 1)];
      let m = { id: mid, name: mid };
      if (addon.hasMeta) m = (await stFetch(addon, `meta/${type}/${encodeURIComponent(mid)}.json`)).meta || m;
      const vids = (m.videos || []).slice().sort((a, b) => (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0));
      const items = vids.length
        ? vids.map((v, i) => ({ num: i + 1, title: (v.season != null && v.episode != null ? `T${v.season} E${v.episode}` : 'Episodio ' + (i + 1)) + (v.title || v.name ? ' · ' + (v.title || v.name) : ''), vid: v.id, stype: type }))
        : [{ num: 1, title: m.name, vid: mid, stype: type }];
      return { id, title: m.name, kind: 'anime', cover: m.poster || '', banner: m.background, desc: m.description || '', items };
    }
    const r = await fetch(fill(addon.series, { id }));
    return r.json();
  }

  return { list, install, toggle, remove, search, series, validate, home, streams, fromStremio };
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

  /* Trabajo con su propio "runner" (lo usa Telegram) */
  function add(job) { if (jobs.some(x => x.id === job.id && x.state !== 'error')) return; jobs.push({ got: 0, state: 'cola', ...job }); emit(); pump(); }

  async function run(j) {
    if (j.runner) return j.runner(j);
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
    if (!j.it.url && j.it.vid) { // Stremio: buscar un enlace directo descargable
      const ss = (await Addons.streams(j.addon, j.it)).filter(s => s.url && !s.hls);
      if (!ss.length) throw new Error('Esta fuente no da un enlace descargable');
      j.it.url = ss[0].url;
    }
    let r;
    try { r = await fetch(j.it.url); } catch { throw new Error('La fuente no deja descargar desde apps web'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    j.total = +r.headers.get('content-length') || j.total;
    const reader = r.body.getReader(); const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); j.got += value.length; emit(); }
    let blob = new Blob(chunks, { type: j.it.type || r.headers.get('content-type') || '' });
    return saveDownloaded(j, base, blob, j.it.name || (j.it.url || '').split('/').pop().split('?')[0] || j.it.title);
  }

  /* Guarda un archivo bajado (de streaming o de Telegram): comprueba espacio, convierte MKV y detecta el formato */
  async function saveDownloaded(j, base, blob, name) {
    if (!(await Space.ensure(blob.size))) throw new Error('No hay espacio en el dispositivo');
    const key = 'f-' + j.id;
    if (j.s.kind === 'anime') {
      j.sub = 'Preparando vídeo…'; emit();
      const v = await App.convertVideo(new File([blob], name, { type: blob.type }), j.title);
      const subKeys = [];
      for (const [i, sb] of v.subs.entries()) { const sk = key + '-s' + i; await DB.put('files', { key: sk, blob: sb.blob, name: sb.name, type: 'text/vtt' }); subKeys.push(sk); }
      await DB.put('files', { key, blob: v.blob, name: v.name, type: v.blob.type });
      await DB.put('items', { ...base, fileKey: key, size: v.blob.size, total: 0, subKeys, convErr: v.err });
    } else {
      await DB.put('files', { key, blob, name, type: blob.type || 'application/octet-stream' });
      let total = 0; try { total = (await Formats.pages(blob, name)).length; } catch { }
      await DB.put('items', { ...base, fileKey: key, size: blob.size, total });
    }
  }

  function clearDone() { for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].state === 'hecho') jobs.splice(i, 1); emit(); }
  function cancel(id) { const i = jobs.findIndex(j => j.id === id && j.state === 'cola'); if (i >= 0) jobs.splice(i, 1); emit(); }

  return { jobs, on, add, enqueue, active, clearDone, cancel, saveDownloaded, emit, pump };
})();
