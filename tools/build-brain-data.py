#!/usr/bin/env python3
"""Builds assets/brain-data.js (3D point clouds for every brain structure plus a skull shell)
from open MNI152NLin2009cAsym atlas files served by TemplateFlow.

Sources (all redistributable with attribution; see README):
  - seg-aseg_dseg: FreeSurfer-style subcortical segmentation (thalamus, striatum, hippocampus, ...)
  - atlas-HOCPA: Harvard-Oxford cortical areas (lobes, Heschl's gyrus, cingulate, ...)
  - atlas-MASSP20: small subcortical nuclei (VTA, raphe, colliculi, geniculate nuclei)
  - T1w + brain mask: the skull shell is the thin dark band around the brain in the T1 template

Usage: python3 tools/build-brain-data.py <atlas-dir> [out.js]
"""
import sys, os, json, base64, struct
import numpy as np, nibabel as nib
from scipy import ndimage as ndi

src = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'assets', 'brain-data.js')
rng = np.random.default_rng(1337)
def load(n): img = nib.load(os.path.join(src, n)); return img, np.asanyarray(img.dataobj)
img, aseg = load('res-01_seg-aseg_dseg.nii.gz'); aseg = aseg.astype(np.int16)
_, ho = load('res-01_atlas-HOCPA_desc-th25_dseg.nii.gz'); ho = ho.astype(np.int16)
_, ms = load('massp.nii.gz'); ms = ms.astype(np.int16)
_, bm = load('res-01_desc-brain_mask.nii.gz'); bm = bm > 0
_, t1 = load('res-01_T1w.nii.gz'); t1 = t1.astype(np.float32)
A = img.affine
def to_mm(ijk): return ijk @ A[:3, :3].T + A[:3, 3]
grid = np.indices(aseg.shape).reshape(3, -1).T  # voxel coords (i,j,k)
MM = to_mm(grid).reshape(aseg.shape + (3,)).astype(np.float32)  # mm coordinate of every voxel
X, Y, Z = MM[..., 0], MM[..., 1], MM[..., 2]

# ---- cortex ribbon with Harvard-Oxford labels (fill unlabeled ribbon voxels from the nearest label)
ribbon = (aseg == 3) | (aseg == 42)
holab = ho.copy(); holab[~ribbon] = 0
missing = ribbon & (holab == 0)
if missing.any():
    _, idx = ndi.distance_transform_edt(ho == 0, return_indices=True)
    holab[missing] = ho[idx[0][missing], idx[1][missing], idx[2][missing]]
def ho_any(labels): m = np.zeros_like(ribbon)
def ho_mask(labels): return np.isin(holab, labels) & ribbon
def aseg_mask(labels): return np.isin(aseg, labels)
def ms_mask(labels): return np.isin(ms, labels)
def ellipsoid(cx, cy, cz, rx, ry, rz): return (((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 + ((Z - cz) / rz) ** 2) <= 1
def both(fn, cx, *a): return fn(-cx, *a) | fn(cx, *a)

regions = [
  # id, name, mask, target points, (hue, sat, light), nt, limbic?, hueOff, desc
  dict(id='pfc', name='Prefrontal cortex', mask=ho_mask([1, 3, 4, 5, 6, 25, 27, 28, 33, 41]), n=9000, hue=262, sat=55, light=62, nt='da', desc='Harmony and expectation. Flashes on every chord change, coloured by chord quality (gold major, indigo minor, teal diminished, magenta suspended).'),
  dict(id='motor', name='Motor & premotor cortex', mask=ho_mask([7, 26]), n=3200, hue=12, sat=70, light=60, nt='glu', desc='The beat. Pulses with each onset and with the predicted pulse.'),
  dict(id='parietal', name='Parietal cortex', mask=ho_mask([17, 18, 19, 20, 21, 31, 42, 43]), n=6500, hue=196, sat=45, light=60, nt='ne', desc='Midrange energy. Brightens under norepinephrine.'),
  dict(id='occipital', name='Occipital cortex', mask=ho_mask([22, 23, 24, 32, 36, 40, 47, 48]), n=5500, hue=222, sat=50, light=62, nt='ne', desc='High frequencies shimmer here. Brightens under norepinephrine.'),
  dict(id='temporal', name='Temporal cortex', mask=ho_mask([2, 8, 9, 10, 11, 12, 13, 14, 15, 16, 34, 35, 37, 38, 39, 44]), n=6500, hue=182, sat=45, light=58, nt='glu', desc='Overall loudness and timbre.'),
  dict(id='auditory', name='Auditory cortex', mask=ho_mask([45, 46]), n=1800, hue=168, sat=75, light=66, nt='glu', desc="Heschl's gyrus and planum temporale, tonotopic: low frequencies lateral and front, high medial and back. Each dot follows one band of the live spectrum."),
  dict(id='cingulate', name='Cingulate cortex', mask=ho_mask([29, 30]), n=2600, hue=285, sat=55, light=62, nt='ht', limbic=True, hueOff=10, desc='Limbic. Undulates with the key: warm in major, cool in minor. Flashes with harmonic tension.'),
  dict(id='striatum', name='Striatum (basal ganglia)', mask=aseg_mask([11, 50, 12, 51, 13, 52]), n=3200, hue=30, sat=80, light=62, nt='da', desc='Caudate, putamen and pallidum. Groove: locks to the beat; dopamine makes it glow.'),
  dict(id='thalamus', name='Thalamus', mask=aseg_mask([10, 49]), n=2600, hue=204, sat=55, light=66, nt='ne', desc='Relay. Brightness follows loudness; every pathway passes through.'),
  dict(id='hypothalamus', name='Hypothalamus', mask=both(lambda cx: ellipsoid(cx, -3, -13, 5.5, 7, 5.5), 3.5) & bm, n=500, hue=22, sat=70, light=62, nt='ne', limbic=True, hueOff=-20, desc='Arousal. Follows norepinephrine and loudness.'),
  dict(id='hippocampus', name='Hippocampus', mask=aseg_mask([17, 53]), n=2200, hue=272, sat=60, light=64, nt='glu', limbic=True, hueOff=-10, desc='Memory. Flashes when a melody, chord progression or sample is recognised, and wires neurons to the cortex.'),
  dict(id='amygdala', name='Amygdala', mask=aseg_mask([18, 54]), n=900, hue=345, sat=75, light=60, nt='ht', limbic=True, hueOff=25, desc='Emotional salience. Minor tonality and sudden loud transients.'),
  dict(id='accumbens', name='Nucleus accumbens', mask=aseg_mask([26, 58]), n=520, hue=318, sat=80, light=66, nt='da', desc='Reward. Lights up with dopamine: drops, resolutions, predicted beats.'),
  dict(id='cerebellum', name='Cerebellum', mask=aseg_mask([8, 47]), n=7500, hue=300, sat=40, light=58, nt='glu', desc='Timing. Ticks on every predicted beat, even in the silence between hits.'),
  dict(id='brainstem', name='Brainstem', mask=aseg_mask([16]) & ~ms_mask([23, 24, 58, 59, 32, 33, 34, 35]), n=3000, hue=212, sat=35, light=56, nt='glu', desc='Sound arrives here first and climbs through the inferior colliculus to the thalamus.'),
  dict(id='vta', name='Ventral tegmental area', mask=ndi.binary_dilation(ms_mask([23, 24]), iterations=1), n=320, hue=318, sat=90, light=68, nt='da', desc='Dopamine source. Fires on drops, cadences, melodic leaps and beats that land where predicted.'),
  dict(id='lc', name='Locus coeruleus', mask=both(lambda cx: ellipsoid(cx, -36, -24, 2.6, 3.2, 5.5), 5) & aseg_mask([16]), n=240, hue=40, sat=95, light=66, nt='ne', desc='Norepinephrine source. Fires on tempo changes and sudden loudness.'),
  dict(id='raphe', name='Raphe nuclei', mask=ndi.binary_dilation(ms_mask([58, 59]), iterations=2) & aseg_mask([16]), n=260, hue=150, sat=70, light=64, nt='ht', desc='Serotonin source. Rises with steady tempo and major tonality.'),
]
# skull: the dark band (bone + CSF) between the brain and the bright scalp in the T1 template.
# The template's field of view ends at the orbits, so this is the cranial vault and skull base; the facial skeleton is not in the data.
med = float(np.median(t1[bm]))
head = t1 > 0.12 * med
lab, n = ndi.label(head); sizes = ndi.sum(head, lab, range(1, n + 1)); head = lab == (1 + int(np.argmax(sizes)))
head = ndi.binary_closing(head, iterations=4); head = ndi.binary_fill_holes(head)
head_in = ndi.binary_erosion(head, iterations=3)
brain_d = ndi.binary_dilation(bm, iterations=2)
dist_brain = ndi.distance_transform_edt(~brain_d)
dark = (t1 < 0.3 * med) & head_in & ~brain_d
skull = dark & (dist_brain >= 1) & (dist_brain < 16) & (Z > -62)
skull = ndi.binary_closing(skull, iterations=2) & ~brain_d & head_in
lab, n = ndi.label(skull); sizes = ndi.sum(skull, lab, range(1, n + 1)); skull = lab == (1 + int(np.argmax(sizes)))
print('skull voxels', int(skull.sum()))

def sample(mask, n):
    idx = np.argwhere(mask)
    if len(idx) == 0: raise SystemExit('empty mask')
    take = rng.choice(len(idx), size=min(n, len(idx)), replace=False)
    pts = idx[take].astype(np.float32) + rng.uniform(-0.5, 0.5, size=(len(take), 3)).astype(np.float32)
    return to_mm(pts).astype(np.float32)

# ---- assemble
P = []; R = []; TONE = []; PH = []; U = []; SZ = []
meta = []
for ri, r in enumerate(regions):
    pts = sample(r['mask'], r['n']); m = len(pts)
    allv = np.argwhere(r['mask']); mm_all = to_mm(allv.astype(np.float32))
    cen = mm_all.mean(0); rad = float(np.percentile(np.linalg.norm(mm_all - cen, axis=1), 92))
    left = mm_all[mm_all[:, 0] < 0]; right = mm_all[mm_all[:, 0] >= 0]
    cl = left.mean(0) if len(left) else cen; cr = right.mean(0) if len(right) else cen
    if r['id'] == 'auditory':  # tonotopic axis per hemisphere: anterolateral (low) -> posteromedial (high)
        u = np.zeros(m, np.float32)
        for sgn in (-1, 1):
            sel = np.sign(pts[:, 0]) == sgn
            a = np.array([sgn * 58, -8, 4], np.float32); b = np.array([sgn * 36, -32, 12], np.float32)
            d = b - a; t = ((pts[sel] - a) @ d) / (d @ d); u[sel] = np.clip(t, 0, 1)
    else:
        u = (pts[:, 1] - pts[:, 1].min()) / max(1e-3, np.ptp(pts[:, 1]))
    P.append(pts); R.append(np.full(m, ri, np.uint8)); TONE.append(rng.uniform(0, 1, m).astype(np.float32)); PH.append(rng.uniform(0, 1, m).astype(np.float32)); U.append(u.astype(np.float32))
    size = {'vta': 1.25, 'lc': 1.25, 'raphe': 1.25, 'accumbens': 1.15, 'amygdala': 1.1, 'hypothalamus': 1.1}.get(r['id'], 1.0)
    SZ.append((size * rng.uniform(0.7, 1.3, m)).astype(np.float32))
    meta.append(dict(id=r['id'], name=r['name'], n=int(m), hue=r['hue'], sat=r['sat'], light=r['light'], nt=r['nt'], limbic=bool(r.get('limbic', False)), hueOff=r.get('hueOff', 0), desc=r['desc'], c=[round(float(v), 1) for v in cen], cl=[round(float(v), 1) for v in cl], cr=[round(float(v), 1) for v in cr], r=round(rad, 1)))
    print(f"{r['id']:14s} voxels={len(allv):7d} points={m:5d} centre={np.round(cen,1)} radius={rad:.1f}")
# skull points
sk = sample(skull, 24000)
P.append(sk); R.append(np.full(len(sk), 255, np.uint8)); TONE.append(rng.uniform(0, 1, len(sk)).astype(np.float32)); PH.append(rng.uniform(0, 1, len(sk)).astype(np.float32)); U.append(np.zeros(len(sk), np.float32)); SZ.append(rng.uniform(0.6, 1.1, len(sk)).astype(np.float32))
P = np.concatenate(P); R = np.concatenate(R); TONE = np.concatenate(TONE); PH = np.concatenate(PH); U = np.concatenate(U); SZ = np.concatenate(SZ)
N = len(P)
# waypoints for pathways (mm), taken from atlas structures
def cen_of(mask):
    v = np.argwhere(mask); return [round(float(x), 1) for x in to_mm(v.astype(np.float32)).mean(0)]
way = {
  'ic_l': cen_of(ms_mask([32])), 'ic_r': cen_of(ms_mask([33])), 'mgn_l': cen_of(ms_mask([62])), 'mgn_r': cen_of(ms_mask([63])),
  'cochlear_l': [-8, -40, -42], 'cochlear_r': [8, -40, -42], 'callosum_mid': [0, 0, 24], 'fornix_arc': [0, -12, 20],
}
hdr = dict(n=N, scale=0.1, regions=meta, way=way, skullId=255, source='MNI152NLin2009cAsym (TemplateFlow): aseg, Harvard-Oxford cortical, MASSP nuclei, T1w')
pos = np.round(P / hdr['scale']).astype(np.int16)  # 0.1 mm units
blob = bytearray()
blob += pos.tobytes(); blob += R.tobytes(); blob += (TONE * 255).astype(np.uint8).tobytes(); blob += (PH * 255).astype(np.uint8).tobytes(); blob += (U * 255).astype(np.uint8).tobytes(); blob += np.clip(SZ * 100, 0, 255).astype(np.uint8).tobytes()
b64 = base64.b64encode(bytes(blob)).decode('ascii')
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, 'w') as f:
    f.write('// Generated by tools/build-brain-data.py from open MNI152NLin2009cAsym atlas data (TemplateFlow). Do not edit.\n')
    f.write('window.BRAIN_DATA=' + json.dumps(hdr, separators=(',', ':')) + ';\nwindow.BRAIN_BLOB="' + b64 + '";\n')
print('points', N, 'bytes', len(blob), 'file', os.path.getsize(out))
# previews
from PIL import Image, ImageDraw
import colorsys
def preview(fn, ax, ay, flipx=False):
    W = 900; img = Image.new('RGB', (W, W), (6, 8, 14)); px = img.load()
    x = P[:, ax] * (-1 if flipx else 1); y = P[:, ay]
    sx = ((x + 110) / 220 * W).astype(int); sy = ((110 - y) / 220 * W).astype(int)
    order = np.argsort(R == 255)[::-1]  # skull first (drawn under)
    for i in order:
        if not (0 <= sx[i] < W and 0 <= sy[i] < W): continue
        if R[i] == 255: c = (40, 60, 110)
        else:
            m = meta[R[i]]; rgb = colorsys.hls_to_rgb(m['hue'] / 360, m['light'] / 100 * (0.75 + 0.5 * TONE[i]), m['sat'] / 100); c = tuple(int(v * 255) for v in rgb)
        px[sx[i], sy[i]] = c
    img.save(fn)
prev = os.environ.get('PREVIEW_DIR')
if prev:
    preview(os.path.join(prev, 'pv_side.png'), 1, 2, flipx=True)   # sagittal, facing left
    preview(os.path.join(prev, 'pv_front.png'), 0, 2)
    preview(os.path.join(prev, 'pv_top.png'), 0, 1)
    print('previews written')
