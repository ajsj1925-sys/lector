/* Lector · catálogo de anime y manga (AniList, gratis y sin cuenta).
   Solo fichas: portada, sinopsis, tráiler y dónde verlo/leerlo de forma oficial. No trae episodios.
   Catalog.home(kind)        → filas: tendencias, temporada / en publicación, populares, mejor valorados
   Catalog.browse(kind, q, genre) → una lista (búsqueda o género)
   Catalog.detail(id)        → ficha completa con tráiler, enlaces oficiales y recomendaciones
   Las respuestas se guardan 6 h en el dispositivo para que Explorar abra al momento y funcione sin conexión. */
const Catalog = (() => {
  const API = 'https://graphql.anilist.co';
  const TTL = 6 * 3600e3;
  const F = `fragment F on Media{id type title{userPreferred} coverImage{large color} format episodes chapters averageScore seasonYear startDate{year} status genres}`;
  const GENRES = [['Action', 'Acción'], ['Adventure', 'Aventura'], ['Comedy', 'Comedia'], ['Drama', 'Drama'], ['Fantasy', 'Fantasía'], ['Romance', 'Romance'], ['Sci-Fi', 'Ciencia ficción'], ['Slice of Life', 'Vida cotidiana'], ['Sports', 'Deportes'], ['Mystery', 'Misterio'], ['Horror', 'Terror'], ['Supernatural', 'Sobrenatural'], ['Psychological', 'Psicológico'], ['Mecha', 'Mecha']];
  const mem = new Map();

  async function gql(query, variables, key) {
    if (key && mem.has(key)) return mem.get(key);
    const cached = key ? await DB.getKV('cat:' + key, null) : null;
    if (cached && Date.now() - cached.at < TTL) { mem.set(key, cached.data); return cached.data; }
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
      if (!r.ok) throw new Error(r.status === 429 ? 'AniList: demasiadas peticiones, espera un minuto' : 'AniList no responde (' + r.status + ')');
      const j = await r.json();
      if (j.errors?.length && !j.data) throw new Error(j.errors[0].message);
      if (key) { mem.set(key, j.data); DB.setKV('cat:' + key, { at: Date.now(), data: j.data }); }
      return j.data;
    } catch (e) {
      if (cached) return cached.data; // sin conexión: lo último guardado
      throw new Error(e.message.includes('fetch') ? 'Sin conexión: no se puede cargar el catálogo' : e.message);
    }
  }

  const FORMAT = { TV: 'Serie', TV_SHORT: 'Corta', MOVIE: 'Película', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Especial', MANGA: 'Manga', NOVEL: 'Novela', ONE_SHOT: 'One-shot', MUSIC: 'Musical' };
  const card = m => ({
    id: 'c:' + m.id, title: m.title.userPreferred, cover: m.coverImage?.large, color: m.coverImage?.color,
    kind: m.type === 'MANGA' ? 'manga' : 'anime',
    sourceName: [FORMAT[m.format] || m.format, m.seasonYear || m.startDate?.year, m.averageScore ? '★ ' + (m.averageScore / 10).toFixed(1) : ''].filter(Boolean).join(' · '),
  });

  function season() {
    const d = new Date(), m = d.getMonth();
    return { s: ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL', 'WINTER'][m], y: m === 11 ? d.getFullYear() + 1 : d.getFullYear() };
  }

  async function home(kind) {
    const t = kind === 'manga' ? 'MANGA' : 'ANIME', { s, y } = season();
    const q = `query($t:MediaType,$s:MediaSeason,$y:Int,$st:MediaStatus){
      trend:Page(perPage:20){media(type:$t,sort:TRENDING_DESC,isAdult:false){...F}}
      now:Page(perPage:20){media(type:$t,season:$s,seasonYear:$y,status:$st,sort:POPULARITY_DESC,isAdult:false){...F}}
      pop:Page(perPage:20){media(type:$t,sort:POPULARITY_DESC,isAdult:false){...F}}
      top:Page(perPage:20){media(type:$t,sort:SCORE_DESC,isAdult:false){...F}}}${F}`;
    const vars = t === 'ANIME' ? { t, s, y } : { t, st: 'RELEASING' };
    const d = await gql(q, vars, 'home-' + t + '-' + (s || '') + y);
    const L = x => (d[x]?.media || []).map(card);
    return t === 'ANIME'
      ? [['trend', 'Tendencias', L('trend')], ['now', 'Esta temporada', L('now')], ['pop', 'Los más populares', L('pop')], ['top', 'Mejor valorados', L('top')]]
      : [['trend', 'Tendencias', L('trend')], ['now', 'En publicación', L('now')], ['pop', 'Los más populares', L('pop')], ['top', 'Mejor valorados', L('top')]];
  }

  async function browse(kind, q, genre) {
    const t = kind === 'manga' ? 'MANGA' : 'ANIME';
    const query = `query($t:MediaType,$q:String,$g:String,$sort:[MediaSort]){Page(perPage:40){media(type:$t,search:$q,genre:$g,sort:$sort,isAdult:false){...F}}}${F}`;
    const d = await gql(query, { t, q: q || undefined, g: genre || undefined, sort: q ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : ['POPULARITY_DESC'] }, q ? null : 'g-' + t + '-' + genre);
    return (d.Page?.media || []).map(card);
  }

  const DQ = `query($id:Int){Media(id:$id){id type siteUrl format status episodes chapters volumes averageScore seasonYear startDate{year} genres
    description(asHtml:false) bannerImage coverImage{extraLarge color} title{userPreferred romaji english native}
    trailer{id site} nextAiringEpisode{episode airingAt} studios(isMain:true){nodes{name}}
    externalLinks{url site type language notes}
    recommendations(perPage:12,sort:RATING_DESC){nodes{mediaRecommendation{...F}}}}}${F}`;

  async function detail(id) {
    const d = await gql(DQ, { id: +id }, 'd-' + id);
    const m = d.Media, c = card(m);
    const meta = await Meta.toInfo(m);
    const links = (m.externalLinks || []).filter(l => l.type === 'STREAMING' || /youtube/i.test(l.site))
      .map(l => ({ url: l.url, site: l.site, lang: l.language, yt: /youtube|youtu\.be/i.test(l.url), notes: l.notes }))
      .sort((a, b) => (b.yt - a.yt) || ((b.lang === 'Spanish') - (a.lang === 'Spanish')));
    return {
      ...c, banner: m.bannerImage, cover: m.coverImage?.extraLarge || c.cover, desc: meta.desc, meta, url: m.siteUrl,
      titles: [m.title.romaji, m.title.english, m.title.native].filter(Boolean),
      trailer: m.trailer?.site === 'youtube' ? m.trailer.id : null,
      next: m.nextAiringEpisode, studio: m.studios?.nodes?.[0]?.name,
      links, recs: (m.recommendations?.nodes || []).map(n => n.mediaRecommendation).filter(Boolean).map(card),
    };
  }

  /* "Quiero verlo / leerlo": lista guardada en el dispositivo */
  async function wish() { return DB.getKV('wish', []); }
  async function toggleWish(c) {
    const w = await wish(); const i = w.findIndex(x => x.id === c.id);
    if (i >= 0) w.splice(i, 1); else w.unshift({ id: c.id, title: c.title, cover: c.cover, kind: c.kind, sourceName: c.sourceName });
    await DB.setKV('wish', w); return i < 0;
  }

  /* YouTube: id de vídeo o lista a partir de un enlace; null si es un canal (no se puede incrustar) */
  function ytEmbed(u) {
    try {
      const url = new URL(u);
      const list = url.searchParams.get('list');
      const v = url.hostname.includes('youtu.be') ? url.pathname.slice(1) : url.searchParams.get('v') || (url.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/) || [])[1];
      if (v) return 'https://www.youtube-nocookie.com/embed/' + v + '?autoplay=1' + (list ? '&list=' + list : '');
      if (list) return 'https://www.youtube-nocookie.com/embed/videoseries?list=' + list + '&autoplay=1';
    } catch { }
    return null;
  }

  /* Kitsu: muchos add-ons de anime de Stremio usan ids "kitsu:<id>:<episodio>".
     AniList → Kitsu con la tabla de equivalencias de Kitsu (y si no, buscando por título). */
  const KITSU = ['https://kitsu.app/api/edge', 'https://kitsu.io/api/edge'];
  async function kitsu(path) {
    let last;
    for (const b of KITSU) { try { const r = await fetch(b + path, { headers: { Accept: 'application/vnd.api+json' } }); if (r.ok) return r.json(); last = r.status; } catch (e) { last = e.message; } }
    throw new Error('Kitsu no responde (' + last + ')');
  }
  async function kitsuId(anilistId, titles = []) {
    const key = 'kitsu:' + anilistId, c = await DB.getKV(key, null);
    if (c) return c;
    let out = null;
    try {
      const j = await kitsu(`/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${anilistId}&include=item`);
      const it = (j.included || []).find(x => x.type === 'anime');
      if (it) out = { id: it.id, eps: it.attributes?.episodeCount || 0, movie: it.attributes?.subtype === 'movie' };
    } catch { }
    if (!out && titles[0]) {
      try {
        const j = await kitsu(`/anime?filter[text]=${encodeURIComponent(titles[0])}&page[limit]=5`);
        const norm = t => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const hit = (j.data || []).find(x => titles.some(t => [x.attributes.canonicalTitle, ...Object.values(x.attributes.titles || {})].some(k => norm(k) === norm(t))));
        if (hit) out = { id: hit.id, eps: hit.attributes.episodeCount || 0, movie: hit.attributes.subtype === 'movie' };
      } catch { }
    }
    if (out) DB.setKV(key, out);
    return out;
  }
  async function kitsuEpisodes(id) { try { return (await kitsu('/anime/' + id)).data?.attributes?.episodeCount || 0; } catch { return 0; } }

  return { home, browse, detail, wish, toggleWish, ytEmbed, GENRES, kitsuId, kitsuEpisodes };
})();
