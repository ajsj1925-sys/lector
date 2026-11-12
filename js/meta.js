/* Lector · información de series desde AniList (API pública y gratuita, sin cuenta).
   Meta.search(título, 'anime'|'manga') → candidatos; Meta.apply(serie, candidato) guarda portada, banner,
   sinopsis, géneros, año, nota, estado y nº de episodios/capítulos. Meta.auto(serie) lo hace solo si el título encaja. */
const Meta = (() => {
  const Q = `query($q:String,$t:MediaType){Page(perPage:8){media(search:$q,type:$t,sort:SEARCH_MATCH){id siteUrl format status episodes chapters volumes averageScore seasonYear startDate{year} genres description(asHtml:false) bannerImage coverImage{extraLarge large color} title{romaji english native userPreferred} synonyms}}}`;
  const STATUS = { FINISHED: 'Terminado', RELEASING: 'En emisión', NOT_YET_RELEASED: 'Próximamente', CANCELLED: 'Cancelado', HIATUS: 'En pausa' };
  const FORMAT = { TV: 'Serie TV', TV_SHORT: 'Serie corta', MOVIE: 'Película', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Especial', MUSIC: 'Musical', MANGA: 'Manga', NOVEL: 'Novela ligera', ONE_SHOT: 'One-shot' };
  const GENRES = { Action: 'Acción', Adventure: 'Aventura', Comedy: 'Comedia', Drama: 'Drama', Ecchi: 'Ecchi', Fantasy: 'Fantasía', Horror: 'Terror', 'Mahou Shoujo': 'Mahou shoujo', Mecha: 'Mecha', Music: 'Música', Mystery: 'Misterio', Psychological: 'Psicológico', Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Slice of Life': 'Recuentos de la vida', Sports: 'Deportes', Supernatural: 'Sobrenatural', Thriller: 'Suspense' };
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const clean = d => (d || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\(Source:[^)]*\)/gi, '').replace(/\n{3,}/g, '\n\n').trim();

  async function search(q, kind) {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: Q, variables: { q, t: kind === 'anime' ? 'ANIME' : 'MANGA' } }),
    });
    if (!r.ok) throw new Error(r.status === 429 ? 'AniList: demasiadas búsquedas, espera un minuto' : 'AniList no responde (' + r.status + ')');
    const j = await r.json();
    return (j.data?.Page?.media || []).map(m => ({
      id: m.id, url: m.siteUrl, title: m.title.userPreferred || m.title.romaji, titles: [m.title.romaji, m.title.english, m.title.native, ...(m.synonyms || [])].filter(Boolean),
      cover: m.coverImage?.extraLarge || m.coverImage?.large, color: m.coverImage?.color, banner: m.bannerImage,
      desc: clean(m.description), genres: (m.genres || []).map(g => GENRES[g] || g), year: m.seasonYear || m.startDate?.year,
      score: m.averageScore, status: STATUS[m.status] || m.status, format: FORMAT[m.format] || m.format, count: m.episodes || m.chapters || null,
    }));
  }

  /* Descarga la imagen y la guarda reducida dentro de la serie (para que funcione sin conexión) */
  async function img(url, w, h) {
    try {
      const b = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(b);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const r = Math.max(w / bmp.width, h / bmp.height);
      c.getContext('2d').drawImage(bmp, (w - bmp.width * r) / 2, (h - bmp.height * r) / 2, bmp.width * r, bmp.height * r);
      return c.toDataURL('image/jpeg', .82);
    } catch { return url; } // si el servidor no deja leerla, se usa el enlace directo
  }

  async function apply(seriesId, m) {
    const s = await DB.get('series', seriesId); if (!s) return;
    s.meta = { id: m.id, url: m.url, title: m.title, genres: m.genres, year: m.year, score: m.score, status: m.status, format: m.format, count: m.count, color: m.color };
    if (m.desc) s.desc = m.desc;
    if (m.cover) { s.cover = await img(m.cover, 360, 540); s.realCover = true; }
    if (m.banner) s.banner = await img(m.banner, 1280, 320);
    await DB.put('series', s);
    return s;
  }

  /* Automático: solo si algún título de AniList coincide con el nuestro */
  async function auto(seriesId) {
    const s = await DB.get('series', seriesId); if (!s || s.meta || s.demo) return false;
    try {
      const res = await search(s.title, s.kind);
      const n = norm(s.title);
      const hit = res.find(m => m.titles.some(t => norm(t) === n)) || (res[0] && res[0].titles.some(t => norm(t).startsWith(n) && n.length > 4) ? res[0] : null);
      if (!hit) return false;
      await apply(seriesId, hit); return true;
    } catch { return false; }
  }
  return { search, apply, auto };
})();
