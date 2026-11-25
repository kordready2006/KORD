(function () {
  'use strict';
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var DAYNAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  var CATCOLOR = { 'Pizza': 'hot', 'Burgers': 'orange', 'Mexican': 'mint', 'Sandwiches & Subs': 'cobalt', 'Wings & Chicken': 'orange', 'Asian': 'pink',
    'Boba & Tea': 'grape', 'Coffee & Bakery': 'teal', 'Breakfast & Brunch': 'orange', 'Bar & Grill': 'cobalt', 'Dessert & Ice Cream': 'pink', 'BBQ': 'hot',
    'Mediterranean': 'teal', 'Healthy & Bowls': 'mint', 'Fast Food': 'hot', 'Other': 'grape' };
  var NOLOGO = /(^|\.)(facebook|instagram|x|twitter|linktr|toasttab|google|yelp|tripadvisor|doordash|grubhub|ubereats|square|wixsite|wordpress|business|spoton|toast)\./;
  var TODAY = DAYS[(new Date().getDay() + 6) % 7];
  var DATA = null, SPOTS = {};
  var S = load('kord.prefs', { town: '', tab: 'deals' });
  S.day = TODAY; S.localOnly = false; S.q = ''; S.picking = false;
  if (['deals', 'places', 'best', 'you'].indexOf(S.tab) < 0) S.tab = 'deals';
  var U = load('kord.user', { name: '', avatar: '', ratings: {}, notes: {} });
  U.items = U.items || {}; U.custom = U.custom || {};
  /* Dish ratings: U.items[placeId][dish] = 1..5 on this phone. COMMUNITY[placeId][dish] = {sum, n} is where other students'
     ratings go once a shared ratings server is connected; every score below already combines the two. */
  var COMMUNITY = {}, MENUS = null, SERVER = null, LOADED = {}, CMTS = {}, POLL = null;
  U.comments = U.comments || {};
  if (!U.device) {
    U.device = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
    save('kord.user', U);
  }
  /* Shared server (Supabase REST). Phones read two summary views and call three functions; see server/schema.sql. */
  function api(path, body) {
    if (!SERVER) return Promise.reject(new Error('no server'));
    var h = { apikey: SERVER.key, Authorization: 'Bearer ' + SERVER.key };
    if (body) h['Content-Type'] = 'application/json';
    return fetch(SERVER.url + '/rest/v1/' + path, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.text().then(function (t) { if (!r.ok) throw new Error(t || r.status); return t ? JSON.parse(t) : null; });
    });
  }
  function loadScores(then) {
    var t = DATA && town(); if (!SERVER || !t) return;
    api('dish_scores?select=place_id,dish,avg,n&town=eq.' + encodeURIComponent(t.id)).then(function (rows) {
      t.spots.forEach(function (sp) { delete COMMUNITY[sp.id]; });
      (rows || []).forEach(function (r) { (COMMUNITY[r.place_id] = COMMUNITY[r.place_id] || {})[r.dish] = { avg: +r.avg, n: +r.n }; });
      LOADED[t.id] = true;
      if (then) then();
    }).catch(function () {});
  }
  function loadComments(id) {
    if (!SERVER) return;
    api('dish_comments?select=dish,name,body,created_at&order=created_at.desc&limit=80&place_id=eq.' + encodeURIComponent(id)).then(function (rows) {
      CMTS[id] = rows || [];
      if (S.open === id) paintComments(id);
    }).catch(function () {});
  }
  function myRate(id, item) { return (U.items[id] || {})[item] || 0; }
  function itemScore(id, item) {
    var m = myRate(id, item), c = (COMMUNITY[id] || {})[item];
    if (SERVER && LOADED[S.town] && c) return { avg: c.avg, n: c.n };
    return m ? { avg: m, n: 1 } : null;
  }
  function ratedItems(id) {
    var names = {}; Object.keys(U.items[id] || {}).forEach(function (k) { names[k] = 1; }); Object.keys(COMMUNITY[id] || {}).forEach(function (k) { names[k] = 1; });
    return Object.keys(names).map(function (k) { var sc = itemScore(id, k); return sc && { item: k, avg: sc.avg, n: sc.n }; }).filter(Boolean)
      .sort(function (a, b) { return b.avg - a.avg || b.n - a.n || a.item.localeCompare(b.item); });
  }
  function spotScore(id) { var r = ratedItems(id), t = 0; if (!r.length) return null; r.forEach(function (x) { t += x.avg; }); return t / r.length; }
  function miniStars(id, item) {
    var r = myRate(id, item), h = '';
    for (var i = 1; i <= 5; i++) h += '<button class="' + (i <= r ? 'on' : '') + '" data-rate="' + i + '" data-id="' + esc(id) + '" data-item="' + esc(item) + '" aria-label="' + i + ' star' + (i > 1 ? 's' : '') + ' for ' + esc(item) + '">★</button>';
    return '<span class="stars big" role="group">' + h + '</span>';
  }

  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? v : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https:\/\//i.test(u || '') ? u : (/^http:\/\//i.test(u || '') ? u.replace(/^http:/i, 'https:') : ''); }
  function domain(u) { try { return new URL(safeUrl(u)).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function initials(n) { var w = String(n).replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(function (x) { return x && !/^(the|of|and)$/i.test(x); }); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase(); }
  function color(cat) { return 'var(--' + (CATCOLOR[cat] || 'grape') + ')'; }
  function hex(c) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#FF3B2F'; }
  function priceNum(p) { var m = /\$\s?(\d+(?:\.\d+)?)/.exec(p || ''); if (m) return parseFloat(m[1]); m = /(\d+)\s?(?:¢|cents?)/i.exec(p || ''); return m ? parseFloat(m[1]) / 100 : null; }
  function stubText(d) {
    var p = (d.price || '').trim();
    if (p && p.length <= 9) return p;
    var m = /\$\s?\d+(?:\.\d+)?/.exec(p + ' ' + d.title) || /\d+\s?% off/i.exec(p + ' ' + d.title) || /half[- ]price|half off|bogo|free/i.exec(p + ' ' + d.title);
    return m ? m[0].replace(/\s/g, m[0][0] === '$' ? '' : ' ').toUpperCase() : 'DEAL';
  }
  function town() { return DATA.towns.find(function (t) { return t.id === S.town; }); }
  function fav(d) { return 'https://www.google.com/s2/favicons?sz=128&domain=' + encodeURIComponent(d); }
  function logo(sp, cls) {
    var d = domain(sp.website), img = '';
    if (sp.logo) img = '<img alt="" loading="lazy" data-logo src="' + esc(sp.logo) + '">';
    else if (photo(sp.photo)) img = '<img alt="" loading="lazy" class="cover" data-logo src="' + esc(photo(sp.photo)) + '">';
    else if (d && !NOLOGO.test(d + '.')) img = '<img alt="" loading="lazy" data-logo src="' + fav(d) + '">';
    return '<span class="lg ' + (cls || '') + '" style="--c:' + color(sp.category) + '"><span>' + esc(initials(sp.name)) + '</span>' + img + '</span>';
  }
  function badge(sc) {
    var d = domain(sc.url), src = sc.logo || (d ? fav(d) : '');
    return '<span class="badge" style="--c:' + hex(sc.color) + ';--i:' + hex(sc.ink) + '"><span>' + esc(sc.abbr) + '</span>' + (src ? '<img alt="" data-logo src="' + esc(src) + '">' : '') + '</span>';
  }
  document.addEventListener('load', function (e) { var t = e.target; if (t && t.dataset && 'logo' in t.dataset) { if (t.naturalWidth >= 32) t.parentNode.classList.add('has'); else t.remove(); } }, true);
  document.addEventListener('error', function (e) { var t = e.target; if (t && t.dataset && 'logo' in t.dataset) t.remove(); }, true);

  function dealsFor(t, day) {
    var out = [];
    t.spots.forEach(function (sp) { (sp.deals || []).forEach(function (d) { if (d.days.indexOf(day) >= 0) out.push({ sp: sp, d: d }); }); });
    return out;
  }
  /* cheapest first: dollar prices low to high, then percent-off and other deals; local spots win ties */
  /* Deal of the day. Picks one local deal per day for the whole week so the top card rotates:
     a deal that only runs on that day beats an everyday one, no restaurant leads more than twice a week,
     and price breaks ties. Days with the fewest choices are filled first. */
  var PICKS = {};
  function weekPicks(t) {
    if (PICKS[t.id]) return PICKS[t.id];
    var picks = {}, used = {}, byDay = {};
    DAYS.forEach(function (d) { byDay[d] = dealsFor(t, d).filter(function (x) { return x.sp.local; }); });
    function rank(x) {
      var p = priceNum(x.d.price || x.d.title), everyday = x.d.days.length >= 6, discountOnly = p == null || /reward|points/i.test(x.d.title);
      return [(used[x.sp.id] || 0) >= 2 ? 1 : 0, (discountOnly && everyday) || /reward|points/i.test(x.d.title) ? 1 : 0, used[x.sp.id] || 0, everyday ? 1 : 0, x.d.days.length, discountOnly ? 1 : 0, p == null ? 99 : p];
    }
    DAYS.slice().sort(function (a, b) { return byDay[a].length - byDay[b].length; }).forEach(function (d) {
      var best = null, br = null;
      byDay[d].forEach(function (x) {
        var r = rank(x), i = 0;
        if (best) { while (i < r.length && r[i] === br[i]) i++; if (i === r.length || r[i] > br[i]) return; }
        best = x; br = r;
      });
      if (best) { picks[d] = best.sp.id + '|' + best.d.title; used[best.sp.id] = (used[best.sp.id] || 0) + 1; }
    });
    return (PICKS[t.id] = picks);
  }
  window.KORD_PICKS = function (id) { var t = DATA.towns.filter(function (x) { return x.id === id; })[0]; return t ? weekPicks(t) : null; };
  function cheapest(a) {
    return a.sort(function (x, y) {
      var px = priceNum(x.d.price || x.d.title), py = priceNum(y.d.price || y.d.title);
      if (px == null && py != null) return 1; if (py == null && px != null) return -1;
      if (px != null && px !== py) return px - py;
      return (y.sp.local ? 1 : 0) - (x.sp.local ? 1 : 0) || x.sp.name.localeCompare(y.sp.name);
    });
  }
  function spotLow(sp) { var lo = null; (sp.deals || []).forEach(function (d) { var p = priceNum(d.price || d.title); if (p != null && (lo == null || p < lo)) lo = p; }); return lo; }
  function travel(sp) { if (sp.mi == null) return ''; return sp.mi <= 0.8 ? Math.max(2, Math.round(sp.mi * 20)) + ' min walk' : Math.max(3, Math.round(sp.mi * 4)) + ' min drive'; }
  /* Links out to a restaurant carry a KORD tag so the restaurant can see the orders KORD sends in its own analytics. */
  function outLink(u) { try { var x = new URL(u); if (!x.searchParams.has('utm_source')) { x.searchParams.set('utm_source', 'kord'); x.searchParams.set('utm_medium', 'app'); x.searchParams.set('utm_campaign', 'deals'); } return x.href; } catch (e) { return u; } }
  function money(n) { return '$' + (n % 1 ? n.toFixed(2) : n); }
  function tagsHtml(sp, d) {
    var h = '';
    if (sp.signature) h += '<span class="tag sig">Student favorite</span>';
    if (d && d.studentOnly) h += '<span class="tag stu">Show student ID</span>';
    if (!sp.local) h += '<span class="tag">Chain</span>';
    return h ? '<span class="tags">' + h + '</span>' : '';
  }
  function photo(src) { return src || ''; }
  function ticket(x, hero) {
    var st = stubText(x.d), ph = photo(x.d.photo || (x.d.nophoto ? '' : x.sp.photo));
    return '<button class="dcard' + (hero ? ' hero' : '') + '" data-spot="' + esc(x.sp.id) + '" data-deal="' + esc(x.d.title) + '" style="--c:' + color(x.sp.category) + '">' +
      '<span class="ph' + (ph ? '' : x.sp.logo ? ' nophoto haslogo' : ' nophoto') + '">' + (ph ? '<img alt="" loading="lazy" src="' + esc(ph) + '">' : x.sp.logo ? '<img alt="" loading="lazy" src="' + esc(x.sp.logo) + '">' : '<span class="mono">' + esc(initials(x.sp.name)) + '</span>') +
      (hero ? '<span class="flag">' + (S.day === TODAY ? 'Today\'s' : DAYNAME[S.day] + '\'s') + ' local pick</span>' : '') +
      '<span class="price' + (st.length > 5 ? ' long' : '') + '">' + esc(st) + '</span></span>' +
      '<span class="dbody"><span class="dtitle">' + esc(x.d.title) + '</span>' +
      '<span class="who">' + logo(x.sp, 'sm') + '<span>' + esc(x.sp.name) + '</span></span>' +
      (hero ? '<span class="ddet">' + esc(x.d.details) + '</span>' : '') + tagsHtml(x.sp, x.d) + '</span></button>';
  }

  /* step 1: pick a school */
  function viewPick() {
    return '<div class="grid">' + DATA.towns.map(function (t) {
      return '<button class="tile' + (t.id === S.town ? ' mine' : '') + '" data-town="' + esc(t.id) + '">' + badge(t.school) +
        '<span><span class="tname">' + esc(t.school.name) + '</span><span class="tsub">' + esc(t.name) + (t.school.also ? ' · also ' + esc(t.school.also) : '') + '</span></span></button>';
    }).join('') + '</div><p class="note">15 Ohio schools so far. More coming.</p>';
  }
  /* step 2: cheapest deals for the day */
  function viewDeals() {
    var t = town(), all = dealsFor(t, S.day);
    var local = cheapest(all.filter(function (x) { return x.sp.local; })), chain = cheapest(all.filter(function (x) { return !x.sp.local; }));
    var when = S.day === TODAY ? 'today' : 'on ' + DAYNAME[S.day];
    var pick = weekPicks(t)[S.day], pi = -1;
    local.forEach(function (x, i) { if (x.sp.id + '|' + x.d.title === pick) pi = i; });
    if (pi > 0) local.unshift(local.splice(pi, 1)[0]);
    var h = '<div><h2>Local deals ' + when + '</h2><p class="sub">The day\'s standout deal in ' + esc(t.name) + ' first, then the rest by lowest price. Tap one to order or rate it.</p></div>';
    if (local.length) {
      h += ticket(local[0], true);
      if (local.length > 1) h += '<div class="sechead"><h2>More local deals</h2><span>' + (local.length - 1) + '</span></div><div class="list">' + local.slice(1).map(function (x) { return ticket(x); }).join('') + '</div>';
    } else {
      var other = DAYS.filter(function (d) { return dealsFor(t, d).some(function (x) { return x.sp.local; }); });
      h += '<div class="empty"><b>No local deals found for ' + DAYNAME[S.day] + '</b>' + (other.length ? 'Try ' + other.map(function (d) { return DAYNAME[d]; }).join(', ') + '.' : 'Check Places for where to eat.') + '</div>';
    }
    if (chain.length) h += '<div class="sechead"><h2>Chain deals nearby</h2><span>' + chain.length + '</span></div><p class="sub" style="margin-top:-8px">Fast food and national chains.</p><div class="list">' + chain.map(function (x) { return ticket(x); }).join('') + '</div>';
    return h + '<p class="note">Deals change. Each one links to where we found it, so check before you go. Photos come from each restaurant\'s own website.</p>';
  }
  function spotRow(sp) {
    var lo = spotLow(sp), n = (sp.deals || []).length, r = spotScore(sp.id);
    return '<button class="row" data-spot="' + esc(sp.id) + '">' + logo(sp) +
      '<span class="mid"><h3>' + esc(sp.name) + '</h3><p>' + esc(sp.category) + (sp.price ? ' · ' + esc(sp.price) : '') + (travel(sp) ? ' · ' + travel(sp) : '') + (r ? ' · <span class="score">★ ' + r.toFixed(1) + '</span>' : '') + '</p></span>' +
      '<span class="end">' + (lo != null ? 'from<b>' + money(lo) + '</b>' : n ? '<b>' + n + '</b>deal' + (n > 1 ? 's' : '') : '') + '</span></button>';
  }
  function viewPlaces() {
    var t = town(), q = S.q.toLowerCase();
    var list = t.spots.filter(function (s) { return !q || (s.name + ' ' + s.category).toLowerCase().indexOf(q) >= 0; });
    list.sort(function (a, b) { var x = spotLow(a), y = spotLow(b); if (x == null && y == null) return (b.deals.length - a.deals.length) || a.name.localeCompare(b.name); if (x == null) return 1; if (y == null) return -1; return x - y; });
    var loc = list.filter(function (s) { return s.local; }), ch = list.filter(function (s) { return !s.local; });
    function sec(title, a) { return a.length ? '<div class="sechead"><h2>' + title + '</h2><span>' + a.length + '</span></div><div class="list">' + a.map(spotRow).join('') + '</div>' : ''; }
    return '<div><h2>Where to eat in ' + esc(t.name) + '</h2><p class="sub">Tap a place to see its deals for the week and leave your review.</p></div>' +
      '<input class="search" id="spotSearch" type="search" placeholder="Search pizza, tacos, a name…" value="' + esc(S.q) + '" aria-label="Search places">' +
      (list.length ? sec('Local spots', loc) + sec('Chains', ch) : '<div class="empty"><b>Nothing matches</b>Try a different word.</div>');
  }
  function viewBest() {
    var t = town(), rows = [];
    t.spots.forEach(function (sp) { ratedItems(sp.id).forEach(function (x) { rows.push({ sp: sp, x: x }); }); });
    rows.sort(function (a, b) { return b.x.avg - a.x.avg || b.x.n - a.x.n || a.x.item.localeCompare(b.x.item); });
    var h = '<div><h2>Best food at ' + esc(t.school.name) + '</h2><p class="sub">Every dish that has been rated, best first. To add yours, open a place and tap the stars on what you ordered.</p></div>';
    h += rows.length ? '<div class="list">' + rows.map(function (r, i) {
      return '<button class="row" data-spot="' + esc(r.sp.id) + '"><span class="rank">' + (i + 1) + '</span>' + logo(r.sp) + '<span class="mid"><h3>' + esc(r.x.item) + '</h3><p>' + esc(r.sp.name) + '</p></span>' +
        '<span class="end"><b>' + r.x.avg.toFixed(1) + '</b>' + r.x.n + ' rating' + (r.x.n > 1 ? 's' : '') + '</span></button>';
    }).join('') + '</div>' : '<div class="empty"><b>No dishes rated yet</b>Be the first. Open any place and rate what you got.</div>';
    return h + '<p class="note">' + (SERVER ? 'Scores combine ratings from every student using KORD at this school.' : 'For now this counts ratings made on this phone. Ratings from every student combine here once the shared ratings server is connected.') + '</p>';
  }
  function viewYou() {
    var mine = [];
    Object.keys(U.items).forEach(function (id) { if (SPOTS[id]) Object.keys(U.items[id]).forEach(function (k) { mine.push({ sp: SPOTS[id], item: k, r: U.items[id][k] }); }); });
    mine.sort(function (a, b) { return b.r - a.r || a.item.localeCompare(b.item); });
    var h = '<div class="me"><span class="avatar">' + (U.avatar ? '<img alt="" src="' + esc(U.avatar) + '">' : esc(U.name ? initials(U.name) : '?')) + '</span>' +
      '<div><h2>' + esc(U.name || 'Your profile') + '</h2><p class="sub">' + esc(town().school.name) + '</p>' +
      '<div class="btnrow" style="margin-top:8px"><label class="btn ghost" for="avatarFile">Add a photo</label><input id="avatarFile" type="file" accept="image/*" hidden></div></div></div>' +
      '<label class="field" for="nameIn">Your name<input id="nameIn" type="text" maxlength="30" autocomplete="nickname" placeholder="What should we call you?" value="' + esc(U.name) + '"></label>' +
      (U.orders.length ? '<div class="sechead"><h2>Your demo orders</h2><span>' + U.orders.length + '</span></div><div class="lines">' + U.orders.slice(0, 8).map(function (o) {
        return '<div class="line"><span class="mid"><b>' + esc(o.name) + '</b><small>' + esc(o.no) + ' · ' + o.lines.reduce(function (a, l) { return a + l.qty; }, 0) + ' items · KORD fee ' + usd(o.fee) + '</small></span><b>' + usd(o.total) + '</b></div>';
      }).join('') + '</div><p class="note">KORD fees across these demo orders: ' + usd(U.orders.reduce(function (a, o) { return a + o.fee; }, 0)) + '</p>' : '') +
      '<div class="sechead"><h2>Dishes you rated</h2><span>' + mine.length + '</span></div>';
    h += mine.length ? '<div class="list">' + mine.map(function (m) {
      return '<button class="row" data-spot="' + esc(m.sp.id) + '">' + logo(m.sp) + '<span class="mid"><h3>' + esc(m.item) + '</h3><p>' + esc(m.sp.name) + '</p></span><span class="end"><span class="mystars">' + '★'.repeat(m.r) + '</span></span></button>';
    }).join('') + '</div>' : '<div class="empty"><b>Nothing rated yet</b>Open any place and tap the stars on what you ordered.</div>';
    return h + '<p class="note">' + (SERVER ? 'Your ratings and comments are shared with other students at your school. Your photo stays on this phone.' : 'Your profile and ratings are saved on this phone.') + '</p>';
  }

  function render() {
    var t = DATA && town(), picking = S.picking || !t, root = document.documentElement;
    root.style.setProperty('--sc', picking ? '' : hex(t.school.color)); root.style.setProperty('--si', picking ? '' : hex(t.school.ink));
    if (picking) { root.style.removeProperty('--sc'); root.style.removeProperty('--si'); }
    document.getElementById('top').innerHTML = '<div class="brand"><i></i>KORD</div>' + (picking ?
      '<div class="intro"><h1>Cheap eats near campus.</h1><p>Pick your school to see today\'s deals.</p></div>' :
      '<div class="schoolbar">' + badge(t.school) + '<div class="mid"><h1>' + esc(t.school.name) + '</h1><p>' + esc(t.name) + ', Ohio</p></div><button class="swap" id="swapBtn">Change</button></div>');
    document.getElementById('tabs').hidden = picking;
    document.getElementById('daysNav').hidden = picking || S.tab !== 'deals';
    var v = document.getElementById('view'); v.className = 'wrap' + (picking ? ' nopad' : '');
    if (picking) { v.innerHTML = viewPick(); return; }
    document.getElementById('days').innerHTML = DAYS.map(function (d) {
      return '<button class="day" data-day="' + d + '" aria-pressed="' + (S.day === d) + '" aria-label="' + DAYNAME[d] + '"><small>' + (d === TODAY ? 'Today' : '') + '</small>' + d + '</button>';
    }).join('');
    document.querySelectorAll('.tab').forEach(function (b) { if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    v.innerHTML = S.tab === 'places' ? viewPlaces() : S.tab === 'best' ? viewBest() : S.tab === 'you' ? viewYou() : viewDeals();
    save('kord.prefs', { town: S.town, tab: S.tab });
  }

  /* place sheet */
  function closeSheet() { document.getElementById('sheetRoot').innerHTML = ''; clearInterval(POLL); S.open = null; S.item = null; }
  /* ---- Demo ordering. No payment is taken and no restaurant is contacted. ---- */
  var TAX = 0.0725, CART = { place: null, lines: [] };
  U.orders = U.orders || [];
  function kordFee(sub) { return sub <= 0 ? 0 : sub < 10 ? 0.5 : 1; }   /* KORD's cut per order */
  function usd(n) { return '$' + n.toFixed(2); }
  var OPTSETS = [[/wing/i, 'Sauce', ['Buffalo', 'BBQ', 'Garlic parm', 'Dry rub']], [/taco|burrito|quesadilla|nacho|bowl/i, 'Protein', ['Chicken', 'Steak', 'Pork', 'Veggie']],
    [/pizza|slice|calzone|stromboli/i, 'Topping', ['Cheese', 'Pepperoni', 'Sausage', 'Veggie']], [/burger/i, 'Cheese', ['American', 'Cheddar', 'Swiss', 'No cheese']],
    [/sub\b|sandwich|wrap|gyro|bagel/i, 'Side', ['No side', 'Fries', 'Chips']], [/coffee|latte|tea|boba|smoothie|shake/i, 'Size', ['Small', 'Medium', 'Large']]];
  function optSet(name) { for (var i = 0; i < OPTSETS.length; i++) if (OPTSETS[i][0].test(name)) return OPTSETS[i]; return null; }
  function cartTotals(lines) { var sub = 0; lines.forEach(function (l) { sub += l.price * l.qty; }); var tax = Math.round(sub * TAX * 100) / 100, fee = kordFee(sub); return { sub: sub, tax: tax, fee: fee, total: sub + tax + fee, count: lines.reduce(function (a, l) { return a + l.qty; }, 0) }; }
  function orderBox(id, m) {
    var price = priceNum(m.p), set = optSet(m.n);
    if (price == null) return '<p class="note">This one has no set price, so order it at the restaurant.</p>';
    if (set && set[2].indexOf(S.opt) < 0) S.opt = set[2][0];
    var q = S.qty || 1;
    return '<div class="orderbox"><span class="demo">Demo order</span>' +
      (set ? '<span class="lab">' + set[1] + '</span><div class="opts">' + set[2].map(function (o) { return '<button class="opt" data-opt="' + esc(o) + '" aria-pressed="' + (S.opt === o) + '">' + esc(o) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="qtyrow"><span class="lab">How many</span><span class="qty"><button data-qty="-1" aria-label="One less">−</button><b>' + q + '</b><button data-qty="1" aria-label="One more">+</button></span></div>' +
      '<input class="search" id="ordNote" type="text" maxlength="80" placeholder="Anything to add? (no onions, extra sauce)" aria-label="Order note">' +
      '<button class="btn hot" id="addCart" data-id="' + esc(id) + '" data-name="' + esc(m.n) + '" data-price="' + price + '">Add to order · ' + usd(price * q) + '</button></div>';
  }
  function paintCart() {
    var bar = document.getElementById('cartBar'); if (!bar) return;
    var show = CART.lines.length && CART.place === S.open && S.step !== 'checkout' && S.step !== 'done', t = cartTotals(CART.lines);
    bar.innerHTML = show ? '<div class="cartbar"><button class="btn hot" id="cartBtn"><span>View order · ' + t.count + ' item' + (t.count > 1 ? 's' : '') + '</span><span>' + usd(t.sub) + '</span></button></div>' : '';
  }
  function checkout() {
    var sp = SPOTS[CART.place], body = document.getElementById('sheetBody'); if (!sp || !body) return;
    S.step = 'checkout'; S.pick = S.pick || 'ASAP (15 to 20 min)';
    if (!CART.lines.length) { S.step = ''; return spotSheet(sp.id); }
    var t = cartTotals(CART.lines);
    body.innerHTML = '<button class="btn ghost" id="backMenu" style="align-self:flex-start">Back to menu</button>' +
      '<div><h2>Your order</h2><p class="sub">Pickup from ' + esc(sp.name) + (sp.address ? ', ' + esc(sp.address.split(',')[0]) : '') + '</p></div><span class="demo">Demo: no payment is taken</span>' +
      '<div class="lines">' + CART.lines.map(function (l, i) {
        return '<div class="line"><b>' + l.qty + '×</b><span class="mid"><b>' + esc(l.n) + '</b><small>' + esc([l.opt, l.note].filter(Boolean).join(' · ')) + '</small></span><span style="text-align:right"><b>' + usd(l.price * l.qty) + '</b><br><button class="rm" data-rm="' + i + '">Remove</button></span></div>';
      }).join('') + '</div>' +
      '<div><span class="lab" style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Pickup time</span><div class="opts" style="margin-top:6px">' +
      ['ASAP (15 to 20 min)', 'In 30 min', 'In 1 hour'].map(function (o) { return '<button class="opt" data-pick="' + esc(o) + '" aria-pressed="' + (S.pick === o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>' +
      '<label class="field" for="ordName">Name for the order<input id="ordName" type="text" maxlength="30" placeholder="Your name" value="' + esc(U.name) + '"></label>' +
      '<div class="totals"><div><span>Subtotal</span><span>' + usd(t.sub) + '</span></div><div><span>Estimated tax</span><span>' + usd(t.tax) + '</span></div>' +
      '<div><span>KORD service fee</span><span>' + usd(t.fee) + '</span></div><div class="grand"><span>Total</span><span>' + usd(t.total) + '</span></div></div>' +
      '<div class="paycard"><span>Demo card ending 4242</span><span class="demo">Demo</span></div>' +
      '<button class="btn hot bigbtn" id="placeOrder">Place demo order · ' + usd(t.total) + '</button>' +
      '<p class="note">This is a demo. Nothing is charged and ' + esc(sp.name) + ' is not sent this order.</p>';
    body.scrollTop = 0; paintCart();
  }
  function placeOrder() {
    var sp = SPOTS[CART.place], t = cartTotals(CART.lines), body = document.getElementById('sheetBody');
    var o = { no: 'K' + Math.floor(10000 + Math.random() * 90000), place: sp.id, name: sp.name, lines: CART.lines, sub: t.sub, tax: t.tax, fee: t.fee, total: t.total, pick: S.pick, at: new Date().toISOString() };
    U.orders.unshift(o); U.orders = U.orders.slice(0, 30); save('kord.user', U);
    CART = { place: null, lines: [] }; S.step = 'done';
    body.innerHTML = '<div class="done"><span class="tick">✓</span><h2>Order ' + o.no + ' placed</h2><span class="demo">Demo: nothing was charged or sent</span>' +
      '<p class="sub">Pickup ' + esc(o.pick.toLowerCase().replace('asap', 'ASAP')) + ' at ' + esc(sp.name) + (sp.address ? ', ' + esc(sp.address.split(',')[0]) : '') + '</p></div>' +
      '<div class="lines">' + o.lines.map(function (l) { return '<div class="line"><b>' + l.qty + '×</b><span class="mid"><b>' + esc(l.n) + '</b><small>' + esc([l.opt, l.note].filter(Boolean).join(' · ')) + '</small></span><b>' + usd(l.price * l.qty) + '</b></div>'; }).join('') + '</div>' +
      '<div class="totals"><div><span>Food and tax, paid to ' + esc(sp.name) + '</span><span>' + usd(o.sub + o.tax) + '</span></div><div class="fee"><span>KORD keeps (service fee)</span><span>' + usd(o.fee) + '</span></div><div class="grand"><span>Student paid</span><span>' + usd(o.total) + '</span></div></div>' +
      '<button class="btn bigbtn" id="doneBtn">Done</button><p class="note">After you eat, come back and rate what you got.</p>';
    body.scrollTop = 0; paintCart();
  }
  function menuItems(sp) {
    var out = [], seen = {};
    function add(n, p, sec) { var k = String(n || '').trim().toLowerCase(); if (!k || seen[k]) return; seen[k] = 1; out.push({ n: String(n).trim(), p: p || '', s: sec }); }
    (sp.deals || []).forEach(function (d) { add(d.title, d.price, 'Deals'); });
    ((MENUS || {})[sp.id] || []).forEach(function (m) { add(m.n, m.p, m.s || 'Menu'); });
    var extra = (U.custom[sp.id] || []).concat(Object.keys(U.items[sp.id] || {}), Object.keys(COMMUNITY[sp.id] || {}));
    cmtsFor(sp.id).forEach(function (c) { extra.push(c.dish); });
    extra.forEach(function (n) { add(n, '', 'Added by students'); });
    return out;
  }
  function cmtsFor(id, dish) { var a = SERVER ? (CMTS[id] || []) : (U.comments[id] || []); return dish == null ? a : a.filter(function (c) { return c.dish === dish; }); }
  function ago(ts) {
    var m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hr ago' : Math.round(m / 1440) + ' d ago';
  }
  function cmtHtml(c, withDish) { return '<div class="cmt"><b>' + esc(c.name || 'Student') + '</b>' + (withDish ? ' on ' + esc(c.dish) : '') + ' <small>' + ago(c.created_at) + '</small><p>' + esc(c.body) + '</p></div>'; }
  function cmtListHtml(id, dish) { var a = cmtsFor(id, dish); return a.length ? a.slice(0, 30).map(function (c) { return cmtHtml(c); }).join('') : '<p class="note">No comments yet. Be the first to say if it is worth it.</p>'; }
  function sayingHtml(id) { var a = cmtsFor(id).slice(0, 2); return a.length ? '<div class="saying"><b>Students are saying</b>' + a.map(function (c) { return cmtHtml(c, true); }).join('') + '</div>' : ''; }
  function paintComments(id) {
    var say = document.getElementById('sayBox'), list = document.getElementById('cmtList');
    if (say) say.innerHTML = sayingHtml(id);
    if (list && S.item) list.innerHTML = cmtListHtml(id, S.item);
  }
  function dishRow(id, m) {
    var open = S.item === m.n, sc = itemScore(id, m.n), nc = cmtsFor(id, m.n).length;
    var meta = (sc ? '<span class="score">★ ' + sc.avg.toFixed(1) + '</span> (' + sc.n + ')' : '<span class="rateit">Rate it</span>') + (nc ? '<br>' + nc + ' comment' + (nc > 1 ? 's' : '') : '');
    var h = '<div class="dish' + (open ? ' open' : '') + '"><button class="dishhead" data-dish="' + esc(m.n) + '" aria-expanded="' + open + '"><span class="mname">' + esc(m.n) + (m.p ? ' <small>' + esc(m.p) + '</small>' : '') + '</span><span class="dmeta">' + meta + '</span></button>';
    if (open) h += '<div class="dishbody">' + orderBox(id, m) + '<div class="yours"><span>Your rating</span>' + miniStars(id, m.n) + '</div><div class="cmts" id="cmtList">' + cmtListHtml(id, m.n) + '</div>' +
      '<div class="addrow"><input class="search" id="cmtIn" type="text" maxlength="280" placeholder="Worth it? Tell other students" aria-label="Write a comment"><button class="btn" id="cmtBtn" data-id="' + esc(id) + '">Post</button></div>' +
      (SERVER ? '' : '<p class="note">Comments stay on this phone until the shared server is connected.</p>') + '</div>';
    return h + '</div>';
  }
  /* Refresh after new scores arrive, but never while someone is typing: a redraw would close the phone keyboard. */
  function softFill(id) { var el = document.activeElement; if (S.open !== id || S.step === 'checkout' || S.step === 'done' || (el && /^(cmtIn|ordNote|addItem|menuSearch)$/.test(el.id))) return; fillMenu(id); }
  function fillMenu(id) {
    var box = document.getElementById('menuBox'); if (!box) return;
    var sp = SPOTS[id], q = (S.mq || '').toLowerCase(), items = menuItems(sp), top = ratedItems(id), secs = [], seen = {};
    var draft = document.getElementById('cmtIn'); draft = draft ? draft.value : '';
    items.forEach(function (m) { if (!seen[m.s]) { seen[m.s] = 1; secs.push(m.s); } });
    if (top.length) secs.unshift('Top rated');
    if (secs.indexOf(S.sec) < 0) S.sec = secs[0] || '';
    var list = q ? items.filter(function (m) { return m.n.toLowerCase().indexOf(q) >= 0; }) :
      S.sec === 'Top rated' ? top.map(function (x) { return items.filter(function (m) { return m.n === x.item; })[0] || { n: x.item, p: '', s: '' }; }) :
      items.filter(function (m) { return m.s === S.sec; });
    var h = '<div id="sayBox">' + sayingHtml(id) + '</div>' +
      '<input class="search" id="menuSearch" type="search" placeholder="What did you get? Search the menu" value="' + esc(S.mq || '') + '" aria-label="Search the menu">';
    if (!q && secs.length > 1) h += '<div class="chips">' + secs.map(function (c) { return '<button class="chip" data-sec="' + esc(c) + '" aria-pressed="' + (S.sec === c) + '">' + esc(c) + '</button>'; }).join('') + '</div>';
    h += list.length ? '<div class="dishes">' + list.slice(0, 60).map(function (m) { return dishRow(id, m); }).join('') + '</div>' :
      '<p class="note">' + (q ? 'No dish matches. Add it below.' : 'We do not have this menu yet. Add what you ordered below.') + '</p>';
    h += '<div class="addrow"><input class="search" id="addItem" type="text" maxlength="60" placeholder="Not listed? Type what you got" aria-label="Add a dish"><button class="btn ghost" id="addItemBtn" data-id="' + esc(id) + '">Add</button></div>';
    box.innerHTML = h;
    var again = document.getElementById('cmtIn'); if (again && draft) again.value = draft;
  }
  function spotSheet(id, deal) {
    var sp = SPOTS[id]; if (!sp) return;
    var web = safeUrl(sp.website);
    var h = (photo(sp.photo) ? '<div class="banner" style="--c:' + color(sp.category) + '"><img alt="" src="' + esc(photo(sp.photo)) + '"></div>' : '') + '<div class="spothead">' + logo(sp, 'big') + '<div><h2>' + esc(sp.name) + '</h2><p class="sub">' + esc(sp.category) + (sp.price ? ' · ' + esc(sp.price) : '') + '</p>' + tagsHtml(sp) + '</div></div>';
    if (sp.blurb) h += '<p style="margin:0">' + esc(sp.blurb) + '</p>';
    var order = safeUrl(sp.order), look = 'https://www.google.com/search?q=' + encodeURIComponent(sp.name + ' ' + (sp.address || town().name + ' Ohio'));
    h += '<div class="btnrow">' +
      (order ? '<a class="btn hot" target="_blank" rel="noopener" data-order="' + esc(id) + '" href="' + esc(outLink(order)) + '">Order online</a>' : '') +
      (web && web !== order ? '<a class="btn ' + (order ? 'ghost' : 'hot') + '" target="_blank" rel="noopener" data-order="' + esc(id) + '" href="' + esc(outLink(web)) + '">Website</a>' : '') +
      (!web && !order ? '<a class="btn hot" target="_blank" rel="noopener" href="' + esc(look) + '">Look it up</a>' : '') +
      '<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(sp.name + ' ' + (sp.address || town().name + ' Ohio')) + '">Directions</a></div>';
    if (sp.address) h += '<p class="note">' + esc(sp.address) + (travel(sp) ? ' · about ' + travel(sp) + ' from campus' : '') + '</p>';
    h += '<div class="sechead"><h2>Deals this week</h2></div>';
    var withDeals = DAYS.filter(function (d) { return (sp.deals || []).some(function (x) { return x.days.indexOf(d) >= 0; }); });
    if (withDeals.length) {
      h += '<div class="week">' + withDeals.map(function (d) {
        return '<div class="wd' + (d === S.day ? ' sel' : '') + '"><b>' + d + '</b><div>' + sp.deals.filter(function (x) { return x.days.indexOf(d) >= 0; }).map(function (x) {
          var u = safeUrl(x.sourceUrl);
          return '<div class="wdeal"><strong>' + esc(x.title) + (x.price && x.title.indexOf(x.price) < 0 ? ' · ' + esc(x.price) : '') + '</strong><span>' + esc(x.details) + '</span>' +
            (u ? '<a target="_blank" rel="noopener" href="' + esc(u) + '">Source: ' + esc(domain(u)) + (x.sourceDate ? ' (' + esc(x.sourceDate) + ')' : '') + '</a>' : '') + '</div>';
        }).join('') + '</div></div>';
      }).join('') + '</div>';
    } else h += '<div class="empty">No weekly deal found here yet.</div>';
    h += '<div><div class="sechead"><h2>What is good here</h2></div><p class="sub">Pick a category or search, then tap a dish to rate it and read what other students said.</p></div><div id="menuBox"></div>';
    document.getElementById('sheetRoot').innerHTML = '<div class="scrim" data-close><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(sp.name) + '"><div class="sheethead"><button class="x" data-close aria-label="Close">×</button></div><div class="sheetbody" id="sheetBody">' + h + '</div><div id="cartBar"></div></div></div>';
    S.mq = ''; S.sec = deal ? 'Deals' : ''; S.item = deal || null; S.opt = ''; S.qty = 1; S.step = ''; S.open = id; fillMenu(id); paintCart();
    if (deal) { var mb = document.querySelector('#menuBox .dish.open'); if (mb) mb.scrollIntoView({ block: 'start' }); }
    clearInterval(POLL);
    if (SERVER) { loadComments(id); loadScores(function () { softFill(id); }); POLL = setInterval(function () { if (S.open === id && !document.hidden) loadComments(id); }, 12000); }
    if (!MENUS) fetch('data/menus.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (m) { MENUS = m || {}; if (S.open === id) fillMenu(id); });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a, [data-close]'); if (!t) return;
    if (t.matches('[data-close]') && (e.target === t || t.classList.contains('x'))) { closeSheet(); return render(); }
    if (t.dataset.order && SERVER) api('rpc/log_order', { p_device: U.device, p_town: S.town, p_place: t.dataset.order }).catch(function () {});
    if (t.dataset.rate) {
      var id = t.dataset.id, it = t.dataset.item, n = +t.dataset.rate; U.items[id] = U.items[id] || {};
      if (U.items[id][it] === n) { delete U.items[id][it]; n = 0; } else U.items[id][it] = n;
      if (!Object.keys(U.items[id]).length) delete U.items[id];
      save('kord.user', U); fillMenu(id);
      if (SERVER) api('rpc/rate_dish', { p_device: U.device, p_town: S.town, p_place: id, p_dish: it, p_stars: n }).then(function () { loadScores(function () { softFill(id); }); }).catch(function () {});
      return;
    }
    if (t.dataset.sec) { S.sec = t.dataset.sec; S.item = null; return fillMenu(S.open); }
    if (t.dataset.dish) { S.item = S.item === t.dataset.dish ? null : t.dataset.dish; S.opt = ''; S.qty = 1; return fillMenu(S.open); }
    if (t.dataset.opt) { S.opt = t.dataset.opt; return fillMenu(S.open); }
    if (t.dataset.qty) { S.qty = Math.max(1, Math.min(20, (S.qty || 1) + (+t.dataset.qty))); return fillMenu(S.open); }
    if (t.id === 'addCart') {
      if (CART.place !== t.dataset.id) CART = { place: t.dataset.id, lines: [] };
      var nt = document.getElementById('ordNote');
      CART.lines.push({ n: t.dataset.name, price: +t.dataset.price, qty: S.qty || 1, opt: optSet(t.dataset.name) ? S.opt : '', note: nt ? nt.value.trim() : '' });
      S.qty = 1; S.item = null; fillMenu(S.open); return paintCart();
    }
    if (t.id === 'cartBtn') return checkout();
    if (t.dataset.rm) { CART.lines.splice(+t.dataset.rm, 1); return checkout(); }
    if (t.dataset.pick) { S.pick = t.dataset.pick; return checkout(); }
    if (t.id === 'backMenu') { S.step = ''; return spotSheet(CART.place || S.open); }
    if (t.id === 'placeOrder') return placeOrder();
    if (t.id === 'doneBtn') { closeSheet(); return render(); }
    if (t.id === 'cmtBtn') {
      var cin = document.getElementById('cmtIn'), body = (cin.value || '').trim(), pid = t.dataset.id, dish = S.item;
      if (!body || !dish) return;
      cin.value = '';
      if (SERVER) {
        (CMTS[pid] = CMTS[pid] || []).unshift({ dish: dish, name: U.name || 'Student', body: body, created_at: new Date().toISOString() });
        api('rpc/add_comment', { p_device: U.device, p_town: S.town, p_place: pid, p_dish: dish, p_name: U.name || 'Student', p_body: body }).then(function () { loadComments(pid); })
          .catch(function () { CMTS[pid].shift(); cin.value = body; paintComments(pid); });
      } else {
        (U.comments[pid] = U.comments[pid] || []).unshift({ dish: dish, name: U.name || 'You', body: body, created_at: new Date().toISOString() });
        save('kord.user', U);
      }
      return fillMenu(pid);
    }
    if (t.id === 'addItemBtn') { var box = document.getElementById('addItem'), name = (box.value || '').trim(); if (name) { var sid = t.dataset.id; U.custom[sid] = U.custom[sid] || []; if (U.custom[sid].indexOf(name) < 0) U.custom[sid].push(name); save('kord.user', U); S.mq = ''; fillMenu(sid); } return; }
    if (t.dataset.spot) return spotSheet(t.dataset.spot, t.dataset.deal);
    if (t.dataset.town) { S.town = t.dataset.town; setTimeout(function () { loadScores(function () { if (!S.open) render(); }); }, 0); S.picking = false; S.tab = 'deals'; S.q = ''; S.day = TODAY; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.day) { S.day = t.dataset.day; return render(); }
    if (t.dataset.tab) { S.tab = t.dataset.tab; if (S.tab !== 'deals') loadScores(function () { if (!S.open) render(); }); render(); window.scrollTo(0, 0); try { history.replaceState(null, '', '#' + S.tab); } catch (err) {} return; }
    if (t.dataset.local) { S.localOnly = t.dataset.local === '1'; return render(); }
    if (t.id === 'swapBtn') { S.picking = true; render(); window.scrollTo(0, 0); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'spotSearch') { S.q = t.value; render(); var n = document.getElementById('spotSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    if (t.id === 'nameIn' || t.id === 'ordName') { U.name = t.value.trim(); save('kord.user', U); }
    if (t.id === 'menuSearch') { S.mq = t.value; fillMenu(S.open); var ms = document.getElementById('menuSearch'); if (ms) { ms.focus(); ms.setSelectionRange(ms.value.length, ms.value.length); } }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'nameIn') render();
    if (t.id === 'avatarFile' && t.files && t.files[0]) {
      var fr = new FileReader();
      fr.onload = function () { var im = new Image(); im.onload = function () {
        var c = document.createElement('canvas'), s = Math.min(im.width, im.height); c.width = c.height = 192;
        c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 192, 192);
        U.avatar = c.toDataURL('image/jpeg', .82); save('kord.user', U); render();
      }; im.src = fr.result; };
      fr.readAsDataURL(t.files[0]);
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSheet(); if (DATA) render(); } });

  fetch('data/kord.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    DATA = d;
    if (d.server && /^https:\/\//.test(d.server.url || '') && d.server.key) SERVER = { url: d.server.url.replace(/\/+$/, ''), key: d.server.key };
    var dev = /[?&]server=(http[^&]+)/.exec(location.search); if (dev && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) SERVER = { url: decodeURIComponent(dev[1]), key: 'dev' };
    d.towns.forEach(function (t) { t.spots.forEach(function (s) { SPOTS[s.id] = s; }); });
    var h = (location.hash || '').slice(1); if (['deals', 'places', 'best', 'you'].indexOf(h) >= 0) S.tab = h;
    render();
    loadScores(function () { if (!S.open) render(); });
  }).catch(function () {
    document.getElementById('view').innerHTML = '<div class="empty"><b>Could not load the deals</b>Check your connection and reopen KORD.</div>';
  });
})();

if ('serviceWorker' in navigator && /^https:/.test(location.href) && !/htmlpreview/.test(location.host)) navigator.serviceWorker.register('sw.js').catch(function () {});
