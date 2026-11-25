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
  if (['deals', 'places', 'you'].indexOf(S.tab) < 0) S.tab = 'deals';
  var U = load('kord.user', { name: '', avatar: '', ratings: {}, notes: {} });
  U.ratings = U.ratings || {}; U.notes = U.notes || {};

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
  function cheapest(a) {
    return a.sort(function (x, y) {
      var px = priceNum(x.d.price || x.d.title), py = priceNum(y.d.price || y.d.title);
      if (px == null && py != null) return 1; if (py == null && px != null) return -1;
      if (px != null && px !== py) return px - py;
      return (y.sp.local ? 1 : 0) - (x.sp.local ? 1 : 0) || x.sp.name.localeCompare(y.sp.name);
    });
  }
  function spotLow(sp) { var lo = null; (sp.deals || []).forEach(function (d) { var p = priceNum(d.price || d.title); if (p != null && (lo == null || p < lo)) lo = p; }); return lo; }
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
    var st = stubText(x.d), ph = photo(x.d.photo || x.sp.photo);
    return '<button class="dcard' + (hero ? ' hero' : '') + '" data-spot="' + esc(x.sp.id) + '" style="--c:' + color(x.sp.category) + '">' +
      '<span class="ph' + (ph ? '' : x.sp.logo ? ' nophoto haslogo' : ' nophoto') + '">' + (ph ? '<img alt="" loading="lazy" src="' + esc(ph) + '">' : x.sp.logo ? '<img alt="" loading="lazy" src="' + esc(x.sp.logo) + '">' : '<span class="mono">' + esc(initials(x.sp.name)) + '</span>') +
      (hero ? '<span class="flag">Cheapest ' + (S.day === TODAY ? 'today' : DAYNAME[S.day]) + '</span>' : '') +
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
    var list = cheapest(all.filter(function (x) { return !S.localOnly || x.sp.local; }));
    var when = S.day === TODAY ? 'today' : 'on ' + DAYNAME[S.day];
    var h = '<div><h2>Cheapest food ' + when + '</h2><p class="sub">Lowest price first. Tap a deal to see the place.</p></div>' +
      '<div class="seg"><button data-local="0" aria-pressed="' + !S.localOnly + '">Everything</button><button data-local="1" aria-pressed="' + S.localOnly + '">Local spots only</button></div>';
    if (!list.length) {
      var other = DAYS.filter(function (d) { return dealsFor(t, d).length; });
      h += '<div class="empty"><b>No deals found for ' + DAYNAME[S.day] + '</b>' + (all.length ? 'Switch to Everything to see chain deals.' : other.length ? 'Try ' + other.map(function (d) { return DAYNAME[d]; }).join(', ') + '.' : 'Check Places for where to eat.') + '</div>';
    } else {
      h += ticket(list[0], true);
      if (list.length > 1) h += '<div class="sechead"><h2>More deals</h2><span>' + (list.length - 1) + '</span></div><div class="list">' + list.slice(1).map(function (x) { return ticket(x); }).join('') + '</div>';
    }
    return h + '<p class="note">Deals change. Each one links to where we found it, so check before you go. Photos come from each restaurant\'s own website.</p>';
  }
  function spotRow(sp) {
    var lo = spotLow(sp), n = (sp.deals || []).length, r = U.ratings[sp.id];
    return '<button class="row" data-spot="' + esc(sp.id) + '">' + logo(sp) +
      '<span class="mid"><h3>' + esc(sp.name) + '</h3><p>' + esc(sp.category) + (sp.price ? ' · ' + esc(sp.price) : '') + (r ? ' · <span class="mystars">' + '★'.repeat(r) + '</span>' : '') + '</p></span>' +
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
  function viewYou() {
    var rated = Object.keys(U.ratings).filter(function (id) { return SPOTS[id]; }).sort(function (a, b) { return U.ratings[b] - U.ratings[a]; });
    var h = '<div class="me"><span class="avatar">' + (U.avatar ? '<img alt="" src="' + esc(U.avatar) + '">' : esc(U.name ? initials(U.name) : '?')) + '</span>' +
      '<div><h2>' + esc(U.name || 'Your profile') + '</h2><p class="sub">' + esc(town().school.name) + '</p>' +
      '<div class="btnrow" style="margin-top:8px"><label class="btn ghost" for="avatarFile">Add a photo</label><input id="avatarFile" type="file" accept="image/*" hidden></div></div></div>' +
      '<label class="field" for="nameIn">Your name<input id="nameIn" type="text" maxlength="30" autocomplete="nickname" placeholder="What should we call you?" value="' + esc(U.name) + '"></label>' +
      '<div class="sechead"><h2>Your reviews</h2><span>' + rated.length + '</span></div>';
    h += rated.length ? '<div class="list">' + rated.map(function (id) {
      var sp = SPOTS[id];
      return '<button class="row" data-spot="' + esc(id) + '">' + logo(sp) + '<span class="mid"><h3>' + esc(sp.name) + '</h3><p><span class="mystars">' + '★'.repeat(U.ratings[id]) + '</span></p>' + (U.notes[id] ? '<p class="quote">' + esc(U.notes[id]) + '</p>' : '') + '</span></button>';
    }).join('') + '</div>' : '<div class="empty"><b>No reviews yet</b>Open any place and tap the stars.</div>';
    h += '<p class="note">Your profile and reviews are saved on this phone.</p>';
    return h;
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
    v.innerHTML = S.tab === 'places' ? viewPlaces() : S.tab === 'you' ? viewYou() : viewDeals();
    save('kord.prefs', { town: S.town, tab: S.tab });
  }

  /* place sheet */
  function closeSheet() { document.getElementById('sheetRoot').innerHTML = ''; }
  function starsHtml(id) { var r = U.ratings[id] || 0, h = ''; for (var i = 1; i <= 5; i++) h += '<button class="' + (i <= r ? 'on' : '') + '" data-rate="' + i + '" data-id="' + esc(id) + '" aria-label="' + i + ' star' + (i > 1 ? 's' : '') + '">★</button>'; return '<div class="stars" role="group" aria-label="Your rating">' + h + '</div>'; }
  function spotSheet(id) {
    var sp = SPOTS[id]; if (!sp) return;
    var web = safeUrl(sp.website);
    var h = (photo(sp.photo) ? '<div class="banner" style="--c:' + color(sp.category) + '"><img alt="" src="' + esc(photo(sp.photo)) + '"></div>' : '') + '<div class="spothead">' + logo(sp, 'big') + '<div><h2>' + esc(sp.name) + '</h2><p class="sub">' + esc(sp.category) + (sp.price ? ' · ' + esc(sp.price) : '') + '</p>' + tagsHtml(sp) + '</div></div>';
    if (sp.blurb) h += '<p style="margin:0">' + esc(sp.blurb) + '</p>';
    h += '<div class="btnrow">' + (web ? '<a class="btn hot" target="_blank" rel="noopener" href="' + esc(web) + '">Website</a>' : '<a class="btn hot" target="_blank" rel="noopener" href="https://www.google.com/search?q=' + encodeURIComponent(sp.name + ' ' + (sp.address || town().name + ' Ohio')) + '">Look it up</a>') +
      '<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(sp.name + ' ' + (sp.address || town().name + ' Ohio')) + '">Directions</a></div>';
    if (sp.address) h += '<p class="note">' + esc(sp.address) + '</p>';
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
    h += '<div class="sechead"><h2>Your review</h2></div>' + starsHtml(id) +
      '<label class="field" for="noteIn">What should people order?<textarea id="noteIn" data-id="' + esc(id) + '" maxlength="240" placeholder="Optional">' + esc(U.notes[id] || '') + '</textarea></label>';
    document.getElementById('sheetRoot').innerHTML = '<div class="scrim" data-close><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(sp.name) + '"><div class="sheethead"><button class="x" data-close aria-label="Close">×</button></div><div class="sheetbody">' + h + '</div></div></div>';
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a, [data-close]'); if (!t) return;
    if (t.matches('[data-close]') && (e.target === t || t.classList.contains('x'))) { closeSheet(); return render(); }
    if (t.dataset.rate) { var id = t.dataset.id, n = +t.dataset.rate; if (U.ratings[id] === n) delete U.ratings[id]; else U.ratings[id] = n; save('kord.user', U); t.parentNode.outerHTML = starsHtml(id); return; }
    if (t.dataset.spot) return spotSheet(t.dataset.spot);
    if (t.dataset.town) { S.town = t.dataset.town; S.picking = false; S.tab = 'deals'; S.q = ''; S.day = TODAY; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.day) { S.day = t.dataset.day; return render(); }
    if (t.dataset.tab) { S.tab = t.dataset.tab; render(); window.scrollTo(0, 0); try { history.replaceState(null, '', '#' + S.tab); } catch (err) {} return; }
    if (t.dataset.local) { S.localOnly = t.dataset.local === '1'; return render(); }
    if (t.id === 'swapBtn') { S.picking = true; render(); window.scrollTo(0, 0); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'spotSearch') { S.q = t.value; render(); var n = document.getElementById('spotSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    if (t.id === 'nameIn') { U.name = t.value.trim(); save('kord.user', U); }
    if (t.id === 'noteIn') { var v = t.value.trim(); if (v) U.notes[t.dataset.id] = v; else delete U.notes[t.dataset.id]; save('kord.user', U); }
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
    d.towns.forEach(function (t) { t.spots.forEach(function (s) { SPOTS[s.id] = s; }); });
    var h = (location.hash || '').slice(1); if (['deals', 'places', 'you'].indexOf(h) >= 0) S.tab = h;
    render();
  }).catch(function () {
    document.getElementById('view').innerHTML = '<div class="empty"><b>Could not load the deals</b>Check your connection and reopen KORD.</div>';
  });
})();

if ('serviceWorker' in navigator && /^https:/.test(location.href) && !/htmlpreview/.test(location.host)) navigator.serviceWorker.register('sw.js').catch(function () {});
