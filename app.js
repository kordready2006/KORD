window.KORD_BUILD = '20261127-222512';
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
  /* Ratings are 1 to 10. Older saves used 1 to 5 stars: double them once. */
  if (U.scale !== 10) { Object.keys(U.items).forEach(function (id) { Object.keys(U.items[id]).forEach(function (k) { U.items[id][k] = Math.min(10, U.items[id][k] * 2); }); }); U.scale = 10; save('kord.user', U); }
  /* Dish ratings: U.items[placeId][dish] = 1..5 on this phone. COMMUNITY[placeId][dish] = {sum, n} is where other students'
     ratings go once a shared ratings server is connected; every score below already combines the two. */
  var COMMUNITY = {}, MENUS = null, SERVER = null, LOADED = {}, CMTS = {}, POLL = null;
  U.comments = U.comments || {}; U.reported = U.reported || {}; U.liked = U.liked || {};
  if (!U.device) {
    U.device = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
    save('kord.user', U);
  }
  /* Shared server (Supabase REST). Phones read two summary views and call three functions; see server/schema.sql. */
  function api(path, body) {
    if (!SERVER) return Promise.reject(new Error('no server'));
    return fresh().then(function (tok) {
      var h = { apikey: SERVER.key, Authorization: 'Bearer ' + (tok || SERVER.key) };
      if (body) h['Content-Type'] = 'application/json';
      return fetch(SERVER.url + '/rest/v1/' + path, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined });
    }).then(function (r) {
      return r.text().then(function (t) { if (!r.ok) throw new Error(t || r.status); return t ? JSON.parse(t) : null; });
    });
  }
  /* ---- Accounts (Supabase Auth, email and password). AUTH holds the session; ME the profile; VOTES the 12-hour tally. ---- */
  var AUTH = load('kord.auth', null), ME = null, VOTES = null, REFRESHING = null;
  if (AUTH && !(AUTH.access_token && AUTH.user)) AUTH = null;
  function authCall(path, body, method, token) {
    return fetch(SERVER.url + '/auth/v1/' + path, { method: method || 'POST', headers: { apikey: SERVER.key, Authorization: 'Bearer ' + (token || SERVER.key), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.text().then(function (t) { var j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) {} if (!r.ok) { var er = new Error(j.msg || j.error_description || j.message || j.error || String(r.status)); er.code = j.error_code || j.code || ''; throw er; } return j; }); });
  }
  function setSession(j) {
    AUTH = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (+j.expires_in || 3600), user: { id: j.user.id, email: j.user.email } };
    save('kord.auth', AUTH);
  }
  function dropSession() { AUTH = null; ME = null; VOTES = null; try { localStorage.removeItem('kord.auth'); } catch (e) {} U.items = {}; save('kord.user', U); }
  /* A token that is still good, refreshing it first when it is about to run out. Resolves to '' when signed out. */
  function fresh() {
    if (!AUTH || !SERVER) return Promise.resolve('');
    if (AUTH.expires_at - 60 > Date.now() / 1000) return Promise.resolve(AUTH.access_token);
    if (!REFRESHING) REFRESHING = authCall('token?grant_type=refresh_token', { refresh_token: AUTH.refresh_token }).then(setSession, function (e) { if (!/fetch|network/i.test(e.message)) dropSession(); })
      .then(function () { REFRESHING = null; return AUTH ? AUTH.access_token : ''; });
    return REFRESHING;
  }
  function authMsg(e) {
    var m = String(e && e.message || ''), c = String(e && e.code || '');
    if (/invalid login|invalid_credentials/i.test(m + c)) return 'That email and password do not match. Try again or reset your password.';
    if (/not confirmed/i.test(m + c)) return 'Verify your email first: open the link we sent you, then sign in.';
    if (/already registered|user_already_exists/i.test(m + c)) return 'That email already has an account. Sign in instead.';
    if (/rate limit|too many|over_email/i.test(m + c)) return 'Too many tries. Wait a few minutes and try again.';
    if (/password/i.test(m) && /least|short|weak/i.test(m)) return 'Use a password with at least 8 characters.';
    if (/same.*password|different from the old/i.test(m)) return 'Pick a password you have not used here before.';
    if (/valid email|invalid.*email|email_address_invalid/i.test(m + c)) return 'That does not look like an email address.';
    if (/fetch|network/i.test(m)) return 'No connection. Check your internet and try again.';
    return 'Something went wrong. Please try again.';
  }
  function loadMe(then) {
    if (!SERVER || !AUTH) { if (then) then(); return; }
    Promise.all([api('rpc/my_profile', {}), api('rpc/my_votes', {}), api('rpc/my_ratings', {})]).then(function (r) {
      ME = r[0] || { username: 'Student' }; VOTES = r[1] || null;
      U.items = {}; (r[2] || []).forEach(function (x) { (U.items[x.place_id] = U.items[x.place_id] || {})[x.dish] = +x.stars; });
      U.name = ME.username; save('kord.user', U);
    }).catch(function () {}).then(function () { if (then) then(); });
  }
  function loadVotes(then) { if (!SERVER || !AUTH) return; api('rpc/my_votes', {}).then(function (v) { VOTES = v; if (then) then(); }).catch(function () {}); }
  /* Rating, commenting and photos need an account once the shared server is on. Returns true when it had to ask. */
  function needAccount(what) {
    if (!SERVER || AUTH) return false;
    authSheet('up', 'Create a free account to ' + what + '. One account, one vote per dish.');
    return true;
  }
  function authSheet(mode, note, err) {
    if (S.open) S.back = { id: S.open, item: S.item, sec: S.sec };
    clearInterval(POLL); S.open = null; S.auth = mode;
    var T = { up: ['Become a member', 'Join KORD'], 'in': ['Members', 'Sign in'], forgot: ['Members', 'Forgot password'], newpass: ['Members', 'Set a new password'], sent: ['Check your email', 'Verify your email'], del: ['Danger zone', 'Delete your account'] }[mode];
    var h = '<div><span class="kick rust">' + T[0] + '</span><h2 style="margin-top:6px">' + T[1] + '</h2>' + (note ? '<p class="sub" style="margin-top:8px">' + esc(note) + '</p>' : '') + '</div>';
    if (err) h += '<p class="autherr" role="alert">' + esc(err) + '</p>';
    var email = '<label class="field" for="auEmail">Email<input id="auEmail" type="email" autocomplete="email" inputmode="email" autocapitalize="none" value="' + esc(S.authEmail || '') + '"></label>';
    if (mode === 'up') h += '<label class="field" for="auName">Display name<input id="auName" type="text" maxlength="30" autocomplete="nickname" value="' + esc(S.authName || '') + '"></label>' + email +
      '<label class="field" for="auPass">Password<input id="auPass" type="password" autocomplete="new-password" minlength="8"></label><p class="note">Use at least 8 characters.</p>' +
      '<button class="btn bigbtn" id="auGo">Create account</button><p class="sub" style="text-align:center">Already have an account? <button class="lnk" data-auth="in">Sign in</button></p>' +
      '<p class="note" style="text-align:center">By creating an account you agree to our <a target="_blank" rel="noopener" href="terms.html">Terms</a> and <a target="_blank" rel="noopener" href="privacy.html">Privacy Policy</a>.</p>';
    else if (mode === 'in') h += email + '<label class="field" for="auPass">Password<input id="auPass" type="password" autocomplete="current-password"></label>' +
      '<button class="btn bigbtn" id="auGo">Sign in</button><p class="sub" style="text-align:center"><button class="lnk" data-auth="forgot">Forgot your password?</button></p>' +
      '<p class="sub" style="text-align:center">New here? <button class="lnk" data-auth="up">Create an account</button></p>';
    else if (mode === 'forgot') h += '<p class="sub">Enter your email and we will send you a link to reset your password.</p>' + email + '<button class="btn bigbtn" id="auGo">Send reset link</button><p class="sub" style="text-align:center">Remember it? <button class="lnk" data-auth="in">Sign in</button></p>';
    else if (mode === 'newpass') h += '<label class="field" for="auPass">New password<input id="auPass" type="password" autocomplete="new-password" minlength="8"></label><p class="note">Use at least 8 characters.</p><button class="btn bigbtn" id="auGo">Save new password</button>';
    else if (mode === 'sent') h += '<button class="btn bigbtn" data-auth="in">Go to sign in</button>';
    else if (mode === 'del') h += '<p class="sub">This permanently removes your account, your ratings, your comments and your photos. It cannot be undone.</p><label class="field" for="auConfirm">Type DELETE to confirm<input id="auConfirm" type="text" autocapitalize="characters" autocomplete="off"></label><button class="btn bigbtn" id="auGo" style="background:var(--hot);color:#fff">Delete my account for good</button>';
    document.getElementById('sheetRoot').innerHTML = '<div class="scrim" data-close><div class="sheet" role="dialog" aria-modal="true" aria-label="' + T[1] + '"><div class="sheethead"><button class="x" data-close aria-label="Close">×</button></div><div class="sheetbody authbody" id="sheetBody">' + h + '</div></div></div>';
    var first = document.querySelector('#sheetBody input'); if (first && !('ontouchstart' in window)) first.focus();
  }
  function authDone(msg) {
    var back = S.back; S.back = null; S.auth = null; document.getElementById('sheetRoot').innerHTML = '';
    loadMe(function () {
      render(); if (msg) toast(msg);
      if (back && SPOTS[back.id]) { spotSheet(back.id); S.item = back.item; S.sec = back.sec || 'All'; fillMenu(back.id); var mb = document.querySelector('#menuBox .dish.open'); if (mb) mb.scrollIntoView({ block: 'center' }); }
    });
  }
  function authGo() {
    var mode = S.auth, btn = document.getElementById('auGo'), val = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var email = val('auEmail').trim(), pass = val('auPass'), name = val('auName').trim(), here = location.origin + location.pathname;
    S.authEmail = email; S.authName = name;
    function fail(m) { authSheet(mode, '', m); }
    if (mode === 'del') {
      if (val('auConfirm').trim() !== 'DELETE') return fail('Type DELETE in capital letters to confirm.');
      btn.disabled = true; btn.textContent = 'Deleting…';
      return api('rpc/my_photo_paths', {}).then(function (paths) {
        if (!paths || !paths.length) return;
        return fresh().then(function (tok) { return fetch(SERVER.url + '/storage/v1/object/dish-photos', { method: 'DELETE', headers: { apikey: SERVER.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) }); });
      }).then(function () { return api('rpc/delete_account', {}); }).then(function () {
        dropSession(); U.name = ''; U.comments = {}; save('kord.user', U); S.auth = null; document.getElementById('sheetRoot').innerHTML = ''; render(); toast('Your account has been deleted.');
      }).catch(function (e) { fail(/last admin/.test(e.message) ? 'You are the only admin. Make someone else an admin before deleting this account.' : 'Could not delete the account. Please try again.'); });
    }
    if (mode !== 'newpass' && !/^\S+@\S+\.\S+$/.test(email)) return fail('Enter your email address.');
    if ((mode === 'up' || mode === 'newpass') && pass.length < 8) return fail('Use a password with at least 8 characters.');
    if (mode === 'in' && !pass) return fail('Enter your password.');
    if (mode === 'up' && !/^[A-Za-z0-9_ .-]{2,30}$/.test(name)) return fail('Pick a display name of 2 to 30 letters or numbers.');
    btn.disabled = true; btn.textContent = 'One moment…';
    if (mode === 'up') return api('rpc/username_taken', { p_username: name }).then(function (taken) {
      if (taken) { fail('That display name is taken. Try another.'); return; }
      return authCall('signup?redirect_to=' + encodeURIComponent(here), { email: email, password: pass, data: { username: name } }).then(function (j) {
        if (j.access_token) { setSession(j); return authDone('Welcome to KORD, ' + name); }
        authSheet('sent', 'We sent a link to ' + email + '. Open it to verify your email, then sign in. It can take a minute, and it may land in spam.');
      });
    }).catch(function (e) { fail(authMsg(e)); });
    if (mode === 'in') return authCall('token?grant_type=password', { email: email, password: pass }).then(function (j) { setSession(j); authDone('Signed in'); }).catch(function (e) { fail(authMsg(e)); });
    if (mode === 'forgot') return authCall('recover?redirect_to=' + encodeURIComponent(here), { email: email }).then(function () {
      authSheet('sent', 'If ' + email + ' has an account, a reset link is on its way. Open it on this phone to choose a new password.');
    }).catch(function (e) { fail(authMsg(e)); });
    if (mode === 'newpass') return fresh().then(function (tok) { return authCall('user', { password: pass }, 'PUT', tok); }).then(function () { authDone('Password changed. You are signed in.'); }).catch(function (e) { fail(authMsg(e)); });
  }
  /* Links in the verification and reset emails come back here with the session, or an error, after the # in the address. */
  function authFromLink() {
    var h = (location.hash || '').slice(1); if (!/access_token=|error=/.test(h)) return false;
    var q = {}; h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    if (q.error || !q.access_token) { authSheet('in', '', /expired|invalid|otp/i.test((q.error_code || '') + (q.error_description || '')) ? 'That link is invalid or has expired. Ask for a new one below.' : 'That link did not work. Try again.'); return true; }
    authCall('user', null, 'GET', q.access_token).then(function (u) {
      setSession({ access_token: q.access_token, refresh_token: q.refresh_token, expires_in: q.expires_in, user: u });
      if (q.type === 'recovery') { loadMe(render); authSheet('newpass', 'Choose a new password for ' + u.email + '.'); }
      else authDone('Email verified. You are signed in.');
    }).catch(function () { authSheet('in', '', 'That link is invalid or has expired. Ask for a new one below.'); });
    return true;
  }
  function accountHtml() {
    if (!SERVER) return '';
    if (!AUTH) return '<div class="acct"><span class="kick rust">Members</span><h2>Join KORD</h2><p class="sub">Create a free account to rate dishes, comment and add photos. One account, one vote per dish.</p><div class="btnrow"><button class="btn" data-auth="up">Create account</button><button class="btn ghost" data-auth="in">Sign in</button></div></div>';
    var v = VOTES || {}, next = v.next_at && !v.remaining ? new Date(v.next_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    function stat(n, l) { return '<div class="stat"><b>' + (n == null ? '—' : n) + '</b><span>' + l + '</span></div>'; }
    return '<div class="acct"><span class="kick rust">' + (ME && ME.is_admin ? 'Member · Admin' : 'Member') + '</span><h2>' + esc(ME ? ME.username : 'Your account') + '</h2><p class="sub">' + esc(AUTH.user.email) + '</p>' +
      '<div class="stats">' + stat(v.used, 'Last 12 hours') + stat(v.remaining, 'Remaining') + stat(v.highest, 'Highest rating given') + stat(v.rated, 'Dishes rated') + '</div>' +
      '<p class="note">You can rate ' + (v.cap || 20) + ' new dishes every 12 hours. Changing a rating you already gave is free.' + (next ? ' More ratings open up at ' + esc(next) + '.' : '') + '</p>' +
      '<div class="btnrow"><button class="btn ghost" id="signOut">Sign out</button><button class="lnk" data-auth="del" style="color:var(--muted)">Delete account</button></div></div>';
  }
  function loadScores(then) {
    var t = DATA && town(); if (!SERVER || !t) return;
    loadPhotos(then); loadExtras(then);
    api('dish_scores?select=place_id,dish,avg,n&town=eq.' + encodeURIComponent(t.id)).then(function (rows) {
      t.spots.forEach(function (sp) { delete COMMUNITY[sp.id]; });
      (rows || []).forEach(function (r) { (COMMUNITY[r.place_id] = COMMUNITY[r.place_id] || {})[r.dish] = { avg: +r.avg, n: +r.n }; });
      LOADED[t.id] = true;
      if (then) then();
    }).catch(function () {});
  }
  function loadComments(id) {
    if (!SERVER) return;
    api('dish_comments?select=id,dish,name,body,created_at&order=created_at.desc&limit=80&place_id=eq.' + encodeURIComponent(id)).then(function (rows) {
      CMTS[id] = rows || [];
      if (S.open === id) paintComments(id);
    }).catch(function () {});
  }
  /* Student photos of dishes. PHOTOS[placeId][dish] = [{id, path}], newest first. Files sit in a public storage bucket. */
  var PHOTOS = {}, HASPHOTOS = false;
  function photoUrl(path) { return SERVER.url + '/storage/v1/object/public/dish-photos/' + String(path).split('/').map(encodeURIComponent).join('/'); }
  function loadPhotos(then) {
    var t = DATA && town(); if (!SERVER || !t) return;
    var q = '&order=created_at.desc&limit=600&town=eq.' + encodeURIComponent(t.id);
    api('dish_photos?select=id,place_id,dish,path,featured,likes' + q).catch(function () { return api('dish_photos?select=id,place_id,dish,path' + q); }).then(function (rows) {
      HASPHOTOS = true;
      t.spots.forEach(function (sp) { delete PHOTOS[sp.id]; });
      (rows || []).forEach(function (r) { var a = (PHOTOS[r.place_id] = PHOTOS[r.place_id] || {}); (a[r.dish] = a[r.dish] || []).push(r); });
      if (then) then();
    }).catch(function () {});
  }
  function likes(r) { return (r.likes || 0) + (U.liked['ph' + r.id] && !r.counted ? 0 : 0); }
  /* Best first: featured by the owner, then most "Looks right" taps, then newest. */
  function dishPhotos(id, dish) {
    return (((PHOTOS[id] || {})[dish]) || []).filter(function (r) { return !U.reported['ph' + r.id]; })
      .sort(function (x, y) { return (y.featured ? 1 : 0) - (x.featured ? 1 : 0) || likes(y) - likes(x) || y.id - x.id; });
  }
  /* A photo may stand in as a cover picture only once it is featured or two students say it looks right. */
  function coverOk(r) { return r && (r.featured || likes(r) >= 2); }
  function dishCover(id, dish) { var r = dishPhotos(id, dish)[0]; return coverOk(r) ? r : null; }
  function placePhoto(id) {
    var best = null; Object.keys(PHOTOS[id] || {}).forEach(function (k) { var r = dishCover(id, k); if (r && (!best || (r.featured ? 1 : 0) > (best.featured ? 1 : 0) || likes(r) > likes(best))) best = r; });
    return best ? photoUrl(best.path) : '';
  }
  var FLAGS = {}, STAND = {}, PERKS = [], MYPERKS = {}, MERCH = [], HAS2 = false;
  function flag(k) { return FLAGS[k] !== false; }
  function quiet(pr) { return pr.catch(function () { return null; }); }
  function loadExtras(then) {
    var t = DATA && town(); if (!SERVER) return;
    Promise.all([quiet(api('feature_flags?select=key,label,enabled&order=key.asc')), t ? quiet(api('place_standings?select=place_id,votes,avg,idx&order=idx.desc&town=eq.' + encodeURIComponent(t.id))) : null,
      quiet(api('perks?select=*&order=votes_required.asc')), quiet(api('merch?select=*&order=sort.asc,id.desc')), AUTH ? quiet(api('rpc/my_perks', {})) : null]).then(function (r) {
      if (r[0]) { HAS2 = true; FLAGS = {}; r[0].forEach(function (f) { FLAGS[f.key] = f.enabled; }); FLAGS._list = r[0]; }
      if (r[1] && t) STAND[t.id] = r[1];
      PERKS = r[2] || []; MERCH = r[3] || []; MYPERKS = {}; (r[4] || []).forEach(function (x) { MYPERKS[x.perk_id] = x; });
      if (then) then();
    });
  }
  /* KORD Index of a restaurant = the sum of every rating its dishes have received (average rating x number of votes). */
  function standings(t) {
    if (SERVER && STAND[t.id]) return STAND[t.id].filter(function (r) { return SPOTS[r.place_id]; }).map(function (r) { return { sp: SPOTS[r.place_id], votes: +r.votes, avg: +r.avg, idx: +r.idx }; });
    var out = [];
    t.spots.forEach(function (sp) { var n = 0, sum = 0; ratedItems(sp.id).forEach(function (x) { n += x.n; sum += x.avg * x.n; }); if (n) out.push({ sp: sp, votes: n, avg: sum / n, idx: Math.round(sum) }); });
    return out.sort(function (a, b) { return b.idx - a.idx || b.avg - a.avg; });
  }
  var INDEXHELP = 'The KORD Index is the total of every rating a restaurant\'s dishes have received: its average rating multiplied by its number of votes. A place climbs by being rated well and by being rated often, so one perfect score cannot beat a kitchen that many students love.';
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
    for (var i = 1; i <= 10; i++) h += '<button class="' + (i === r ? 'mine' : i < r ? 'on' : '') + '" data-rate="' + i + '" data-id="' + esc(id) + '" data-item="' + esc(item) + '" aria-label="' + i + ' out of 10 for ' + esc(item) + '">' + i + '</button>';
    return '<span class="tens" role="group">' + h + '</span>';
  }

  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? v : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https:\/\//i.test(u || '') ? u : (/^http:\/\//i.test(u || '') ? u.replace(/^http:/i, 'https:') : ''); }
  function domain(u) { try { return new URL(safeUrl(u)).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function initials(n) { var w = String(n).replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(function (x) { return x && !/^(the|of|and)$/i.test(x); }); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase(); }
  var TILE = { 'Pizza': ['#FDE7D8', '🍕'], 'Burgers': ['#FDEBC8', '🍔'], 'Mexican': ['#E3F1DC', '🌮'], 'Sandwiches & Subs': ['#E1ECF7', '🥪'], 'Wings & Chicken': ['#FBE0D0', '🍗'], 'Asian': ['#FBE3EA', '🍜'],
    'Boba & Tea': ['#EFE5F7', '🧋'], 'Coffee & Bakery': ['#F1E6D8', '☕'], 'Breakfast & Brunch': ['#FFF1C9', '🥞'], 'Bar & Grill': ['#E6E9F2', '🍻'], 'Dessert & Ice Cream': ['#FBE3EE', '🍦'], 'BBQ': ['#F6DDD3', '🍖'],
    'Mediterranean': ['#DFF0EE', '🥙'], 'Healthy & Bowls': ['#E2F2DF', '🥗'], 'Fast Food': ['#FDE5D2', '🍟'], 'Other': ['#F1EADF', '🍽️'] };
  function color(cat) { return (TILE[cat] || TILE.Other)[0]; }
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
    var img = '';
    if (sp.logo) img = '<img alt="" loading="lazy" data-logo src="' + esc(sp.logo) + '">';
    return '<span class="lg ' + (cls || '') + '" style="--c:' + color(sp.category) + '"><span>' + esc(initials(sp.name)) + '</span>' + img + '</span>';
  }
  function badge(sc) {
    return '<span class="badge" style="--c:' + hex(sc.color) + ';--i:' + hex(sc.ink) + '"><span>' + esc(sc.abbr) + '</span>' + (sc.logo ? '<img alt="" data-logo src="' + esc(sc.logo) + '">' : '') + '</span>';
  }
  /* Licensed example photos. Picks the library photo that fits the words (a wing deal gets wings), falling back to the
     kind of restaurant. The same dish always gets the same photo; different places get different ones where there is a choice. */
  var STOCKRULES = [['sandwich', /salad sandwich|grilled cheese/], ['sweet', /cinnamon roll/], ['sides', /fry bowl|loaded fries/], ['plate', /schnitzel|meatloaf|pot roast/], ['apps', /egg rolls?|spring rolls?/], ['sushi', /sushi|\brolls?\b|sashimi/], ['bbq', /\bribs?\b|bbq|brisket|pulled pork/], ['mac', /\bmac\b|macaroni/], ['noodles', /ramen|noodle|\bpho\b|lo mein|pad thai|udon/],
    ['quesadilla', /quesadilla/], ['salad', /salad/], ['soup', /soup|chowder|bisque/], ['curry', /curry|masala|tikka|korma/], ['eggs', /\beggs?\b|omelet|scramble|benedict/],
    ['bagel', /bagel/], ['cookie', /cookie|brownie/], ['icecream', /ice cream|custard|sundae|gelato|froyo|frozen yogurt|milkshake|shake/], ['donut', /donut|doughnut/], ['cupcake', /cupcake|muffin/],
    ['boba', /boba|bubble tea|milk tea/], ['smoothie', /smoothie|juice|lemonade|refresher/], ['pretzel', /pretzel/], ['hotdog', /hot dog|coney|chili dog|\bbrat/], ['stromboli', /stromboli/],
    ['calzone', /calzone/], ['cheesesteak', /cheesesteak|philly/], ['shawarma', /shawarma|falafel|kabob|kebab/], ['gyro', /gyro/], ['taco', /taco/], ['wings', /wing/],
    ['burrito', /burrito|quesabirria|chimichanga/], ['tenders', /tender|finger|nugget|chunk/], ['burger', /burger|slider/], ['pizza', /pizza|slice|\bpie\b|flatbread/],
    ['hotsandwich', /roast beef|sloppy joe|reuben|\bmelt\b/], ['wrap', /\bwraps?\b/], ['sandwich', /sandwich|\bsubs?\b|wrap|panini|hoagie|\bclub\b|blt/], ['fish', /fish|perch|shrimp|crab|lobster|seafood|salmon|calamari/],
    ['steak', /steak|prime rib|sirloin|ribeye/], ['pasta', /pasta|spaghetti|lasagna|ravioli|alfredo|fettuccine|penne|gnocchi/], ['mexplate', /nacho|fajita|enchilada|tostada|tamale/],
    ['breakfast', /breakfast|brunch|pancake|waffle|french toast/], ['bowl', /bowl|\brice\b/], ['sweet', /cake|dessert|pastry|cinnamon roll|scone|crepe|cheesecake|baklava/],
    ['drink', /coffee|latte|espresso|cappuccino|mocha|\btea\b|chai|americano|cold brew/], ['sides', /fries|\btots\b|breadstick|cheese stick|onion ring|mozzarella stick/],
    ['dips', /guac|queso|salsa|hummus|\bdips?\b|crostini/], ['chicken', /chicken|fowl/], ['beer', /beer|draft|\bpints?\b|pitcher|domestic|\bbrews?\b/], ['apps', /appetizer|\bapps\b|shar(e)?able|starter|small plate|snack/]];
  var CATSTOCK = { 'Pizza': 'pizza', 'Burgers': 'burger', 'Mexican': 'taco', 'Sandwiches & Subs': 'sandwich', 'Wings & Chicken': 'wings', 'Asian': 'noodles', 'Boba & Tea': 'boba',
    'Coffee & Bakery': 'drink', 'Breakfast & Brunch': 'breakfast', 'Bar & Grill': 'burger', 'Dessert & Ice Cream': 'icecream', 'BBQ': 'bbq', 'Mediterranean': 'gyro', 'Healthy & Bowls': 'salad', 'Fast Food': 'burger', 'Other': 'plate' };
  function stockKey(text, cat) {
    var t = String(text || '').toLowerCase(), lib = DATA.stock || {};
    for (var i = 0; i < STOCKRULES.length; i++) if (lib[STOCKRULES[i][0]] && STOCKRULES[i][1].test(t)) return STOCKRULES[i][0];
    return lib[CATSTOCK[cat]] ? CATSTOCK[cat] : lib.plate ? 'plate' : '';
  }
  window.KORD_STOCK = stockKey;
  var SHOWN = {};
  function stock(text, cat, seed) {
    var a = (DATA.stock || {})[stockKey(text, cat)] || [], h = 0, s = String(seed || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    if (!a.length) return '';
    for (var j = 0; j < a.length; j++) { var pick = a[(h + j) % a.length]; if (!SHOWN[pick]) { SHOWN[pick] = 1; return pick; } }
    return a[h % a.length];
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
      return [(used[x.sp.id] || 0) >= 2 ? 1 : 0, (discountOnly && everyday) || /reward|points/i.test(x.d.title) ? 1 : 0, p != null && p > 10 ? 1 : 0, kind(x.d) === 'meal' ? 0 : kind(x.d) === 'bite' ? 1 : 2, used[x.sp.id] || 0, everyday ? 1 : 0, x.d.days.length, discountOnly ? 1 : 0, p == null ? 99 : p];
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
  /* What a deal is worth to a student on a budget.
     meal  = a full plate for the price (burger, sub, bowl, pizza, lunch special...)
     bite  = priced per piece or a snack (one wing, one taco, a slice, an appetizer)
     off   = money off with no set price (10% with student ID, half-price apps) */
  function kind(d) {
    var p = priceNum(d.price || d.title), t = d.title.toLowerCase();
    if (p == null || /add[- ]?on|add one|bogo|buy one|buy \d|\boff\b/.test(t)) return 'off';
    if (/wing|taco(?!.*(salad|bowl|platter|combo|dinner))|slice|nugget|cookie|donut|pretzel|appetizer|\bapps\b|shar(e)?able|starter|nacho|\bbites?\b|slider/.test(t) && p < 7) return 'bite';
    if (p < 3 && !/meal|sub\b|sandwich|burger|burrito|bowl|combo|lunch|dinner|entree/.test(t)) return 'bite';
    return 'meal';
  }
  function hook(d) {
    var p = priceNum(d.price || d.title), k = kind(d), t = d.title.toLowerCase(), bits = [];
    if (d.days.length === 1) bits.push(d.days[0] === TODAY && S.day === TODAY ? 'Today only' : DAYNAME[d.days[0]] + 's only');
    if (k === 'meal') bits.push('Full meal under $' + (p <= 5 ? 5 : p <= 8 ? 8 : p <= 10 ? 10 : 12));
    else if (k === 'bite' && p <= 1.5 && /wing/.test(t)) bits.push('Fill up: 8 wings for ' + money(Math.round(p * 8 * 100) / 100));
    else if (k === 'bite' && p <= 2.5 && /taco/.test(t)) bits.push('Fill up: 3 tacos for ' + money(Math.round(p * 3 * 100) / 100));
    else if (k === 'bite' && p <= 2 && /slice/.test(t)) bits.push('Fill up: 2 slices for ' + money(Math.round(p * 2 * 100) / 100));
    else if (k === 'bite') bits.push('Cheap bite under $' + (p <= 3 ? 3 : p <= 5 ? 5 : 7));
    else bits.push(d.studentOnly ? 'Just show your student ID' : 'Money off your order');
    return bits.join(' · ');
  }
  var FOODS = [['Burgers', /burger|slider/], ['Pizza', /pizza|slice|calzone|stromboli/], ['Wings', /wing|tender|nugget|chicken chunk/], ['Tacos & burritos', /taco|burrito|quesa|nacho|fajita|enchilada/],
    ['Subs & sandwiches', /\bsubs?\b|sandwich|wrap|gyro|hot dog|coney|bagel|cheesesteak/], ['Bowls & salads', /bowl|salad|veggie|rice|noodle|ramen|pho|sushi|roll/], ['Breakfast & coffee', /breakfast|brunch|pancake|coffee|latte|tea\b|donut|egg/], ['Sweets', /cookie|ice cream|custard|cupcake|dessert|shake|pint/]];
  var CATFOOD = { 'Pizza': 'Pizza', 'Burgers': 'Burgers', 'Mexican': 'Tacos & burritos', 'Sandwiches & Subs': 'Subs & sandwiches', 'Wings & Chicken': 'Wings', 'Asian': 'Bowls & salads', 'Boba & Tea': 'Breakfast & coffee',
    'Coffee & Bakery': 'Breakfast & coffee', 'Breakfast & Brunch': 'Breakfast & coffee', 'Dessert & Ice Cream': 'Sweets', 'Mediterranean': 'Subs & sandwiches', 'Healthy & Bowls': 'Bowls & salads' };
  function food(x) { var t = x.d.title.toLowerCase(); for (var i = 0; i < FOODS.length; i++) if (FOODS[i][1].test(t)) return FOODS[i][0]; return CATFOOD[x.sp.category] || 'Other'; }
  function byPrice(a) {
    return a.sort(function (x, y) { var px = priceNum(x.d.price || x.d.title), py = priceNum(y.d.price || y.d.title); return (px == null ? 99 : px) - (py == null ? 99 : py) || (kind(x.d) === 'meal' ? 0 : 1) - (kind(y.d) === 'meal' ? 0 : 1) || x.sp.name.localeCompare(y.sp.name); });
  }
  function byValue(a) {
    var order = { meal: 0, bite: 1, off: 2 };
    return a.sort(function (x, y) {
      var kx = order[kind(x.d)], ky = order[kind(y.d)], px = priceNum(x.d.price || x.d.title), py = priceNum(y.d.price || y.d.title);
      return kx - ky || (px == null ? 99 : px) - (py == null ? 99 : py) || x.sp.name.localeCompare(y.sp.name);
    });
  }
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
    if (d && (sp.category === 'Healthy & Bowls' || /salad|\bbowl|veggie|wrap\b/i.test(d.title))) h += '<span class="tag light">Lighter pick</span>';
    if (d && d.studentOnly) h += '<span class="tag stu">Show student ID</span>';
    if (!sp.local) h += '<span class="tag">Chain</span>';
    return h ? '<span class="tags">' + h + '</span>' : '';
  }
  /* Pictures, in order: the restaurant's own photo of that food (only with its permission), then a street view of the restaurant (needs a Google
     Maps key in data/server.json), then its logo, then its name. No stand-in photos from anywhere else. */
  function street(sp) {
    var k = DATA.streetViewKey;
    return k && sp.address ? 'https://maps.googleapis.com/maps/api/streetview?size=640x480&fov=80&source=outdoor&location=' + encodeURIComponent(sp.address) + '&key=' + encodeURIComponent(k) : '';
  }
  function media(sp, d) {
    /* Order: an approved student photo of that dish, the restaurant's own photo (with permission), an approved student photo
       from the restaurant, a labelled example of that food, a street view. Chains never get an example photo: their food
       is well known and a stand-in would mislead. */
    var mine = d ? dishCover(sp.id, d.title) : null, ph = '', kind = '';
    if (mine) { ph = photoUrl(mine.path); kind = 'Student photo'; }
    else if (d && d.photo) ph = d.photo;
    else if (!(d && d.nophoto) && sp.photo) ph = sp.photo;
    else if (!d && placePhoto(sp.id)) { ph = placePhoto(sp.id); kind = 'Student photo'; }
    else if (d && sp.local && (ph = stock(d.title, sp.category, sp.id + d.title))) kind = 'Example photo';
    else ph = street(sp);
    return { has: !!ph, html: ph ? '<img alt="" loading="lazy" src="' + esc(ph) + '">' + (kind ? '<span class="ptag">' + kind + '</span>' : '') : sp.logo ? '<span class="logotile"><img alt="" loading="lazy" src="' + esc(sp.logo) + '"></span>' : '<span class="mono"><span class="emo" aria-hidden="true">' + (TILE[sp.category] || TILE.Other)[1] + '</span>' + esc(sp.name) + '</span>' };
  }
  function metaLine(sp) { var sc = spotScore(sp.id), tr = travel(sp); return [sc ? '<span class="score">★ ' + sc.toFixed(1) + '</span>' : '', esc(tr), esc(sp.category)].filter(Boolean).join(' · '); }
  function ticket(x, hero, dayLabel) {
    var st = stubText(x.d), m = media(x.sp, x.d);
    return '<button class="dcard' + (hero ? ' hero' : '') + '" data-spot="' + esc(x.sp.id) + '" data-deal="' + esc(x.d.title) + '" style="--c:' + color(x.sp.category) + '">' +
      '<span class="ph' + (m.has ? '' : ' nophoto') + '">' + m.html +
      (hero ? '<span class="flag">Deal of the day · ' + (S.day === TODAY ? 'today' : DAYNAME[S.day]) + '</span>' : '') +
      '<span class="price' + (st.length > 5 ? ' long' : '') + '">' + esc(st) + (kind(x.d) === 'bite' && priceNum(x.d.price || x.d.title) <= 2.5 && /wing|taco|slice/i.test(x.d.title) ? '<small>each</small>' : '') + '</span></span>' +
      '<span class="dbody"><span class="hook">' + esc(dayLabel ? dayLabel + ' · ' + hook(x.d).replace(/^[A-Za-z]+s only · /, '') : hook(x.d)) + '</span><span class="dtitle">' + esc(x.d.title) + '</span>' +
      '<span class="who">' + logo(x.sp, 'sm') + '<span>' + esc(x.sp.name) + '</span></span><span class="meta">' + metaLine(x.sp) + '</span>' +
      (hero ? '<span class="ddet">' + esc(x.d.details) + '</span>' : '') + tagsHtml(x.sp, x.d) + '</span></button>';
  }
  function placeCard(sp) {
    var m = media(sp, null), n = (sp.deals || []).length, lo = spotLow(sp);
    return '<button class="dcard" data-spot="' + esc(sp.id) + '" style="--c:' + color(sp.category) + '"><span class="ph' + (m.has ? '' : ' nophoto') + '">' + m.html + (lo != null ? '<span class="price">from ' + money(lo) + '</span>' : '') + '</span>' +
      '<span class="dbody"><span class="dtitle">' + esc(sp.name) + '</span><span class="meta">' + metaLine(sp) + '</span>' + (n ? '<span class="hook">' + n + ' deal' + (n > 1 ? 's' : '') + ' this week</span>' : '') + '</span></button>';
  }

  /* step 1: pick a school */
  function viewPick() {
    var lib = DATA.stock || {}, strip = [(lib.wings || [])[0], (lib.pizza || [])[2], (lib.taco || [])[1]].filter(Boolean);
    return (strip.length === 3 ? '<div class="collage">' + strip.map(function (u) { return '<img alt="" src="' + esc(u) + '">'; }).join('') + '</div>' : '') + '<div class="grid">' + DATA.towns.map(function (t) {
      return '<button class="tile' + (t.id === S.town ? ' mine' : '') + '" data-town="' + esc(t.id) + '"><span class="tilehead"><span class="kick">Campus</span><span class="kick rust">Open</span></span>' + badge(t.school) +
        '<span class="tbody2"><span class="tname">' + esc(t.name) + ', Ohio</span><span class="tsub">' + esc(t.school.name) + (t.school.also ? ' · also ' + esc(t.school.also) : '') + '</span></span></button>';
    }).join('') + '</div><p class="note" style="text-align:center">15 Ohio campuses so far. More coming.</p>';
  }
  /* step 2: cheapest deals for the day */
  var FOODICON = { 'All': '🍽️', 'Pizza': '🍕', 'Burgers': '🍔', 'Wings': '🍗', 'Tacos & burritos': '🌮', 'Subs & sandwiches': '🥪', 'Bowls & salads': '🥗', 'Breakfast & coffee': '☕', 'Sweets': '🍪', 'Other': '🍴' };
  var FOODPIC = { 'All': 'plate', 'Pizza': 'pizza', 'Burgers': 'burger', 'Wings': 'wings', 'Tacos & burritos': 'taco', 'Subs & sandwiches': 'sandwich', 'Bowls & salads': 'salad', 'Breakfast & coffee': 'breakfast', 'Sweets': 'cookie', 'Other': 'sides' };
  function viewDeals() {
    SHOWN = {};
    var t = town(), all = dealsFor(t, S.day), seen = {}, foods = ['All'], q = (S.dq || '').toLowerCase();
    all.forEach(function (x) { if (x.sp.local) seen[food(x)] = 1; });
    FOODS.forEach(function (f) { if (seen[f[0]]) foods.push(f[0]); }); if (seen.Other) foods.push('Other');
    if (foods.indexOf(S.food) < 0) S.food = 'All';
    var keep = function (x) { return (S.food === 'All' || food(x) === S.food) && (!q || (x.d.title + ' ' + x.sp.name + ' ' + x.sp.category).toLowerCase().indexOf(q) >= 0); };
    var local = byPrice(all.filter(function (x) { return x.sp.local && keep(x); })), chain = byPrice(all.filter(function (x) { return !x.sp.local && keep(x); }));
    var when = S.day === TODAY ? 'today' : 'on ' + DAYNAME[S.day];
    var pick = weekPicks(t)[S.day], top = null, browsing = S.food === 'All' && !q;
    if (browsing) local = local.filter(function (x) { if (!top && x.sp.id + '|' + x.d.title === pick) { top = x; return false; } return true; });
    var h = '<div class="searchbar"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input class="search" id="dealSearch" type="search" placeholder="Search wings, pizza, a place…" value="' + esc(S.dq || '') + '" aria-label="Search deals"></div>' +
      '<div class="cats">' + foods.map(function (f) { return (function (u) { return '<button class="chip cat' + (u ? '' : ' noimg') + '" data-food="' + esc(f) + '" aria-pressed="' + (S.food === f) + '">' + (u ? '<img class="cthumb" alt="" src="' + esc(u) + '">' : '') + esc(f) + '</button>'; })(((DATA.stock || {})[FOODPIC[f]] || [])[FOODPIC[f] === 'pizza' ? 1 : 0]); }).join('') + '</div>' +
      '';
    h = pageHead('The deals', DAYNAME[S.day], 'Eat well for cheap ' + when, 'Real food near campus for $12 or less') + h;
    function sec(title, sub, a) { return a.length ? '<div class="sechead"><h2>' + title + '</h2><span>' + a.length + '</span></div><p class="sub" style="margin-top:-8px">' + sub + '</p><div class="list rail">' + a.map(function (x) { return ticket(x); }).join('') + '</div>' : ''; }
    function tier(lo, hi) { return local.filter(function (x) { var p = priceNum(x.d.price || x.d.title); return p != null && kind(x.d) !== 'off' && p >= lo && p < hi; }); }
    if (top || local.length) {
      h += (top ? ticket(top, true) : '') + perksHtml(t) +
        sec('Under $5', 'The cheapest eats ' + when + '.', tier(0, 5)) +
        sec('$5 to $8', 'A solid meal without the damage.', tier(5, 8.005)) +
        sec('$8 to $12', 'Bigger plates, still on budget.', tier(8.005, 99)) +
        sec('Money off', 'Discounts with no set price, like student ID deals.', local.filter(function (x) { return kind(x.d) === 'off'; }));
    } else {
      var other = DAYS.filter(function (d) { return dealsFor(t, d).some(function (x) { return x.sp.local && keep(x); }); });
      h += '<div class="empty"><b>No cheap local ' + (S.food === 'All' ? 'deals' : esc(S.food.toLowerCase()) + ' deals') + ' found for ' + DAYNAME[S.day] + '</b>' + (q ? 'Try a different word.' : other.length ? 'Try ' + other.map(function (d) { return DAYNAME[d]; }).join(', ') + '.' : 'Tap All to see everything.') + '</div>';
    }
    if (browsing) {
      /* more to eat when a day is light on deals: the rest of the week, and cheap meals on the regular menu */
      var later = [], got = {}, di = DAYS.indexOf(S.day);
      for (var k = 1; k < 7; k++) { var dn = DAYS[(di + k) % 7]; byPrice(dealsFor(t, dn).filter(function (x) { return x.sp.local && x.d.days.indexOf(S.day) < 0; })).forEach(function (x) { var key = x.sp.id + '|' + x.d.title; if (!got[key] && later.length < 14) { got[key] = 1; later.push({ x: x, day: dn }); } }); }
      if (later.length) h += '<div class="sechead"><h2>Later this week</h2><span>' + later.length + '</span></div><p class="sub">Deals coming up on other days.</p><div class="list rail">' + later.map(function (l) { return ticket(l.x, false, DAYNAME[l.day]); }).join('') + '</div>';
      var cheap = (t.cheap || []).filter(function (c) { return SPOTS[c.id]; });
      if (cheap.length >= 3) h += '<div class="sechead"><h2>Cheap any day</h2><span>' + Math.min(15, cheap.length) + '</span></div><p class="sub">Full meals for $9 or less on the regular menu. No deal needed. Small pictures are examples.</p><div class="list">' + cheap.slice(0, 15).map(function (c) {
        var cp = dishCover(c.id, c.n), cu = cp ? photoUrl(cp.path) : stock(c.n, SPOTS[c.id].category, c.id + c.n);
        return '<button class="row" data-spot="' + esc(c.id) + '">' + (cu ? '<span class="lg thumb has"><img alt="" loading="lazy" class="cover" src="' + esc(cu) + '"></span>' : '') + '<span class="mid"><h3>' + esc(c.n) + '</h3><p>' + esc(SPOTS[c.id].name) + (travel(SPOTS[c.id]) ? ' · ' + travel(SPOTS[c.id]) : '') + '</p>' + (c.d ? '<p class="quote">' + esc(c.d) + '</p>' : '') + '</span><span class="end"><b>' + usd(c.p) + '</b></span></button>';
      }).join('') + '</div>';
      var pop = t.spots.filter(function (sp) { return sp.local; }).sort(function (a, b) { return (b.signature ? 4 : 0) + (b.photo ? 2 : 0) + (b.logo ? 1 : 0) - ((a.signature ? 4 : 0) + (a.photo ? 2 : 0) + (a.logo ? 1 : 0)) || b.deals.length - a.deals.length || a.name.localeCompare(b.name); }).slice(0, 10);
      if (pop.length) h += '<div class="sechead"><h2>Popular near campus</h2><span>' + pop.length + '</span></div><p class="sub" style="margin-top:-8px">Local favorites in ' + esc(t.name) + '.</p><div class="rail" style="display:flex">' + pop.map(placeCard).join('') + '</div>';
    }
    h += sec('Chain deals nearby', 'Fast food and national chains, lowest price first.', chain);
    return h + '<p class="note">Deals change. Each one links to where we found it, so check before you go. Photos marked Example show that kind of food, not the restaurant\'s own plate. Add your own from any dish.</p>';
  }
  function pageHead(left, right, title, tag) {
    return '<div class="pagehead"><div class="mastline"><span class="kick">' + esc(left) + '</span><span class="kick">' + esc(right) + '</span></div><h2>' + esc(title) + '</h2><span class="kick">— ' + esc(tag) + ' —</span><div class="rule"></div></div>';
  }
  function scoreBox(id) {
    var r = ratedItems(id), n = 0; if (!r.length) return '';
    r.forEach(function (x) { n += x.n; });
    return '<span class="scorebox"><b>' + spotScore(id).toFixed(1) + '</b><small>' + n + ' vote' + (n > 1 ? 's' : '') + '</small></span>';
  }
  function placeBig(sp) {
    var m = media(sp, null), n = (sp.deals || []).length, lo = spotLow(sp);
    return '<button class="pcard" data-spot="' + esc(sp.id) + '" style="--c:' + color(sp.category) + '"><span class="ph' + (m.has ? '' : ' nophoto') + '">' + m.html + (lo != null ? '<span class="price">from ' + money(lo) + '</span>' : '') + '</span>' +
      '<span class="pinfo"><span><span class="kick rust">' + esc(sp.category) + '</span><span class="pname">' + esc(sp.name) + '</span><span class="pmeta">' + esc([travel(sp), sp.price, n ? n + ' deal' + (n > 1 ? 's' : '') + ' this week' : ''].filter(Boolean).join(' · ')) + '</span></span>' + scoreBox(sp.id) + '</span></button>';
  }
  function spotRow(sp) {
    var lo = spotLow(sp), n = (sp.deals || []).length, r = spotScore(sp.id);
    return '<button class="row" data-spot="' + esc(sp.id) + '">' + (function (ph) { return ph ? '<span class="lg thumb has"><img alt="" loading="lazy" class="cover" src="' + esc(ph) + '"></span>' : logo(sp); })(sp.photo || stock(sp.name, sp.category, sp.id)) +
      '<span class="mid"><h3>' + esc(sp.name) + '</h3><p>' + esc(sp.category) + (sp.price ? ' · ' + esc(sp.price) : '') + (travel(sp) ? ' · ' + travel(sp) : '') + (r ? ' · <span class="score">★ ' + r.toFixed(1) + '</span>' : '') + '</p></span>' +
      '<span class="end">' + (lo != null ? 'from<b>' + money(lo) + '</b>' : n ? '<b>' + n + '</b>deal' + (n > 1 ? 's' : '') : '') + '</span></button>';
  }
  function perksHtml(t) {
    if (!SERVER || !flag('perks')) return '';
    var list = PERKS.filter(function (k) { return (!k.town || k.town === t.id) && (!k.place_id || SPOTS[k.place_id]); }); if (!list.length) return '';
    var rated = (VOTES && VOTES.rated) || 0;
    return '<div class="sechead"><h2>Perks</h2><span>' + list.length + '</span></div><p class="sub">Rate dishes to unlock these. Show the screen at the counter to redeem.</p><div class="list">' + list.map(function (k) {
      var mine = MYPERKS[k.id], need = Math.max(0, k.votes_required - rated), where = k.place_id ? SPOTS[k.place_id].name : 'KORD perk';
      var btn = mine && mine.redeemed_at ? '<span class="tag">Redeemed</span>' : mine ? '<button class="btn" data-redeem="' + k.id + '">Redeem</button>' :
        !AUTH ? '<button class="btn ghost" data-auth="up">Join to unlock</button>' : need ? '<span class="tag">Rate ' + need + ' more</span>' : '<button class="btn" data-unlock="' + k.id + '">Unlock</button>';
      return '<div class="perk"><span class="mid"><b>' + esc(k.title) + '</b><small>' + esc(where) + (k.votes_required ? ' · unlocks at ' + k.votes_required + ' ratings' : '') + (k.ends_at ? ' · ends ' + new Date(k.ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') + '</small>' + (k.description ? '<small style="display:block;margin-top:4px">' + esc(k.description) + '</small>' : '') +
        (AUTH && !mine && k.votes_required ? '<span class="bar" style="display:block;margin-top:8px;background:var(--chip)"><i style="width:' + Math.min(100, Math.round(rated / k.votes_required * 100)) + '%"></i></span>' : '') + '</span>' + btn + '</div>';
    }).join('') + '</div>';
  }
  function merchHtml() {
    if (!SERVER || !HAS2) return '';
    return '<div class="sechead"><h2>The merch</h2><span>' + (MERCH.length || '') + '</span></div>' + (MERCH.length ? '<div class="list">' + MERCH.map(function (m) {
      var img = safeUrl(m.image_url), link = safeUrl(m.link_url);
      return '<div class="perk">' + (img ? '<span class="lg thumb has"><img alt="" loading="lazy" class="cover" src="' + esc(img) + '"></span>' : '') + '<span class="mid"><b>' + esc(m.name) + (m.price ? ' · ' + esc(m.price) : '') + '</b><small>' + esc(m.description) + '</small></span>' +
        (!m.available ? '<span class="tag">Sold out</span>' : link ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(link) + '">View</a>' : '') + '</div>';
    }).join('') + '</div>' : '<div class="empty">New merch drops coming soon.</div>');
  }
  function infoSheet(kick, title, body) {
    clearInterval(POLL); S.open = null;
    document.getElementById('sheetRoot').innerHTML = '<div class="scrim" data-close><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="sheethead"><button class="x" data-close aria-label="Close">×</button></div><div class="sheetbody authbody" id="sheetBody"><div><span class="kick rust">' + esc(kick) + '</span><h2 style="margin-top:6px">' + esc(title) + '</h2></div>' + body + '</div></div></div>';
  }
  /* ---- Admin dashboard. The buttons only show for admins, and every action is checked again in the database. ---- */
  var ADM = { tab: 'overview', data: null, edit: null, found: null };
  function admInput(id, label, val, type, extra) { return '<label class="field" for="' + id + '">' + label + '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" ' + (extra || '') + '></label>'; }
  function adminSheet(tab) {
    if (tab) { ADM.tab = tab; ADM.data = null; ADM.edit = null; }
    var tabs = [['overview', 'Overview'], ['flags', 'Switches'], ['perks', 'Perks'], ['merch', 'Merch'], ['reports', 'Reports'], ['admins', 'Admins']];
    var h = '<div class="chips">' + tabs.map(function (x) { return '<button class="chip" data-adm="' + x[0] + '" aria-pressed="' + (ADM.tab === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div><div id="admBody">' + adminBody() + '</div>';
    infoSheet('Admin', 'Dashboard', h);
    if (ADM.data == null) {
      var call = { overview: api('rpc/admin_stats', {}), flags: api('feature_flags?select=key,label,enabled&order=key.asc'), perks: api('rpc/admin_perks', {}), merch: api('merch?select=*&order=sort.asc,id.desc'), reports: api('rpc/admin_reports', {}), admins: api('rpc/admin_log_recent', {}) }[ADM.tab], want = ADM.tab;
      call.then(function (d) { if (ADM.tab !== want) return; ADM.data = d || []; var b = document.getElementById('admBody'); if (b) b.innerHTML = adminBody(); })
        .catch(function (e) { var b = document.getElementById('admBody'); if (b) b.innerHTML = '<p class="autherr">' + (/not admin/.test(e.message) ? 'This account is not an admin.' : 'Could not load this. If the stage 2 database script has not been run yet, run it first.') + '</p>'; });
    }
  }
  function adminBody() {
    var d = ADM.data, e = ADM.edit || {};
    if (d == null) return '<p class="note">Loading…</p>';
    function stat(n, l) { return '<div class="stat"><b>' + (n == null ? '—' : n) + '</b><span>' + l + '</span></div>'; }
    function nm(id) { return SPOTS[id] ? SPOTS[id].name : id; }
    if (ADM.tab === 'overview') return '<div class="stats">' + stat(d.users, 'Accounts') + stat(d.active_7d, 'Rated in last 7 days') + stat(d.ratings, 'Ratings') + stat(d.ratings_7d, 'New ratings, 7 days') + stat(d.comments, 'Comments') + stat(d.photos, 'Photos') + stat(d.views_30d, 'Restaurant views, 30 days') + stat(d.order_clicks_30d, 'Order clicks, 30 days') + stat(d.perk_unlocks, 'Perks unlocked') + stat(d.perk_redemptions, 'Perks redeemed') + stat(d.open_reports, 'Reported items') + stat(d.vote_cap, 'Ratings per 12 hours') + '</div>' +
      '<div class="sechead"><h2 style="font-size:20px">Most rated dishes</h2></div><div class="lines">' + ((d.top_dishes || []).map(function (x) { return '<div class="line"><span class="mid"><b>' + esc(x.dish) + '</b><small>' + esc(nm(x.place_id)) + '</small></span><b>' + x.votes + ' · ' + x.avg + '</b></div>'; }).join('') || '<div class="line">Nothing yet</div>') + '</div>' +
      '<div class="sechead"><h2 style="font-size:20px">Most viewed restaurants</h2></div><div class="lines">' + ((d.top_viewed || []).map(function (x) { return '<div class="line"><span class="mid"><b>' + esc(nm(x.place_id)) + '</b></span><b>' + x.views + '</b></div>'; }).join('') || '<div class="line">Nothing yet</div>') + '</div>' +
      '<div class="sechead"><h2 style="font-size:20px">Voting limit</h2></div>' + admInput('capIn', 'New ratings allowed per account every 12 hours', d.vote_cap, 'number', 'min="1" max="500"') + '<button class="btn" id="capSave">Save limit</button>';
    if (ADM.tab === 'flags') return '<p class="sub">Turn a feature off for everyone without an update. Off means the app hides it and the database refuses it.</p><div class="list">' + d.map(function (f) {
      return '<div class="perk"><span class="mid"><b>' + esc(f.label) + '</b><small>' + (f.key === 'community' || f.key === 'friends' ? 'Not built yet · ' : '') + (f.enabled ? 'On' : 'Off') + '</small></span><button class="btn ' + (f.enabled ? '' : 'ghost') + '" data-flag="' + esc(f.key) + '" data-on="' + (f.enabled ? '0' : '1') + '">' + (f.enabled ? 'Turn off' : 'Turn on') + '</button></div>'; }).join('') + '</div>';
    if (ADM.tab === 'perks') {
      var t = town(), towns = '<option value="">Every school</option>' + DATA.towns.map(function (x) { return '<option value="' + esc(x.id) + '"' + (e.town === x.id ? ' selected' : '') + '>' + esc(x.school.name) + '</option>'; }).join('');
      var places = '<option value="">KORD perk (no restaurant)</option>' + t.spots.filter(function (x) { return x.local; }).map(function (x) { return '<option value="' + esc(x.id) + '"' + (e.place_id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
      return '<div class="list">' + (d.map(function (k) { return '<div class="perk"><span class="mid"><b>' + esc(k.title) + '</b><small>' + esc(k.place_id ? nm(k.place_id) : 'KORD perk') + ' · ' + k.votes_required + ' ratings · ' + (k.active ? 'live' : 'off') + (k.ends_at ? ' · ends ' + String(k.ends_at).slice(0, 10) : '') + '</small></span><button class="lnk" data-perkedit="' + k.id + '">Edit</button><button class="lnk" data-perkdel="' + k.id + '" style="color:var(--muted)">Delete</button></div>'; }).join('') || '<div class="empty">No perks yet. Add the first one below.</div>') + '</div>' +
        '<div class="sechead"><h2 style="font-size:20px">' + (e.id ? 'Edit perk' : 'New perk') + '</h2></div>' + admInput('pkTitle', 'Title', e.title, 'text', 'maxlength="80"') + admInput('pkDesc', 'Description', e.description, 'text', 'maxlength="400"') +
        '<label class="field" for="pkTown">School<select id="pkTown" class="search">' + towns + '</select></label><label class="field" for="pkPlace">Restaurant at ' + esc(t.school.name) + '<select id="pkPlace" class="search">' + places + '</select></label>' +
        admInput('pkVotes', 'Ratings needed to unlock', e.votes_required == null ? 5 : e.votes_required, 'number', 'min="0" max="1000"') + admInput('pkEnds', 'Ends on (leave empty for no end)', e.ends_at ? String(e.ends_at).slice(0, 10) : '', 'date') +
        '<label class="field" style="flex-direction:row;align-items:center;gap:8px"><input id="pkActive" type="checkbox" style="width:auto"' + (e.active === false ? '' : ' checked') + '> Live now</label><div class="btnrow"><button class="btn" id="perkSave">Save perk</button>' + (e.id ? '<button class="btn ghost" data-adm="perks">Cancel</button>' : '') + '</div>';
    }
    if (ADM.tab === 'merch') return '<div class="list">' + (d.map(function (m) { return '<div class="perk"><span class="mid"><b>' + esc(m.name) + (m.price ? ' · ' + esc(m.price) : '') + '</b><small>' + (m.available ? 'Available' : 'Sold out') + '</small></span><button class="lnk" data-merchedit="' + m.id + '">Edit</button><button class="lnk" data-merchdel="' + m.id + '" style="color:var(--muted)">Delete</button></div>'; }).join('') || '<div class="empty">No merch yet. Add the first item below.</div>') + '</div>' +
      '<div class="sechead"><h2 style="font-size:20px">' + (e.id ? 'Edit item' : 'New item') + '</h2></div>' + admInput('mcName', 'Name', e.name, 'text', 'maxlength="80"') + admInput('mcPrice', 'Price (for example $25)', e.price, 'text', 'maxlength="20"') + admInput('mcDesc', 'Description', e.description, 'text', 'maxlength="400"') +
      admInput('mcImg', 'Picture link (https://…)', e.image_url, 'url') + admInput('mcLink', 'Where to buy it (https://…)', e.link_url, 'url') +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px"><input id="mcAvail" type="checkbox" style="width:auto"' + (e.available === false ? '' : ' checked') + '> Available</label><div class="btnrow"><button class="btn" id="merchSave">Save item</button>' + (e.id ? '<button class="btn ghost" data-adm="merch">Cancel</button>' : '') + '</div>';
    if (ADM.tab === 'reports') {
      var cs = d.comments || [], ps = d.photos || [];
      function acts(kind, x) { return '<div class="btnrow" style="margin-top:8px">' + (x.hidden ? '' : '<button class="btn sm" data-mod="' + kind + '|' + x.id + '|hide">Hide</button>') + '<button class="btn ghost sm" data-mod="' + kind + '|' + x.id + '|show">Keep it</button><button class="btn ghost sm" data-mod="' + kind + '|' + x.id + '|delete">Delete</button>' + (kind === 'photo' && !x.hidden ? '<button class="btn ghost sm" data-mod="photo|' + x.id + '|' + (x.featured ? 'unfeature' : 'feature') + '">' + (x.featured ? 'Unfeature' : 'Feature') + '</button>' : '') + '</div>'; }
      return (cs.length || ps.length ? '' : '<div class="empty"><b>Nothing reported</b>Reported comments and photos show up here.</div>') +
        cs.map(function (c) { return '<div class="dish"><span class="kick rust">Comment · ' + c.reports + ' report' + (c.reports > 1 ? 's' : '') + (c.hidden ? ' · hidden' : '') + '</span><p style="margin:6px 0 0"><b>' + esc(c.name) + '</b> on ' + esc(c.dish) + ' at ' + esc(nm(c.place_id)) + '</p><p style="margin:4px 0 0">' + esc(c.body) + '</p>' + acts('comment', c) + '</div>'; }).join('') +
        ps.map(function (x) { return '<div class="dish"><span class="kick rust">Photo · ' + x.reports + ' report' + (x.reports > 1 ? 's' : '') + (x.hidden ? ' · hidden' : '') + '</span><p style="margin:6px 0 8px">' + esc(x.dish) + ' at ' + esc(nm(x.place_id)) + '</p><img alt="" style="width:100%;border-radius:8px" src="' + esc(photoUrl(x.path)) + '">' + acts('photo', x) + '</div>'; }).join('');
    }
    return admInput('admEmail', 'Find an account by email', ADM.q || '', 'email') + '<button class="btn" id="admFind">Search</button>' +
      (ADM.found ? '<div class="list" style="margin-top:12px">' + (ADM.found.map(function (u) { return '<div class="perk"><span class="mid"><b>' + esc(u.username) + (u.is_admin ? ' · Admin' : '') + '</b><small>' + esc(u.email) + '</small></span><button class="btn ' + (u.is_admin ? 'ghost' : '') + ' sm" data-setadmin="' + esc(u.id) + '|' + (u.is_admin ? '0' : '1') + '">' + (u.is_admin ? 'Remove admin' : 'Make admin') + '</button></div>'; }).join('') || '<div class="empty">No account matches that email.</div>') + '</div>' : '') +
      '<div class="sechead"><h2 style="font-size:20px">Recent admin actions</h2></div><div class="lines">' + (d.map(function (l) { return '<div class="line"><span class="mid"><b>' + esc(l.action.replace(/_/g, ' ')) + '</b><small>' + esc(l.by_name || 'admin') + ' · ' + ago(l.at) + '</small></span></div>'; }).join('') || '<div class="line">Nothing yet</div>') + '</div>';
  }
  function admDo(pr, okMsg) { return pr.then(function () { if (okMsg) toast(okMsg); ADM.data = null; ADM.edit = null; loadExtras(); adminSheet(); }).catch(function (e) { toast(/last admin/.test(e.message) ? 'You cannot remove the last admin.' : /not admin/.test(e.message) ? 'This account is not an admin.' : 'That did not save. Check the fields and try again.'); }); }
  function viewPlaces() {
    var t = town(), q = S.q.toLowerCase();
    var list = t.spots.filter(function (s) { return !q || (s.name + ' ' + s.category).toLowerCase().indexOf(q) >= 0; });
    list.sort(function (a, b) { var x = spotLow(a), y = spotLow(b); if (x == null && y == null) return (b.deals.length - a.deals.length) || a.name.localeCompare(b.name); if (x == null) return 1; if (y == null) return -1; return x - y; });
    var loc = list.filter(function (s) { return s.local; }), ch = list.filter(function (s) { return !s.local; });
    function sec(title, a) { return a.length ? '<div class="sechead"><h2>' + title + '</h2><span>' + a.length + '</span></div><div class="plist">' + a.map(placeBig).join('') + '</div>' : ''; }
    return pageHead('The directory', esc(t.name) + ', Ohio', 'The restaurants', 'Every kitchen near campus, cheapest first') +
      '<input class="search" id="spotSearch" type="search" placeholder="Search pizza, tacos, a name…" value="' + esc(S.q) + '" aria-label="Search places">' +
      (list.length ? sec('Local spots', loc) + sec('Chains', ch) : '<div class="empty"><b>Nothing matches</b>Try a different word.</div>');
  }
  function viewBest() {
    var t0 = town(), seg = '<div class="seg"><button data-best="dishes" aria-pressed="' + (S.best !== 'places') + '">Dishes</button><button data-best="places" aria-pressed="' + (S.best === 'places') + '">Restaurants</button></div>';
    if (SERVER && !flag('standings')) return pageHead('Standings', '', 'Standings', 'Switched off for now') + '<div class="empty"><b>Standings are taking a break</b>Check back soon.</div>';
    if (S.best !== 'places') return viewBestDishes(seg);
    var st = standings(t0), h = pageHead('Standings', new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 'Current standings', 'Every kitchen near ' + t0.school.name + ', ranked by students') + seg;
    if (!st.length) return h + '<div class="empty"><b>No restaurant has been rated yet</b>Open any place, find what you ate and tap Rate.</div>';
    var top = st[0];
    h += '<button class="lead" data-spot="' + esc(top.sp.id) + '"><span class="leadno">№ 1</span><span class="kick rust">— Leading the table —</span><span class="leadname">' + esc(top.sp.name) + '</span><span class="kick">' + esc(top.sp.category) + '</span>' +
      '<span class="leadrule"><span class="kick rust">KORD Index</span></span><span class="leadidx">' + top.idx + '</span><span class="leadstats"><span><span class="kick">Avg</span><b>' + top.avg.toFixed(2) + '</b></span><span><span class="kick">Votes</span><b>' + top.votes + '</b></span></span></button>' +
      '<button class="lnk" id="indexHelp" style="align-self:center">? How the KORD Index works</button>';
    if (st.length > 1) h += '<div class="sechead"><h2>The full card</h2><span>' + st.length + ' kitchens</span></div><div class="list">' + st.map(function (r, i) {
      return '<button class="row" data-spot="' + esc(r.sp.id) + '"><span class="rank">' + (i + 1) + '</span><span class="mid"><h3>' + esc(r.sp.name) + '</h3><p>' + esc(r.sp.category) + ' · ★ ' + r.avg.toFixed(2) + ' · ' + r.votes + ' vote' + (r.votes > 1 ? 's' : '') + '</p></span><span class="end"><b>' + r.idx + '</b>Index</span></button>';
    }).join('') + '</div>';
    return h + '<div class="acct" style="border-width:1px"><span class="kick rust">The formula</span><h2 style="font-size:22px">KORD Index = average rating × number of votes</h2><p class="sub">' + INDEXHELP + '</p><p class="note">Example: 10 votes averaging 8.1 gives an Index of 81.</p></div>';
  }
  function viewBestDishes(seg) {
    var t = town(), rows = [];
    t.spots.forEach(function (sp) { ratedItems(sp.id).forEach(function (x) { rows.push({ sp: sp, x: x }); }); });
    rows.sort(function (a, b) { return b.x.avg - a.x.avg || b.x.n - a.x.n || a.x.item.localeCompare(b.x.item); });
    var h = pageHead('Standings', new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 'Best dishes', 'Every rated dish at ' + t.school.name + ', best first') + (seg || '');
    /* A dish needs MINVOTES votes to be ranked, so one perfect score cannot top the list. Dishes below that wait underneath. */
    var MINVOTES = SERVER ? 3 : 1, ranked = rows.filter(function (r) { return r.x.n >= MINVOTES; }), waiting = rows.filter(function (r) { return r.x.n < MINVOTES; });
    function bestRow(r, i) {
      return '<button class="row" data-spot="' + esc(r.sp.id) + '"><span class="rank">' + (i == null ? '·' : i + 1) + '</span>' + logo(r.sp) + '<span class="mid"><h3>' + esc(r.x.item) + '</h3><p>' + esc(r.sp.name) + '</p></span>' +
        '<span class="end"><b>' + r.x.avg.toFixed(1) + '</b>' + r.x.n + ' vote' + (r.x.n > 1 ? 's' : '') + '</span></button>';
    }
    if (!rows.length) h += '<div class="empty"><b>No dishes rated yet</b>Be the first. Open any place, find what you ate and tap Rate.</div>';
    else {
      h += ranked.length ? '<div class="list">' + ranked.map(function (r, i) { return bestRow(r, i); }).join('') + '</div>' : '<div class="empty"><b>No dish has ' + MINVOTES + ' votes yet</b>Rate what you ate to get the standings started.</div>';
      if (waiting.length) h += '<div class="sechead"><h2>Needs more votes</h2><span>' + waiting.length + '</span></div><p class="sub">A dish joins the standings once ' + MINVOTES + ' students have rated it.</p><div class="list">' + waiting.slice(0, 40).map(function (r) { return bestRow(r, null); }).join('') + '</div>';
    }
    return h + '<p class="note">' + (SERVER ? 'Scores combine ratings from every student using KORD at this school.' : 'For now this counts ratings made on this phone. Ratings from every student combine here once the shared ratings server is connected.') + '</p>';
  }
  function viewYou() {
    var mine = [];
    Object.keys(U.items).forEach(function (id) { if (SPOTS[id]) Object.keys(U.items[id]).forEach(function (k) { mine.push({ sp: SPOTS[id], item: k, r: U.items[id][k] }); }); });
    mine.sort(function (a, b) { return b.r - a.r || a.item.localeCompare(b.item); });
    var h = accountHtml() + rewardsHtml() + '<div class="sechead"><h2>Your profile</h2></div><div class="me"><span class="avatar">' + (U.avatar ? '<img alt="" src="' + esc(U.avatar) + '">' : esc(U.name ? initials(U.name) : '?')) + '</span>' +
      '<div><h2>' + esc(U.name || 'Your profile') + '</h2><p class="sub">' + esc(town().school.name) + '</p>' +
      '<div class="btnrow" style="margin-top:8px"><label class="btn ghost" for="avatarFile">Add a photo</label><input id="avatarFile" type="file" accept="image/*" hidden></div></div></div>' +
      (SERVER ? '' : '<label class="field" for="nameIn">Your name<input id="nameIn" type="text" maxlength="30" autocomplete="nickname" placeholder="What should we call you?" value="' + esc(U.name) + '"></label>') +
      (U.orders.length ? '<div class="sechead"><h2>Your demo orders</h2><span>' + U.orders.length + '</span></div><div class="lines">' + U.orders.slice(0, 8).map(function (o) {
        return '<div class="line"><span class="mid"><b>' + esc(o.name) + '</b><small>' + esc(o.no) + ' · ' + o.lines.reduce(function (a, l) { return a + l.qty; }, 0) + ' items · KORD fee ' + usd(o.fee) + '</small></span><b>' + usd(o.total) + '</b></div>';
      }).join('') + '</div><p class="note">KORD fees across these demo orders: ' + usd(U.orders.reduce(function (a, o) { return a + o.fee; }, 0)) + '</p>' : '') +
      '<div class="sechead"><h2>Dishes you rated</h2><span>' + mine.length + '</span></div>';
    h += mine.length ? '<div class="list">' + mine.map(function (m) {
      return '<button class="row" data-spot="' + esc(m.sp.id) + '">' + logo(m.sp) + '<span class="mid"><h3>' + esc(m.item) + '</h3><p>' + esc(m.sp.name) + '</p></span><span class="end"><span class="mystars">' + m.r + '</span> / 10</span></button>';
    }).join('') + '</div>' : '<div class="empty"><b>Nothing rated yet</b>Open any place, find what you ordered and tap Rate.</div>';
    h += merchHtml() + (ME && ME.is_admin ? '<button class="btn bigbtn" id="adminBtn">Admin dashboard</button>' : '');
    h += '<div class="btnrow"><button class="btn ghost" id="creditsBtn">Sources and credits</button><a class="btn ghost" target="_blank" rel="noopener" href="privacy.html">Privacy</a><a class="btn ghost" target="_blank" rel="noopener" href="terms.html">Terms</a></div><p class="note">KORD version ' + esc(window.KORD_BUILD || 'preview') + '</p>';
    return h + '<p class="note">' + (SERVER ? 'Your ratings, comments and dish photos are shared with other students at your school. Points, badges and your profile photo stay on this phone.' : 'Your profile and ratings are saved on this phone.') + '</p>';
  }

  function render() {
    var t = DATA && town(), picking = S.picking || !t, root = document.documentElement;
    root.style.setProperty('--sc', picking ? '' : hex(t.school.color)); root.style.setProperty('--si', picking ? '' : hex(t.school.ink));
    if (picking) { root.style.removeProperty('--sc'); root.style.removeProperty('--si'); }
    document.getElementById('top').innerHTML = picking ?
      '<div class="mast"><div class="mastline"><span class="kick">Ohio edition</span><span class="kick">Student rated</span></div><h1>KORD</h1><span class="kick">— Cheap eats near campus. Pick your school to get started —</span><div class="rule"></div></div>' :
      '<div class="schoolbar">' + badge(t.school) + '<div class="mid"><h1>' + esc(t.school.name) + '</h1><p>' + esc(t.name) + ', Ohio · ' + U.pts + ' points</p></div><button class="swap" id="swapBtn">Change</button></div>';
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
  function renderHeadPts() { var el = document.querySelector('.schoolbar .mid p'); if (el && DATA && town()) el.textContent = town().name + ', Ohio · ' + U.pts + ' points'; }
  function creditsSheet() {
    var c = DATA.credits || [], h = '<h2>Sources and credits</h2>' +
      '<div><div class="sechead"><h2 style="font-size:18px">Deals and places</h2></div><p class="sub">Every deal links to the page it came from: open a restaurant and tap Source under the deal. Places come from each school\'s local business listings and the restaurants\' own websites. Researched ' + esc(DATA.researchedOn || '') + '. Deals change, so confirm before you go.</p></div>' +
      '<div><div class="sechead"><h2 style="font-size:18px">Menus</h2></div><p class="sub">Dish names and prices were read from each restaurant\'s own menu or ordering page.</p></div>' +
      '<div><div class="sechead"><h2 style="font-size:18px">Distances</h2></div><p class="sub">Addresses were located with the U.S. Census Bureau Geocoder and OpenStreetMap Nominatim. Map data © OpenStreetMap contributors (ODbL).</p></div>' +
      '<div><div class="sechead"><h2 style="font-size:18px">Names and trademarks</h2></div><p class="sub">Restaurant and school names belong to their owners. KORD is independent and is not affiliated with, sponsored by or endorsed by any restaurant or school listed.</p></div>' +
      '<div><div class="sechead"><h2 style="font-size:18px">Fonts</h2></div><p class="sub">Fraunces and Inter, used under the SIL Open Font License 1.1.</p></div>' +
      '<div><div class="sechead"><h2 style="font-size:18px">Food photos</h2><span>' + c.length + '</span></div><p class="sub">Deal photos show an example of that kind of food. They are public domain or Creative Commons Attribution works from Wikimedia Commons, resized and cropped to fit. A restaurant\'s own photos and logo appear only with its permission.</p></div>' +
      '<ul class="credits">' + c.map(function (x) {
        var pg = safeUrl(x.page), lu = safeUrl(x.licenseUrl);
        return '<li>' + (pg ? '<a target="_blank" rel="noopener" href="' + esc(pg) + '">' + esc(x.title) + '</a>' : esc(x.title)) + ' by ' + esc(x.artist) + ', ' + (lu ? '<a target="_blank" rel="noopener" href="' + esc(lu) + '">' + esc(x.license) + '</a>' : esc(x.license)) + '</li>';
      }).join('') + '</ul>' +
      '<div class="btnrow"><a class="btn ghost" target="_blank" rel="noopener" href="privacy.html">Privacy policy</a><a class="btn ghost" target="_blank" rel="noopener" href="terms.html">Terms of use</a></div>';
    document.getElementById('sheetRoot').innerHTML = '<div class="scrim" data-close><div class="sheet" role="dialog" aria-modal="true" aria-label="Sources and credits"><div class="sheethead"><button class="x" data-close aria-label="Close">×</button></div><div class="sheetbody" id="sheetBody">' + h + '</div></div></div>';
  }
  function closeSheet() { document.getElementById('sheetRoot').innerHTML = ''; clearInterval(POLL); S.open = null; S.item = null; }
  /* ---- Points, levels and rewards. Kept on this phone. ---- */
  U.pts = U.pts || 0; U.life = U.life || 0; U.awarded = U.awarded || {}; U.ledger = U.ledger || []; U.stats = U.stats || { ratings: 0, comments: 0, orders: 0 };
  U.streak = U.streak || { last: '', n: 0 }; U.waivers = U.waivers || 0; U.credits = U.credits || 0;
  var LEVELS = [[0, 'Freshman'], [100, 'Sophomore'], [300, 'Junior'], [600, 'Senior'], [1000, 'Campus Legend']];
  var PLUS_PRICE = 3.99;
  function level() { var i = 0; while (i + 1 < LEVELS.length && U.life >= LEVELS[i + 1][0]) i++; return { name: LEVELS[i][1], at: LEVELS[i][0], next: LEVELS[i + 1] || null }; }
  function toast(msg) {
    var old = document.querySelector('.toast'); if (old) old.remove();
    var el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg; document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }
  /* Give points once per key (so re-rating the same dish does not farm points). KORD Plus doubles them. */
  function award(n, why, key) {
    if (key) { if (U.awarded[key]) return 0; U.awarded[key] = 1; }
    var before = level().name, got = n * (U.plus ? 2 : 1);
    U.pts += got; U.life += got; U.ledger.unshift({ n: got, why: why, at: new Date().toISOString() }); U.ledger = U.ledger.slice(0, 20);
    save('kord.user', U);
    toast('+' + got + ' points · ' + why + (level().name !== before ? ' · You are now a ' + level().name : ''));
    return got;
  }
  function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function checkIn() {
    var now = new Date(), today = dayKey(now), y = new Date(now.getTime() - 864e5);
    if (U.streak.last === today) return;
    U.streak = { last: today, n: U.streak.last === dayKey(y) ? U.streak.n + 1 : 1 };
    award(5 + (U.streak.n % 7 === 0 ? 25 : 0), U.streak.n > 1 ? U.streak.n + '-day streak' : U.life ? 'Welcome back' : 'Welcome to KORD');
  }
  var PERKS = [{ id: 'waiver', cost: 100, name: 'No KORD fee on your next order', sub: 'Skips the service fee once.' }, { id: 'credit', cost: 250, name: '$1 off your next order', sub: 'Taken off the total at checkout.' }];
  function badgeList() {
    var places = {}; Object.keys(U.items).forEach(function (k) { places[k] = 1; });
    return [['First bite', 'Rate 1 dish', U.stats.ratings >= 1], ['Critic', 'Rate 10 dishes', U.stats.ratings >= 10], ['Explorer', 'Rate at 5 places', Object.keys(places).length >= 5],
      ['Talker', 'Post 5 comments', U.stats.comments >= 5], ['Regular', 'Place 3 orders', U.stats.orders >= 3], ['On a roll', '7-day streak', U.streak.n >= 7]];
  }
  function rewardsHtml() {
    var lv = level(), pct = lv.next ? Math.min(100, Math.round((U.life - lv.at) / (lv.next[0] - lv.at) * 100)) : 100;
    var h = '<div class="rewards"><div class="lvl"><span>' + esc(lv.name) + (U.plus ? ' · KORD Plus' : '') + '</span><span>' + (U.streak.n > 1 ? U.streak.n + '-day streak' : 'Open KORD daily for a streak') + '</span></div>' +
      '<div class="big">' + U.pts + ' <small>points</small></div><div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="lvl"><span>' + (lv.next ? (lv.next[0] - U.life) + ' points to ' + esc(lv.next[1]) : 'Top level reached') + '</span><span>' + (U.waivers ? U.waivers + ' fee waiver' + (U.waivers > 1 ? 's' : '') + ' ready' : '') + (U.credits ? ' ' + U.credits + ' × $1 off ready' : '') + '</span></div></div>';
    h += '<div class="sechead"><h2>Spend your points</h2></div><div class="list">' + PERKS.map(function (k) {
      return '<div class="perk"><span class="mid"><b>' + esc(k.name) + '</b><small>' + k.cost + ' points · ' + esc(k.sub) + '</small></span><button class="btn" data-perk="' + k.id + '"' + (U.pts < k.cost ? ' disabled' : '') + '>Redeem</button></div>';
    }).join('') + '</div>';
    h += '<div class="plus"><span class="demo" style="background:var(--ink);color:var(--bg)">Demo membership</span><h3>KORD Plus · ' + usd(PLUS_PRICE) + ' a month</h3><p>No KORD fee on any order, double points on everything, and a Plus badge on your comments.</p>' +
      '<button class="btn" id="plusBtn">' + (U.plus ? 'Leave KORD Plus' : 'Try KORD Plus (demo, no charge)') + '</button></div>';
    h += '<div class="sechead"><h2>Badges</h2><span>' + badgeList().filter(function (b) { return b[2]; }).length + ' of ' + badgeList().length + '</span></div><div class="badges">' + badgeList().map(function (b) { return '<div class="bdg' + (b[2] ? '' : ' off') + '"><b>' + esc(b[0]) + '</b>' + esc(b[1]) + '</div>'; }).join('') + '</div>';
    h += '<div class="sechead"><h2>How to earn</h2></div><ul class="earn"><li>Rate a dish you ate: 10 points</li><li>Post a comment: 5 points (up to 3 a day)</li><li>Add a photo of a dish: 10 points</li><li>Place an order: 20 points</li><li>Open KORD each day: 5 points, plus 25 every 7th day in a row</li></ul>';
    if (U.ledger.length) h += '<div class="sechead"><h2>Recent points</h2></div><div class="lines">' + U.ledger.slice(0, 5).map(function (l) { return '<div class="line"><span class="mid"><b>' + esc(l.why) + '</b><small>' + ago(l.at) + '</small></span><b>+' + l.n + '</b></div>'; }).join('') + '</div>';
    return h;
  }
  /* ---- Demo ordering. No payment is taken and no restaurant is contacted. ---- */
  var TAX = 0.0725, CART = { place: null, lines: [] };
  U.orders = U.orders || [];
  function kordFee(sub) { return sub <= 0 ? 0 : sub < 10 ? 0.5 : 1; }   /* KORD's cut per order */
  function usd(n) { return '$' + n.toFixed(2); }
  var OPTSETS = [[/wing/i, 'Sauce', ['Buffalo', 'BBQ', 'Garlic parm', 'Dry rub']], [/taco|burrito|quesadilla|nacho|bowl/i, 'Protein', ['Chicken', 'Steak', 'Pork', 'Veggie']],
    [/pizza|slice|calzone|stromboli/i, 'Topping', ['Cheese', 'Pepperoni', 'Sausage', 'Veggie']], [/burger/i, 'Cheese', ['American', 'Cheddar', 'Swiss', 'No cheese']],
    [/sub\b|sandwich|wrap|gyro|bagel/i, 'Side', ['No side', 'Fries', 'Chips']], [/coffee|latte|tea|boba|smoothie|shake/i, 'Size', ['Small', 'Medium', 'Large']]];
  function optSet(name) { for (var i = 0; i < OPTSETS.length; i++) if (OPTSETS[i][0].test(name)) return OPTSETS[i]; return null; }
  function cartTotals(lines) { var sub = 0; lines.forEach(function (l) { sub += l.price * l.qty; }); var tax = Math.round(sub * TAX * 100) / 100, base = kordFee(sub), why = U.plus ? 'KORD Plus' : U.waivers > 0 ? 'reward' : '', fee = why ? 0 : base, off = U.credits > 0 && sub > 0 ? 1 : 0; return { sub: sub, tax: tax, fee: fee, feeWhy: base && why, off: off, total: Math.max(0, sub + tax + fee - off), count: lines.reduce(function (a, l) { return a + l.qty; }, 0) }; }
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
      '<div><span>KORD service fee' + (t.feeWhy ? ' (waived: ' + t.feeWhy + ')' : '') + '</span><span>' + usd(t.fee) + '</span></div>' + (t.off ? '<div class="fee"><span>Reward: $1 off</span><span>-' + usd(t.off) + '</span></div>' : '') + '<div class="grand"><span>Total</span><span>' + usd(t.total) + '</span></div></div>' +
      '<div class="paycard"><span>Demo card ending 4242</span><span class="demo">Demo</span></div>' +
      '<button class="btn hot bigbtn" id="placeOrder">Place demo order · ' + usd(t.total) + '</button>' +
      '<p class="note">This is a demo. Nothing is charged and ' + esc(sp.name) + ' is not sent this order.</p>';
    body.scrollTop = 0; paintCart();
  }
  function placeOrder() {
    var sp = SPOTS[CART.place], t = cartTotals(CART.lines), body = document.getElementById('sheetBody');
    var o = { no: 'K' + Math.floor(10000 + Math.random() * 90000), place: sp.id, name: sp.name, lines: CART.lines, sub: t.sub, tax: t.tax, fee: t.fee, total: t.total, pick: S.pick, at: new Date().toISOString() };
    if (!U.plus && t.feeWhy === 'reward') U.waivers--;
    if (t.off) U.credits--;
    U.stats.orders++;
    U.orders.unshift(o); U.orders = U.orders.slice(0, 30); save('kord.user', U);
    var earned = award(20, 'Order placed');
    CART = { place: null, lines: [] }; S.step = 'done';
    body.innerHTML = '<div class="done"><span class="tick">✓</span><h2>Order ' + o.no + ' placed</h2><span class="demo">Demo: nothing was charged or sent</span>' +
      '<p class="sub">Pickup ' + esc(o.pick.toLowerCase().replace('asap', 'ASAP')) + ' at ' + esc(sp.name) + (sp.address ? ', ' + esc(sp.address.split(',')[0]) : '') + '</p></div>' +
      '<div class="lines">' + o.lines.map(function (l) { return '<div class="line"><b>' + l.qty + '×</b><span class="mid"><b>' + esc(l.n) + '</b><small>' + esc([l.opt, l.note].filter(Boolean).join(' · ')) + '</small></span><b>' + usd(l.price * l.qty) + '</b></div>'; }).join('') + '</div>' +
      '<div class="totals"><div><span>Food and tax, paid to ' + esc(sp.name) + '</span><span>' + usd(o.sub + o.tax) + '</span></div><div class="fee"><span>KORD keeps (service fee)</span><span>' + usd(o.fee) + '</span></div><div class="grand"><span>Student paid</span><span>' + usd(o.total) + '</span></div></div>' +
      '<p class="sub" style="text-align:center">You earned ' + earned + ' points. Rate what you got for 10 more.</p><button class="btn bigbtn" id="doneBtn">Done</button>';
    body.scrollTop = 0; paintCart();
  }
  function menuItems(sp) {
    var out = [], seen = {};
    function add(n, p, sec, d) { var k = String(n || '').trim().toLowerCase(); if (!k || seen[k]) return; seen[k] = 1; out.push({ n: String(n).trim(), p: p || '', s: sec, d: d || '' }); }
    (sp.deals || []).forEach(function (d) { add(d.title, d.price, 'Deals', d.details); });
    ((MENUS || {})[sp.id] || []).forEach(function (m) { add(m.n, m.p, m.s || 'Menu', m.d); });
    var extra = (U.custom[sp.id] || []).concat(Object.keys(U.items[sp.id] || {}), Object.keys(COMMUNITY[sp.id] || {}));
    cmtsFor(sp.id).forEach(function (c) { extra.push(c.dish); });
    extra.forEach(function (n) { add(n, '', 'Added by students'); });
    return out;
  }
  /* A reported comment disappears for the person who reported it at once; the server hides it for everyone after 3 reports. */
  function cmtKey(c) { return c.id != null ? 'id' + c.id : (c.dish + '|' + c.body).slice(0, 80); }
  function cmtsFor(id, dish) {
    var a = (SERVER ? (CMTS[id] || []) : (U.comments[id] || [])).filter(function (c) { return !U.reported[cmtKey(c)]; });
    return dish == null ? a : a.filter(function (c) { return c.dish === dish; });
  }
  function ago(ts) {
    var m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hr ago' : Math.round(m / 1440) + ' d ago';
  }
  function cmtHtml(c, withDish) { return '<div class="cmt"><b>' + esc(c.name || 'Student') + '</b>' + (withDish ? ' on ' + esc(c.dish) : '') + ' <small>' + ago(c.created_at) + '</small><p>' + esc(c.body) + '</p>' + (withDish ? '' : '<button class="rm" data-report="' + esc(cmtKey(c)) + '">Report</button>') + '</div>'; }
  function cmtListHtml(id, dish) { var a = cmtsFor(id, dish); return a.length ? a.slice(0, 30).map(function (c) { return cmtHtml(c); }).join('') : '<p class="note">No comments yet. Be the first to say if it is worth it.</p>'; }
  function sayingHtml(id) { if (SERVER && !flag('comments')) return ''; var a = cmtsFor(id).slice(0, 2); return a.length ? '<div class="saying"><b>Students are saying</b>' + a.map(function (c) { return cmtHtml(c, true); }).join('') + '</div>' : ''; }
  function paintComments(id) {
    var say = document.getElementById('sayBox'), list = document.getElementById('cmtList');
    if (say) say.innerHTML = sayingHtml(id);
    if (list && S.item) list.innerHTML = cmtListHtml(id, S.item);
  }
  function dishRow(id, m) {
    var open = S.item === m.n, sc = itemScore(id, m.n), nc = cmtsFor(id, m.n).length, mine = myRate(id, m.n), pics = dishPhotos(id, m.n);
    var h = '<div class="dish' + (open ? ' open' : '') + '"><div class="dtop"><h4>' + esc(m.n) + '</h4>' + (m.p && m.s !== 'Deals' ? '<span class="dprice">' + esc(m.p) + '</span>' : '') + '</div>' +
      (m.d ? '<p class="ddesc">' + esc(m.d) + '</p>' : '') +
      (!open && pics.length ? '<div class="pstrip">' + pics.slice(0, 6).map(function (r) { return '<img alt="Student photo of ' + esc(m.n) + '" loading="lazy" src="' + esc(photoUrl(r.path)) + '">'; }).join('') + '</div>' : '') +
      '<div class="dfoot"><span class="dmeta"><b>' + (sc ? sc.avg.toFixed(1) : '—') + '</b>/ 10 · ' + (sc ? sc.n : 0) + ' vote' + (sc && sc.n === 1 ? '' : 's') + (nc ? ' · ' + nc + ' comment' + (nc > 1 ? 's' : '') : '') + '</span>' +
      '<button class="btn ghost sm dishhead" data-dish="' + esc(m.n) + '" aria-expanded="' + open + '">' + (open ? 'Close' : mine ? 'You gave it ' + mine : 'Rate') + '</button></div>';
    var photoBox = !SERVER || !HASPHOTOS || !flag('photos') ? '' : '<div class="pbig">' + pics.slice(0, 8).map(function (r) {
        return '<figure><img alt="Student photo of ' + esc(m.n) + '" loading="lazy" src="' + esc(photoUrl(r.path)) + '"><span class="pact"><button class="rm" data-like="' + r.id + '"' + (U.liked['ph' + r.id] ? ' disabled' : '') + '>' + (U.liked['ph' + r.id] ? 'You said it looks right' : 'Looks right') + (likes(r) ? ' · ' + likes(r) : '') + '</button><button class="rm" data-report="ph' + r.id + '">Report photo</button></span></figure>';
      }).join('') + '</div><label class="btn ghost sm" for="phFile" id="phLabel">' + (pics.length ? 'Add your photo' : 'Add a photo of this') + '</label><input id="phFile" type="file" accept="image/*" hidden data-id="' + esc(id) + '" data-dish="' + esc(m.n) + '">';
    if (open) h += '<div class="dishbody"><div class="yours"><span class="kick">Your score, 1 to 10</span>' + miniStars(id, m.n) + '</div>' + photoBox + (SERVER && !flag('comments') ? '' : '<div class="cmts" id="cmtList">' + cmtListHtml(id, m.n) + '</div>' +
      '<div class="addrow"><input class="search" id="cmtIn" type="text" maxlength="280" placeholder="Worth it? Tell other students" aria-label="Write a comment"><button class="btn" id="cmtBtn" data-id="' + esc(id) + '">Post</button></div>') +
      (SERVER ? '' : '<p class="note">Comments stay on this phone until the shared server is connected.</p>') + orderBox(id, m) + '</div>';
    return h + '</div>';
  }
  /* Refresh after new scores arrive, but never while someone is typing: a redraw would close the phone keyboard. */
  function softFill(id) { var el = document.activeElement; if (S.open !== id || S.step === 'checkout' || S.step === 'done' || (el && /^(cmtIn|ordNote|addItem|menuSearch)$/.test(el.id))) return; fillMenu(id); }
  function fillMenu(id) {
    var box = document.getElementById('menuBox'); if (!box) return;
    var sp = SPOTS[id], q = (S.mq || '').toLowerCase(), items = menuItems(sp), top = ratedItems(id), secs = [], seen = {};
    var draft = document.getElementById('cmtIn'); draft = draft ? draft.value : '';
    items.forEach(function (m) { if (!seen[m.s]) { seen[m.s] = 1; secs.push(m.s); } });
    var real = secs.slice();
    if (top.length) secs.unshift('Top rated');
    secs.unshift('All');
    if (secs.indexOf(S.sec) < 0) S.sec = 'All';
    var list = q ? items.filter(function (m) { return m.n.toLowerCase().indexOf(q) >= 0; }) :
      S.sec === 'All' ? items : S.sec === 'Top rated' ? top.map(function (x) { return items.filter(function (m) { return m.n === x.item; })[0] || { n: x.item, p: '', s: '' }; }) :
      items.filter(function (m) { return m.s === S.sec; });
    var h = '<div id="sayBox">' + sayingHtml(id) + '</div>' +
      '<input class="search" id="menuSearch" type="search" placeholder="Search the menu" value="' + esc(S.mq || '') + '" aria-label="Search the menu">';
    if (!q && secs.length > 2) h += '<div class="chips">' + secs.map(function (c) { return '<button class="chip" data-sec="' + esc(c) + '" aria-pressed="' + (S.sec === c) + '">' + esc(c) + '</button>'; }).join('') + '</div>';
    if (!q && S.sec === 'All') h += real.map(function (sec) {
      return '<h3 class="msec">' + esc(sec) + '</h3><div class="dishes">' + items.filter(function (m) { return m.s === sec; }).map(function (m) { return dishRow(id, m); }).join('') + '</div>';
    }).join('');
    else h += list.length ? '<div class="dishes">' + list.slice(0, 80).map(function (m) { return dishRow(id, m); }).join('') + '</div>' :
      '<p class="note">' + (q ? 'No dish matches. Add it below.' : 'We do not have this menu yet. Add what you ordered below.') + '</p>';
    h += '<div class="addrow"><input class="search" id="addItem" type="text" maxlength="60" placeholder="Not listed? Type what you got" aria-label="Add a dish"><button class="btn ghost" id="addItemBtn" data-id="' + esc(id) + '">Add</button></div>';
    box.innerHTML = h;
    var again = document.getElementById('cmtIn'); if (again && draft) again.value = draft;
  }
  function spotSheet(id, deal) {
    var sp = SPOTS[id]; if (!sp) return;
    var web = safeUrl(sp.website);
    var bph = sp.photo || placePhoto(sp.id) || street(sp), btag = !sp.photo && placePhoto(sp.id) ? '<span class="ptag">Student photo</span>' : '';
    var banner = bph ? '<div class="banner"><img alt="" src="' + esc(bph) + '">' + btag + '</div>' : '';
    var h = '<div class="spothead">' + (sp.logo ? logo(sp, 'big') : '') + '<div><span class="kick rust">' + esc(sp.category) + (sp.price ? ' · ' + esc(sp.price) : '') + '</span><h2>' + esc(sp.name) + '</h2>' + tagsHtml(sp) + '</div></div>';
    if (sp.address) h += '<p class="sub" style="margin-top:-6px">' + esc(sp.address) + (travel(sp) ? ' · about ' + travel(sp) + ' from campus' : '') + '</p>';
    h += banner;
    if (sp.blurb) h += '<p style="margin:0">' + esc(sp.blurb) + '</p>';
    var order = safeUrl(sp.order), look = 'https://www.google.com/search?q=' + encodeURIComponent(sp.name + ' ' + (sp.address || town().name + ' Ohio'));
    h += '<div class="btnrow">' +
      (order ? '<a class="btn hot" target="_blank" rel="noopener" data-order="' + esc(id) + '" href="' + esc(outLink(order)) + '">Order online</a>' : '') +
      (web && web !== order ? '<a class="btn ' + (order ? 'ghost' : 'hot') + '" target="_blank" rel="noopener" data-order="' + esc(id) + '" href="' + esc(outLink(web)) + '">Website</a>' : '') +
      (!web && !order ? '<a class="btn hot" target="_blank" rel="noopener" href="' + esc(look) + '">Look it up</a>' : '') +
      '<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(sp.name + ' ' + (sp.address || town().name + ' Ohio')) + '">Directions</a></div>';
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
    h += '<div><div class="sechead"><h2>The menu</h2><span>Rated by students</span></div><p class="sub">Every dish with what is in it. Tap Rate to score one from 1 to 10 and read what other students said.</p></div><div id="menuBox"></div>';
    document.getElementById('sheetRoot').innerHTML = '<div class="scrim" data-close><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(sp.name) + '"><div class="sheethead"><button class="x" data-close aria-label="Close">×</button></div><div class="sheetbody" id="sheetBody">' + h + '</div><div id="cartBar"></div></div></div>';
    S.mq = ''; S.sec = deal ? 'Deals' : 'All'; S.item = deal || null; S.opt = ''; S.qty = 1; S.step = ''; S.open = id; fillMenu(id); paintCart();
    if (deal) { var mb = document.querySelector('#menuBox .dish.open'); if (mb) mb.scrollIntoView({ block: 'center' }); }
    clearInterval(POLL);
    if (SERVER) { api('rpc/log_view', { p_town: S.town, p_place: id, p_viewer: U.device }).catch(function () {}); loadComments(id); loadScores(function () { softFill(id); }); POLL = setInterval(function () { if (S.open === id && !document.hidden) loadComments(id); }, 12000); }
    if (!MENUS) fetch('data/menus.json?v=' + (window.KORD_BUILD || '')).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (m) { MENUS = m || {}; if (S.open === id) fillMenu(id); });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#phLabel') && needAccount('add photos')) { e.preventDefault(); return; }
    var t = e.target.closest('button, a, [data-close]'); if (!t) return;
    if (t.matches('[data-close]') && (e.target === t || t.classList.contains('x'))) { S.auth = null; S.back = null; closeSheet(); return render(); }
    if (t.dataset.order && SERVER) api('rpc/log_order', { p_device: U.device, p_town: S.town, p_place: t.dataset.order }).catch(function () {});
    if (t.dataset.auth) return authSheet(t.dataset.auth);
    if (t.dataset.best) { S.best = t.dataset.best; return render(); }
    if (t.id === 'indexHelp') return infoSheet('The formula', 'How the KORD Index works', '<p class="sub">' + INDEXHELP + '</p><p class="sub"><b>KORD Index = average rating × number of votes.</b> Ten votes averaging 8.1 gives an Index of 81.</p>');
    if (t.dataset.unlock) { api('rpc/unlock_perk', { p_perk: +t.dataset.unlock }).then(function () { toast('Perk unlocked'); loadExtras(render); }).catch(function (e) { toast(/not enough/.test(e.message) ? 'Rate a few more dishes to unlock this.' : 'Could not unlock that perk.'); }); return; }
    if (t.dataset.redeem) { var pk = PERKS.filter(function (k) { return String(k.id) === t.dataset.redeem; })[0]; if (!pk) return;
      return infoSheet('Redeem', pk.title, '<p class="sub">Only tap the button when you are at the counter. A perk can be redeemed once and this cannot be undone.</p><button class="btn bigbtn" data-redeemgo="' + pk.id + '">Redeem now</button>'); }
    if (t.dataset.redeemgo) { var pid2 = t.dataset.redeemgo, pk2 = PERKS.filter(function (k) { return String(k.id) === pid2; })[0]; t.disabled = true;
      api('rpc/redeem_perk', { p_perk: +pid2 }).then(function (when) {
        MYPERKS[pid2] = { perk_id: +pid2, redeemed_at: when || new Date().toISOString() };
        infoSheet('Redeemed', pk2 ? pk2.title : 'Perk', '<div class="done"><span class="tick">✓</span><p class="sub">Show this screen to staff.</p><h2>' + esc(new Date(when || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })) + '</h2><p class="note">' + esc((ME && ME.username) || '') + '</p></div>');
      }).catch(function (e) { toast(/already/.test(e.message) ? 'This perk was already redeemed.' : /switched off/.test(e.message) ? 'Redeeming is switched off right now.' : 'Could not redeem. Try again.'); t.disabled = false; });
      return; }
    if (t.id === 'adminBtn') return adminSheet('overview');
    if (t.dataset.adm) return adminSheet(t.dataset.adm);
    if (t.dataset.flag) return admDo(api('rpc/admin_set_flag', { p_key: t.dataset.flag, p_enabled: t.dataset.on === '1' }), 'Saved');
    if (t.id === 'capSave') return admDo(api('rpc/admin_set_vote_cap', { p_cap: +document.getElementById('capIn').value }), 'Limit saved');
    if (t.dataset.perkedit) { ADM.edit = (ADM.data || []).filter(function (k) { return String(k.id) === t.dataset.perkedit; })[0] || null; document.getElementById('admBody').innerHTML = adminBody(); var pt = document.getElementById('pkTitle'); if (pt) pt.scrollIntoView({ block: 'center' }); return; }
    if (t.dataset.perkdel) return admDo(api('rpc/admin_delete_perk', { p_id: +t.dataset.perkdel }), 'Perk deleted');
    if (t.id === 'perkSave') { var gv = function (i) { return document.getElementById(i).value.trim(); }; if (!gv('pkTitle')) return toast('Give the perk a title.');
      return admDo(api('rpc/admin_save_perk', { p: { id: ADM.edit && ADM.edit.id ? String(ADM.edit.id) : '', title: gv('pkTitle'), description: gv('pkDesc'), town: gv('pkPlace') ? S.town : gv('pkTown'), place_id: gv('pkPlace'), votes_required: gv('pkVotes') || '0', ends_at: gv('pkEnds') ? gv('pkEnds') + 'T23:59:59' : '', active: document.getElementById('pkActive').checked } }), 'Perk saved'); }
    if (t.dataset.merchedit) { ADM.edit = (ADM.data || []).filter(function (k) { return String(k.id) === t.dataset.merchedit; })[0] || null; document.getElementById('admBody').innerHTML = adminBody(); var mt = document.getElementById('mcName'); if (mt) mt.scrollIntoView({ block: 'center' }); return; }
    if (t.dataset.merchdel) return admDo(api('rpc/admin_delete_merch', { p_id: +t.dataset.merchdel }), 'Item deleted');
    if (t.id === 'merchSave') { var mv = function (i) { return document.getElementById(i).value.trim(); }; if (!mv('mcName')) return toast('Give the item a name.');
      if ((mv('mcImg') && !/^https:\/\//.test(mv('mcImg'))) || (mv('mcLink') && !/^https:\/\//.test(mv('mcLink')))) return toast('Links must start with https://');
      return admDo(api('rpc/admin_save_merch', { p: { id: ADM.edit && ADM.edit.id ? String(ADM.edit.id) : '', name: mv('mcName'), price: mv('mcPrice'), description: mv('mcDesc'), image_url: mv('mcImg'), link_url: mv('mcLink'), available: document.getElementById('mcAvail').checked } }), 'Item saved'); }
    if (t.dataset.mod) { var mm = t.dataset.mod.split('|'); return admDo(api('rpc/admin_moderate', { p_kind: mm[0], p_id: +mm[1], p_action: mm[2] }), 'Done'); }
    if (t.id === 'admFind') { ADM.q = document.getElementById('admEmail').value.trim(); if (ADM.q.length < 2) return toast('Type at least 2 characters.');
      api('rpc/admin_find_users', { p_email: ADM.q }).then(function (r) { ADM.found = r || []; document.getElementById('admBody').innerHTML = adminBody(); }).catch(function () { toast('Search failed.'); }); return; }
    if (t.dataset.setadmin) { var sa = t.dataset.setadmin.split('|'); ADM.found = null; return admDo(api('rpc/admin_set_admin', { p_user: sa[0], p_admin: sa[1] === '1' }), 'Saved'); }
    if (t.id === 'auGo') return authGo();
    if (t.id === 'signOut') { fresh().then(function (tok) { if (tok) authCall('logout', null, 'POST', tok).catch(function () {}); dropSession(); render(); toast('Signed out'); }); return; }
    if (t.dataset.rate) {
      if (needAccount('rate dishes')) return;
      var id = t.dataset.id, it = t.dataset.item, n = +t.dataset.rate, was = (U.items[id] || {})[it] || 0; U.items[id] = U.items[id] || {};
      if (U.items[id][it] === n) { delete U.items[id][it]; n = 0; } else { U.items[id][it] = n; if (!U.awarded['r|' + id + '|' + it]) U.stats.ratings++; award(10, 'Rated ' + it, 'r|' + id + '|' + it); }
      if (!Object.keys(U.items[id]).length) delete U.items[id];
      save('kord.user', U); fillMenu(id);
      if (SERVER) api('rpc/rate_dish', { p_town: S.town, p_place: id, p_dish: it, p_stars: n }).then(function () { loadVotes(); loadScores(function () { softFill(id); }); }).catch(function (e) {
        /* the server said no: put the screen back the way it was */
        if (was) { (U.items[id] = U.items[id] || {})[it] = was; } else if (U.items[id]) { delete U.items[id][it]; if (!Object.keys(U.items[id]).length) delete U.items[id]; }
        save('kord.user', U); if (S.open === id) fillMenu(id);
        toast(/vote limit/.test(e.message) ? 'You have used your ratings for now. More open up within 12 hours.' : /sign in|JWT/i.test(e.message) ? 'Please sign in again to rate.' : 'Could not save that rating. Try again.');
      });
      return;
    }
    if (t.dataset.perk) {
      var pk = PERKS.filter(function (k) { return k.id === t.dataset.perk; })[0];
      if (pk && U.pts >= pk.cost) { U.pts -= pk.cost; if (pk.id === 'waiver') U.waivers++; else U.credits++; save('kord.user', U); toast('Redeemed: ' + pk.name); }
      return render();
    }
    if (t.dataset.like) {
      if (needAccount('vote on photos')) return;
      var lk = 'ph' + t.dataset.like; if (U.liked[lk]) return;
      U.liked[lk] = 1; save('kord.user', U);
      Object.keys(PHOTOS[S.open] || {}).forEach(function (k) { PHOTOS[S.open][k].forEach(function (r) { if (String(r.id) === t.dataset.like) r.likes = (r.likes || 0) + 1; }); });
      api('rpc/like_photo', { p_photo: +t.dataset.like }).catch(function () {});
      return fillMenu(S.open);
    }
    if (t.dataset.report) {
      if (needAccount('report things')) return;
      U.reported[t.dataset.report] = 1; save('kord.user', U); toast(/^ph/.test(t.dataset.report) ? 'Reported. You will not see that photo again.' : 'Reported. You will not see that comment again.');
      if (SERVER && /^ph\d+$/.test(t.dataset.report)) api('rpc/report_photo', { p_photo: +t.dataset.report.slice(2) }).catch(function () {});
      if (SERVER && /^id\d+$/.test(t.dataset.report)) api('rpc/report_comment', { p_comment: +t.dataset.report.slice(2) }).catch(function () {});
      return fillMenu(S.open);
    }
    if (t.id === 'creditsBtn') return creditsSheet();
    if (t.id === 'plusBtn') { U.plus = !U.plus; save('kord.user', U); toast(U.plus ? 'KORD Plus is on (demo, nothing charged)' : 'KORD Plus is off'); return render(); }
    if (t.dataset.food) { S.food = t.dataset.food; return render(); }
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
      if (needAccount('post comments')) return;
      cin.value = '';
      U.stats.comments++; var dk = dayKey(new Date()), slot = !U.awarded['c|' + dk + '|0'] ? 0 : !U.awarded['c|' + dk + '|1'] ? 1 : 2; award(5, 'Comment posted', 'c|' + dk + '|' + slot);
      if (SERVER) {
        (CMTS[pid] = CMTS[pid] || []).unshift({ dish: dish, name: (ME && ME.username) || 'Student', body: body, created_at: new Date().toISOString() });
        api('rpc/add_comment', { p_town: S.town, p_place: pid, p_dish: dish, p_body: body }).then(function () { loadComments(pid); })
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
    if (t.dataset.tab) { S.tab = t.dataset.tab; if (S.tab !== 'deals') loadScores(function () { if (!S.open) render(); }); else loadExtras(function () { if (!S.open && !S.auth && S.tab === 'deals' && !(document.activeElement && document.activeElement.id === 'dealSearch')) render(); }); render(); window.scrollTo(0, 0); try { history.replaceState(null, '', '#' + S.tab); } catch (err) {} return; }
    if (t.dataset.local) { S.localOnly = t.dataset.local === '1'; return render(); }
    if (t.id === 'swapBtn') { S.picking = true; render(); window.scrollTo(0, 0); }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'dealSearch') { S.dq = t.value; render(); var ds = document.getElementById('dealSearch'); ds.focus(); ds.setSelectionRange(ds.value.length, ds.value.length); }
    if (t.id === 'spotSearch') { S.q = t.value; render(); var n = document.getElementById('spotSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    if (t.id === 'nameIn' || t.id === 'ordName') { U.name = t.value.trim(); save('kord.user', U); }
    if (t.id === 'menuSearch') { S.mq = t.value; fillMenu(S.open); var ms = document.getElementById('menuSearch'); if (ms) { ms.focus(); ms.setSelectionRange(ms.value.length, ms.value.length); } }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'nameIn') render();
    if (t.id === 'phFile' && t.files && t.files[0] && SERVER && AUTH) {
      var pid = t.dataset.id, dish = t.dataset.dish, lab = document.getElementById('phLabel'), rd = new FileReader();
      var fail = function () { toast('Could not add that photo. Try again.'); if (lab) lab.textContent = 'Add a photo of this'; };
      if (lab) lab.textContent = 'Uploading…';
      rd.onerror = fail;
      rd.onload = function () { var im = new Image(); im.onerror = fail; im.onload = function () {
        var k = Math.min(1, 1200 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        c.toBlob(function (blob) {
          if (!blob) return fail();
          var id4 = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
          var path = AUTH.user.id + '/' + id4 + '.jpg';
          fresh().then(function (tok) { return fetch(SERVER.url + '/storage/v1/object/dish-photos/' + path, { method: 'POST', headers: { apikey: SERVER.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'image/jpeg' }, body: blob }); })
            .then(function (r) { if (!r.ok) throw new Error(r.status); return api('rpc/add_photo', { p_town: S.town, p_place: pid, p_dish: dish, p_path: path }); })
            .then(function () { U.stats.photos = (U.stats.photos || 0) + 1; award(10, 'Photo added', 'p|' + pid + '|' + dish); loadPhotos(function () { if (S.open === pid) fillMenu(pid); }); })
            .catch(fail);
        }, 'image/jpeg', 0.82);
      }; im.src = rd.result; };
      rd.readAsDataURL(t.files[0]);
    }
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
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && S.auth && e.target.closest && e.target.closest('.authbody') && document.getElementById('auGo')) { e.preventDefault(); return authGo(); } if (e.key === 'Escape') { closeSheet(); if (DATA) render(); } });

  /* Self-update: if a newer build is live than the one running, drop saved copies and reload once. */
  if (window.KORD_BUILD) fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (v) {
    var tried = ''; try { tried = sessionStorage.getItem('kord.reloaded') || ''; } catch (e) {}
    if (!v || !v.build || v.build === window.KORD_BUILD || tried === v.build) return;
    try { sessionStorage.setItem('kord.reloaded', v.build); } catch (e) {}
    var go = function () { location.replace(location.pathname + '?v=' + v.build + location.hash); };
    if (window.caches && caches.keys) caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }).then(go, go); else go();
  }).catch(function () {});
  fetch('data/kord.json?v=' + (window.KORD_BUILD || '')).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    DATA = d;
    if (d.server && /^https:\/\//.test(d.server.url || '') && d.server.key) SERVER = { url: d.server.url.replace(/\/+$/, ''), key: d.server.key };
    if (/[?&]server=off(&|$)/.test(location.search)) SERVER = null;   /* tests and previews: keep everything on this phone */
    var dev = /[?&]server=(http[^&]+)/.exec(location.search); if (dev && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) SERVER = { url: decodeURIComponent(dev[1]), key: 'dev' };
    d.towns.forEach(function (t) { t.spots.forEach(function (s) { SPOTS[s.id] = s; }); });
    var h = (location.hash || '').slice(1); if (['deals', 'places', 'best', 'you'].indexOf(h) >= 0) S.tab = h;
    if (!SERVER) AUTH = null;
    render();
    checkIn(); renderHeadPts();
    if (SERVER && !authFromLink()) loadMe(function () { if (!S.open && !S.auth) render(); });
    loadScores(function () { if (!S.open) render(); });
  }).catch(function () {
    document.getElementById('view').innerHTML = '<div class="empty"><b>Could not load the deals</b>Check your connection and reopen KORD.</div>';
  });
})();

if ('serviceWorker' in navigator && /^https:/.test(location.href) && !/htmlpreview/.test(location.host)) navigator.serviceWorker.register('sw.js').catch(function () {});
