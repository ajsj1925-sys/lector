/* Lector · MKV → MP4 en el propio dispositivo, sin volver a codificar (solo cambia el "envoltorio").
   Pensado para iPhone/iPad, donde Safari no abre MKV. Lee el MKV por trozos (no lo carga entero en memoria),
   copia el vídeo (H.264, H.265, VP9, AV1) y el audio (AAC, Opus) a un MP4 con mp4-muxer y extrae los
   subtítulos internos (ASS/SSA/SRT) a WebVTT.
   Mkv.toMp4(blob, onProgress) → { mp4: Blob, subs: [{ name, lang, vtt }], info } */
const Mkv = (() => {
  const ID = {
    EBML: 0x1A45DFA3, Segment: 0x18538067, Info: 0x1549A966, TimecodeScale: 0x2AD7B1, Duration: 0x4489,
    Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63A2,
    DefaultDuration: 0x23E383, Language: 0x22B59C, Name: 0x536E, FlagDefault: 0x88, Video: 0xE0, PixelWidth: 0xB0,
    PixelHeight: 0xBA, Audio: 0xE1, SamplingFrequency: 0xB5, Channels: 0x9F, ContentEncodings: 0x6D80,
    Cluster: 0x1F43B675, Timecode: 0xE7, SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1, BlockDuration: 0x9B, ReferenceBlock: 0xFB,
  };
  const TOP = new Set([ID.Cluster, 0x1C53BB6B, 0x1941A469, 0x1043A770, 0x1254C367, 0x114D9B74, ID.Tracks, ID.Info]);

  /* lectura por ventanas de 8 MB */
  class Src {
    constructor(b) { this.b = b; this.ws = 0; this.w = new Uint8Array(0); }
    async bytes(pos, len) {
      if (pos >= this.ws && pos + len <= this.ws + this.w.length) return this.w.subarray(pos - this.ws, pos - this.ws + len);
      this.w = new Uint8Array(await this.b.slice(pos, pos + Math.max(len, 8 << 20)).arrayBuffer()); this.ws = pos;
      return this.w.subarray(0, Math.min(len, this.w.length));
    }
  }
  function vint(b, i, keepMarker) {
    const f = b[i]; let len = 1, m = 0x80;
    while (len <= 8 && !(f & m)) { len++; m >>= 1; }
    if (len > 8) throw new Error('MKV dañado');
    let v = keepMarker ? f : f & (m - 1), all = (f & (m - 1)) === m - 1;
    for (let k = 1; k < len; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 255) all = false; }
    return { v, len, unknown: !keepMarker && all };
  }
  async function head(src, pos) {
    const b = await src.bytes(pos, 12);
    if (b.length < 2) return null;
    const id = vint(b, 0, true), sz = vint(b, id.len, false);
    return { id: id.v, size: sz.unknown ? -1 : sz.v, hdr: id.len + sz.len, pos };
  }
  const uint = b => { let v = 0; for (const x of b) v = v * 256 + x; return v; };
  const float = b => { const d = new DataView(b.buffer, b.byteOffset, b.byteLength); return b.length === 4 ? d.getFloat32(0) : d.getFloat64(0); };
  const str = b => new TextDecoder().decode(b).replace(/\0+$/, '');
  /* recorre los hijos de un bloque ya en memoria */
  function* kids(b, s = 0, e = b.length) {
    let i = s;
    while (i < e) {
      const id = vint(b, i, true), sz = vint(b, i + id.len, false);
      const start = i + id.len + sz.len, size = sz.unknown ? e - start : sz.v;
      yield { id: id.v, data: b.subarray(start, start + size) };
      i = start + size;
    }
  }

  function parseTracks(b) {
    const out = [];
    for (const e of kids(b)) {
      if (e.id !== ID.TrackEntry) continue;
      const t = { lang: 'und', def: 1 };
      for (const k of kids(e.data)) {
        if (k.id === ID.TrackNumber) t.num = uint(k.data);
        else if (k.id === ID.TrackType) t.type = uint(k.data);
        else if (k.id === ID.CodecID) t.codec = str(k.data);
        else if (k.id === ID.CodecPrivate) t.priv = k.data.slice();
        else if (k.id === ID.DefaultDuration) t.defDur = uint(k.data);
        else if (k.id === ID.Language) t.lang = str(k.data);
        else if (k.id === ID.Name) t.name = str(k.data);
        else if (k.id === ID.FlagDefault) t.def = uint(k.data);
        else if (k.id === ID.ContentEncodings) t.encoded = true;
        else if (k.id === ID.Video) for (const v of kids(k.data)) { if (v.id === ID.PixelWidth) t.w = uint(v.data); if (v.id === ID.PixelHeight) t.h = uint(v.data); }
        else if (k.id === ID.Audio) for (const a of kids(k.data)) { if (a.id === ID.SamplingFrequency) t.sr = float(a.data); if (a.id === ID.Channels) t.ch = uint(a.data); }
      }
      out.push(t);
    }
    return out;
  }

  /* separa los fotogramas de un bloque (con o sin "lacing") */
  function frames(d, off, flags) {
    const lacing = (flags >> 1) & 3;
    if (!lacing) return [d.subarray(off)];
    const n = d[off] + 1; let i = off + 1; const sizes = [];
    if (lacing === 1) { for (let k = 0; k < n - 1; k++) { let s = 0, x; do { x = d[i++]; s += x; } while (x === 255); sizes.push(s); } }
    else if (lacing === 3) {
      let first = vint(d, i, false); i += first.len; sizes.push(first.v);
      for (let k = 1; k < n - 1; k++) { const r = vint(d, i, false); i += r.len; const bias = 2 ** (7 * r.len - 1) - 1; sizes.push(sizes[k - 1] + r.v - bias); }
    } else { const each = (d.length - i) / n; for (let k = 0; k < n - 1; k++) sizes.push(each); }
    const total = d.length - i - sizes.reduce((a, b) => a + b, 0); sizes.push(total);
    const out = []; for (const s of sizes) { out.push(d.subarray(i, i + s)); i += s; }
    return out;
  }

  const AAC_SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  function aacConfig(t) {
    if (t.priv?.length) return t.priv;
    const prof = /HE|SBR/.test(t.codec) ? 2 : /MAIN/.test(t.codec) ? 1 : /SSR/.test(t.codec) ? 3 : 2;
    const fi = Math.max(0, AAC_SR.indexOf(Math.round(t.sr || 48000)));
    const ch = t.ch || 2;
    return new Uint8Array([(prof << 3) | (fi >> 1), ((fi & 1) << 7) | (ch << 3)]);
  }
  const hex = n => n.toString(16).padStart(2, '0');
  function videoCodec(t) {
    if (t.codec === 'V_MPEG4/ISO/AVC') return { codec: 'avc', str: t.priv ? `avc1.${hex(t.priv[1])}${hex(t.priv[2])}${hex(t.priv[3])}` : 'avc1.640028' };
    if (t.codec === 'V_MPEGH/ISO/HEVC') return { codec: 'hevc', str: 'hvc1.1.6.L120.90' };
    if (t.codec === 'V_VP9') return { codec: 'vp9', str: 'vp09.00.40.08' };
    if (t.codec === 'V_AV1') return { codec: 'av1', str: 'av01.0.08M.08' };
    return null;
  }
  function audioCodec(t) {
    if (/^A_AAC/.test(t.codec)) return { codec: 'aac', str: 'mp4a.40.2', desc: aacConfig(t) };
    if (t.codec === 'A_OPUS') return { codec: 'opus', str: 'opus', desc: t.priv };
    return null;
  }
  const SUBC = /^(S_TEXT\/(ASS|SSA|UTF8|WEBVTT)|S_ASS|S_SSA)$/;
  const LANGS = { spa: 'Español', es: 'Español', eng: 'Inglés', en: 'Inglés', jpn: 'Japonés', ja: 'Japonés', por: 'Portugués', fre: 'Francés', fra: 'Francés', ita: 'Italiano', ger: 'Alemán', deu: 'Alemán', cat: 'Catalán', und: '' };

  /* Mira qué contiene el MKV sin convertirlo */
  async function probe(blob) {
    const src = new Src(blob);
    const e = await head(src, 0);
    if (!e || e.id !== ID.EBML) throw new Error('No es un archivo MKV/WebM');
    let pos = e.pos + e.hdr + e.size;
    const seg = await head(src, pos);
    if (seg.id !== ID.Segment) throw new Error('MKV sin segmento');
    const segStart = pos + seg.hdr, segEnd = seg.size < 0 ? blob.size : Math.min(blob.size, segStart + seg.size);
    let scale = 1e6, duration = 0, tracks = null; pos = segStart;
    while (pos < segEnd) {
      const h = await head(src, pos); if (!h) break;
      if (h.id === ID.Cluster) break;
      if (h.id === ID.Info || h.id === ID.Tracks) {
        const b = await src.bytes(pos + h.hdr, h.size);
        if (h.id === ID.Info) for (const k of kids(b)) { if (k.id === ID.TimecodeScale) scale = uint(k.data); if (k.id === ID.Duration) duration = float(k.data); }
        else tracks = parseTracks(b.slice());
      }
      if (h.size < 0) break;
      pos += h.hdr + h.size;
    }
    if (!tracks) throw new Error('MKV sin pistas');
    return { src, tracks, scale, duration: duration * scale / 1e9, clusterPos: pos, segEnd };
  }

  async function toMp4(blob, onProgress = () => { }) {
    if (typeof Mp4Muxer === 'undefined') await Formats.loadScript('vendor/mp4-muxer.min.js');
    const { src, tracks, scale, duration, clusterPos, segEnd } = await probe(blob);
    const vt = tracks.find(t => t.type === 1);
    const ats = tracks.filter(t => t.type === 2);
    const at = ats.find(t => t.def && audioCodec(t)) || ats.find(t => audioCodec(t)) || ats[0];
    const sts = tracks.filter(t => t.type === 0x11 && SUBC.test(t.codec));
    const vc = vt && videoCodec(vt), ac = at && audioCodec(at);
    if (vt && !vc) throw new Error(`El vídeo usa ${vt.codec}, que no se puede pasar a MP4 sin recodificar.`);
    if (at && !ac) throw new Error(`El audio usa ${at.codec.replace('A_', '')}; Safari solo acepta AAC u Opus dentro del MP4. Hace falta recodificar el audio en el PC (por ejemplo con HandBrake).`);
    if ([vt, at].some(t => t?.encoded)) throw new Error('Este MKV tiene pistas comprimidas internamente (header stripping); no se puede convertir aquí.');

    // salida: los primeros 4 MB en memoria (para el parche final del tamaño de "mdat"), el resto como trozos
    const HEAD = 4 << 20; const headBuf = new Uint8Array(HEAD); let headLen = 0, written = 0; const parts = []; let pend = [];
    const flush = () => { if (pend.length) { parts.push(new Blob(pend)); pend = []; } };
    const target = new Mp4Muxer.StreamTarget({
      onData(data, pos) {
        if (pos < HEAD) {
          const n = Math.min(data.length, HEAD - pos);
          headBuf.set(data.subarray(0, n), pos); headLen = Math.max(headLen, pos + n);
          written = Math.max(written, pos + n);
          if (n === data.length) return;
          data = data.subarray(n); pos += n;
        }
        if (pos !== Math.max(written, HEAD)) throw new Error('Escritura fuera de orden en el MP4');
        pend.push(data.slice()); written = pos + data.length;
        if (pend.length > 256) flush();
      },
    });
    const muxer = new Mp4Muxer.Muxer({
      target, fastStart: false, firstTimestampBehavior: 'cross-track-offset',
      video: vc ? { codec: vc.codec, width: vt.w || 1280, height: vt.h || 720 } : undefined,
      audio: ac ? { codec: ac.codec, numberOfChannels: at.ch || 2, sampleRate: Math.round(at.sr || 48000) } : undefined,
    });

    const tcs = scale / 1000; // unidades del MKV → microsegundos
    // vídeo: el MKV guarda en orden de decodificación con tiempos de presentación (B-frames) → calculamos DTS
    const vq = []; let heap = [], vDelay = null, vDur = vt?.defDur ? vt.defDur / 1000 : 0, vMetaSent = false, vCount = 0;
    const hpush = x => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p] <= heap[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const hpop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l] < heap[m]) m = l; if (r < heap.length && heap[r] < heap[m]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const R = 16;
    function outVideo() {
      const f = vq.shift(); const dts = hpop() - vDelay;
      const meta = vMetaSent ? undefined : { decoderConfig: { codec: vc.str, codedWidth: vt.w, codedHeight: vt.h, description: vt.priv } };
      vMetaSent = true; vCount++;
      muxer.addVideoChunkRaw(f.data, f.key ? 'key' : 'delta', f.pts - base, vDur, meta, f.pts - dts);
    }
    function pushVideo(f) {
      vq.push(f); hpush(f.pts);
      if (vDelay === null) {
        if (vq.length < 64) return;
        initDelay(); start();
      }
      while (vq.length > R) outVideo();
    }
    function initDelay() {
      const sorted = vq.map(f => f.pts).sort((a, b) => a - b);
      vDelay = 0; vq.forEach((f, i) => { vDelay = Math.max(vDelay, sorted[i] - f.pts); });
      if (!vDur) { const d = []; for (let i = 1; i < sorted.length; i++) d.push(sorted[i] - sorted[i - 1]); d.sort((a, b) => a - b); vDur = d[d.length >> 1] || 41708; }
    }
    // Todos los tiempos se desplazan igual (base) para que ninguno sea negativo y vídeo y audio sigan sincronizados.
    // El audio espera en cola hasta saber el retardo del vídeo; se añade primero la pista que empieza antes.
    let base = null; const aq = [];
    function start() {
      const vFirst = vq.length ? Math.min(...vq.map(f => f.pts)) - vDelay : Infinity;
      const aFirst = aq.length ? aq[0].ts : Infinity;
      base = Math.min(vFirst, aFirst); if (!isFinite(base)) base = 0;
      if (aFirst <= vFirst) { const q = aq.splice(0); q.forEach(addAudio); }
      else { if (vq.length) outVideo(); const q = aq.splice(0); q.forEach(addAudio); }
    }
    // audio: la duración de cada trozo es la distancia al siguiente
    let aPrev = null, aMetaSent = false, aDurLast = 0;
    function pushAudio(f) {
      if (base === null) { aq.push(f); if (!vt) start(); return; }
      addAudio(f);
    }
    function addAudio(f) {
      if (aPrev) {
        const dur = Math.max(1, f.ts - aPrev.ts); aDurLast = dur;
        muxer.addAudioChunkRaw(aPrev.data, 'key', aPrev.ts - base, dur, aMetaSent ? undefined : { decoderConfig: { codec: ac.str, numberOfChannels: at.ch || 2, sampleRate: Math.round(at.sr || 48000), description: ac.desc } });
        aMetaSent = true;
      }
      aPrev = f;
    }
    const subCues = new Map(sts.map(t => [t.num, []]));
    const assFmt = t => { const m = t.priv && str(t.priv).match(/\[Events\][\s\S]*?Format:(.*)/i); return m ? m[1].split(',').map(s => s.trim().toLowerCase()) : null; };

    let pos = clusterPos, lastYield = 0;
    while (pos < segEnd) {
      const h = await head(src, pos); if (!h) break;
      if (h.id !== ID.Cluster) { if (h.size < 0) break; pos += h.hdr + h.size; continue; }
      let cTime = 0, p = pos + h.hdr; const cEnd = h.size < 0 ? segEnd : pos + h.hdr + h.size;
      while (p < cEnd) {
        const k = await head(src, p); if (!k) { p = cEnd; break; }
        if (h.size < 0 && TOP.has(k.id)) break; // cluster de tamaño desconocido: termina al llegar al siguiente
        if (k.id === ID.Timecode) cTime = uint(await src.bytes(p + k.hdr, k.size));
        else if (k.id === ID.SimpleBlock || k.id === ID.BlockGroup) {
          let blk, dur = null, key;
          if (k.id === ID.SimpleBlock) { blk = (await src.bytes(p + k.hdr, k.size)).slice(); key = !!(blk[vint(blk, 0, false).len + 2] & 0x80); }
          else {
            const g = await src.bytes(p + k.hdr, k.size); let ref = false;
            for (const c of kids(g)) { if (c.id === ID.Block) blk = c.data.slice(); else if (c.id === ID.BlockDuration) dur = uint(c.data); else if (c.id === ID.ReferenceBlock) ref = true; }
            key = !ref;
          }
          if (blk) {
            const tn = vint(blk, 0, false); const off = tn.len;
            const rel = (blk[off] << 24 >> 16) | blk[off + 1];
            const flags = blk[off + 2];
            const ts = (cTime + rel) * tcs;
            if (vt && tn.v === vt.num) pushVideo({ data: blk.subarray(off + 3), pts: ts, key });
            else if (at && tn.v === at.num) {
              const fr = frames(blk, off + 3, flags);
              const step = fr.length > 1 && dur ? dur * tcs / fr.length : (at.defDur ? at.defDur / 1000 : 0);
              fr.forEach((d, i) => pushAudio({ data: d.slice(), ts: ts + i * (step || 0) }));
            } else if (subCues.has(tn.v)) {
              const t = sts.find(s => s.num === tn.v), txt = str(blk.subarray(off + 3));
              const end = ts + (dur ? dur * tcs : 3e6);
              if (/ASS|SSA/.test(t.codec)) { const parts = txt.split(','); subCues.get(tn.v).push(Subs.cue(ts / 1e6, end / 1e6, parts.slice(8).join(','))); }
              else subCues.get(tn.v).push(Subs.cue(ts / 1e6, end / 1e6, txt.replace(/<[^>]+>/g, '')));
            }
          }
        }
        if (k.size < 0) { p = cEnd; break; }
        p += k.hdr + k.size;
      }
      pos = p;
      if (performance.now() - lastYield > 50) { onProgress(Math.min(.99, pos / blob.size)); await new Promise(r => setTimeout(r, 0)); lastYield = performance.now(); }
    }
    if (vt && vDelay === null) { initDelay(); start(); }
    if (base === null) start();
    while (vq.length) outVideo();
    if (aPrev) muxer.addAudioChunkRaw(aPrev.data, 'key', aPrev.ts - base, aDurLast || 21333, aMetaSent ? undefined : { decoderConfig: { codec: ac.str, numberOfChannels: at.ch || 2, sampleRate: Math.round(at.sr || 48000), description: ac.desc } });
    muxer.finalize();
    flush();
    onProgress(1);
    let mp4 = new Blob([headBuf.slice(0, Math.min(headLen, HEAD)), ...parts], { type: 'video/mp4' });
    if (vt && vDelay > 0) mp4 = await addEditList(mp4, vDelay);
    const subs = sts.map(t => ({ name: t.name || LANGS[t.lang] || t.lang || 'Subtítulos', lang: t.lang, def: !!t.def, vtt: Subs.vtt(subCues.get(t.num)) })).filter(s => s.vtt.length > 12);
    return { mp4, subs, info: { duration, video: vt?.codec, audio: at?.codec, frames: vCount } };
  }

  /* Con B-frames el primer fotograma se muestra con retraso (vDelay). Como mp4-muxer no escribe "edit lists",
     se añade aquí una (edts/elst) a la pista de vídeo para que empiece en 0 y quede sincronizada con el audio. */
  async function addEditList(mp4, delayUs) {
    const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const w32 = (b, i, v) => { b[i] = v >>> 24; b[i + 1] = (v >>> 16) & 255; b[i + 2] = (v >>> 8) & 255; b[i + 3] = v & 255; };
    const type = (b, i) => String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    // localizar moov recorriendo las cajas de primer nivel
    let pos = 0, moovPos = -1;
    while (pos < mp4.size) {
      const h = new Uint8Array(await mp4.slice(pos, pos + 16).arrayBuffer());
      let size = u32(h, 0); const t = type(h, 0);
      if (size === 1) size = u32(h, 8) * 2 ** 32 + u32(h, 12);
      if (t === 'moov') { moovPos = pos; break; }
      if (!size) break;
      pos += size;
    }
    if (moovPos < 0) return mp4;
    const moov = new Uint8Array(await mp4.slice(moovPos).arrayBuffer());
    const children = (b, s, e) => { const out = []; let i = s; while (i + 8 <= e) { const sz = u32(b, i); if (sz < 8) break; out.push({ t: type(b, i), s: i, e: i + sz }); i += sz; } return out; };
    let movieScale = 1000;
    for (const c of children(moov, 8, moov.length)) if (c.t === 'mvhd') movieScale = u32(moov, c.s + 8 + (moov[c.s + 8] === 1 ? 20 : 12));
    for (const trak of children(moov, 8, moov.length).filter(c => c.t === 'trak')) {
      const tk = children(moov, trak.s + 8, trak.e);
      const mdia = tk.find(c => c.t === 'mdia'); if (!mdia) continue;
      const md = children(moov, mdia.s + 8, mdia.e);
      const hdlr = md.find(c => c.t === 'hdlr'), mdhd = md.find(c => c.t === 'mdhd');
      if (!hdlr || type(moov, hdlr.s + 12) !== 'vide' || moov[mdhd.s + 8] !== 0) continue;
      const tkhd = tk.find(c => c.t === 'tkhd'); if (!tkhd || moov[tkhd.s + 8] !== 0) return mp4;
      const mediaScale = u32(moov, mdhd.s + 20);
      const segDur = u32(moov, tkhd.s + 28);
      const elst = new Uint8Array(36);
      w32(elst, 0, 36); elst.set([101, 100, 116, 115], 4);            // 'edts'
      w32(elst, 8, 28); elst.set([101, 108, 115, 116], 12);           // 'elst'
      w32(elst, 16, 0); w32(elst, 20, 1);                              // versión 0, 1 entrada
      w32(elst, 24, segDur); w32(elst, 28, Math.round(delayUs / 1e6 * mediaScale)); w32(elst, 32, 0x00010000);
      const out = new Uint8Array(moov.length + 36);
      const at = tkhd.e; // la edit list va justo después de tkhd
      out.set(moov.subarray(0, at)); out.set(elst, at); out.set(moov.subarray(at), at + 36);
      w32(out, 0, u32(out, 0) + 36); w32(out, trak.s, u32(out, trak.s) + 36);
      return new Blob([mp4.slice(0, moovPos), out], { type: 'video/mp4' });
    }
    void movieScale;
    return mp4;
  }

  const isMkv = (name, type = '') => /\.mkv$/i.test(name) || /matroska/.test(type);
  /* ¿Este navegador reproduce MKV? (Safari/iOS no) */
  const needsConvert = () => {
    const ua = navigator.userAgent;
    const ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(ua);
    return ios || safari;
  };
  return { toMp4, probe, isMkv, needsConvert };
})();
