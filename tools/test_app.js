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
  // single-phone flows never write to the real ratings server
  await p.goto(/[?&]server=/.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'server=off');
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
  await p.click('[data-town="athens"]');
  await p.click('[data-day="Wed"]');
  check((await p.$$('.dcard .hook')).length >= 3, 'deal cards have no value line');
  check(await p.locator('.sechead h2', { hasText: 'Under $5' }).count() === 1, 'no Under $5 section');
  const order = await p.$$eval('.sechead h2', (hs) => hs.map((h) => h.innerText));
  check(order.indexOf('Under $5') < order.indexOf('$5 to $8') && order.indexOf('$5 to $8') < order.indexOf('$8 to $12'), 'price sections out of order: ' + order.join(' | '));
  const prices = await p.$$eval('.sechead:has(h2:text-is("Under $5")) + .sub + .list .price', (ps) => ps.map((e) => parseFloat(e.innerText.replace('$', ''))));
  check(prices.every((v, i) => i === 0 || v >= prices[i - 1]) && prices.every((v) => v < 5), 'Under $5 section not sorted or has a price of $5 or more: ' + prices.join(','));
  await p.click('.chip:has-text("Pizza")');
  check(await p.locator('.dcard .dtitle').count() >= 1 && (await p.$$eval('.list:first-of-type .dtitle', (e) => e.map((n) => n.innerText))).every((n) => /pizza|slice|pick 2/i.test(n)), 'Pizza filter shows non-pizza deals');
  await p.click('.chip:has-text("All")');
  await p.screenshot({ path: `${out}/a-deals.png`, fullPage: true });
  await p.screenshot({ path: `${out}/a-deals-top.png` });
  check(await p.locator('.schoolbar h1').count() === 1, 'no school header');
  check((await p.$$('.rail .dcard')).length >= 4, 'no swipeable deal rows');
  await p.click('#swapBtn');
  await openFirstDeal(p);
  await p.click('#menuBox .dishhead >> nth=0');
  await p.click('.dishbody [data-rate="5"]');
  await p.fill('#cmtIn', 'Get these, huge portion');
  await p.click('#cmtBtn');
  check(await p.locator('.cmt', { hasText: 'huge portion' }).count() > 0, 'local comment not shown');
  check(await p.locator('.chip', { hasText: 'Top rated' }).count() === 1, 'no Top rated chip after rating');
  await p.click('.dishbody [data-report]');
  check(await p.locator('.dishbody .cmt', { hasText: 'huge portion' }).count() === 0, 'reported comment is still shown');
  await p.fill('#cmtIn', 'Get these, huge portion again');
  await p.click('#cmtBtn');
  check(await p.evaluate(() => { const w = document.querySelector('.week'); return w ? w.offsetHeight > 40 : true; }), 'weekly deals box is collapsed');
  check(await p.evaluate(() => getComputedStyle(document.querySelector('#menuBox .chip')).borderRadius !== '0px'), 'category chips are unstyled');
  await p.fill('#addItem', 'Buffalo chicken dip');
  await p.click('#addItemBtn');
  await p.fill('#menuSearch', 'buffalo');
  check(await p.locator('.dish', { hasText: 'Buffalo chicken dip' }).count() === 1, 'search did not find added dish');
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
    const pk = await p.evaluate((i) => window.KORD_PICKS(i), id), c = {};
    Object.values(pk).forEach((v) => { const n = v.split('|')[0]; c[n] = (c[n] || 0) + 1; });
    check(Math.max(0, ...Object.values(c)) <= 2, 'one restaurant is the top pick more than twice a week in ' + id);
  }
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

  // 1b. Demo order: tap a priced deal, customize, check out. Totals must add up: tax 7.25%, fee $0.50 under $10 else $1.
  p = await phone(browser, base);
  await p.click('[data-town="athens"]');
  await p.click('[data-day="Wed"]');
  await p.click('.dcard:has(.price:has-text("$")) >> nth=0');
  await p.waitForSelector('.orderbox');
  if (await p.locator('.orderbox .opt').count() > 1) await p.locator('.orderbox .opt').nth(1).click();
  await p.click('[data-qty="1"]');
  await p.fill('#ordNote', 'extra ranch');
  await p.screenshot({ path: `${out}/o-customize.png` });
  const unit = parseFloat(await p.getAttribute('#addCart', 'data-price'));
  const subT = unit * 2, taxT = Math.round(subT * 0.0725 * 100) / 100, feeT = subT < 10 ? 0.5 : 1, totalT = subT + taxT + feeT;
  await p.click('#addCart');
  await p.click('#cartBtn');
  const sheet = await p.locator('#sheetBody').innerText();
  for (const want of ['$' + subT.toFixed(2), '$' + taxT.toFixed(2), '$' + feeT.toFixed(2), '$' + totalT.toFixed(2), 'extra ranch']) check(sheet.includes(want), 'checkout is missing ' + want);
  await p.screenshot({ path: `${out}/o-checkout.png` });
  await p.click('#placeOrder');
  check(await p.locator('.done h2', { hasText: 'placed' }).count() === 1, 'no order confirmation');
  await p.screenshot({ path: `${out}/o-done.png` });
  await p.click('#doneBtn');
  await p.click('[data-tab="you"]');
  check(await p.locator('.line', { hasText: '$' + totalT.toFixed(2) }).count() === 1, 'order not listed on the You tab');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'sideways scroll after ordering');
  await p.context().close();

  // 1c. Points, rewards and membership.
  p = await phone(browser, base);
  await openFirstDeal(p);
  await p.click('#menuBox .dishhead >> nth=0');
  if (!(await p.$('.dishbody'))) await p.click('#menuBox .dishhead >> nth=0');
  await p.click('.dishbody [data-rate="4"]');
  await p.click('.dishbody [data-rate="5"]'); // changing a rating must not pay out twice
  await p.fill('#cmtIn', 'Solid for the price');
  await p.click('#cmtBtn');
  await p.click('.x');
  await p.click('[data-tab="you"]');
  let pts = parseInt(await p.locator('.rewards .big').innerText(), 10);
  check(pts === 20, 'expected 20 points (5 check-in + 10 rating + 5 comment), got ' + pts);
  check(await p.locator('[data-perk="waiver"]').isDisabled(), 'reward can be redeemed without enough points');
  check(await p.locator('.bdg:not(.off)', { hasText: 'First bite' }).count() === 1, 'First bite badge not earned');
  await p.evaluate(() => { const u = JSON.parse(localStorage.getItem('kord.user')); u.pts = 400; u.life = 400; localStorage.setItem('kord.user', JSON.stringify(u)); });
  await p.reload();
  await p.waitForSelector('.tabs');
  await p.click('[data-tab="you"]');
  check((await p.locator('.rewards').innerText()).includes('Junior'), '400 lifetime points should be Junior');
  await p.click('[data-perk="waiver"]');
  await p.click('[data-perk="credit"]');
  pts = parseInt(await p.locator('.rewards .big').innerText(), 10);
  check(pts === 50, 'redeeming 100 + 250 from 400 should leave 50, got ' + pts);
  await p.screenshot({ path: `${out}/r-rewards.png`, fullPage: true });
  await p.click('[data-tab="deals"]');
  await p.click('[data-day="Wed"]');
  await p.click('.dcard:has(.price:has-text("$")) >> nth=0');
  await p.waitForSelector('.orderbox');
  const u2 = parseFloat(await p.getAttribute('#addCart', 'data-price'));
  await p.click('#addCart');
  await p.click('#cartBtn');
  const co = await p.locator('#sheetBody').innerText();
  const tx = Math.round(u2 * 0.0725 * 100) / 100;
  check(co.includes('waived: reward') && co.includes('Reward: $1 off'), 'fee waiver or $1 credit not applied at checkout');
  check(co.includes('$' + Math.max(0, u2 + tx - 1).toFixed(2)), 'reward total wrong, expected $' + Math.max(0, u2 + tx - 1).toFixed(2));
  await p.screenshot({ path: `${out}/r-checkout.png` });
  await p.click('#placeOrder');
  await p.click('#doneBtn');
  await p.click('[data-tab="you"]');
  pts = parseInt(await p.locator('.rewards .big').innerText(), 10);
  check(pts === 70, 'order should add 20 points to 50, got ' + pts);
  await p.click('#plusBtn');
  check((await p.locator('.rewards').innerText()).includes('KORD Plus'), 'Plus membership did not switch on');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'sideways scroll on the rewards page');
  await p.context().close();

  // 2. Shared server: two phones see each other's ratings and comments.
  if (!process.argv[3]) {
    const url = base + '?server=' + encodeURIComponent('http://localhost:8799');
    const a = await phone(browser, url), b = await phone(browser, url);
    await openFirstDeal(a);
    await a.click('#menuBox .dishhead >> nth=0');
    const dish = await a.locator('#menuBox .dish.open .dishhead').getAttribute('data-dish');
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
    check(await b.locator('.dish.open .dmeta', { hasText: '2 votes' }).count() === 1, 'rating count is not 2');
    await b.fill('#cmtIn', 'Phone B agrees');
    await b.click('#cmtBtn');
    await a.waitForTimeout(13500); // phone A picks it up on its next refresh
    check(await a.locator('.cmt', { hasText: 'Phone B agrees' }).count() >= 1, 'phone A did not receive phone B comment live');
    await a.setInputFiles('#phFile', require('path').join(__dirname, '..', 'stock', 'pizza-1.jpg'));
    await a.waitForSelector('.pbig img', { timeout: 8000 }).catch(() => {});
    check(await a.locator('.pbig img').count() === 1, 'photo did not upload on phone A');
    await b.click('.x');
    await b.click('.dcard.hero');
    await b.waitForSelector('#menuBox .dish');
    await b.waitForSelector('#menuBox img[src*="dish-photos"]', { timeout: 8000 }).catch(() => {});
    check(await b.locator('#menuBox img[src*="dish-photos"]').count() >= 1, 'phone B does not see phone A photo');
    check(await b.evaluate(async () => { const i = document.querySelector('#menuBox img[src*="dish-photos"]'); if (!i) return false; const r = await fetch(i.src); return r.ok && (await r.blob()).size > 5000; }), 'shared photo file is not served');
    // a new photo is not a cover picture until two students say it looks right
    await b.click('.x');
    await b.click('[data-tab="places"]'); await b.waitForTimeout(1200);
    check(await b.locator('.pcard img[src*="dish-photos"]').count() === 0, 'an unapproved photo became the cover');
    await b.click('[data-tab="deals"]');
    const like = async (p) => {
      await p.click('.dcard.hero'); await p.waitForSelector('#menuBox .dish');
      if (!(await p.$('#menuBox .dish.open [data-like]'))) await p.locator('#menuBox .dishhead').filter({ has: p.locator('xpath=self::*[@data-dish=' + JSON.stringify(dish) + ']') }).first().click();
      await p.waitForSelector('#menuBox .dish.open [data-like]');
      await p.click('#menuBox [data-like]');
    };
    await like(b);
    await a.click('.x'); await like(a);
    await a.waitForTimeout(600); await a.click('.x'); await a.click('[data-tab="places"]'); await a.waitForTimeout(1500);
    check(await a.locator('.pcard img[src*="dish-photos"]').count() === 1, 'a photo with two Looks right taps did not become the cover');
    check(await a.locator('.pcard .ptag', { hasText: 'Student photo' }).count() === 1, 'student cover photo is not labelled');
    await a.click('[data-tab="deals"]');
    await b.screenshot({ path: `${out}/b-shared.png` });
    await b.click('.x');
    await b.click('[data-tab="best"]');
    await b.waitForTimeout(1500);
    check(await b.locator('.row', { hasText: dish }).count() >= 1, 'Best tab on phone B misses the shared dish');
    await b.screenshot({ path: `${out}/b-best.png` });
    await a.close(); await b.close();
  }
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})();
