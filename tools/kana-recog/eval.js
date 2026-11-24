/* Measure the kana handwriting check (public/recog.js) on test handwriting made by make_samples.py.
 *   fonts   : typefaces, several of them handwriting styles, as skeleton points (shape only; no pen strokes)
 *   kanjivg : pen strokes of KanjiVG, tested against a model built from the site's own stroke data only
 *   site    : the site's stroke data, tested against a model built from KanjiVG only
 * so no drawing is ever compared with a model made from the same source.
 * usage: node eval.js '{"tpl":"shipped"}'            (see README.md; other options: "quiet", "json", "reps", "set":{...})
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', '..', 'public');
const R = require(path.join(PUBLIC, 'recog.js'));
const raw = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'kana-strokes.json'), 'utf8'));
const strokeData = {}; raw.forEach(r => { strokeData[r.c] = { medians: r.m }; });
const opts = JSON.parse(process.argv[2] || '{}');
if (opts.set) R._.set(opts.set);
const fonts = JSON.parse(fs.readFileSync(__dirname + '/data/fonts.json', 'utf8'));
const kvg = JSON.parse(fs.readFileSync(__dirname + '/data/kanjivg.json', 'utf8'));
const kvgShapes = {}; kvg.forEach(s => { kvgShapes[s.ch] = s.strokes; });
const tpl = opts.tpl || 'shipped';
const shipped = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'kana-shapes.json'), 'utf8')).shapes;
const model = tpl === 'site' ? R.build(strokeData) : tpl === 'kvg' ? R.build({}, kvgShapes) : tpl === 'shipped' ? R.build(strokeData, shipped) : R.build(strokeData, kvgShapes);
const modelSite = R.build(strokeData), modelKvg = R.build({}, kvgShapes);
const quiet = !!opts.quiet;

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pct = (x, n) => (100 * x / n).toFixed(1).padStart(5);

/* rows: {ch, list, m} where m is the model the list was ranked against */
function summarise(name, rows, log) {
  const n = rows.length; let top1 = 0, ok = 0, near = 0, alsoOk = 0; const dT = [], conf = {}, miss = {}, also = {};
  rows.forEach(r => {
    const list = r.list, pos = list.findIndex(x => x.ch === r.ch);
    if (pos === 0) top1++; else conf[r.ch + '→' + list[0].ch] = (conf[r.ch + '→' + list[0].ch] || 0) + 1;
    dT.push(list[pos].d);
    const j = R._.judgeRanked(r.m, list, r.ch);
    if (j.near) near++;
    if (j.ok) ok++; else miss[r.ch] = (miss[r.ch] || 0) + 1;
    /* would a different kana have been accepted for this drawing, had it been the one asked for? */
    for (let k = 0; k < Math.min(6, list.length); k++) {
      if (list[k].ch === r.ch) continue;
      const jj = R._.judgeRanked(r.m, list, list[k].ch);
      if (jj && jj.ok) { alsoOk++; also[r.ch + '≈' + list[k].ch] = (also[r.ch + '≈' + list[k].ch] || 0) + 1; }
    }
  });
  dT.sort((a, b) => a - b);
  if (log !== false) console.log(`${name.padEnd(21)} n=${String(n).padStart(4)}  best match ${pct(top1, n)}%  ACCEPTED ${pct(ok, n)}%  (near enough ${pct(near, n)}%, of those judged incomplete ${pct(near - ok, n)}%)  a wrong kana would pass ${(alsoOk / n).toFixed(3)} per drawing  own distance median ${dT[n >> 1].toFixed(2)} p95 ${dT[Math.floor(n * 0.95)].toFixed(2)}`);
  return { conf, miss, also, n, ok, top1, alsoOk };
}
function top(o, k) { return Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k || 30).map(e => e[0] + '×' + e[1]).join(' '); }
function merge(a, b) { Object.keys(b).forEach(k => a[k] = (a[k] || 0) + b[k]); }

/* ---------- fonts ---------- */
const bySrc = {};
fonts.forEach(s => {
  const comps = {};
  s.pts.forEach(p => { (comps[p[3]] = comps[p[3]] || []).push({ x: p[0], y: p[1], a: p[2], w: 1 }); });
  const units = Object.values(comps); units.step = 1;
  (bySrc[s.src] = bySrc[s.src] || []).push({ ch: s.ch, m: model, list: R._.rankUnits(model, R.scriptOf(s.ch), units, false) });
});
let all = [], fc = {}, fm = {}, fa = {};
Object.keys(bySrc).forEach(src => { const r = summarise(src, bySrc[src], !quiet); all = all.concat(bySrc[src]); merge(fc, r.conf); merge(fm, r.miss); merge(fa, r.also); });
const F = summarise('ALL FONTS', all);
if (!quiet) { console.log('  taken for another kana:', top(fc)); console.log('  not accepted:', top(fm)); console.log('  would also pass as:', top(fa)); }

/* ---------- pen strokes ---------- */
function distort(strokes, rnd, o) {
  let s = strokes.map(st => st.map(p => p.slice()));
  const xs = [].concat(...s.map(st => st.map(p => p[0]))), ys = [].concat(...s.map(st => st.map(p => p[1])));
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const sh = (rnd() - 0.5) * 2 * o.shear, sx = 1 + (rnd() - 0.5) * 2 * o.aspect, rot = (rnd() - 0.5) * 2 * o.rot;
  const c = Math.cos(rot), sn = Math.sin(rot);
  s = s.map(st => {
    const ox = (rnd() - 0.5) * 2 * o.shift * size, oy = (rnd() - 0.5) * 2 * o.shift * size, k = 1 + (rnd() - 0.5) * 2 * o.strokeScale;
    const mx = st.reduce((a, p) => a + p[0], 0) / st.length, my = st.reduce((a, p) => a + p[1], 0) / st.length;
    let wob = 0, wob2 = 0;
    return st.map(p => {
      wob += (rnd() - 0.5) * o.wobble * size; wob2 += (rnd() - 0.5) * o.wobble * size; wob *= 0.9; wob2 *= 0.9;
      let x = mx + (p[0] - mx) * k + ox + wob, y = my + (p[1] - my) * k + oy + wob2;
      x = x * sx + y * sh;
      return [x * c - y * sn, x * sn + y * c];
    });
  });
  if (o.reverse) s = s.map(st => rnd() < o.reverse ? st.slice().reverse() : st);
  if (o.shuffle && rnd() < o.shuffle) { const i = Math.floor(rnd() * s.length), j = Math.floor(rnd() * s.length); const t = s[i]; s[i] = s[j]; s[j] = t; }
  if (o.join && s.length > 1 && rnd() < o.join) { const i = Math.floor(rnd() * (s.length - 1)); s.splice(i, 2, s[i].concat(s[i + 1])); }
  const scale = 0.3 + rnd() * 2, tx = rnd() * 500, ty = rnd() * 500;      /* anywhere in the box, any size */
  return s.map(st => st.map(p => [p[0] * scale + tx, p[1] * scale + ty]));
}
const levels = {
  'as written': null,
  'a little uneven': { shear: 0.12, aspect: 0.1, rot: 0.08, shift: 0.03, strokeScale: 0.08, wobble: 0.006 },
  'sloppy': { shear: 0.25, aspect: 0.2, rot: 0.16, shift: 0.07, strokeScale: 0.18, wobble: 0.012 },
  'very sloppy': { shear: 0.32, aspect: 0.28, rot: 0.22, shift: 0.1, strokeScale: 0.25, wobble: 0.018 },
  'sloppy, own order': { shear: 0.25, aspect: 0.2, rot: 0.16, shift: 0.07, strokeScale: 0.18, wobble: 0.012, reverse: 0.25, shuffle: 0.6, join: 0.3 },
  'all backwards': { shear: 0.12, aspect: 0.1, rot: 0.08, shift: 0.03, strokeScale: 0.08, wobble: 0.006, reverse: 1 }
};
const sources = { 'kanjivg': [kvg.map(s => ({ ch: s.ch, strokes: s.strokes })), modelSite],
                  'site': [raw.filter(r => R.scriptOf(r.c) && !R._.SMALL[r.c]).map(r => ({ ch: r.c, strokes: R._.modelStrokes(r.m) })), modelKvg] };
let pc = {}, pm = {}, pa = {}; const P = {};
Object.keys(levels).forEach(lv => {
  let rowsAll = [];
  Object.keys(sources).forEach(src => {
    const rnd = mulberry(12345), reps = levels[lv] ? (opts.reps || 6) : 1;
    sources[src][0].forEach(s => { for (let k = 0; k < reps; k++) { const st = levels[lv] ? distort(s.strokes, rnd, levels[lv]) : s.strokes; rowsAll.push({ ch: s.ch, m: sources[src][1], list: R.rank(sources[src][1], R.scriptOf(s.ch), st) }); } });
  });
  const r = summarise('pen: ' + lv, rowsAll); P[lv] = r; merge(pc, r.conf); merge(pm, r.miss); merge(pa, r.also);
});
if (!quiet) { console.log('  taken for another kana:', top(pc)); console.log('  not accepted:', top(pm)); console.log('  would also pass as:', top(pa)); }

/* ---------- things that must NOT pass ---------- */
(function () {
  const rnd = mulberry(777);
  let n = 0, ok = 0, which = {};
  Object.keys(sources).forEach(src => sources[src][0].forEach(s => {
    if (s.strokes.length < 2) return;
    for (let drop = 0; drop < s.strokes.length; drop++) {
      const st = distort(s.strokes.filter((x, i) => i !== drop), rnd, levels['a little uneven']);
      const j = R._.judgeRanked(sources[src][1], R.rank(sources[src][1], R.scriptOf(s.ch), st), s.ch);
      n++; if (j.ok) { ok++; which[s.ch + (drop + 1)] = (which[s.ch + (drop + 1)] || 0) + 1; }
    }
  }));
  console.log(`one stroke left out (each stroke in turn): still accepted ${pct(ok, n)}% of ${n}`); if (!quiet) console.log('  ', top(which, 60));
  const missRate = ok / n;
  n = 0; ok = 0;
  Object.keys(sources).forEach(src => sources[src][0].forEach(s => {
    for (let k = 0; k < 3; k++) {
      const u = src === 'site' ? 9.4 : 1, a = [rnd() * 109 * u, rnd() * 109 * u], b = [rnd() * 109 * u, rnd() * 109 * u];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 45 * u) continue;
      const st = distort(s.strokes.concat([[a, b]]), rnd, levels['a little uneven']);
      const j = R._.judgeRanked(sources[src][1], R.rank(sources[src][1], R.scriptOf(s.ch), st), s.ch);
      n++; if (j.ok) ok++;
    }
  }));
  console.log(`one long extra line drawn across: still accepted ${pct(ok, n)}% of ${n}`);
  const near = []; let pass = 0, tried = 0;
  for (let i = 0; i < 800; i++) {
    const strokes = [], ns = 1 + Math.floor(rnd() * 4);
    for (let j = 0; j < ns; j++) {
      const kind = rnd(), pts = [];
      let x = rnd() * 100, y = rnd() * 100, a = rnd() * 6.28, steps = 5 + Math.floor(rnd() * 30);
      for (let t = 0; t < steps; t++) { pts.push([x, y]); a += kind < 0.33 ? (rnd() - 0.5) * 0.3 : kind < 0.66 ? 0.35 : (rnd() - 0.5) * 2.5; x += Math.cos(a) * 5; y += Math.sin(a) * 5; }
      strokes.push(pts);
    }
    const script = i % 2 ? 'hira' : 'kata', l = R.rank(model, script, strokes);
    near.push(l[0].d);
    /* asked for a random kana, answered with a scribble */
    const base = R._.SCRIPTS[script].base, asked = base[Math.floor(rnd() * base.length)];
    tried++; const j = R._.judgeRanked(model, l, asked); if (j && j.ok) pass++;
  }
  near.sort((a, b) => a - b);
  console.log(`scribbles: nearest kana at distance p5 ${near[40].toFixed(2)} median ${near[400].toFixed(2)}; a scribble given for a random kana was accepted ${pct(pass, tried)}% of ${tried}`);
  if (opts.json) console.log(JSON.stringify({ fonts: F.ok / F.n, fontsAlso: F.alsoOk / F.n, mild: P['a little uneven'].ok / P['a little uneven'].n, sloppy: P['sloppy'].ok / P['sloppy'].n, very: P['very sloppy'].ok / P['very sloppy'].n, order: P['sloppy, own order'].ok / P['sloppy, own order'].n,
    also: (P['a little uneven'].alsoOk + P['sloppy'].alsoOk) / (P['a little uneven'].n + P['sloppy'].n), missing: missRate }));
})();
