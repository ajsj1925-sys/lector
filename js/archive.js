/* Lector · fuente integrada: Internet Archive (archive.org).
   Solo obras marcadas como dominio público o con licencia Creative Commons (campo licenseurl),
   además de la colección de dibujos clásicos de dominio público.
   Todo por enlace directo: se ve online o se descarga en el dispositivo (sin torrents, sin servidor).
   API pública y gratis: advancedsearch.php (búsqueda) y /metadata/<id> (archivos de cada obra). */
const Archive = (() => {
  const IA = 'https://archive.org';
  const LIC = '(licenseurl:*publicdomain* OR licenseurl:*creativecommons*)';
  const VIDEO = /\.(mp4|m4v|webm|mkv|ogv|avi|mov|mpe?g)$/i;
  const BOOK = /\.(cbz|cbr|cb7|cbt|pdf|epub)$/i;

  // filas de Explorar (sin buscar nada)
  const ROWS = {
    anime: [
      ['Animación libre más vista', `mediatype:movies AND (subject:animation OR subject:anime OR subject:cartoon OR subject:cartoons) AND ${LIC}`],
      ['Dibujos clásicos (dominio público)', 'mediatype:movies AND collection:classic_cartoons'],
      ['Anime con licencia libre', `mediatype:movies AND (subject:anime OR subject:japanese animation) AND ${LIC}`],
      ['Películas de dominio público', `mediatype:movies AND collection:feature_films AND (subject:animation OR subject:animated)`],
    ],
    manga: [
      ['Cómics de dominio público', `mediatype:texts AND (subject:comics OR subject:comic OR subject:"comic books" OR collection:comics) AND ${LIC}`],
      ['Manga con licencia libre', `mediatype:texts AND (subject:manga OR subject:doujinshi) AND ${LIC}`],
      ['Cómics clásicos', 'mediatype:texts AND collection:goldenagecomics'],
    ],
  };
  const KINDQ = {
    anime: `mediatype:movies AND ((subject:animation OR subject:anime OR subject:cartoon OR subject:cartoons) AND ${LIC} OR collection:classic_cartoons)`,
    manga: `mediatype:texts AND ((subject:comics OR subject:comic OR subject:manga) AND ${LIC} OR collection:goldenagecomics)`,
  };

  const mem = new Map();
  async function get(url, key) {
    if (key && mem.has(key)) return mem.get(key);
    const cached = key ? await DB.getKV('ia:' + key, null) : null;
    if (cached && Date.now() - cached.at < 12 * 3600e3) { mem.set(key, cached.data); return cached.data; }
    let r;
    try { r = await fetch(url); } catch { if (cached) return cached.data; throw new Error('Sin conexión con Internet Archive'); }
    if (!r.ok) { if (cached) return cached.data; throw new Error('Internet Archive respondió ' + r.status); }
    const data = await r.json();
    if (key) { mem.set(key, data); DB.setKV('ia:' + key, { at: Date.now(), data }); }
    return data;
  }

  const txt = v => (Array.isArray(v) ? v[0] : v) || '';
  const clean = s => txt(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const card = (d, kind) => ({ id: d.identifier, title: clean(d.title) || d.identifier, kind, cover: `${IA}/services/img/${encodeURIComponent(d.identifier)}`, desc: clean(d.description).slice(0, 400), year: txt(d.year) });

  async function query(q, kind, rows = 30, key) {
    const u = `${IA}/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=year&rows=${rows}&page=1&output=json&sort[]=downloads+desc`;
    const j = await get(u, key);
    return (j.response?.docs || []).map(d => card(d, kind));
  }

  async function home(kind) {
    const k = kind === 'manga' ? 'manga' : 'anime';
    const out = await Promise.all(ROWS[k].map(async ([title, q], i) => { try { return { title, results: await query(q, k, 24, 'h-' + k + i) }; } catch (e) { return { title, results: [], error: e.message }; } }));
    return out.filter(r => r.results.length || r.error);
  }

  async function search(q, kind) {
    const ks = kind ? [kind] : ['anime', 'manga'];
    const all = await Promise.all(ks.map(k => query(`(${q.replace(/[():"]/g, ' ')}) AND ${KINDQ[k]}`, k, 30)));
    return all.flat();
  }

  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const fileUrl = (id, name) => `${IA}/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;
  const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska' };

  async function series(id) {
    const j = await get(`${IA}/metadata/${encodeURIComponent(id)}`, 'm-' + id);
    const md = j.metadata || {}, files = j.files || [];
    const isText = md.mediatype === 'texts';
    let items = [];
    if (isText) {
      // cada cómic / libro de la obra es un capítulo (los originales, no las conversiones de archive.org)
      const books = files.filter(f => BOOK.test(f.name) && f.source !== 'derivative');
      items = (books.length ? books : files.filter(f => /\.pdf$/i.test(f.name))).sort((a, b) => natural(a.name, b.name))
        .map((f, i) => ({ num: i + 1, title: f.title || f.name.replace(/\.[^.]+$/, '').split('/').pop(), url: fileUrl(id, f.name), size: +f.size || 0, name: f.name.split('/').pop() }));
    } else {
      // un episodio por vídeo original; se elige la versión que mejor se reproduce (MP4 H.264 si existe)
      const originals = files.filter(f => f.source === 'original' && VIDEO.test(f.name));
      const pick = o => {
        if (/\.mp4$/i.test(o.name)) return o;
        const der = files.filter(f => f.original === o.name && /\.mp4$/i.test(f.name));
        return der.find(f => /h\.?264/i.test(f.format)) || der[0] || o;
      };
      const list = (originals.length ? originals : files.filter(f => /\.mp4$/i.test(f.name))).map(pick);
      items = list.sort((a, b) => natural(a.name, b.name)).map((f, i) => ({
        num: i + 1, title: f.title || f.name.replace(/\.[^.]+$/, '').split('/').pop(),
        url: fileUrl(id, f.name), type: MIME[f.name.split('.').pop().toLowerCase()] || 'video/mp4', size: +f.size || 0, name: f.name.split('/').pop(),
      }));
    }
    return {
      id, title: clean(md.title) || id, kind: isText ? 'manga' : 'anime',
      cover: `${IA}/services/img/${encodeURIComponent(id)}`, desc: clean(md.description).slice(0, 1500),
      license: txt(md.licenseurl), year: txt(md.year || md.date).slice(0, 4), url: `${IA}/details/${id}`, items,
    };
  }

  return { home, search, series };
})();
