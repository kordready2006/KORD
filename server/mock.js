// In-memory stand-in for the Supabase endpoints the app uses (auth, database functions, photo storage). Local testing only.
//   node server/mock.js 8799 [voteCap]
// Sign-up signs you straight in, except for emails containing "verify", which behave like a project with email confirmation on.
const http = require('http');
const crypto = require('crypto');

const CAP = +process.argv[3] || 20;
const users = new Map();    // id -> {id, email, password, username, is_admin, confirmed}
const ratings = new Map();  // uid|place|dish -> {uid, town, place_id, dish, stars}
const votes = [];           // {uid, at}
const comments = [];
const clicks = [];
const files = new Map();    // storage path -> Buffer
const photos = [];
const flags = [['comments', 'Comments on dishes'], ['photos', 'Student photos'], ['standings', 'Standings and leaderboards'], ['perks', 'Perks and deal redemptions'], ['community', 'Community feed'], ['friends', 'Friends and following']].map(([key, label]) => ({ key, label, enabled: true }));
const flagOn = (k) => (flags.find((f) => f.key === k) || { enabled: true }).enabled;
const perks = [], unlocks = [], merch = [], log = [], views = new Set();
const posts = [], follows = new Set(), blocks = new Set(), notes = [];
const rated = (uid, town) => [...ratings.values()].filter((r) => r.uid === uid && (!town || r.town === town));
const board = (town) => [...users.values()].map((u) => ({ user_id: u.id, username: u.username, rated: rated(u.id, town).length })).filter((x) => x.rated).sort((x, y) => y.rated - x.rated).map((x, i) => ({ pos: i + 1, ...x }));
let cap = CAP, seq = 0;

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(body == null ? '' : JSON.stringify(body));
}
const session = (u) => ({ access_token: 'tok-' + u.id, refresh_token: 'ref-' + u.id, expires_in: 3600, token_type: 'bearer', user: { id: u.id, email: u.email } });
const who = (req) => { const m = /^Bearer tok-(.+)$/.exec(req.headers.authorization || ''); return m && users.get(m[1]) || null; };
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
const recent = (uid) => votes.filter((v) => v.uid === uid && v.at > Date.now() - 12 * 3600e3);

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  const eq = (k) => (url.searchParams.get(k) || '').replace(/^eq\./, '');
  if (req.method === 'GET' && url.pathname.startsWith('/storage/v1/object/public/dish-photos/')) {
    const f = files.get(decodeURIComponent(url.pathname.slice('/storage/v1/object/public/dish-photos/'.length)));
    if (!f) return send(res, 404, { message: 'not found' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' }); return res.end(f);
  }
  if (!req.headers.apikey) return send(res, 401, { message: 'no key' });
  const me = who(req);

  // ---- auth
  if (url.pathname.startsWith('/auth/v1/')) {
    const b = JSON.parse((await body(req)).toString() || '{}');
    const path = url.pathname.slice('/auth/v1/'.length);
    if (path === 'signup') {
      if (!/^\S+@\S+\.\S+$/.test(b.email || '')) return send(res, 400, { msg: 'Unable to validate email address: invalid format' });
      if ((b.password || '').length < 8) return send(res, 422, { msg: 'Password should be at least 8 characters.', error_code: 'weak_password' });
      if ([...users.values()].some((u) => u.email === b.email)) return send(res, 422, { msg: 'User already registered', error_code: 'user_already_exists' });
      const u = { id: crypto.randomUUID(), email: b.email, password: b.password, username: (b.data && b.data.username) || 'Student', is_admin: users.size === 0, confirmed: !/verify/.test(b.email) };
      users.set(u.id, u);
      return send(res, 200, u.confirmed ? session(u) : { id: u.id, email: u.email });
    }
    if (path === 'token' && url.searchParams.get('grant_type') === 'password') {
      const u = [...users.values()].find((x) => x.email === b.email && x.password === b.password);
      if (!u) return send(res, 400, { msg: 'Invalid login credentials', error_code: 'invalid_credentials' });
      if (!u.confirmed) return send(res, 400, { msg: 'Email not confirmed', error_code: 'email_not_confirmed' });
      return send(res, 200, session(u));
    }
    if (path === 'token') { const u = users.get(String(b.refresh_token || '').slice(4)); return u ? send(res, 200, session(u)) : send(res, 400, { msg: 'Invalid Refresh Token' }); }
    if (path === 'recover') return send(res, 200, {});
    if (path === 'logout') return send(res, 204);
    if (path === 'user') {
      if (!me) return send(res, 401, { msg: 'invalid JWT' });
      if (req.method === 'PUT') { if ((b.password || '').length < 8) return send(res, 422, { msg: 'Password should be at least 8 characters.' }); me.password = b.password; }
      return send(res, 200, { id: me.id, email: me.email });
    }
    return send(res, 404, { msg: 'not found' });
  }

  // ---- photo files
  if (url.pathname.startsWith('/storage/v1/object/dish-photos')) {
    if (!me) return send(res, 403, { message: 'Access denied' });
    const raw = await body(req);
    if (req.method === 'DELETE') { for (const pth of JSON.parse(raw.toString() || '{}').prefixes || []) if (pth.startsWith(me.id + '/')) files.delete(pth); return send(res, 200, []); }
    const pth = decodeURIComponent(url.pathname.slice('/storage/v1/object/dish-photos/'.length));
    if (!pth.startsWith(me.id + '/')) return send(res, 403, { message: 'Access denied' });
    files.set(pth, raw); return send(res, 200, { Key: 'ok' });
  }

  // ---- public reads
  if (req.method === 'GET' && url.pathname === '/rest/v1/dish_scores') {
    const agg = new Map();
    for (const r of ratings.values()) {
      if (r.town !== eq('town')) continue;
      const k = r.place_id + '|' + r.dish, a = agg.get(k) || { place_id: r.place_id, dish: r.dish, sum: 0, n: 0 };
      a.sum += r.stars; a.n += 1; agg.set(k, a);
    }
    return send(res, 200, [...agg.values()].map((a) => ({ place_id: a.place_id, dish: a.dish, avg: Math.round((a.sum / a.n) * 100) / 100, n: a.n })));
  }
  if (req.method === 'GET' && url.pathname === '/rest/v1/dish_photos') {
    return send(res, 200, photos.filter((c) => c.town === eq('town') && (c.reports || []).length < 2).slice().reverse().map((c) => ({ id: c.id, place_id: c.place_id, dish: c.dish, path: c.path, featured: !!c.featured, likes: (c.likers || []).length })));
  }
  if (req.method === 'GET' && url.pathname === '/rest/v1/dish_comments') {
    return send(res, 200, comments.filter((c) => c.place_id === eq('place_id') && (c.reports || []).length < 3).slice().reverse().slice(0, 80));
  }
  if (url.pathname === '/_clicks') return send(res, 200, clicks);
  if (req.method === 'GET' && url.pathname === '/rest/v1/feature_flags') return send(res, 200, flags);
  if (req.method === 'GET' && url.pathname === '/rest/v1/perks') return send(res, 200, perks.filter((k) => k.active && (!k.ends_at || new Date(k.ends_at) > new Date())));
  if (req.method === 'GET' && url.pathname === '/rest/v1/merch') return send(res, 200, merch);
  if (req.method === 'GET' && url.pathname === '/rest/v1/place_standings') {
    const agg = new Map();
    for (const r of ratings.values()) { if (r.town !== eq('town')) continue; const a = agg.get(r.place_id) || { place_id: r.place_id, votes: 0, idx: 0 }; a.votes += 1; a.idx += r.stars; agg.set(r.place_id, a); }
    return send(res, 200, [...agg.values()].map((a) => ({ ...a, avg: Math.round((a.idx / a.votes) * 100) / 100 })).sort((x, y) => y.idx - x.idx));
  }

  // ---- functions
  if (req.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
    const b = JSON.parse((await body(req)).toString() || '{}');
    const fn = url.pathname.split('/').pop();
    if (fn === 'log_order') { clicks.push(b); return send(res, 204); }
    if (fn === 'log_view') { views.add([b.p_place, me ? me.id : b.p_viewer, new Date().toISOString().slice(0, 10)].join('|')); return send(res, 204); }
    if (fn === 'username_taken') return send(res, 200, [...users.values()].some((u) => u.username.toLowerCase() === String(b.p_username || '').trim().toLowerCase()));
    if (fn === 'wire_feed') {
      if (!flagOn('community')) return send(res, 200, []);
      const mine = me ? me.id : '';
      return send(res, 200, posts.filter((x) => !x.hidden && (x.reports || []).length < 3 && (b.p_friends ? follows.has(mine + '>' + x.user_id) : x.town === b.p_town) && !blocks.has(mine + '>' + x.user_id) && !blocks.has(x.user_id + '>' + mine))
        .slice().reverse().map((x) => ({ id: x.id, user_id: x.user_id, username: users.get(x.user_id).username, body: x.body, photo_path: x.photo_path, created_at: x.created_at })));
    }
    if (fn === 'leaderboard') return send(res, 200, board(b.p_town));
    if (fn === 'user_profile') {
      const u = users.get(b.p_user); if (!u || (me && blocks.has(u.id + '>' + me.id))) return send(res, 200, null);
      const rs = rated(u.id), byPlace = {};
      rs.forEach((r) => { (byPlace[r.place_id] = byPlace[r.place_id] || []).push(r.stars); });
      return send(res, 200, { id: u.id, username: u.username, rank: (board(null).find((x) => x.user_id === u.id) || {}).pos || null, rated: rs.length, highest: rs.length ? Math.max(...rs.map((r) => r.stars)) : null,
        perks: unlocks.filter((x) => x.user_id === u.id).length, followers: [...follows].filter((f) => f.endsWith('>' + u.id)).length, following: [...follows].filter((f) => f.startsWith(u.id + '>')).length,
        is_following: !!me && follows.has(me.id + '>' + u.id), is_blocked: !!me && blocks.has(me.id + '>' + u.id),
        been_there: Object.keys(byPlace).map((k) => ({ place_id: k, dishes: byPlace[k].length, avg: byPlace[k].reduce((a, c) => a + c, 0) / byPlace[k].length })),
        top_tasted: rs.slice().sort((x, y) => y.stars - x.stars).slice(0, 10).map((r) => ({ place_id: r.place_id, dish: r.dish, stars: r.stars })) });
    }
    if (!me) return send(res, 400, { message: 'sign in' });
    if (fn === 'accept_rules') { me.rules = true; return send(res, 204); }
    if (fn === 'add_post') {
      if (!flagOn('community')) return send(res, 400, { message: 'switched off' });
      if (!me.rules) return send(res, 400, { message: 'accept rules' });
      const text = String(b.p_body || '').trim(); if (!text || text.length > 500) return send(res, 400, { message: 'bad input' });
      if (b.p_path && (!files.has(b.p_path) || !b.p_path.startsWith(me.id + '/'))) return send(res, 400, { message: 'bad input' });
      posts.push({ id: posts.length + 1, user_id: me.id, town: b.p_town, body: text, photo_path: b.p_path || null, created_at: new Date().toISOString() });
      return send(res, 200, posts.length);
    }
    if (fn === 'delete_post') { const i = posts.findIndex((x) => x.id === b.p_post && x.user_id === me.id); if (i >= 0) posts[i].hidden = true; return send(res, 204); }
    if (fn === 'report_post') { const x = posts.find((q) => q.id === b.p_post); if (x) { x.reports = x.reports || []; if (!x.reports.includes(me.id)) x.reports.push(me.id); } return send(res, 204); }
    if (fn === 'follow_user') {
      if (!flagOn('friends')) return send(res, 400, { message: 'switched off' });
      if (b.p_user === me.id) return send(res, 400, { message: 'bad input' });
      if (blocks.has(me.id + '>' + b.p_user) || blocks.has(b.p_user + '>' + me.id)) return send(res, 400, { message: 'blocked' });
      if (!follows.has(me.id + '>' + b.p_user)) { follows.add(me.id + '>' + b.p_user); notes.push({ id: notes.length + 1, user_id: b.p_user, kind: 'follow', actor: me.id, username: me.username, created_at: new Date().toISOString(), is_new: true }); }
      return send(res, 204);
    }
    if (fn === 'unfollow_user') { follows.delete(me.id + '>' + b.p_user); return send(res, 204); }
    if (fn === 'block_user') {
      if (b.p_user === me.id) return send(res, 400, { message: 'bad input' });
      if (b.p_block) { blocks.add(me.id + '>' + b.p_user); follows.delete(me.id + '>' + b.p_user); follows.delete(b.p_user + '>' + me.id); } else blocks.delete(me.id + '>' + b.p_user);
      return send(res, 204);
    }
    if (fn === 'my_notifications') return send(res, 200, notes.filter((n) => n.user_id === me.id).slice().reverse());
    if (fn === 'friends_activity') return send(res, 200, [...ratings.values()].filter((r) => follows.has(me.id + '>' + r.uid)).map((r) => ({ user_id: r.uid, username: users.get(r.uid).username, place_id: r.place_id, dish: r.dish, stars: r.stars, at: new Date().toISOString() })));
    if (fn === 'my_profile') return send(res, 200, { id: me.id, username: me.username, town: null, is_admin: me.is_admin, rules: !!me.rules });
    if (fn === 'my_votes') {
      const mine = [...ratings.values()].filter((r) => r.uid === me.id), rc = recent(me.id);
      return send(res, 200, { used: rc.length, cap, remaining: Math.max(0, cap - rc.length), next_at: rc.length ? new Date(Math.min(...rc.map((v) => v.at)) + 12 * 3600e3).toISOString() : null,
        highest: mine.length ? Math.max(...mine.map((r) => r.stars)) : null, rated: mine.length });
    }
    if (fn === 'my_ratings') return send(res, 200, [...ratings.values()].filter((r) => r.uid === me.id).map((r) => ({ place_id: r.place_id, dish: r.dish, stars: r.stars })));
    if (fn === 'rate_dish') {
      const k = [me.id, b.p_place, b.p_dish].join('|');
      if (b.p_stars === 0) { ratings.delete(k); return send(res, 204); }
      if (!(b.p_stars >= 1 && b.p_stars <= 10)) return send(res, 400, { message: 'bad stars' });
      if (!ratings.has(k)) { if (recent(me.id).length >= cap) return send(res, 400, { message: 'vote limit' }); votes.push({ uid: me.id, at: Date.now() }); }
      ratings.set(k, { uid: me.id, town: b.p_town, place_id: b.p_place, dish: b.p_dish, stars: b.p_stars });
      return send(res, 204);
    }
    if (fn === 'my_perks') return send(res, 200, unlocks.filter((u) => u.user_id === me.id));
    if (fn === 'unlock_perk') {
      const k = perks.find((x) => x.id === b.p_perk && x.active); if (!k) return send(res, 400, { message: 'not available' });
      if (!flagOn('perks')) return send(res, 400, { message: 'switched off' });
      if ([...ratings.values()].filter((r) => r.uid === me.id).length < k.votes_required) return send(res, 400, { message: 'not enough votes' });
      if (!unlocks.find((u) => u.perk_id === k.id && u.user_id === me.id)) unlocks.push({ perk_id: k.id, user_id: me.id, unlocked_at: new Date().toISOString(), redeemed_at: null });
      return send(res, 204);
    }
    if (fn === 'redeem_perk') {
      if (!flagOn('perks')) return send(res, 400, { message: 'switched off' });
      const u = unlocks.find((x) => x.perk_id === b.p_perk && x.user_id === me.id && !x.redeemed_at); if (!u) return send(res, 400, { message: 'not unlocked or already redeemed' });
      u.redeemed_at = new Date().toISOString(); return send(res, 200, u.redeemed_at);
    }
    if (fn.startsWith('admin_')) {
      if (!me.is_admin) return send(res, 400, { message: 'not admin' });
      log.unshift({ action: fn.replace('admin_', ''), detail: b, at: new Date().toISOString(), by_name: me.username });
      if (fn === 'admin_stats') { log.shift(); return send(res, 200, { users: users.size, active_7d: new Set(votes.map((v) => v.uid)).size, ratings: ratings.size, ratings_7d: votes.length, comments: comments.length, photos: photos.length, views_30d: views.size, order_clicks_30d: clicks.length, perk_unlocks: unlocks.length, perk_redemptions: unlocks.filter((u) => u.redeemed_at).length, open_reports: comments.filter((c) => (c.reports || []).length).length + photos.filter((c) => (c.reports || []).length).length, vote_cap: cap, top_dishes: [], top_viewed: [] }); }
      if (fn === 'admin_set_flag') { const f = flags.find((x) => x.key === b.p_key); if (f) f.enabled = !!b.p_enabled; return send(res, 204); }
      if (fn === 'admin_set_vote_cap') { cap = +b.p_cap; return send(res, 204); }
      if (fn === 'admin_perks') { log.shift(); return send(res, 200, perks); }
      if (fn === 'admin_save_perk' || fn === 'admin_save_merch') {
        const list = fn === 'admin_save_perk' ? perks : merch, p = b.p || {};
        let row = list.find((x) => String(x.id) === String(p.id));
        if (!row) { row = { id: ++seq }; list.unshift(row); }
        Object.assign(row, p, { id: row.id, votes_required: +p.votes_required || 0, ends_at: p.ends_at || null, town: p.town || null, place_id: p.place_id || null });
        return send(res, 200, row.id);
      }
      if (fn === 'admin_delete_perk' || fn === 'admin_delete_merch') { const list = fn === 'admin_delete_perk' ? perks : merch, i = list.findIndex((x) => x.id === b.p_id); if (i >= 0) list.splice(i, 1); return send(res, 204); }
      if (fn === 'admin_reports') { log.shift(); return send(res, 200, { posts: posts.filter((c) => (c.reports || []).length).map((c) => ({ id: c.id, town: c.town, name: users.get(c.user_id).username, body: c.body, photo_path: c.photo_path, hidden: !!c.hidden, reports: c.reports.length })), comments: comments.filter((c) => (c.reports || []).length).map((c) => ({ ...c, hidden: !!c.hidden, reports: c.reports.length })), photos: photos.filter((c) => (c.reports || []).length).map((c) => ({ ...c, hidden: !!c.hidden, reports: c.reports.length })) }); }
      if (fn === 'admin_moderate') {
        const list = b.p_kind === 'comment' ? comments : b.p_kind === 'post' ? posts : photos, i = list.findIndex((x) => x.id === b.p_id); if (i < 0) return send(res, 204);
        if (b.p_action === 'delete') list.splice(i, 1); else if (b.p_action === 'hide') { list[i].hidden = true; list[i].reports = list[i].reports.concat(['x', 'y', 'z']); } else if (b.p_action === 'show') { list[i].hidden = false; list[i].reports = []; } else list[i].featured = b.p_action === 'feature';
        return send(res, 204);
      }
      if (fn === 'admin_find_users') { log.shift(); return send(res, 200, [...users.values()].filter((u) => u.email.includes(String(b.p_email).toLowerCase())).map((u) => ({ id: u.id, email: u.email, username: u.username, is_admin: u.is_admin }))); }
      if (fn === 'admin_set_admin') { const u = users.get(b.p_user); if (u && !b.p_admin && u.is_admin && [...users.values()].filter((x) => x.is_admin).length <= 1) return send(res, 400, { message: 'last admin' }); if (u) u.is_admin = !!b.p_admin; return send(res, 204); }
      if (fn === 'admin_log_recent') { log.shift(); return send(res, 200, log.slice(0, 40)); }
    }
    if (fn === 'add_comment') {
      if (!flagOn('comments')) return send(res, 400, { message: 'switched off' });
      const text = String(b.p_body || '').trim();
      if (!text || text.length > 280) return send(res, 400, { message: 'bad input' });
      comments.push({ id: comments.length + 1, uid: me.id, town: b.p_town, place_id: b.p_place, dish: b.p_dish, name: me.username, body: text, created_at: new Date().toISOString() });
      return send(res, 204);
    }
    if (fn === 'report_comment') { const c = comments.find((x) => x.id === b.p_comment); if (c) { c.reports = c.reports || []; if (!c.reports.includes(me.id)) c.reports.push(me.id); } return send(res, 204); }
    if (fn === 'add_photo') {
      if (!files.has(b.p_path) || !b.p_path.startsWith(me.id + '/')) return send(res, 400, { message: 'no such file' });
      photos.push({ id: photos.length + 1, uid: me.id, town: b.p_town, place_id: b.p_place, dish: b.p_dish, path: b.p_path });
      return send(res, 204);
    }
    if (fn === 'like_photo') { const c = photos.find((x) => x.id === b.p_photo); if (c) { c.likers = c.likers || []; if (!c.likers.includes(me.id)) c.likers.push(me.id); } return send(res, 204); }
    if (fn === 'report_photo') { const c = photos.find((x) => x.id === b.p_photo); if (c) { c.reports = c.reports || []; if (!c.reports.includes(me.id)) c.reports.push(me.id); } return send(res, 204); }
    if (fn === 'my_photo_paths') return send(res, 200, photos.filter((x) => x.uid === me.id).map((x) => x.path).concat(posts.filter((x) => x.user_id === me.id && x.photo_path).map((x) => x.photo_path)));
    if (fn === 'delete_account') {
      if (me.is_admin && [...users.values()].filter((u) => u.is_admin).length <= 1) return send(res, 400, { message: 'last admin' });
      for (const [k, r] of ratings) if (r.uid === me.id) ratings.delete(k);
      for (const list of [comments, photos]) for (let i = list.length - 1; i >= 0; i--) if (list[i].uid === me.id) list.splice(i, 1);
      for (let i = posts.length - 1; i >= 0; i--) if (posts[i].user_id === me.id) posts.splice(i, 1);
      for (const f of [...follows]) if (f.includes(me.id)) follows.delete(f);
      users.delete(me.id); return send(res, 204);
    }
    return send(res, 404, { message: 'no such function' });
  }
  send(res, 404, { message: 'not found' });
}).listen(+process.argv[2] || 8799);
