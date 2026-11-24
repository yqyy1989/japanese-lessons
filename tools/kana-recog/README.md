# Testing the kana handwriting check

`public/recog.js` decides whether what the child wrote in a box is the kana that was asked for. It does not follow
her stroke by stroke. It looks at the finished drawing: where the ink is and which way it runs, wherever in the box
it was written and however large. The comments at the top of that file explain the method.

This folder holds what was used to measure it. Nothing here is needed by the site itself.

## Test handwriting

No recordings of real children's handwriting were available, so the check was measured on three stand-ins:

- **Typefaces** (15, several of them imitating handwriting): each kana is drawn, thinned to a one-pixel skeleton and
  given to the check as a shape without pen strokes. Fonts from https://github.com/google/fonts (`ofl/` folder) plus
  IPA Gothic. They are test material only.
- **KanjiVG pen strokes**, checked against a model built from the site's own stroke data alone.
- **The site's stroke data**, checked against a model built from KanjiVG alone.

The pen strokes are also bent on purpose: slanted, squeezed, turned, each stroke shifted and resized, written in
another order, written backwards, two strokes joined, the whole thing moved and scaled at random.

```
git clone --depth 1 --filter=blob:none --sparse https://github.com/google/fonts && (cd fonts && git sparse-checkout set ofl/yomogi ofl/zenkurenaido ofl/kleeone ofl/hachimarupop ofl/yuseimagic ofl/darumadropone ofl/kiwimaru ofl/zenmarugothic ofl/mplusrounded1c ofl/sawarabigothic ofl/sawarabimincho ofl/kaiseiopti ofl/shipporimincho ofl/zenkakugothicnew)
git clone --depth 1 https://github.com/KanjiVG/kanjivg
mkdir -p tools/kana-recog/data
python3 tools/kana-recog/make_samples.py fonts kanjivg/kanji tools/kana-recog/data
node tools/kana-recog/eval.js '{"tpl":"shipped"}'
```

## Results on 2026-11-23

| test | accepted |
|---|---|
| pen strokes as written (284) | 100% |
| a little uneven (1704) | 100% |
| sloppy (1704) | 99.6% |
| very sloppy (1704) | 97.8% |
| sloppy, own stroke order, some strokes backwards or joined (1704) | 91.1% |
| every stroke written backwards (1704) | 100% |
| 15 typefaces, shape only (2130) | 96.8% |
| **must not pass:** one stroke left out (808) | 0.4% |
| **must not pass:** a long extra line across the kana (540) | 9.1% |
| **must not pass:** a scribble (800) | 0.5% |

A drawing of one kana would also have passed as a different kana in about 1 in 80 cases when a little uneven and
1 in 30 when sloppy; these are the pairs people also mix up (さ/き, は/ほ, シ/ン, ソ/ン, ぎ/ざ).

The numbers move by a point or two at most when any one setting in `recog.js` is nudged up or down, which is a sign
that they are not an accident of tuning. They still say nothing certain about a real child writing with a finger on
a tablet: that has not been measured. For that reason the page lets her, or a parent, overrule a "not right" verdict.
