/* Lector · interfaz principal (vistas, ficha de serie, importación, ajustes). */
const App = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VERSION = '0.5.0';
  const pl = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
  const DEF_LISTS = ['Leyendo', 'Pendiente', 'Favoritos', 'Abandonado'];
  const getLists = async () => DB.getKV('lists', DEF_LISTS);
  const TITLES = { inicio: 'Inicio', biblioteca: 'Biblioteca', explorar: 'Explorar', descargas: 'Descargas', ajustes: 'Ajustes' };
  const ui = { view: 'inicio', libKind: 'all', libSort: 'recent', libQ: '', exKind: 'anime', exQ: '', exGenre: '', detail: null, dTab: 'eps', dSort: 'asc', dUnread: false, hero: 0, libList: '' };
  const ACCENTS = ['#ff7a45', '#f43f5e', '#ec4899', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b'];

  /* ---------- utilidades ---------- */
  function fmtSize(b) { if (!b) return '0 MB'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i > 2 ? 1 : 0) + ' ' + u[i]; }
  function fmtTime(s) { s = Math.round(s); const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; }
  let tt; function toast(m, sticky) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); if (!sticky) tt = setTimeout(() => t.classList.remove('on'), 2600); }
  const progress = m => toast(m, true);
  /* MKV → MP4 (+ subtítulos internos). Devuelve { blob, name, subs:[{name, blob}] } o el original si no se puede */
  async function convertVideo(f, label = f.name) {
    if (!Mkv.isMkv(f.name, f.type)) return { blob: f, name: f.name, subs: [] };
    try {
      const r = await Mkv.toMp4(f, p => progress(`Convirtiendo ${label} a MP4… ${Math.round(p * 100)} %`));
      return { blob: r.mp4, name: f.name.replace(/\.mkv$/i, '.mp4'), subs: r.subs.map(x => ({ name: x.name + '.vtt', blob: new Blob([x.vtt], { type: 'text/vtt' }), def: x.def })), converted: true };
    } catch (e) { return { blob: f, name: f.name, subs: [], err: e.message }; }
  }
  const hueOf = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  function sheet(html, init) {
    const w = $('#sheet'); w.hidden = false;
    w.innerHTML = `<div class="sheet">${html}</div>`;
    const close = () => { w.hidden = true; w.innerHTML = ''; };
    w.onclick = e => { if (e.target === w || e.target.closest('[data-close]')) close(); };
    init?.(w, close);
    return close;
  }
  function confirmSheet(msg, okText = 'Borrar') {
    return new Promise(res => sheet(`<h3>${esc(msg)}</h3><div class="acts"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">${esc(okText)}</button></div>`,
      (w, close) => { $('#ok', w).onclick = () => { close(); res(true); }; w.addEventListener('click', e => { if (e.target === w || e.target.closest('[data-close]')) res(false); }); }));
  }

  /* ---------- datos ---------- */
  async function libraryData() {
    const [series, items] = await Promise.all([DB.all('series'), DB.all('items')]);
    const by = {};
    for (const it of items) (by[it.seriesId] ||= []).push(it);
    for (const s of series) {
      s.items = (by[s.id] || []).sort((a, b) => a.num - b.num);
      s.doneCount = s.items.filter(i => i.done).length;
      s.size = s.items.reduce((a, i) => a + (i.size || 0), 0);
    }
    return series;
  }
  function continueItem(s) {
    const its = s.items; if (!its.length) return null;
    const recent = its.filter(i => i.lastAt).sort((a, b) => b.lastAt - a.lastAt)[0];
    if (!recent) return its.find(i => !i.done) || its[0];
    if (!recent.done) return recent;
    return its.find(i => i.num > recent.num && !i.done) || null;
  }
  async function touch(series, item) {
    const now = Date.now();
    const s = await DB.get('series', series.id); if (s) { s.lastAt = now; await DB.put('series', s); }
    const it = await DB.get('items', item.id); if (it) { it.lastAt = now; await DB.put('items', it); }
  }
  async function saveProgress(item, pos, total, done) {
    const it = await DB.get('items', item.id); if (!it) return;
    it.pos = pos; it.total = total || it.total; it.done = done || it.done && pos >= (it.total || 0) - 1; it.lastAt = Date.now();
    Object.assign(item, it);
    await DB.put('items', it);
  }
  async function adjacent(item, dir) {
    const its = (await DB.byIndex('items', 'seriesId', item.seriesId)).sort((a, b) => a.num - b.num);
    const i = its.findIndex(x => x.id === item.id);
    return its[i + dir] || null;
  }
  async function saveSeriesMode(series, mode) { const s = await DB.get('series', series.id); if (s) { s.mode = mode; await DB.put('series', s); } }
  async function saveSeriesReader(series, cfg) { const s = await DB.get('series', series.id); if (s) { s.reader = cfg; await DB.put('series', s); } }
  async function applyTheme() {
    const t = await DB.getKV('theme', { mode: 'dark', ac: ACCENTS[0] });
    document.documentElement.dataset.theme = t.mode;
    document.documentElement.style.setProperty('--ac', t.ac);
    document.querySelector('meta[name=theme-color]').content = { dark: '#0b0c10', amoled: '#000000', light: '#f4f5f8' }[t.mode];
    return t;
  }

  function play(series, item) {
    const done = () => refresh();
    if (series.kind === 'anime') Player.open(item, series, done); else Reader.open(item, series, done);
  }

  const previews = new Map(); // tarjetas de add-ons vistas (título y portada por si la fuente no da ficha)
  const ridOf = id => id.split(':').slice(2).join(':'); // 'r:<addon>:<id de la fuente>' (el id puede llevar ':')

  /* ---------- piezas de interfaz ---------- */
  const tag = k => `<span class="tag ${k}">${k}</span>`;
  const playIco = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>';
  const isNew = s => s.items && !s.lastAt && Date.now() - s.addedAt < 3 * 86400000;
  function cardHTML(s, extra = '') {
    const p = s.items?.length ? s.doneCount / s.items.length : 0;
    return `<button class="card ${ui.detail?.id === s.id ? 'sel' : ''}" data-series="${esc(s.id)}" ${extra}>
      <div class="cv"><img src="${esc(s.cover)}" alt="" loading="lazy">${tag(s.kind)}${isNew(s) ? '<span class="newb">NUEVO</span>' : ''}${p ? `<div class="prog"><i style="width:${p * 100}%"></i></div>` : ''}<div class="hov"><span>${playIco}</span></div></div>
      <b>${esc(s.title)}</b><div class="tiny">${s.items ? (s.doneCount === s.items.length && s.items.length ? 'Terminado' : `${s.doneCount}/${s.items.length} ${s.kind === 'anime' ? 'vistos' : 'leídos'}`) : esc(s.sourceName || '')}</div></button>`;
  }
  const leftTxt = (s, it) => s.kind === 'anime' ? (it.total && it.pos ? `quedan ${fmtTime(it.total - it.pos)}` : 'Sin empezar') : (it.total && it.pos ? `pág. ${it.pos + 1} de ${it.total}` : 'Sin empezar');
  function contHTML(s, it) {
    const frac = it.total ? Math.min(1, it.pos / it.total) : 0;
    return `<button class="cont" data-play="${esc(s.id)}|${esc(it.id)}">
      <div class="cv"><img src="${esc(s.cover)}" alt=""></div>
      <div class="info"><b>${esc(s.title)}</b><div class="muted">${esc(it.title)}</div><div class="tiny">${leftTxt(s, it)}</div>
      <div class="bar"><i style="width:${frac * 100}%"></i></div></div>
      <span class="play">${playIco}</span></button>`;
  }
  const arrows = id => `<span class="rail-nav"><button data-rail="${id}|-1" title="Anterior"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><button data-rail="${id}|1" title="Siguiente"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></span>`;
  const railHTML = (id, title, list, wide) => list.length ? `<h2 class="sec">${title} <span class="count">${list.length}</span>${arrows(id)}</h2><div class="rail ${wide ? 'wide' : ''}" id="rail-${id}">${list.join('')}</div>` : '';
  function heroHTML(list) {
    if (!list.length) return '';
    const i = ui.hero % list.length, [s, it] = list[i];
    const frac = it.total ? Math.min(1, it.pos / it.total) : 0;
    const verb = s.kind === 'anime' ? 'Ver' : 'Leer';
    return `<section class="hero" id="hero"><div class="hero-bg ${s.banner ? 'sharp' : ''}" style="background-image:url(&quot;${esc(s.banner || s.cover)}&quot;)"></div>
      <div class="hero-in" data-k="${i}"><div class="cv"><img src="${esc(s.cover)}" alt=""></div>
        <div class="hero-txt"><div class="kicker">${it.pos || it.lastAt ? 'Continuar ' + (s.kind === 'anime' ? 'viendo' : 'leyendo') : 'Empieza'}</div>
          <h2>${esc(s.title)}</h2>
          <div class="hero-meta"><span>${s.kind === 'anime' ? 'Anime' : 'Manga'}</span>·<span>${esc(it.title)}</span>·<span>${leftTxt(s, it)}</span></div>
          ${frac ? `<div class="hero-prog"><i style="width:${frac * 100}%"></i></div>` : ''}
          ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
          <div class="hero-acts"><button class="btn primary" data-play="${esc(s.id)}|${esc(it.id)}">${playIco}${it.pos ? 'Continuar' : verb}</button>
          <button class="btn glass" data-series="${esc(s.id)}">Ficha</button></div></div></div>
      ${list.length > 1 ? `<div class="dots">${list.map((_, k) => `<button data-hero="${k}" class="${k === i ? 'on' : ''}" title="${esc(list[k][0].title)}"></button>`).join('')}</div>` : ''}</section>`;
  }
  /* Filas del catálogo en Inicio (si no hay conexión ni caché, no se muestran) */
  async function discover() {
    const one = async k => { try { const r = await Promise.race([Catalog.home(k), new Promise((_, no) => setTimeout(() => no(new Error('lento')), 6000))]); return r[0][2]; } catch { return []; } };
    const [an, ma] = await Promise.all([one('anime'), one('manga')]);
    return railHTML('dA', 'Anime en tendencia', an.map(c => cardHTML(c))) + railHTML('dM', 'Manga en tendencia', ma.map(c => cardHTML(c)));
  }
  const emptyLib = small => small ? `<div class="empty small"><b>Tu biblioteca está vacía</b>Añade tus archivos, pídeselos a tus bots o mira el catálogo.<div><button class="btn primary" data-act="import">Añadir archivos</button> <button class="btn" data-go="explorar">Explorar</button></div></div>` : `<div class="empty"><b>Tu biblioteca está vacía</b>Añade archivos de anime o manga desde este dispositivo, o descárgalos desde Explorar.
    <div><button class="btn primary" data-act="import">Añadir archivos</button> <button class="btn" data-go="explorar">Ir a Explorar</button></div></div>`;

  /* ---------- vistas ---------- */
  const views = {
    async inicio() {
      const lib = await libraryData();
      if (!lib.length) return emptyLib(true) + await discover();
      const cont = lib.filter(s => s.lastAt).sort((a, b) => b.lastAt - a.lastAt).map(s => [s, continueItem(s)]).filter(x => x[1]);
      const heroList = cont.slice(0, 5); ui.heroList = heroList;
      const recent = [...lib].sort((a, b) => b.addedAt - a.addedAt).slice(0, 15);
      const pending = lib.filter(s => !s.lastAt && s.items.length).sort((a, b) => b.addedAt - a.addedAt);
      const done = lib.filter(s => s.items.length && s.doneCount === s.items.length);
      const by = k => lib.filter(s => s.kind === k).sort((a, b) => (b.lastAt || b.addedAt) - (a.lastAt || a.addedAt));
      const news = (await DB.getKV('news', [])).slice(0, 12);
      const newsHTML = news.map(n => { const ser = lib.find(x => x.id === n.seriesId); return `<button class="cont" data-act="openNews" data-news="${esc(n.id)}"><div class="cv"><img src="${esc(ser?.cover || '')}" alt=""></div><div class="info"><b>${esc(n.title)}</b><div class="muted">${esc(n.sub)}</div><div class="tiny">${new Date(n.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</div></div><span class="play">↓</span></button>`; });
      return heroHTML(heroList)
        + railHTML('news', 'Novedades', newsHTML, true)
        + railHTML('cont', 'Continuar', cont.map(([s, it]) => contHTML(s, it)), true)
        + railHTML('new', 'Añadido recientemente', recent.map(s => cardHTML(s)))
        + railHTML('pend', 'Por empezar', pending.map(s => cardHTML(s)))
        + railHTML('anime', 'Anime', by('anime').map(s => cardHTML(s)))
        + railHTML('manga', 'Manga', by('manga').map(s => cardHTML(s)))
        + railHTML('fav', 'Favoritos', lib.filter(s => (s.lists || []).includes('Favoritos')).map(s => cardHTML(s)))
        + railHTML('done', 'Terminados', done.map(s => cardHTML(s)))
        + await discover();
    },

    async biblioteca() {
      let lib = await libraryData();
      if (!lib.length) return emptyLib();
      if (ui.libKind !== 'all') lib = lib.filter(s => s.kind === ui.libKind);
      if (ui.libQ) lib = lib.filter(s => norm(s.title).includes(norm(ui.libQ)) || (s.meta?.genres || []).some(g => norm(g).includes(norm(ui.libQ))));
      if (ui.libList) lib = lib.filter(s => (s.lists || []).includes(ui.libList));
      const lists = await getLists();
      const sorters = { recent: (a, b) => (b.lastAt || b.addedAt) - (a.lastAt || a.addedAt), az: (a, b) => a.title.localeCompare(b.title), added: (a, b) => b.addedAt - a.addedAt };
      sorters.rating = (a, b) => (b.rating || 0) - (a.rating || 0);
      lib.sort(sorters[ui.libSort]);
      return `<div class="toolbar">
          <div class="chips" data-chips="libKind">${[['all', 'Todo'], ['anime', 'Anime'], ['manga', 'Manga']].map(([k, l]) => `<button class="chip ${ui.libKind === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
          ${ui.libQ ? `<button class="chip on" data-act="clearQ">“${esc(ui.libQ)}” ✕</button>` : ''}
          <select id="libSort" style="width:auto">${[['recent', 'Última actividad'], ['added', 'Añadido'], ['az', 'A–Z'], ['rating', 'Mi valoración']].map(([k, l]) => `<option value="${k}" ${ui.libSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="chips lists" data-chips="libList"><span class="tiny">Listas:</span><button class="chip ${!ui.libList ? 'on' : ''}" data-v="">Todas</button>${lists.map(l => `<button class="chip ${ui.libList === l ? 'on' : ''}" data-v="${esc(l)}">${esc(l)}</button>`).join('')}<button class="chip ghost" data-act="editLists">✎ Editar</button></div>
        ${lib.length ? `<div class="grid">${lib.map(s => cardHTML(s)).join('')}</div>` : `<p class="muted">Nada coincide.</p>`}`;
    },

    async explorar() {
      const addons = (await Addons.list()).filter(a => a.enabled);
      const bots = addons.filter(a => a.type === 'telegram');
      const kind = ui.exKind === 'manga' ? 'manga' : 'anime', q = ui.exQ.trim();
      const head = `<div class="toolbar ex-tools">
        <input type="search" id="exQ" placeholder="Buscar anime o manga…" value="${esc(ui.exQ)}">
        <div class="seg" data-chips="exKind">${[['anime', 'Anime'], ['manga', 'Manga']].map(([k, l]) => `<button class="${kind === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div></div>
        ${q ? '' : `<div class="chips genres-row" data-chips="exGenre"><button class="chip ${!ui.exGenre ? 'on' : ''}" data-v="">Todo</button>${Catalog.GENRES.map(([g, l]) => `<button class="chip ${ui.exGenre === g ? 'on' : ''}" data-v="${esc(g)}">${l}</button>`).join('')}</div>`}`;
      const botRow = bots.length ? `<div class="bots">${bots.map(b => `<button class="bot" data-bot="${esc(b.id)}"><span class="ico tg">${tgIcon}</span><span class="grow"><b>${esc(b.name)}</b><span class="tiny">${q ? `Pedir “${esc(q)}”` : esc(b.bot)}</span></span></button>`).join('')}</div>` : '';
      const fail = e => `<p class="muted cat-err">${esc(e.message)} <button class="chip" data-act="retryCat">Reintentar</button></p>`;
      const cards = (id, title, list) => railHTML(id, title, list.map(c => cardHTML(c)));
      let body = '';
      if (q) {
        let cat = ''; try { const r = await Catalog.browse(kind, q); cat = r.length ? `<h2 class="sec">Catálogo <span class="count">${r.length}</span></h2><div class="grid">${r.map(c => cardHTML(c)).join('')}</div>` : `<p class="muted">Nada en el catálogo con “${esc(q)}”.</p>`; } catch (e) { cat = fail(e); }
        const res = await Addons.search(q, kind);
        body = cat + res.filter(x => x.results.length || x.error).map(({ addon, results, error }) => `<h2 class="sec">${esc(addon.name)} <span class="tiny">${error ? 'Error: ' + esc(error) : results.length + ' resultados'}</span></h2>
          ${results.length ? `<div class="grid">${results.map(r => { const c = { ...r, sourceName: addon.name, id: 'r:' + addon.id + ':' + r.id }; previews.set(c.id, c); return cardHTML(c); }).join('')}</div>` : ''}`).join('');
      } else if (ui.exGenre) {
        try { const r = await Catalog.browse(kind, '', ui.exGenre); body = `<div class="grid">${r.map(c => cardHTML(c)).join('')}</div>`; } catch (e) { body = fail(e); }
      } else {
        const wish = (await Catalog.wish()).filter(w => w.kind === kind);
        body += cards('wish', kind === 'anime' ? 'Quiero verlo' : 'Quiero leerlo', wish);
        try { for (const [id, title, list] of await Catalog.home(kind)) body += cards('c' + id, title, list); } catch (e) { body += fail(e); }
        const own = await Addons.home(kind);
        own.forEach(({ addon, title, results, error }, i) => { body += error ? `<h2 class="sec">${esc(title)} <span class="tiny">Error: ${esc(error)}</span></h2>` : cards('a' + i, esc(title), results.map(r => { const c = { ...r, sourceName: addon.name, id: 'r:' + addon.id + ':' + r.id }; previews.set(c.id, c); return c; })); });
        for (const { addon, results } of await Addons.search('', '')) if (addon.type === 'streaming' && !addon.catalog && results.length) body += cards('s' + addon.id, esc(addon.name), results.map(r => { const c = { ...r, sourceName: addon.name, id: 'r:' + addon.id + ':' + r.id }; previews.set(c.id, c); return c; }));
        if (!addons.some(a => a.type !== 'telegram')) body += `<p class="tiny ex-foot">El catálogo muestra fichas, tráileres y dónde verlo de forma oficial. Para ver o descargar episodios: tus bots de Telegram o un add-on que instales en <a href="#" data-act="addAddon" style="color:var(--ac)">+ Añadir add-on</a>.</p>`;
      }
      return head + botRow + body;
    },

    async descargas() {
      const jobs = Downloads.jobs;
      const est = await storageInfo();
      const lib = (await libraryData()).filter(s => s.size).sort((a, b) => b.size - a.size);
      const jobHTML = j => {
        const p = j.total ? j.got / j.total : 0;
        return `<div class="row"><div class="grow"><b>${esc(j.title)}</b><span class="tiny">${esc(j.sub)} · ${{ cola: 'En cola', bajando: `${Math.round(p * 100)} % · ${fmtSize(j.got)} de ${fmtSize(j.total)}`, hecho: 'Completado', error: 'Error: ' + esc(j.err) }[j.state]}</span>
          <div class="bar"><i style="width:${(j.state === 'hecho' ? 1 : p) * 100}%;${j.state === 'error' ? 'background:#e5484d' : ''}"></i></div></div>
          ${j.state === 'cola' ? `<button class="btn sm ghost" data-cancel="${esc(j.id)}">Quitar</button>` : ''}</div>`;
      };
      const queued = js => Object.values(js.filter(j => j.state === 'cola').reduce((a, j) => ((a[j.sid] ||= []).push(j), a), {}))
        .map(g => `<div class="row"><div class="grow"><b>${esc(g[0].title)}</b><span class="tiny">${g.length} en cola · ${esc(g[0].sub)}${g.length > 1 ? ' – ' + esc(g.at(-1).sub) : ''}</span></div><button class="btn sm ghost" data-cancelsid="${esc(g[0].sid)}">Quitar</button></div>`).join('');
      return `<div class="cols">
        <div class="panel"><h3>Descargando <span class="tiny">${Downloads.active()} activas</span>${jobs.some(j => j.state === 'hecho') ? '<button class="btn sm" data-act="clearDone">Limpiar</button>' : ''}</h3>
          ${jobs.length ? `<div class="list">${jobs.filter(j => j.state !== 'cola').map(jobHTML).join('')}${queued(jobs)}</div>` : '<p class="muted">No hay descargas. Busca algo en <a href="#" data-go="explorar" style="color:var(--ac)">Explorar</a> o pídeselo a uno de tus bots.</p>'}</div>
        <div class="panel"><h3>Espacio en este dispositivo</h3>
          ${est ? `<div class="kv"><span>Usado por Lector</span><b>${fmtSize(est.usage)}</b></div><div class="bar"><i style="width:${Math.min(100, est.usage / est.quota * 100)}%"></i></div>
          <div class="kv"><span>Disponible para Lector</span><span class="muted">${fmtSize(est.quota - est.usage)}</span></div>
          <div class="kv"><span>Protegido contra borrado</span><span class="muted">${est.persisted ? 'Sí' : 'No'}</span></div>` : '<p class="muted">Este navegador no informa del espacio.</p>'}
          ${isIOS() ? '<div class="note">En iPhone/iPad, instala Lector en la pantalla de inicio para que Safari no borre tus descargas.</div>' : ''}
          <h3 style="margin-top:14px">Por serie</h3>
          <div class="list">${lib.slice(0, 8).map(s => `<div class="row"><div class="grow"><b>${esc(s.title)}</b><span class="tiny">${s.items.length} ${s.kind === 'anime' ? 'episodios' : 'capítulos'}${s.demo ? ' · ejemplo' : ''}</span></div><span class="muted">${fmtSize(s.size)}</span></div>`).join('') || '<p class="muted">Nada guardado aún.</p>'}</div>
        </div></div>`;
    },

    async ajustes() {
      const addons = await Addons.list();
      const tg = await DB.getKV('telegram', {});
      const rp = await DB.getKV('readerPrefs', {});
      const theme = await DB.getKV('theme', { mode: 'dark', ac: ACCENTS[0] });
      const hasDemo = (await DB.all('series')).some(s => s.demo);
      const autoClean = await DB.getKV('autoClean', false), autoMeta = await DB.getKV('autoMeta', true);
      const sp = await Space.info();
      const icon = a => a.type === 'archive' ? `<div class="ico st ia">IA</div>` : a.type === 'telegram' ? `<div class="ico tg">${tgIcon}</div>` : a.logo ? `<div class="ico st"><img src="${esc(a.logo)}" alt=""></div>` : `<div class="ico st"><svg viewBox="0 0 24 24"><path d="M3 6h18v12H3z"/><path d="M10 9l5 3-5 3z"/></svg></div>`;
      return `<div class="cols">
        <div class="panel"><h3>Add-ons <button class="btn sm primary" data-act="addAddon">+ Añadir</button></h3>
          <div class="list">${addons.map(a => `<div class="row">${icon(a)}<div class="grow"><b>${esc(a.name)}</b><span class="tiny">${a.type === 'telegram' ? 'Bot de Telegram · ' + esc(a.bot) : (a.type === 'stremio' ? 'Add-on Stremio' + (a.hasSubs && !a.hasStream ? ' · subtítulos' : '') : a.type === 'archive' ? 'Dominio público y licencias libres' : 'Streaming') + (a.builtin ? ' · incluido' : '')}</span></div>
            <button class="switch ${a.enabled ? 'on' : ''}" data-toggle="${esc(a.id)}" title="Activar/desactivar"></button>
            <button class="btn sm ghost" data-remove="${esc(a.id)}" title="Quitar">✕</button></div>`).join('') || '<p class="muted">Sin add-ons.</p>'}</div>
          <p class="tiny" style="margin-top:8px">Acepta tus bots, add-ons con formato de Stremio (pega la URL de su manifest.json) y catálogos propios (docs/ADDONS.md).</p></div>

        <div class="panel"><h3>Cuenta de Telegram <span class="tiny">${tg.session ? '● Conectada' : 'Sin conectar'}</span></h3>
          ${tg.session ? `<div class="row"><div class="ico tg">${tgIcon}</div><div class="grow"><b>${esc(tg.me?.name || 'Tu cuenta')}</b><span class="tiny">${esc(tg.me?.user ? '@' + tg.me.user : tg.me?.phone ? '+' + tg.me.phone : '')}</span></div><button class="btn sm" data-act="tgLogout">Cerrar sesión</button></div>
          <p class="tiny" style="margin-top:8px">Abre un bot desde Explorar para hablar con él y descargar lo que te mande.</p>`
          : `<p class="muted" style="margin-bottom:10px">Para hablar con tus bots y descargar lo que te manden, Lector inicia sesión con tu cuenta, solo en este dispositivo.</p>
          <details class="howto"><summary>Cómo sacar api_id y api_hash (gratis, 2 minutos)</summary><ol>
            <li>Entra en <a href="https://my.telegram.org" target="_blank" rel="noopener">my.telegram.org</a> con tu número.</li>
            <li>Pulsa <b>API development tools</b>.</li><li>Rellena "App title" (ej. Lector) y "Short name" (ej. lector). Lo demás puede ir vacío.</li>
            <li>Copia <b>App api_id</b> y <b>App api_hash</b> aquí abajo.</li></ol></details>
          <div class="field"><label>api_id</label><input id="tgId" inputmode="numeric" value="${esc(tg.apiId || '')}" placeholder="1234567"></div>
          <div class="field"><label>api_hash</label><input id="tgHash" value="${esc(tg.apiHash || '')}" placeholder="0123456789abcdef…"></div>
          <div class="chips"><button class="btn" data-act="saveTg">Guardar</button><button class="btn primary" data-act="tgLogin">Iniciar sesión</button></div>`}</div>

        <div class="panel"><h3>Apariencia</h3>
          <div class="kv"><span>Tema</span><div class="seg" data-theme-mode>${[['dark', 'Oscuro'], ['amoled', 'Negro puro'], ['light', 'Claro']].map(([k, l]) => `<button data-v="${k}" class="${theme.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="kv"><span>Color</span><div class="swatches">${ACCENTS.map(c => `<button data-accent="${c}" class="${theme.ac === c ? 'on' : ''}" style="background:${c}" title="${c}"></button>`).join('')}</div></div>
          <p class="tiny">"Negro puro" gasta menos batería en móviles con pantalla OLED.</p></div>

        <div class="panel"><h3>Lectura de manga</h3>
          <p class="tiny" style="margin-bottom:8px">Modo predeterminado para series nuevas. Dentro del lector puedes cambiarlo todo (⚙) y se guarda por serie.</p>
          <div class="rmodes" style="padding:0">${Reader.MODES.map(([id, n, , p]) => `<button class="mode ${(rp.mode || 'rtl') === id ? 'on' : ''}" data-pref-mode="${id}"><svg viewBox="0 0 24 24" style="width:22px;height:22px">${p}</svg><b>${n}</b></button>`).join('')}</div></div>

        <div class="panel"><h3>App</h3>
          <div class="kv"><span>Versión</span><span class="muted">${VERSION}</span></div>
          <div class="kv"><span>Instalar en este dispositivo</span>${installBtn()}</div>
          <div class="kv"><span>Series de ejemplo</span>${hasDemo ? '<button class="btn sm" data-act="clearDemo">Quitar</button>' : '<button class="btn sm" data-act="addDemo">Cargar para probar</button>'}</div>
          <div class="kv"><span>Comprobar este dispositivo<small>Qué funciona aquí (vídeo, espacio, notificaciones…)</small></span><button class="btn sm" data-act="diag">Diagnóstico</button></div>
          <div class="kv"><span>Formatos</span><span class="tiny" style="text-align:right">Manga: CBZ, CBR, RAR, ZIP, 7Z, CBT, PDF, EPUB, imágenes, carpetas<br>Anime: MP4, MKV (se pasa a MP4), WebM + .srt/.ass/.vtt</span></div></div>

        <div class="panel"><h3>Copia de seguridad y sincronizar</h3>
          <p class="tiny" style="margin-bottom:8px">Guarda tu biblioteca, progreso, listas, notas y ajustes (no los vídeos ni mangas). Importarla en otro dispositivo junta el progreso: en cada capítulo gana lo último que hiciste.</p>
          <div class="chips"><button class="btn sm" data-act="exportBk">Exportar copia</button><button class="btn sm" data-act="importBk">Importar copia</button></div>
          <div class="kv" style="margin-top:6px"><span>Sincronizar por Telegram<small>Guarda la copia en tus "Mensajes guardados" y la lee en los demás dispositivos</small></span><button class="switch ${tg.sync ? 'on' : ''}" data-act="tgSync"></button></div>
          ${tg.lastSync ? `<p class="tiny">Última sincronización: ${new Date(tg.lastSync).toLocaleString('es-ES')}</p>` : ''}</div>

        <div class="panel"><h3>Espacio</h3>
          ${sp && sp.quota ? `<div class="kv"><span>Usado</span><b>${fmtSize(sp.usage)} de ${fmtSize(sp.quota)}</b></div><div class="bar"><i style="width:${Math.min(100, sp.usage / sp.quota * 100)}%"></i></div>` : ''}
          <div class="kv"><span>Borrar lo ya visto si falta espacio<small>Borra primero los episodios terminados más antiguos</small></span><button class="switch ${autoClean ? 'on' : ''}" data-act="autoClean"></button></div>
          <div class="kv"><span>Liberar espacio ahora</span><button class="btn sm" data-act="cleanNow">Borrar vistos</button></div>
          <div class="kv"><span>Buscar información en AniList al añadir</span><button class="switch ${autoMeta ? 'on' : ''}" data-act="autoMeta"></button></div></div>
      </div>`;
    },
  };

  const tgIcon = `<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M21.5 4.3L2.9 11.4c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.3-1.5zM8.6 14l9.5-6c.4-.3.8-.1.5.2l-7.9 7.2-.3 3.3z"/></svg>`;

  /* ---------- ficha de serie (panel derecho / pantalla completa en móvil) ---------- */
  async function openDetail(id, keepScroll) {
    if (id.startsWith('c:')) return catalogDetail(id, keepScroll);
    let s, remote = null;
    if (id.startsWith('r:')) {
      const aid = id.split(':')[1], rid = ridOf(id);
      const addon = await DB.get('addons', aid);
      if (!addon) return closeDetail();
      try { s = await Addons.series(addon, rid, previews.get(id)); } catch (e) { toast('No se pudo abrir: ' + e.message); return; }
      remote = addon;
      const sid = 'src-' + aid + '-' + rid;
      const have = new Set((await DB.byIndex('items', 'seriesId', sid)).map(i => i.num));
      s.items.forEach(i => i.have = have.has(i.num));
      s.id = id;
    } else {
      s = (await libraryData()).find(x => x.id === id);
      if (!s) return closeDetail();
    }
    if (ui.detail?.id !== id) { ui.dTab = 'eps'; ui.dUnread = false; }
    ui.detail = { id, remote, s };
    const d = $('#detail');
    const cur = remote ? null : continueItem(s);
    const verb = s.kind === 'anime' ? 'Ver' : 'Leer';
    const unit = s.kind === 'anime' ? ['episodio', 'episodios', 'vistos'] : ['capítulo', 'capítulos', 'leídos'];
    let list = [...s.items];
    if (ui.dUnread) list = list.filter(i => !i.done);
    if (ui.dSort === 'desc') list.reverse();
    const items = list.map(it => {
      const frac = it.total && !it.done ? it.pos / it.total : 0;
      const sub = remote ? (it.have ? 'En tu biblioteca' : it.size ? fmtSize(it.size) : (s.kind === 'anime' ? 'Online o descarga' : 'Leer o descargar')) : (it.remote || it.removed) && !it.fileKey && !it.pageKeys ? (it.done ? (s.kind === 'anime' ? 'Visto' : 'Leído') + ' · ' : '') + 'No está en este dispositivo' : it.done ? (s.kind === 'anime' ? 'Visto' : 'Leído') : frac ? (s.kind === 'anime' ? fmtTime(it.pos) + ' de ' + fmtTime(it.total) : `Pág. ${it.pos + 1} de ${it.total}`) : fmtSize(it.size);
      return `<div class="ep ${it.done ? 'done' : ''} ${cur?.id === it.id ? 'cur' : ''}">
        <button class="ep-btn" data-item="${remote ? 'r' + it.num : esc(it.id)}"><span class="n">${it.num}</span>
        <span class="grow"><b>${esc(it.title)}</b><span class="tiny">${sub}</span>${frac ? `<div class="mini"><i style="width:${frac * 100}%"></i></div>` : ''}</span></button>
        ${remote ? (it.have ? '' : `<button class="more" data-dl="${it.num}" title="Descargar"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button>`)
                 : `<button class="more" data-menu="${esc(it.id)}" title="Más"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></button>`}</div>`;
    }).join('') || '<p class="muted" style="padding:12px">Nada que mostrar.</p>';
    const tabs = [['eps', s.kind === 'anime' ? 'Episodios' : 'Capítulos'], ['info', 'Información']];
    if (s.kind === 'manga' && !remote) tabs.push(['read', 'Lectura']);
    const rmode = s.reader?.mode || ({ vertical: 'webtoon' }[s.mode] || s.mode) || (await DB.getKV('readerPrefs', {})).mode || 'rtl';
    let body = '';
    if (ui.dTab === 'eps') body = `<div class="d-tools"><span class="tiny">${pl(list.length, unit)}</span>
        <button class="chip ${ui.dUnread ? 'on' : ''}" data-dt="unread">Sin ${s.kind === 'anime' ? 'ver' : 'leer'}</button>
        <button class="chip" data-dt="sort" title="Orden">${ui.dSort === 'asc' ? '1 → 9' : '9 → 1'}</button></div>${items}`;
    const lists = await getLists(), m = s.meta || {};
    if (ui.dTab === 'info') body = `${m.genres?.length ? `<div class="chips genres">${m.genres.map(g => `<span class="chip">${esc(g)}</span>`).join('')}</div>` : ''}
        ${s.desc ? `<p class="d-desc clamp" data-act="more">${esc(s.desc)}</p>` : ''}
        ${remote ? '' : `<div class="mine"><div class="stars" data-stars>${[1, 2, 3, 4, 5].map(n => `<button data-rate="${n}" class="${(s.rating || 0) >= n ? 'on' : ''}" title="${n} de 5">★</button>`).join('')}<span class="tiny">${s.rating ? 'Mi valoración' : 'Valorar'}</span></div>
          <div class="chips">${lists.map(l => `<button class="chip ${(s.lists || []).includes(l) ? 'on' : ''}" data-list="${esc(l)}">${(s.lists || []).includes(l) ? '✓ ' : '+ '}${esc(l)}</button>`).join('')}</div>
          <textarea id="dNote" placeholder="Mis notas sobre esta serie…" rows="3">${esc(s.note || '')}</textarea>
          <div class="kv"><span>Avisarme de capítulos nuevos<small>Revisa tus bots y fuentes al abrir la app</small></span><button class="switch ${s.follow ? 'on' : ''}" data-act="follow"></button></div></div>`}
        <dl class="info-grid">
        ${m.format ? `<dt>Formato</dt><dd>${esc(m.format)}</dd>` : ''}${m.year ? `<dt>Año</dt><dd>${m.year}</dd>` : ''}${m.status ? `<dt>Estado</dt><dd>${esc(m.status)}</dd>` : ''}${m.score ? `<dt>Nota AniList</dt><dd>${m.score} / 100</dd>` : ''}${m.count ? `<dt>Total</dt><dd>${m.count} ${unit[1]}</dd>` : ''}
        <dt>Tipo</dt><dd>${s.kind === 'anime' ? 'Anime' : 'Manga'}</dd>
        <dt>${unit[1][0].toUpperCase() + unit[1].slice(1)}</dt><dd>${s.items.length}</dd>
        ${remote ? `<dt>Fuente</dt><dd>${esc(remote.name)}</dd>` : `<dt>Progreso</dt><dd>${s.doneCount} ${unit[2]}</dd><dt>Fuente</dt><dd>${esc(s.source || '—')}</dd><dt>Espacio</dt><dd>${fmtSize(s.size)}</dd>
        <dt>Añadido</dt><dd>${new Date(s.addedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</dd>`}</dl>
        ${remote ? '' : `<div class="d-tools" style="margin-top:12px"><button class="btn sm" data-act="anilist">${m.id ? 'Cambiar información (AniList)' : 'Buscar información en AniList'}</button>${m.url ? `<a class="btn sm ghost" href="${esc(m.url)}" target="_blank" rel="noopener">Ver en AniList ↗</a>` : ''}</div>`}`;
    if (ui.dTab === 'read') body = `<p class="tiny" style="padding:4px 8px 10px">Cómo se abre esta serie. Dentro del lector (⚙) tienes encaje, zoom, recorte, filtros, zonas táctiles y más.</p>
        <div class="rmodes">${Reader.MODES.map(([id, n, sub, p]) => `<button class="mode ${rmode === id ? 'on' : ''}" data-smode="${id}"><svg viewBox="0 0 24 24" style="width:22px;height:22px">${p}</svg><b>${n}</b><small>${sub}</small></button>`).join('')}</div>`;
    const pct = !remote && s.items.length ? s.doneCount / s.items.length : 0;
    d.innerHTML = `<div class="d-banner ${s.banner ? 'sharp' : ''}" style="background-image:url(&quot;${esc(s.banner || s.cover)}&quot;)"></div>
      <div class="d-wrap">
      <button class="d-close" data-act="closeDetail" title="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="d-head"><div class="cv"><img src="${esc(s.cover)}" alt="">${tag(s.kind)}</div>
        <div style="min-width:0;padding-right:28px"><h2>${esc(s.title)}</h2>
        <div class="d-meta"><span>${pl(s.items.length, unit)}</span>${remote ? `<span>${esc(remote.name)}</span>` : `<span>${Math.round(pct * 100)} % ${unit[2]}</span>${s.size ? `<span>${fmtSize(s.size)}</span>` : ''}`}</div></div></div>
      <div class="d-actions">
        ${remote ? `<button class="btn primary" data-act="dlAll"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Descargar todo</button><button class="btn" data-item="r1">${verb} online</button>`
                 : `${cur ? `<button class="btn primary" data-item="${esc(cur.id)}">${playIco}${cur.pos || cur.lastAt ? 'Continuar' : verb} · ${esc(cur.title)}</button>` : `<button class="btn primary" data-item="${esc(s.items[0]?.id)}">${playIco}${verb} de nuevo</button>`}
                    <button class="btn icon" data-act="seriesMenu" title="Más opciones"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>`}
      </div>
      ${pct ? `<div class="d-prog"><div class="bar"><i style="width:${pct * 100}%"></i></div></div>` : ''}
      <div class="tabs">${tabs.map(([k, l]) => `<button data-dtab="${k}" class="${ui.dTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="d-body">${body}</div></div>`;
    const wasOpen = $('#app').classList.contains('has-detail');
    $('#app').classList.add('has-detail');
    document.querySelectorAll('.card').forEach(c => c.classList.toggle('sel', c.dataset.series === id));
    if (!keepScroll) { d.scrollTop = 0; if (ui.dTab === 'eps') d.querySelector('.ep.cur')?.scrollIntoView({ block: 'center' }); }
    else d.scrollTop = keepScroll;
    if (!wasOpen) d.firstElementChild?.nextElementSibling?.animate([{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'ease-out' });
  }
  /* ---------- ficha del catálogo (AniList): info, tráiler, dónde verlo y recomendaciones ---------- */
  async function catalogDetail(id, keepScroll) {
    const d = $('#detail');
    if (ui.detail?.id !== id) { $('#app').classList.add('has-detail'); d.innerHTML = '<div class="d-wrap"><p class="muted" style="padding:40px 0;text-align:center">Cargando…</p></div>'; }
    let c;
    try { c = await Catalog.detail(id.slice(2)); } catch (e) { d.innerHTML = `<div class="d-wrap"><button class="d-close" data-act="closeDetail" title="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><p class="muted" style="padding:40px 0">${esc(e.message)}</p></div>`; return; }
    ui.detail = { id, cat: c, s: c };
    const m = c.meta, anime = c.kind === 'anime';
    const wished = (await Catalog.wish()).some(w => w.id === id);
    const bots = (await Addons.list()).filter(a => a.enabled && a.type === 'telegram');
    const srcs = (await Addons.list()).filter(a => a.enabled && a.type !== 'telegram');
    const streamAddons = srcs.some(a => a.type === 'stremio' && a.hasStream);
    const local = (await libraryData()).find(x => x.meta?.id === +id.slice(2));
    const yt = c.links.filter(l => l.yt), other = c.links.filter(l => !l.yt);
    const langs = { Spanish: 'ES', English: 'EN', Japanese: 'JP' };
    const link = l => `<a class="wlink ${l.yt ? 'free' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener" ${l.yt && Catalog.ytEmbed(l.url) ? `data-yt="${esc(l.url)}"` : ''}><b>${esc(l.site)}</b>${l.lang ? `<span class="tiny">${langs[l.lang] || esc(l.lang)}</span>` : ''}${l.yt ? '<span class="tiny">Gratis</span>' : ''}</a>`;
    const next = c.next ? `<dt>Próximo</dt><dd>Ep. ${c.next.episode} · ${new Date(c.next.airingAt * 1000).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</dd>` : '';
    d.innerHTML = `<div class="d-banner ${c.banner ? 'sharp' : ''}" style="background-image:url(&quot;${esc(c.banner || c.cover)}&quot;)"></div>
      <div class="d-wrap">
      <button class="d-close" data-act="closeDetail" title="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="d-head"><div class="cv"><img src="${esc(c.cover)}" alt="">${tag(c.kind)}</div>
        <div style="min-width:0;padding-right:28px"><h2>${esc(c.title)}</h2>
        <div class="d-meta">${[m.format, m.year, m.count ? m.count + (anime ? ' ep.' : ' cap.') : '', m.score ? '★ ' + (m.score / 10).toFixed(1) : '', c.studio].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</div></div></div>
      <div class="d-actions">
        ${local ? `<button class="btn primary" data-series="${esc(local.id)}">${playIco}En tu biblioteca</button>` : ''}
        ${c.trailer ? `<button class="btn ${local ? '' : 'primary'}" data-yt="https://youtu.be/${esc(c.trailer)}">${playIco}Tráiler</button>` : ''}
        <button class="btn" data-act="wish">${wished ? '✓ Guardado' : '+ ' + (anime ? 'Quiero verlo' : 'Quiero leerlo')}</button>
        ${bots.length ? `<button class="btn" data-act="askBot">${tgIcon}Pedir a mi bot</button>` : ''}
        ${srcs.length ? `<button class="btn ghost" data-act="srcSearch">Buscar en mis add-ons</button>` : ''}
      </div>
      <div class="d-body">
        ${anime && streamAddons ? `<h4 class="d-sub">Episodios <span class="tiny">de tus add-ons</span></h4><div id="cEps" class="c-eps"><p class="tiny">Buscando la serie…</p></div>` : ''}
        ${c.links.length ? `<h4 class="d-sub">${anime ? 'Dónde verlo' : 'Dónde leerlo'} <span class="tiny">oficial</span></h4><div class="wlinks">${yt.map(link).join('')}${other.map(link).join('')}</div>${yt.length ? '<p class="tiny">Los canales oficiales de YouTube pueden no estar disponibles en todos los países.</p>' : ''}`
          : `<p class="tiny d-none">AniList no tiene enlaces oficiales para esta serie.</p>`}
        ${m.genres?.length ? `<div class="chips genres">${m.genres.map(g => `<span class="chip">${esc(g)}</span>`).join('')}</div>` : ''}
        ${c.desc ? `<p class="d-desc clamp" data-act="more">${esc(c.desc)}</p>` : ''}
        <dl class="info-grid">${m.format ? `<dt>Formato</dt><dd>${esc(m.format)}</dd>` : ''}${m.year ? `<dt>Año</dt><dd>${m.year}</dd>` : ''}${m.status ? `<dt>Estado</dt><dd>${esc(m.status)}</dd>` : ''}${next}${m.count ? `<dt>Total</dt><dd>${m.count} ${anime ? 'episodios' : 'capítulos'}</dd>` : ''}${c.studio ? `<dt>Estudio</dt><dd>${esc(c.studio)}</dd>` : ''}${c.titles[1] && c.titles[1] !== c.title ? `<dt>También</dt><dd>${esc(c.titles.filter(t => t !== c.title).slice(0, 2).join(' · '))}</dd>` : ''}</dl>
        <div class="d-tools" style="margin-top:12px"><a class="btn sm ghost" href="${esc(c.url)}" target="_blank" rel="noopener">Ver en AniList ↗</a></div>
        ${c.recs.length ? `<h4 class="d-sub">Si te gusta, prueba</h4><div class="rail mini">${c.recs.map(r => cardHTML(r)).join('')}</div>` : ''}
      </div></div>`;
    $('#app').classList.add('has-detail');
    document.querySelectorAll('.card').forEach(x => x.classList.toggle('sel', x.dataset.series === id));
    d.scrollTop = keepScroll || 0;
    if (anime && streamAddons) catalogEps(c);
  }

  /* Episodios de una serie del catálogo con los add-ons de Stremio (ids de Kitsu: kitsu:<id>:<ep>) */
  async function catalogEps(c, from = 0) {
    const box = () => ui.detail?.id === c.id && $('#cEps');
    const k = await Catalog.kitsuId(c.id.slice(2), c.titles.concat(c.title));
    if (!box()) return;
    if (!k) { box().innerHTML = '<p class="tiny">No se encontró esta serie en Kitsu, que es lo que usan los add-ons de anime para saber qué capítulo es. Prueba a buscarla en tus add-ons.</p>'; return; }
    const movie = k.movie || c.meta.format === 'Película';
    let n = movie ? 1 : (c.meta.count || k.eps || (c.next ? c.next.episode - 1 : 0) || 12);
    const ep = i => ({ num: i, title: movie ? c.title : `${c.title} · Ep. ${i}`, vid: movie ? 'kitsu:' + k.id : `kitsu:${k.id}:${i}`, stype: movie ? 'movie' : 'series' });
    ui.detail.eps = ep;
    const ranges = n > 100 ? `<div class="chips eps-range">${Array.from({ length: Math.ceil(n / 100) }, (_, r) => `<button class="chip ${r * 100 === from ? 'on' : ''}" data-crange="${r * 100}">${r * 100 + 1}–${Math.min(n, r * 100 + 100)}</button>`).join('')}</div>` : '';
    const nums = Array.from({ length: Math.min(100, n - from) }, (_, i) => from + i + 1);
    box().innerHTML = ranges + (movie ? `<button class="btn sm primary" data-cep="1">${playIco}Ver película</button>`
      : `<div class="ep-grid">${nums.map(i => `<button data-cep="${i}">${i}</button>`).join('')}</div>`);
  }

  /* Vídeo de YouTube incrustado (tráileres y canales oficiales) */
  function ytSheet(url, title = '') {
    const src = Catalog.ytEmbed(url);
    if (!src) return window.open(url, '_blank', 'noopener');
    sheet(`<h3>${esc(title || 'YouTube')}</h3><div class="yt"><iframe src="${esc(src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <div class="acts"><a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">Abrir en YouTube ↗</a><button class="btn primary" data-close>Cerrar</button></div>`, w => w.querySelector('.sheet').classList.add('wide'));
  }

  async function askBot(text) {
    const bots = (await Addons.list()).filter(a => a.enabled && a.type === 'telegram');
    const open = async b => { if (!(await Tg.ready())) { ui.exQ = text; return botSheet(b.id); } Tg.openChat(b, b.commands?.search ? b.commands.search.replace('{q}', text) : text); };
    if (bots.length === 1) return open(bots[0]);
    sheet(`<h3>¿A qué bot se lo pides?</h3><div class="menu">${bots.map(b => `<button class="ep" data-b="${esc(b.id)}"><span class="grow"><b>${esc(b.name)}</b><span class="tiny">${esc(b.bot)}</span></span></button>`).join('')}</div><div class="acts"><button class="btn" data-close>Cancelar</button></div>`,
      (w, close) => w.querySelector('.menu').onclick = e => { const id = e.target.closest('[data-b]')?.dataset.b; if (!id) return; close(); open(bots.find(b => b.id === id)); });
  }

  /* Stremio: elegir enlace del episodio */
  async function stremioPlay(remote, s, it) {
    progress('Buscando enlaces…');
    let ss; try { ss = await Addons.streams(remote, it); $('#toast').classList.remove('on'); } catch (e) { return toast('No se pudieron cargar los enlaces: ' + e.message); }
    if (!ss.length) return toast('Tus add-ons no tienen enlaces para este episodio');
    const subsP = Promise.race([Addons.subtitles(it).catch(() => []), new Promise(r => setTimeout(() => r([]), 4000))]);
    const playUrl = async st => { const ser = { id: 'tmp', title: s.title, kind: 'anime' }; Player.open({ id: 'tmp-' + it.num, seriesId: 'tmp', num: it.num, title: it.title, url: st.url, total: 0, pos: 0, subUrls: await subsP }, ser); };
    const ok = ss.filter(x => x.url || x.yt || x.ext);
    if (!ok.length && ss.every(x => x.error)) return toast(ss[0].label);
    if (ok.length === 1 && ok[0].url && !ok[0].hls) return playUrl(ok[0]);
    sheet(`<h3>${esc(it.title)}</h3><div class="menu">${ss.map((x, i) => `<button class="ep" data-i="${i}" ${(x.torrent && !x.url) || x.error ? 'disabled' : ''}><span class="grow"><b>${esc(x.label)}</b><span class="tiny">${esc(x.addon || '')} · ${x.error ? 'no respondió' : x.yt ? 'YouTube' : x.ext ? 'Se abre fuera de Lector' : x.torrent && !x.url ? 'Torrent: una app web no puede abrirlo' : x.hls ? 'Emisión HLS (mejor en iPhone/iPad)' : 'Vídeo directo'}</span></span></button>`).join('')}</div><div class="acts"><button class="btn" data-close>Cerrar</button></div>`,
      (w, close) => w.querySelector('.menu').onclick = e => { const b = e.target.closest('[data-i]'); if (!b || b.disabled) return; close(); const x = ss[+b.dataset.i];
        if (x.url) return playUrl(x); if (x.yt) return ytSheet('https://youtu.be/' + x.yt, it.title); if (x.ext) window.open(x.ext, '_blank', 'noopener'); });
  }

  function closeDetail() { ui.detail = null; $('#app').classList.remove('has-detail'); document.querySelectorAll('.card.sel').forEach(c => c.classList.remove('sel')); }

  async function itemClick(key) {
    const { s, remote } = ui.detail;
    if (remote) {
      const it = s.items.find(i => 'r' + i.num === key);
      if (!it) return;
      if (it.have) { const sid = 'src-' + remote.id + '-' + ridOf(s.id); const local = await DB.get('items', sid + '-' + it.num); const ser = await DB.get('series', sid); return play(ser, local); }
      if (remote.type === 'stremio') return stremioPlay(remote, s, it);
      // Ver online sin descargar
      const ser = { id: 'tmp', title: s.title, kind: s.kind, hue: s.hue, mode: 'rtl' };
      const tmp = { id: 'tmp-' + it.num, seriesId: 'tmp', num: it.num, title: it.title, demo: it.demo, total: s.kind === 'anime' ? 1440 : 18, pos: 0 };
      if (!it.demo) { if (!it.url && !it.pages) return toast('Esta fuente no da enlace para ver online'); Object.assign(tmp, { url: it.url, pages: it.pages, demo: false, total: 0 }); }
      return s.kind === 'anime' ? Player.open(tmp, ser) : Reader.open(tmp, ser);
    }
    const it = s.items.find(i => i.id === key);
    play(s, it);
  }

  function itemMenu(id) {
    const { s } = ui.detail; const it = s.items.find(i => i.id === id);
    sheet(`<h3>${esc(it.title)}</h3><div class="menu">
      <button class="ep" data-m="toggle">${it.done ? 'Marcar como no ' + (s.kind === 'anime' ? 'visto' : 'leído') : 'Marcar como ' + (s.kind === 'anime' ? 'visto' : 'leído')}</button>
      <button class="ep" data-m="upto">Marcar todos hasta aquí</button>
      <button class="ep" data-m="del" style="color:#ff7a7a">Borrar de este dispositivo${it.size ? ' (' + fmtSize(it.size) + ')' : ''}</button></div>
      <div class="acts"><button class="btn" data-close>Cerrar</button></div>`, (w, close) => w.querySelector('.menu').onclick = async e => {
      const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return; close();
      if (m === 'toggle') { it.done = !it.done; it.pos = it.done ? it.total : 0; await DB.put('items', strip(it)); }
      if (m === 'upto') for (const x of s.items) if (x.num <= it.num) { x.done = true; x.pos = x.total; await DB.put('items', strip(x)); }
      if (m === 'del') { await deleteItem(it); toast('Borrado'); }
      refresh();
    });
  }
  const strip = it => { const { have, ...rest } = it; return rest; };
  async function deleteItem(it) {
    for (const k of [it.fileKey, ...(it.pageKeys || []), ...(it.subKeys || [])].filter(Boolean)) await DB.del('files', k);
    await DB.del('items', it.id);
  }

  function seriesMenu() {
    const { s } = ui.detail;
    sheet(`<h3>${esc(s.title)}</h3><div class="menu">
      ${s.kind === 'manga' ? `<div class="kv"><span>Modo de lectura</span><div class="seg" id="smMode">${[['rtl', 'Manga'], ['ltr', 'Cómic'], ['vertical', 'Webtoon']].map(([k, l]) => `<button data-v="${k}" class="${(s.mode || 'rtl') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}
      <button class="ep" data-m="anilist">Buscar información (AniList)</button>
      <button class="ep" data-m="rename">Cambiar nombre</button>
      <button class="ep" data-m="reset">Reiniciar progreso</button>
      <button class="ep" data-m="del" style="color:#ff7a7a">Borrar serie y archivos (${fmtSize(s.size)})</button></div>
      <div class="acts"><button class="btn" data-close>Cerrar</button></div>`, (w, close) => {
      $('#smMode', w)?.addEventListener('click', async e => { const v = e.target.dataset.v; if (!v) return; await saveSeriesMode(s, v); s.mode = v; w.querySelectorAll('#smMode button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); });
      w.querySelector('.menu').addEventListener('click', async e => {
        const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return; close();
        if (m === 'anilist') return anilistSheet(s);
        if (m === 'rename') return sheet(`<h3>Cambiar nombre</h3><input id="nn" value="${esc(s.title)}"><div class="acts"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button></div>`, (w2, c2) => {
          $('#ok', w2).onclick = async () => { const r = await DB.get('series', s.id); r.title = $('#nn', w2).value.trim() || r.title; await DB.put('series', r); c2(); refresh(); };
        });
        if (m === 'reset') { for (const x of s.items) { x.done = false; x.pos = 0; x.lastAt = 0; await DB.put('items', strip(x)); } const r = await DB.get('series', s.id); r.lastAt = 0; await DB.put('series', r); }
        if (m === 'del') { if (!(await confirmSheet(`¿Borrar "${s.title}" de este dispositivo?`))) return; for (const x of s.items) await deleteItem(x); await DB.del('series', s.id); closeDetail(); toast('Serie borrada'); }
        refresh();
      });
    });
  }

  /* ---------- AniList ---------- */
  function anilistSheet(s) {
    sheet(`<h3>Información de AniList</h3>
      <div class="toolbar" style="margin:0 0 10px"><input id="alQ" value="${esc(s.meta?.title || s.title)}"><button class="btn primary" id="alGo">Buscar</button></div>
      <div class="list" id="alRes"><p class="muted">Buscando…</p></div>
      <div class="acts"><button class="btn" data-close>Cerrar</button></div>`, (w, close) => {
      const go = async () => {
        const box = $('#alRes', w); box.innerHTML = '<p class="muted">Buscando…</p>';
        try {
          const res = await Meta.search($('#alQ', w).value.trim(), s.kind);
          w._res = res;
          box.innerHTML = res.length ? res.map((m, i) => `<button class="row al" data-al="${i}"><img src="${esc(m.cover)}" alt=""><span class="grow"><b>${esc(m.title)}</b><span class="tiny">${[m.format, m.year, m.count ? m.count + (s.kind === 'anime' ? ' ep.' : ' cap.') : '', m.score ? m.score + '/100' : ''].filter(Boolean).join(' · ')}</span></span></button>`).join('') : '<p class="muted">Sin resultados. Prueba con el título en japonés o en inglés.</p>';
        } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
      };
      $('#alGo', w).onclick = go; $('#alQ', w).onkeydown = e => e.key === 'Enter' && go();
      $('#alRes', w).onclick = async e => { const b = e.target.closest('[data-al]'); if (!b) return; b.innerHTML = '<span class="muted">Guardando…</span>'; await Meta.apply(s.id, w._res[+b.dataset.al]); close(); toast('Información actualizada'); refresh(); };
      go();
    });
  }
  async function editLists() {
    const lists = await getLists();
    sheet(`<h3>Mis listas</h3><p class="tiny" style="margin-bottom:10px">Una por línea. Puedes crear las que quieras.</p><textarea id="lsT" rows="7">${esc(lists.join('\n'))}</textarea>
      <div class="acts"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="lsOk">Guardar</button></div>`, (w, close) => {
      $('#lsOk', w).onclick = async () => { const v = [...new Set($('#lsT', w).value.split('\n').map(x => x.trim()).filter(Boolean))]; await DB.setKV('lists', v.length ? v : DEF_LISTS); close(); render(); };
    });
  }

  /* ---------- add-ons: formulario ---------- */
  function addAddonSheet() {
    sheet(`<h3>Añadir add-on</h3>
      <div class="seg" id="aType" style="margin-bottom:12px"><button data-v="telegram" class="on">Bot de Telegram</button><button data-v="streaming">Stremio / streaming</button></div>
      <div id="aTg">
        <div class="field"><label>Nombre</label><input id="aName" placeholder="Mi bot de anime"></div>
        <div class="field"><label>Usuario del bot</label><input id="aBot" placeholder="@mibot"></div>
        <div class="field"><label>Qué manda</label><div class="seg" id="aKinds"><button data-v="anime" class="on">Anime</button><button data-v="manga" class="on">Manga</button></div></div>
        <div class="field"><label>Comando para buscar (opcional)</label><input id="aCmd" placeholder="/buscar {q}"><span class="tiny">{q} se sustituye por lo que busques. Si lo dejas vacío, se envía el texto tal cual.</span></div>
      </div>
      <div id="aSt" hidden>
        <div class="field"><label>Enlace del add-on</label><input id="aUrl" placeholder="https://…/manifest.json"></div>
        <p class="tiny">Vale la URL de un add-on de Stremio (manifest.json, también stremio://…) o de un catálogo con el formato de Lector (docs/ADDONS.md). También puedes pegar el JSON. Usa solo fuentes que tengas derecho a ver.</p>
      </div>
      <p id="aErr" class="tiny" style="color:#ff7a7a"></p>
      <div class="acts"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="aOk">Añadir</button></div>`, (w, close) => {
      let type = 'telegram';
      $('#aType', w).onclick = e => { const v = e.target.dataset.v; if (!v) return; type = v; w.querySelectorAll('#aType button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); $('#aTg', w).hidden = v !== 'telegram'; $('#aSt', w).hidden = v === 'telegram'; };
      $('#aKinds', w).onclick = e => e.target.dataset.v && e.target.classList.toggle('on');
      $('#aOk', w).onclick = async () => {
        try {
          if (type === 'telegram') {
            let bot = $('#aBot', w).value.trim(); if (bot && !bot.startsWith('@')) bot = '@' + bot;
            await Addons.install({ type, name: $('#aName', w).value.trim() || bot, bot, kinds: [...w.querySelectorAll('#aKinds .on')].map(b => b.dataset.v), commands: { search: $('#aCmd', w).value.trim() } });
          } else { $('#aOk', w).disabled = true; $('#aOk', w).textContent = 'Instalando…'; await Addons.install($('#aUrl', w).value); }
          close(); toast('Add-on añadido'); refresh();
        } catch (e) { $('#aErr', w).textContent = e.message; $('#aOk', w).disabled = false; $('#aOk', w).textContent = 'Añadir'; }
      };
    });
  }

  async function botSheet(id) {
    const b = await DB.get('addons', id);
    if (!(await Tg.ready())) return sheet(`<h3>${esc(b.name)}</h3>
      <p class="muted">Para hablar con ${esc(b.bot)} desde aquí, inicia sesión con tu cuenta de Telegram una vez. Lo que te mande el bot (vídeos, CBZ, PDF, imágenes) entra directo en tu biblioteca.</p>
      <div class="acts"><button class="btn" data-close>Cerrar</button><button class="btn primary" data-close data-go="ajustes">Ir a Ajustes</button></div>`);
    const q = ui.exQ.trim();
    Tg.openChat(b, q ? (b.commands?.search ? b.commands.search.replace('{q}', q) : q) : '');
  }

  /* ---------- importar archivos ---------- */
  const VID = /\.(mp4|m4v|webm|mkv|mov)$/i, SUB = /\.(srt|vtt|ass|ssa)$/i, IMG = /\.(jpe?g|png|webp|gif|avif|bmp)$/i, ARC = Formats.BOOK;
  function parseName(name) {
    let b = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    b = b.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ').replace(/\b(1080p|720p|480p|2160p|x26[45]|hevc|aac|web-?dl|bluray|bd|sub|dub|esp|español|castellano|latino)\b/ig, ' ');
    const m = b.match(/(?:\b(?:ep(?:isodio|isode)?|e|cap(?:itulo|ítulo)?|ch(?:apter)?|c|#)\s*\.?\s*(\d+(?:\.\d+)?))|(?:[-–]\s*(\d+(?:\.\d+)?)\b)|(?:\b(\d{1,4}(?:\.\d+)?)\s*$)/i);
    let num = null, title = b;
    if (m) { num = parseFloat(m[1] || m[2] || m[3]); title = b.slice(0, m.index); }
    title = title.replace(/\b(vol(?:umen|ume)?|v|tomo|t)\s*\.?\s*\d+\b/ig, ' ').replace(/\b(s\d+)\b/ig, ' ').replace(/[-–.:]+\s*$/, '').replace(/\s+/g, ' ').trim();
    return { title: title || b.trim() || name, num };
  }

  async function importFiles(fileList) {
    const files = [...fileList].filter(f => VID.test(f.name) || SUB.test(f.name) || IMG.test(f.name) || ARC.test(f.name));
    if (!files.length) return toast('No hay archivos compatibles');
    navigator.storage?.persist?.();
    const groups = new Map(); // clave → {kind, title, chapters: [{num, title, files:[]}]}
    const subs = files.filter(f => SUB.test(f.name));
    const looseImgs = [];
    for (const f of files) {
      if (SUB.test(f.name)) continue;
      const rel = f.webkitRelativePath || '';
      if (IMG.test(f.name)) {
        if (rel) { // carpeta: Serie/Capítulo/página.jpg  o  Capítulo/página.jpg
          const parts = rel.split('/'); const chap = parts.at(-2) || 'Capítulo'; const ser = parts.length > 2 ? parts.at(-3) : parseName(chap).title;
          const g = getGroup(groups, 'manga', ser); let c = g.chapters.find(c => c.key === chap);
          if (!c) { const p = parseName(chap); c = { key: chap, num: p.num ?? g.chapters.length + 1, title: chap, files: [] }; g.chapters.push(c); }
          c.files.push(f);
        } else looseImgs.push(f);
        continue;
      }
      const p = parseName(f.name); const kind = VID.test(f.name) ? 'anime' : 'manga';
      const g = getGroup(groups, kind, p.title);
      g.chapters.push({ num: p.num ?? g.chapters.length + 1, title: (kind === 'anime' ? 'Episodio ' : 'Capítulo ') + (p.num ?? g.chapters.length + 1), files: [f] });
    }
    if (looseImgs.length) {
      const p = parseName(looseImgs[0].name.replace(/[-_ ]*\d+\.\w+$/, '') || 'Imágenes');
      const g = getGroup(groups, 'manga', p.title || 'Imágenes sueltas');
      g.chapters.push({ num: g.chapters.length + 1, title: 'Capítulo ' + (g.chapters.length + 1), files: looseImgs });
    }
    let n = 0;
    const existing = await DB.all('series');
    for (const g of groups.values()) {
      let s = existing.find(x => x.kind === g.kind && norm(x.title) === norm(g.title) && !x.demo);
      if (!s) { s = { id: DB.uid(), title: g.title, kind: g.kind, cover: Demo.cover(g.title, hueOf(g.title), g.kind), desc: '', source: 'Este dispositivo', addedAt: Date.now(), lastAt: 0, mode: undefined }; }
      const its = await DB.byIndex('items', 'seriesId', s.id);
      for (const c of g.chapters.sort((a, b) => a.num - b.num)) {
        const id = DB.uid(); const nat = Zip.natural;
        const base = { id, seriesId: s.id, num: c.num, title: c.title, kind: g.kind, pos: 0, total: 0, done: false, lastAt: 0, addedAt: Date.now() };
        if (its.some(i => i.num === c.num)) base.num = Math.max(...its.map(i => i.num)) + 1;
        if (c.files.length > 1 || IMG.test(c.files[0].name)) {
          const sorted = c.files.sort((a, b) => nat.compare(a.name, b.name)); const keys = [];
          for (const [i, f] of sorted.entries()) { const k = id + '-p' + i; keys.push(k); await DB.put('files', { key: k, blob: f, name: f.name, type: f.type }); }
          Object.assign(base, { pageKeys: keys, total: keys.length, size: sorted.reduce((a, f) => a + f.size, 0) });
          if (!s.realCover) { s.cover = await thumb(sorted[0]); s.realCover = true; }
        } else {
          const f = c.files[0]; const k = id + '-f';
          const v = g.kind === 'anime' ? await convertVideo(f) : { blob: f, name: f.name, subs: [] };
          if (!(await Space.ensure(v.blob.size))) { toast('No hay espacio suficiente para ' + f.name); continue; }
          await DB.put('files', { key: k, blob: v.blob, name: v.name, type: v.blob.type || f.type || 'application/octet-stream' });
          Object.assign(base, { fileKey: k, size: v.blob.size });
          if (v.err) base.convErr = v.err;
          if (g.kind === 'anime') {
            const stem = f.name.replace(/\.[^.]+$/, '').replace(/\s+$/, '');
            const mine = subs.filter(sb => sb.name.startsWith(stem) || (g.chapters.length === 1 && subs.length));
            base.subKeys = [];
            for (const sb of [...mine, ...v.subs]) { const sk = id + '-s' + base.subKeys.length; await DB.put('files', { key: sk, blob: sb.blob || sb, name: sb.name, type: 'text/plain' }); base.subKeys.push(sk); }
            if (!s.realCover) { const t = await videoThumb(f); if (t) { s.cover = t; s.realCover = true; } }
          } else if (!s.realCover) {
            try { const pg = await Formats.pages(f, f.name); base.total = pg.length; if (pg[0]) { s.cover = await thumb(await pg[0].load()); s.realCover = true; } } catch { }
          }
        }
        await DB.put('items', base); its.push(base); n++;
      }
      await DB.put('series', s);
    }
    toast(`${n} ${n === 1 ? 'archivo añadido' : 'archivos añadidos'}`);
    refresh();
    if (await DB.getKV('autoMeta', true)) for (const g of groups.values()) {
      const ser = (await DB.all('series')).find(x => x.kind === g.kind && norm(x.title) === norm(g.title) && !x.meta);
      if (ser && await Meta.auto(ser.id)) refresh();
    }
  }
  function getGroup(groups, kind, title) { const k = kind + '|' + norm(title); if (!groups.has(k)) groups.set(k, { kind, title, chapters: [] }); return groups.get(k); }

  /* miniatura de portada a partir de una imagen */
  async function thumb(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = 240; c.height = 360;
      const x = c.getContext('2d'); const r = Math.max(240 / bmp.width, 360 / bmp.height);
      x.drawImage(bmp, (240 - bmp.width * r) / 2, (360 - bmp.height * r) / 2, bmp.width * r, bmp.height * r);
      return c.toDataURL('image/jpeg', .8);
    } catch { return Demo.cover('Manga', 200, 'manga'); }
  }
  function videoThumb(file) {
    return new Promise(res => {
      const v = document.createElement('video'); const u = URL.createObjectURL(file);
      const done = r => { URL.revokeObjectURL(u); res(r); };
      v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.src = u;
      v.onloadedmetadata = () => { v.currentTime = Math.min(90, v.duration * .2); };
      v.onseeked = () => { try { const c = document.createElement('canvas'); c.width = 240; c.height = 360; const x = c.getContext('2d'); const r = Math.max(240 / v.videoWidth, 360 / v.videoHeight); x.drawImage(v, (240 - v.videoWidth * r) / 2, (360 - v.videoHeight * r) / 2, v.videoWidth * r, v.videoHeight * r); done(c.toDataURL('image/jpeg', .8)); } catch { done(null); } };
      v.onerror = () => done(null);
      setTimeout(() => done(null), 6000);
    });
  }

  /* ---------- espacio, instalación ---------- */
  async function storageInfo() {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 1, persisted: await navigator.storage.persisted?.() };
  }
  async function navStorage() {
    const e = await storageInfo(); if (!e) return;
    $('#navStorage').innerHTML = `Espacio usado: ${fmtSize(e.usage)}<div class="bar"><i style="width:${Math.max(2, Math.min(100, e.usage / e.quota * 100))}%"></i></div>`;
  }
  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installEvt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  function installBtn() {
    if (matchMedia('(display-mode: standalone)').matches) return '<span class="muted">Instalada ✓</span>';
    return '<button class="btn sm" data-act="install">Instalar</button>';
  }
  async function install() {
    if (installEvt) { installEvt.prompt(); installEvt = null; return; }
    sheet(`<h3>Instalar Lector</h3>${isIOS()
      ? '<p class="muted">En Safari: pulsa <b>Compartir</b> (el cuadrado con flecha) → <b>Añadir a pantalla de inicio</b>.</p>'
      : '<p class="muted">En Chrome o Edge: menú <b>⋮</b> → <b>Instalar app</b> (o "Añadir a pantalla de inicio" en Android).</p>'}
      <div class="acts"><button class="btn primary" data-close>Entendido</button></div>`);
  }

  /* ---------- navegación y eventos ---------- */
  async function go(view) {
    ui.view = view;
    document.querySelectorAll('#nav>button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    $('#viewTitle').textContent = TITLES[view];
    if (innerWidth <= 720) closeDetail();
    await render();
    $('#main').scrollTop = 0;
  }
  let rendering = false, again = false;
  async function render() {
    if (rendering) { again = true; return; }
    rendering = true;
    const focus = document.activeElement?.id; const caret = document.activeElement?.selectionStart;
    $('#view').innerHTML = await views[ui.view]();
    $('#top').classList.toggle('over', !!$('#hero'));
    if (ui.view !== 'biblioteca' && document.activeElement?.id !== 'gq') { $('#gq').value = ''; ui.libQ = ''; }
    if (focus && $('#' + focus)) { const f = $('#' + focus); f.focus(); try { f.setSelectionRange(caret, caret); } catch { } }
    rendering = false;
    if (again) { again = false; render(); }
  }
  async function refresh() { await render(); if (ui.detail) await openDetail(ui.detail.id, $('#detail').scrollTop || 1); navStorage(); }

  function bind() {
    $('#nav').onclick = e => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); };
    $('#importBtn').onclick = () => sheet(`<h3>Añadir a tu biblioteca</h3><div class="menu">
        <button class="ep" data-m="files"><span class="n">📄</span><span class="grow"><b>Archivos</b><span class="tiny">Vídeos, CBZ/ZIP, imágenes y subtítulos</span></span></button>
        <button class="ep" data-m="folder"><span class="n">📁</span><span class="grow"><b>Carpeta</b><span class="tiny">Una serie con subcarpetas por capítulo</span></span></button></div>
        <p class="tiny" style="margin-top:8px">En PC también puedes arrastrar archivos a la ventana.</p>
        <div class="acts"><button class="btn" data-close>Cerrar</button></div>`, (w, close) => w.querySelector('.menu').onclick = e => {
        const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return; close(); $(m === 'folder' ? '#folderInput' : '#fileInput').click();
      });
    $('#fileInput').onchange = e => { importFiles(e.target.files); e.target.value = ''; };
    $('#folderInput').onchange = e => { importFiles(e.target.files); e.target.value = ''; };

    document.addEventListener('click', async e => {
      const t = e.target;
      const goEl = t.closest('[data-go]'); if (goEl) { e.preventDefault(); return go(goEl.dataset.go); }
      const ce = t.closest('[data-cep]'); if (ce && ui.detail?.eps) return stremioPlay(null, { title: ui.detail.cat.title }, ui.detail.eps(+ce.dataset.cep));
      const cr = t.closest('[data-crange]'); if (cr) return catalogEps(ui.detail.cat, +cr.dataset.crange);
      const yEl = t.closest('[data-yt]'); if (yEl) { e.preventDefault(); return ytSheet(yEl.dataset.yt, ui.detail?.cat?.title); }
      const sEl = t.closest('[data-series]'); if (sEl) return openDetail(sEl.dataset.series);
      const pEl = t.closest('[data-play]'); if (pEl) { const [sid, iid] = pEl.dataset.play.split('|'); const s = await DB.get('series', sid); return play(s, await DB.get('items', iid)); }
      const iEl = t.closest('#detail [data-item]'); if (iEl) return itemClick(iEl.dataset.item);
      const mEl = t.closest('[data-menu]'); if (mEl) return itemMenu(mEl.dataset.menu);
      const dEl = t.closest('[data-dl]'); if (dEl) { const { s, remote } = ui.detail; const it = s.items.find(i => i.num === +dEl.dataset.dl); await Downloads.enqueue(remote, { ...s, id: ridOf(s.id) }, [it]); dEl.remove(); return toast('Añadido a descargas'); }
      const chips = t.closest('[data-chips] button:not([data-act])'); if (chips) { ui[chips.parentElement.dataset.chips] = chips.dataset.v; return render(); }
      const tg = t.closest('[data-toggle]'); if (tg) { await Addons.toggle(tg.dataset.toggle); return render(); }
      const rm = t.closest('[data-remove]'); if (rm) { if (await confirmSheet('¿Quitar este add-on?', 'Quitar')) { await Addons.remove(rm.dataset.remove); render(); } return; }
      const bot = t.closest('[data-bot]'); if (bot) return botSheet(bot.dataset.bot);
      const cs = t.closest('[data-cancelsid]'); if (cs) { Downloads.jobs.filter(j => j.sid === cs.dataset.cancelsid && j.state === 'cola').forEach(j => Downloads.cancel(j.id)); return; }
      const cancel = t.closest('[data-cancel]'); if (cancel) return Downloads.cancel(cancel.dataset.cancel);
      const pm = t.closest('[data-pref-mode]'); if (pm) { const p = await DB.getKV('readerPrefs', {}); p.mode = pm.dataset.prefMode; await DB.setKV('readerPrefs', p); return render(); }
      const tm = t.closest('[data-theme-mode] button'); if (tm) { const th = await DB.getKV('theme', { mode: 'dark', ac: ACCENTS[0] }); th.mode = tm.dataset.v; await DB.setKV('theme', th); await applyTheme(); return render(); }
      const ac = t.closest('[data-accent]'); if (ac) { const th = await DB.getKV('theme', { mode: 'dark', ac: ACCENTS[0] }); th.ac = ac.dataset.accent; await DB.setKV('theme', th); await applyTheme(); return render(); }
      const star = t.closest('[data-stars] [data-rate]'); if (star) { const ser = await DB.get('series', ui.detail.id); const v = +star.dataset.rate; ser.rating = ser.rating === v ? 0 : v; ser.rateAt = Date.now(); await DB.put('series', ser); return openDetail(ui.detail.id, $('#detail').scrollTop || 1); }
      const li = t.closest('[data-list]'); if (li) { const ser = await DB.get('series', ui.detail.id); const l = li.dataset.list; ser.lists = (ser.lists || []).includes(l) ? ser.lists.filter(x => x !== l) : [...(ser.lists || []), l]; await DB.put('series', ser); return openDetail(ui.detail.id, $('#detail').scrollTop || 1); }
      const dtab = t.closest('[data-dtab]'); if (dtab) { ui.dTab = dtab.dataset.dtab; return openDetail(ui.detail.id, $('#detail').scrollTop || 1); }
      const dt = t.closest('[data-dt]'); if (dt) { if (dt.dataset.dt === 'sort') ui.dSort = ui.dSort === 'asc' ? 'desc' : 'asc'; else ui.dUnread = !ui.dUnread; return openDetail(ui.detail.id, $('#detail').scrollTop || 1); }
      const sm = t.closest('[data-smode]'); if (sm) { const ser = await DB.get('series', ui.detail.id); ser.reader = { ...(ser.reader || {}), mode: sm.dataset.smode }; await DB.put('series', ser); toast('Se abrirá en modo ' + sm.querySelector('b').textContent); return openDetail(ui.detail.id, $('#detail').scrollTop || 1); }
      const hr = t.closest('[data-hero]'); if (hr) { ui.hero = +hr.dataset.hero; heroTick(true); return updateHero(); }
      const rl = t.closest('[data-rail]'); if (rl) { const [id, d] = rl.dataset.rail.split('|'); const r = $('#rail-' + id); r.scrollBy({ left: r.clientWidth * .8 * d, behavior: 'smooth' }); return; }
      const act = t.closest('[data-act]')?.dataset.act; if (!act) return;
      if (act === 'import') $('#importBtn').click();
      if (act === 'wish') { const added = await Catalog.toggleWish(ui.detail.cat); toast(added ? 'Guardado en Explorar' : 'Quitado'); if (ui.view === 'explorar') render(); return catalogDetail(ui.detail.id, $('#detail').scrollTop); }
      if (act === 'askBot') return askBot(ui.detail.cat.title);
      if (act === 'srcSearch') { ui.exQ = ui.detail.cat.title; ui.exKind = ui.detail.cat.kind; closeDetail(); return go('explorar'); }
      if (act === 'retryCat') return render();
      if (act === 'closeDetail') closeDetail();
      if (act === 'anilist') return anilistSheet(ui.detail.s);
      if (act === 'editLists') return editLists();
      if (act === 'follow') { const ser = await DB.get('series', ui.detail.id); ser.follow = !ser.follow; await DB.put('series', ser); if (ser.follow) Notify.ask(); return openDetail(ui.detail.id, $('#detail').scrollTop || 1); }
      if (act === 'more') { t.closest('.d-desc')?.classList.toggle('clamp'); return; }
      if (act === 'exportBk') { await Backup.exportFile(); return toast('Copia descargada'); }
      if (act === 'importBk') { try { const r = await Backup.importFile(); if (r) { toast(`Copia importada: ${r.newSeries} series nuevas, ${r.updated} capítulos actualizados`); refresh(); } } catch (e) { toast(e.message); } return; }
      if (act === 'tgSync') { const tg = await DB.getKV('telegram', {}); tg.sync = !tg.sync; await DB.setKV('telegram', tg); if (tg.sync) Tg.sync().then(r => r && toast(r)).catch(e => toast(e.message)); return render(); }
      if (act === 'autoClean') { await DB.setKV('autoClean', !(await DB.getKV('autoClean', false))); return render(); }
      if (act === 'autoMeta') { await DB.setKV('autoMeta', !(await DB.getKV('autoMeta', true))); return render(); }
      if (act === 'cleanNow') { if (!(await confirmSheet('¿Borrar los archivos de todo lo que ya has visto o leído? El progreso se mantiene.', 'Borrar'))) return; const f = await Space.clean(); toast('Liberado ' + fmtSize(f)); return refresh(); }
      if (act === 'diag') { const rows = await Space.diagnose(); return sheet(`<h3>Diagnóstico de este dispositivo</h3>${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b style="text-align:right">${esc(v)}</b></div>`).join('')}<div class="acts"><button class="btn primary" data-close>Cerrar</button></div>`); }
      if (act === 'clearQ') { ui.libQ = ''; $('#gq').value = ''; render(); }
      if (act === 'seriesMenu') seriesMenu();
      if (act === 'addAddon') addAddonSheet();
      if (act === 'clearDone') Downloads.clearDone();
      if (act === 'install') install();
      if (act === 'clearDemo') { await Demo.clear(); closeDetail(); toast('Ejemplos quitados'); refresh(); }
      if (act === 'addDemo') { await DB.setKV('demoSeeded', false); await Demo.seed(); refresh(); }
      if (act === 'dlAll') { const { s, remote } = ui.detail; await Downloads.enqueue(remote, { ...s, id: ridOf(s.id) }, s.items.filter(i => !i.have)); toast('Descargando ' + s.title); go('descargas'); }
      if (act === 'saveTg' || act === 'tgLogin') {
        const tgv = { ...(await DB.getKV('telegram', {})), apiId: $('#tgId').value.trim(), apiHash: $('#tgHash').value.trim() };
        await DB.setKV('telegram', tgv);
        if (act === 'saveTg') return toast('Guardado en este dispositivo');
        if (!tgv.apiId || !tgv.apiHash) return toast('Escribe primero api_id y api_hash');
        progress('Conectando con Telegram…');
        try { await Tg.connect({ interactive: true }); toast('Sesión iniciada en Telegram'); } catch (e) { toast(e.message); }
        return render();
      }
      if (act === 'tgLogout') { if (!(await confirmSheet('¿Cerrar la sesión de Telegram en este dispositivo?', 'Cerrar sesión'))) return; await Tg.logout(); toast('Sesión cerrada'); return render(); }
      if (act === 'openNews') { const n = (await DB.getKV('news', [])).find(x => x.id === t.closest('[data-news]').dataset.news); if (!n) return; await Notify.dismiss(n.id); if (n.bot) { const a = await DB.get('addons', n.bot); if (a) Tg.openChat(a); } else if (n.remote) openDetail(n.remote); else openDetail(n.seriesId); return render(); }
    });

    let st;
    document.addEventListener('input', e => {
      if (e.target.id === 'libQ') { ui.libQ = e.target.value; render(); }
      if (e.target.id === 'gq') { ui.libQ = e.target.value; if (ui.view !== 'biblioteca') go('biblioteca').then(() => $('#gq').focus()); else render(); }
      if (e.target.id === 'exQ') { ui.exQ = e.target.value; clearTimeout(st); st = setTimeout(render, 300); }
    });
    document.addEventListener('focusout', async e => { if (e.target.id === 'dNote' && ui.detail) { const ser = await DB.get('series', ui.detail.id); if ((ser.note || '') !== e.target.value) { ser.note = e.target.value; ser.noteAt = Date.now(); await DB.put('series', ser); toast('Nota guardada'); } } });
    document.addEventListener('change', e => { if (e.target.id === 'libSort') { ui.libSort = e.target.value; render(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.detail && $('#reader').hidden && $('#player').hidden && $('#sheet').hidden) closeDetail(); });

    // Arrastrar y soltar (PC)
    let dc = 0;
    addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { dc++; $('#drop').hidden = false; } });
    addEventListener('dragleave', () => { if (--dc <= 0) { dc = 0; $('#drop').hidden = true; } });
    addEventListener('dragover', e => e.preventDefault());
    addEventListener('drop', e => { e.preventDefault(); dc = 0; $('#drop').hidden = true; if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

    Downloads.on(() => {
      const n = Downloads.active(); const b = $('#dlBadge'); b.hidden = !n; b.textContent = n;
      if (ui.view === 'descargas') render();
      if (!n) { refresh(); }
    });
  }

  /* Archivos compartidos desde otra app (Android → Compartir → Lector) */
  async function takeShared() {
    if (!location.search.includes('share=1')) return;
    history.replaceState(null, '', location.pathname);
    const keys = await DB.getKV('shared', []);
    if (!keys.length) return;
    const files = [];
    for (const k of keys) { const f = await DB.get('files', k); if (f) { files.push(new File([f.blob], f.name, { type: f.type })); await DB.del('files', k); } }
    await DB.setKV('shared', []);
    importFiles(files);
  }

  let heroT;
  function updateHero() { const h = $('#hero'); if (h && ui.heroList?.length) h.outerHTML = heroHTML(ui.heroList); }
  function heroTick(reset) {
    clearInterval(heroT);
    heroT = setInterval(() => {
      if (ui.view !== 'inicio' || document.hidden || !$('#hero') || !$('#reader').hidden || !$('#player').hidden) return;
      const n = $('#hero .dots')?.children.length || 0; if (n < 2) return;
      ui.hero = (ui.hero + 1) % n; updateHero();
    }, 8000);
  }
  async function start() {
    await applyTheme();
    bind();
    heroTick();
    if (!(await DB.getKV('v3'))) { await Demo.clear(); await DB.setKV('v3', true); await DB.setKV('demoSeeded', true); }
    if (!(await DB.getKV('iaAdded'))) { // fuente legal incluida (se puede desactivar o quitar en Ajustes)
      await DB.put('addons', { id: 'archive', type: 'archive', name: 'Internet Archive', enabled: true, builtin: true, desc: 'Animación, películas y cómics de dominio público o con licencia libre.' });
      await DB.setKV('iaAdded', true);
    }
    await go(ui.view);
    Space.persist();
    Notify.startLoop(() => { if (ui.view === 'inicio') render(); });
    const doSync = () => Tg.sync().then(r => { if (r && /actualizados/.test(r) && !/ 0 cap/.test(r)) { toast(r); refresh(); } }).catch(() => { });
    setTimeout(doSync, 3000);
    let lastPush = 0;
    document.addEventListener('visibilitychange', () => { if (document.hidden && Date.now() - lastPush > 5 * 60 * 1000) { lastPush = Date.now(); doSync(); } });
    navStorage();
    takeShared();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  async function setCover(seriesId, blob, kind, name = '') {
    let c = null;
    try {
      if (kind === 'anime') c = await videoThumb(new File([blob], name || 'v.mp4', { type: blob.type || 'video/mp4' }));
      else if (blob.type.startsWith('image/')) c = await thumb(blob);
      else { const pg = await Formats.pages(blob, name); if (pg[0]) c = await thumb(await pg[0].load()); }
    } catch { }
    if (!c) return;
    const s = await DB.get('series', seriesId); if (!s || s.realCover) return;
    s.cover = c; s.realCover = true; await DB.put('series', s);
  }
  return { start, refresh, setCover, esc, toast, progress, convertVideo, fmtSize, sheet, touch, saveProgress, adjacent, saveSeriesMode, saveSeriesReader, parseName, importFiles };
})();
App.start();
