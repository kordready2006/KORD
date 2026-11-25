// End-to-end check of the app at phone size.
//   python3 -m http.server 8765 &      (from the repo root)
//   node server/mock.js 8799 &          (only for the shared-server part)
//   node tools/test_app.js <screenshot-dir> [base-url]
// With no base-url it tests the local build twice: once without a server, once with two "phones" sharing the mock server.
const { chromium } = require('playwright');

const out = process.argv[2];
const base = process.argv[3] || 'http://localhost:8765/index.html';
const errs = [];
const check = (ok, msg) => { if (!ok) errs.push(msg); };

async function phone(browser, url, scheme) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, colorScheme: scheme || 'light' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  await p.goto(url);
  await p.waitForSelector('.tile');
  return p;
}
async function openFirstDeal(p) {
  await p.click('[data-town="athens"]');
  await p.click('[data-day="Wed"]');
  await p.click('.dcard.hero');
  await p.waitForSelector('#menuBox .dish');
}

(async () => {
  const browser = await chromium.launch();

  // 1. No shared server: everything works on one phone.
  let p = await phone(browser, base);
  await p.screenshot({ path: `${out}/a-pick.png` });
  await openFirstDeal(p);
  await p.click('#menuBox .dishhead >> nth=0');
  await p.click('.dishbody [data-rate="5"]');
  await p.fill('#cmtIn', 'Get these, huge portion');
  await p.click('#cmtBtn');
  check(await p.locator('.cmt', { hasText: 'huge portion' }).count() > 0, 'local comment not shown');
  check(await p.locator('.chip', { hasText: 'Top rated' }).count() === 1, 'no Top rated chip after rating');
  check(await p.evaluate(() => { const w = document.querySelector('.week'); return w ? w.offsetHeight > 40 : true; }), 'weekly deals box is collapsed');
  check(await p.evaluate(() => getComputedStyle(document.querySelector('.chip')).borderRadius !== '0px'), 'category chips are unstyled');
  await p.fill('#addItem', 'Buffalo chicken dip');
  await p.click('#addItemBtn');
  await p.fill('#menuSearch', 'buffalo');
  check(await p.locator('.dishhead', { hasText: 'Buffalo chicken dip' }).count() === 1, 'search did not find added dish');
  await p.evaluate(() => document.querySelector('.sheetbody').scrollTo(0, 99999));
  await p.fill('#menuSearch', '');
  await p.screenshot({ path: `${out}/a-sheet.png` });
  check(await p.locator('a[data-order]').count() >= 1, 'no order or website button');
  await p.click('.x');
  await p.click('[data-tab="best"]');
  check((await p.$$('.row')).length >= 1, 'Best tab empty after rating');
  await p.screenshot({ path: `${out}/a-best.png` });
  const ids = await p.evaluate(async () => (await (await fetch('data/kord.json')).json()).towns.map((t) => t.id));
  for (const id of ids) {
    await p.click('#swapBtn');
    await p.click(`[data-town="${id}"]`);
    check(!(await p.$('.dcard.hero .tag:has-text("Chain")')), 'chain is the top card in ' + id);
    for (const t of ['places', 'best', 'you', 'deals']) await p.click(`[data-tab="${t}"]`);
    for (const d of ['Mon', 'Sat']) await p.click(`[data-day="${d}"]`);
    const card = await p.$('.dcard');
    if (card) { await card.click(); await p.waitForSelector('#menuBox'); await p.click('.x'); }
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'sideways scroll in ' + id);
  }
  await p.context().close();
  p = await phone(browser, base, 'dark');
  await openFirstDeal(p);
  await p.click('#menuBox .dishhead >> nth=0');
  await p.screenshot({ path: `${out}/a-sheet-dark.png` });
  await p.context().close();

  // 1b. Demo order: tap the deal, customize, check out. 10 wings at $0.75 = $7.50, tax $0.54, fee $0.50.
  p = await phone(browser, base);
  await p.click('[data-town="athens"]');
  await p.click('[data-day="Wed"]');
  await p.click('.dcard.hero');
  await p.waitForSelector('.orderbox');
  await p.click('.opt:has-text("BBQ")');
  for (let i = 0; i < 9; i++) await p.click('[data-qty="1"]');
  await p.fill('#ordNote', 'extra ranch');
  await p.screenshot({ path: `${out}/o-customize.png` });
  await p.click('#addCart');
  await p.click('#cartBtn');
  const sheet = await p.locator('#sheetBody').innerText();
  for (const want of ['$7.50', '$0.54', '$0.50', '$8.54', 'BBQ', 'extra ranch']) check(sheet.includes(want), 'checkout is missing ' + want);
  await p.screenshot({ path: `${out}/o-checkout.png` });
  await p.click('#placeOrder');
  check(await p.locator('.done h2', { hasText: 'placed' }).count() === 1, 'no order confirmation');
  await p.screenshot({ path: `${out}/o-done.png` });
  await p.click('#doneBtn');
  await p.click('[data-tab="you"]');
  check(await p.locator('.line', { hasText: '$8.54' }).count() === 1, 'order not listed on the You tab');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'sideways scroll after ordering');
  await p.context().close();

  // 2. Shared server: two phones see each other's ratings and comments.
  if (!process.argv[3]) {
    const url = base + '?server=' + encodeURIComponent('http://localhost:8799');
    const a = await phone(browser, url), b = await phone(browser, url);
    await openFirstDeal(a);
    await a.click('#menuBox .dishhead >> nth=0');
    const dish = await a.locator('#menuBox .dish.open .mname').innerText();
    await a.click('.dishbody [data-rate="5"]');
    await a.fill('#cmtIn', 'Phone A says go on Wednesday');
    await a.click('#cmtBtn');
    await a.waitForTimeout(800);
    await openFirstDeal(b);
    await b.waitForSelector('.saying', { timeout: 8000 }).catch(() => {});
    check(await b.locator('.saying', { hasText: 'Phone A says' }).count() === 1, 'phone B does not see phone A comment');
    await b.click('.chip:has-text("Top rated")');
    check(await b.locator('.dmeta', { hasText: '5.0' }).count() >= 1, 'phone B does not see phone A rating');
    await b.click('#menuBox .dishhead >> nth=0');
    await b.click('.dishbody [data-rate="3"]');
    await b.waitForTimeout(900);
    check(await b.locator('.dish.open .dmeta', { hasText: '4.0' }).count() === 1, 'average of 5 and 3 is not 4.0 on phone B');
    check(await b.locator('.dish.open .dmeta', { hasText: '(2)' }).count() === 1, 'rating count is not 2');
    await b.fill('#cmtIn', 'Phone B agrees');
    await b.click('#cmtBtn');
    await a.waitForTimeout(13500); // phone A picks it up on its next refresh
    check(await a.locator('.cmt', { hasText: 'Phone B agrees' }).count() >= 1, 'phone A did not receive phone B comment live');
    await b.screenshot({ path: `${out}/b-shared.png` });
    await b.click('.x');
    await b.click('[data-tab="best"]');
    await b.waitForTimeout(600);
    check(await b.locator('.row', { hasText: dish.split('\n')[0].slice(0, 12) }).count() >= 1, 'Best tab on phone B misses the shared dish');
    await b.screenshot({ path: `${out}/b-best.png` });
    await a.close(); await b.close();
  }
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})();
