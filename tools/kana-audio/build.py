"""Build the site's kana clips from the Tae Kim recordings (two spoken takes per file: a woman, then a man).
Each output: short lead-in, the woman's take, a pause, the man's take, short tail. Levels matched, mono MP3."""
import sys, os, glob, json, subprocess, numpy as np
# usage: python3 build.py <folder with the 101 source mp3s> <output folder>
# source used: assets/audio-djt in https://github.com/hechangjia/kana-study (see public/audio/kana/LICENSE.txt)
# needs ffmpeg and numpy
SRC=sys.argv[1]; OUT=sys.argv[2]; SR=32000
def load(path):
    raw=subprocess.run(['ffmpeg','-v','error','-i',path,'-f','f32le','-ac','1','-ar',str(SR),'-'],capture_output=True,check=True).stdout
    return np.frombuffer(raw,dtype=np.float32).astype(np.float64)
def frames_db(x, ms=5):
    n=int(SR*ms/1000); k=len(x)//n
    return np.array([10*np.log10(np.mean(x[i*n:(i+1)*n]**2)+1e-14) for i in range(k)]), n
def takes(x):
    db,n=frames_db(x); top=db.max(); floor=np.percentile(db,15)
    act=db>top-30
    # merge gaps shorter than 120 ms
    segs=[]; i=0; gap=int(120/5)
    while i<len(act):
        if act[i]:
            j=i
            while j<len(act) and (act[j] or act[j:j+gap].any()): j+=1
            segs.append([i,j]); i=j
        else: i+=1
    assert len(segs)==2, segs
    global ext; ext=[]
    quiet=max(floor+8,top-42); mid=(segs[0][1]+segs[1][0])//2; lim=[(0,mid),(mid,len(db))]; out=[]
    for (a,b),(lo,hi) in zip(segs,lim):
        # walk outwards until 30 ms in a row are near the noise floor (keeps soft starts such as s, h, f and the decay)
        s=a
        while s>max(lo,a-int(200/5)) and not (db[max(lo,s-6):s]<quiet).all(): s-=1
        e=b
        while e<min(hi,b+int(250/5)) and not (db[e:e+6]<quiet).all(): e+=1
        out.append((s*n,e*n)); ext.append(((a-s)*5,(e-b)*5))
    return out
def shape(seg, soft=False):
    seg=seg.copy(); fi=int(SR*(0.060 if soft else 0.006)); fo=int(SR*0.025)
    seg[:fi]*=np.linspace(0,1,fi); seg[-fo:]*=np.linspace(1,0,fo)
    # match loudness on the voiced part, keep headroom
    db,n=frames_db(seg); act=db>db.max()-20
    rms=np.sqrt(np.mean(np.concatenate([seg[i*n:(i+1)*n] for i in np.where(act)[0]])**2))
    g=10**(-20/20)/rms; peak=np.max(np.abs(seg))*g
    if peak>10**(-2/20): g*=10**(-2/20)/peak
    return seg*g
def sil(ms): return np.zeros(int(SR*ms/1000))
os.makedirs(OUT,exist_ok=True); info={}
for p in sorted(glob.glob(SRC+'/*.mp3')):
    k=os.path.basename(p)[:-4]; x=load(p); (a1,b1),(a2,b2)=takes(x)
    w=shape(x[a1:b1],ext[0][0]>=200); m=shape(x[a2:b2],ext[1][0]>=200)
    y=np.concatenate([sil(100),w,sil(320),m,sil(180)])
    pcm=(np.clip(y,-1,1)*32767).astype('<i2').tobytes()
    dst=os.path.join(OUT,k+'.mp3')
    subprocess.run(['ffmpeg','-v','error','-y','-f','s16le','-ar',str(SR),'-ac','1','-i','-','-map_metadata','-1','-c:a','libmp3lame','-b:a','80k','-ar',str(SR),dst],input=pcm,check=True)
    info[k]=dict(ext=ext,take1_ms=round((b1-a1)*1000/SR),take2_ms=round((b2-a2)*1000/SR),total_ms=round(len(y)*1000/SR),bytes=os.path.getsize(dst))
json.dump(info,open(os.path.join(os.path.dirname(OUT.rstrip('/')),'build-info.json'),'w'),indent=1,sort_keys=True)
tot=sum(v['bytes'] for v in info.values())
print(len(info),'clips, total %.0f KB; length ms min/med/max %d/%d/%d'%(tot/1024,min(v['total_ms'] for v in info.values()),int(np.median([v['total_ms'] for v in info.values()])),max(v['total_ms'] for v in info.values())))
print('take lengths ms: woman %d-%d, man %d-%d'%(min(v['take1_ms'] for v in info.values()),max(v['take1_ms'] for v in info.values()),min(v['take2_ms'] for v in info.values()),max(v['take2_ms'] for v in info.values())))
