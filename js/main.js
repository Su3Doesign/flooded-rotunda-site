// The Flooded Rotunda — page orchestration: loader story, intro, scroll tour, annotations, book-page reveals.
import * as THREE from 'three';
import { World } from './world.js';
import { Tour, STATIONS } from './tour.js';
import { buildMark, rebuildDrawn } from './marks.js';
import { Sound } from './sound.js';

const gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const QS = new URLSearchParams(location.search);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const UA = navigator.userAgent;
const isIPad = /iPad/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);   // iPadOS reports a Mac
const isPhone = /iPhone|iPod|Android.*Mobile|Mobile.*Firefox/i.test(UA) || Math.min(screen.width, screen.height) < 600;
const isMobile = isPhone || isIPad || /Android/i.test(UA);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

// ------------------------------------------------------------------ smooth scroll
const lenis = new window.Lenis({ lerp: reduced ? 1 : 0.085, wheelMultiplier: 0.9, touchMultiplier: 1.4, smoothWheel: !reduced });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.lagSmoothing(0);
lenis.stop();

// ------------------------------------------------------------------ world
const canvas = $('#gl');
let world = null;
try {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) throw new Error('no webgl2');
  world = new World(canvas, { quality: 'medium' });
} catch (e) {
  console.warn('WebGL unavailable — showing the book without the live world.', e);
  document.body.classList.add('no-gl');
  $$('[data-fb]').forEach((s) => { s.style.backgroundImage = `url(${s.dataset.fb})`; });
}

// if the browser ever drops the GPU context, fall back to the static book instead of a black screen
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  document.body.classList.add('no-gl');
  $$('[data-fb]').forEach((s) => { s.style.backgroundImage = `url(${s.dataset.fb})`; });
  if (world) world.paused = true;
  world = null;
}, false);

function pickQuality() {
  if (QS.get('q')) return QS.get('q');
  try {
    const gl = world.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu)) return 'low';
    if (isIPad) return 'medium';                                 // Apple tablets: medium, and it steps down by itself if needed
    if (isMobile) return 'low';
    if (/Intel.*(UHD|HD Graphics)|Mali|Adreno|PowerVR/i.test(gpu)) return 'low';
    if (/NVIDIA|GeForce|RTX|Radeon RX|Radeon Pro|Apple M\d/i.test(gpu)) return 'high';
    return 'medium';
  } catch (e) { return 'medium'; }
}
if (world) world.setQuality(pickQuality());

// ------------------------------------------------------------------ tour sections
const worldSections = $$('section.ch[data-station]').map((el) => ({ el, station: el.dataset.station }));
const tour = new Tour(worldSections);
// Layout is measured here, once per real layout change, never inside the frame loop (reading offsets every frame
// forced a synchronous layout per frame and was the main source of stutter on tablets).
let docH = 0;
const LAY = { maxY: 1, vh: innerHeight, vw: innerWidth, pages: [], chapters: [], secs: new Map() };
const absTop = (el) => el.getBoundingClientRect().top + window.scrollY;
function measure() {
  LAY.vh = innerHeight; LAY.vw = innerWidth;
  LAY.maxY = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  LAY.pages = $$('.page').map((p) => { const t = absTop(p); return { t, b: t + p.offsetHeight, dark: p.classList.contains('page--dark') }; });
  LAY.chapters = $$('[data-chapter]').map((el) => ({ el, t: absTop(el), c: el.dataset.chapter }));
  $$('main > section').forEach((el) => LAY.secs.set(el, { t: absTop(el), h: el.offsetHeight }));
  if (typeof measureAnnos === 'function') measureAnnos();
}
let rebuildT = 0;
const rebuild = () => { measure(); tour.build(); ScrollTrigger.refresh(); placeGauge(); measure(); docH = document.documentElement.scrollHeight; };
const rebuildSoon = () => { clearTimeout(rebuildT); rebuildT = setTimeout(rebuild, 180); };
new ResizeObserver(() => { if (Math.abs(document.documentElement.scrollHeight - docH) > 2) rebuildSoon(); }).observe($('main'));
// a phone or tablet toolbar sliding in or out is also a 'resize': the canvas (100lvh) does not change, and the
// layout only needs measuring again when the width changes or the height changes a lot (rotation, split view)
let lastW = innerWidth, lastH = innerHeight;
window.addEventListener('resize', () => {
  world?.resize();
  if (innerWidth !== lastW || Math.abs(innerHeight - lastH) > 160) { lastW = innerWidth; lastH = innerHeight; rebuildSoon(); }
});
window.addEventListener('pointermove', (e) => {
  tour.mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
}, { passive: true });

// ------------------------------------------------------------------ loader
const loader = $('#loader');
const pctEl = $('.ld-pct'), arcEl = $('.ld-ring .arc'), tickEls = $$('.ld-ring .tk'), whatEl = $('.ld-what'), noteEl = $('.ld-note-text');
let shown = 0;
if (world) {
  world.onProgress = (f) => {
    shown = Math.max(shown, f);
    pctEl.textContent = Math.round(shown * 100);
    arcEl.style.strokeDashoffset = `${1 - shown}`;
    tickEls.forEach((t, i) => t.classList.toggle('on', shown >= (i + 1) / 12));
    if (shown > 0.35 && whatEl.dataset.k !== '1') { whatEl.dataset.k = '1'; whatEl.textContent = 'laying the stones'; }
    if (shown > 0.7 && whatEl.dataset.k !== '2') { whatEl.dataset.k = '2'; whatEl.textContent = 'growing the ivy'; }
  };
  world.onStatue = () => {
    gsap.to('.ld-note', { opacity: 1, duration: 1.4, delay: 0.5, ease: 'power2.out' });
    drawStrokes($$('.ld-note .draw'), 1.1, 0.9);
  };
}

// split the title into letters for the slide-in
$$('.title .ln').forEach((ln) => {
  const words = ln.textContent.trim().split(/\s+/);
  ln.textContent = '';
  words.forEach((w, wi) => {
    const word = document.createElement('span');
    word.className = 'wd';
    for (const c of w) {
      const s = document.createElement('span');
      s.className = 'ch-l';
      s.textContent = c;
      word.appendChild(s);
    }
    ln.appendChild(word);
    if (wi < words.length - 1) ln.appendChild(document.createTextNode(' '));
  });
});
gsap.set(['.intro .emblem', '.title .ch-l', '.byline', '.inscr', '.inscr-tr', '.intro .note--why'], { opacity: 0 });

const intro = { p: 0, done: false };
const LOADER = (() => {
  const s = STATIONS.loader;
  return { pos: new THREE.Vector3(...s.pos), target: new THREE.Vector3(...s.target), fov: s.fov, s };
})();

function startIntro() {
  if (!world) return finishIntro(true);
  const skip = QS.has('skip') || reduced;
  world.statueMode = 'face';
  whatEl.textContent = 'she has seen you';
  pctEl.textContent = '100';
  noteEl.innerHTML = '&hellip;there. she has seen you.';
  if (skip) { intro.p = 1; finishIntro(true); return; }
  const tl = gsap.timeline();
  tl.to(intro, { p: 1, duration: 3.6, ease: 'power2.inOut' }, 1.5)
    .add(() => loader.classList.add('is-done'), 2.2)
    .fromTo('.intro .emblem', { opacity: 0, scale: 0.6, rotate: -60 }, { opacity: 1, scale: 1, rotate: 0, duration: 1.6, ease: 'power3.out' }, 2.6)
    .fromTo('.title .ch-l', { yPercent: 118, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.2, stagger: 0.045, ease: 'power4.out' }, 2.8)
    .fromTo('.byline', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 1 }, 3.7)
    .fromTo('.inscr', { opacity: 0, letterSpacing: '0.9em' }, { opacity: 1, letterSpacing: '0.42em', duration: 1.8, ease: 'power3.out' }, 3.9)
    .fromTo('.inscr-tr', { opacity: 1, clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.6, ease: 'power1.inOut' }, 4.5)
    .fromTo('.intro .note--why', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 1.2 }, 5.2)
    .add(() => finishIntro(false), 4.6)
    .to('.scroll-hint', { opacity: 1, duration: 1.2 }, 5.6);
}

function finishIntro(instant) {
  intro.done = true;
  intro.p = 1;
  if (world) world.statueMode = 'track';
  if (instant) {
    loader.classList.add('is-done');
    gsap.set(['.intro .emblem', '.title .ch-l', '.byline', '.inscr', '.inscr-tr', '.intro .note--why', '.scroll-hint'], { opacity: 1, clearProps: 'transform,clipPath' });
  }
  document.body.classList.remove('is-loading');
  document.body.classList.add('is-ready');
  lenis.start();
  const introSec = $('#s-intro');
  gsap.fromTo($$('.ch__text, .note, .scroll-hint', introSec), { opacity: 1, y: 0 }, { opacity: 0, y: -40, ease: 'none', immediateRender: false,
    scrollTrigger: { trigger: introSec, start: 'top top', end: 'bottom 30%', scrub: true } });
  rebuild();
  setTimeout(() => loader.remove(), 1600);
  const at = QS.get('at');
  if (at && $('#' + at)) {
    const el = $('#' + at);
    const off = parseFloat(QS.get('off') || '0.45');
    lenis.scrollTo(el.offsetTop + Math.max(0, el.offsetHeight - innerHeight) * off, { immediate: true, force: true });
  }
}

// ------------------------------------------------------------------ book pages: reveals, drawings, strip, counters
function drawStrokes(paths, dur = 1.2, delay = 0) {
  paths.forEach((p, i) => {
    const L = p.getTotalLength ? p.getTotalLength() : 200;
    p.style.strokeDasharray = `${L}`;
    gsap.fromTo(p, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: dur, delay: delay + i * 0.08, ease: 'power2.inOut' });
  });
}

function initPages() {
  $$('[data-r]').forEach((el) => {
    gsap.fromTo(el, { opacity: 0, y: 46, rotate: (parseFloat(getComputedStyle(el).getPropertyValue('--r')) || 0) - 1.2 },
      { opacity: 1, y: 0, rotate: parseFloat(getComputedStyle(el).getPropertyValue('--r')) || 0, duration: 1.1, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
  });
  // the plan + elevation sheets (traced from the model) wipe in like a pen crossing the paper; on phones they drop their
  // side labels and crop to the drawing, and a caption under each says the rest
  const phone = window.matchMedia('(max-width: 640px)');
  const fitSheets = () => $$('svg[data-vb-tight]').forEach((s) => s.setAttribute('viewBox', phone.matches ? s.dataset.vbTight : s.dataset.vbWide));
  fitSheets();
  phone.addEventListener?.('change', fitSheets);
  $$('.drawing').forEach((svg) => gsap.fromTo(svg, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 2.4, ease: 'power1.inOut',
    scrollTrigger: { trigger: svg, start: 'top 88%', once: true } }));
  // red-pencil marks: built once the element (and its picture) is in view, then drawn in
  $$('[data-mk]').forEach((el) => {
    ScrollTrigger.create({ trigger: el, start: 'top 80%', once: true, onEnter: async () => {
      const img = el.tagName === 'IMG' ? el : el.querySelector('img');
      if (img && !img.complete) await new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });
      const m = buildMark(el);
      if (!m) return;
      el.dataset.mkDrawn = '1';
      gsap.fromTo(m.p, { strokeDashoffset: m.L }, { strokeDashoffset: 0, duration: 1.0 + Math.min(1.2, m.L / 800), delay: 0.45, ease: 'power2.inOut' });
    } });
  });
  let mkT = 0;
  window.addEventListener('resize', () => { clearTimeout(mkT); mkT = setTimeout(rebuildDrawn, 300); });
  // first-light film strip drifts sideways while you scroll past it
  $$('[data-strip]').forEach((wrap) => {
    const strip = $('.strip', wrap);
    gsap.fromTo(strip, { x: 0 }, { x: () => -(strip.scrollWidth - wrap.clientWidth), ease: 'none',
      scrollTrigger: { trigger: wrap, start: 'top 90%', end: 'bottom 10%', scrub: 0.8, invalidateOnRefresh: true } });
  });
  // counters
  $$('[data-count]').forEach((b) => {
    const to = parseFloat(b.dataset.count), dec = parseInt(b.dataset.dec || '0', 10), suf = b.dataset.suf || '';
    const o = { v: 0 };
    ScrollTrigger.create({ trigger: b.closest('section'), start: 'top 20%', once: true,
      onEnter: () => gsap.to(o, { v: to, duration: 2.4, ease: 'power2.out', onUpdate: () => { b.textContent = (dec ? o.v.toFixed(dec) : Math.round(o.v).toLocaleString('en-US')) + suf; } }) });
  });
  // gallery lightbox
  const lb = $('.lightbox'), lbImg = $('img', lb);
  $$('.gallery figure').forEach((f) => f.addEventListener('click', () => {
    const im = $('img', f);
    lbImg.src = im.currentSrc || im.src; lbImg.alt = im.alt;
    lb.classList.add('on'); lenis.stop();
  }));
  lb.addEventListener('click', () => { lb.classList.remove('on'); lenis.start(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb.classList.contains('on')) { lb.classList.remove('on'); lenis.start(); } });

  // world chapters: their text fades in as the camera arrives and out as it leaves
  for (const { el } of worldSections) {
    if (el.id === 's-intro') continue;                          // its scroll-out is created once the intro has played
    const items = $$('.ch__text, .ch__num, .note', el);
    const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: 'top 75%', end: 'bottom 25%', scrub: 0.5 } });
    tl.fromTo(items, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.18, stagger: 0.02, ease: 'power2.out' })
      .to(items, { opacity: 1, duration: 0.62 })
      .to(items, { opacity: 0, y: -40, duration: 0.18, ease: 'power2.in' });
  }
  // the rule, one sentence at a time
  const rule = $('#s-noentry');
  if (rule) {
    const ps = $$('[data-rule]', rule);
    ScrollTrigger.create({ trigger: rule, start: 'top top', end: 'bottom bottom', onUpdate: (st) => {
      ps.forEach((p) => p.classList.toggle('on', st.progress >= 0.06 + parseInt(p.dataset.rule, 10) * 0.2));
      if (st.progress > 0.66) raiseFinger('rule');
    } });
  }
}

// ------------------------------------------------------------------ the water gauge + fingers
const gauge = $('.gauge'), gaugeFill = $('.gauge .fill'), fingersEl = $('.gauge .fingers');
const chapterSecs = $$('section.ch[data-chapter]').filter((s) => /^[IVX]+\|/.test(s.dataset.chapter));
const raised = new Set();
let visits = 1;
try { visits = (parseInt(localStorage.getItem('rotunda-visits') || '0', 10) || 0) + 1; localStorage.setItem('rotunda-visits', String(visits)); } catch (e) { /* private mode */ }
function raiseFinger(key) {
  if (raised.has(key)) return;
  raised.add(key);
  const n = raised.size;
  sound.swell();
  fingersEl.textContent = `+${n} finger${n > 1 ? 's' : ''}`;
  gsap.fromTo(fingersEl, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 });
  const fc = $('.finger-count');
  if (fc) fc.textContent = `the water has risen ${n} finger${n > 1 ? 's' : ''} since you came in` + (visits > 1 ? ` (and this is your visit nº ${visits})` : '') + '.';
}
function placeGauge() {
  $$('button', gauge).forEach((b) => b.remove());
  const H = document.documentElement.scrollHeight - innerHeight;
  for (const s of chapterSecs) {
    const [n, t] = s.dataset.chapter.split('|');
    const b = document.createElement('button');
    b.type = 'button';
    b.style.bottom = `${(s.offsetTop / H) * 100}%`;
    b.innerHTML = `<span>${n}</span>`;
    b.setAttribute('aria-label', `Chapter ${n}: ${t}`);
    b.addEventListener('click', () => lenis.scrollTo(s.offsetTop + Math.max(0, s.offsetHeight - innerHeight) * 0.4, { duration: 2.4 }));
    b._sec = s;
    gauge.appendChild(b);
  }
}

// ------------------------------------------------------------------ HUD
const chapN = $('.chapter-n'), chapT = $('.chapter-t');
const labelled = $$('[data-chapter]');
let lastChapter = '';
let lastFill = -1;
function updateHud(y) {
  const f = Math.min(100, (y / LAY.maxY) * 100);
  if (Math.abs(f - lastFill) > 0.05) { lastFill = f; gaugeFill.style.transform = `scaleY(${(f / 100).toFixed(4)})`; }
  const mid = y + LAY.vh * 0.5;
  let cur = LAY.chapters[0]?.el;
  for (const ch of LAY.chapters) if (ch.t <= mid) cur = ch.el;
  const c = cur?.dataset.chapter || '';
  if (c !== lastChapter) {
    lastChapter = c;
    const [n, t] = c.split('|');
    chapN.innerHTML = n || '&nbsp;';
    chapT.textContent = t || '';
    if (/^[IVX]+$/.test(n)) raiseFinger(n);
    if (n === 'III' && !cur._rang) { cur._rang = true; sound.bells(); }
    $$('button', gauge).forEach((b) => b.classList.toggle('on', b._sec === cur));
  }
}

// ------------------------------------------------------------------ 3D-anchored annotations
// Each label hangs off its 3D point on a leader. Which way the leader goes is decided per frame from four mirrored
// options, so on any screen shape the label stays on screen and off the chapter text, the notes, the HUD and the gauge.
const annos = $$('.anno').map((el) => ({ el, sec: el.closest('section'), dot: $('.dot', el), lead: $('.lead', el), lbl: $('.lbl', el),
  at: el.dataset.at ? new THREE.Vector3(...el.dataset.at.split(',').map(Number)) : null,
  dx: parseFloat(el.dataset.dx || '80'), dy: parseFloat(el.dataset.dy || '-80'), hole: el.dataset.hole, sign: el.hasAttribute('data-sign'),
  statue: el.hasAttribute('data-statue'), dir: -1, w: 0, h: 0 }));
const DIRS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
function setDir(a, k) {
  a.dir = k;
  const dx = a.dx * DIRS[k][0], dy = a.dy * DIRS[k][1];
  const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  a.lead.style.width = `${len}px`;
  a.lead.style.transform = `rotate(${ang}rad)`;
  a.lbl.style.left = `${dx}px`;
  a.lbl.style.top = `${dy}px`;
  a.lbl.style.transform = `translate(${dx < 0 ? '-100%' : '0'}, ${dy < 0 ? '-100%' : '0'}) translate(${dx < 0 ? -8 : 8}px, 0)`;
}
annos.forEach((a) => setDir(a, 0));
// keep-out boxes per chapter, in stage (= screen) coordinates; measured with the layout, never per frame
function measureAnnos() {
  LAY.keep = new Map();
  for (const { el } of worldSections) {
    const boxes = $$('.ch__text, .note, .ch__num', el).filter((e) => e.offsetParent).map((e) => ({ x: e.offsetLeft - 14, y: e.offsetTop - 14, w: e.offsetWidth + 28, h: e.offsetHeight + 28 }));
    LAY.keep.set(el, boxes);
  }
  for (const a of annos) { a.w = a.lbl.offsetWidth; a.h = a.lbl.offsetHeight; }
}
const overlap = (x, y, w, h, b) => Math.max(0, Math.min(x + w, b.x + b.w) - Math.max(x, b.x)) * Math.max(0, Math.min(y + h, b.y + b.h) - Math.max(y, b.y));
function labelBox(a, k, sx, sy) {
  const dx = a.dx * DIRS[k][0], dy = a.dy * DIRS[k][1];
  return { x: sx + dx + (dx < 0 ? -8 - a.w : 8), y: sy + dy + (dy < 0 ? -a.h : 0), w: a.w, h: a.h };
}
function badness(a, k, sx, sy, keep, placed) {
  const b = labelBox(a, k, sx, sy), vw = LAY.vw, vh = LAY.vh;
  const m = 10, top = 66, right = vw > 640 ? 70 : 10;          // HUD band and the gauge
  const inside = Math.max(0, Math.min(b.x + b.w, vw - right) - Math.max(b.x, m)) * Math.max(0, Math.min(b.y + b.h, vh - m) - Math.max(b.y, top));
  let bad = (b.w * b.h - inside) * 2;
  for (const r of keep) bad += overlap(b.x, b.y, b.w, b.h, r);
  for (const r of placed) bad += overlap(b.x, b.y, b.w, b.h, r) * 1.5;
  return { bad, b };
}
const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function updateAnnos(y) {
  if (!world?.ready.world) return;
  let placedSec = null, placed = [];
  for (const a of annos) {
    const S = LAY.secs.get(a.sec);
    if (!S) continue;
    const inHold = y > S.t + (S.h - LAY.vh) * 0.2 && y < S.t + (S.h - LAY.vh) * 0.8;
    if (!inHold) { if (a.on) { a.on = false; a.el.classList.remove('on'); } continue; }
    if (a.hole != null) _v.set(...world.meta.holes[+a.hole].slice(0, 3));
    else if (a.sign) _v.copy(world.signAnchor).add(new THREE.Vector3(0, 0.35, 0));
    else _v.copy(a.at);
    if (a.statue) _v.applyAxisAngle(_up, world.statueYaw);
    world.project(_v, _v);
    let vis = _v.z < 1 && Math.abs(_v.x) < 0.92 && Math.abs(_v.y) < 0.92;
    const sx = (_v.x * 0.5 + 0.5) * LAY.vw, sy = (-_v.y * 0.5 + 0.5) * LAY.vh;
    if (vis) {
      if (placedSec !== a.sec) { placedSec = a.sec; placed = []; }
      const keep = LAY.keep?.get(a.sec) || [];
      // the anchor itself must not sit under the text
      if (keep.some((r) => sx > r.x && sx < r.x + r.w && sy > r.y && sy < r.y + r.h)) vis = false;
      else {
        const cur = a.dir >= 0 ? badness(a, a.dir, sx, sy, keep, placed) : { bad: Infinity };
        let best = a.dir, bestS = cur;
        if (cur.bad > 0) for (let k = 0; k < 4; k++) { if (k === a.dir) continue; const sc = badness(a, k, sx, sy, keep, placed); if (sc.bad < bestS.bad * 0.6) { best = k; bestS = sc; } }
        if (best !== a.dir) setDir(a, best);
        if (bestS.bad > a.w * a.h * 0.2) vis = false;               // nowhere clean to put it: leave it out
        else placed.push(bestS.b);
      }
    }
    if (vis !== a.on) { a.on = vis; a.el.classList.toggle('on', vis); }
    if (!vis) continue;
    a.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
  }
}

// ------------------------------------------------------------------ breakdown labels
const modeLis = $$('.modes li');
let lastMode = -1;
function updateModes(m, station) {
  const mm = station === 'breakdown' ? m : -1;
  if (mm === lastMode) return;
  lastMode = mm;
  modeLis.forEach((li) => li.classList.toggle('on', +li.dataset.mode === mm));
}

// ------------------------------------------------------------------ sound (off until asked)
const sound = new Sound();
const soundBtn = $('.btn-sound');
soundBtn.addEventListener('click', async () => {
  const on = await sound.toggle();
  soundBtn.setAttribute('aria-pressed', String(on));
  if (on && lastChapter.startsWith('III|')) sound.bells();
});
document.addEventListener('visibilitychange', () => {
  if (!sound.ctx) return;
  if (document.hidden) sound.ctx.suspend(); else if (sound.on) sound.ctx.resume();
});

// ------------------------------------------------------------------ sketch toggle
const sketchBtn = $('.btn-sketch:not(.btn-sound)');
const userSketch = { v: 0 };
sketchBtn.addEventListener('click', () => {
  const on = sketchBtn.getAttribute('aria-pressed') !== 'true';
  sketchBtn.setAttribute('aria-pressed', String(on));
  gsap.to(userSketch, { v: on ? 1 : 0, duration: 1.6, ease: 'power2.inOut' });
});

// ------------------------------------------------------------------ cursor
const cursor = $('.cursor');
const cur = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2 };
if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced) {
  window.addEventListener('pointermove', (e) => {
    cur.tx = e.clientX; cur.ty = e.clientY;
    cursor.classList.add('live');
    cursor.classList.toggle('big', !!e.target.closest('a, button, .gallery figure, .gauge button'));
  }, { passive: true });
  document.addEventListener('pointerleave', () => cursor.classList.remove('live'));
  gsap.ticker.add(() => {
    cur.x += (cur.tx - cur.x) * 0.2; cur.y += (cur.ty - cur.y) * 0.2;
    cursor.style.transform = `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0)`;
  });
}

// ------------------------------------------------------------------ frame loop
const pages = $$('.page');
let onPaper = false;
let worldPaper = false;                                          // the world itself is drawn on cream paper (the plan)
function pageCovers(y = window.scrollY) {
  // also: is light paper under the HUD (top of the screen)? then the HUD switches to ink
  let covers = false, paper = worldPaper;
  for (const p of LAY.pages) {
    if (p.t - y <= -44 && p.b - y >= LAY.vh + 44) covers = true;
    if (p.t - y <= 60 && p.b - y >= 80 && !p.dark) paper = true;
  }
  if (paper !== onPaper) { onPaper = paper; document.body.classList.toggle('on-paper', paper); }
  return covers;
}
const lerp = (a, b, t) => a + (b - a) * t;
const PARAM_KEYS = ['clip', 'sketch', 'paper', 'shafts', 'dust', 'fog', 'exposure', 'ground', 'sky', 'mode', 'water', 'track', 'loaderLight', 'bloom', 'vignette', 'dome', 'poche', 'fill', 'sun'];
let ema = 16, slowFor = 0, lastT = 0;
const fpsEl = QS.has('debug') ? Object.assign(document.body.appendChild(document.createElement('div')), { style: 'position:fixed;left:8px;bottom:8px;z-index:99;font:12px monospace;color:#9f9;background:#000a;padding:4px 6px' }) : null;

let ySm = 0, yPrev = 0;
const NORENDER = QS.has('norender');                          // layout tests: run the tour without drawing
gsap.ticker.add((time, deltaMs) => {
  lenis.raf(time * 1000);
  const y = window.scrollY;
  if (!world) { pageCovers(y); if (intro.done) updateHud(y); return; }
  const dt = Math.min(deltaMs / 1000, 0.1);
  // the camera follows a softened scroll: frame-rate independent, so a flick on a touch screen becomes a glide
  // (a jump of several screens in one frame — Home/End, a deep link — cuts straight there instead of flying the whole tour)
  if (Math.abs(y - yPrev) > LAY.vh * 3) ySm = y;
  yPrev = y;
  ySm += (y - ySm) * (1 - Math.exp(-dt * 5.5));
  if (Math.abs(y - ySm) < 0.05) ySm = y;
  const s = tour.sample(ySm, time);
  let pos = s.pos, target = s.target, fov = s.fov, params = {};
  for (const k of PARAM_KEYS) params[k] = s[k];
  if (!intro.done || intro.p < 1) {
    const k = intro.p, e = k * k * (3 - 2 * k);
    pos = LOADER.pos.clone().lerp(s.pos, e);
    target = LOADER.target.clone().lerp(s.target, e);
    fov = lerp(LOADER.fov, s.fov, e);
    for (const key of PARAM_KEYS) params[key] = lerp(LOADER.s[key] ?? s[key], s[key], key === 'sketch' ? Math.min(1, k * 1.15) : e);
  }
  params.water += Math.min(raised.size, 8) * 0.012;
  // between stations the world redraws itself: half sketch mid-journey, render again on arrival
  if (intro.done && s.transit > 0) params.sketch = Math.max(params.sketch, s.transit * s.transit * 0.55);
  if (userSketch.v > 0) { params.sketch = Math.max(params.sketch, userSketch.v); params.paper = lerp(params.paper, 1, userSketch.v); }
  world.setView(pos, target, fov);
  world.setParams(params);
  worldPaper = params.paper * Math.max(params.sketch, 0) > 0.5;
  world.paused = pageCovers(y) || NORENDER;
  world.render(time, dt);
  if (intro.done) { updateHud(y); updateAnnos(ySm); updateModes(Math.round(params.mode), s.station); }

  // keep it smooth: step quality down if frames stay slow
  if (!world.paused && intro.done) {
    ema = ema * 0.94 + deltaMs * 0.06;
    slowFor = ema > 21 ? slowFor + deltaMs : 0;
    if (slowFor > 2000 && !QS.get('q') && world.q !== 'low') {
      slowFor = 0;
      world.setQuality(world.q === 'high' ? 'medium' : 'low');
    }
  }
  if (fpsEl && time - lastT > 0.5) { lastT = time; fpsEl.textContent = `${(1000 / ema).toFixed(0)} fps · ${world.q} · ${s.station} · y ${y | 0}`; }
});

// ------------------------------------------------------------------ boot
async function boot() {
  try { await Promise.race([Promise.all(['600 1em Cinzel', '500 1em Caveat', '400 1em "Reenie Beanie"'].map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fonts are optional */ }
  if (!world) { initPages(); finishIntro(true); return; }
  try {
    await world.load();
    initPages();
    startIntro();
  } catch (e) {
    console.error(e);
    document.body.classList.add('no-gl');
    $$('[data-fb]').forEach((s) => { s.style.backgroundImage = `url(${s.dataset.fb})`; });
    world = null;
    canvas.style.display = 'none';
    initPages();
    finishIntro(true);
  }
}
boot();
window.__rotunda = { get world() { return world; }, tour, lenis, snap: () => { ySm = yPrev = window.scrollY; } };
