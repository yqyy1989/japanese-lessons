"""Build test handwriting for the kana handwriting check from sources other than the site's own stroke data.

  fonts   -> skeleton points with a local orientation (shape only, no stroke order or direction),
             grouped by connected part so that voicing marks can be told from the rest
  kanjivg -> pen strokes in writing order

The fonts are test material only; nothing made from them is put on the site.

usage: python3 make_samples.py <google/fonts checkout> <kanjivg/kanji dir> <out dir>      (see README.md)
needs: numpy, pillow, fonttools, scikit-image
"""
import sys, os, re, json, math, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from skimage.morphology import skeletonize
from skimage.measure import label

HIRA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ"
KATA = "".join(chr(ord(c) + 0x60) for c in HIRA)
ALL = HIRA + KATA

FONTS = [
    ('yomogi', 'ofl/yomogi/Yomogi-Regular.ttf'),
    ('zenkurenaido', 'ofl/zenkurenaido/ZenKurenaido-Regular.ttf'),
    ('kleeone', 'ofl/kleeone/KleeOne-Regular.ttf'),
    ('hachimarupop', 'ofl/hachimarupop/HachiMaruPop-Regular.ttf'),
    ('yuseimagic', 'ofl/yuseimagic/YuseiMagic-Regular.ttf'),
    ('darumadrop', 'ofl/darumadropone/DarumadropOne-Regular.ttf'),
    ('kiwimaru', 'ofl/kiwimaru/KiwiMaru-Light.ttf'),
    ('zenmaru', 'ofl/zenmarugothic/ZenMaruGothic-Light.ttf'),
    ('mplusround', 'ofl/mplusrounded1c/MPLUSRounded1c-Light.ttf'),
    ('sawarabigothic', 'ofl/sawarabigothic/SawarabiGothic-Regular.ttf'),
    ('sawarabimincho', 'ofl/sawarabimincho/SawarabiMincho-Regular.ttf'),
    ('kaiseiopti', 'ofl/kaiseiopti/KaiseiOpti-Regular.ttf'),
    ('shippori', 'ofl/shipporimincho/ShipporiMincho-Regular.ttf'),
    ('zenkaku', 'ofl/zenkakugothicnew/ZenKakuGothicNew-Light.ttf'),
]

def skeleton_points(font, ch, size=220, canvas=320):
    im = Image.new('L', (canvas, canvas), 0)
    dr = ImageDraw.Draw(im)
    box = dr.textbbox((0, 0), ch, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    if w <= 0 or h <= 0: return None
    dr.text(((canvas - w) / 2 - box[0], (canvas - h) / 2 - box[1]), ch, font=font, fill=255)
    a = np.array(im) > 110
    if a.sum() < 40: return None
    sk = skeletonize(a)
    lab = label(sk, connectivity=2)
    ys, xs = np.nonzero(sk)
    pts = np.stack([xs, ys], 1).astype(float)
    labs = lab[ys, xs]
    if len(pts) < 6: return None
    out = []
    # local orientation: principal axis of the skeleton pixels within a small radius
    for i in range(0, len(pts)):
        p = pts[i]
        near = pts[(np.abs(pts - p).max(1) <= 5) & (labs == labs[i])]
        if len(near) < 4:
            out.append([int(p[0]), int(p[1]), None, int(lab[int(p[1]), int(p[0])])]); continue
        c = near - near.mean(0)
        cov = c.T @ c
        vals, vecs = np.linalg.eigh(cov)
        v = vecs[:, 1]
        out.append([int(p[0]), int(p[1]), round(float(math.atan2(v[1], v[0]) % math.pi), 2), int(lab[int(p[1]), int(p[0])])])
    return out

def font_samples(root):
    res = []
    for name, rel in FONTS:
        path = os.path.join(root, rel)
        if not os.path.exists(path): print('missing font', rel); continue
        cmap = TTFont(path, lazy=True).getBestCmap()
        font = ImageFont.truetype(path, 220)
        n = 0
        for ch in ALL:
            if ord(ch) not in cmap: continue
            pts = skeleton_points(font, ch)
            if pts: res.append({'src': name, 'ch': ch, 'pts': pts}); n += 1
        print('%-16s %d glyphs' % (name, n))
    for name, path in (('ipagothic', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'),):
        if os.path.exists(path):
            font = ImageFont.truetype(path, 220); n = 0
            for ch in ALL:
                pts = skeleton_points(font, ch)
                if pts: res.append({'src': name, 'ch': ch, 'pts': pts}); n += 1
            print('%-16s %d glyphs' % (name, n))
    return res

# ---------------------------------------------------------------- KanjiVG
TOK = re.compile(r'([MmCcSsLlHhVvZzQqTt])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)')
def path_points(d, per=12):
    toks = [(m.group(1), m.group(2)) for m in TOK.finditer(d)]
    i = 0; cmd = None; cur = (0.0, 0.0); start = None; last_c2 = None; pts = []
    def num():
        nonlocal i
        v = float(toks[i][1]); i += 1; return v
    while i < len(toks):
        if toks[i][0]: cmd = toks[i][0]; i += 1
        if cmd in 'Mm':
            x, y = num(), num()
            cur = (cur[0] + x, cur[1] + y) if cmd == 'm' and pts else (x, y)
            pts.append(cur); last_c2 = None
            cmd = 'l' if cmd == 'm' else 'L'
        elif cmd in 'Ll':
            x, y = num(), num()
            cur = (cur[0] + x, cur[1] + y) if cmd == 'l' else (x, y)
            pts.append(cur); last_c2 = None
        elif cmd in 'CcSs':
            rel = cmd.islower()
            if cmd in 'Cc':
                c1 = (num(), num())
                if rel: c1 = (cur[0] + c1[0], cur[1] + c1[1])
            else:
                c1 = (2 * cur[0] - last_c2[0], 2 * cur[1] - last_c2[1]) if last_c2 else cur
            c2 = (num(), num()); e = (num(), num())
            if rel: c2 = (cur[0] + c2[0], cur[1] + c2[1]); e = (cur[0] + e[0], cur[1] + e[1])
            for k in range(1, per + 1):
                t = k / per; a = (1 - t) ** 3; b = 3 * (1 - t) ** 2 * t; c = 3 * (1 - t) * t * t; dd = t ** 3
                pts.append((a * cur[0] + b * c1[0] + c * c2[0] + dd * e[0], a * cur[1] + b * c1[1] + c * c2[1] + dd * e[1]))
            cur = e; last_c2 = c2
        else:
            raise ValueError('path command ' + cmd)
    return [[round(x, 2), round(y, 2)] for x, y in pts]

def kanjivg_samples(root):
    res = []
    for ch in ALL:
        f = os.path.join(root, '%05x.svg' % ord(ch))
        if not os.path.exists(f): print('no kanjivg file for', ch); continue
        svg = open(f, encoding='utf-8').read()
        body = svg[svg.index('StrokePaths'):svg.index('StrokeNumbers')]
        ds = re.findall(r'<path[^>]*\sd="([^"]+)"', body)
        res.append({'src': 'kanjivg', 'ch': ch, 'strokes': [path_points(d) for d in ds]})
    print('kanjivg          %d kana' % len(res))
    return res

if __name__ == '__main__':
    fonts, kvg, out = sys.argv[1:4]
    json.dump(kanjivg_samples(kvg), open(os.path.join(out, 'kanjivg.json'), 'w'), ensure_ascii=False)
    json.dump(font_samples(fonts), open(os.path.join(out, 'fonts.json'), 'w'), ensure_ascii=False)
