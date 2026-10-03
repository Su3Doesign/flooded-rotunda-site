const { chromium } = require('playwright');
const SITE = process.env.SITE || 'http://127.0.0.1:8000';   // serve the site first: python3 -m http.server 8000
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  page.on('requestfailed', (r) => errs.push('[reqfail] ' + r.url()));
  await page.goto(`${SITE}/?q=low&skip`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 300000 });
  const ids = await page.evaluate(() => [...document.querySelectorAll('main > section, main > article')].map((e) => e.id));
  await page.waitForTimeout(3000);
  const prog0 = await page.evaluate(() => window.__rotunda.world?.renderer.info.programs.length);
  for (const id of ids) {
    await page.evaluate((id) => { const el = document.getElementById(id); window.__rotunda.lenis.scrollTo(el.offsetTop + el.offsetHeight * 0.5, { immediate: true, force: true }); }, id);
    await page.waitForTimeout(1500);
  }
  for (const id of ids.slice().reverse()) {
    await page.evaluate((id) => { const el = document.getElementById(id); window.__rotunda.lenis.scrollTo(el.offsetTop + el.offsetHeight * 0.5, { immediate: true, force: true }); }, id);
    await page.waitForTimeout(800);
  }
  const prog1 = await page.evaluate(() => window.__rotunda.world?.renderer.info.programs.length);
  console.log('programs after load', prog0, 'after two passes', prog1);
  const st = await page.evaluate(() => ({ marks: document.querySelectorAll('svg.mk-auto').length, fingers: document.querySelector('.gauge .fingers').textContent, gauge: document.querySelectorAll('.gauge button').length, nogl: document.body.classList.contains('no-gl') }));
  console.log('sections', ids.length, JSON.stringify(st));
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
