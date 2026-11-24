#!/usr/bin/env python3
"""Make public/data/kana-shapes.json: a second way of writing each plain kana, for the handwriting check.

The page compares what the child draws with the stroke shapes it knows. One set of shapes comes from the site's own
stroke data (data/kana-strokes.json). This script adds a second, independently drawn set, taken from KanjiVG, so that
two ordinary ways of writing each kana are known.

KanjiVG is copyright Ulrich Apel and released under the Creative Commons Attribution-Share Alike 3.0 licence
(https://creativecommons.org/licenses/by-sa/3.0/). The file written here is an adaptation of it and carries the
same licence.

usage:
    git clone --depth 1 https://github.com/KanjiVG/kanjivg
    python3 tools/kana-shapes/build.py kanjivg/kanji public/data/kana-shapes.json
"""
import json, math, os, re, sys

HIRA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
KANA = HIRA + "".join(chr(ord(c) + 0x60) for c in HIRA)
TOK = re.compile(r'([MmCcSsLl])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)')


def path_points(d, per=12):
    """Points along an SVG path made of moves, lines and cubic curves (all that KanjiVG uses for kana)."""
    toks = [(m.group(1), m.group(2)) for m in TOK.finditer(d)]
    i, cmd, cur, last_c2, pts = 0, None, (0.0, 0.0), None, []

    def num():
        nonlocal i
        v = float(toks[i][1]); i += 1
        return v

    while i < len(toks):
        if toks[i][0]:
            cmd = toks[i][0]; i += 1
        if cmd in 'Mm':
            x, y = num(), num()
            cur = (cur[0] + x, cur[1] + y) if cmd == 'm' and pts else (x, y)
            pts.append(cur); last_c2 = None
            cmd = 'l' if cmd == 'm' else 'L'
        elif cmd in 'Ll':
            x, y = num(), num()
            cur = (cur[0] + x, cur[1] + y) if cmd == 'l' else (x, y)
            pts.append(cur); last_c2 = None
        else:
            rel = cmd.islower()
            if cmd in 'Cc':
                c1 = (num(), num())
                if rel: c1 = (cur[0] + c1[0], cur[1] + c1[1])
            else:
                c1 = (2 * cur[0] - last_c2[0], 2 * cur[1] - last_c2[1]) if last_c2 else cur
            c2, e = (num(), num()), (num(), num())
            if rel:
                c2 = (cur[0] + c2[0], cur[1] + c2[1]); e = (cur[0] + e[0], cur[1] + e[1])
            for k in range(1, per + 1):
                t = k / per
                a, b, c, dd = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                pts.append((a * cur[0] + b * c1[0] + c * c2[0] + dd * e[0], a * cur[1] + b * c1[1] + c * c2[1] + dd * e[1]))
            cur, last_c2 = e, c2
    return pts


def thin(pts, tol):
    """Drop points that lie within tol of the line through their neighbours (Douglas-Peucker)."""
    if len(pts) < 3: return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    L = math.hypot(x1 - x0, y1 - y0) or 1e-9
    far, at = 0, 0
    for k in range(1, len(pts) - 1):
        d = abs((x1 - x0) * (y0 - pts[k][1]) - (x0 - pts[k][0]) * (y1 - y0)) / L if L > 1e-6 else math.hypot(pts[k][0] - x0, pts[k][1] - y0)
        if d > far: far, at = d, k
    if far <= tol: return [pts[0], pts[-1]]
    return thin(pts[:at + 1], tol)[:-1] + thin(pts[at:], tol)


def main(src, out):
    shapes = {}
    for ch in KANA:
        svg = open(os.path.join(src, '%05x.svg' % ord(ch)), encoding='utf-8').read()
        body = svg[svg.index('StrokePaths'):svg.index('StrokeNumbers')]
        strokes = [path_points(d) for d in re.findall(r'<path[^>]*\sd="([^"]+)"', body)]
        if not strokes: raise SystemExit('no strokes found for ' + ch)
        # KanjiVG draws in a box of 109 units; keep one decimal's worth as whole numbers
        shapes[ch] = [[[round(x * 10), round(y * 10)] for x, y in thin(s, 0.35)] for s in strokes]
    doc = {
        'v': 1,
        'about': 'Stroke shapes of the 92 plain kana, adapted (resampled and rounded) from KanjiVG. Units: a box of 1090; y grows downward.',
        'source': 'KanjiVG, copyright Ulrich Apel, https://kanjivg.tagaini.net/',
        'licence': 'Creative Commons Attribution-Share Alike 3.0, https://creativecommons.org/licenses/by-sa/3.0/',
        'shapes': shapes,
    }
    text = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
    open(out, 'w', encoding='utf-8').write(text + '\n')
    print('%d kana, %d strokes, %d points, %d bytes' % (len(shapes), sum(len(s) for s in shapes.values()), sum(len(p) for s in shapes.values() for p in s), len(text.encode('utf-8'))))


if __name__ == '__main__':
    if len(sys.argv) != 3: raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
