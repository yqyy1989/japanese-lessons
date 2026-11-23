#!/usr/bin/env python3
"""Make the spoken clips for the words and sentences in the lessons.

    python3 tools/say-audio/build.py            # make clips that are missing
    python3 tools/say-audio/build.py --check    # only list what is missing, make nothing
    python3 tools/say-audio/build.py --redo "かお" "あかい かき"   # make these again

What it does
  1. Reads every lesson in public/lessons/ and collects the texts the page can speak:
     words[].jp, phrases[].jp (or their "say"), and quiz[].say.
     A single kana (あ, きゃ ...) is skipped: those play the recordings in public/audio/kana/.
  2. For each text with no clip yet, asks the VOICEVOX engine to speak it with the voice
     四国めたん (ノーマル). If the word or phrase has a "tts" field (the same words written the
     usual way, with kanji: "あかい かき" -> "赤い柿"), that is what the engine is given, so that
     it finds the word in its dictionary and gets the pitch accent right. The engine's reading
     is compared with the lesson's kana; if they differ, the kana is used instead.
  3. Trims and levels the result, saves it as public/audio/say/<name>.mp3 and adds it to
     public/audio/say/index.json, which the page reads.

The first run downloads the engine (about 100 MB, from GitHub) into ~/.cache/say-audio.
Needs: python 3.10+, pip, git, ffmpeg. Licence and credit: public/audio/say/LICENSE.txt.
"""
import argparse, array, glob, hashlib, io, json, os, re, shutil, subprocess, sys, tarfile, urllib.request, wave

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LESSONS = os.path.join(ROOT, 'public', 'lessons')
OUT = os.path.join(ROOT, 'public', 'audio', 'say')
CACHE = os.environ.get('SAY_AUDIO_CACHE') or os.path.join(os.path.expanduser('~'), '.cache', 'say-audio')

VOICE = 'VOICEVOX:四国めたん'
STYLE_ID = 2          # 四国めたん ノーマル, in 0.vvm
SPEED = 0.88          # a little slower than the engine's normal pace, for a beginner
CORE = '0.17.1'
FILES = {
    'core.whl': ('https://github.com/VOICEVOX/voicevox_core/releases/download/0.17.1/voicevox_core-0.17.1-cp310-abi3-manylinux_2_34_x86_64.whl',
                 '82f50527485c938381fb42c5959b0ae0decb8f6d6885ca8cf408ca0762f47013'),
    'ort.tgz': ('https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.23.2/voicevox_onnxruntime-linux-x64-1.23.2.tgz',
                '0860cfbd5a80201b1bf95cae13ca2db8dc01f32f5674cc8193146047a9212fdb'),
    'dict.tgz': ('https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz',
                 'fe6ba0e43542cef98339abdffd903e062008ea170b04e7e2a35da805902f382a'),
}
VVM_REPO, VVM_TAG, VVM_PATH = 'https://github.com/VOICEVOX/voicevox_vvm', '0.17.1', 'vvms/0.vvm'
VVM_SHA = 'ecd35374d4182cd883cba5040376f7f888cc6ba248b1c2f4cea07cdb34bb1318'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch(name):
    url, want = FILES[name]
    path = os.path.join(CACHE, name)
    if not (os.path.exists(path) and sha256(path) == want):
        print('  downloading', url.rsplit('/', 1)[-1], flush=True)
        with urllib.request.urlopen(url, timeout=300) as r, open(path + '.part', 'wb') as f:
            shutil.copyfileobj(r, f)
        os.replace(path + '.part', path)
    got = sha256(path)
    if got != want:
        raise SystemExit('checksum of %s is %s, expected %s: not using it' % (name, got, want))
    return path


def setup():
    """Download the engine once, check every file against its known checksum, and return a ready synthesizer."""
    os.makedirs(CACHE, exist_ok=True)
    py = os.path.join(CACHE, 'py')
    if not os.path.isdir(os.path.join(py, 'voicevox_core')):
        whl = fetch('core.whl')
        named = os.path.join(CACHE, FILES['core.whl'][0].rsplit('/', 1)[-1])
        shutil.copyfile(whl, named)
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '--no-deps', '--target', py, named], check=True)
    for name, marker in (('ort.tgz', 'ort'), ('dict.tgz', 'dict')):
        dst = os.path.join(CACHE, marker)
        if not os.path.isdir(dst):
            with tarfile.open(fetch(name)) as t:
                try:
                    t.extractall(dst + '.part', filter='data')
                except TypeError:            # python older than 3.12
                    t.extractall(dst + '.part')
            os.replace(dst + '.part', dst)
    vvm_dir = os.path.join(CACHE, 'vvm')
    vvm = os.path.join(vvm_dir, VVM_PATH)
    if not (os.path.exists(vvm) and sha256(vvm) == VVM_SHA):
        print('  downloading the voice model', flush=True)
        shutil.rmtree(vvm_dir, ignore_errors=True)
        subprocess.run(['git', '-c', 'advice.detachedHead=false', 'clone', '-q', '--depth', '1', '--branch', VVM_TAG, '--filter=blob:none', '--sparse', VVM_REPO, vvm_dir], check=True)
        subprocess.run(['git', '-C', vvm_dir, 'sparse-checkout', 'set', '--no-cone', '/' + VVM_PATH, '/TERMS.txt'], check=True)
    if sha256(vvm) != VVM_SHA:
        raise SystemExit('checksum of the voice model does not match: not using it')
    sys.path.insert(0, py)
    from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile
    lib = glob.glob(os.path.join(CACHE, 'ort', '**', 'lib', Onnxruntime.LIB_RECOMMENDED_VERSIONED_FILENAME), recursive=True)
    dic = glob.glob(os.path.join(CACHE, 'dict', 'open_jtalk_dic_utf_8-*'))
    if not lib or not dic:
        raise SystemExit('engine files are incomplete in ' + CACHE)
    syn = Synthesizer(Onnxruntime.load_once(filename=lib[0]), OpenJtalk(dic[0]))
    with VoiceModelFile.open(vvm) as m:
        syn.load_voice_model(m)
    return syn


# ---------- which texts need a clip ----------
def is_single_kana(text):
    t = re.sub(r'[。.\s]+$', '', text)
    kana = lambda c: 'ぁ' <= c <= 'ゖ' or 'ァ' <= c <= 'ヺ'
    return (len(t) == 1 and kana(t)) or (len(t) == 2 and kana(t[0]) and t[1] in 'ゃゅょャュョ')


def collect():
    """{text the page speaks: text to hand to the engine}, in lesson order."""
    with open(os.path.join(LESSONS, 'index.json'), encoding='utf-8') as f:
        dates = [l['date'] for l in json.load(f)['lessons']]
    wanted = {}
    for d in dates:
        path = os.path.join(LESSONS, d + '.json')
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            lesson = json.load(f)
        for w in (lesson.get('words') or []) + (lesson.get('phrases') or []):
            key = (w.get('say') or w.get('jp') or '').strip()
            if key and not is_single_kana(key) and (key not in wanted or wanted[key] == key):
                wanted[key] = (w.get('tts') or '').strip() or key
        for q in lesson.get('quiz') or []:
            key = (q.get('say') or '').strip()
            if key and not is_single_kana(key):
                wanted.setdefault(key, key)
    return wanted


# ---------- does the engine read it the way the lesson writes it? ----------
ROWS = {'ア': 'アカサタナハマヤラワガザダバパァャ', 'イ': 'イキシチニヒミリギジヂビピィ', 'ウ': 'ウクスツヌフムユルグズヅブプゥュヴ',
        'エ': 'エケセテネヘメレゲゼデベペェ', 'オ': 'オコソトノホモヨロヲゴゾドボポォョ'}
VOWEL = {c: v for v, cs in ROWS.items() for c in cs}


def norm(s):
    """Katakana only, long vowels spelled out, so that 'トケー', 'トケエ' and 'とけい' all compare equal."""
    s = ''.join(chr(ord(c) + 0x60) if 'ぁ' <= c <= 'ゖ' else c for c in s)
    s = re.sub(r'[^ァ-ヺー]', '', s).replace('ヲ', 'オ').replace('ヂ', 'ジ').replace('ヅ', 'ズ')
    out = []
    for c in s:
        prev = VOWEL.get(out[-1]) if out else None
        if c == 'ー' and prev:
            c = prev
        elif c == 'ウ' and prev == 'オ':
            c = 'オ'
        elif c == 'イ' and prev == 'エ':
            c = 'エ'
        out.append(c)
    return ''.join(out)


def reading(query):
    return ''.join(m.text for p in query.accent_phrases for m in p.moras)


# ---------- audio clean-up, plain python ----------
def tidy(wav_bytes):
    """Cut the silence at both ends, bring every clip to the same loudness, add a short lead-in and tail."""
    with wave.open(io.BytesIO(wav_bytes)) as w:
        sr, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError('expected 16-bit audio')
    x = array.array('h'); x.frombytes(raw)
    if ch == 2:
        x = array.array('h', [(x[i] + x[i + 1]) // 2 for i in range(0, len(x) - 1, 2)])
    n = sr // 100                                   # 10 ms frames
    energy = [sum(v * v for v in x[i:i + n]) / n for i in range(0, len(x) - n + 1, n)]
    top = max(energy) or 1.0
    loud = [i for i, e in enumerate(energy) if e > top * 10 ** (-45 / 10)]
    a, b = max(0, loud[0] - 2) * n, min(len(energy), loud[-1] + 6) * n
    seg = [float(v) for v in x[a:b]]
    active = [e for e in energy[loud[0]:loud[-1] + 1] if e > top * 10 ** (-20 / 10)]
    rms = (sum(active) / len(active)) ** 0.5
    gain = 32767 * 10 ** (-20 / 20) / rms
    peak = max(abs(v) for v in seg) * gain
    if peak > 32767 * 10 ** (-2 / 20):
        gain *= 32767 * 10 ** (-2 / 20) / peak
    fi, fo = int(sr * 0.006), int(sr * 0.025)
    for i in range(min(fi, len(seg))):
        seg[i] *= i / fi
    for i in range(min(fo, len(seg))):
        seg[-1 - i] *= i / fo
    pcm = array.array('h', [0] * int(sr * 0.10))
    pcm.extend(int(max(-32767, min(32767, v * gain))) for v in seg)
    pcm.extend([0] * int(sr * 0.18))
    return sr, pcm.tobytes(), len(pcm) / sr


def to_mp3(sr, pcm, dst):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', '-', '-map_metadata', '-1',
                    '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', str(sr), dst], input=pcm, check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true', help='list the texts that have no clip yet and stop')
    ap.add_argument('--redo', nargs='*', default=[], metavar='TEXT', help='make these clips again even if they exist')
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    index_path = os.path.join(OUT, 'index.json')
    index = {'v': 1, 'clips': {}}
    if os.path.exists(index_path):
        with open(index_path, encoding='utf-8') as f:
            index = json.load(f)
    clips = index.setdefault('clips', {})

    wanted = collect()
    todo = [k for k in wanted if k in args.redo or k not in clips or not os.path.exists(os.path.join(OUT, clips[k]))]
    print('%d texts in the lessons, %d already have a clip, %d to make' % (len(wanted), len(wanted) - len(todo), len(todo)))
    if args.check or not todo:
        for k in todo:
            print('  missing:', k)
        return 0
    if not shutil.which('ffmpeg'):
        raise SystemExit('ffmpeg is not installed: cannot save MP3 files')

    syn = setup()
    made, failed = [], []
    for key in todo:
        try:
            given = wanted[key]
            q = syn.create_audio_query(given, STYLE_ID)
            note = ''
            if norm(reading(q)) != norm(key):
                if given != key:
                    note = '  ("%s" was read as %s, so the kana was used instead)' % (given, reading(q))
                    given = key
                    q = syn.create_audio_query(key, STYLE_ID)
                if norm(reading(q)) != norm(key):
                    raise ValueError('the engine reads it as %s' % reading(q))
            q.speed_scale = SPEED
            sr, pcm, secs = tidy(syn.synthesis(q, STYLE_ID))
            name = hashlib.sha1(key.encode('utf-8')).hexdigest()[:12] + '.mp3'
            to_mp3(sr, pcm, os.path.join(OUT, name))
            clips[key] = name
            made.append(key)
            print('  made  %-18s %-12s %.1fs  accent: %s%s' % (key, '' if given == key else '<- ' + given, secs, q.kana, note))
        except Exception as e:                       # one bad text must not stop the rest
            failed.append(key)
            print('  FAILED %s: %s' % (key, e))

    index.update({'v': 1, 'voice': VOICE, 'engine': 'voicevox_core ' + CORE, 'clips': dict(sorted(clips.items()))})
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=0, separators=(',', ':'))
        f.write('\n')
    print('made %d, failed %d; index now lists %d clips' % (len(made), len(failed), len(clips)))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
