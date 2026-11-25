// In-memory stand-in for the Supabase REST endpoints the app uses, for local testing only.
//   node server/mock.js 8799
const http = require('http');

const ratings = new Map(); // device|place|dish -> {town, place_id, dish, stars}
const comments = [];
const clicks = [];

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body == null ? '' : JSON.stringify(body));
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  if (!req.headers.apikey) return send(res, 401, { message: 'no key' });
  const url = new URL(req.url, 'http://x');
  const eq = (k) => (url.searchParams.get(k) || '').replace(/^eq\./, '');
  if (req.method === 'GET' && url.pathname === '/rest/v1/dish_scores') {
    const agg = new Map();
    for (const r of ratings.values()) {
      if (r.town !== eq('town')) continue;
      const k = r.place_id + '|' + r.dish;
      const a = agg.get(k) || { place_id: r.place_id, dish: r.dish, sum: 0, n: 0 };
      a.sum += r.stars; a.n += 1; agg.set(k, a);
    }
    return send(res, 200, [...agg.values()].map((a) => ({ place_id: a.place_id, dish: a.dish, avg: Math.round((a.sum / a.n) * 100) / 100, n: a.n })));
  }
  if (req.method === 'GET' && url.pathname === '/rest/v1/dish_comments') {
    return send(res, 200, comments.filter((c) => c.place_id === eq('place_id')).slice().reverse().slice(0, 80));
  }
  if (req.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      const fn = url.pathname.split('/').pop();
      if (fn === 'rate_dish') {
        const k = [b.p_device, b.p_place, b.p_dish].join('|');
        if (b.p_stars === 0) ratings.delete(k);
        else ratings.set(k, { town: b.p_town, place_id: b.p_place, dish: b.p_dish, stars: b.p_stars });
        return send(res, 204);
      }
      if (fn === 'add_comment') {
        const body = String(b.p_body || '').trim();
        if (!body || body.length > 280) return send(res, 400, { message: 'bad input' });
        comments.push({ id: comments.length + 1, town: b.p_town, place_id: b.p_place, dish: b.p_dish, name: (b.p_name || 'Student').slice(0, 30), body, created_at: new Date().toISOString() });
        return send(res, 204);
      }
      if (fn === 'log_order') { clicks.push(b); return send(res, 204); }
      send(res, 404, { message: 'no such function' });
    });
    return;
  }
  if (url.pathname === '/_clicks') return send(res, 200, clicks);
  send(res, 404, { message: 'not found' });
}).listen(+process.argv[2] || 8799);
