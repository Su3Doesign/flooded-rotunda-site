// Layout audit: horizontal overflow, overlapping text, SVG label collisions, 3D annotation labels vs. chapter text.
// usage: node audit.js OUTDIR W H [gl|nogl] [shots]
const { chromium } = require('playwright');
const SITE = process.env.SITE || 'http://127.0.0.1:8000';   // serve the site first: python3 -m http.server 8000
const fs = require('fs');
const out = process.argv[2], W = +(process.argv[3] || 1440), H = +(process.argv[4] || 900), mode = process.argv[5] || 'nogl';
const shots = process.argv[6] === 'shots';
fs.mkdirSync(out, { recursive: true });

const CHECKS = () => {
  const vw = innerWidth, vh = innerHeight, res = { overflow: [], text: [], svg: [], mnoteImg: [] };
  const vis = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
    }
    return true;
  };
  const name = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = el.getAttribute('class') ? '.' + el.getAttribute('class').trim().split(/\s+/).join('.') : '';
    const sec = el.closest('section, article, footer');
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42);
    return `${sec ? (sec.id || sec.tagName) : '-'} ${el.tagName.toLowerCase()}${id}${cls} "${t}"`;
  };
  // 1. horizontal overflow (html, body and .page clip as a safety net; anything they would hide is still a bug)
  const safety = new Set([document.documentElement, document.body, ...document.querySelectorAll('.page')]);
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let L = r.left, R = r.right;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (safety.has(a)) continue;
      const ox = getComputedStyle(a).overflowX;
      if (ox !== 'visible') { const ar = a.getBoundingClientRect(); L = Math.max(L, ar.left); R = Math.min(R, ar.right); }
    }
    if (R > vw + 1 || L < -1) res.overflow.push(`${name(el)} [${L.toFixed(0)}..${R.toFixed(0)}] vw=${vw}`);
  }
  // 2. text-on-text overlaps, per group (a sticky stage or a book page)
  const groups = [...document.querySelectorAll('.ch__stage, .page, .colophon')];
  for (const g of groups) {
    const gr = g.getBoundingClientRect();
    if (gr.bottom < -vh * 0.1 || gr.top > vh * 1.1) continue;     // only what is on screen now
    const items = [];
    const walker = document.createTreeWalker(g, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (el.closest('svg') || el.closest('[aria-hidden="true"]')) continue;
      if (!vis(el)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      // glyph boxes are taller than the ink (accent room, line gaps): judge on the middle 64%
      for (const r of range.getClientRects()) if (r.width > 2 && r.height > 2) items.push({ el, r: { left: r.left, right: r.right, top: r.top + r.height * 0.18, bottom: r.bottom - r.height * 0.18, height: r.height * 0.64 } });
    }
    // decorative chapter numerals count too: they are big
    g.querySelectorAll('.ch__num').forEach((el) => { if (vis(el)) items.push({ el, r: el.getBoundingClientRect(), deco: true }); });
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
      if (A.el.closest('.title') && A.el.closest('.title') === B.el.closest('.title')) continue;   // one word split into letters
      const ix = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left), iy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (ix > 2 && iy > Math.max(4, 0.22 * Math.min(A.r.height, B.r.height))) res.text.push(`${A.deco || B.deco ? '(numeral) ' : ''}${name(A.el)}  X  ${name(B.el)}  (${ix.toFixed(0)}x${iy.toFixed(0)})`);
    }
    // margin notes lying on pictures
    g.querySelectorAll('.mnote').forEach((m) => {
      if (!vis(m)) return;
      const mr = m.getBoundingClientRect();
      g.querySelectorAll('img').forEach((im) => {
        const r = im.getBoundingClientRect();
        const ix = Math.min(mr.right, r.right) - Math.max(mr.left, r.left), iy = Math.min(mr.bottom, r.bottom) - Math.max(mr.top, r.top);
        if (ix > 4 && iy > 4) res.mnoteImg.push(`${name(m)}  on  ${im.getAttribute('src')} (${ix.toFixed(0)}x${iy.toFixed(0)})`);
      });
    });
  }
  // 3. SVG drawings: label collisions and labels running outside the sheet
  document.querySelectorAll('svg.drawing').forEach((svg) => {
    const sr = svg.getBoundingClientRect();
    const ts = [...svg.querySelectorAll('text')].map((t) => ({ t, r: t.getBoundingClientRect() })).filter((x) => x.r.width > 0);   // hidden (phone) labels have no box
    for (let i = 0; i < ts.length; i++) {
      const A = ts[i];
      if (A.r.left < sr.left - 2 || A.r.right > sr.right + 2 || A.r.top < sr.top - 2 || A.r.bottom > sr.bottom + 2) res.svg.push(`outside: "${A.t.textContent}"`);
      for (let j = i + 1; j < ts.length; j++) {
        const B = ts[j];
        const ix = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left), iy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
        if (ix > 1 && iy > 1) res.svg.push(`overlap: "${A.t.textContent}" X "${B.t.textContent}"`);
      }
    }
  });
  res.scrollW = document.documentElement.scrollWidth;
  res.vw = vw;
  return res;
};

const ANNOS = () => {
  const vw = innerWidth, vh = innerHeight, out = [];
  const sec = [...document.querySelectorAll('main > section')].find((s) => { const r = s.getBoundingClientRect(); return r.top <= 1 && r.bottom >= vh - 1; });
  if (!sec) return out;
  const blocks = [];
  sec.querySelectorAll('.ch__text, .note, .ch__num').forEach((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 2) blocks.push({ el, r });
    }
    if (el.classList.contains('ch__num')) blocks.push({ el, r: el.getBoundingClientRect() });
  });
  const hud = [document.querySelector('#hud .brand'), document.querySelector('#hud .right'), document.querySelector('.gauge')].filter(Boolean).map((e) => ({ el: e, r: e.getBoundingClientRect() }));
  const annos = [...sec.querySelectorAll('.anno.on')];
  const boxes = annos.map((a) => {
    const lbl = a.querySelector('.lbl'), dot = a.querySelector('.dot');
    return { a, lbl: lbl.getBoundingClientRect(), dot: dot.getBoundingClientRect(), text: lbl.textContent.trim() };
  });
  for (const b of boxes) {
    const why = [];
    const R = b.lbl;
    if (R.left < 8 || R.right > vw - 8 || R.top < 8 || R.bottom > vh - 8) why.push('off-screen');
    for (const t of [...blocks, ...hud]) {
      const ix = Math.min(R.right, t.r.right) - Math.max(R.left, t.r.left), iy = Math.min(R.bottom, t.r.bottom) - Math.max(R.top, t.r.top);
      if (ix > 0 && iy > 0) { why.push(`hits ${t.el.className || t.el.tagName}`); break; }
    }
    for (const c of boxes) {
      if (c === b) continue;
      const ix = Math.min(R.right, c.lbl.right) - Math.max(R.left, c.lbl.left), iy = Math.min(R.bottom, c.lbl.bottom) - Math.max(R.top, c.lbl.top);
      if (ix > 0 && iy > 0) why.push(`hits label "${c.text}"`);
    }
    out.push(`${sec.id} "${b.text}" dot(${b.dot.x.toFixed(0)},${b.dot.y.toFixed(0)}) lbl[${R.left.toFixed(0)},${R.top.toFixed(0)} ${R.width.toFixed(0)}x${R.height.toFixed(0)}] ${why.length ? 'BAD: ' + why.join('; ') : 'ok'}`);
  }
  const all = [...sec.querySelectorAll('.anno')].length;
  if (all > annos.length) out.push(`${sec.id}: ${all - annos.length} of ${all} labels hidden (anchor off-screen)`);
  return out;
};

(async () => {
  const args = mode === 'gl' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--disable-3d-apis', '--disable-webgl'];
  const browser = await chromium.launch({ args });
  const touch = W < 1100 || process.env.TOUCH;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: !!touch });
  const logs = [];
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') logs.push('[console] ' + m.text()); });
  await page.goto(`${SITE}/?skip${mode === 'gl' ? '&q=low&norender' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 400000 });
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 500) { await page.evaluate((y) => window.__rotunda.lenis.scrollTo(y, { immediate: true, force: true }), y); await page.waitForTimeout(90); }
  await page.waitForTimeout(2500);
  const report = { size: `${W}x${H}`, mode, sections: {} };
  const ids = await page.evaluate(() => [...document.querySelectorAll('main > section, main > article, footer')].map((e) => e.id || 'footer'));
  for (const id of ids) {
    const offs = id.startsWith('s-') ? [0.5] : null;
    const sel = id === 'footer' ? 'footer' : '#' + id;
    const H2 = await page.evaluate((sel) => document.querySelector(sel).offsetHeight, sel);
    const stops = offs ? offs.map((o) => ({ o })) : Array.from({ length: Math.max(1, Math.ceil(H2 / (H * 0.8))) }, (_, k) => ({ px: k * H * 0.8 }));
    for (const st of stops) {
      await page.evaluate(([sel, st]) => {
        const el = document.querySelector(sel);
        const y = st.o != null ? el.offsetTop + Math.max(0, el.offsetHeight - innerHeight) * st.o : el.offsetTop + st.px;
        window.__rotunda.lenis.scrollTo(y, { immediate: true, force: true });
        window.__rotunda.snap?.();
      }, [sel, st]);
      await page.waitForTimeout(mode === 'gl' ? 1600 : 700);
      const r = await page.evaluate(CHECKS);
      const a = mode === 'gl' && id.startsWith('s-') ? await page.evaluate(ANNOS) : [];
      const key = `${id}@${st.o ?? st.px}`;
      const uniq = (xs) => [...new Set(xs)];
      report.sections[key] = { overflow: uniq(r.overflow), text: uniq(r.text), svg: uniq(r.svg), mnoteImg: uniq(r.mnoteImg), annos: a, scrollW: r.scrollW };
      if (shots && (id.startsWith('s-') || mode === 'nogl')) await page.screenshot({ path: `${out}/${String(Object.keys(report.sections).length).padStart(2, '0')}_${id}_${st.o ?? st.px}.jpg`, type: 'jpeg', quality: 70 });
    }
  }
  report.logs = logs;
  fs.writeFileSync(`${out}/report_${W}x${H}_${mode}.json`, JSON.stringify(report, null, 1));
  // summary: each finding once, with the first place it was seen
  const seen = new Map();
  for (const [k, v] of Object.entries(report.sections)) {
    const bad = [...v.overflow.map((x) => 'OVERFLOW ' + x), ...v.text.map((x) => 'TEXT ' + x), ...v.svg.map((x) => 'SVG ' + x), ...v.mnoteImg.map((x) => 'NOTE-ON-IMG ' + x), ...v.annos.filter((x) => /BAD|hidden/.test(x)).map((x) => 'ANNO ' + x)];
    if (v.scrollW > W) bad.unshift(`SCROLLWIDTH ${v.scrollW} > ${W}`);
    for (const b of bad) if (!seen.has(b)) seen.set(b, k);
  }
  for (const [b, k] of seen) console.log(`  [${k}] ${b}`);
  console.log(`${W}x${H} ${mode}: ${seen.size} findings`, logs.length ? logs.join('\n') : '');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
