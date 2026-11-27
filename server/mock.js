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

  // ---- functions
  if (req.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
    const b = JSON.parse((await body(req)).toString() || '{}');
    const fn = url.pathname.split('/').pop();
    if (fn === 'log_order') { clicks.push(b); return send(res, 204); }
    if (fn === 'username_taken') return send(res, 200, [...users.values()].some((u) => u.username.toLowerCase() === String(b.p_username || '').trim().toLowerCase()));
    if (!me) return send(res, 400, { message: 'sign in' });
    if (fn === 'my_profile') return send(res, 200, { username: me.username, town: null, is_admin: me.is_admin });
    if (fn === 'my_votes') {
      const mine = [...ratings.values()].filter((r) => r.uid === me.id), rc = recent(me.id);
      return send(res, 200, { used: rc.length, cap: CAP, remaining: Math.max(0, CAP - rc.length), next_at: rc.length ? new Date(Math.min(...rc.map((v) => v.at)) + 12 * 3600e3).toISOString() : null,
        highest: mine.length ? Math.max(...mine.map((r) => r.stars)) : null, rated: mine.length });
    }
    if (fn === 'my_ratings') return send(res, 200, [...ratings.values()].filter((r) => r.uid === me.id).map((r) => ({ place_id: r.place_id, dish: r.dish, stars: r.stars })));
    if (fn === 'rate_dish') {
      const k = [me.id, b.p_place, b.p_dish].join('|');
      if (b.p_stars === 0) { ratings.delete(k); return send(res, 204); }
      if (!(b.p_stars >= 1 && b.p_stars <= 10)) return send(res, 400, { message: 'bad stars' });
      if (!ratings.has(k)) { if (recent(me.id).length >= CAP) return send(res, 400, { message: 'vote limit' }); votes.push({ uid: me.id, at: Date.now() }); }
      ratings.set(k, { uid: me.id, town: b.p_town, place_id: b.p_place, dish: b.p_dish, stars: b.p_stars });
      return send(res, 204);
    }
    if (fn === 'add_comment') {
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
    if (fn === 'my_photo_paths') return send(res, 200, photos.filter((x) => x.uid === me.id).map((x) => x.path));
    if (fn === 'delete_account') {
      if (me.is_admin && [...users.values()].filter((u) => u.is_admin).length <= 1) return send(res, 400, { message: 'last admin' });
      for (const [k, r] of ratings) if (r.uid === me.id) ratings.delete(k);
      for (const list of [comments, photos]) for (let i = list.length - 1; i >= 0; i--) if (list[i].uid === me.id) list.splice(i, 1);
      users.delete(me.id); return send(res, 204);
    }
    return send(res, 404, { message: 'no such function' });
  }
  send(res, 404, { message: 'not found' });
}).listen(+process.argv[2] || 8799);
