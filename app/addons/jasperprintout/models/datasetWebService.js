// Jasper Designer → Dataset and Query, web service reports (query language json): calls the
// report's HTTP request and reads the records from its JSON answer, for Read Fields / Data preview.
//
//   ws: { method, url, params: [{ key, value, on }], headers: [...], body }
//   query: where the records are in the answer, as JasperReports' json query reads it:
//          ''  the whole answer (an array: one record per item), 'data.items', 'result[0].orders'
//
// $P{name} in the URL, parameter and header values and the body is replaced by the parameter's value.
// In a JSON body "$P{name}" (quoted) becomes a JSON string and $P{name} a JSON value.
const axios = require('axios');
const https = require('https');

const TIMEOUT_MS = 30000;
const MAX_BYTES = 20 * 1024 * 1024;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const bad = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
const P_RE = /\$P!?\{([^}]+)\}/g;

// valueOf(name) → the value for $P{name}, or undefined when it has none.
function substituter(valueOf) {
  const missing = new Set();
  const get = (name) => {
    const v = valueOf(name);
    if (v === undefined) { missing.add(name); return null; }
    return v;
  };
  return {
    missing,
    text: (s) => String(s || '').replace(P_RE, (all, name) => { const v = get(name); return v == null ? '' : String(v); }),
    url: (s) => String(s || '').replace(P_RE, (all, name) => { const v = get(name); return v == null ? '' : encodeURIComponent(String(v)); }),
    json: (s) => String(s || '')
      .replace(/"\$P!?\{([^}]+)\}"/g, (all, name) => { const v = get(name); return JSON.stringify(v == null ? null : String(v)); })
      .replace(P_RE, (all, name) => JSON.stringify(get(name)))
  };
}

// The records at `path` in the answer: an array gives one record per item, anything else one record.
function records(answer, path) {
  const steps = String(path || '').trim().replace(/^\$\.?/, '').split(/\.|(?=\[)/).filter(Boolean);
  let v = answer;
  for (const step of steps) {
    const idx = /^\[(\d+)\]$/.exec(step);
    if (v == null) break;
    v = idx ? (Array.isArray(v) ? v[Number(idx[1])] : undefined) : v[step];
  }
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : [v];
  return list.map((x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x : { value: x }));
}

/** → { docs, count: { total, more }, missing, source: { collection } } */
exports.run = async function (opts, limit, valueOf) {
  const ws = opts.ws && typeof opts.ws === 'object' ? opts.ws : {};
  const method = METHODS.includes(String(ws.method || '').toUpperCase()) ? String(ws.method).toUpperCase() : 'GET';
  const sub = substituter(valueOf);
  const rawUrl = sub.url(String(ws.url || '').trim());
  if (!rawUrl) throw bad('Type the web service URL first.');
  let url;
  try { url = new URL(rawUrl); } catch (e) { throw bad('The web service URL is not valid: ' + rawUrl); }
  if (!/^https?:$/.test(url.protocol)) throw bad('The web service URL must start with http:// or https://.');
  const on = (list) => (Array.isArray(list) ? list : []).filter((x) => x && x.on !== false && String(x.key || '').trim());
  on(ws.params).forEach((x) => url.searchParams.append(String(x.key).trim(), sub.text(x.value)));
  const headers = {};
  on(ws.headers).forEach((x) => { headers[String(x.key).trim()] = sub.text(x.value); });
  const type = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type');
  let data;
  if (method !== 'GET' && String(ws.body || '').trim()) {
    const isJson = type ? /json/i.test(headers[type]) : /^\s*[[{]/.test(ws.body);
    data = isJson ? sub.json(ws.body) : sub.text(ws.body);
    if (!type) headers['Content-Type'] = isJson ? 'application/json' : 'text/plain';
  }
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'accept')) headers.Accept = 'application/json';
  const source = { collection: method + ' ' + url.host + url.pathname };
  let res;
  try {
    res = await axios.request({
      method, url: url.toString(), headers, data, timeout: TIMEOUT_MS, maxContentLength: MAX_BYTES, maxBodyLength: MAX_BYTES,
      responseType: 'text', transformResponse: [(x) => x], validateStatus: () => true, maxRedirects: 5,
      httpsAgent: new https.Agent({ rejectUnauthorized: true })
    });
  } catch (err) {
    if (err.code === 'ECONNABORTED') throw bad('The web service did not answer in ' + TIMEOUT_MS / 1000 + ' s.', 502);
    throw bad('Could not reach the web service: ' + err.message, 502);
  }
  const body = typeof res.data === 'string' ? res.data : String(res.data || '');
  if (res.status >= 400) throw bad(`The web service answered ${res.status}${body.trim() ? ': ' + body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) : ''}`, 502);
  let answer;
  try { answer = body.trim() ? JSON.parse(body) : null; } catch (e) {
    throw bad(`The web service did not answer JSON (${res.headers['content-type'] || 'no content type'}): ${body.replace(/\s+/g, ' ').trim().slice(0, 200)}`, 502);
  }
  const all = records(answer, opts.query);
  return { docs: all.slice(0, limit), count: { total: all.length, more: false }, missing: [...sub.missing], source };
};

exports._test = { substituter, records };
