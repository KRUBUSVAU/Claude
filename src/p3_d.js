
// ---------- renderer (3D) ----------
// WebGL draws every dot as a GPU point sprite: a static buffer of 80k atlas points whose colour and
// size are evaluated in the vertex shader from per-region uniforms (activation, flash, hue, spectrum).
// A transparent 2D canvas on top draws labels, synapse lines and the zoomed-in neuron detail.
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: true });
const glCanvas = document.getElementById('gl');
const FOV = 38 * Math.PI / 180;
const HOME = { yaw: -0.78, pitch: 0.26, dist: 330, target: [0, -14, 4] };
const view = { w: 1, h: 1, dpr: 1, dprCap: 2, yaw: HOME.yaw, pitch: HOME.pitch, dist: HOME.dist, tx: HOME.target[0], ty: HOME.target[1], tz: HOME.target[2], tyaw: HOME.yaw, tpitch: HOME.pitch, tdist: HOME.dist, ttx: 0, tty: -14, ttz: 4, animating: false, autoSpin: true, showSkull: true, lastInteract: -100, homeDist: 330 };
const VP = new Float32Array(16), INV = new Float32Array(16); let eye = [0, 0, 0], camRight = [1, 0, 0], camUp = [0, 0, 1], camFwd = [0, 1, 0], pointScale = 1;
function resize() {
  view.dpr = Math.min(view.dprCap, window.devicePixelRatio || 1); view.w = canvas.clientWidth; view.h = canvas.clientHeight;
  const pw = Math.round(view.w * view.dpr), ph = Math.round(view.h * view.dpr);
  canvas.width = pw; canvas.height = ph; glCanvas.width = pw; glCanvas.height = ph;
  const aspect = view.w / Math.max(1, view.h); view.homeDist = HOME.dist * Math.max(1, 0.82 / aspect);
  if (!view.touched) { view.dist = view.tdist = view.homeDist; }
}
window.addEventListener('resize', resize); resize();
// --- matrices
function mat4Perspective(out, fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); out.fill(0); out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf; return out; }
function mat4LookAt(out, e, c, up) {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2], l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0; out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0; out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); out[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); out[14] = -(zx * e[0] + zy * e[1] + zz * e[2]); out[15] = 1;
  camRight = [xx, xy, xz]; camUp = [yx, yy, yz]; camFwd = [-zx, -zy, -zz]; return out;
}
function mat4Mul(out, a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } out.set(o); return out; }
function mat4Invert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7], a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!det) return out; det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det; out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det; return out;
}
const PROJ = new Float32Array(16), VIEWM = new Float32Array(16);
function updateCamera() {
  view.pitch = clamp(view.pitch, -1.45, 1.45); view.dist = clamp(view.dist, 14, 900);
  const cp = Math.cos(view.pitch); eye = [view.tx + view.dist * Math.sin(view.yaw) * cp, view.ty + view.dist * Math.cos(view.yaw) * cp, view.tz + view.dist * Math.sin(view.pitch)];
  mat4LookAt(VIEWM, eye, [view.tx, view.ty, view.tz], [0, 0, 1]);
  mat4Perspective(PROJ, FOV, view.w / Math.max(1, view.h), 4, 2500);
  mat4Mul(VP, PROJ, VIEWM); mat4Invert(INV, VP);
  pointScale = view.h * view.dpr / (2 * Math.tan(FOV / 2));
}
const prj = [0, 0, 0];
function project(x, y, z) { // -> screen px (CSS), w; w<=0 behind camera
  const w = VP[3] * x + VP[7] * y + VP[11] * z + VP[15]; if (w <= 0.01) { prj[2] = -1; return prj; }
  prj[0] = ((VP[0] * x + VP[4] * y + VP[8] * z + VP[12]) / w * 0.5 + 0.5) * view.w; prj[1] = (0.5 - (VP[1] * x + VP[5] * y + VP[9] * z + VP[13]) / w * 0.5) * view.h; prj[2] = w; return prj;
}
function screenRay(sx, sy) { // world-space ray from pointer
  const nx = sx / view.w * 2 - 1, ny = 1 - sy / view.h * 2; const un = (x, y, z) => { const w = INV[3] * x + INV[7] * y + INV[11] * z + INV[15]; return [(INV[0] * x + INV[4] * y + INV[8] * z + INV[12]) / w, (INV[1] * x + INV[5] * y + INV[9] * z + INV[13]) / w, (INV[2] * x + INV[6] * y + INV[10] * z + INV[14]) / w]; };
  const a = un(nx, ny, -1), b = un(nx, ny, 1); const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d); return { o: a, d: [d[0] / l, d[1] / l, d[2] / l] };
}
function flyTo(target, dist, yaw, pitch) { view.touched = true; view.lastInteract = performance.now() / 1000; view.ttx = target[0]; view.tty = target[1]; view.ttz = target[2]; view.tdist = clamp(dist, 14, 900); if (yaw !== undefined) view.tyaw = yaw; else view.tyaw = view.yaw; if (pitch !== undefined) view.tpitch = pitch; else view.tpitch = view.pitch; view.animating = true; }
function goHome() { flyTo(HOME.target, view.homeDist, HOME.yaw, HOME.pitch); }
function flyToRegion(r, hitCenter) { const c = hitCenter || (r.cl || r.c); flyTo(c, r.small ? 30 : Math.min(60, Math.max(34, r.r * 1.1))); }
const zf = () => clamp(Math.pow(view.dist / 330, 0.8), 0.08, 1.15);
view.exposure = 0.8;

// --- colour helpers for the overlay
const colorCache = new Map();
function hsl(h, s, l) { const hq = ((h % 360 + 360) % 360 / 3) | 0, sq = (clamp(s, 0, 100) / 5) | 0, lq = (clamp(l, 0, 100) / 2) | 0; const key = hq * 100000 + sq * 1000 + lq; let v = colorCache.get(key); if (!v) { v = `hsl(${hq * 3},${sq * 5}%,${lq * 2}%)`; colorCache.set(key, v); } return v; }
const rgbTmp = [0, 0, 0];
function hslRgb(h, s, l) { h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; for (let k = 0; k < 3; k++) { let t = h + (1 - k) / 3; if (t < 0) t += 1; if (t > 1) t -= 1; rgbTmp[k] = t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; } return rgbTmp; }

// ---- WebGL
let gl = null, progCloud = null, progRaw = null, progLine = null, bufCloud = null, bufRaw = null, bufLine = null, LC = null, LR = null, LL = null, glMaxPt = 64;
const lineData = new Float32Array(10000 * 2 * 7);
const NREG = regions.length, REGA = new Float32Array(20 * 4), REGB = new Float32Array(20 * 4), SPEC = new Float32Array(64);
const RAWCAP = paths.reduce((s, p) => s + p.pts.length, 0) + 40000;
const rawDisk = new Float32Array(RAWCAP * 8), rawBloom = new Float32Array(RAWCAP * 8); let nDisk = 0, nBloom = 0;
const extraGlow = [];
const VS_COMMON = 'precision highp float;uniform mat4 uVP;uniform float uPointScale,uMaxPt;uniform mediump float uSoft;';
const FS = 'precision mediump float;varying vec4 vCol;uniform float uSoft;void main(){vec2 d=gl_PointCoord-0.5;float r=length(d)*2.0;float a=uSoft>0.5?pow(max(0.0,1.0-r),2.2):1.0-smoothstep(0.72,1.0,r);gl_FragColor=vec4(vCol.rgb*vCol.a*a,vCol.a*a);}';
const VS_CLOUD = VS_COMMON + `
attribute vec3 aPos;attribute vec4 aAttr;attribute float aSize;
uniform float uTime,uUnd,uZf,uGz,uDrift,uSkullAlpha,uSkullOn,uExposure;uniform int uAud;
uniform vec4 uRegA[20];uniform vec4 uRegB[20];uniform vec4 uSpec[16];varying vec4 vCol;
vec3 hsl2rgb(vec3 c){vec3 rgb=clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);return c.z+c.y*(rgb-0.5)*(1.0-abs(2.0*c.z-1.0));}
float specAt(int k){vec4 s=uSpec[k/4];int m=k-4*(k/4);return m==0?s.x:m==1?s.y:m==2?s.z:s.w;}
void main(){
  int reg=int(aAttr.x*255.0+0.5);
  if(reg>=200){ vec4 clip=uVP*vec4(aPos,1.0);gl_Position=clip;float w=max(clip.w,1.0);float fade=clamp(1.0-(w-150.0)/600.0,0.3,1.0);
    if(uSoft>0.5||uSkullOn<0.5){gl_PointSize=0.0;vCol=vec4(0.0);return;}
    vCol=vec4(0.45,0.62,1.0,uSkullAlpha*uExposure*fade*(0.6+0.4*aAttr.y));gl_PointSize=min(uMaxPt,max(1.0,2.0*aSize*0.3*uZf*uPointScale/w));return;}
  vec4 A=uRegA[reg];vec4 B=uRegB[reg];
  float a0=A.x,fl=A.y,fh=A.z,bh=A.w;float tone=aAttr.y*2.0-1.0,ph=aAttr.z*6.2832,u=aAttr.w;
  float a=a0; if(reg==uAud){a+=specAt(int(u*63.0))*0.95;}
  a+=B.z*sin(uUnd*B.w+ph+u*2.5)*(0.4+0.6*a0); a+=fl*(0.65+0.35*sin(ph*3.0+uTime*9.0)); a=clamp(a,0.0,1.1);
  float hue=bh; if(fl>0.04&&fh>=0.0){float d=mod(fh-bh+540.0,360.0)-180.0;hue=bh+d*clamp(fl,0.0,1.0)*0.85;}
  float act=smoothstep(0.0,1.0,a);
  float sat=clamp(B.x/100.0*mix(0.22,0.95,act)-0.08*max(0.0,tone),0.0,1.0);
  float lig=clamp((B.y-22.0+tone*9.0+act*12.0)/100.0,0.0,0.72);
  vec3 rgb=hsl2rgb(vec3(mod(hue,360.0)/360.0,sat,lig));
  vec3 pos=aPos+uDrift*(0.3+a)*vec3(sin(uTime*0.6+ph*7.0),cos(uTime*0.45+ph*5.0),sin(uTime*0.5+ph*3.0));
  vec4 clip=uVP*vec4(pos,1.0);gl_Position=clip;float w=max(clip.w,1.0);float fade=clamp(1.0-(w-120.0)/700.0,0.35,1.0)*uExposure;
  if(uSoft>0.5){float ba=(act-0.85)*0.25;if(ba<=0.0){gl_PointSize=0.0;vCol=vec4(0.0);return;}vCol=vec4(rgb,ba*fade);gl_PointSize=min(uMaxPt,2.0*aSize*0.5*1.8*uGz*uPointScale/w);}
  else{vCol=vec4(rgb,(0.3+0.3*act)*fade);gl_PointSize=min(uMaxPt,max(1.2,2.0*aSize*0.36*uZf*uPointScale/w));}
}`;
const VS_LINE = 'precision highp float;uniform mat4 uVP;attribute vec3 aPos;attribute vec4 aCol;varying vec4 vCol;void main(){gl_Position=uVP*vec4(aPos,1.0);vCol=aCol;}';
const FS_LINE = 'precision mediump float;varying vec4 vCol;void main(){gl_FragColor=vec4(vCol.rgb*vCol.a,vCol.a);}';
const VS_RAW = VS_COMMON + 'attribute vec3 aPos;attribute vec4 aCol;attribute float aSize;varying vec4 vCol;void main(){vec4 clip=uVP*vec4(aPos,1.0);gl_Position=clip;float w=max(clip.w,1.0);float fade=clamp(1.0-(w-120.0)/700.0,0.35,1.0);vCol=vec4(aCol.rgb,aCol.a*fade);gl_PointSize=min(uMaxPt,max(1.0,2.0*aSize*uPointScale/w));}';
function mkProg(vs, fs) { const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; }; const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
function locs(p, names) { const o = {}; for (const n of names) o[n] = n[0] === 'a' ? gl.getAttribLocation(p, n) : gl.getUniformLocation(p, n); return o; }
function initGL() {
  try { gl = glCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
  if (!gl) return;
  try { progCloud = mkProg(VS_CLOUD, FS); progRaw = mkProg(VS_RAW, FS); progLine = mkProg(VS_LINE, FS_LINE); } catch (e) { console.error(e); gl = null; return; }
  LC = locs(progCloud, ['aPos', 'aAttr', 'aSize', 'uVP', 'uPointScale', 'uMaxPt', 'uSoft', 'uTime', 'uUnd', 'uZf', 'uGz', 'uDrift', 'uSkullAlpha', 'uSkullOn', 'uExposure', 'uAud', 'uRegA', 'uRegB', 'uSpec']);
  LR = locs(progRaw, ['aPos', 'aCol', 'aSize', 'uVP', 'uPointScale', 'uMaxPt', 'uSoft']); LL = locs(progLine, ['aPos', 'aCol', 'uVP']);
  glMaxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64;
  // static cloud buffer: xyz float32, 4 bytes attrs, size float32 (stride 20)
  const buf = new ArrayBuffer(NALL * 20), f32 = new Float32Array(buf), u8 = new Uint8Array(buf);
  for (let i = 0; i < NALL; i++) { f32[i * 5] = D.x[i]; f32[i * 5 + 1] = D.y[i]; f32[i * 5 + 2] = D.z[i]; u8[i * 20 + 12] = D.reg[i]; u8[i * 20 + 13] = toneU8[i]; u8[i * 20 + 14] = phU8[i]; u8[i * 20 + 15] = uU8[i]; f32[i * 5 + 4] = D.size[i]; }
  bufCloud = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufCloud); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  bufRaw = gl.createBuffer(); bufLine = gl.createBuffer();
  gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
}
glCanvas.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; });
glCanvas.addEventListener('webglcontextrestored', () => initGL());
initGL();
function glow(h, x, y, z, r, alpha) { if (alpha > 0.01) extraGlow.push(h, x, y, z, r, alpha); }
function pushDisk(x, y, z, r, g, b, a, size) { if (nDisk >= RAWCAP) return; const o = nDisk * 8; rawDisk[o] = x; rawDisk[o + 1] = y; rawDisk[o + 2] = z; rawDisk[o + 3] = r; rawDisk[o + 4] = g; rawDisk[o + 5] = b; rawDisk[o + 6] = a; rawDisk[o + 7] = size; nDisk++; }
function pushBloom(x, y, z, r, g, b, a, size) { if (nBloom >= RAWCAP) return; const o = nBloom * 8; rawBloom[o] = x; rawBloom[o + 1] = y; rawBloom[o + 2] = z; rawBloom[o + 3] = r; rawBloom[o + 4] = g; rawBloom[o + 5] = b; rawBloom[o + 6] = a; rawBloom[o + 7] = size; nBloom++; }
function dotActivation(i, now, F) { // JS twin of the vertex shader, for the few dots drawn in detail
  const r = regions[D.reg[i]]; const a0 = brain.act[r.i], fl = brain.flash[r.i]; let a = a0;
  if (r.id === 'auditory') a += F.spec[(D.u[i] * 63) | 0] * 0.95;
  a += (r.limbic || r.id === 'accumbens' ? 0.2 : 0.06) * Math.sin(brain.undPhase * (r.limbic ? 1 : 2.2) + D.phase[i] + D.u[i] * 2.5) * (0.4 + 0.6 * a0);
  a += fl * (0.65 + 0.35 * Math.sin(D.phase[i] * 3 + now * 9)); return clamp(a, 0, 1.1);
}
function regionHue(r) { const modeHue = 262 + 136 * brain.modeMix; return r.limbic ? lerpHue(modeHue + r.hueOff, r.hue, 0.25) : r.hue; }
function drawGL(now, F, active) {
  const z = zf(), gz = clamp(Math.pow(view.dist / 330, 0.7), 0.1, 1.2), ex = 0.55 + 0.45 * view.exposure;
  for (const r of regions) { const o = r.i * 4; REGA[o] = brain.act[r.i]; REGA[o + 1] = brain.flash[r.i]; REGA[o + 2] = brain.flashHue[r.i]; REGA[o + 3] = regionHue(r); REGB[o] = r.sat; REGB[o + 1] = r.light; REGB[o + 2] = (r.limbic || r.id === 'accumbens') ? 0.2 : 0.06; REGB[o + 3] = r.limbic ? 1 : 2.2; }
  SPEC.set(F.spec);
  gl.viewport(0, 0, glCanvas.width, glCanvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(progCloud); gl.bindBuffer(gl.ARRAY_BUFFER, bufCloud);
  gl.enableVertexAttribArray(LC.aPos); gl.enableVertexAttribArray(LC.aAttr); gl.enableVertexAttribArray(LC.aSize);
  gl.vertexAttribPointer(LC.aPos, 3, gl.FLOAT, false, 20, 0); gl.vertexAttribPointer(LC.aAttr, 4, gl.UNSIGNED_BYTE, true, 20, 12); gl.vertexAttribPointer(LC.aSize, 1, gl.FLOAT, false, 20, 16);
  gl.uniformMatrix4fv(LC.uVP, false, VP); gl.uniform1f(LC.uPointScale, pointScale); gl.uniform1f(LC.uMaxPt, glMaxPt); gl.uniform1f(LC.uTime, now); gl.uniform1f(LC.uUnd, brain.undPhase); gl.uniform1f(LC.uZf, z); gl.uniform1f(LC.uGz, gz); gl.uniform1f(LC.uDrift, REDUCED ? 0 : 0.5); gl.uniform1f(LC.uSkullAlpha, 0.12); gl.uniform1f(LC.uSkullOn, view.showSkull ? 1 : 0); gl.uniform1f(LC.uExposure, view.exposure); gl.uniform1i(LC.uAud, regionById.auditory.i);
  gl.uniform4fv(LC.uRegA, REGA); gl.uniform4fv(LC.uRegB, REGB); gl.uniform4fv(LC.uSpec, SPEC);
  gl.uniform1f(LC.uSoft, 1); gl.drawArrays(gl.POINTS, 0, NALL);
  gl.uniform1f(LC.uSoft, 0); gl.drawArrays(gl.POINTS, 0, NALL);
  gl.disableVertexAttribArray(LC.aPos); gl.disableVertexAttribArray(LC.aAttr); gl.disableVertexAttribArray(LC.aSize);
  // pathways, pulses, synapse close-ups and overlay-requested glows
  for (const p of paths) { const h = p.hue, pts = p.pts, gl_ = p.glow; for (let i = 0; i < pts.length; i++) { const q = pts[i], g = gl_[i]; const c = hslRgb(h, 35 + 40 * g, 40 + 28 * g); pushDisk(q.x, q.y, q.z, c[0], c[1], c[2], (0.12 + 0.6 * Math.min(1, g)) * ex, Math.max(0.2, q.r * 0.8 * z)); if (g > 0.3) { const cb = hslRgb(h, 70, 60); pushBloom(q.x, q.y, q.z, cb[0], cb[1], cb[2], (g - 0.3) * 0.3 * ex, (1.5 + 2 * g) * gz); } } }
  for (const pu of brain.pulses) { const pts = pu.p.pts, q = pts[clamp(Math.round(pu.t * (pts.length - 1)), 0, pts.length - 1)]; const w = hslRgb(pu.p.hue, 55, 85); pushDisk(q.x, q.y, q.z, w[0], w[1], w[2], 0.85 * ex, (0.45 + 0.3 * pu.i) * z); const c = hslRgb(pu.p.hue, 70, 60); pushBloom(q.x, q.y, q.z, c[0], c[1], c[2], 0.35 * pu.i * ex, (2 + 2 * pu.i) * gz); }
  for (let k = 0; k < extraGlow.length; k += 6) { const c = hslRgb(extraGlow[k], 70, 62); pushBloom(extraGlow[k + 1], extraGlow[k + 2], extraGlow[k + 3], c[0], c[1], c[2], extraGlow[k + 5] * 0.6 * ex, extraGlow[k + 4]); }
  extraGlow.length = 0;
  // net sparks: signals travelling the formed networks
  for (const s of brain.sparks) { if (s.t < 0 || s.t > 1) continue; const ed = s.ed, t = s.t; const x = lerp(D.x[ed.a], D.x[ed.b], t), y = lerp(D.y[ed.a], D.y[ed.b], t), zz = lerp(D.z[ed.a], D.z[ed.b], t); const c = hslRgb(s.net.hue, 60, 80); pushDisk(x, y, zz, c[0], c[1], c[2], 0.9 * ex, 0.32 * z); const cb = hslRgb(s.net.hue, 70, 60); pushBloom(x, y, zz, cb[0], cb[1], cb[2], 0.3 * ex, 1.6 * gz); }
  gl.useProgram(progRaw); gl.bindBuffer(gl.ARRAY_BUFFER, bufRaw);
  gl.enableVertexAttribArray(LR.aPos); gl.enableVertexAttribArray(LR.aCol); gl.enableVertexAttribArray(LR.aSize);
  gl.uniformMatrix4fv(LR.uVP, false, VP); gl.uniform1f(LR.uPointScale, pointScale); gl.uniform1f(LR.uMaxPt, glMaxPt);
  gl.bufferData(gl.ARRAY_BUFFER, rawBloom.subarray(0, nBloom * 8), gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(LR.aPos, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(LR.aCol, 4, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(LR.aSize, 1, gl.FLOAT, false, 32, 28);
  gl.uniform1f(LR.uSoft, 1); gl.drawArrays(gl.POINTS, 0, nBloom);
  gl.bufferData(gl.ARRAY_BUFFER, rawDisk.subarray(0, nDisk * 8), gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(LR.aPos, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(LR.aCol, 4, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(LR.aSize, 1, gl.FLOAT, false, 32, 28);
  gl.uniform1f(LR.uSoft, 0); gl.drawArrays(gl.POINTS, 0, nDisk);
  nDisk = 0; nBloom = 0;
  // formed neural nets as lines between neurons
  let nl = 0;
  for (const net of brain.nets.values()) { const c = hslRgb(net.hue, 45, 62); for (const ed of net.edges) { if (nl + 14 > lineData.length) break; const al = (0.05 + 0.4 * ed.s) * ex; lineData[nl++] = D.x[ed.a]; lineData[nl++] = D.y[ed.a]; lineData[nl++] = D.z[ed.a]; lineData[nl++] = c[0]; lineData[nl++] = c[1]; lineData[nl++] = c[2]; lineData[nl++] = al; lineData[nl++] = D.x[ed.b]; lineData[nl++] = D.y[ed.b]; lineData[nl++] = D.z[ed.b]; lineData[nl++] = c[0]; lineData[nl++] = c[1]; lineData[nl++] = c[2]; lineData[nl++] = al; } }
  if (nl) { gl.useProgram(progLine); gl.bindBuffer(gl.ARRAY_BUFFER, bufLine); gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, nl), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(LL.aPos); gl.enableVertexAttribArray(LL.aCol); gl.vertexAttribPointer(LL.aPos, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(LL.aCol, 4, gl.FLOAT, false, 28, 12); gl.uniformMatrix4fv(LL.uVP, false, VP); gl.drawArrays(gl.LINES, 0, nl / 7); gl.disableVertexAttribArray(LL.aPos); gl.disableVertexAttribArray(LL.aCol); }
  gl.disableVertexAttribArray(LR.aPos); gl.disableVertexAttribArray(LR.aCol); gl.disableVertexAttribArray(LR.aSize);
}

// ---- 2D overlay: synapses, labels, neuron detail
function drawLabels() {
  ctx.globalCompositeOperation = 'source-over'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.font = 'italic 500 15px "Cormorant Garamond", Georgia, serif';
  const near = view.dist < 170;
  for (const r of regions) {
    if (r.small && !near) continue;
    const c = r.small || r.id === 'auditory' ? (view.yaw < 0 ? r.cl : r.cr) : r.c;
    const p = project(c[0], c[1], c[2]); if (p[2] <= 0) continue;
    if (p[0] < -100 || p[0] > view.w + 100 || p[1] < -20 || p[1] > view.h + 20) continue;
    const al = clamp(1 - (p[2] - 200) / 500, 0.25, 1) * (r.small ? 0.7 : 0.5) * (view.dist < 60 ? smoothstep(20, 60, view.dist) : 1);
    ctx.fillStyle = `rgba(215,228,255,${al})`; ctx.fillText(r.name, p[0], p[1]);
  }
}
// ---- synapse close-ups: appear only around the point you fly into, built from dots like everything else
// Local frame: the synapse axis is z; presynaptic terminal at z<0, cleft at z=0, postsynaptic terminal at z>0 (units mm).
function makeTemplate(seed) {
  const rng = mulberry32(seed); const pts = []; // {p:[x,y,z], k: 0 pre membrane, 1 post membrane, 2 vesicle, 3 receptor}
  const shell = (cx, cy, cz, rx, ry, rz, n, k, flatFace) => { for (let i = 0; i < n; i++) { let v = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]; const l = Math.hypot(...v) || 1; const rr = 0.93 + 0.07 * rng(); v = [v[0] / l * rr * rx, v[1] / l * rr * ry, v[2] / l * rr * rz]; if (flatFace !== undefined && Math.sign(v[2]) === flatFace) v[2] *= 0.35; pts.push({ p: [cx + v[0], cy + v[1], cz + v[2]], k }); } };
  const tube = (z0, z1, r, n, k, tilt) => { for (let i = 0; i < n; i++) { const t = rng(), a = rng() * TAU, rr = r * (0.7 + 0.3 * rng()) * (0.8 + 0.4 * t); const z = lerp(z0, z1, t); pts.push({ p: [Math.cos(a) * rr + tilt[0] * Math.abs(z - z0), Math.sin(a) * rr + tilt[1] * Math.abs(z - z0), z], k }); } };
  shell(0, 0, -0.62, 0.46, 0.46, 0.5, 260, 0, 1); tube(-1.0, -2.6, 0.15, 60, 0, [(rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5]);
  shell(0, 0, 0.66, 0.5, 0.5, 0.5, 260, 1, -1); tube(1.05, 2.6, 0.17, 60, 1, [(rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5]);
  for (let b = 0; b < 2; b++) { const a = rng() * TAU, len = 0.6 + rng() * 0.5; for (let i = 0; i < 14; i++) { const t = rng(); pts.push({ p: [Math.cos(a) * 0.17 + Math.cos(a) * len * t, Math.sin(a) * 0.17 + Math.sin(a) * len * t, 1.3 + 0.9 * rng() + 0.3 * t], k: 1 }); } }
  const ves = []; for (let i = 0; i < 14; i++) { const a = rng() * TAU, rr = Math.sqrt(rng()) * 0.3; const p = [Math.cos(a) * rr, Math.sin(a) * rr, -0.18 - rng() * 0.55]; pts.push({ p, k: 2 }); ves.push(p); }
  const rec = []; for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + rng() * 0.5, rr = 0.1 + rng() * 0.22; const p = [Math.cos(a) * rr, Math.sin(a) * rr, 0.14]; pts.push({ p, k: 3, ri: i }); rec.push(p); }
  return { pts, ves, rec };
}
const TEMPLATES = Array.from({ length: 6 }, (_, i) => makeTemplate(4242 + i));
const synapses = new Map();
function getSynapse(i, now) {
  let s = synapses.get(i);
  if (!s) {
    const rng = mulberry32(D.seed[i]); // random rotation (axis-angle) and scale
    const ax = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]; const l = Math.hypot(...ax) || 1; ax[0] /= l; ax[1] /= l; ax[2] /= l; const ang = rng() * TAU, c = Math.cos(ang), sn = Math.sin(ang), t = 1 - c;
    const R = [t * ax[0] * ax[0] + c, t * ax[0] * ax[1] - sn * ax[2], t * ax[0] * ax[2] + sn * ax[1], t * ax[0] * ax[1] + sn * ax[2], t * ax[1] * ax[1] + c, t * ax[1] * ax[2] - sn * ax[0], t * ax[0] * ax[2] - sn * ax[1], t * ax[1] * ax[2] + sn * ax[0], t * ax[2] * ax[2] + c];
    s = { R, tmpl: TEMPLATES[Math.floor(rng() * TEMPLATES.length)], scale: 2.1 * (0.85 + 0.3 * rng()) * (0.85 + 0.3 * D.size[i]), rec: new Float32Array(6), parts: [], acc: rng(), seen: now };
    synapses.set(i, s);
  }
  s.seen = now; return s;
}
const wp3 = [0, 0, 0];
function xf(s, i, p) { const R = s.R, k = s.scale; const x = p[0] * k, y = p[1] * k, z = p[2] * k; wp3[0] = D.x[i] + R[0] * x + R[1] * y + R[2] * z; wp3[1] = D.y[i] + R[3] * x + R[4] * y + R[5] * z; wp3[2] = D.z[i] + R[6] * x + R[7] * y + R[8] * z; return wp3; }
function drawSynapses(now, dt, F) {
  const fade = smoothstep(95, 55, view.dist); if (fade <= 0) { if (synapses.size) synapses.clear(); return; }
  const RAD = 22, R2 = RAD * RAD, tx = view.tx, ty = view.ty, tz = view.tz; const cand = [];
  for (let i = 0; i < ND; i++) { const dx = D.x[i] - tx, dy = D.y[i] - ty, dz = D.z[i] - tz; const d2 = dx * dx + dy * dy + dz * dz; if (d2 < R2) cand.push([i, d2]); }
  cand.sort((p, q) => p[1] - q[1]);
  const picked = []; // well separated synapses so each one reads on its own
  for (const c of cand) { let ok = true; for (const p of picked) { const dx = D.x[c[0]] - D.x[p[0]], dy = D.y[c[0]] - D.y[p[0]], dz = D.z[c[0]] - D.z[p[0]]; if (dx * dx + dy * dy + dz * dz < 64) { ok = false; break; } } if (ok) { picked.push(c); if (picked.length >= 12) break; } }
  const z = zf();
  for (const [i, d2] of picked) {
    const r = regions[D.reg[i]], nt = r.nt, ntc = NT[nt], s = getSynapse(i, now);
    const focus = 1 - smoothstep(0.45, 1, Math.sqrt(d2) / RAD); const al = fade * focus; if (al <= 0.03) continue;
    const a = dotActivation(i, now, F); const hue = regionHue(r);
    const cPre = hslRgb(hue, 40, 52), cPost = hslRgb(205, 40, 66), cNt = hslRgb(ntc.hue, 75, 62), cVes = hslRgb(ntc.hue, 70, 70);
    for (const q of s.tmpl.pts) {
      const w = xf(s, i, q.p);
      if (q.k === 0) pushDisk(w[0], w[1], w[2], cPre[0], cPre[1], cPre[2], al * (0.16 + 0.14 * a), 0.05 * s.scale);
      else if (q.k === 1) pushDisk(w[0], w[1], w[2], cPost[0], cPost[1], cPost[2], al * 0.15, 0.05 * s.scale);
      else if (q.k === 2) { pushDisk(w[0], w[1], w[2], cVes[0], cVes[1], cVes[2], al * 0.8, 0.05 * s.scale); pushBloom(w[0], w[1], w[2], cNt[0], cNt[1], cNt[2], al * 0.12, 0.22 * s.scale); }
      else { const g = s.rec[q.ri]; pushDisk(w[0], w[1], w[2], cNt[0], cNt[1], cNt[2], al * (0.45 + 0.55 * g), 0.065 * s.scale * (1 + 0.6 * g)); if (g > 0.04) pushBloom(w[0], w[1], w[2], cNt[0], cNt[1], cNt[2], al * g * 0.6, (0.35 + 0.5 * g) * s.scale); }
    }
    for (let q = 0; q < 6; q++) s.rec[q] *= Math.exp(-dt / 0.45);
    // molecules crossing the cleft
    const recAct = brain.recept[r.i] + (nt === 'glu' ? Math.max(0, a - 0.3) * 1.5 : 0);
    if ((!REDUCED || recAct > 0.6) && al > 0.15) { s.acc += dt * (0.3 + 4.5 * recAct); while (s.acc > 1) { s.acc -= 1; if (s.parts.length < 8) { const v = s.tmpl.ves[Math.floor(Math.random() * s.tmpl.ves.length)]; s.parts.push({ from: [v[0] * 0.6, v[1] * 0.6, -0.14], k: Math.floor(Math.random() * 6), t: 0, st: 0, dock: 0, sp: 1.6 + Math.random() * 1.2, wob: Math.random() * TAU }); } } }
    for (let j = s.parts.length - 1; j >= 0; j--) {
      const pt = s.parts[j], to = s.tmpl.rec[pt.k];
      if (pt.st === 0) { pt.t += dt * pt.sp; if (pt.t >= 1) { pt.t = 1; pt.st = 1; pt.dock = 0; s.rec[pt.k] = 1; } }
      else if (pt.st === 1) { pt.dock += dt; if (pt.dock > 0.3) { if (nt === 'glu') { s.parts.splice(j, 1); continue; } pt.st = 2; } }
      else { pt.t -= dt * pt.sp * 0.8; if (pt.t <= 0) { s.parts.splice(j, 1); continue; } }
      const e = pt.t * pt.t * (3 - 2 * pt.t), wob = Math.sin(now * 14 + pt.wob) * 0.06 * (1 - e);
      const lp = [lerp(pt.from[0], to[0], e) + wob, lerp(pt.from[1], to[1], e) + Math.cos(now * 11 + pt.wob) * 0.05 * (1 - e), lerp(pt.from[2], to[2], e)];
      const w = xf(s, i, lp); const alpha = al * (pt.st === 2 ? 0.55 : 1);
      pushDisk(w[0], w[1], w[2], cVes[0], cVes[1], cVes[2], alpha * 0.9, 0.045 * s.scale); pushBloom(w[0], w[1], w[2], cNt[0], cNt[1], cNt[2], alpha * 0.3, 0.25 * s.scale);
    }
  }
  if (synapses.size > 600) for (const [k, s] of synapses) if (now - s.seen > 2) synapses.delete(k);
}
// region under a pointer: ray against per-hemisphere spheres, smallest structures win
function regionAt(sx, sy) {
  const ray = screenRay(sx, sy); let best = null, bestScore = 1e9;
  for (const r of regions) {
    const rad = r.r * (r.small ? 0.9 : 0.55); const centres = r.small || r.r < 40 ? [r.cl, r.cr] : [r.cl, r.cr];
    for (const c of centres) {
      const ox = c[0] - ray.o[0], oy = c[1] - ray.o[1], oz = c[2] - ray.o[2]; const t = ox * ray.d[0] + oy * ray.d[1] + oz * ray.d[2]; if (t < 0) continue;
      const px = ray.o[0] + ray.d[0] * t - c[0], py = ray.o[1] + ray.d[1] * t - c[1], pz = ray.o[2] + ray.d[2] * t - c[2]; const dist = Math.hypot(px, py, pz);
      if (dist < rad) { const score = rad * 10 + dist; if (score < bestScore) { bestScore = score; best = { r, c }; } }
    }
  }
  return best;
}
function render(now, dt, F, active) {
  const { w, h, dpr } = view;
  updateCamera();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.clearRect(0, 0, w, h);
  if (!gl) { ctx.fillStyle = 'rgba(223,230,243,0.8)'; ctx.font = '14px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText('This visualizer needs WebGL, which this browser has turned off.', w / 2, h / 2); return; }
  drawSynapses(now, dt, F);
  drawGL(now, F, active);
  drawLabels();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
