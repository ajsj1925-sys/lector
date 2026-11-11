/* Lector · reproductor de anime.
   Usa el <video> del navegador: MP4/WebM en todos lados; MKV solo en Chrome/Edge/Android
   (Safari en iPhone/iPad no lo abre). Subtítulos .vtt y .srt (se convierten a .vtt al vuelo).
   Recuerda el minuto, marca visto al pasar el 90 % y ofrece el siguiente episodio. */
const Player = (() => {
  const el = () => document.getElementById('player');
  let st = null;

  const srt2vtt = t => 'WEBVTT\n\n' + t.replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');

  async function open(item, series, onClose) {
    st = { item, series, onClose, urls: [] };
    const p = el();
    p.hidden = false; p.className = 'overlay';
    p.innerHTML = `
      <div class="ov-bar top">
        <button class="ov-btn" data-a="close" title="Cerrar"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
        <div class="t"><b>${App.esc(series.title)}</b><span class="tiny">${App.esc(item.title)}</span></div>
        <select id="pSpeed" style="width:auto" title="Velocidad">${[.75, 1, 1.25, 1.5, 2].map(v => `<option value="${v}" ${v === 1 ? 'selected' : ''}>${v}×</option>`).join('')}</select>
        <button class="ov-btn" data-a="next" title="Siguiente episodio"><svg viewBox="0 0 24 24"><path d="M5 5l10 7-10 7zM19 5v14"/></svg></button>
      </div>
      <div id="pBody" style="flex:1;display:flex;min-height:0"></div>`;
    p.onclick = onClick;
    document.addEventListener('keydown', onKey);
    const body = p.querySelector('#pBody');

    if (item.demo) {
      body.innerHTML = `<div class="r-msg" style="margin:auto;max-width:420px">
        <b style="font-size:18px;color:#fff">Episodio de ejemplo</b><br><br>
        Aquí se reproducirá el vídeo cuando lo hayas añadido o descargado de uno de tus bots.<br><br>
        <button class="btn primary" data-a="fake">Marcar como visto</button></div>`;
      App.touch(series, item);
      return;
    }
    const f = item.fileKey && await DB.get('files', item.fileKey);
    if (!f) { body.innerHTML = `<div class="r-msg" style="margin:auto">El archivo ya no está en este dispositivo.</div>`; return; }
    const v = document.createElement('video');
    v.controls = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
    const u = URL.createObjectURL(f.blob); st.urls.push(u); v.src = u;
    for (const sk of item.subKeys || []) {
      const s = await DB.get('files', sk); if (!s) continue;
      let txt = await s.blob.text(); if (/\.srt$/i.test(s.name)) txt = srt2vtt(txt);
      const tu = URL.createObjectURL(new Blob([txt], { type: 'text/vtt' })); st.urls.push(tu);
      const tr = document.createElement('track');
      Object.assign(tr, { kind: 'subtitles', src: tu, srclang: 'es', label: s.name.replace(/\.(srt|vtt)$/i, ''), default: true });
      v.appendChild(tr);
    }
    body.appendChild(v); st.v = v;
    v.addEventListener('loadedmetadata', () => { if (!item.done && item.pos > 5 && item.pos < v.duration - 10) v.currentTime = item.pos; });
    let last = 0;
    v.addEventListener('timeupdate', () => {
      if (Date.now() - last < 4000) return; last = Date.now();
      save();
    });
    v.addEventListener('pause', save);
    v.addEventListener('ended', () => { save(true); upNext(); });
    v.addEventListener('error', () => {
      const mkv = /\.mkv$/i.test(f.name) || f.type.includes('matroska');
      body.innerHTML = `<div class="r-msg" style="margin:auto;max-width:440px">No se puede reproducir este vídeo en este navegador.${mkv ? '<br><br>Es un MKV: en iPhone/iPad Safari no los abre. En Android y PC con Chrome/Edge sí suelen funcionar.' : ''}</div>`;
    });
    p.querySelector('#pSpeed').onchange = e => { v.playbackRate = +e.target.value; };
    App.touch(series, item);
  }

  function save(ended) {
    const v = st?.v; if (!v || !v.duration) return;
    const done = ended || v.currentTime / v.duration > .9;
    App.saveProgress(st.item, Math.floor(v.currentTime), Math.floor(v.duration), done);
  }

  async function upNext() {
    const nx = await App.adjacent(st.item, 1); if (!nx) return;
    const box = document.createElement('div'); box.className = 'next-up';
    let n = 8;
    box.innerHTML = `<div><span class="tiny">Siguiente</span><b style="display:block">${App.esc(nx.title)}</b></div><button class="btn primary sm" data-a="next">Ver (${n})</button><button class="btn sm" data-a="stay">No</button>`;
    el().appendChild(box);
    st.timer = setInterval(() => { n--; const b = box.querySelector('.primary'); if (b) b.textContent = `Ver (${n})`; if (n <= 0) { clearInterval(st.timer); swap(nx); } }, 1000);
  }
  async function swap(item) { const s = st.series, cb = st.onClose; close(true); open(item, s, cb); }

  function onClick(e) {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'stay') { clearInterval(st.timer); e.target.closest('.next-up').remove(); }
    if (a === 'next') App.adjacent(st.item, 1).then(it => it ? swap(it) : App.toast('No hay más episodios'));
    if (a === 'fake') { App.saveProgress(st.item, 1440, 1440, true); App.toast('Marcado como visto'); close(); }
  }
  function onKey(e) {
    if (el().hidden || !st?.v) { if (e.key === 'Escape' && !el().hidden) close(); return; }
    const v = st.v;
    if (e.key === 'Escape' && !document.fullscreenElement) close();
    else if (e.key === ' ') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
    else if (e.key === 'ArrowRight') v.currentTime += 10;
    else if (e.key === 'ArrowLeft') v.currentTime -= 10;
    else if (e.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : v.requestFullscreen?.();
  }

  function close(silent) {
    if (!st) return;
    save(); clearInterval(st.timer);
    st.v?.pause();
    st.urls.forEach(u => URL.revokeObjectURL(u));
    document.removeEventListener('keydown', onKey);
    el().hidden = true; el().innerHTML = '';
    const cb = st.onClose; st = null;
    if (!silent) cb?.();
  }
  return { open, close };
})();
