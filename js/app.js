/* Lector · interfaz principal (vistas, ficha de serie, importación, ajustes). */
const App = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VERSION = '0.1.0';
  const TITLES = { inicio: 'Inicio', biblioteca: 'Biblioteca', explorar: 'Explorar', descargas: 'Descargas', ajustes: 'Ajustes' };
  const ui = { view: 'inicio', libKind: 'all', libSort: 'recent', libQ: '', exKind: '', exQ: '', detail: null };

  /* ---------- utilidades ---------- */
  function fmtSize(b) { if (!b) return '0 MB'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i > 2 ? 1 : 0) + ' ' + u[i]; }
  function fmtTime(s) { s = Math.round(s); const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; }
  let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2600); }
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

  function play(series, item) {
    const done = () => refresh();
    if (series.kind === 'anime') Player.open(item, series, done); else Reader.open(item, series, done);
  }

  /* ---------- piezas de interfaz ---------- */
  const tag = k => `<span class="tag ${k}">${k}</span>`;
  function cardHTML(s, extra = '') {
    const p = s.items?.length ? s.doneCount / s.items.length : 0;
    return `<button class="card ${ui.detail?.id === s.id ? 'sel' : ''}" data-series="${esc(s.id)}" ${extra}>
      <div class="cv"><img src="${esc(s.cover)}" alt="" loading="lazy">${tag(s.kind)}${p ? `<div class="prog"><i style="width:${p * 100}%"></i></div>` : ''}</div>
      <b>${esc(s.title)}</b><div class="tiny">${s.items ? `${s.doneCount}/${s.items.length} ${s.kind === 'anime' ? 'vistos' : 'leídos'}` : esc(s.sourceName || '')}</div></button>`;
  }
  function contHTML(s, it) {
    const frac = it.total ? Math.min(1, it.pos / it.total) : 0;
    const left = s.kind === 'anime' ? (it.total ? `quedan ${fmtTime(it.total - it.pos)}` : '') : (it.total ? `pág. ${it.pos + 1} de ${it.total}` : '');
    return `<button class="cont" data-play="${esc(s.id)}|${esc(it.id)}">
      <div class="cv"><img src="${esc(s.cover)}" alt=""></div>
      <div class="info"><b>${esc(s.title)}</b><div class="muted">${esc(it.title)}</div><div class="tiny">${left}</div>
      <div class="bar"><i style="width:${frac * 100}%"></i></div></div>
      <span class="play"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></span></button>`;
  }
  const emptyLib = () => `<div class="empty"><b>Tu biblioteca está vacía</b>Añade archivos de anime o manga desde este dispositivo, o descárgalos desde Explorar.
    <div><button class="btn primary" data-act="import">Añadir archivos</button> <button class="btn" data-go="explorar">Ir a Explorar</button></div></div>`;

  /* ---------- vistas ---------- */
  const views = {
    async inicio() {
      const lib = await libraryData();
      if (!lib.length) return emptyLib();
      const cont = lib.filter(s => s.lastAt).sort((a, b) => b.lastAt - a.lastAt).map(s => [s, continueItem(s)]).filter(x => x[1]);
      const recent = [...lib].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
      const anime = lib.filter(s => s.kind === 'anime').length, manga = lib.length - anime;
      return `${cont.length ? `<h2 class="sec">Continuar</h2><div class="rail">${cont.map(([s, it]) => contHTML(s, it)).join('')}</div>` : ''}
        <h2 class="sec">Añadido recientemente <button class="btn sm ghost" data-go="biblioteca">Ver todo<span class="hide-m">&nbsp;(${anime} anime · ${manga} manga)</span></button></h2>
        <div class="grid">${recent.map(s => cardHTML(s)).join('')}</div>`;
    },

    async biblioteca() {
      let lib = await libraryData();
      if (!lib.length) return emptyLib();
      if (ui.libKind !== 'all') lib = lib.filter(s => s.kind === ui.libKind);
      if (ui.libQ) lib = lib.filter(s => norm(s.title).includes(norm(ui.libQ)));
      const sorters = { recent: (a, b) => (b.lastAt || b.addedAt) - (a.lastAt || a.addedAt), az: (a, b) => a.title.localeCompare(b.title), added: (a, b) => b.addedAt - a.addedAt };
      lib.sort(sorters[ui.libSort]);
      return `<div class="toolbar">
          <div class="chips" data-chips="libKind">${[['all', 'Todo'], ['anime', 'Anime'], ['manga', 'Manga']].map(([k, l]) => `<button class="chip ${ui.libKind === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
          <input type="search" id="libQ" placeholder="Buscar en tu biblioteca" value="${esc(ui.libQ)}">
          <select id="libSort" style="width:auto">${[['recent', 'Última actividad'], ['added', 'Añadido'], ['az', 'A–Z']].map(([k, l]) => `<option value="${k}" ${ui.libSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        ${lib.length ? `<div class="grid">${lib.map(s => cardHTML(s)).join('')}</div>` : `<p class="muted">Nada coincide con la búsqueda.</p>`}`;
    },

    async explorar() {
      const addons = (await Addons.list()).filter(a => a.enabled);
      if (!addons.length) return `<div class="empty"><b>No tienes add-ons activos</b>Los add-ons son tus fuentes: bots de Telegram o catálogos de streaming.<div><button class="btn primary" data-act="addAddon">Añadir add-on</button></div></div>`;
      const bots = addons.filter(a => a.type === 'telegram');
      const head = `<div class="toolbar">
        <input type="search" id="exQ" placeholder="Buscar en todos tus add-ons" value="${esc(ui.exQ)}" style="max-width:420px">
        <div class="chips" data-chips="exKind">${[['', 'Todo'], ['anime', 'Anime'], ['manga', 'Manga']].map(([k, l]) => `<button class="chip ${ui.exKind === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div></div>`;
      const botRow = bots.length ? `<h2 class="sec">Tus bots de Telegram</h2><div class="list">${bots.map(b => `<div class="row"><div class="ico tg">${tgIcon}</div><div class="grow"><b>${esc(b.name)}</b><span class="tiny">${esc(b.bot)} · ${esc((b.kinds || []).join(', ') || 'anime y manga')}</span></div><button class="btn sm" data-bot="${esc(b.id)}">Pedir${ui.exQ ? ` "${esc(ui.exQ)}"` : ''}</button></div>`).join('')}</div>` : '';
      const res = await Addons.search(ui.exQ, ui.exKind);
      const blocks = res.map(({ addon, results, error }) => `<h2 class="sec">${esc(addon.name)} <span class="tiny">${error ? 'Error: ' + esc(error) : results.length + ' resultados'}</span></h2>
        ${results.length ? `<div class="grid">${results.map(r => cardHTML({ ...r, sourceName: addon.name, id: 'r:' + addon.id + ':' + r.id })).join('')}</div>` : ''}`).join('');
      return head + botRow + blocks;
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
      const rp = await DB.getKV('readerPrefs', { mode: 'rtl', double: 'auto' });
      const hasDemo = (await DB.all('series')).some(s => s.demo);
      const icon = a => a.type === 'telegram' ? `<div class="ico tg">${tgIcon}</div>` : `<div class="ico st"><svg viewBox="0 0 24 24"><path d="M3 6h18v12H3z"/><path d="M10 9l5 3-5 3z"/></svg></div>`;
      return `<div class="cols">
        <div class="panel"><h3>Add-ons <button class="btn sm primary" data-act="addAddon">+ Añadir</button></h3>
          <div class="list">${addons.map(a => `<div class="row">${icon(a)}<div class="grow"><b>${esc(a.name)}</b><span class="tiny">${a.type === 'telegram' ? 'Bot de Telegram · ' + esc(a.bot) : 'Streaming' + (a.builtin ? ' · incluido' : '')}</span></div>
            <button class="switch ${a.enabled ? 'on' : ''}" data-toggle="${esc(a.id)}" title="Activar/desactivar"></button>
            <button class="btn sm ghost" data-remove="${esc(a.id)}" title="Quitar">✕</button></div>`).join('') || '<p class="muted">Sin add-ons.</p>'}</div>
          <p class="tiny" style="margin-top:8px">Formato para crear tus propios add-ons: docs/ADDONS.md en la carpeta del proyecto.</p></div>

        <div class="panel"><h3>Cuenta de Telegram <span class="tiny">${tg.session ? 'Conectada' : 'Sin conectar'}</span></h3>
          <p class="muted" style="margin-bottom:10px">Para pedir cosas a tus bots, Lector inicia sesión con tu cuenta (solo en este dispositivo). Las claves se sacan gratis en my.telegram.org → API development tools.</p>
          <div class="field"><label>api_id</label><input id="tgId" inputmode="numeric" value="${esc(tg.apiId || '')}" placeholder="1234567"></div>
          <div class="field"><label>api_hash</label><input id="tgHash" value="${esc(tg.apiHash || '')}" placeholder="0123456789abcdef…"></div>
          <div class="chips"><button class="btn" data-act="saveTg">Guardar claves</button><button class="btn primary" data-act="tgLogin">Iniciar sesión</button></div></div>

        <div class="panel"><h3>Lectura</h3>
          <div class="kv"><span>Dirección por defecto</span><div class="seg" data-pref="mode">${[['rtl', 'Manga'], ['ltr', 'Cómic'], ['vertical', 'Webtoon']].map(([k, l]) => `<button data-v="${k}" class="${rp.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="kv"><span>Doble página</span><div class="seg" data-pref="double">${[['auto', 'Auto'], ['on', 'Sí'], ['off', 'No']].map(([k, l]) => `<button data-v="${k}" class="${rp.double === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <p class="tiny">Cada serie recuerda su propio modo si lo cambias mientras lees.</p></div>

        <div class="panel"><h3>App</h3>
          <div class="kv"><span>Versión</span><span class="muted">${VERSION}</span></div>
          <div class="kv"><span>Instalar en este dispositivo</span>${installBtn()}</div>
          <div class="kv"><span>Datos de ejemplo</span>${hasDemo ? '<button class="btn sm" data-act="clearDemo">Quitar</button>' : '<button class="btn sm" data-act="addDemo">Volver a cargar</button>'}</div>
          <div class="kv"><span>Formatos</span><span class="tiny" style="text-align:right">Manga: CBZ, ZIP, imágenes, carpetas<br>Anime: MP4, WebM, MKV* + .srt/.vtt</span></div></div>
      </div>`;
    },
  };

  const tgIcon = `<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M21.5 4.3L2.9 11.4c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.3-1.5zM8.6 14l9.5-6c.4-.3.8-.1.5.2l-7.9 7.2-.3 3.3z"/></svg>`;

  /* ---------- ficha de serie (panel derecho / pantalla completa en móvil) ---------- */
  async function openDetail(id) {
    let s, remote = null;
    if (id.startsWith('r:')) {
      const [, aid, rid] = id.split(':');
      const addon = await DB.get('addons', aid);
      s = await Addons.series(addon, rid);
      remote = addon;
      const sid = 'src-' + aid + '-' + rid;
      const have = new Set((await DB.byIndex('items', 'seriesId', sid)).map(i => i.num));
      s.items.forEach(i => i.have = have.has(i.num));
      s.id = id;
    } else {
      s = (await libraryData()).find(x => x.id === id);
      if (!s) return closeDetail();
    }
    ui.detail = { id, remote, s };
    const d = $('#detail');
    const cur = remote ? null : continueItem(s);
    const verb = s.kind === 'anime' ? 'Ver' : 'Leer';
    const items = s.items.map(it => {
      const frac = it.total && !it.done ? it.pos / it.total : 0;
      const sub = remote ? (it.have ? 'En tu biblioteca' : fmtSize(it.size)) : it.done ? (s.kind === 'anime' ? 'Visto' : 'Leído') : frac ? (s.kind === 'anime' ? fmtTime(it.pos) + ' de ' + fmtTime(it.total) : `Pág. ${it.pos + 1} de ${it.total}`) : fmtSize(it.size);
      return `<div class="ep ${it.done ? 'done' : ''} ${cur?.id === it.id ? 'cur' : ''}">
        <button class="ep" style="padding:0;flex:1" data-item="${remote ? 'r' + it.num : esc(it.id)}"><span class="n">${it.num}</span>
        <span class="grow"><b>${esc(it.title)}</b><span class="tiny">${sub}</span>${frac ? `<div class="mini"><i style="width:${frac * 100}%"></i></div>` : ''}</span></button>
        ${remote ? (it.have ? '' : `<button class="more" data-dl="${it.num}" title="Descargar"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button>`)
                 : `<button class="more" data-menu="${esc(it.id)}" title="Más"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></button>`}</div>`;
    }).join('');
    d.innerHTML = `<div class="d-head"><div class="cv"><img src="${esc(s.cover)}" alt="">${tag(s.kind)}</div>
        <div style="min-width:0;padding-right:30px"><h2>${esc(s.title)}</h2>
        <div class="tiny">${s.items.length} ${s.kind === 'anime' ? 'episodios' : 'capítulos'}${remote ? ' · ' + esc(remote.name) : ` · ${s.doneCount} ${s.kind === 'anime' ? 'vistos' : 'leídos'} · ${fmtSize(s.size)}`}</div>
        ${s.source && !remote ? `<div class="tiny">Fuente: ${esc(s.source)}</div>` : ''}</div>
        <button class="d-close" data-act="closeDetail" title="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="d-actions">
        ${remote ? `<button class="btn primary" data-act="dlAll">Descargar todo</button><button class="btn" data-item="r1">${verb} online</button>`
                 : `${cur ? `<button class="btn primary" data-item="${esc(cur.id)}">${cur.pos || cur.lastAt ? 'Continuar' : verb} · ${esc(cur.title)}</button>` : `<button class="btn primary" data-item="${esc(s.items[0]?.id)}">${verb} de nuevo</button>`}
                    <button class="btn icon" data-act="seriesMenu" title="Más opciones">⋯</button>`}
      </div>
      ${s.desc ? `<p class="d-desc">${esc(s.desc)}</p>` : ''}
      <div class="eps">${items}</div>`;
    $('#app').classList.add('has-detail');
    document.querySelectorAll('.card').forEach(c => c.classList.toggle('sel', c.dataset.series === id));
    d.scrollTop = 0;
    d.querySelector('.ep.cur')?.scrollIntoView({ block: 'center' });
  }
  function closeDetail() { ui.detail = null; $('#app').classList.remove('has-detail'); document.querySelectorAll('.card.sel').forEach(c => c.classList.remove('sel')); }

  async function itemClick(key) {
    const { s, remote } = ui.detail;
    if (remote) {
      const it = s.items.find(i => 'r' + i.num === key);
      if (it.have) { const sid = 'src-' + remote.id + '-' + s.id.split(':')[2]; const local = await DB.get('items', sid + '-' + it.num); const ser = await DB.get('series', sid); return play(ser, local); }
      // Ver online sin descargar
      const ser = { id: 'tmp', title: s.title, kind: s.kind, hue: s.hue, mode: 'rtl' };
      const tmp = { id: 'tmp-' + it.num, seriesId: 'tmp', num: it.num, title: it.title, demo: it.demo, total: s.kind === 'anime' ? 1440 : 18, pos: 0 };
      if (!it.demo) { toast('Ver online para este add-on llegará en el siguiente paso'); return; }
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
      <button class="ep" data-m="rename">Cambiar nombre</button>
      <button class="ep" data-m="reset">Reiniciar progreso</button>
      <button class="ep" data-m="del" style="color:#ff7a7a">Borrar serie y archivos (${fmtSize(s.size)})</button></div>
      <div class="acts"><button class="btn" data-close>Cerrar</button></div>`, (w, close) => {
      $('#smMode', w)?.addEventListener('click', async e => { const v = e.target.dataset.v; if (!v) return; await saveSeriesMode(s, v); s.mode = v; w.querySelectorAll('#smMode button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); });
      w.querySelector('.menu').addEventListener('click', async e => {
        const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return; close();
        if (m === 'rename') return sheet(`<h3>Cambiar nombre</h3><input id="nn" value="${esc(s.title)}"><div class="acts"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button></div>`, (w2, c2) => {
          $('#ok', w2).onclick = async () => { const r = await DB.get('series', s.id); r.title = $('#nn', w2).value.trim() || r.title; await DB.put('series', r); c2(); refresh(); };
        });
        if (m === 'reset') { for (const x of s.items) { x.done = false; x.pos = 0; x.lastAt = 0; await DB.put('items', strip(x)); } const r = await DB.get('series', s.id); r.lastAt = 0; await DB.put('series', r); }
        if (m === 'del') { if (!(await confirmSheet(`¿Borrar "${s.title}" de este dispositivo?`))) return; for (const x of s.items) await deleteItem(x); await DB.del('series', s.id); closeDetail(); toast('Serie borrada'); }
        refresh();
      });
    });
  }

  /* ---------- add-ons: formulario ---------- */
  function addAddonSheet() {
    sheet(`<h3>Añadir add-on</h3>
      <div class="seg" id="aType" style="margin-bottom:12px"><button data-v="telegram" class="on">Bot de Telegram</button><button data-v="streaming">Streaming</button></div>
      <div id="aTg">
        <div class="field"><label>Nombre</label><input id="aName" placeholder="Mi bot de anime"></div>
        <div class="field"><label>Usuario del bot</label><input id="aBot" placeholder="@mibot"></div>
        <div class="field"><label>Qué manda</label><div class="seg" id="aKinds"><button data-v="anime" class="on">Anime</button><button data-v="manga" class="on">Manga</button></div></div>
        <div class="field"><label>Comando para buscar (opcional)</label><input id="aCmd" placeholder="/buscar {q}"><span class="tiny">{q} se sustituye por lo que busques. Si lo dejas vacío, se envía el texto tal cual.</span></div>
      </div>
      <div id="aSt" hidden>
        <div class="field"><label>Enlace al add-on (.json) o pega el JSON</label><input id="aUrl" placeholder="https://…/addon.json"></div>
        <p class="tiny">Formato en docs/ADDONS.md.</p>
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
          } else await Addons.install($('#aUrl', w).value);
          close(); toast('Add-on añadido'); refresh();
        } catch (e) { $('#aErr', w).textContent = e.message; }
      };
    });
  }

  function botSheet(id) {
    DB.get('addons', id).then(b => sheet(`<h3>${esc(b.name)}</h3>
      <p class="muted">Aquí podrás escribirle a ${esc(b.bot)} sin salir de Lector: lo que te mande (vídeos, CBZ, imágenes) entrará directo en tu biblioteca.</p>
      <div class="note">Falta un paso: conectar tu cuenta de Telegram (Ajustes → Cuenta de Telegram) y que me pases los comandos de tus bots. Mientras tanto, puedes descargar el archivo en Telegram y añadirlo con el botón "Añadir".</div>
      <div class="acts"><button class="btn" data-close>Cerrar</button><button class="btn primary" data-close data-go="ajustes">Ir a Ajustes</button></div>`));
  }

  /* ---------- importar archivos ---------- */
  const VID = /\.(mp4|m4v|webm|mkv|mov)$/i, SUB = /\.(srt|vtt)$/i, IMG = /\.(jpe?g|png|webp|gif|avif|bmp)$/i, ARC = /\.(cbz|zip)$/i;
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
          await DB.put('files', { key: k, blob: f, name: f.name, type: f.type || (ARC.test(f.name) ? 'application/zip' : '') });
          Object.assign(base, { fileKey: k, size: f.size });
          if (g.kind === 'anime') {
            const stem = f.name.replace(/\.[^.]+$/, '');
            const mine = subs.filter(sb => sb.name.startsWith(stem) || (g.chapters.length === 1 && subs.length));
            base.subKeys = [];
            for (const sb of mine) { const sk = id + '-s' + base.subKeys.length; await DB.put('files', { key: sk, blob: sb, name: sb.name, type: 'text/plain' }); base.subKeys.push(sk); }
            if (!s.realCover) { const t = await videoThumb(f); if (t) { s.cover = t; s.realCover = true; } }
          } else if (!s.realCover) {
            try { const pg = await Zip.pages(f); base.total = pg.length; if (pg[0]) { s.cover = await thumb(await pg[0].load()); s.realCover = true; } } catch { }
          }
        }
        await DB.put('items', base); its.push(base); n++;
      }
      await DB.put('series', s);
    }
    toast(`${n} ${n === 1 ? 'archivo añadido' : 'archivos añadidos'}`);
    refresh();
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
    if (innerWidth <= 700) closeDetail();
    await render();
    $('#main').scrollTop = 0;
  }
  let rendering = false, again = false;
  async function render() {
    if (rendering) { again = true; return; }
    rendering = true;
    const focus = document.activeElement?.id; const caret = document.activeElement?.selectionStart;
    $('#view').innerHTML = await views[ui.view]();
    if (focus && $('#' + focus)) { const f = $('#' + focus); f.focus(); try { f.setSelectionRange(caret, caret); } catch { } }
    rendering = false;
    if (again) { again = false; render(); }
  }
  async function refresh() { await render(); if (ui.detail) await openDetail(ui.detail.id); navStorage(); }

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
      const sEl = t.closest('[data-series]'); if (sEl) return openDetail(sEl.dataset.series);
      const pEl = t.closest('[data-play]'); if (pEl) { const [sid, iid] = pEl.dataset.play.split('|'); const s = await DB.get('series', sid); return play(s, await DB.get('items', iid)); }
      const iEl = t.closest('#detail [data-item]'); if (iEl) return itemClick(iEl.dataset.item);
      const mEl = t.closest('[data-menu]'); if (mEl) return itemMenu(mEl.dataset.menu);
      const dEl = t.closest('[data-dl]'); if (dEl) { const { s, remote } = ui.detail; const it = s.items.find(i => i.num === +dEl.dataset.dl); await Downloads.enqueue(remote, { ...s, id: s.id.split(':')[2] }, [it]); dEl.remove(); return toast('Añadido a descargas'); }
      const chips = t.closest('[data-chips] .chip'); if (chips) { ui[chips.parentElement.dataset.chips] = chips.dataset.v; return render(); }
      const tg = t.closest('[data-toggle]'); if (tg) { await Addons.toggle(tg.dataset.toggle); return render(); }
      const rm = t.closest('[data-remove]'); if (rm) { if (await confirmSheet('¿Quitar este add-on?', 'Quitar')) { await Addons.remove(rm.dataset.remove); render(); } return; }
      const bot = t.closest('[data-bot]'); if (bot) return botSheet(bot.dataset.bot);
      const cs = t.closest('[data-cancelsid]'); if (cs) { Downloads.jobs.filter(j => j.sid === cs.dataset.cancelsid && j.state === 'cola').forEach(j => Downloads.cancel(j.id)); return; }
      const cancel = t.closest('[data-cancel]'); if (cancel) return Downloads.cancel(cancel.dataset.cancel);
      const pref = t.closest('[data-pref] button'); if (pref) { const k = pref.parentElement.dataset.pref; const p = await DB.getKV('readerPrefs', { mode: 'rtl', double: 'auto' }); p[k] = pref.dataset.v; await DB.setKV('readerPrefs', p); return render(); }
      const act = t.closest('[data-act]')?.dataset.act; if (!act) return;
      if (act === 'import') $('#importBtn').click();
      if (act === 'closeDetail') closeDetail();
      if (act === 'seriesMenu') seriesMenu();
      if (act === 'addAddon') addAddonSheet();
      if (act === 'clearDone') Downloads.clearDone();
      if (act === 'install') install();
      if (act === 'clearDemo') { await Demo.clear(); closeDetail(); toast('Ejemplos quitados'); refresh(); }
      if (act === 'addDemo') { await DB.setKV('demoSeeded', false); await Demo.seed(); refresh(); }
      if (act === 'dlAll') { const { s, remote } = ui.detail; await Downloads.enqueue(remote, { ...s, id: s.id.split(':')[2] }, s.items.filter(i => !i.have)); toast('Descargando ' + s.title); go('descargas'); }
      if (act === 'saveTg' || act === 'tgLogin') {
        const tgv = { ...(await DB.getKV('telegram', {})), apiId: $('#tgId').value.trim(), apiHash: $('#tgHash').value.trim() };
        await DB.setKV('telegram', tgv);
        toast(act === 'saveTg' ? 'Claves guardadas en este dispositivo' : 'El inicio de sesión con Telegram llega en el siguiente paso');
      }
    });

    let st;
    document.addEventListener('input', e => {
      if (e.target.id === 'libQ') { ui.libQ = e.target.value; render(); }
      if (e.target.id === 'exQ') { ui.exQ = e.target.value; clearTimeout(st); st = setTimeout(render, 300); }
    });
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

  async function start() {
    bind();
    await Demo.seed();
    await go(ui.view);
    navStorage();
    takeShared();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  return { start, esc, toast, sheet, touch, saveProgress, adjacent, saveSeriesMode, parseName, importFiles };
})();
App.start();
