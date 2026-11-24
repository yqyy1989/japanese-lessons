/* Kana handwriting check.
 *
 * What was drawn is compared, as a whole shape, with every kana of the same script. It does not matter where in the
 * box it was written, how large, in which stroke order, or whether two strokes were joined into one.
 *
 * How it works: the ink is cut into short pieces; each piece adds to a small map of "where is there ink, and which
 * way does it run" (a grid of cells, four line orientations per cell, plus eight writing directions used as weaker
 * evidence). Two drawings are alike when their maps are alike. Each kana is known in two ordinary ways of writing it
 * (the site's own stroke data, and shapes adapted from KanjiVG), each in a few slanted and turned versions, so that
 * ordinary differences in handwriting still land close to it.
 *
 * The asked kana passes when it is the nearest of all kana, or nearly so, and
 *   - no stroke is missing: the drawing must not look more like the kana with one stroke left out;
 *   - no stroke is one too many: the drawing with one stroke taken away must not fit much better.
 *
 * The voicing marks ゛ and ゜ are looked for separately: two small strokes, or a small ring, up and to the right of
 * the rest. What is left is then compared with the plain kana. That way it does not matter exactly where the marks
 * were put.
 *
 * How it was measured, and on what, is written down in tools/kana-recog/README.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KanaRecog = factory();
})(this, function () {
  'use strict';

  var G = 10;                 /* grid cells per side */
  var R = 2.0;                /* half-width of the grid, in units of the drawing's spread */
  var OB = 4, DB = 8;         /* orientation bins (a line has no arrow) and direction bins (the pen has one) */
  var NU = G * G * OB, ND = G * G * DB;
  var ASPECT = 0.5;           /* 1 keeps the drawing's proportions, 0 squares everything up */
  var W_DIR = 0.45;           /* how much the writing direction counts next to the plain shape */
  var SHAPE_ONLY = 1.15;      /* a drawing with strokes written the other way round is judged on shape, at this handicap */
  var MARK_SMALL = 0.36;      /* a mark stroke is at most this long, measured against the whole drawing's diagonal */
  var MARK_RIGHT = 0;         /* ...and sits at least this far right of the middle of the rest (in units of the rest's size) */
  var WEAK_MARK = 0.08;       /* handicap when the mark is one small squiggle: two ticks run together, or a ring left open */
  var WHOLE_MARK = 0.12;      /* handicap when no separate mark was found and the whole drawing is compared with the voiced kana */
  var MARK_SEEN = 0.10;       /* handicap for the plain kana when clear marks were drawn next to it */
  var PART = 0.90;            /* a stroke is missing if the drawing fits the kana-with-one-stroke-left-out this much better than the whole kana */
  var EXTRA = 0.75;           /* a stroke is one too many if the drawing without it fits the kana this much better */
  var MARGIN = 0.10;          /* the asked kana passes if it is the best match, or within this of the best */
  var LIMIT = 0.72;           /* ...and not further than this from its own model */

  var HIRA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
  var HIRA_DAKU = { 'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご', 'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ',
                    'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど', 'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ' };
  var HIRA_HANDA = { 'は': 'ぱ', 'ひ': 'ぴ', 'ふ': 'ぷ', 'へ': 'ぺ', 'ほ': 'ぽ' };
  var HIRA_SMALL = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ' };
  function kata(c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); }
  function kataMap(o) { var r = {}; Object.keys(o).forEach(function (k) { r[kata(k)] = kata(o[k]); }); return r; }
  var SCRIPTS = {
    hira: { base: HIRA.split(''), daku: HIRA_DAKU, handa: HIRA_HANDA },
    kata: { base: HIRA.split('').map(kata), daku: kataMap(HIRA_DAKU), handa: kataMap(HIRA_HANDA) }
  };
  var SMALL = {}; Object.keys(HIRA_SMALL).forEach(function (k) { SMALL[k] = HIRA_SMALL[k]; SMALL[kata(k)] = kata(HIRA_SMALL[k]); });
  var SCRIPT_OF = {};
  Object.keys(SCRIPTS).forEach(function (s) {
    var sc = SCRIPTS[s];
    sc.base.forEach(function (c) { SCRIPT_OF[c] = s; });
    [sc.daku, sc.handa].forEach(function (m) { Object.keys(m).forEach(function (k) { SCRIPT_OF[m[k]] = s; }); });
  });
  function scriptOf(ch) { return SCRIPT_OF[SMALL[ch] || ch] || null; }

  function len(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy); }
  function pathLength(p) { var s = 0; for (var i = 1; i < p.length; i++) s += len(p[i - 1], p[i]); return s; }

  /* ---------- from pen strokes to short oriented pieces, stroke by stroke ---------- */
  function unitsOf(strokes) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i, j;
    for (i = 0; i < strokes.length; i++) for (j = 0; j < strokes[i].length; j++) {
      var p = strokes[i][j];
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    var diag = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    if (!(diag > 0)) diag = 1;
    var step = diag / 70, units = []; units.step = step;
    for (i = 0; i < strokes.length; i++) {
      var s = strokes[i], out = []; if (!s.length) continue;
      var L = pathLength(s);
      if (L < diag * 0.035) {               /* a dot: it has a place but no direction worth trusting */
        var cx = 0, cy = 0; for (j = 0; j < s.length; j++) { cx += s[j][0]; cy += s[j][1]; }
        out.push({ x: cx / s.length, y: cy / s.length, a: null, w: 2.5 });
        units.push(out); continue;
      }
      var n = Math.max(2, Math.round(L / step)), want = L / n, acc = 0, prev = s[0], last = s[0];
      for (j = 1; j < s.length; j++) {
        var cur = s[j], d = len(prev, cur);
        while (d > 0 && acc + d >= want) {
          var t = (want - acc) / d, q = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
          out.push({ x: (last[0] + q[0]) / 2, y: (last[1] + q[1]) / 2, a: Math.atan2(q[1] - last[1], q[0] - last[0]), w: 1 });
          last = q; prev = q; d = len(prev, cur); acc = 0;
        }
        acc += d; prev = cur;
      }
      if (len(last, s[s.length - 1]) > want * 0.3) {
        var e = s[s.length - 1];
        out.push({ x: (last[0] + e[0]) / 2, y: (last[1] + e[1]) / 2, a: Math.atan2(e[1] - last[1], e[0] - last[0]), w: len(last, e) / want });
      }
      units.push(out);
    }
    return units;
  }

  /* where the middle of a drawing is and how far it spreads: everything is measured in that frame */
  function frameOf(pieces) {
    var n = pieces.length, i, sw = 0, mx = 0, my = 0;
    for (i = 0; i < n; i++) { sw += pieces[i].w; mx += pieces[i].x * pieces[i].w; my += pieces[i].y * pieces[i].w; }
    mx /= sw; my /= sw;
    var vx = 0, vy = 0;
    for (i = 0; i < n; i++) { var ex = pieces[i].x - mx, ey = pieces[i].y - my; vx += ex * ex * pieces[i].w; vy += ey * ey * pieces[i].w; }
    vx = Math.sqrt(vx / sw); vy = Math.sqrt(vy / sw);
    /* A tall あ and a wide あ are the same letter, so each axis is scaled by its own spread; but a flat へ must not
       become as tall as it is wide, so part of the proportion is kept. */
    var big = Math.max(vx, vy) || 1, small = Math.min(vx, vy), keep = Math.pow(small / big, ASPECT);
    return { mx: mx, my: my, kx: vx >= vy ? 1 / big : (vx > 0 ? keep / vx : 0), ky: vy > vx ? 1 / big : (vy > 0 ? keep / vy : 0) };
  }

  /* ---------- the map of ink ---------- */
  function mapOf(pieces, directed) {
    var u = new Float32Array(NU), d = directed ? new Float32Array(ND) : null;
    var n = pieces.length, i;
    if (!n) return { u: u, d: d };
    var f = frameOf(pieces);
    for (i = 0; i < n; i++) {
      var p = pieces[i];
      var gx = ((p.x - f.mx) * f.kx + R) / (2 * R) * G - 0.5, gy = ((p.y - f.my) * f.ky + R) / (2 * R) * G - 0.5;
      if (gx < 0) gx = 0; if (gx > G - 1) gx = G - 1; if (gy < 0) gy = 0; if (gy > G - 1) gy = G - 1;
      var ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      var ix1 = Math.min(G - 1, ix + 1), iy1 = Math.min(G - 1, iy + 1);
      var cells = [[iy * G + ix, (1 - fx) * (1 - fy)], [iy * G + ix1, fx * (1 - fy)], [iy1 * G + ix, (1 - fx) * fy], [iy1 * G + ix1, fx * fy]];
      var ob = null, db = null;
      if (p.a !== null) {
        var o = ((p.a % Math.PI) + Math.PI) % Math.PI / (Math.PI / OB), o0 = Math.floor(o), of = o - o0;
        ob = [[o0 % OB, 1 - of], [(o0 + 1) % OB, of]];
        if (d) {
          var q = ((p.a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI / DB), q0 = Math.floor(q), qf = q - q0;
          db = [[q0 % DB, 1 - qf], [(q0 + 1) % DB, qf]];
        }
      }
      for (var c = 0; c < 4; c++) {
        var cell = cells[c][0], cw = cells[c][1] * p.w, k;
        if (!cw) continue;
        if (ob) { u[cell * OB + ob[0][0]] += cw * ob[0][1]; u[cell * OB + ob[1][0]] += cw * ob[1][1]; }
        else for (k = 0; k < OB; k++) u[cell * OB + k] += cw / OB;
        if (d) {
          if (db) { d[cell * DB + db[0][0]] += cw * db[0][1]; d[cell * DB + db[1][0]] += cw * db[1][1]; }
          else for (k = 0; k < DB; k++) d[cell * DB + k] += cw / DB;
        }
      }
    }
    return { u: finish(u, OB), d: d ? finish(d, DB) : null };
  }

  /* soften across neighbouring cells, then compress so that a little ink in a place still counts */
  function finish(v, B) {
    var out = new Float32Array(v.length), x, y, b, sum = 0, i;
    for (y = 0; y < G; y++) for (x = 0; x < G; x++) for (b = 0; b < B; b++) {
      var acc = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var yy = y + dy, xx = x + dx; if (yy < 0 || yy >= G || xx < 0 || xx >= G) continue;
        acc += v[(yy * G + xx) * B + b] * (dx ? 1 : 2) * (dy ? 1 : 2);
      }
      out[(y * G + x) * B + b] = acc / 16;
    }
    for (i = 0; i < out.length; i++) sum += out[i];
    if (!(sum > 0)) return out;
    var n2 = 0;
    for (i = 0; i < out.length; i++) { out[i] = Math.sqrt(out[i] / sum); n2 += out[i] * out[i]; }
    n2 = Math.sqrt(n2);
    for (i = 0; i < out.length; i++) out[i] /= n2;
    return out;
  }

  function gap(a, b) { var s = 0; for (var i = 0; i < a.length; i++) { var t = a[i] - b[i]; s += t * t; } return Math.sqrt(s); }
  function distance(map, maps) {
    var best = Infinity;
    for (var i = 0; i < maps.length; i++) {
      var du = gap(map.u, maps[i].u), d = du;
      if (map.d) { var dd = gap(map.d, maps[i].d); d = Math.min(du * SHAPE_ONLY, Math.sqrt((du * du + W_DIR * dd * dd) / (1 + W_DIR))); }
      if (d < best) best = d;
    }
    return best;
  }
  /* the same, separately for each way of writing the kana that the model knows: [{ d, shape, variant }] */
  function distances(map, maps, shapes) {
    var out = [], V = VARIANTS.length;
    for (var s = 0; s < shapes.length; s++) {
      var best = { d: Infinity, shape: shapes[s], variant: 0 };
      for (var v = 0; v < V; v++) {
        var m = maps[s * V + v], du = gap(map.u, m.u), d = du;
        if (map.d) { var dd = gap(map.d, m.d); d = Math.min(du * SHAPE_ONLY, Math.sqrt((du * du + W_DIR * dd * dd) / (1 + W_DIR))); }
        if (d < best.d) { best.d = d; best.variant = v; }
      }
      out.push(best);
    }
    return out;
  }

  /* ---------- the models: one per kana, in a few ordinary variations ---------- */
  var VARIANTS = [
    [1, 0, 0, 1],
    [1, 0.22, 0, 1], [1, -0.22, 0, 1],                     /* leaning right, leaning left */
    [Math.cos(0.14), -Math.sin(0.14), Math.sin(0.14), Math.cos(0.14)],
    [Math.cos(-0.14), -Math.sin(-0.14), Math.sin(-0.14), Math.cos(-0.14)]
  ];

  /* The stroke data begins many strokes with a short tick where a brush would touch down. A pen does not do that. */
  function trimEntry(m) {
    if (m.length < 3) return m;
    var a = len(m[0], m[1]), total = pathLength(m);
    if (a > 115 || a > total * 0.2) return m;
    var ux = m[1][0] - m[0][0], uy = m[1][1] - m[0][1], vx = m[2][0] - m[1][0], vy = m[2][1] - m[1][1];
    var lv = Math.sqrt(vx * vx + vy * vy) || 1, cos = (ux * vx + uy * vy) / ((Math.sqrt(ux * ux + uy * uy) || 1) * lv);
    if (cos > 0.94) return m;                                   /* already straight */
    if (cos < 0.5) return m.slice(1);                           /* a real tick: drop it */
    var out = m.slice(); out[0] = [m[1][0] - vx / lv * a, m[1][1] - vy / lv * a];   /* a slight bend: straighten it */
    return out;
  }

  /* round the few points of a stroke into a curve, but keep real corners sharp */
  function smooth(m) {
    if (m.length < 3) return m.slice();
    var runs = [[m[0]]], i;
    for (i = 1; i < m.length - 1; i++) {
      var ux = m[i][0] - m[i - 1][0], uy = m[i][1] - m[i - 1][1], vx = m[i + 1][0] - m[i][0], vy = m[i + 1][1] - m[i][1];
      var cos = (ux * vx + uy * vy) / ((Math.sqrt(ux * ux + uy * uy) || 1) * (Math.sqrt(vx * vx + vy * vy) || 1));
      runs[runs.length - 1].push(m[i]);
      if (cos < 0.5) runs.push([m[i]]);
    }
    runs[runs.length - 1].push(m[m.length - 1]);
    var out = [m[0]];
    runs.forEach(function (r) {
      for (var k = 0; k < r.length - 1; k++) {
        var p0 = r[Math.max(0, k - 1)], p1 = r[k], p2 = r[k + 1], p3 = r[Math.min(r.length - 1, k + 2)];
        for (var s = 1; s <= 6; s++) {
          var t = s / 6, t2 = t * t, t3 = t2 * t;
          out.push([
            0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3)]);
        }
      }
    });
    return out;
  }

  /* medians: the strokes of one kana as in data/kana-strokes.json (y grows upward there) */
  function modelStrokes(medians) {
    return medians.map(function (m) {
      return smooth(trimEntry(m.map(function (p) { return [p[0], 900 - p[1]]; })));
    });
  }

  function variantUnits(strokes, v) {
    var t = VARIANTS[v];
    return unitsOf(strokes.map(function (s) { return s.map(function (p) { return [t[0] * p[0] + t[1] * p[1], t[2] * p[0] + t[3] * p[1]]; }); }));
  }
  function variantMaps(strokes) {
    return VARIANTS.map(function (t, v) { return mapOf([].concat.apply([], variantUnits(strokes, v)), true); });
  }

  /* strokeData: { 'あ': { medians: [...] }, ... } as the page keeps it.
   * more (optional): { 'あ': [[[x, y], ...], ...], ... } a second way of writing each kana, y growing downward. */
  function build(strokeData, more) {
    var model = { maps: {}, shapes: {}, count: {} };
    Object.keys(SCRIPT_OF).forEach(function (ch) {
      var shapes = [], rec = strokeData && strokeData[ch];
      if (rec && rec.medians) { shapes.push(modelStrokes(rec.medians)); model.count[ch] = rec.medians.length; }
      if (more && more[ch]) { shapes.push(more[ch]); if (!model.count[ch]) model.count[ch] = more[ch].length; }
      if (!shapes.length) return;
      model.shapes[ch] = shapes;
      model.maps[ch] = [].concat.apply([], shapes.map(variantMaps));
    });
    return model;
  }

  /* ---------- looking for ゛ and ゜ ---------- */
  function boxOf(pieces) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0, w: 0, cx: 0, cy: 0 };
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (p.x < b.x0) b.x0 = p.x; if (p.x > b.x1) b.x1 = p.x; if (p.y < b.y0) b.y0 = p.y; if (p.y > b.y1) b.y1 = p.y;
      b.cx += p.x * p.w; b.cy += p.y * p.w; b.w += p.w; b.n++;
    }
    if (b.w) { b.cx /= b.w; b.cy /= b.w; }
    b.diag = Math.sqrt((b.x1 - b.x0) * (b.x1 - b.x0) + (b.y1 - b.y0) * (b.y1 - b.y0));
    return b;
  }
  /* a ring has ink on every side of its middle; a tick has it on two */
  function isRing(pieces, b) {
    if (pieces.length < 8) return false;
    var mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2, r = b.diag / 2 || 1, seen = {}, n = 0;
    if (Math.min(b.x1 - b.x0, b.y1 - b.y0) < 0.45 * Math.max(b.x1 - b.x0, b.y1 - b.y0)) return false;
    for (var i = 0; i < pieces.length; i++) {
      var dx = pieces[i].x - mx, dy = pieces[i].y - my;
      if (Math.sqrt(dx * dx + dy * dy) < 0.3 * r) continue;
      var s = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4)) % 8;
      if (!seen[s]) { seen[s] = 1; n++; }
    }
    return n >= 7;
  }
  /* which strokes could be a mark, and what is left when they are taken away */
  function markReadings(units) {
    var all = [].concat.apply([], units), whole = boxOf(all), out = [], i, j;
    if (units.length < 2) return out;
    var step = units.step || 1;
    var info = units.map(function (u) {
      var b = boxOf(u); b.small = b.diag <= MARK_SMALL * whole.diag; b.ring = b.small && isRing(u, b);
      /* a tick is about as long as it is wide; two ticks run together, or a ring left open, are a good deal longer */
      b.squiggle = b.small && !b.ring && b.w * step > 1.6 * Math.max(b.diag, 4 * step);
      return b;
    });
    function rest(skip) { var r = []; for (var k = 0; k < units.length; k++) if (skip.indexOf(k) < 0) r.push(units[k]); return r; }
    function placed(cx, cy, others) {
      var rb = boxOf([].concat.apply([], others)), h = rb.y1 - rb.y0, w = rb.x1 - rb.x0, size = Math.max(w, h) || 1;
      return cx > (rb.x0 + rb.x1) / 2 + MARK_RIGHT * size && cy < (rb.y0 + rb.y1) / 2 + 0.2 * size;
    }
    for (i = 0; i < units.length; i++) {
      if (!info[i].small) continue;
      var r1 = rest([i]);
      if (r1.length && (info[i].ring || info[i].squiggle) && placed(info[i].cx, info[i].cy, r1)) out.push({ kind: info[i].ring ? 'handa' : 'weak', units: r1 });
      if (info[i].ring) continue;
      for (j = i + 1; j < units.length; j++) {
        if (!info[j].small || info[j].ring) continue;
        var dx = info[i].cx - info[j].cx, dy = info[i].cy - info[j].cy;
        if (Math.sqrt(dx * dx + dy * dy) > 0.3 * whole.diag) continue;
        var r2 = rest([i, j]);
        if (r2.length && placed((info[i].cx + info[j].cx) / 2, (info[i].cy + info[j].cy) / 2, r2)) out.push({ kind: 'daku', units: r2 });
      }
    }
    return out;
  }

  /* ---------- how far the drawing is from each kana of one script, nearest first ---------- */
  function rankUnits(model, script, units, directed) {
    var sc = SCRIPTS[script], all = [].concat.apply([], units), whole = mapOf(all, directed);
    var readings = markReadings(units).map(function (r) { return { kind: r.kind, units: r.units, map: mapOf([].concat.apply([], r.units), directed) }; });
    var list = [];
    sc.base.forEach(function (ch) {
      if (!model.maps[ch]) return;
      var plain = { ch: ch, d: distance(whole, model.maps[ch]), as: ch, units: units, map: whole }; plain.d0 = plain.d;
      list.push(plain);
      var seen = 0;
      [['daku', sc.daku[ch]], ['handa', sc.handa[ch]]].forEach(function (v) {
        if (!v[1]) return;
        var best = { ch: v[1], d: Infinity };
        /* without pen strokes (a printed letter, say) the marks may have run into the rest: then compare the whole thing */
        if (!directed && model.maps[v[1]]) { best = { ch: v[1], d0: distance(whole, model.maps[v[1]]), as: v[1], units: units, map: whole }; best.d = best.d0 + WHOLE_MARK; }
        readings.forEach(function (r) {
          if (r.kind !== v[0] && r.kind !== 'weak') return;
          var d0 = distance(r.map, model.maps[ch]), d = d0 + (r.kind === 'weak' ? WEAK_MARK : 0);
          if (d < best.d) best = { ch: v[1], d: d, d0: d0, as: ch, units: r.units, map: r.map };
          /* marks were drawn, and what is left fits the plain kana about as well as the whole drawing does:
             then the drawing is the voiced kana, and the plain one is handicapped */
          if (d0 <= plain.d0 + 0.06) seen = Math.max(seen, r.kind === 'weak' ? MARK_SEEN / 2 : MARK_SEEN);
        });
        list.push(best);
      });
      plain.d += seen;
    });
    list.sort(function (a, b) { return a.d - b.d; });
    return list;
  }
  function rank(model, script, strokes) { return rankUnits(model, script, unitsOf(strokes), true); }

  function oneGap(map, m) {
    var du = gap(map.u, m.u);
    if (!map.d) return du;
    var dd = gap(map.d, m.d);
    return Math.min(du * SHAPE_ONLY, Math.sqrt((du * du + W_DIR * dd * dd) / (1 + W_DIR)));
  }
  /* Is every stroke of the kana there? Asked this way: does the drawing look more like the kana with one of its
   * strokes left out than like the whole kana? Returns the smallest ratio found (well below 1: a stroke is missing). */
  function partRatio(model, entry) {
    var shapes = model.shapes[entry.as], ds = distances(entry.map, model.maps[entry.as], shapes), best = 0, any = false;
    model.parts = model.parts || {};
    ds.forEach(function (way, si) {
      if (way.d > entry.d0 + 0.12 && any) return;
      var key = entry.as + '/' + si + '/' + way.variant, parts = model.parts[key];
      if (!parts) {
        var units = variantUnits(way.shape, way.variant);
        parts = model.parts[key] = units.length < 2 ? [] : units.map(function (u, i) {
          return mapOf([].concat.apply([], units.filter(function (x, j) { return j !== i; })), true);
        });
      }
      var worst = Infinity;
      parts.forEach(function (m) { var r = oneGap(entry.map, m) / (way.d || 1e-6); if (r < worst) worst = r; });
      if (worst > best) best = worst; any = true;
    });
    return best;
  }

  /* And the other way round: is there a stroke that does not belong? Returns the smallest ratio found between the
   * drawing-without-one-stroke and the whole drawing (well below 1: that stroke is one too many). */
  function extraRatio(model, entry) {
    var units = entry.units, worst = 1;
    if (!units || units.length < 2 || !(entry.d0 > 0)) return 1;
    for (var i = 0; i < units.length; i++) {
      var restPieces = [].concat.apply([], units.filter(function (x, j) { return j !== i; }));
      if (!restPieces.length) continue;
      var r = distance(mapOf(restPieces, !!entry.map.d), model.maps[entry.as]) / entry.d0;
      if (r < worst) worst = r;
    }
    return worst;
  }

  function judgeRanked(model, list, target) {
    var mine = null, other = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].ch === target) mine = list[i]; else if (!other) other = list[i];
    }
    if (!mine || !mine.map) return mine ? { ok: false, near: false, target: target, distance: mine.d, looksLike: list[0].ch, bestDistance: list[0].d } : null;
    var near = mine.d <= LIMIT && (!other || mine.d <= other.d * (1 + MARGIN));
    var part = near ? partRatio(model, mine) : 0, extra = near ? extraRatio(model, mine) : 1;
    var complete = part >= PART, clean = extra >= EXTRA;
    return {
      ok: near && complete && clean, near: near, complete: complete, clean: clean, part: part, extra: extra,
      target: target, distance: mine.d,
      looksLike: list[0].ch, bestDistance: list[0].d, nextBest: other ? other.ch : null, nextDistance: other ? other.d : null
    };
  }

  /* Is this drawing the kana that was asked for?
   * strokes: [[[x, y], ...], ...] in screen coordinates (y grows downward). */
  function check(model, target, strokes) {
    var ch = SMALL[target] || target, script = scriptOf(ch);
    var ink = (strokes || []).filter(function (s) { return s && s.length; });
    if (!script || !ink.length || !model.maps[ch]) return null;
    var res = judgeRanked(model, rank(model, script, ink), ch);
    if (res) { res.strokes = ink.length; res.expected = model.count[ch] || null; }
    return res;
  }

  return {
    build: build, check: check, rank: rank, scriptOf: scriptOf,
    _: { unitsOf: unitsOf, mapOf: mapOf, rankUnits: rankUnits, judgeRanked: judgeRanked, modelStrokes: modelStrokes, markReadings: markReadings, frameOf: frameOf, SCRIPTS: SCRIPTS, SMALL: SMALL,
         set: function (o) {
           if (o.W_DIR != null) W_DIR = o.W_DIR; if (o.ASPECT != null) ASPECT = o.ASPECT; if (o.R != null) R = o.R; if (o.SHAPE_ONLY != null) SHAPE_ONLY = o.SHAPE_ONLY;
           if (o.MARGIN != null) MARGIN = o.MARGIN; if (o.LIMIT != null) LIMIT = o.LIMIT; if (o.VARIANTS) VARIANTS = o.VARIANTS;
           if (o.MARK_SMALL != null) MARK_SMALL = o.MARK_SMALL; if (o.PART != null) PART = o.PART; if (o.EXTRA != null) EXTRA = o.EXTRA; if (o.MARK_SEEN != null) MARK_SEEN = o.MARK_SEEN; if (o.MARK_RIGHT != null) MARK_RIGHT = o.MARK_RIGHT; if (o.WEAK_MARK != null) WEAK_MARK = o.WEAK_MARK; if (o.WHOLE_MARK != null) WHOLE_MARK = o.WHOLE_MARK;
         } }
  };
});
