/* Lector · lector de manga (v0.2).
   Modos:  rtl (manga), ltr (cómic), vpaged (vertical página a página), webtoon (scroll continuo),
           hstrip (tira horizontal), panels (viñeta a viñeta).
   Página: encaje (pantalla/ancho/alto/original), doble página auto/sí/no + desplazar portada,
           recortar bordes, partir páginas dobles en vertical, fondo, separación y ancho (webtoon).
   Toques: zonas (lados / L / arriba-abajo / off) e invertir, animación (deslizar/hoja/fundido/no),
           auto-scroll, pantalla encendida, pantalla completa, bloqueo de giro.
   Color:  brillo, sepia, blanco y negro, modo noche (invertido).
   La configuración se guarda por serie; "usar para todas" la guarda como predeterminada. */
const Reader = (() => {
  const root = () => document.getElementById('reader');
  const $ = s => root().querySelector(s);
  const DEF = {
    mode: 'rtl', spread: 'auto', offset: false, fit: 'screen', crop: false, split: true, bg: 'black',
    gap: 8, width: 0, anim: 'slide', tap: 'lr', invertTap: false, bright: 100, sepia: false, gray: false,
    night: false, speed: 4, awake: true, panelDir: 'rtl', hDir: 'rtl',
  };
  const MODES = [
    ['rtl', 'Manga', 'Derecha → izquierda', '<path d="M20 12H5M10 6l-6 6 6 6"/>'],
    ['ltr', 'Cómic', 'Izquierda → derecha', '<path d="M4 12h15M14 6l6 6-6 6"/>'],
    ['vpaged', 'Vertical', 'Página a página hacia abajo', '<rect x="6" y="3" width="12" height="8" rx="1"/><path d="M12 14v7M8 17l4 4 4-4"/>'],
    ['webtoon', 'Webtoon', 'Scroll continuo hacia abajo', '<rect x="7" y="2" width="10" height="20" rx="1"/><path d="M7 9h10M7 15h10"/>'],
    ['hstrip', 'Tira horizontal', 'Scroll continuo a los lados', '<rect x="2" y="7" width="20" height="10" rx="1"/><path d="M9 7v10M15 7v10"/>'],
    ['panels', 'Viñeta a viñeta', 'Zoom en cada viñeta', '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 11h18M12 11v10"/><rect x="13" y="13" width="6" height="6" fill="currentColor" stroke="none" opacity=".5"/>'],
  ];
  const PAGED = m => m === 'rtl' || m === 'ltr' || m === 'vpaged';
  const SCROLL = m => m === 'webtoon' || m === 'hstrip';
  const ico = (p, sz = 20) => `<svg viewBox="0 0 24 24" style="width:${sz}px;height:${sz}px">${p}</svg>`;
  let st = null;

  /* ---------- fuentes de páginas ---------- */
  async function sourcePages(item, series) {
    if (item.demo) {
      const tall = (series.reader?.mode || series.mode) === 'webtoon' || series.mode === 'vertical';
      return Array.from({ length: item.total }, (_, i) => ({ load: async () => Demo.page(series.title, item.num, i + 1, item.total, series.hue || 200, tall) }));
    }
    if (item.pageKeys) return item.pageKeys.map(k => ({ load: async () => URL.createObjectURL((await DB.get('files', k)).blob) }));
    if (item.fileKey) {
      const f = await DB.get('files', item.fileKey);
      if (!f) throw new Error('El archivo ya no está en este dispositivo');
      if (f.type.startsWith('image/')) return [{ load: async () => URL.createObjectURL(f.blob) }];
      return (await Zip.pages(f.blob)).map(p => ({ load: async () => URL.createObjectURL(await p.load()) }));
    }
    throw new Error('Formato no soportado todavía');
  }
  const loadImg = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('No se pudo abrir una página')); im.src = url; });

  /* ---------- análisis de imagen (recorte y viñetas) ---------- */
  async function small(p) {
    if (p.small !== undefined) return p.small;
    try {
      const im = await loadImg(p.url);
      const sc = Math.min(1, 360 / Math.max(p.w, p.h));
      const w = Math.max(1, Math.round(p.w * sc)), h = Math.max(1, Math.round(p.h * sc));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h).data, L = new Uint8Array(w * h);
      for (let k = 0, j = 0; k < L.length; k++, j += 4) L[k] = (d[j] * .3 + d[j + 1] * .59 + d[j + 2] * .11) | 0;
      let s = 0, n = 0;
      for (let i = 0; i < w; i++) { s += L[i] + L[(h - 1) * w + i]; n += 2; }
      for (let j = 0; j < h; j++) { s += L[j * w] + L[j * w + w - 1]; n += 2; }
      p.small = { L, w, h, sc, bg: s / n };
    } catch { p.small = null; }
    return p.small;
  }
  function inkFns(s) {
    const T = 34, ink = k => Math.abs(s.L[k] - s.bg) > T;
    return {
      row: (y, x0, x1) => { let c = 0; for (let x = x0; x < x1; x++) if (ink(y * s.w + x)) c++; return c; },
      col: (x, y0, y1) => { let c = 0; for (let y = y0; y < y1; y++) if (ink(y * s.w + x)) c++; return c; },
    };
  }
  function trim(s, r) {
    const f = inkFns(s), tw = Math.max(1, (r.x1 - r.x0) * .004), th = Math.max(1, (r.y1 - r.y0) * .004);
    let { x0, y0, x1, y1 } = r;
    while (y0 < y1 && f.row(y0, x0, x1) <= tw) y0++;
    while (y1 > y0 && f.row(y1 - 1, x0, x1) <= tw) y1--;
    while (x0 < x1 && f.col(x0, y0, y1) <= th) x0++;
    while (x1 > x0 && f.col(x1 - 1, y0, y1) <= th) x1--;
    return x1 - x0 > 2 && y1 - y0 > 2 ? { x0, y0, x1, y1 } : null;
  }
  async function cropOf(p) {
    if (p.crop !== undefined) return p.crop;
    const s = await small(p); p.crop = null;
    if (!s) return null;
    const r = trim(s, { x0: 0, y0: 0, x1: s.w, y1: s.h });
    if (!r) return null;
    const m = 2, x0 = Math.max(0, r.x0 - m), y0 = Math.max(0, r.y0 - m), x1 = Math.min(s.w, r.x1 + m), y1 = Math.min(s.h, r.y1 + m);
    const area = (x1 - x0) * (y1 - y0) / (s.w * s.h);
    if (area > .96 || area < .25) return null;
    p.crop = { x: x0 / s.sc, y: y0 / s.sc, w: (x1 - x0) / s.sc, h: (y1 - y0) / s.sc };
    return p.crop;
  }
  /* Detección de viñetas por cortes en los huecos (XY-cut) */
  async function panelsOf(p, dir) {
    const key = 'panels_' + dir;
    if (p[key]) return p[key];
    const s = await small(p); p[key] = [];
    if (!s) return [];
    const f = inkFns(s), minGap = Math.max(2, Math.round(Math.max(s.w, s.h) * .008));
    const segs = (a, b, gap) => {
      const out = []; let start = -1, last = -1;
      for (let t = a; t < b; t++) {
        if (!gap(t)) { if (start < 0) start = t; else if (t - last - 1 >= minGap) { out.push([start, last + 1]); start = t; } last = t; }
      }
      if (start >= 0) out.push([start, last + 1]);
      return out;
    };
    const split = (r, depth) => {
      r = trim(s, r); if (!r) return [];
      if (depth > 5) return [r];
      const tw = Math.max(1, (r.x1 - r.x0) * .004), th = Math.max(1, (r.y1 - r.y0) * .004);
      const H = segs(r.y0, r.y1, y => f.row(y, r.x0, r.x1) <= tw);
      if (H.length > 1) return H.flatMap(([a, b]) => split({ x0: r.x0, x1: r.x1, y0: a, y1: b }, depth + 1));
      let V = segs(r.x0, r.x1, x => f.col(x, r.y0, r.y1) <= th);
      if (V.length > 1) { if (dir === 'rtl') V = V.reverse(); return V.flatMap(([a, b]) => split({ x0: a, x1: b, y0: r.y0, y1: r.y1 }, depth + 1)); }
      return [r];
    };
    const total = s.w * s.h;
    const list = split({ x0: 0, y0: 0, x1: s.w, y1: s.h }, 0).filter(r => (r.x1 - r.x0) * (r.y1 - r.y0) > total * .02);
    if (list.length > 1 && list.length <= 16) {
      const pad = 4;
      p[key] = list.map(r => ({ x: Math.max(0, r.x0 - pad) / s.sc, y: Math.max(0, r.y0 - pad) / s.sc, w: (Math.min(s.w, r.x1 + pad) - Math.max(0, r.x0 - pad)) / s.sc, h: (Math.min(s.h, r.y1 + pad) - Math.max(0, r.y0 - pad)) / s.sc }));
    }
    return p[key];
  }

  /* ---------- abrir ---------- */
  async function open(item, series, onClose) {
    const prefs = await DB.getKV('readerPrefs', {});
    const legacy = { vertical: 'webtoon' }[series.mode] || series.mode;
    const cfg = { ...DEF, ...prefs, ...(legacy && !series.reader ? { mode: legacy } : {}), ...(series.reader || {}) };
    st = { item, series, onClose, cfg, pages: [], vp: [], units: [], cur: 0, pi: -1, tok: 0, z: { s: 1, x: 0, y: 0 }, cache: new Map(), urls: [] };
    st.next = await App.adjacent(item, 1);
    const r = root();
    r.hidden = false; r.className = 'overlay reader';
    r.innerHTML = `
      <div class="stage" id="rStage"></div>
      <div class="ov-bar top">
        <button class="ov-btn" data-a="close" title="Cerrar (Esc)">${ico('<path d="M15 18l-6-6 6-6"/>')}</button>
        <div class="t"><b>${App.esc(series.title)}</b><span class="tiny">${App.esc(item.title)}</span></div>
        <button class="ov-btn pill" data-a="modes" id="rModeBtn"></button>
        <button class="ov-btn" data-a="night" title="Modo noche">${ico('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>')}</button>
        <button class="ov-btn hide-xs" data-a="fs" title="Pantalla completa (F)">${ico('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button>
        <button class="ov-btn" data-a="settings" title="Ajustes de lectura">${ico('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')}</button>
      </div>
      <div class="ov-bar bottom">
        <button class="ov-btn" data-a="prevch" title="Capítulo anterior">${ico('<path d="M11 18l-6-6 6-6M19 18l-6-6 6-6"/>')}</button>
        <button class="ov-btn" data-a="thumbs" title="Miniaturas">${ico('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>')}</button>
        <input type="range" id="rSlider" min="0" value="0">
        <span id="rCount" class="rcount">–</span>
        <button class="ov-btn" data-a="auto" id="rAuto" title="Auto-scroll" hidden>${ico('<path d="M7 4l13 8-13 8z"/>')}</button>
        <button class="ov-btn" data-a="nextch" title="Capítulo siguiente">${ico('<path d="M13 6l6 6-6 6M5 6l6 6-6 6"/>')}</button>
      </div>
      <aside class="rset" id="rSet"></aside>
      <div class="thumbs" id="rThumbs" hidden></div>
      <div class="rload" id="rLoad"><div class="spin"></div><span>Cargando…</span></div>`;
    r.onclick = onClick;
    r.oninput = onInput;
    $('#rSlider').oninput = e => jump(+e.target.value);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    bindPointer($('#rStage'));
    try {
      const src = await sourcePages(item, series);
      if (!src.length) throw new Error('No hay páginas en este archivo');
      for (let i = 0; i < src.length; i++) {
        loading(`Cargando página ${i + 1} de ${src.length}`);
        const url = await src[i].load(); st.urls.push(url);
        const im = await loadImg(url);
        st.pages.push({ i, url, w: im.naturalWidth || 800, h: im.naturalHeight || 1200 });
        if (!st) return; // se cerró mientras cargaba
      }
    } catch (e) { loading(e.message, true); return; }
    const start = item.done ? 0 : Math.min(item.pos || 0, st.pages.length - 1);
    await layout(start);
    loading(null);
    look(); wake(); modeBtn();
    App.touch(series, item);
    setTimeout(() => st && !st.touched && r.classList.add('hide-ui'), 2200);
  }
  function loading(msg, err) {
    const l = $('#rLoad'); if (!l) return;
    l.hidden = !msg; if (msg) { l.querySelector('span').textContent = msg; l.querySelector('.spin').hidden = !!err; }
  }

  /* ---------- maquetación ---------- */
  const spreadOn = () => st.cfg.mode !== 'vpaged' && PAGED(st.cfg.mode) && (st.cfg.spread === 'on' || (st.cfg.spread === 'auto' && innerWidth > innerHeight && innerWidth >= 900));
  const splitOn = () => st.cfg.split && !spreadOn() && innerHeight > innerWidth && PAGED(st.cfg.mode);
  const isRTL = () => st.cfg.mode === 'rtl' || (st.cfg.mode === 'hstrip' && st.cfg.hDir === 'rtl') || (st.cfg.mode === 'panels' && st.cfg.panelDir === 'rtl');

  async function layout(srcIdx) {
    const c = st.cfg;
    if (c.crop && st.cfg.mode !== 'panels') for (const [k, p] of st.pages.entries()) { if (p.crop === undefined) { loading(`Recortando bordes ${k + 1}/${st.pages.length}`); await cropOf(p); } }
    loading(null);
    const vp = [];
    for (const p of st.pages) {
      const r = c.crop && c.mode !== 'panels' && p.crop ? p.crop : { x: 0, y: 0, w: p.w, h: p.h };
      const wide = r.w > r.h * 1.05;
      if (wide && splitOn()) {
        const L = { x: r.x, y: r.y, w: r.w / 2, h: r.h }, R = { x: r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h };
        for (const half of c.mode === 'ltr' ? [L, R] : [R, L]) vp.push({ src: p.i, r: half, w: half.w, h: half.h, wide: false, half: true });
      } else vp.push({ src: p.i, r, w: r.w, h: r.h, wide });
    }
    st.vp = vp;
    let units;
    if (spreadOn()) {
      units = []; let i = 0;
      if (c.offset && vp[0] && !vp[0].wide) { units.push({ pages: [vp[0]] }); i = 1; }
      while (i < vp.length) {
        const a = vp[i], b = vp[i + 1];
        if (a.wide || !b || b.wide) { units.push({ pages: [a] }); i++; } else { units.push({ pages: [a, b] }); i += 2; }
      }
    } else units = vp.map(v => ({ pages: [v] }));
    units.push({ end: true });
    st.units = units;
    const idx = Math.max(0, units.findIndex(u => u.pages?.some(v => v.src === srcIdx)));
    const stage = $('#rStage');
    stage.className = 'stage m-' + c.mode + ' fit-' + c.fit + (isRTL() ? ' rtl' : '');
    stage.innerHTML = '';
    stopAuto();
    $('#rAuto').hidden = !SCROLL(c.mode);
    const sl = $('#rSlider'); sl.max = units.length - 2; sl.dir = isRTL() ? 'rtl' : 'ltr';
    if (SCROLL(c.mode)) return buildStrip(idx);
    if (c.mode === 'panels') { st.pi = -1; return renderPanel(idx, 0); }
    return render(idx, 0);
  }

  async function vurl(v) {
    const p = st.pages[v.src], r = v.r;
    if (r.x === 0 && r.y === 0 && r.w === p.w && r.h === p.h) return p.url;
    const key = `${v.src}:${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`;
    if (!st.cache.has(key)) st.cache.set(key, (async () => {
      const im = await loadImg(p.url);
      const c = document.createElement('canvas'); c.width = Math.round(r.w); c.height = Math.round(r.h);
      c.getContext('2d').drawImage(im, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
      try { const b = await new Promise(res => c.toBlob(res, 'image/jpeg', .92)); const u = URL.createObjectURL(b); st.urls.push(u); return u; }
      catch { return p.url; }
    })());
    return st.cache.get(key);
  }

  function endCard() {
    const nx = st.next;
    return `<div class="endcard"><span class="tiny">Has terminado</span><b>${App.esc(st.item.title)}</b>
      ${nx ? `<span class="tiny" style="margin-top:14px">Siguiente</span><b>${App.esc(nx.title)}</b><button class="btn primary" data-a="nextch" style="margin-top:16px">Seguir leyendo</button>`
           : `<span class="muted" style="margin-top:14px">No hay más capítulos por ahora.</span><button class="btn" data-a="close" style="margin-top:16px">Volver</button>`}</div>`;
  }

  /* ---- modos paginados ---- */
  async function render(idx, dir) {
    const tok = ++st.tok, u = st.units[idx];
    st.cur = idx; resetZoom();
    const sp = document.createElement('div'); sp.className = 'spread';
    if (u.end) sp.innerHTML = endCard();
    else {
      const urls = await Promise.all(u.pages.map(vurl));
      if (tok !== st.tok) return;
      sp.innerHTML = `<div class="sp-in ${u.pages.length > 1 ? 'two' : ''}">${urls.map(s => `<img src="${s}" alt="" draggable="false">`).join('')}</div>`;
    }
    const stage = $('#rStage'), old = stage.querySelector('.spread:not(.leaving)');
    stage.appendChild(sp);
    animate(sp, old, dir);
    position();
    // precarga
    for (let k = 1; k <= 3; k++) st.units[idx + k]?.pages?.forEach(v => vurl(v).then(u => { const i = new Image(); i.src = u; }));
  }

  function animate(nw, old, dir) {
    const a = st.cfg.anim;
    if (!old) return;
    old.classList.add('leaving');
    if (!dir || a === 'none') { old.remove(); return; }
    const vert = st.cfg.mode === 'vpaged';
    const sgn = dir * (st.cfg.mode === 'rtl' ? -1 : 1);
    const ease = 'cubic-bezier(.2,.8,.2,1)';
    let anim;
    if (a === 'slide') {
      const ax = vert ? 'Y' : 'X';
      nw.animate([{ transform: `translate${ax}(${sgn * 100}%)` }, { transform: 'none' }], { duration: 280, easing: ease });
      anim = old.animate([{ transform: 'none' }, { transform: `translate${ax}(${-sgn * 100}%)` }], { duration: 280, easing: ease });
    } else if (a === 'curl') {
      old.style.zIndex = 2;
      const o = vert ? (sgn > 0 ? 'center top' : 'center bottom') : (sgn > 0 ? 'left center' : 'right center');
      old.style.transformOrigin = o;
      const rot = vert ? `rotateX(${sgn * 95}deg)` : `rotateY(${-sgn * 95}deg)`;
      anim = old.animate([{ transform: 'perspective(1800px) none', filter: 'brightness(1)' }, { transform: `perspective(1800px) ${rot}`, filter: 'brightness(.55)' }], { duration: 420, easing: 'cubic-bezier(.4,.1,.3,1)' });
    } else {
      nw.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
      anim = old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
    }
    anim.onfinish = () => old.remove();
  }

  /* ---- viñeta a viñeta ---- */
  async function renderPanel(idx, dir) {
    const tok = ++st.tok; st.cur = idx;
    const stage = $('#rStage'), u = st.units[idx];
    if (u.end) { stage.innerHTML = `<div class="spread">${endCard()}</div>`; position(); return; }
    const v = u.pages[0], p = st.pages[v.src];
    const panels = await panelsOf(p, st.cfg.panelDir);
    if (tok !== st.tok) return;
    if (dir < 0 && st.pi === -2) st.pi = panels.length - 1; // al volver, empezar por la última viñeta
    let wrap = stage.querySelector('.pv');
    if (!wrap || wrap.dataset.src != v.src) {
      stage.innerHTML = `<div class="pv" data-src="${v.src}"><img src="${p.url}" alt="" draggable="false" style="width:${p.w}px;height:${p.h}px"></div>`;
      wrap = stage.querySelector('.pv');
      if (dir) wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
    const img = wrap.querySelector('img');
    const R = st.pi >= 0 && panels[st.pi] ? panels[st.pi] : { x: 0, y: 0, w: p.w, h: p.h };
    const W = stage.clientWidth, H = stage.clientHeight, m = st.pi >= 0 ? .94 : 1;
    const S = Math.min(W * m / R.w, H * m / R.h, st.pi >= 0 ? 6 : 99);
    const tx = W / 2 - (R.x + R.w / 2) * S, ty = H / 2 - (R.y + R.h / 2) * S;
    img.style.transform = `translate(${tx}px,${ty}px) scale(${S})`;
    st.panels = panels;
    position();
    $('#rCount').textContent = `${v.src + 1} / ${st.pages.length}` + (panels.length ? ` · ${st.pi < 0 ? 'página' : 'viñeta ' + (st.pi + 1) + '/' + panels.length}` : '');
  }

  /* ---- modos de scroll ---- */
  function buildStrip(idx) {
    const c = st.cfg, stage = $('#rStage'), horiz = c.mode === 'hstrip';
    const strip = document.createElement('div');
    strip.className = 'strip ' + (horiz ? 'h' : 'v');
    strip.style.gap = c.gap + 'px';
    if (horiz) strip.dir = c.hDir === 'rtl' ? 'rtl' : 'ltr';
    const w = c.width ? c.width + '%' : 'min(100%, 820px)';
    strip.innerHTML = st.units.map((u, k) => u.end
      ? `<div class="sp endsp" data-k="${k}">${endCard()}</div>`
      : `<div class="sp" data-k="${k}" style="aspect-ratio:${u.pages[0].w}/${u.pages[0].h};${horiz ? '' : 'width:' + w}"><img alt="" draggable="false"></div>`).join('');
    stage.appendChild(strip);
    st.strip = strip;
    const io = new IntersectionObserver(es => es.forEach(async e => {
      const k = +e.target.dataset.k, im = e.target.querySelector('img');
      if (e.isIntersecting && im && !im.src) im.src = await vurl(st.units[k].pages[0]);
    }), { root: strip, rootMargin: '2000px' });
    strip.querySelectorAll('.sp').forEach(el => io.observe(el));
    st.io = io;
    let raf = 0;
    strip.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; track(); }); }, { passive: true });
    strip.addEventListener('wheel', e => { if (horiz && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); strip.scrollLeft += e.deltaY * (c.hDir === 'rtl' ? -1 : 1); } }, { passive: false });
    requestAnimationFrame(() => { strip.children[idx]?.scrollIntoView({ block: 'start', inline: 'start' }); st.cur = idx; position(); });
  }
  function track() {
    const strip = st.strip, horiz = st.cfg.mode === 'hstrip', R = strip.getBoundingClientRect();
    const mid = horiz ? R.left + R.width / 2 : R.top + R.height * .35;
    const kids = strip.children;
    let k = Math.min(st.cur, kids.length - 1);
    const at = el => { const b = el.getBoundingClientRect(); return horiz ? (b.right < mid ? 1 : b.left > mid ? -1 : 0) : (b.bottom < mid ? 1 : b.top > mid ? -1 : 0); };
    for (let n = 0; n < kids.length; n++) {
      const s = at(kids[k]);
      if (s === 0) break;
      const nk = k + (horiz && st.cfg.hDir === 'rtl' ? -s : s);
      if (nk < 0 || nk >= kids.length) break;
      k = nk;
    }
    if (k !== st.cur) { st.cur = k; position(); }
  }

  /* ---------- progreso y barra ---------- */
  function position() {
    const u = st.units[st.cur], total = st.pages.length;
    const src = u.end ? total - 1 : u.pages[0].src;
    const last = u.end || (st.units[st.cur + 1]?.end && (SCROLL(st.cfg.mode) || st.cfg.mode !== 'panels' || st.pi === (st.panels?.length || 0) - 1));
    const sl = $('#rSlider'); sl.value = Math.min(st.cur, +sl.max);
    if (st.cfg.mode !== 'panels') {
      const srcs = u.end ? [] : [...new Set(u.pages.map(v => v.src + 1))].sort((a, b) => a - b);
      $('#rCount').textContent = u.end ? 'Fin' : `${srcs.join('-')} / ${total}`;
    }
    App.saveProgress(st.item, last ? total : src, total, !!last);
  }

  /* ---------- navegación ---------- */
  function step(d) {
    const m = st.cfg.mode;
    if (SCROLL(m)) {
      const s = st.strip, horiz = m === 'hstrip';
      const amt = (horiz ? s.clientWidth : s.clientHeight) * .85 * d * (horiz && st.cfg.hDir === 'rtl' ? -1 : 1);
      s.scrollBy({ [horiz ? 'left' : 'top']: amt, behavior: st.cfg.anim === 'none' ? 'auto' : 'smooth' });
      return;
    }
    if (m === 'panels') {
      const n = st.panels?.length || 0;
      if (d > 0 && st.pi < n - 1) { st.pi++; return renderPanel(st.cur, 0); }
      if (d < 0 && st.pi > -1) { st.pi--; return renderPanel(st.cur, 0); }
      const ni = st.cur + d;
      if (ni < 0) return App.toast('Primera página');
      if (ni >= st.units.length) return nextChapter();
      st.pi = d > 0 ? -1 : -2;
      return renderPanel(ni, d);
    }
    // si la página es más alta/ancha que la pantalla, primero se desplaza dentro de ella
    const sp = $('#rStage .spread:not(.leaving)');
    if (sp && st.z.s === 1) {
      const vert = sp.scrollHeight > sp.clientHeight + 4, hor = sp.scrollWidth > sp.clientWidth + 4;
      if (vert) {
        const atEnd = d > 0 ? sp.scrollTop + sp.clientHeight >= sp.scrollHeight - 4 : sp.scrollTop <= 4;
        if (!atEnd) return sp.scrollBy({ top: sp.clientHeight * .85 * d, behavior: 'smooth' });
      } else if (hor) {
        const rtl = st.cfg.mode === 'rtl', dx = d * (rtl ? -1 : 1);
        const max = sp.scrollWidth - sp.clientWidth;
        const atEnd = dx > 0 ? sp.scrollLeft >= max - 4 : sp.scrollLeft <= 4;
        if (!atEnd) return sp.scrollBy({ left: sp.clientWidth * .85 * dx, behavior: 'smooth' });
      }
    }
    const ni = st.cur + d;
    if (ni < 0) return App.toast('Primera página');
    if (ni >= st.units.length) return nextChapter();
    render(ni, d).then(() => {
      const n = $('#rStage .spread:not(.leaving)');
      if (n && d < 0 && n.scrollHeight > n.clientHeight) n.scrollTop = n.scrollHeight;
      if (n && st.cfg.mode === 'rtl' && n.scrollWidth > n.clientWidth) n.scrollLeft = d > 0 ? n.scrollWidth : 0;
    });
  }
  const next = () => step(1), prev = () => step(-1);
  function jump(i) {
    if (SCROLL(st.cfg.mode)) { st.strip.children[i]?.scrollIntoView({ block: 'start', inline: 'start' }); return; }
    if (st.cfg.mode === 'panels') { st.pi = -1; return renderPanel(i, 0); }
    render(i, 0);
  }
  async function nextChapter() { if (st.next) swap(st.next); else App.toast('No hay más capítulos'); }
  async function swap(item) { const s = await DB.get('series', st.series.id) || st.series, cb = st.onClose; close(true); open(item, s, cb); }

  /* ---------- toques, gestos y zoom ---------- */
  function zone(e) {
    const st0 = $('#rStage').getBoundingClientRect();
    const x = (e.clientX - st0.left) / st0.width, y = (e.clientY - st0.top) / st0.height;
    const t = st.cfg.tap;
    let z = 0; // -1 anterior, 1 siguiente, 0 menú
    if (t === 'lr') { z = x < .33 ? -1 : x > .67 ? 1 : 0; if (isRTL() && !SCROLL(st.cfg.mode) || (st.cfg.mode === 'hstrip' && st.cfg.hDir === 'rtl')) z = -z; }
    else if (t === 'tb') z = y < .33 ? -1 : y > .67 ? 1 : 0;
    else if (t === 'l') { const center = x > .33 && x < .67 && y > .33 && y < .67; z = center ? 0 : (y < .33 || (x < .33 && y < .67)) ? -1 : 1; }
    if (st.cfg.invertTap) z = -z;
    return z;
  }
  function tap(e) {
    st.touched = true;
    if (e.target.closest('button,a,.endcard')) return;
    const z = zone(e);
    if (z === 0) root().classList.toggle('hide-ui');
    else { root().classList.add('hide-ui'); z > 0 ? next() : prev(); }
  }
  function resetZoom() { st.z = { s: 1, x: 0, y: 0 }; applyZoom(); }
  function applyZoom() {
    const el = $('#rStage .spread:not(.leaving) .sp-in'); if (!el) return;
    el.style.transform = st.z.s === 1 ? '' : `translate(${st.z.x}px,${st.z.y}px) scale(${st.z.s})`;
    el.parentElement.classList.toggle('zoomed', st.z.s > 1);
  }
  function zoomAt(s, cx, cy) {
    const z = st.z, ns = Math.max(1, Math.min(5, s));
    const r = $('#rStage').getBoundingClientRect(); cx -= r.left; cy -= r.top;
    z.x = cx - (cx - z.x) * (ns / z.s); z.y = cy - (cy - z.y) * (ns / z.s); z.s = ns;
    if (ns === 1) { z.x = 0; z.y = 0; }
    applyZoom();
  }
  function bindPointer(stage) {
    const pts = new Map(); let g = null, lastTap = 0, tapTimer = 0;
    stage.addEventListener('pointerdown', e => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) g = { x: e.clientX, y: e.clientY, t: Date.now(), z: { ...st.z }, moved: false };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; g = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y), z: { ...st.z } }; }
      if (st.auto) stopAuto();
    });
    stage.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pag = PAGED(st.cfg.mode);
      if (g.pinch && pts.size === 2 && pag) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        st.z = { ...g.z }; zoomAt(g.z.s * d / g.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (!g.pinch) {
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) g.moved = true;
        if (pag && st.z.s > 1) { st.z.x = g.z.x + dx; st.z.y = g.z.y + dy; applyZoom(); }
      }
    });
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!g || pts.size) { if (!pts.size) g = null; return; }
      const was = g; g = null;
      if (was.pinch || e.type === 'pointercancel') return;
      const dx = e.clientX - was.x, dy = e.clientY - was.y, dt = Date.now() - was.t;
      if (!was.moved && dt < 400) {
        const now = Date.now();
        if (now - lastTap < 280 && PAGED(st.cfg.mode)) { clearTimeout(tapTimer); lastTap = 0; zoomAt(st.z.s > 1 ? 1 : 2.5, e.clientX, e.clientY); return; }
        lastTap = now;
        clearTimeout(tapTimer);
        const ev = { clientX: e.clientX, clientY: e.clientY, target: e.target };
        tapTimer = setTimeout(() => tap(ev), PAGED(st.cfg.mode) ? 230 : 0);
        return;
      }
      if (st.z.s > 1 || SCROLL(st.cfg.mode)) return;
      const sp = $('#rStage .spread:not(.leaving)');
      const vert = st.cfg.mode === 'vpaged';
      if (vert && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.3 && !(sp && sp.scrollHeight > sp.clientHeight + 4)) { root().classList.add('hide-ui'); dy < 0 ? next() : prev(); }
      else if (!vert && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3 && !(sp && sp.scrollWidth > sp.clientWidth + 4)) {
        root().classList.add('hide-ui');
        const toLeft = dx < 0; ((isRTL()) ? !toLeft : toLeft) ? next() : prev();
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    let wheelT = 0;
    stage.addEventListener('wheel', e => {
      if (SCROLL(st.cfg.mode)) return;
      if (e.ctrlKey && PAGED(st.cfg.mode)) { e.preventDefault(); zoomAt(st.z.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); return; }
      const sp = $('#rStage .spread:not(.leaving)');
      if (sp && sp.scrollHeight > sp.clientHeight + 4) {
        const atEnd = e.deltaY > 0 ? sp.scrollTop + sp.clientHeight >= sp.scrollHeight - 4 : sp.scrollTop <= 4;
        if (!atEnd) return;
      }
      e.preventDefault();
      if (Date.now() - wheelT < 350 || Math.abs(e.deltaY) < 10) return;
      wheelT = Date.now(); e.deltaY > 0 ? next() : prev();
    }, { passive: false });
  }

  function onKey(e) {
    if (root().hidden || !st) return;
    if (e.target.matches('input')) return;
    const m = st.cfg.mode, k = e.key;
    if (k === 'Escape') { if (!$('#rThumbs').hidden) return toggleThumbs(); if (root().classList.contains('set-open')) return toggleSet(); return close(); }
    if (k.toLowerCase() === 'f') return fullscreen();
    if (k === '+' || k === '=') return zoomAt(st.z.s * 1.25, innerWidth / 2, innerHeight / 2);
    if (k === '-') return zoomAt(st.z.s / 1.25, innerWidth / 2, innerHeight / 2);
    if (m === 'webtoon' && (k === 'ArrowDown' || k === 'ArrowUp')) return;
    let d = 0;
    if (k === 'ArrowLeft') d = isRTL() ? 1 : -1;
    if (k === 'ArrowRight') d = isRTL() ? -1 : 1;
    if (k === 'ArrowDown' || k === 'PageDown' || k === ' ') d = 1;
    if (k === 'ArrowUp' || k === 'PageUp') d = -1;
    if (d) { e.preventDefault(); step(d); }
  }

  /* ---------- auto-scroll ---------- */
  function toggleAuto() { st.auto ? stopAuto() : startAuto(); }
  function startAuto() {
    const s = st.strip; if (!s) return;
    st.auto = true; $('#rAuto').classList.add('on'); root().classList.add('hide-ui');
    let t0 = performance.now();
    const loop = t => {
      if (!st?.auto) return;
      const dt = Math.min(64, t - t0); t0 = t;
      const px = st.cfg.speed * .045 * dt;
      if (st.cfg.mode === 'hstrip') {
        const before = s.scrollLeft; s.scrollLeft += px * (st.cfg.hDir === 'rtl' ? -1 : 1);
        if (Math.abs(s.scrollLeft - before) < .01 && px > .5) return stopAuto();
      } else {
        st.acc = (st.acc || 0) + px;
        if (st.acc >= 1) { const before = s.scrollTop; s.scrollTop += Math.floor(st.acc); st.acc -= Math.floor(st.acc); if (s.scrollTop === before) return stopAuto(); }
      }
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
  }
  function stopAuto() { if (!st) return; st.auto = false; cancelAnimationFrame(st.raf); $('#rAuto')?.classList.remove('on'); }

  /* ---------- aspecto (fondo y filtros) ---------- */
  function look() {
    const c = st.cfg, stage = $('#rStage');
    const bg = c.night ? '#000' : { black: '#000', white: '#f4f4f4', gray: '#3a3a3e' }[c.bg];
    root().style.setProperty('--rbg', bg);
    const f = [];
    if (c.bright !== 100) f.push(`brightness(${c.bright / 100})`);
    if (c.sepia) f.push('sepia(.65)');
    if (c.gray) f.push('grayscale(1)');
    if (c.night) f.push('invert(1) hue-rotate(180deg) brightness(.85)');
    stage.style.filter = f.join(' ');
    root().querySelector('[data-a=night]').classList.toggle('on', c.night);
  }
  function modeBtn() {
    const m = MODES.find(x => x[0] === st.cfg.mode);
    $('#rModeBtn').innerHTML = `${ico(m[3], 18)}<span>${m[1]}</span>`;
  }

  /* ---------- ajustes ---------- */
  const seg = (k, opts) => `<div class="seg wrap" data-k="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(st.cfg[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const sw = (k, label, sub) => `<div class="kv"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><button class="switch ${st.cfg[k] ? 'on' : ''}" data-t="${k}"></button></div>`;
  function setHTML(tab = st.tab || 'modo') {
    st.tab = tab;
    const c = st.cfg, m = c.mode;
    const tabs = [['modo', 'Modo'], ['pagina', 'Página'], ['toques', 'Controles'], ['color', 'Color']];
    let body = '';
    if (tab === 'modo') body = `<div class="modes">${MODES.map(([id, n, s, p]) => `<button class="mode ${m === id ? 'on' : ''}" data-mode="${id}">${ico(p, 26)}<b>${n}</b><small>${s}</small></button>`).join('')}</div>
      ${m === 'hstrip' ? `<div class="kv"><span>Sentido de la tira</span>${seg('hDir', [['rtl', 'Dcha → izq'], ['ltr', 'Izq → dcha']])}</div>` : ''}
      ${m === 'panels' ? `<div class="kv"><span>Orden de viñetas</span>${seg('panelDir', [['rtl', 'Manga'], ['ltr', 'Cómic']])}</div><p class="tiny">Detecta las viñetas por los huecos blancos. Primero ves la página entera y luego cada viñeta.</p>` : ''}
      <div class="presets"><span class="tiny">Perfiles rápidos</span><div class="chips">
        <button class="chip" data-preset="manga">Manga</button><button class="chip" data-preset="comic">Cómic</button>
        <button class="chip" data-preset="webtoon">Webtoon</button><button class="chip" data-preset="noche">Noche</button></div></div>`;
    if (tab === 'pagina') body = `
      ${!PAGED(m) ? '' : `<div class="kv col"><span>Encaje</span>${seg('fit', [['screen', 'Pantalla'], ['width', 'Ancho'], ['height', 'Alto'], ['original', 'Original']])}</div>`}
      ${PAGED(m) && m !== 'vpaged' ? `<div class="kv"><span>Doble página<small>"Auto": en horizontal y pantallas grandes</small></span>${seg('spread', [['auto', 'Auto'], ['on', 'Sí'], ['off', 'No']])}</div>
        ${sw('offset', 'Desplazar una página', 'Deja la portada sola para cuadrar las dobles')}` : ''}
      ${PAGED(m) ? sw('split', 'Partir páginas dobles', 'En vertical, divide las páginas anchas en dos') : ''}
      ${m !== 'panels' ? sw('crop', 'Recortar bordes', 'Quita los márgenes blancos o negros') : ''}
      ${SCROLL(m) ? `<div class="kv"><span>Separación<small>${c.gap}px</small></span><input type="range" min="0" max="40" value="${c.gap}" data-r="gap"></div>` : ''}
      ${m === 'webtoon' ? `<div class="kv"><span>Ancho<small>${c.width ? c.width + '%' : 'Auto'}</small></span><input type="range" min="30" max="100" value="${c.width || 100}" data-r="width"><button class="btn sm" data-auto-w>Auto</button></div>` : ''}
      <div class="kv"><span>Fondo</span>${seg('bg', [['black', 'Negro'], ['gray', 'Gris'], ['white', 'Blanco']])}</div>`;
    if (tab === 'toques') body = `
      <div class="kv col"><span>Zonas táctiles</span>${seg('tap', [['lr', 'Lados'], ['l', 'En L'], ['tb', 'Arriba/abajo'], ['off', 'Solo menú']])}</div>
      <div class="tapmap t-${c.tap} ${(isRTL() && c.tap === 'lr') !== c.invertTap ? 'inv' : ''}"><i class="p">Anterior</i><i class="m">Menú</i><i class="n">Siguiente</i></div>
      ${sw('invertTap', 'Invertir zonas')}
      ${SCROLL(m) ? '' : `<div class="kv col"><span>Animación al pasar</span>${seg('anim', [['slide', 'Deslizar'], ['curl', 'Hoja'], ['fade', 'Fundido'], ['none', 'Ninguna']])}</div>`}
      ${SCROLL(m) ? `<div class="kv"><span>Velocidad auto-scroll<small>${c.speed}</small></span><input type="range" min="1" max="15" value="${c.speed}" data-r="speed"></div>` : ''}
      ${sw('awake', 'Pantalla siempre encendida')}
      <div class="kv"><span>Pantalla completa</span><button class="btn sm" data-a="fs">Activar</button></div>
      <div class="kv"><span>Bloquear giro<small>Android, en pantalla completa</small></span><div class="seg"><button data-orient="any">Libre</button><button data-orient="portrait">Vertical</button><button data-orient="landscape">Horiz.</button></div></div>
      <p class="tiny">PC: flechas, espacio, rueda del ratón, Ctrl+rueda o +/− para zoom, F pantalla completa. Móvil: doble toque o pellizco para zoom.</p>`;
    if (tab === 'color') body = `
      <div class="kv"><span>Brillo<small>${c.bright}%</small></span><input type="range" min="30" max="100" value="${c.bright}" data-r="bright"></div>
      ${sw('night', 'Modo noche', 'Invierte los colores: fondo negro y texto blanco')}
      ${sw('sepia', 'Sepia', 'Tono cálido, cansa menos la vista')}
      ${sw('gray', 'Blanco y negro')}`;
    $('#rSet').innerHTML = `<div class="rs-head"><b>Ajustes de lectura</b><button class="ov-btn" data-a="settings">${ico('<path d="M6 6l12 12M18 6L6 18"/>')}</button></div>
      <div class="rs-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="rs-body">${body}</div>
      <div class="rs-foot"><span class="tiny">Se guarda para "${App.esc(st.series.title)}"</span><button class="btn sm" data-a="default">Usar en todas</button></div>`;
  }
  function toggleSet(tab) {
    const open = !root().classList.contains('set-open') || tab;
    root().classList.toggle('set-open', !!open);
    if (open) { setHTML(tab); root().classList.remove('hide-ui'); }
  }
  const RELAYOUT = ['mode', 'spread', 'offset', 'split', 'crop', 'fit', 'gap', 'width', 'panelDir', 'hDir'];
  async function setCfg(k, v, silent) {
    st.cfg[k] = v;
    if (!silent) await save();
    if (k === 'awake') wake();
    if (['bg', 'bright', 'sepia', 'gray', 'night'].includes(k)) look();
    if (RELAYOUT.includes(k)) { const src = currentSrc(); await layout(src); modeBtn(); }
  }
  const currentSrc = () => { const u = st.units[st.cur]; return u?.end ? st.pages.length - 1 : u?.pages[0].src || 0; };
  async function save() { await App.saveSeriesReader(st.series, { ...st.cfg }); st.series.reader = { ...st.cfg }; }
  async function preset(id) {
    const P = {
      manga: { mode: 'rtl', fit: 'screen', spread: 'auto', tap: 'lr', anim: 'slide', night: false },
      comic: { mode: 'ltr', fit: 'screen', spread: 'auto', tap: 'lr', anim: 'slide', night: false },
      webtoon: { mode: 'webtoon', gap: 0, width: 0, night: false },
      noche: { night: !st.cfg.night, bright: st.cfg.night ? 100 : 80 },
    }[id];
    Object.assign(st.cfg, P); await save();
    look(); await layout(currentSrc()); modeBtn(); setHTML();
  }

  function onClick(e) {
    const t = e.target;
    const a = t.closest('[data-a]')?.dataset.a;
    if (t.closest('#rSet')) {
      const md = t.closest('[data-mode]'); if (md) { setCfg('mode', md.dataset.mode).then(() => setHTML()); return; }
      const tb = t.closest('[data-tab]'); if (tb) return setHTML(tb.dataset.tab);
      const sg = t.closest('[data-k] button'); if (sg) { const k = sg.parentElement.dataset.k; const v = sg.dataset.v; setCfg(k, typeof DEF[k] === 'boolean' ? v === 'true' : v).then(() => setHTML()); return; }
      const sw = t.closest('[data-t]'); if (sw) { setCfg(sw.dataset.t, !st.cfg[sw.dataset.t]).then(() => setHTML()); return; }
      const pr = t.closest('[data-preset]'); if (pr) return preset(pr.dataset.preset);
      const or = t.closest('[data-orient]'); if (or) return orient(or.dataset.orient);
      if (t.closest('[data-auto-w]')) { setCfg('width', 0).then(() => setHTML()); return; }
      if (a === 'default') { DB.setKV('readerPrefs', { ...st.cfg }); App.toast('Guardado como predeterminado para todas las series'); return; }
    }
    if (t.closest('#rThumbs')) { const th = t.closest('[data-th]'); if (th) { const src = +th.dataset.th; toggleThumbs(); jump(Math.max(0, st.units.findIndex(u => u.pages?.some(v => v.src === src)))); } else if (t.id === 'rThumbs' || a === 'thumbs') toggleThumbs(); return; }
    if (!a) return;
    st.touched = true;
    if (a === 'close') return close();
    if (a === 'settings') return toggleSet();
    if (a === 'modes') return toggleSet('modo');
    if (a === 'night') return setCfg('night', !st.cfg.night);
    if (a === 'fs') return fullscreen();
    if (a === 'thumbs') return toggleThumbs();
    if (a === 'auto') return toggleAuto();
    if (a === 'nextch') return nextChapter();
    if (a === 'prevch') return App.adjacent(st.item, -1).then(it => it ? swap(it) : App.toast('Es el primer capítulo'));
  }
  let inT;
  function onInput(e) {
    const r = e.target.dataset?.r; if (!r) return;
    const v = +e.target.value;
    const lab = e.target.closest('.kv')?.querySelector('small');
    if (lab) lab.textContent = r === 'bright' ? v + '%' : r === 'gap' ? v + 'px' : r === 'width' ? v + '%' : v;
    st.cfg[r] = v;
    if (r === 'bright') look();
    if (r === 'gap' && st.strip) st.strip.style.gap = v + 'px';
    if (r === 'width' && st.strip) st.strip.querySelectorAll('.sp:not(.endsp)').forEach(el => el.style.width = v + '%');
    clearTimeout(inT); inT = setTimeout(save, 400);
  }

  function toggleThumbs() {
    const th = $('#rThumbs');
    th.hidden = !th.hidden;
    if (!th.hidden) {
      const cur = currentSrc();
      th.innerHTML = `<div class="th-grid">${st.pages.map(p => `<button data-th="${p.i}" class="${p.i === cur ? 'on' : ''}"><img src="${p.url}" loading="lazy" alt=""><span>${p.i + 1}</span></button>`).join('')}</div>`;
      th.querySelector('.on')?.scrollIntoView({ block: 'center' });
    }
  }

  /* ---------- pantalla ---------- */
  async function wake() {
    try {
      if (st?.cfg.awake && !st.lock && 'wakeLock' in navigator && document.visibilityState === 'visible') st.lock = await navigator.wakeLock.request('screen');
      if (st && !st.cfg.awake && st.lock) { st.lock.release(); st.lock = null; }
    } catch { }
  }
  function onVis() { if (st && document.visibilityState === 'visible') { st.lock = null; wake(); } }
  function fullscreen() {
    if (document.fullscreenElement) return document.exitFullscreen();
    const el = root();
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => App.toast('Tu navegador no permite pantalla completa aquí'));
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) App.toast('En iPhone: instala Lector en la pantalla de inicio para verlo a pantalla completa');
  }
  async function orient(o) {
    try {
      if (o === 'any') { screen.orientation.unlock(); return App.toast('Giro libre'); }
      if (!document.fullscreenElement) await root().requestFullscreen();
      await screen.orientation.lock(o);
      App.toast('Giro bloqueado');
    } catch { App.toast('Este dispositivo no deja bloquear el giro desde la app'); }
  }

  function close(silent) {
    if (!st) return;
    stopAuto();
    st.io?.disconnect();
    st.lock?.release?.();
    st.urls.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u));
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    root().hidden = true; root().innerHTML = ''; root().className = 'overlay';
    const cb = st.onClose; st = null;
    if (!silent) cb?.();
  }

  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (st && st.units.length && !SCROLL(st.cfg.mode)) layout(currentSrc()); }, 200); });
  return { open, close, MODES };
})();
