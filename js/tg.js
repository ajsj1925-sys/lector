/* Lector · Telegram con TU cuenta (MTProto, librería GramJS cargada desde esm.sh al usarla).
   Así se pueden descargar archivos de hasta 2 GB (con la Bot API solo 20 MB).
   - Inicio de sesión: número → código → (contraseña en dos pasos si la tienes). La sesión queda en este dispositivo.
   - Chat con cualquiera de tus bots dentro de la app: texto, comandos, botones, teclados y archivos.
   - "Descargar" mete el archivo en la biblioteca (vídeos → anime, CBZ/PDF/EPUB/RAR/imágenes → manga).
   - Sincronizar: guarda una copia del progreso en tus "Mensajes guardados" y la lee en los demás dispositivos. */
const Tg = (() => {
  const V = '2.26.22';
  const BASE = `https://esm.sh/telegram@${V}`;
  let mod = null, client = null, connecting = null;
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const cfg = () => DB.getKV('telegram', {});
  const saveCfg = async p => { const c = { ...(await cfg()), ...p }; await DB.setKV('telegram', c); return c; };
  const ERR = {
    PHONE_NUMBER_INVALID: 'Número de teléfono no válido (ponlo con prefijo, ej. +34…)', PHONE_CODE_INVALID: 'Código incorrecto',
    PHONE_CODE_EXPIRED: 'El código ha caducado, pide otro', PASSWORD_HASH_INVALID: 'Contraseña incorrecta', API_ID_INVALID: 'api_id o api_hash incorrectos',
    FLOOD_WAIT: 'Telegram pide esperar un poco antes de reintentar', AUTH_KEY_UNREGISTERED: 'La sesión se cerró, vuelve a iniciar sesión',
  };
  const tr = m => { for (const [k, v] of Object.entries(ERR)) if (String(m).includes(k)) return v; return m; };

  async function load() {
    if (mod) return mod;
    try {
      const [m, s] = await Promise.all([import(BASE), import(BASE + '/sessions')]);
      mod = { ...m, StringSession: s.StringSession };
      mod.Buffer = m.helpers.generateRandomBytes(1).constructor; // el Buffer que usa GramJS en el navegador
      return mod;
    } catch (e) { throw new Error('No se pudo cargar Telegram (¿sin conexión?): ' + e.message); }
  }

  async function connect({ interactive = false } = {}) {
    if (client?.connected && client._authed) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      const c = await cfg();
      if (!c.apiId || !c.apiHash) throw new Error('Primero guarda tu api_id y api_hash (Ajustes → Cuenta de Telegram)');
      const { TelegramClient, StringSession } = await load();
      if (!client) {
        client = new TelegramClient(new StringSession(c.session || ''), +c.apiId, String(c.apiHash).trim(), { connectionRetries: 5, useWSS: true, deviceModel: 'Lector', appVersion: '0.3', langCode: 'es', systemLangCode: 'es' });
        client.setLogLevel?.('error');
      }
      if (!client.connected) await client.connect();
      if (!(await client.checkAuthorization())) {
        if (!interactive) throw new Error('Inicia sesión en Telegram (Ajustes → Cuenta de Telegram)');
        await login();
      }
      client._authed = true;
      const me = await client.getMe();
      await saveCfg({ session: client.session.save(), me: { name: [me.firstName, me.lastName].filter(Boolean).join(' '), user: me.username || '', phone: me.phone || '' } });
      return client;
    })();
    try { return await connecting; } finally { connecting = null; }
  }

  /* pide un dato al usuario en una hoja; se resuelve con el texto o se rechaza al cancelar */
  function ask(kind, extra) {
    const T = {
      phone: ['Tu número de Telegram', 'Con prefijo del país, por ejemplo +34 600 000 000', 'tel', '+34'],
      code: ['Código de verificación', extra ? 'Te lo ha mandado Telegram dentro de la app de Telegram (no por SMS).' : 'Te ha llegado por SMS o dentro de Telegram.', 'text', ''],
      password: ['Contraseña de Telegram', 'Tienes activada la verificación en dos pasos.' + (extra ? ' Pista: ' + extra : ''), 'password', ''],
    }[kind];
    return new Promise((res, rej) => {
      let done = false;
      const close = App.sheet(`<h3>${T[0]}</h3><p class="muted" style="margin-bottom:10px">${App.esc(T[1])}</p>
        <input id="tgIn" type="${T[2]}" inputmode="${kind === 'code' ? 'numeric' : kind === 'phone' ? 'tel' : 'text'}" autocomplete="${kind === 'code' ? 'one-time-code' : 'off'}" value="${T[3]}">
        <p class="tiny" style="margin-top:8px">Esto va directo de tu dispositivo a Telegram. Nadie más lo ve.</p>
        <div class="acts"><button class="btn" id="tgCancel">Cancelar</button><button class="btn primary" id="tgOk">Seguir</button></div>`, (w, cl) => {
        const inp = w.querySelector('#tgIn'); setTimeout(() => inp.focus(), 50);
        const ok = () => { const v = inp.value.trim(); if (!v) return; done = true; cl(); res(kind === 'phone' ? v.replace(/[^\d+]/g, '') : v); };
        w.querySelector('#tgOk').onclick = ok; inp.onkeydown = e => e.key === 'Enter' && ok();
        w.querySelector('#tgCancel').onclick = () => { done = true; cl(); rej(new Error('Cancelado')); };
        w.addEventListener('click', e => { if (e.target === w && !done) { done = true; rej(new Error('Cancelado')); } });
      });
      void close;
    });
  }
  async function login() {
    let cancelled = false;
    await client.start({
      phoneNumber: () => ask('phone'),
      phoneCode: isApp => ask('code', isApp),
      password: hint => ask('password', hint),
      onError: async e => { if (/Cancelado/.test(e.message)) { cancelled = true; return true; } App.toast(tr(e.message)); return false; },
    });
    if (cancelled || !(await client.checkAuthorization())) throw new Error('No se inició sesión');
  }
  async function logout() {
    try { await connect(); await client.invoke(new mod.Api.auth.LogOut()); } catch { }
    try { await client?.disconnect(); } catch { }
    client = null; await saveCfg({ session: '', me: null, sync: false });
  }
  const ready = async () => !!(await cfg()).session;

  /* ---------------- chat con un bot ---------------- */
  let ch = null; // estado del chat abierto
  const chatEl = () => document.getElementById('tgChat');

  function fileOf(m) {
    if (m.photo) return { kind: 'photo', name: 'foto-' + m.id + '.jpg', size: 0, mime: 'image/jpeg' };
    const d = m.document; if (!d) return null;
    const attr = (d.attributes || []).find(a => a.className === 'DocumentAttributeFilename');
    const mime = d.mimeType || '';
    const ext = { 'video/mp4': 'mp4', 'video/x-matroska': 'mkv', 'application/pdf': 'pdf', 'application/zip': 'zip', 'application/epub+zip': 'epub', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime] || 'bin';
    const name = attr?.fileName || `archivo-${m.id}.${ext}`;
    const isVid = mime.startsWith('video/') || /\.(mkv|mp4|webm|m4v|mov)$/i.test(name);
    const isBook = Formats.BOOK.test(name) || /pdf|zip|rar|7z|epub/.test(mime);
    const isImg = mime.startsWith('image/') && !/sticker|tgs|webm/.test(mime) && !(d.attributes || []).some(a => a.className === 'DocumentAttributeSticker');
    if ((d.attributes || []).some(a => a.className === 'DocumentAttributeSticker')) return { kind: 'sticker', name, size: Number(d.size), mime };
    return { kind: isVid ? 'video' : isBook ? 'book' : isImg ? 'image' : 'other', name, size: Number(d.size), mime };
  }
  const esc = s => App.esc(s);
  const fmtText = t => esc(t || '').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)(\/[a-z0-9_]+)/gi, '$1<button class="cmd" data-cmd="$2">$2</button>').replace(/\n/g, '<br>');
  const ICON = { video: '🎬', book: '📖', image: '🖼️', photo: '🖼️', other: '📎', sticker: '' };

  function msgHTML(group) {
    const m = group[0], out = m.out;
    const files = group.map(fileOf).filter(Boolean);
    const text = group.map(x => x.message).filter(Boolean).join('\n');
    let body = '';
    if (files.length > 1 && files.every(f => f.kind === 'photo' || f.kind === 'image')) {
      body += `<div class="tg-file"><span class="ic">🖼️</span><span class="grow"><b>Álbum de ${files.length} imágenes</b><span class="tiny">Se guarda como un capítulo</span></span>${out ? '' : `<button class="btn sm primary" data-dlg="${m.groupedId}">Descargar</button>`}</div>`;
    } else for (const [k, f] of files.entries()) {
      if (f.kind === 'sticker') { body += '<div class="tiny">[pegatina]</div>'; continue; }
      const ok = f.kind !== 'other';
      body += `<div class="tg-file"><span class="ic">${ICON[f.kind]}</span><span class="grow"><b>${esc(f.name)}</b><span class="tiny">${f.size ? App.fmtSize(f.size) : ''}${f.kind === 'video' ? ' · vídeo' : f.kind === 'book' ? ' · manga/cómic' : ''}</span></span>
        ${out || !ok ? '' : `<button class="btn sm primary" data-dl="${group[k].id}">Descargar</button>`}</div>`;
    }
    if (text) body += `<div class="tg-text">${fmtText(text)}</div>`;
    const rows = m.buttons || [];
    if (rows.length && m.replyMarkup?.className === 'ReplyInlineMarkup') body += `<div class="tg-kb">${rows.map((r, i) => `<div class="tg-kr">${r.map((b, j) => b.url ? `<a class="tg-b" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.text)} ↗</a>` : `<button class="tg-b" data-btn="${m.id}|${i}|${j}">${esc(b.text)}</button>`).join('')}</div>`).join('')}</div>`;
    if (!body) body = '<div class="tiny">[mensaje no compatible]</div>';
    const time = new Date(m.date * 1000).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
    return `<div class="tg-msg ${out ? 'out' : 'in'}" data-mid="${m.id}">${body}<span class="tg-time">${time}${m.editDate ? ' · editado' : ''}</span></div>`;
  }
  function groups(list) {
    const out = [];
    for (const m of list) { const last = out[out.length - 1]; if (m.groupedId && last && String(last[0].groupedId) === String(m.groupedId)) last.push(m); else out.push([m]); }
    return out;
  }

  async function openChat(addon, prefill = '') {
    const host = document.createElement('div'); host.id = 'tgChat'; host.className = 'tgchat';
    host.innerHTML = `<div class="tg-box">
      <header><button class="ov-btn" data-tg="close" title="Cerrar"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
        <div class="tg-av">${esc((addon.name || addon.bot).replace('@', '')[0] || 'B').toUpperCase()}</div>
        <div class="grow"><b>${esc(addon.name)}</b><span class="tiny">${esc(addon.bot)}</span></div>
        <button class="btn sm ghost" data-tg="refresh" title="Actualizar">↻</button></header>
      <div class="tg-list" id="tgList"><div class="r-msg"><div class="spin"></div><br>Conectando con Telegram…</div></div>
      <div class="tg-rk" id="tgRk"></div>
      <div class="tg-quick">${['/start', '/help', ...(addon.commands?.search ? [addon.commands.search.replace('{q}', '').trim()] : [])].map(c => `<button class="chip" data-cmd="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <form class="tg-in" id="tgForm"><input id="tgText" placeholder="Escribe al bot…" autocomplete="off" value="${esc(prefill)}"><button class="btn primary" type="submit">Enviar</button></form></div>`;
    document.body.appendChild(host);
    ch = { addon, msgs: new Map(), poll: 0, alive: true };
    host.onclick = onChatClick;
    host.querySelector('#tgForm').onsubmit = e => { e.preventDefault(); const t = host.querySelector('#tgText'); if (t.value.trim()) { send(t.value.trim()); t.value = ''; } };
    try {
      await connect({ interactive: true });
      ch.peer = await client.getInputEntity(addon.bot);
      await refresh(true);
      ch.poll = setInterval(() => ch?.alive && !document.hidden && refresh(), 3000);
      if (prefill) host.querySelector('#tgText').focus();
    } catch (e) { const l = host.querySelector('#tgList'); if (l) l.innerHTML = `<div class="r-msg">${esc(tr(e.message))}<br><br><button class="btn" data-tg="close">Cerrar</button></div>`; }
  }

  async function refresh(scroll) {
    if (!ch?.peer) return;
    const list = (await client.getMessages(ch.peer, { limit: 40 })).reverse();
    let changed = false;
    for (const m of list) { const old = ch.msgs.get(m.id); if (!old || (old.editDate || 0) !== (m.editDate || 0)) changed = true; ch.msgs.set(m.id, m); }
    if (!changed && !scroll) return;
    const box = chatEl()?.querySelector('#tgList'); if (!box) return;
    const atBottom = box.scrollTop + box.clientHeight > box.scrollHeight - 80;
    box.innerHTML = list.length ? groups(list).map(msgHTML).join('') : '<div class="r-msg">Aún no hay mensajes. Prueba con /start.</div>';
    // teclado de respuesta del último mensaje del bot
    const lastBot = [...list].reverse().find(m => !m.out);
    const rk = chatEl().querySelector('#tgRk');
    rk.innerHTML = lastBot?.replyMarkup?.className === 'ReplyKeyboardMarkup' ? (lastBot.buttons || []).map(r => `<div class="tg-kr">${r.map(b => `<button class="tg-b" data-cmd="${esc(b.text)}">${esc(b.text)}</button>`).join('')}</div>`).join('') : '';
    if (scroll || atBottom) box.scrollTop = box.scrollHeight;
    // marca como visto para los avisos de novedades
    const seen = await DB.getKV('tgSeen', {}); const maxId = Math.max(0, ...list.map(m => m.id));
    if ((seen[ch.addon.bot] || 0) < maxId) { seen[ch.addon.bot] = maxId; await DB.setKV('tgSeen', seen); }
  }
  async function send(text) {
    try { await client.sendMessage(ch.peer, { message: text }); setTimeout(() => refresh(true), 400); setTimeout(() => refresh(), 1500); }
    catch (e) { App.toast(tr(e.message)); }
  }
  async function onChatClick(e) {
    const t = e.target;
    const a = t.closest('[data-tg]')?.dataset.tg;
    if (a === 'close') return closeChat();
    if (a === 'refresh') return refresh(true);
    const c = t.closest('[data-cmd]'); if (c) { e.preventDefault(); return send(c.dataset.cmd); }
    const b = t.closest('[data-btn]');
    if (b) {
      const [mid, i, j] = b.dataset.btn.split('|').map(Number); const m = ch.msgs.get(mid);
      b.disabled = true; b.classList.add('wait');
      try { const r = await m.click({ i, j }); if (r?.message) App.toast(r.message); } catch (err) { App.toast(tr(err.message)); }
      setTimeout(() => refresh(true), 500); setTimeout(() => refresh(), 1800);
      return;
    }
    const d = t.closest('[data-dl]'); if (d) { d.textContent = 'En cola'; d.disabled = true; return download([ch.msgs.get(+d.dataset.dl)], ch.addon); }
    const g = t.closest('[data-dlg]'); if (g) { g.textContent = 'En cola'; g.disabled = true; return download([...ch.msgs.values()].filter(m => String(m.groupedId) === g.dataset.dlg), ch.addon); }
  }
  function closeChat() { if (!ch) return; ch.alive = false; clearInterval(ch.poll); chatEl()?.remove(); ch = null; }

  /* ---------------- descargas a la biblioteca ---------------- */
  async function seriesFor(title, kind, source) {
    const all = await DB.all('series'), n = norm(title);
    let s = all.find(x => x.kind === kind && norm(x.title) === n && !x.demo);
    if (!s) {
      s = { id: DB.uid(), title, kind, cover: Demo.cover(title, [...title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7), kind), desc: '', source, addedAt: Date.now(), lastAt: 0 };
      await DB.put('series', s);
      if (await DB.getKV('autoMeta', true)) setTimeout(() => Meta.auto(s.id).then(ok => ok && App.refresh()), 500);
    }
    return s;
  }
  async function itemBase(s, num, kind) {
    const its = await DB.byIndex('items', 'seriesId', s.id);
    const same = num != null && its.find(i => i.num === num);
    if (same && !same.fileKey && !same.pageKeys) return { ...same, kind };            // ya existía sin archivo (p. ej. vino de otro dispositivo)
    if (num == null || same) num = Math.max(0, ...its.map(i => i.num)) + 1;
    return { id: DB.uid(), seriesId: s.id, num, title: (kind === 'anime' ? 'Episodio ' : 'Capítulo ') + num, kind, pos: 0, total: 0, done: false, lastAt: 0, addedAt: Date.now(), src: 'tg' };
  }

  async function download(msgs, addon) {
    msgs = msgs.filter(Boolean); if (!msgs.length) return;
    const f0 = fileOf(msgs[0]);
    const album = msgs.length > 1;
    const kind = !album && f0.kind === 'video' ? 'anime' : 'manga';
    const caption = msgs.map(m => m.message).find(Boolean) || '';
    const p = App.parseName(album ? (caption.split('\n')[0] || addon.name) : f0.name);
    const title = (p.title && p.title.length > 1 ? p.title : (caption.split('\n')[0] || addon.name)).slice(0, 80);
    Downloads.add({
      id: 'tg-' + msgs[0].id, title, sub: album ? `Álbum (${msgs.length} imágenes)` : f0.name, total: album ? msgs.length : f0.size,
      runner: async j => {
        await connect();
        const s = await seriesFor(title, kind, addon.bot);
        const base = await itemBase(s, p.num, kind);
        Object.assign(j, { id: base.id, sid: s.id, s: { kind }, title: s.title });
        if (album || f0.kind === 'photo') {
          const blobs = [];
          for (const m of msgs) { const buf = await client.downloadMedia(m, {}); blobs.push(new Blob([buf], { type: 'image/jpeg' })); j.got = album ? blobs.length : f0.size; Downloads.emit(); }
          const size = blobs.reduce((a, b) => a + b.size, 0);
          if (!(await Space.ensure(size))) throw new Error('No hay espacio en el dispositivo');
          const keys = [];
          for (const [i, b] of blobs.entries()) { const k = 'f-' + base.id + '-' + i; keys.push(k); await DB.put('files', { key: k, blob: b, name: i + '.jpg', type: 'image/jpeg' }); }
          await DB.put('items', { ...base, pageKeys: keys, total: keys.length, size });
          if (!s.realCover) await App.setCover(s.id, blobs[0], 'manga');
          return;
        }
        // documento grande: se baja por trozos de 512 KB y se va guardando en bloques
        const m = msgs[0], parts = []; let pend = [], pendSize = 0;
        for await (const chunk of client.iterDownload({ file: m.media, requestSize: 512 * 1024, fileSize: m.document.size, dcId: m.document.dcId, msgData: [ch?.peer || addon.bot, m.id] })) {
          pend.push(new Uint8Array(chunk)); pendSize += chunk.length; j.got += chunk.length;
          if (pendSize > 16 << 20) { parts.push(new Blob(pend)); pend = []; pendSize = 0; }
          Downloads.emit();
        }
        const blob = new Blob([...parts, new Blob(pend)], { type: f0.mime });
        await Downloads.saveDownloaded(j, base, blob, f0.name);
        if (!s.realCover) await App.setCover(s.id, blob, kind, f0.name);
      },
    });
    App.toast('Descargando: ' + title);
  }

  /* ---------------- sincronización por Mensajes guardados ---------------- */
  let syncing = null;
  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const c = await cfg(); if (!c.sync || !c.session) return null;
      await connect();
      const { client: cl } = mod;
      const msgs = (await client.getMessages('me', { limit: 15, search: 'lector-sync' })).filter(m => m.document && /lector-sync/.test(fileOf(m)?.name || ''));
      let res = null;
      const latest = msgs[0];
      if (latest && latest.id !== c.lastPushId) {
        const buf = await client.downloadMedia(latest, {});
        res = await Backup.merge(JSON.parse(new TextDecoder().decode(buf)), { settings: false });
      }
      const data = await Backup.data({ settings: false });
      data.series = data.series.map(({ cover, banner, ...r }) => r); // sin imágenes, para que pese poco
      const bytes = new TextEncoder().encode(JSON.stringify(data));
      const file = new cl.uploads.CustomFile('lector-sync.json', bytes.length, '', mod.Buffer.from(bytes));
      const sent = await client.sendFile('me', { file, caption: '#lector-sync · copia automática de Lector (no borrar)', forceDocument: true });
      const old = msgs.map(m => m.id).filter(id => id !== sent.id);
      if (old.length) await client.deleteMessages('me', old, { revoke: true }).catch(() => { });
      await saveCfg({ lastSync: Date.now(), lastPushId: sent.id });
      return res ? `Sincronizado: ${res.updated} capítulos actualizados` : 'Sincronizado';
    })();
    try { return await syncing; } finally { syncing = null; }
  }

  /* ---------------- novedades de los bots (para los avisos) ---------------- */
  async function news(followed) {
    const out = [];
    if (!(await ready())) return out;
    await connect();
    const seen = await DB.getKV('tgSeen', {});
    for (const a of (await DB.all('addons')).filter(x => x.type === 'telegram' && x.enabled)) {
      const since = seen[a.bot] || 0;
      const list = await client.getMessages(a.bot, { limit: 50, minId: since });
      for (const m of list) {
        if (m.out) continue;
        const f = fileOf(m); if (!f || f.kind === 'sticker' || f.kind === 'other') continue;
        const p = App.parseName(f.name); const n = norm(p.title || m.message || '');
        const s = followed.find(x => n && (norm(x.title) === n || n.includes(norm(x.title)) || norm(x.title).includes(n)));
        if (s) out.push({ id: 'tg-' + a.bot + '-' + m.id, seriesId: s.id, title: s.title, sub: `${p.num != null ? (s.kind === 'anime' ? 'Episodio ' : 'Capítulo ') + p.num : f.name} · ${a.bot}`, bot: a.id, at: m.date * 1000 });
      }
      if (list.length) { seen[a.bot] = Math.max(since, ...list.map(m => m.id)); }
    }
    await DB.setKV('tgSeen', seen);
    return out;
  }

  return { connect, logout, ready, openChat, closeChat, sync, news, cfg };
})();
