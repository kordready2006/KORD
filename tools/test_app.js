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
  await p.waitForSelector('.tile, .welcome');
  return p;
}
// fills in the Join sheet that appears the first time a signed-out phone tries to rate
async function join(p, name) {
  await p.waitForSelector('#auEmail');
  await p.fill('#auName', name); await p.fill('#auEmail', name.toLowerCase() + '@test.dev'); await p.fill('#auPass', 'password1');
  await p.click('#auGo');
  await p.waitForSelector('#menuBox .dish.open');
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
    // an account is required: both phones start on the welcome screen with no way in but signing up or in
    check(await a.locator('.welcome').count() === 1 && await a.locator('.tile').count() === 0 && await a.locator('#exploreBtn').count() === 0, 'the app can be entered without an account');
    await a.click('[data-auth="up"] >> nth=0');
    await a.fill('#auName', 'Alex'); await a.fill('#auEmail', 'alex@test.dev'); await a.fill('#auPass', 'short'); await a.click('#auGo');
    check(await a.locator('.autherr', { hasText: '8 characters' }).count() === 1, 'short password was not refused with a clear message');
    await a.fill('#auPass', 'password1'); await a.click('#auGo'); await a.waitForSelector('.tile');
    await b.click('[data-auth="up"] >> nth=0');
    await b.fill('#auName', 'Alex'); await b.fill('#auEmail', 'blake@test.dev'); await b.fill('#auPass', 'password1'); await b.click('#auGo');
    await b.waitForSelector('.autherr');
    check(await b.locator('.autherr', { hasText: 'taken' }).count() === 1, 'a display name already in use was accepted');
    await b.fill('#auName', 'Blake'); await b.fill('#auPass', 'password1'); await b.click('#auGo'); await b.waitForSelector('.tile');
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
    // ---- stage 3: The Wire, community rules, following, blocking, the Hall
    const call = (p, fn, body) => p.evaluate(async ([fn, body]) => { const au = JSON.parse(localStorage.getItem('kord.auth')); const r = await fetch('http://localhost:8799/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: 'dev', Authorization: 'Bearer ' + au.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.ok; }, [fn, body]);
    const idOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('kord.auth')).user.id);
    await a.click('.x').catch(() => {}); await b.click('.x').catch(() => {});
    check(!(await call(a, 'add_post', { p_town: 'athens', p_body: 'sneaking past the rules', p_path: '' })), 'a post was accepted before the community rules were agreed to');
    await a.click('[data-tab="wire"]'); await a.waitForSelector('#postIn');
    await a.fill('#postIn', 'Courtside slices are huge tonight'); await a.setInputFiles('#postFile', require('path').join(__dirname, '..', 'stock', 'pizza-1.jpg'));
    await a.click('#postBtn'); await a.waitForSelector('#rulesOk');
    check(await a.locator('#sheetBody li').count() >= 5, 'community rules are not shown before the first post');
    await a.click('#rulesOk'); await a.waitForSelector('.post:has-text("Courtside slices")');
    check(await a.locator('.post .pimg').count() === 1, 'post photo is missing');
    await b.click('[data-tab="wire"]'); await b.waitForSelector('.post:has-text("Courtside slices")');
    await b.click('.post .who2'); await b.waitForSelector('[data-follow]');
    check(await b.locator('#sheetBody h2', { hasText: 'Alex' }).count() >= 1 && await b.locator('#sheetBody .row').count() >= 1, 'member page does not show the name with Been there and Top tasted');
    await b.screenshot({ path: `${out}/e-profile.png` });
    await b.click('[data-follow]'); await b.waitForSelector('[data-follow]:has-text("Following")');
    await b.click('.x'); await b.click('[data-wire="friends"]'); await b.waitForSelector('.post:has-text("Courtside slices")');
    check(await b.locator('.sechead h2', { hasText: 'Fresh ratings' }).count() === 1, 'Friends page does not show what followed people rated');
    await b.click('[data-wire="hall"]'); await b.waitForSelector('.row');
    check(await b.locator('.row').count() === 2, 'the Hall does not list both members');
    check(!(await call(b, 'follow_user', { p_user: await idOf(b) })), 'an account could follow itself');
    await a.click('[data-tab="you"]'); await a.waitForTimeout(400); await a.reload(); await a.waitForSelector('.acct'); await a.waitForTimeout(1200);
    check(await a.locator('.acct .line', { hasText: 'Blake' }).count() === 1, 'no notification for a new follower');
    await a.screenshot({ path: `${out}/e-you.png` });
    await b.click('[data-wire="campus"]'); await b.waitForSelector('.post [data-block]'); await b.screenshot({ path: `${out}/e-wire.png` });
    await b.click('.post [data-block]'); await b.waitForTimeout(1200);
    check(await b.locator('.post:has-text("Courtside slices")').count() === 0, 'a blocked member\'s post still shows');
    check(!(await call(b, 'follow_user', { p_user: await idOf(a) })), 'a blocked member could be followed by calling the server directly');
    check(await call(b, 'block_user', { p_user: await idOf(a), p_block: false }), 'unblocking failed');
    await a.click('[data-tab="deals"]'); await b.click('[data-tab="deals"]'); await a.waitForTimeout(500);
    // ---- stage 2: standings, admin dashboard, switches, perks, merch (phone A is the admin, phone B is not)
    await a.click('[data-tab="best"]'); await a.waitForTimeout(900); await a.click('[data-best="places"]'); await a.waitForTimeout(400);
    check(await a.locator('.lead .leadidx').innerText() === '8', 'KORD Index of the leading restaurant is not 5 + 3 = 8');
    await a.click('#indexHelp'); check(await a.locator('#sheetBody', { hasText: 'average rating × number of votes' }).count() === 1, 'no explanation of the KORD Index'); await a.click('.x');
    await a.screenshot({ path: `${out}/d-standings.png` });
    await b.click('[data-tab="you"]'); await b.waitForTimeout(700);
    check(await b.locator('#adminBtn').count() === 0, 'a non-admin sees the admin button');
    check(await b.evaluate(async () => { const au = JSON.parse(localStorage.getItem('kord.auth')); const r = await fetch('http://localhost:8799/rest/v1/rpc/admin_set_flag', { method: 'POST', headers: { apikey: 'dev', Authorization: 'Bearer ' + au.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_key: 'comments', p_enabled: false }) }); return !r.ok; }), 'a non-admin could flip a switch by calling the server directly');
    await a.click('[data-tab="you"]'); await a.waitForTimeout(700);
    await a.click('#adminBtn'); await a.waitForSelector('#admBody .stats');
    check((await a.locator('#admBody .stat >> nth=0').innerText()).startsWith('2'), 'admin overview does not count 2 accounts');
    await a.click('[data-adm="perks"]'); await a.waitForSelector('#pkTitle');
    await a.fill('#pkTitle', 'Free cookie with any order'); await a.fill('#pkDesc', 'Show this at the counter.'); await a.fill('#pkVotes', '1'); await a.click('#perkSave');
    await a.waitForSelector('#admBody .perk:has-text("Free cookie")');
    await a.click('[data-adm="merch"]'); await a.waitForSelector('#mcName');
    await a.fill('#mcName', 'KORD tee'); await a.fill('#mcPrice', '$25'); await a.fill('#mcLink', 'https://example.com/tee'); await a.click('#merchSave');
    await a.waitForSelector('#admBody .perk:has-text("KORD tee")');
    await a.click('[data-adm="flags"]'); await a.waitForSelector('[data-flag="comments"]'); await a.click('[data-flag="comments"]'); await a.waitForSelector('[data-flag="comments"][data-on="1"]');
    await a.screenshot({ path: `${out}/d-admin.png` });
    await a.click('.x');
    await b.click('[data-tab="deals"]'); await b.waitForTimeout(1500);
    check(await b.locator('.perk', { hasText: 'Free cookie' }).count() === 1, 'the new perk does not show on the Deals tab');
    await b.click('.dcard.hero'); await b.waitForSelector('#menuBox .dish'); await b.waitForTimeout(800);
    check(await b.locator('#cmtIn').count() === 0 && await b.locator('.saying').count() === 0, 'comments still show after being switched off');
    await b.click('.x');
    await b.click('[data-unlock]'); await b.waitForSelector('[data-redeem]');
    await b.click('[data-redeem]'); await b.click('[data-redeemgo]'); await b.waitForSelector('.done .tick');
    await b.screenshot({ path: `${out}/d-redeemed.png` });
    await b.click('.x'); await b.waitForTimeout(600);
    check(await b.locator('.perk', { hasText: 'Free cookie' }).locator('.tag', { hasText: 'Redeemed' }).count() === 1, 'perk is not marked redeemed');
    check(await b.evaluate(async () => { const au = JSON.parse(localStorage.getItem('kord.auth')); const r = await fetch('http://localhost:8799/rest/v1/rpc/redeem_perk', { method: 'POST', headers: { apikey: 'dev', Authorization: 'Bearer ' + au.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_perk: 1 }) }); return !r.ok; }), 'a perk could be redeemed twice');
    await b.click('[data-tab="you"]'); await b.waitForTimeout(600);
    check(await b.locator('.perk', { hasText: 'KORD tee' }).locator('a[href="https://example.com/tee"]').count() === 1, 'merch item does not show with its link');
    await a.click('#adminBtn'); await a.click('[data-adm="flags"]'); await a.waitForSelector('[data-flag="comments"]'); await a.click('[data-flag="comments"]'); await a.waitForSelector('[data-flag="comments"][data-on="0"]'); await a.click('.x');
    // ---- accounts: profile stats, the 12-hour limit (the test server allows 3), sign out and in, deleting an account
    await a.click('[data-tab="you"]'); await a.waitForTimeout(900);
    check(await a.locator('.acct h2', { hasText: 'Alex' }).count() === 1, 'profile does not show the account name');
    check((await a.locator('.stat >> nth=0').innerText()).startsWith('1'), 'Last 12 hours is not 1 after one rating');
    check((await a.locator('.stat >> nth=1').innerText()).startsWith('2'), 'Remaining is not 2 of 3');
    await a.screenshot({ path: `${out}/c-account.png` });
    await a.click('[data-tab="deals"]'); await a.click('.dcard.hero'); await a.waitForSelector('#menuBox .dish');
    await a.waitForTimeout(1500); await a.click('#menuBox .chip:has-text("All")').catch(() => {}); await a.waitForTimeout(600);
    const rateNth = async (n, v) => { const d = a.locator('#menuBox .dish').nth(n); if (!(await d.locator('.dishbody').count())) await d.locator('.dishhead').click(); await a.locator('#menuBox .dish.open [data-rate="' + v + '"]').click(); await a.waitForTimeout(500); };
    const unrated = await a.evaluate(() => [...document.querySelectorAll('#menuBox .dish')].map((d, i) => [i, d.querySelector('.dishhead').innerText]).filter((x) => /^Rate$/.test(x[1].trim())).map((x) => x[0]).slice(0, 3));
    await rateNth(unrated[0], 7); await rateNth(unrated[1], 8);
    await rateNth(unrated[2], 9); await a.waitForTimeout(700);
    check(await a.locator('.toast', { hasText: 'used your ratings' }).count() === 1, 'fourth new rating in 12 hours was not refused');
    check(/^Close$|^Rate$/.test((await a.locator('#menuBox .dish').nth(unrated[2]).locator('.dishhead').innerText()).trim()) && (await a.locator('#menuBox .dish').nth(unrated[2]).locator('.tens .mine').count()) === 0, 'refused rating still shows as given');
    await a.waitForTimeout(2900); // let the refusal message clear
    await rateNth(unrated[0], 6); await a.waitForTimeout(700);
    check(await a.locator('.toast', { hasText: 'used your ratings' }).count() === 0, 'changing an existing rating was blocked by the limit');
    await a.click('.x'); await a.click('[data-tab="you"]'); await a.waitForTimeout(900);
    check((await a.locator('.stat >> nth=1').innerText()).startsWith('0'), 'Remaining is not 0 after using all votes');
    await a.click('#signOut'); await a.waitForTimeout(500);
    check(await a.locator('.welcome').count() === 1 && await a.locator('.tile, .tabs:not([hidden])').count() === 0, 'sign out did not return to the welcome screen');
    await a.click('[data-auth="in"]'); await a.fill('#auEmail', 'alex@test.dev'); await a.fill('#auPass', 'wrongpass1'); await a.click('#auGo'); await a.waitForSelector('.autherr');
    check(await a.locator('.autherr', { hasText: 'do not match' }).count() === 1, 'wrong password has no friendly message');
    await a.fill('#auPass', 'password1'); await a.click('#auGo'); await a.waitForSelector('.tile, .dcard');
    check(await a.locator('.tile').count() === 15 && await a.locator('.dcard').count() === 0, 'signing in did not open the list of all 15 schools');
    await a.click('[data-town="athens"]'); await a.click('[data-tab="you"]'); await a.waitForSelector('.acct h2:has-text("Alex")');
    check((await a.locator('.stat >> nth=0').innerText()).startsWith('3'), 'ratings did not come back after signing in again');
    await a.click('[data-auth="del"]'); await a.fill('#auConfirm', 'DELETE'); await a.click('#auGo'); await a.waitForSelector('.autherr');
    check(await a.locator('.autherr', { hasText: 'only admin' }).count() === 1, 'the last admin was allowed to delete their account');
    await a.click('.x');
    await b.click('[data-tab="you"]'); await b.waitForTimeout(700);
    await b.click('[data-auth="del"]'); await b.fill('#auConfirm', 'nope'); await b.click('#auGo');
    check(await b.locator('.autherr', { hasText: 'Type DELETE' }).count() === 1, 'account deletion did not require typing DELETE');
    await b.fill('#auConfirm', 'DELETE'); await b.click('#auGo'); await b.waitForSelector('.welcome');
    await b.click('[data-auth="in"]'); await b.fill('#auEmail', 'blake@test.dev'); await b.fill('#auPass', 'password1'); await b.click('#auGo'); await b.waitForSelector('.autherr');
    check(await b.locator('.autherr', { hasText: 'do not match' }).count() === 1, 'a deleted account can still sign in');
    await b.click('#sheetBody [data-auth="up"]'); await b.fill('#auName', 'Casey'); await b.fill('#auEmail', 'casey-verify@test.dev'); await b.fill('#auPass', 'password1'); await b.click('#auGo');
    await b.waitForSelector('h2:has-text("Verify your email")');
    await b.screenshot({ path: `${out}/c-verify.png` });
    { // a brand-new visitor: only the welcome screen, and an unverified sign-up does not get in
      const w = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
      await w.goto(url); await w.waitForSelector('.welcome'); await w.screenshot({ path: `${out}/f-welcome.png` });
      check(await w.locator('.tile').count() === 0 && await w.locator('#exploreBtn').count() === 0, 'a new visitor can get past the welcome screen without an account');
      check(await w.locator('.welcome img').count() === 0 && await w.locator('.mast h1', { hasText: 'Delicious Deals' }).count() === 1, 'welcome screen should show the working name and no food photos');
      await w.click('[data-auth="up"] >> nth=0'); await w.fill('#auName', 'Wendy'); await w.fill('#auEmail', 'wendy-verify@test.dev'); await w.fill('#auPass', 'password1'); await w.click('#auGo');
      await w.waitForSelector('h2:has-text("Verify your email")'); await w.click('.x'); await w.reload(); await w.waitForSelector('.welcome');
      check(await w.locator('.tile').count() === 0, 'an unverified account got into the app');
      await w.close();
    }
    await a.close(); await b.close();
  }
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})();
