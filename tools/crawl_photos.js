// Collect each restaurant's own photos for review. For every local place with deals and a website, opens the
// home page plus its menu / gallery / specials pages and saves large images along with their alt text.
//   node tools/crawl_photos.js <out-dir>
// Output: <out-dir>/crawl.json and image files. Photos are then reviewed by a person before any is used.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.dirname(__dirname);
const OUT = process.argv[2];
const SKIP = /facebook|instagram|toasttab|spoton|doordash|ubereats|grubhub/;

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kord.json')));
  const todo = new Map();
  for (const t of data.towns) for (const s of t.spots) {
    const ALL = process.argv[3] === 'all';   // 'all' = every local place with a website, not only those with deals
    if (!s.local || (!ALL && !s.deals.length) || !s.website || SKIP.test(s.website)) continue;
    const needsDish = s.deals.some((d) => d.nophoto);
    if (s.photo && !needsDish) continue;
    let host; try { host = new URL(s.website).hostname.replace(/^www\./, ''); } catch (e) { continue; }
    if (!todo.has(s.website)) todo.set(s.website, { host, name: s.name, town: t.id, hasPhoto: !!s.photo, deals: s.deals.map((d) => d.title) });
  }
  const urls = [...todo.keys()];
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const out = {};
  let i = 0;
  async function visit(page, url, store, bodies) {
    try {
      await page.goto(url, { timeout: 25000, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(400); }
      const mails = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="mailto:"]')].map((a) => a.href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase())
        .concat((document.body.innerText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((m) => m.toLowerCase())))].filter((m) => !/\.(png|jpg|jpeg|webp|gif)$/.test(m) && !/sentry|wixpress|example\./.test(m)));
      store.emails = [...new Set([...(store.emails || []), ...mails])].slice(0, 5);
      const imgs = await page.evaluate(() => [...document.images].filter((im) => im.naturalWidth >= 450 && im.naturalHeight >= 300).map((im) => {
        const fig = im.closest('figure, li, article, div');
        return { src: im.currentSrc, alt: im.alt || '', near: fig ? (fig.innerText || '').slice(0, 120) : '' };
      }));
      for (const im of imgs) {
        if (store.seen.has(im.src) || /logo|icon|sprite|map/i.test(im.src)) continue;
        const buf = bodies.get(im.src);
        if (!buf || buf.length < 20000) continue;
        store.seen.add(im.src);
        const f = path.join(store.dir, crypto.createHash('md5').update(im.src).digest('hex').slice(0, 10) + '.bin');
        fs.writeFileSync(f, buf);
        store.imgs.push({ f, src: im.src, alt: im.alt, near: im.near, page: url });
      }
    } catch (e) { store.err = String(e).slice(0, 80); }
  }
  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      const t = todo.get(url);
      const dir = path.join(OUT, t.host);
      fs.mkdirSync(dir, { recursive: true });
      const store = Object.assign({ dir, imgs: [], seen: new Set(), url }, t);
      const bodies = new Map();
      const page = await ctx.newPage();
      page.on('response', async (r) => {
        try { if (/^image\/(jpeg|png|webp)/.test(r.headers()['content-type'] || '')) bodies.set(r.url(), await r.body()); } catch (e) {}
      });
      await visit(page, url, store, bodies);
      let links = [];
      try {
        links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ h: a.href.split('#')[0], t: (a.innerText || '').trim().toLowerCase() }))
          .filter((a) => a.h.startsWith(location.origin) && /menu|food|gallery|photo|special|wing|taco|pizza|burger|eat|happy|contact|order/.test(a.t + ' ' + a.h.toLowerCase()) && !/\.pdf|mailto|tel:/.test(a.h)));
      } catch (e) {}
      const uniq = [...new Map(links.map((l) => [l.h.split('?')[0], l])).values()].filter((l) => l.h.split('?')[0] !== page.url().split('?')[0].split('#')[0]).slice(0, 4);
      for (const l of uniq) { if (store.imgs.length > 45) break; await visit(page, l.h, store, bodies); }
      await page.close();
      delete store.seen;
      out[url] = store;
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  fs.writeFileSync(path.join(OUT, 'crawl.json'), JSON.stringify(out, null, 1));
  const v = Object.values(out);
  console.log(v.length + ' sites, ' + v.filter((x) => x.imgs.length).length + ' with photos, ' + v.reduce((a, x) => a + x.imgs.length, 0) + ' photos');
  await browser.close();
})();
