/* Lector · reproductor de anime (v0.3) con controles propios y gestos.
   Gestos: un toque muestra/oculta controles · doble toque a la izquierda/derecha −10/+10 s (centro: pausa) ·
   arrastrar en horizontal para avanzar/retroceder · arrastrar en vertical: izquierda brillo, derecha volumen ·
   mantener pulsado = velocidad ×2.
   Teclado: espacio, ←/→ (10 s), ↑/↓ volumen, F pantalla completa, M silencio, C subtítulos, S saltar opening.
   Subtítulos .vtt/.srt/.ass (convertidos a VTT) y los extraídos del MKV. Recuerda el minuto y pasa al siguiente. */
const Player = (() => {
  const el = () => document.getElementById('player');
  const $ = s => el().querySelector(s);
  const ico = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
  const I = {
    back: '<path d="M15 18l-6-6 6-6"/>', play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>', pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
    rew: '<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>', fwd: '<path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>', cc: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3"/>',
    fs: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', pip: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="12" width="7" height="5" fill="currentColor"/>',
    next: '<path d="M5 5l10 7-10 7zM19 5v14"/>', vol: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  };
  let st = null;
  const fmt = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };

  async function open(item, series, onClose) {
    const prefs = await DB.getKV('playerPrefs', { subSize: 'm', skip: 85, autoNext: true });
    st = { item, series, onClose, urls: [], prefs, bright: 1 };
    st.next = item.seriesId === 'tmp' ? null : await App.adjacent(item, 1);
    const p = el();
    p.hidden = false; p.className = 'overlay player sub-' + prefs.subSize;
    p.innerHTML = `
      <div class="pv-wrap"><video playsinline webkit-playsinline preload="auto"></video><div class="dim"></div></div>
      <div class="gest" id="pGest"></div>
      <div class="pind" id="pInd"></div>
      <div class="ov-bar top">
        <button class="ov-btn" data-a="close" title="Cerrar (Esc)">${ico(I.back)}</button>
        <div class="t"><b>${App.esc(series.title)}</b><span class="tiny">${App.esc(item.title)}</span></div>
        <button class="ov-btn" data-a="subs" title="Subtítulos (C)">${ico(I.cc)}</button>
        <button class="ov-btn pill" data-a="speed" title="Velocidad" id="pSpeed">1×</button>
        <button class="ov-btn hide-xs" data-a="pip" title="Imagen en imagen" id="pPip">${ico(I.pip)}</button>
        <button class="ov-btn" data-a="fs" title="Pantalla completa (F)">${ico(I.fs)}</button>
      </div>
      <div class="pcenter">
        <button class="ov-btn big2" data-a="rew" title="−10 s">${ico(I.rew)}</button>
        <button class="ov-btn big" data-a="toggle" id="pPlay">${ico(I.play)}</button>
        <button class="ov-btn big2" data-a="fwd" title="+10 s">${ico(I.fwd)}</button>
      </div>
      <button class="skip" data-a="skip" id="pSkip" hidden>Saltar opening ›</button>
      <div class="ov-bar bottom pbottom">
        <div class="seek" id="pSeek"><div class="buf" id="pBuf"></div><div class="cur" id="pCur"></div><div class="knob" id="pKnob"></div><div class="tip" id="pTip"></div></div>
        <div class="prow"><span id="pTime" class="ptime">0:00 / 0:00</span><span style="flex:1"></span>
          ${st.next ? `<button class="btn sm glass" data-a="next">${ico(I.next)}Siguiente</button>` : ''}</div>
      </div>
      <div class="pmenu" id="pMenu" hidden></div>
      <div class="r-msg perr" id="pErr" hidden></div>`;
    p.onclick = onClick;
    document.addEventListener('keydown', onKey);
    const v = $('video'); st.v = v;
    bindGestures($('#pGest'));
    bindSeek($('#pSeek'));
    if (!document.pictureInPictureEnabled) $('#pPip').hidden = true;

    if (item.demo) { showErr(`<b style="font-size:18px;color:#fff">Episodio de ejemplo</b><br><br>Aquí se reproducirá el vídeo cuando lo añadas o lo descargues de uno de tus bots.<br><br><button class="btn primary" data-a="fake">Marcar como visto</button>`); App.touch(series, item); return; }

    let src;
    if (item.url) src = item.url; // ver online
    else {
      const f = item.fileKey && await DB.get('files', item.fileKey);
      if (!f) return showErr(item.removed ? 'Este episodio se borró para liberar espacio (ya lo habías visto).' : 'El archivo ya no está en este dispositivo.');
      st.file = f;
      src = URL.createObjectURL(f.blob); st.urls.push(src);
    }
    v.src = src;
    await loadSubs(item.subKeys || []);
    const live = f => (...a) => { if (st?.v === v) f(...a); }; // tras cerrar, el vídeo aún emite eventos: se ignoran
    v.addEventListener('loadedmetadata', live(() => { if (!item.done && item.pos > 5 && item.pos < v.duration - 10) v.currentTime = item.pos; v.play().catch(() => ui(true)); }));
    let last = 0;
    v.addEventListener('timeupdate', live(() => { paint(); if (Date.now() - last > 4000) { last = Date.now(); save(); } }));
    v.addEventListener('progress', live(paint));
    v.addEventListener('play', live(() => { $('#pPlay').innerHTML = ico(I.pause); hideSoon(); }));
    v.addEventListener('pause', live(() => { $('#pPlay').innerHTML = ico(I.play); ui(true); save(); }));
    v.addEventListener('ended', live(() => { save(true); upNext(); }));
    v.addEventListener('waiting', live(() => el().classList.add('loading')));
    v.addEventListener('playing', live(() => el().classList.remove('loading')));
    v.addEventListener('error', onError);
    App.touch(series, item);
    ui(true); hideSoon();
  }

  async function loadSubs(keys) {
    const v = st.v;
    v.querySelectorAll('track').forEach(t => t.remove());
    st.subs = [];
    for (const [i, sk] of keys.entries()) {
      const s = await DB.get('files', sk); if (!s) continue;
      const txt = Subs.toVTT(await s.blob.text(), s.name);
      const tu = URL.createObjectURL(new Blob([txt], { type: 'text/vtt' })); st.urls.push(tu);
      const tr = document.createElement('track');
      Object.assign(tr, { kind: 'subtitles', src: tu, srclang: 'es', label: s.name.replace(/\.(srt|vtt|ass|ssa)$/i, '') });
      v.appendChild(tr); st.subs.push(tr);
    }
    const pref = await DB.getKV('subOn', true);
    setTimeout(() => setSub(pref && st?.subs.length ? 0 : -1), 50);
  }
  function setSub(i) {
    if (!st) return;
    [...st.v.textTracks].forEach((t, k) => t.mode = k === i ? 'showing' : 'disabled');
    st.subIdx = i;
    $('[data-a=subs]')?.classList.toggle('on', i >= 0);
  }

  function onError() {
    const f = st.file;
    const mkv = f && Mkv.isMkv(f.name, f.type);
    showErr(`No se puede reproducir este vídeo en este navegador.${mkv ? `<br><br>Es un MKV. Puedo convertirlo a MP4 en este dispositivo (no pierde calidad y saca los subtítulos internos).<br><br><button class="btn primary" data-a="convert">Convertir a MP4</button>` : ''}${st.item.convErr ? `<br><br><small>${App.esc(st.item.convErr)}</small>` : ''}`);
  }
  function showErr(html) { const e = $('#pErr'); e.hidden = false; e.innerHTML = html; el().classList.add('err'); }

  async function convert() {
    const f = st.file; const item = await DB.get('items', st.item.id);
    showErr('<div class="spin"></div><br><span id="pConv">Convirtiendo…</span>');
    try {
      const r = await Mkv.toMp4(f.blob, p => { const s = $('#pConv'); if (s) s.textContent = `Convirtiendo a MP4… ${Math.round(p * 100)} %`; });
      await DB.put('files', { key: item.fileKey, blob: r.mp4, name: f.name.replace(/\.mkv$/i, '.mp4'), type: 'video/mp4' });
      item.size = r.mp4.size; item.subKeys ||= [];
      for (const s of r.subs) { const sk = item.id + '-s' + item.subKeys.length + '-' + Date.now(); await DB.put('files', { key: sk, blob: new Blob([s.vtt]), name: s.name + '.vtt', type: 'text/vtt' }); item.subKeys.push(sk); }
      delete item.convErr; await DB.put('items', item);
      App.toast('Convertido a MP4'); swap(item);
    } catch (e) { showErr('No se pudo convertir: ' + App.esc(e.message)); }
  }

  /* ---------- interfaz ---------- */
  let hideT;
  function ui(show) { el()?.classList.toggle('hide-ui', !show); if (show) hideSoon(); }
  function hideSoon() { clearTimeout(hideT); hideT = setTimeout(() => { if (st?.v && !st.v.paused && $('#pMenu').hidden) el().classList.add('hide-ui'); }, 3200); }
  function paint() {
    const v = st.v, d = v.duration || 0, t = v.currentTime || 0;
    const pct = d ? t / d * 100 : 0;
    $('#pCur').style.width = pct + '%'; $('#pKnob').style.left = pct + '%';
    if (v.buffered.length && d) $('#pBuf').style.width = v.buffered.end(v.buffered.length - 1) / d * 100 + '%';
    $('#pTime').textContent = `${fmt(t)} / ${fmt(d)}`;
    $('#pSkip').hidden = !(t > 3 && t < 6 * 60 && d > 600 && !st.skipped);
  }
  function indicate(html) { const i = $('#pInd'); i.innerHTML = html; i.classList.remove('on'); void i.offsetWidth; i.classList.add('on'); }
  const seekBy = s => { const v = st.v; v.currentTime = Math.max(0, Math.min((v.duration || 0) - .5, v.currentTime + s)); indicate(`${s > 0 ? ico(I.fwd) : ico(I.rew)}<span>${s > 0 ? '+' : ''}${s} s</span>`); };
  const toggle = () => { const v = st.v; if (!v.src) return; v.paused ? v.play() : v.pause(); indicate(ico(v.paused ? I.pause : I.play)); };

  function menu(html) { const m = $('#pMenu'); m.hidden = !html; m.innerHTML = html || ''; if (html) ui(true); }
  function subsMenu() {
    menu(`<b>Subtítulos</b><div class="list">
      <button class="row ${st.subIdx < 0 ? 'on' : ''}" data-sub="-1">Desactivados</button>
      ${st.subs.map((t, i) => `<button class="row ${st.subIdx === i ? 'on' : ''}" data-sub="${i}">${App.esc(t.label || 'Pista ' + (i + 1))}</button>`).join('')}
      <button class="row" data-a="addsub">+ Añadir archivo (.srt, .ass, .vtt)</button></div>
      <b style="margin-top:10px">Tamaño</b><div class="seg">${[['s', 'Pequeño'], ['m', 'Normal'], ['l', 'Grande'], ['xl', 'Enorme']].map(([k, l]) => `<button data-subsize="${k}" class="${st.prefs.subSize === k ? 'on' : ''}">${l}</button>`).join('')}</div>`);
  }
  function speedMenu() {
    menu(`<b>Velocidad</b><div class="seg wrap">${[.5, .75, 1, 1.25, 1.5, 1.75, 2].map(s => `<button data-rate="${s}" class="${st.v.playbackRate === s ? 'on' : ''}">${s}×</button>`).join('')}</div>
      <b style="margin-top:10px">Saltar opening</b><div class="seg">${[80, 85, 90].map(s => `<button data-skipv="${s}" class="${st.prefs.skip === s ? 'on' : ''}">${s} s</button>`).join('')}</div>
      <div class="kv"><span>Siguiente episodio automático</span><button class="switch ${st.prefs.autoNext ? 'on' : ''}" data-a="autonext"></button></div>`);
  }
  async function savePrefs() { await DB.setKV('playerPrefs', st.prefs); }

  function onClick(e) {
    const t = e.target, a = t.closest('[data-a]')?.dataset.a;
    const sb = t.closest('[data-sub]'); if (sb) { setSub(+sb.dataset.sub); DB.setKV('subOn', +sb.dataset.sub >= 0); return subsMenu(); }
    const ss = t.closest('[data-subsize]'); if (ss) { st.prefs.subSize = ss.dataset.subsize; el().className = el().className.replace(/sub-\w+/, 'sub-' + st.prefs.subSize); savePrefs(); return subsMenu(); }
    const rt = t.closest('[data-rate]'); if (rt) { st.v.playbackRate = +rt.dataset.rate; $('#pSpeed').textContent = rt.dataset.rate + '×'; return speedMenu(); }
    const sk = t.closest('[data-skipv]'); if (sk) { st.prefs.skip = +sk.dataset.skipv; savePrefs(); return speedMenu(); }
    if (!a) { if (!t.closest('#pMenu')) menu(null); return; }
    if (a === 'close') return close();
    if (a === 'toggle') return toggle();
    if (a === 'rew') return seekBy(-10);
    if (a === 'fwd') return seekBy(10);
    if (a === 'skip') { st.skipped = true; return seekBy(st.prefs.skip); }
    if (a === 'subs') return $('#pMenu').hidden ? subsMenu() : menu(null);
    if (a === 'speed') return $('#pMenu').hidden ? speedMenu() : menu(null);
    if (a === 'autonext') { st.prefs.autoNext = !st.prefs.autoNext; savePrefs(); return speedMenu(); }
    if (a === 'addsub') return addSub();
    if (a === 'pip') return st.v.requestPictureInPicture?.().catch(() => App.toast('No disponible'));
    if (a === 'fs') return fullscreen();
    if (a === 'convert') return convert();
    if (a === 'stay') { clearInterval(st.timer); t.closest('.next-up').remove(); return; }
    if (a === 'next') return st.next ? swap(st.next) : App.toast('No hay más episodios');
    if (a === 'fake') { App.saveProgress(st.item, 1440, 1440, true); App.toast('Marcado como visto'); close(); }
  }
  function addSub() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.srt,.vtt,.ass,.ssa';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f || st.item.seriesId === 'tmp') return;
      const item = await DB.get('items', st.item.id); item.subKeys ||= [];
      const sk = item.id + '-s' + Date.now(); await DB.put('files', { key: sk, blob: f, name: f.name, type: 'text/plain' }); item.subKeys.push(sk);
      await DB.put('items', item); st.item.subKeys = item.subKeys;
      await loadSubs(item.subKeys); setTimeout(() => { setSub(st.subs.length - 1); subsMenu(); }, 80);
    };
    inp.click();
  }
  function fullscreen() {
    const v = st.v, p = el();
    if (document.fullscreenElement || document.webkitFullscreenElement) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    if (p.requestFullscreen) return p.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => { })).catch(() => { });
    if (v.webkitEnterFullscreen) return v.webkitEnterFullscreen(); // iPhone: reproductor del sistema
  }

  /* ---------- gestos ---------- */
  function bindGestures(g) {
    let s = null, lastTap = 0, tapT = 0, holdT = 0;
    g.addEventListener('pointerdown', e => {
      const r = g.getBoundingClientRect();
      s = { x: e.clientX, y: e.clientY, t: Date.now(), w: r.width, h: r.height, rx: (e.clientX - r.left) / r.width, mode: null, t0: st.v.currentTime, vol: st.v.volume, br: st.bright };
      holdT = setTimeout(() => { if (s && !s.mode && !st.v.paused) { s.mode = 'hold'; st.v.playbackRate = 2; indicate('<span>2× ››</span>'); } }, 550);
    });
    g.addEventListener('pointermove', e => {
      if (!s || s.mode === 'hold') return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.mode && Math.hypot(dx, dy) > 14) { clearTimeout(holdT); s.mode = Math.abs(dx) > Math.abs(dy) ? 'seek' : (s.rx > .5 ? 'vol' : 'bright'); }
      if (s.mode === 'seek') { const d = st.v.duration || 0; s.to = Math.max(0, Math.min(d - .5, s.t0 + dx / s.w * Math.min(d, 180))); indicate(`<span>${s.to >= s.t0 ? '+' : '−'}${fmt(Math.abs(s.to - s.t0))}</span><small>${fmt(s.to)} / ${fmt(d)}</small>`); }
      if (s.mode === 'vol') { const v = Math.max(0, Math.min(1, s.vol - dy / (s.h * .7))); st.v.volume = v; st.v.muted = v === 0; indicate(`${ico(I.vol)}<span>${Math.round(v * 100)} %</span>`); }
      if (s.mode === 'bright') { st.bright = Math.max(.25, Math.min(1.3, s.br - dy / (s.h * .7))); $('.dim').style.opacity = st.bright < 1 ? 1 - st.bright : 0; st.v.style.filter = st.bright > 1 ? `brightness(${st.bright})` : ''; indicate(`${ico(I.sun)}<span>${Math.round(st.bright * 100)} %</span>`); }
    });
    const end = e => {
      clearTimeout(holdT);
      if (!s) return;
      const was = s; s = null;
      if (was.mode === 'hold') { st.v.playbackRate = parseFloat($('#pSpeed').textContent) || 1; return; }
      if (was.mode === 'seek' && was.to != null) { st.v.currentTime = was.to; return; }
      if (was.mode || e.type === 'pointercancel') return;
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapT); lastTap = 0;
        if (was.rx < .35) seekBy(-10); else if (was.rx > .65) seekBy(10); else toggle();
        return;
      }
      lastTap = now;
      tapT = setTimeout(() => { if (!$('#pMenu').hidden) return menu(null); ui(el().classList.contains('hide-ui')); }, 260);
    };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    g.addEventListener('wheel', e => { e.preventDefault(); const v = Math.max(0, Math.min(1, st.v.volume - e.deltaY / 1000)); st.v.volume = v; indicate(`${ico(I.vol)}<span>${Math.round(v * 100)} %</span>`); }, { passive: false });
  }
  function bindSeek(bar) {
    let drag = false;
    const at = e => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    const tip = e => { const f = at(e); const t = $('#pTip'); t.textContent = fmt(f * (st.v.duration || 0)); t.style.left = f * 100 + '%'; };
    bar.addEventListener('pointerdown', e => { drag = true; bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); tip(e); });
    bar.addEventListener('pointermove', e => { tip(e); if (drag) { const f = at(e); $('#pCur').style.width = f * 100 + '%'; $('#pKnob').style.left = f * 100 + '%'; } });
    bar.addEventListener('pointerup', e => { if (!drag) return; drag = false; bar.classList.remove('drag'); st.v.currentTime = at(e) * (st.v.duration || 0); hideSoon(); });
  }

  function onKey(e) {
    if (el().hidden || !st) return;
    if (e.target.matches('input')) return;
    const v = st.v, k = e.key;
    if (k === 'Escape') { if (!$('#pMenu').hidden) return menu(null); if (!document.fullscreenElement) close(); return; }
    if (!v?.src) return;
    if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowRight') seekBy(10);
    else if (k === 'ArrowLeft') seekBy(-10);
    else if (k === 'ArrowUp') { e.preventDefault(); v.volume = Math.min(1, v.volume + .1); indicate(`${ico(I.vol)}<span>${Math.round(v.volume * 100)} %</span>`); }
    else if (k === 'ArrowDown') { e.preventDefault(); v.volume = Math.max(0, v.volume - .1); indicate(`${ico(I.vol)}<span>${Math.round(v.volume * 100)} %</span>`); }
    else if (k.toLowerCase() === 'f') fullscreen();
    else if (k.toLowerCase() === 'm') { v.muted = !v.muted; indicate(`<span>${v.muted ? 'Silencio' : 'Sonido'}</span>`); }
    else if (k.toLowerCase() === 'c') { setSub(st.subIdx >= 0 ? -1 : 0); }
    else if (k.toLowerCase() === 's') { st.skipped = true; seekBy(st.prefs.skip); }
    else if (k.toLowerCase() === 'n' && st.next) swap(st.next);
    ui(true);
  }

  function save(ended) {
    const v = st?.v; if (!v || !v.duration || st.item.seriesId === 'tmp') return;
    const done = ended || v.currentTime / v.duration > .9;
    App.saveProgress(st.item, Math.floor(v.currentTime), Math.floor(v.duration), done);
  }
  async function upNext() {
    const nx = st.next; if (!nx || !st.prefs.autoNext) return ui(true);
    const box = document.createElement('div'); box.className = 'next-up';
    let n = 8;
    box.innerHTML = `<div><span class="tiny">Siguiente</span><b style="display:block">${App.esc(nx.title)}</b></div><button class="btn primary sm" data-a="next">Ver (${n})</button><button class="btn sm" data-a="stay">No</button>`;
    el().appendChild(box);
    st.timer = setInterval(() => { n--; const b = box.querySelector('.primary'); if (b) b.textContent = `Ver (${n})`; if (n <= 0) { clearInterval(st.timer); swap(nx); } }, 1000);
  }
  async function swap(item) { const s = st.series, cb = st.onClose; close(true); open(await DB.get('items', item.id) || item, s, cb); }

  function close(silent) {
    if (!st) return;
    save(); clearInterval(st.timer); clearTimeout(hideT);
    st.v?.pause(); if (st.v) st.v.removeAttribute('src');
    st.urls.forEach(u => URL.revokeObjectURL(u));
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    el().hidden = true; el().innerHTML = ''; el().className = 'overlay';
    const cb = st.onClose; st = null;
    if (!silent) cb?.();
  }
  return { open, close };
})();
