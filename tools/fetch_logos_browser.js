// Second pass for restaurant logos: open each site that still has no logo in a real browser and
// capture the logo image from its header (or its declared icon). Run after tools/fetch_logos.py:
//   node tools/fetch_logos_browser.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'logos', 'spots');
const SKIP = /(^|\.)(facebook|instagram|x|twitter|linktr|toasttab|google|yelp|tripadvisor|doordash|grubhub|ubereats|square|wixsite|wordpress|business|spoton|toast)\./;

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kord.json')));
  const todo = new Map();
  for (const t of data.towns) for (const s of t.spots) {
    if (!s.website || s.logo) continue;
    let host; try { host = new URL(s.website).hostname.replace(/^www\./, ''); } catch (e) { continue; }
    if (SKIP.test(host + '.') || fs.existsSync(path.join(OUT, host + '.png'))) continue;
    todo.set(host, s.website);
  }
  const hosts = [...todo.keys()];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2,
  });
  let i = 0, got = 0;
  async function worker() {
    while (i < hosts.length) {
      const host = hosts[i++];
      const page = await ctx.newPage();
      try {
        await page.goto(todo.get(host), { timeout: 25000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        // the first visible image near the top whose markup says "logo"
        const handle = await page.evaluateHandle(() => {
          const els = [...document.querySelectorAll('img, svg')].filter((e) => {
            const r = e.getBoundingClientRect();
            const txt = [e.getAttribute('src'), e.getAttribute('alt'), e.getAttribute('class'), e.id, e.closest('a,div,header') && e.closest('a,div,header').className].join(' ');
            return /logo|brand/i.test(String(txt)) && r.width >= 40 && r.height >= 24 && r.width <= 700 && r.top < 500 && r.top >= 0;
          });
          return els[0] || null;
        });
        const el = handle.asElement();
        if (el) {
          await el.screenshot({ path: path.join(OUT, host + '.png') });
          got++;
        }
      } catch (e) { /* leave it without a logo */ }
      await page.close();
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  await browser.close();
  console.log(got + ' header logos for ' + hosts.length + ' sites');
})();
