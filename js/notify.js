/* Lector · avisos de capítulos nuevos de las series que sigues (interruptor "Avisarme" en la ficha).
   Revisa al abrir la app y cada 20 minutos mientras está abierta:
   - tus bots de Telegram (archivos nuevos cuyo nombre encaja con una serie seguida),
   - los add-ons de streaming (si la serie tiene más episodios/capítulos que los que conoces).
   Sin servidor no se puede avisar con la app cerrada; las novedades salen en Inicio → "Novedades". */
const Notify = (() => {
  async function ask() {
    if (!('Notification' in window) || Notification.permission !== 'default') return Notification?.permission === 'granted';
    try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
  }
  async function show(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) { App.toast(`${title} · ${body}`); if (!('Notification' in window) || Notification.permission !== 'granted') return; }
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(title, { body, tag, icon: 'icon-192.png', badge: 'icon-192.png' });
      else new Notification(title, { body, tag, icon: 'icon-192.png' });
    } catch { }
  }

  async function check() {
    const followed = (await DB.all('series')).filter(s => s.follow && !s.demo);
    if (!followed.length) return [];
    const found = [];
    // streaming
    for (const s of followed.filter(x => x.id.startsWith('src-'))) {
      const [, aid, ...rest] = s.id.split('-'); const rid = rest.join('-');
      const addon = (await DB.all('addons')).find(a => s.id.startsWith('src-' + a.id + '-'));
      if (!addon || addon.type !== 'streaming' || addon.builtin) continue;
      try {
        const remote = await Addons.series(addon, s.id.slice(('src-' + addon.id + '-').length));
        const have = new Set((await DB.byIndex('items', 'seriesId', s.id)).map(i => i.num));
        const known = s.knownMax || Math.max(0, ...have);
        const fresh = (remote.items || []).filter(i => i.num > known && !have.has(i.num));
        for (const i of fresh) found.push({ id: 'st-' + s.id + '-' + i.num, seriesId: s.id, title: s.title, sub: `${i.title} · ${addon.name}`, at: Date.now(), remote: 'r:' + addon.id + ':' + s.id.slice(('src-' + addon.id + '-').length) });
        if (fresh.length) { const x = await DB.get('series', s.id); x.knownMax = Math.max(...fresh.map(i => i.num)); await DB.put('series', x); }
      } catch { }
      void aid; void rid;
    }
    // Telegram
    try { found.push(...await Tg.news(followed)); } catch { }
    if (!found.length) return [];
    const list = await DB.getKV('news', []);
    const ids = new Set(list.map(n => n.id));
    const fresh = found.filter(n => !ids.has(n.id));
    if (!fresh.length) return [];
    await DB.setKV('news', [...fresh, ...list].slice(0, 40));
    if (fresh.length === 1) show('Nuevo: ' + fresh[0].title, fresh[0].sub, fresh[0].id);
    else show(`${fresh.length} novedades en tus series`, fresh.slice(0, 3).map(n => n.title).join(', '), 'lector-news');
    return fresh;
  }
  async function dismiss(id) { await DB.setKV('news', (await DB.getKV('news', [])).filter(n => n.id !== id)); }

  let timer;
  function startLoop(onNews) {
    const run = async () => { const f = await check(); if (f.length) onNews?.(f); };
    setTimeout(run, 6000);
    clearInterval(timer); timer = setInterval(() => !document.hidden && run(), 20 * 60 * 1000);
  }
  return { ask, show, check, dismiss, startLoop };
})();
