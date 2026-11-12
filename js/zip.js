/* Lector · lector de ZIP/CBZ sin librerías.
   Lee el directorio central y descomprime cada imagen con DecompressionStream('deflate-raw'),
   que traen Chrome, Edge, Firefox y Safari 16.4+. No soporta ZIP cifrados ni ZIP64 (raro en CBZ). */
const Zip = (() => {
  const IMG = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  async function entries(blob) {
    // El "fin del directorio central" está en los últimos 22–65557 bytes
    const tailLen = Math.min(blob.size, 65557);
    const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('No es un ZIP/CBZ válido');
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOff = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const out = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true);
      const csize = cd.getUint32(p + 20, true);
      const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
      const local = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      out.push({ name, method, csize, local });
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  async function extract(blob, e) {
    const h = new DataView(await blob.slice(e.local, e.local + 30).arrayBuffer());
    const start = e.local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const raw = blob.slice(start, start + e.csize);
    const type = mime(e.name);
    if (e.method === 0) return new Blob([raw], { type });
    if (e.method !== 8) throw new Error('Compresión no soportada');
    const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Blob([await new Response(stream).arrayBuffer()], { type });
  }

  function mime(n) {
    const x = n.split('.').pop().toLowerCase();
    return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' }[x] || 'application/octet-stream';
  }

  /* Devuelve las páginas (imágenes) ordenadas de forma natural: 1, 2, … 10 */
  async function pages(blob) {
    const list = (await entries(blob))
      .filter(e => IMG.test(e.name) && !e.name.startsWith('__MACOSX') && !/(^|\/)\./.test(e.name))
      .sort((a, b) => natural.compare(a.name, b.name));
    return list.map(e => ({ name: e.name, load: () => extract(blob, e) }));
  }

  /* Todas las entradas (para EPUB): {name, load()} */
  async function list(blob) {
    return (await entries(blob)).filter(e => !e.name.endsWith('/')).map(e => ({ name: e.name, load: () => extract(blob, e) }));
  }

  return { pages, list, natural, IMG };
})();
