/* Lector · datos de ejemplo para ver la interfaz llena. Todo inventado.
   Se pueden borrar en Ajustes → "Quitar datos de ejemplo". */
const Demo = (() => {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function cover(title, hue, kind) {
    const words = title.split(' ');
    const lines = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).trim().length > 11) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    lines.push(cur);
    const text = lines.map((l, i) => `<text x="16" y="${232 + i * 26 - (lines.length - 1) * 26}" font-size="23" font-weight="800" fill="#fff" font-family="system-ui,sans-serif" letter-spacing="-.5">${esc(l)}</text>`).join('');
    const h2 = (hue + 40) % 360;
    const shape = kind === 'anime'
      ? `<circle cx="140" cy="88" r="58" fill="hsl(${h2} 90% 70% / .85)"/><path d="M0 170 L60 120 L110 150 L200 90 L200 300 L0 300Z" fill="hsl(${hue} 50% 18% / .9)"/>`
      : `<path d="M30 40 L170 40 L170 160 L30 160Z" fill="none" stroke="#fff6" stroke-width="3"/><path d="M30 100 L170 100 M100 40 L100 160" stroke="#fff6" stroke-width="3"/><circle cx="65" cy="70" r="18" fill="hsl(${h2} 90% 70%)"/>`;
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 45%)"/><stop offset="1" stop-color="hsl(${(hue + 300) % 360} 60% 14%)"/></linearGradient><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#0000"/><stop offset="1" stop-color="#000c"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/>${shape}<rect width="200" height="300" fill="url(#s)"/></svg>`)}`;
  }

  /* Página de manga de ejemplo (viñetas dibujadas) */
  function page(title, chap, n, total, hue, tall) {
    const W = 800, H = tall ? 2000 : 1200;
    let panels = '';
    if (tall) {
      for (let i = 0; i < 4; i++) panels += `<rect x="60" y="${60 + i * 480}" width="680" height="430" rx="6" fill="hsl(${(hue + i * 25) % 360} 30% 88%)" stroke="#111" stroke-width="6"/><circle cx="${200 + i * 110}" cy="${270 + i * 480}" r="70" fill="hsl(${hue} 60% 55%)"/>`;
    } else {
      panels = `<rect x="40" y="40" width="720" height="380" fill="hsl(${hue} 30% 88%)" stroke="#111" stroke-width="6"/>
      <rect x="40" y="440" width="350" height="360" fill="hsl(${hue + 20} 30% 85%)" stroke="#111" stroke-width="6"/>
      <rect x="410" y="440" width="350" height="360" fill="hsl(${hue + 40} 30% 85%)" stroke="#111" stroke-width="6"/>
      <rect x="40" y="820" width="720" height="340" fill="hsl(${hue + 60} 30% 88%)" stroke="#111" stroke-width="6"/>
      <circle cx="${200 + (n * 53) % 400}" cy="230" r="90" fill="hsl(${hue} 60% 55%)"/>
      <ellipse cx="560" cy="540" rx="150" ry="60" fill="#fff" stroke="#111" stroke-width="4"/>
      <text x="560" y="552" font-size="30" text-anchor="middle" font-family="system-ui" fill="#111">¡${n % 2 ? 'Vamos' : 'Espera'}!</text>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fafafa"/>${panels}<text x="${W / 2}" y="${H - 14}" font-size="22" text-anchor="middle" font-family="system-ui" fill="#666">${esc(title)} · Cap. ${chap} · ${n}/${total}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  const SERIES = [
    { title: 'Ecos de Kurogane', kind: 'anime', hue: 210, n: 12, desc: 'Una herrera de espadas descubre que cada arma que forja guarda la memoria de quien la empuña.', read: 7, pos: .4 },
    { title: 'La Brigada del Faro', kind: 'anime', hue: 170, n: 24, desc: 'Cinco guardianes de un faro en el fin del mundo vigilan algo que viene del mar.', read: 3, pos: .8 },
    { title: 'Cielo de Papel', kind: 'anime', hue: 30, n: 8, desc: 'Un chico que dibuja nubes que luego aparecen en el cielo.', read: 0 },
    { title: 'El Último Herrero', kind: 'manga', hue: 0, n: 45, desc: 'En una ciudad donde la magia se fabrica en fraguas, queda un solo artesano.', read: 18, pos: .5, mode: 'rtl' },
    { title: 'Ramen a Medianoche', kind: 'manga', hue: 45, n: 20, desc: 'Un puesto de ramen que solo abre para quien no puede dormir.', read: 20 },
    { title: 'Marea Roja', kind: 'manga', hue: 340, n: 60, desc: 'Webtoon a color. Una ciudad costera, una marea que no baja.', read: 31, pos: .2, mode: 'vertical' },
    { title: 'Torre 404', kind: 'manga', hue: 260, n: 15, desc: 'Un edificio con una planta que no aparece en los ascensores.', read: 0, mode: 'rtl' },
  ];

  async function seed() {
    if (await DB.getKV('demoSeeded')) return;
    const now = Date.now();
    for (const [si, s] of SERIES.entries()) {
      const id = 'demo-' + si;
      await DB.put('series', { id, title: s.title, kind: s.kind, cover: cover(s.title, s.hue, s.kind), desc: s.desc, source: 'Ejemplo', demo: true, hue: s.hue, mode: s.mode, addedAt: now - si * 86400000, lastAt: s.read ? now - si * 3600000 : 0 });
      for (let i = 1; i <= s.n; i++) {
        const done = i < s.read || (i === s.read && !s.pos);
        const cur = i === s.read && s.pos;
        const total = s.kind === 'anime' ? 1440 : (s.mode === 'vertical' ? 8 : 18);
        await DB.put('items', {
          id: `${id}-${i}`, seriesId: id, num: i, kind: s.kind, demo: true,
          title: s.kind === 'anime' ? `Episodio ${i}` : `Capítulo ${i}`,
          size: s.kind === 'anime' ? 3.1e8 + i * 1e6 : 2.4e7, total,
          pos: done ? total : cur ? Math.round(total * s.pos) : 0, done,
          lastAt: cur ? now - si * 3600000 : done ? now - 9e7 : 0,
        });
      }
    }
    await DB.put('addons', { id: 'demo-stream', name: 'Catálogo de ejemplo', type: 'streaming', enabled: true, builtin: true, desc: 'Fuente de prueba para ver cómo funciona Explorar.' });
    await DB.setKV('demoSeeded', true);
  }

  async function clear() {
    for (const s of await DB.all('series')) if (s.demo) {
      for (const it of await DB.byIndex('items', 'seriesId', s.id)) await DB.del('items', it.id);
      await DB.del('series', s.id);
    }
    await DB.del('addons', 'demo-stream');
  }

  /* Catálogo falso para el add-on de streaming de ejemplo */
  const CATALOG = [
    ['Guardianes del Andén', 'anime', 120], ['Brújula Rota', 'manga', 80], ['Sopa de Estrellas', 'anime', 15],
    ['Los Hijos del Volcán', 'manga', 300], ['Kendo en la Luna', 'anime', 200], ['Diario de una Bruja Novata', 'manga', 100],
    ['Cartero de Fantasmas', 'anime', 250], ['Isla Sin Nombre', 'manga', 190],
  ].map(([title, kind, hue], i) => ({ id: 'cat-' + i, title, kind, hue, cover: cover(title, hue, kind), count: kind === 'anime' ? 12 : 30, desc: 'Título de ejemplo del catálogo de prueba.' }));

  return { seed, clear, cover, page, CATALOG };
})();
