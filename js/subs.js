/* Lector · subtítulos: .vtt, .srt y .ass/.ssa (convertidos a WebVTT, sin estilos complejos). */
const Subs = (() => {
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const ts = s => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60; return `${pad(h)}:${pad(m)}:${pad(Math.floor(sec))}.${pad(Math.round((sec % 1) * 1000) % 1000, 3)}`; };
  const assTime = t => { const [h, m, s] = t.trim().split(':'); return (+h) * 3600 + (+m) * 60 + parseFloat(s); };

  function srt(t) { return 'WEBVTT\n\n' + t.replace(/\r/g, '').replace(/^\uFEFF/, '').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2'); }

  /* Convierte líneas Dialogue de ASS a cues WebVTT */
  function ass(t, fmtOverride) {
    const lines = t.replace(/\r/g, '').split('\n');
    let fmt = fmtOverride || null, inEvents = !!fmtOverride;
    const cues = [];
    for (const ln of lines) {
      if (/^\[events\]/i.test(ln)) { inEvents = true; continue; }
      if (/^\[/.test(ln)) { inEvents = false; continue; }
      if (!inEvents) continue;
      if (/^format:/i.test(ln)) { fmt = ln.slice(7).split(',').map(s => s.trim().toLowerCase()); continue; }
      if (!/^dialogue:/i.test(ln) || !fmt) continue;
      const parts = ln.slice(9).split(','); const n = fmt.length;
      const rec = parts.slice(0, n - 1).concat(parts.slice(n - 1).join(','));
      const get = k => rec[fmt.indexOf(k)]?.trim() ?? '';
      cues.push(cue(assTime(get('start')), assTime(get('end')), rec[fmt.indexOf('text')] ?? ''));
    }
    return vtt(cues);
  }
  function cue(start, end, raw) {
    const top = /\{[^}]*\\an?[789][^}]*\}/.test(raw) || /\{[^}]*\\a[567][^}]*\}/.test(raw);
    let text = raw.replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').trim();
    const drawing = /\{[^}]*\\p[1-9]/.test(raw);
    return { start, end, text: drawing ? '' : text, top };
  }
  function vtt(cues) {
    cues = cues.filter(c => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
    return 'WEBVTT\n\n' + cues.map(c => `${ts(c.start)} --> ${ts(c.end)}${c.top ? ' line:6%' : ''}\n${c.text}`).join('\n\n') + '\n';
  }

  function toVTT(text, name = '') {
    if (/^\uFEFF?WEBVTT/.test(text)) return text;
    if (/\.(ass|ssa)$/i.test(name) || /^\s*\[Script Info\]/i.test(text)) return ass(text);
    return srt(text);
  }
  return { toVTT, ass, cue, vtt, ts };
})();
