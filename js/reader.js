/* Lector · lector de manga.
   Modos: 'rtl' (manga, derecha→izquierda), 'ltr' (cómic), 'vertical' (webtoon, scroll).
   Controles: tocar los lados para pasar página, centro para mostrar/ocultar barras,
   flechas del teclado, deslizar el dedo, rueda del ratón en vertical. */
const Reader = (() => {
  const el = () => document.getElementById('reader');
  let st = null; // estado de la sesión de lectura

  async function sourcePages(item, series) {
    if (item.demo) {
      const tall = series.mode === 'vertical';
      return Array.from({ length: item.total }, (_, i) => ({ load: async () => Demo.page(series.title, item.num, i + 1, item.total, series.hue || 200, tall) }));
    }
    if (item.pageKeys) return item.pageKeys.map(k => ({ load: async () => URL.createObjectURL((await DB.get('files', k)).blob) }));
    if (item.fileKey) {
      const f = await DB.get('files', item.fileKey);
      if (!f) throw new Error('El archivo ya no está en este dispositivo');
      if (f.type.startsWith('image/')) return [{ load: async () => URL.createObjectURL(f.blob) }];
      const pages = await Zip.pages(f.blob);
      return pages.map(p => ({ load: async () => URL.createObjectURL(await p.load()) }));
    }
    throw new Error('Formato no soportado todavía');
  }

  async function open(item, series, onClose) {
    const prefs = await DB.getKV('readerPrefs', { mode: 'rtl', double: 'auto', fitw: false });
    const mode = series.modeOverride || series.mode || prefs.mode;
    st = { item, series, onClose, mode, double: prefs.double, fitw: prefs.fitw, pages: [], urls: [], i: 0, cache: new Map() };
    const r = el();
    r.hidden = false; r.className = 'overlay';
    r.innerHTML = `
      <div class="ov-bar top">
        <button class="ov-btn" data-a="close" title="Cerrar"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
        <div class="t"><b>${App.esc(series.title)}</b><span class="tiny">${App.esc(item.title)}</span></div>
        <div class="seg" id="rMode"><button data-m="rtl" title="Manga: derecha a izquierda">⇠ Manga</button><button data-m="ltr" title="Izquierda a derecha">Cómic ⇢</button><button data-m="vertical" title="Scroll vertical">⇣ Webtoon</button></div>
        <button class="ov-btn" data-a="opts" title="Opciones"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      </div>
      <div class="pages" id="rPages"><div class="r-msg">Cargando…</div></div>
      <div class="ov-bar bottom">
        <button class="ov-btn" data-a="prevch" title="Capítulo anterior"><svg viewBox="0 0 24 24"><path d="M11 18l-6-6 6-6M19 18l-6-6 6-6"/></svg></button>
        <input type="range" id="rSlider" min="1" value="1">
        <span id="rCount" class="tiny" style="min-width:52px;text-align:center">–</span>
        <button class="ov-btn" data-a="nextch" title="Capítulo siguiente"><svg viewBox="0 0 24 24"><path d="M13 6l6 6-6 6M5 6l6 6-6 6"/></svg></button>
      </div>`;
    r.onclick = onClick;
    r.querySelector('#rSlider').oninput = e => go(+e.target.value - 1);
    document.addEventListener('keydown', onKey);
    bindSwipe(r.querySelector('#rPages'));
    try {
      st.pages = await sourcePages(item, series);
      if (!st.pages.length) throw new Error('No hay páginas en este archivo');
    } catch (e) { r.querySelector('#rPages').innerHTML = `<div class="r-msg">${App.esc(e.message)}</div>`; return; }
    const start = item.done ? 0 : Math.min(item.pos || 0, st.pages.length - 1);
    r.querySelector('#rSlider').max = st.pages.length;
    render(start);
    App.touch(series, item);
  }

  function isDouble() {
    if (st.mode === 'vertical') return false;
    if (st.double === 'on') return true;
    if (st.double === 'off') return false;
    return innerWidth > innerHeight && innerWidth >= 900;
  }

  async function url(i) {
    if (!st.cache.has(i)) st.cache.set(i, st.pages[i].load());
    return st.cache.get(i);
  }

  async function render(i) {
    const box = el().querySelector('#rPages');
    box.className = 'pages ' + st.mode + (st.fitw ? ' fitw' : '') + (isDouble() ? ' double' : '');
    el().querySelectorAll('#rMode button').forEach(b => b.classList.toggle('on', b.dataset.m === st.mode));
    if (st.mode === 'vertical') {
      box.innerHTML = st.pages.map((_, k) => `<img data-k="${k}" alt="" loading="lazy">`).join('');
      const imgs = [...box.querySelectorAll('img')];
      const io = new IntersectionObserver(es => es.forEach(async e => {
        const k = +e.target.dataset.k;
        if (e.isIntersecting && !e.target.src) e.target.src = await url(k);
      }), { root: box, rootMargin: '1500px 0px' });
      imgs.forEach(im => io.observe(im));
      const vio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) setPos(+e.target.dataset.k); }), { root: box, threshold: .5 });
      imgs.forEach(im => vio.observe(im));
      st.io = [io, vio];
      if (i) { imgs[i].src = await url(i); imgs[i].scrollIntoView(); }
      setPos(i);
      return;
    }
    st.io?.forEach(o => o.disconnect()); st.io = null;
    const n = isDouble() && i + 1 < st.pages.length ? 2 : 1;
    const srcs = await Promise.all(Array.from({ length: n }, (_, k) => url(i + k)));
    box.innerHTML = srcs.map(s => `<img src="${s}" alt="">`).join('');
    box.scrollTop = 0;
    setPos(i, n);
    // precarga las siguientes
    for (let k = 1; k <= 3; k++) if (i + n - 1 + k < st.pages.length) url(i + n - 1 + k);
  }

  function setPos(i, n = 1) {
    st.i = i;
    const total = st.pages.length, last = i + n >= total;
    el().querySelector('#rSlider').value = i + 1;
    el().querySelector('#rCount').textContent = `${i + n > i + 1 ? `${i + 1}-${i + n}` : i + 1} / ${total}`;
    App.saveProgress(st.item, last ? total : i, total, last);
  }

  function go(i) {
    if (i >= st.pages.length) return endOfChapter();
    if (i < 0) return;
    if (st.mode === 'vertical') { el().querySelectorAll('#rPages img')[i]?.scrollIntoView(); return; }
    render(i);
  }
  const next = () => go(st.i + (isDouble() ? 2 : 1));
  const prev = () => go(st.i - (isDouble() ? 2 : 1));

  async function endOfChapter() {
    const nx = await App.adjacent(st.item, 1);
    if (nx) { App.toast('Siguiente: ' + nx.title); swap(nx); } else App.toast('Fin de la serie por ahora');
  }
  async function swap(item) { const s = st.series, cb = st.onClose; close(true); open(item, s, cb); }

  function onClick(e) {
    const a = e.target.closest('[data-a]')?.dataset.a;
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m) { st.mode = m; st.series.modeOverride = m; App.saveSeriesMode(st.series, m); render(st.i); return; }
    if (a === 'close') return close();
    if (a === 'opts') return options();
    if (a === 'nextch' || a === 'prevch') return App.adjacent(st.item, a === 'nextch' ? 1 : -1).then(it => it ? swap(it) : App.toast('No hay más capítulos'));
    if (e.target.closest('.ov-bar')) return;
    if (st.mode === 'vertical') { el().classList.toggle('hide-ui'); return; }
    const x = e.clientX / innerWidth;
    if (x > .3 && x < .7) { el().classList.toggle('hide-ui'); return; }
    const leftSide = x <= .3;
    // En manga (rtl) tocar la izquierda avanza
    (st.mode === 'rtl' ? leftSide : !leftSide) ? next() : prev();
  }

  function onKey(e) {
    if (el().hidden) return;
    if (e.key === 'Escape') return close();
    if (st.mode === 'vertical') return;
    if (e.key === 'ArrowLeft') (st.mode === 'rtl' ? next : prev)();
    if (e.key === 'ArrowRight') (st.mode === 'rtl' ? prev : next)();
    if (e.key === ' ' || e.key === 'PageDown') next();
  }

  function bindSwipe(box) {
    let x0 = null, y0 = 0;
    box.addEventListener('touchstart', e => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } else x0 = null; }, { passive: true });
    box.addEventListener('touchend', e => {
      if (x0 === null || st.mode === 'vertical' || (visualViewport && visualViewport.scale > 1.05)) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        e.preventDefault();
        const toLeft = dx < 0;
        (st.mode === 'rtl' ? !toLeft : toLeft) ? next() : prev();
      }
      x0 = null;
    });
  }

  function options() {
    App.sheet(`<h3>Opciones de lectura</h3>
      <div class="kv"><span>Doble página</span><div class="seg" id="oDbl">${['auto', 'on', 'off'].map(v => `<button data-v="${v}" class="${st.double === v ? 'on' : ''}">${{ auto: 'Auto', on: 'Sí', off: 'No' }[v]}</button>`).join('')}</div></div>
      <div class="kv"><span>Ajustar al ancho</span><button class="switch ${st.fitw ? 'on' : ''}" id="oFit"></button></div>
      <p class="tiny" style="margin-top:8px">"Auto" usa doble página en PC y tablet en horizontal.</p>
      <div class="acts"><button class="btn primary" data-close>Listo</button></div>`, root => {
      root.querySelector('#oDbl').onclick = e => { const v = e.target.dataset.v; if (!v) return; st.double = v; root.querySelectorAll('#oDbl button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); savePrefs(); render(st.i); };
      root.querySelector('#oFit').onclick = e => { st.fitw = !st.fitw; e.target.classList.toggle('on', st.fitw); savePrefs(); render(st.i); };
    });
  }
  async function savePrefs() { const p = await DB.getKV('readerPrefs', {}); await DB.setKV('readerPrefs', { ...p, double: st.double, fitw: st.fitw }); }

  function close(silent) {
    if (!st) return;
    st.io?.forEach(o => o.disconnect());
    st.cache.forEach(p => p.then(u => u.startsWith('blob:') && URL.revokeObjectURL(u)));
    document.removeEventListener('keydown', onKey);
    el().hidden = true; el().innerHTML = '';
    const cb = st.onClose; st = null;
    if (!silent) cb?.();
  }

  addEventListener('resize', () => { if (st && st.mode !== 'vertical') render(st.i); });
  return { open, close };
})();
