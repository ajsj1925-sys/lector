/* Lector · espacio en el dispositivo y diagnóstico.
   - Space.ensure(bytes): comprueba si cabe un archivo; si no cabe y "borrar vistos" está activo, libera
     episodios ya vistos (los más antiguos primero). Importante en iPhone/iPad, donde Safari limita el espacio.
   - Space.diagnose(): qué puede hacer este dispositivo (para probar en móvil de verdad). */
const Space = (() => {
  async function info() {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0, free: Math.max(0, (e.quota || 0) - (e.usage || 0)), persisted: await navigator.storage.persisted?.() };
  }
  async function persist() { try { return await navigator.storage?.persist?.(); } catch { return false; } }

  /* Borra archivos de episodios/capítulos terminados hasta liberar "need" bytes. Devuelve lo liberado. */
  async function clean(need = Infinity, { onlyAnime = false } = {}) {
    const items = (await DB.all('items')).filter(i => i.done && (i.fileKey || i.pageKeys) && !i.demo && (!onlyAnime || i.kind === 'anime'))
      .sort((a, b) => (a.lastAt || 0) - (b.lastAt || 0));
    let freed = 0;
    for (const it of items) {
      if (freed >= need) break;
      for (const k of [it.fileKey, ...(it.pageKeys || [])].filter(Boolean)) await DB.del('files', k);
      freed += it.size || 0;
      delete it.fileKey; delete it.pageKeys; it.removed = true; it.size = 0;
      await DB.put('items', it);
    }
    return freed;
  }

  async function ensure(bytes) {
    await persist();
    const i = await info();
    if (!i || !i.quota) return true; // el navegador no informa: lo intentamos igual
    const margin = 50 << 20;
    if (i.free > bytes + margin) return true;
    if (await DB.getKV('autoClean', false)) { await clean(bytes + margin - i.free); const j = await info(); return j.free > bytes; }
    return false;
  }

  async function diagnose() {
    const v = document.createElement('video');
    const ua = navigator.userAgent;
    const can = t => { const r = v.canPlayType(t); return r === 'probably' ? 'Sí' : r === 'maybe' ? 'Probablemente' : 'No'; };
    const sp = await info();
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const rows = [
      ['Dispositivo', /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Otro'],
      ['Navegador', /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Otro'],
      ['Instalada como app', standalone ? 'Sí' : 'No (ábrela desde el icono para que no se borren datos)'],
      ['Espacio libre para Lector', sp ? App.fmtSize(sp.free) + ' de ' + App.fmtSize(sp.quota) : 'Desconocido'],
      ['Datos protegidos contra borrado', sp ? (sp.persisted ? 'Sí' : 'No') : '—'],
      ['Vídeo MP4 (H.264)', can('video/mp4; codecs="avc1.640028, mp4a.40.2"')],
      ['Vídeo H.265 / HEVC', can('video/mp4; codecs="hvc1.1.6.L120.90"')],
      ['Vídeo MKV directo', Mkv.needsConvert() ? 'No (se convierte a MP4 al añadir)' : 'Sí (Chrome/Edge)'],
      ['WebM', can('video/webm; codecs="vp9, opus"')],
      ['Compartir → Lector', 'launchQueue' in window || /Android/.test(ua) ? 'Sí (Android, con la app instalada)' : 'No (en iPhone usa el botón Añadir)'],
      ['Pantalla siempre encendida', 'wakeLock' in navigator ? 'Sí' : 'No'],
      ['Notificaciones', 'Notification' in window ? (Notification.permission === 'granted' ? 'Activadas' : Notification.permission === 'denied' ? 'Bloqueadas' : 'Sin activar') : 'No disponibles' + (/iPhone|iPad/.test(ua) && !standalone ? ' (instala la app primero)' : '')],
      ['Pantalla completa', document.fullscreenEnabled || document.webkitFullscreenEnabled ? 'Sí' : 'No (en iPhone: instálala)'],
      ['Funciona sin conexión', 'serviceWorker' in navigator && navigator.serviceWorker.controller ? 'Sí' : 'Aún no (recarga una vez)'],
      ['WebAssembly (CBR/RAR)', typeof WebAssembly === 'object' ? 'Sí' : 'No'],
    ];
    return rows;
  }
  return { info, persist, clean, ensure, diagnose };
})();
