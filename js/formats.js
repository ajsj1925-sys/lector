/* Lector · formatos de manga: CBZ/ZIP (propio), PDF (pdf.js), EPUB (propio), CBR/RAR/7Z/TAR (libarchive.js).
   Se detecta el formato por los primeros bytes del archivo, así un CBZ que en realidad es RAR también se abre.
   Formats.pages(blob, name) → [{ name, load: () => Promise<Blob> }] */
const Formats = (() => {
  const IMG = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
  const BOOK = /\.(cbz|zip|cbr|rar|cb7|7z|cbt|tar|pdf|epub)$/i;
  const nat = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
  const mime = n => MIME[(n.split('.').pop() || '').toLowerCase()] || 'image/jpeg';
  const base = p => new URL(p, document.baseURI).href;
  const scripts = {};
  const loadScript = src => scripts[src] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });

  async function sniff(blob) {
    const b = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const s = String.fromCharCode(...b);
    if (s.startsWith('PK')) return 'zip';
    if (s.startsWith('Rar!')) return 'rar';
    if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return '7z';
    if (s.startsWith('%PDF')) return 'pdf';
    return 'other';
  }

  async function pages(blob, name = '') {
    const kind = await sniff(blob);
    if (kind === 'pdf') return pdf(blob);
    if (kind === 'zip') return /\.epub$/i.test(name) || await isEpub(blob) ? epub(blob) : Zip.pages(blob);
    return archive(blob, name); // rar, 7z, tar…
  }

  /* ---- PDF ---- */
  async function pdf(blob) {
    await loadScript('vendor/pdfjs/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    return Array.from({ length: doc.numPages }, (_, i) => ({
      name: 'p' + (i + 1),
      load: async () => {
        const pg = await doc.getPage(i + 1);
        const v1 = pg.getViewport({ scale: 1 });
        const scale = Math.min(4, Math.max(1, 1700 / v1.width));
        const vp = pg.getViewport({ scale });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: x, viewport: vp }).promise;
        const b = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
        c.width = c.height = 0;
        return b;
      },
    }));
  }

  /* ---- EPUB (manga/cómic con imágenes) ---- */
  async function isEpub(blob) { return (await Zip.list(blob)).some(e => e.name === 'META-INF/container.xml'); }
  async function epub(blob) {
    const files = await Zip.list(blob);
    const get = n => files.find(e => e.name === n || e.name === decodeURIComponent(n));
    const text = async n => { const e = get(n); return e ? (await e.load()).text() : ''; };
    const xml = s => new DOMParser().parseFromString(s, 'application/xml');
    const join = (dir, href) => { const parts = (dir + href).split('/'); const out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); } return out.join('/'); };
    const cont = xml(await text('META-INF/container.xml'));
    const opfPath = cont.querySelector('rootfile')?.getAttribute('full-path');
    if (!opfPath) throw new Error('EPUB sin índice');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opf = xml(await text(opfPath));
    const man = {};
    opf.querySelectorAll('manifest > item').forEach(it => man[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') || '' });
    const order = [];
    for (const ref of opf.querySelectorAll('spine > itemref')) {
      const it = man[ref.getAttribute('idref')]; if (!it) continue;
      const path = join(opfDir, it.href.split('#')[0]);
      if (it.type.startsWith('image/')) { order.push(path); continue; }
      const html = await text(path);
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
      const re = /<(?:img|image)\b[^>]*?(?:src|xlink:href|href)\s*=\s*["']([^"']+)["']/gi;
      let m; while ((m = re.exec(html))) order.push(join(dir, m[1]));
    }
    let imgs = [...new Set(order)].filter(p => get(p));
    if (!imgs.length) imgs = Object.values(man).filter(i => i.type.startsWith('image/')).map(i => join(opfDir, i.href)).filter(p => get(p)).sort(nat.compare);
    if (!imgs.length) throw new Error('Este EPUB es de solo texto (novela). Lector abre EPUB de manga y cómic con imágenes.');
    return imgs.map(p => ({ name: p, load: async () => { const b = await get(p).load(); return b.type ? b : new Blob([b], { type: mime(p) }); } }));
  }

  /* ---- RAR / 7Z / TAR con libarchive.js (WebAssembly) ---- */
  let archMod;
  async function archive(blob, name) {
    try {
      archMod ||= await import(base('vendor/libarchive/libarchive.js'));
      archMod.Archive.init({ workerUrl: base('vendor/libarchive/worker-bundle.js') });
      const file = blob instanceof File ? blob : new File([blob], name || 'archivo');
      const a = await archMod.Archive.open(file);
      const arr = (await a.getFilesArray()).filter(e => IMG.test(e.file.name) && !/__MACOSX/.test(e.path));
      arr.sort((x, y) => nat.compare(x.path + x.file.name, y.path + y.file.name));
      if (!arr.length) throw new Error('No hay imágenes dentro del archivo');
      let all = null; // si extraer de uno en uno falla, se extrae todo de golpe
      return arr.map(e => ({
        name: e.path + e.file.name,
        load: async () => {
          let f;
          try { f = await e.file.extract(); }
          catch { all ||= a.extractFiles(); await all; f = e.file instanceof File ? e.file : await e.file.extract(); }
          return new Blob([f], { type: mime(e.file.name) });
        },
      }));
    } catch (err) {
      throw new Error(/imágenes/.test(err.message) ? err.message : 'No se pudo abrir el archivo comprimido (' + err.message + ')');
    }
  }

  return { pages, sniff, BOOK, IMG, loadScript };
})();
