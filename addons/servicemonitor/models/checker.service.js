// Service Monitor: checks a service (HTTP(S) request or TCP connect), reads its TLS certificate,
// and runs every enabled service on its own interval in the background.
// Types: http (URL), tcp (host:port), ping (ICMP echo via the system's ping command), dns (resolve a name).
//   status: 'up' | 'slow' (answered, but slower than its slow threshold) | 'down'
// Domain registrations (check_domain) are read over RDAP once a day.
// Certificates are read with a separate TLS handshake that accepts any certificate, so an expired
// or self-signed one is still read and shown; they are read again every CERT_EVERY_MS.
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const { execFile } = require('child_process');
const model = require('./services.model');
const domains = require('./domain.service');

const ADDON_ID = 'servicemonitor';
const TICK_MS = 2000;
const MAX_RUNNING = 32;                 // checks at the same time (mostly waiting on the network)
const MAX_PINGS = 6;                    // of which pings: each one starts a ping process
const MAX_BODY = 512 * 1024;           // bytes searched for the keyword
const CERT_EVERY_MS = 60 * 60 * 1000;
const DOMAIN_EVERY_MS = 24 * 60 * 60 * 1000;   // expiry dates change rarely, and RDAP servers rate-limit
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const USER_AGENT = 'Centrix-Service-Monitor/1.0';
const REDIRECTS = [301, 302, 303, 307, 308];

const elapsed = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

// Node's network errors in words a user can act on.
function describe(err) {
  const map = {
    ECONNREFUSED: 'Connection refused', ENOTFOUND: 'Host not found (DNS)', EAI_AGAIN: 'DNS lookup failed',
    ECONNRESET: 'Connection reset', EHOSTUNREACH: 'Host unreachable', ENETUNREACH: 'Network unreachable',
    ETIMEDOUT: 'Connection timed out', CERT_HAS_EXPIRED: 'Certificate has expired',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed certificate', SELF_SIGNED_CERT_IN_CHAIN: 'Self-signed certificate in chain',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Certificate chain cannot be verified', ERR_TLS_CERT_ALTNAME_INVALID: 'Certificate does not match the host name'
  };
  return (err && map[err.code]) || (err && err.message) || 'Unknown error';
}

function httpCheck(s) {
  return new Promise((resolve) => {
    let first;
    try { first = new URL(s.target); } catch (e) { return resolve({ status: 'down', ms: null, error: 'Invalid URL' }); }
    const ranges = (() => { try { return model.statusRanges(s.expected_status); } catch (e) { return [[200, 399]]; } })();
    const maxRedirects = s.max_redirects || 0;
    const t0 = process.hrtime.bigint();
    let done = false, req = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (req) req.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ status: 'down', ms: null, error: `No answer within ${s.timeout_ms / 1000} s` }), s.timeout_ms);

    // One request; a redirect (with Max. redirects > 0) sends the next one, the page it ends on is judged.
    const send = (url, method, hops) => {
      const lib = url.protocol === 'https:' ? https : http;
      const via = hops ? ` (after ${hops} redirect${hops === 1 ? '' : 's'} to ${url.href})` : '';
      req = lib.request(url, {
        method, agent: false, rejectUnauthorized: !s.ignore_tls,
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Cache-Control': 'no-cache' }
      }, (res) => {
        const code = res.statusCode;
        if (REDIRECTS.includes(code) && res.headers.location && maxRedirects > 0) {
          res.resume();
          if (hops >= maxRedirects) return finish({ status: 'down', ms: elapsed(t0), code, error: `More than ${maxRedirects} redirect${maxRedirects === 1 ? '' : 's'}` });
          let next;
          try { next = new URL(res.headers.location, url); } catch (e) { return finish({ status: 'down', ms: elapsed(t0), code, error: `HTTP ${code} to an invalid Location` }); }
          if (!/^https?:$/.test(next.protocol)) return finish({ status: 'down', ms: elapsed(t0), code, error: `HTTP ${code} to ${next.protocol} (not http/https)` });
          // As browsers do: 303, and 301 / 302 after a POST, continue as GET; 307 / 308 keep the method.
          const nextMethod = code === 303 || ((code === 301 || code === 302) && method === 'POST') ? 'GET' : method;
          req.destroy();
          return send(next, nextMethod, hops + 1);
        }
        const ms = elapsed(t0);
        const judge = (bodyOk) => {
          const okCode = ranges.some(([lo, hi]) => code >= lo && code <= hi);
          if (!okCode) return { status: 'down', ms, code, error: `HTTP ${code}${res.statusMessage ? ' ' + res.statusMessage : ''} (expected ${s.expected_status})${via}` };
          if (!bodyOk) return { status: 'down', ms, code, error: `"${s.keyword}" not found in the response${via}` };
          if (s.slow_ms && ms > s.slow_ms) return { status: 'slow', ms, code, error: `Slower than ${s.slow_ms} ms` };
          return { status: 'up', ms, code, error: '' };
        };
        if (!s.keyword || method === 'HEAD') return finish(judge(true));
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.includes(s.keyword)) finish(judge(true));
          else if (body.length > MAX_BODY) finish(judge(false));
        });
        res.on('end', () => finish(judge(body.includes(s.keyword))));
        res.on('error', (err) => finish({ status: 'down', ms, code, error: describe(err) }));
      });
      req.on('error', (err) => finish({ status: 'down', ms: null, error: describe(err) + via }));
      if (method === 'POST') req.setHeader('Content-Length', 0);
      req.end();
    };
    try {
      send(first, s.method || 'GET', 0);
    } catch (err) {
      finish({ status: 'down', ms: null, error: describe(err) });
    }
  });
}

function tcpCheck(s) {
  return new Promise((resolve) => {
    const hp = model.hostPort(s.target);
    if (!hp) return resolve({ status: 'down', ms: null, error: 'Invalid host:port' });
    const t0 = process.hrtime.bigint();
    const sock = net.connect({ host: hp.host, port: hp.port });
    let done = false;
    const finish = (r) => { if (done) return; done = true; sock.destroy(); resolve(r); };
    sock.setTimeout(s.timeout_ms, () => finish({ status: 'down', ms: null, error: `No answer within ${s.timeout_ms / 1000} s` }));
    sock.on('connect', () => {
      const ms = elapsed(t0);
      finish(s.slow_ms && ms > s.slow_ms ? { status: 'slow', ms, error: `Slower than ${s.slow_ms} ms` } : { status: 'up', ms, error: '' });
    });
    sock.on('error', (err) => finish({ status: 'down', ms: null, error: describe(err) }));
  });
}

// One ICMP echo with the system's ping (no shell; the host is validated, so it cannot be an option).
function pingCheck(s) {
  return new Promise((resolve) => {
    const host = String(s.target || '').trim();
    if (!model.isHost(host)) return resolve({ status: 'down', ms: null, error: 'Invalid host' });
    const win = process.platform === 'win32';
    const args = win ? ['-n', '1', '-w', String(s.timeout_ms), host] : ['-c', '1', '-W', String(Math.max(1, Math.ceil(s.timeout_ms / 1000))), host];
    const t0 = process.hrtime.bigint();
    execFile('ping', args, { timeout: s.timeout_ms + 2000, windowsHide: true }, (err, stdout) => {
      const out = String(stdout || '');
      // A reply has a TTL; Windows exits 0 for "Destination host unreachable" too, so the exit code is not enough.
      if (!/ttl[=:]/i.test(out)) {
        const line = out.split(/\r?\n/).map((l) => l.trim()).find((l) => /unreachable|timed out|could not find|unknown host|100% (packet )?loss|not known/i.test(l));
        return resolve({ status: 'down', ms: null, error: line || (err && err.code === 'ENOENT' ? 'The ping command is not available on the server' : 'No reply') });
      }
      const m = /[=<]\s*([\d.]+)\s*ms/i.exec(out);
      const ms = m ? Math.round(parseFloat(m[1])) : elapsed(t0);
      resolve(s.slow_ms && ms > s.slow_ms ? { status: 'slow', ms, error: `Slower than ${s.slow_ms} ms` } : { status: 'up', ms, error: '' });
    });
  });
}

// Resolves the name (record type, optionally on a given DNS server); with a keyword, an answer must contain it.
async function dnsCheck(s) {
  const resolver = new dns.promises.Resolver({ timeout: s.timeout_ms, tries: 1 });
  if (s.dns_server) {
    try { resolver.setServers([s.dns_server]); } catch (e) { return { status: 'down', ms: null, error: 'Invalid DNS server' }; }
  }
  const t0 = process.hrtime.bigint();
  try {
    const raw = await resolver.resolve(String(s.target).replace(/\.$/, ''), s.dns_type || 'A');
    const ms = elapsed(t0);
    const answers = raw.map((a) => (Array.isArray(a) ? a.join('') : a && typeof a === 'object' ? `${a.priority} ${a.exchange}` : String(a)));
    const shown = answers.slice(0, 5).join(', ') + (answers.length > 5 ? ` (+${answers.length - 5})` : '');
    if (!answers.length) return { status: 'down', ms, error: `No ${s.dns_type} record` };
    if (s.keyword && !answers.some((a) => a.toLowerCase().includes(s.keyword.toLowerCase()))) {
      return { status: 'down', ms, error: `"${s.keyword}" not in the answer: ${shown}` };
    }
    if (s.slow_ms && ms > s.slow_ms) return { status: 'slow', ms, error: `Slower than ${s.slow_ms} ms · ${shown}` };
    return { status: 'up', ms, error: '', answer: shown };
  } catch (err) {
    const words = { ENOTFOUND: 'Name not found (NXDOMAIN)', ENODATA: `No ${s.dns_type} record`, ETIMEOUT: 'DNS server did not answer', ECONNREFUSED: 'DNS server refused the query', ESERVFAIL: 'DNS server failure (SERVFAIL)', EREFUSED: 'DNS server refused the query' };
    return { status: 'down', ms: null, error: words[err.code] || describe(err) };
  }
}

const CHECKS = { http: httpCheck, tcp: tcpCheck, ping: pingCheck, dns: dnsCheck };

const nameOf = (o) => (o ? o.CN || o.O || Object.values(o)[0] || '' : '');
const one = (v) => (Array.isArray(v) ? v.join(', ') : v || '');

/** The service's TLS certificate: { validFrom, validTo, subject, issuer, altNames, fingerprint, authorized, error }. */
function readCert(s) {
  return new Promise((resolve) => {
    let host, port;
    if (s.type === 'http') {
      try { const u = new URL(s.target); host = u.hostname.replace(/^\[|\]$/g, ''); port = +u.port || 443; } catch (e) { return resolve({ error: 'Invalid URL' }); }
    } else {
      const hp = model.hostPort(s.target);
      if (!hp) return resolve({ error: 'Invalid host:port' });
      host = hp.host; port = hp.port;
    }
    let done = false;
    const sock = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: s.timeout_ms });
    const finish = (r) => { if (done) return; done = true; sock.destroy(); resolve(r); };
    sock.on('secureConnect', () => {
      const c = sock.getPeerCertificate();
      if (!c || !c.valid_to) return finish({ error: 'No certificate was presented' });
      finish({
        validFrom: new Date(c.valid_from).toISOString(), validTo: new Date(c.valid_to).toISOString(),
        subject: one(nameOf(c.subject)), issuer: one(nameOf(c.issuer)), issuerOrg: one(c.issuer && c.issuer.O),
        altNames: String(c.subjectaltname || '').replace(/DNS:/g, '').slice(0, 1000),
        serial: c.serialNumber || '', fingerprint: c.fingerprint256 || '',
        authorized: sock.authorized, error: sock.authorized ? '' : describe({ code: sock.authorizationError, message: String(sock.authorizationError || '') })
      });
    });
    sock.on('timeout', () => finish({ error: `No TLS handshake within ${s.timeout_ms / 1000} s` }));
    sock.on('error', (err) => finish({ error: describe(err) }));
  });
}
exports.readCert = readCert;

/** Checks a stored service (row) once; with `cert` / `domain`, reads those too. Nothing is saved. */
exports.probe = async function (s, { cert = true, domain = true } = {}) {
  const [result, c, d] = await Promise.all([
    (CHECKS[s.type] || httpCheck)(s),
    cert && model.hasCert(s) ? readCert(s) : null,
    domain && s.check_domain ? domains.lookup(model.hostOf(s)) : null
  ]);
  return { result, cert: c, domain: d };
};

// ---- background scheduler ----

const running = new Map();          // service id -> promise of its check
let timer = null, lastPrune = 0;

/** Checks a service now and saves the result; a check already running for it is shared. */
function checkNow(s, { forceCert = false } = {}) {
  if (running.has(s.id)) return running.get(s.id);
  const older = (at, ms) => !at || Date.now() - new Date(at).getTime() >= ms;
  const p = exports.probe(s, { cert: forceCert || older(s.cert_checked_at, CERT_EVERY_MS), domain: older(s.domain_checked_at, DOMAIN_EVERY_MS) })
    .then(({ result, cert, domain }) => model.record(s, result, cert, domain))
    // a check someone asked for (Check now, save): the page reloads at once, so it must not get cached data
    .then((v) => { if (forceCert) model.changed(); return v; })
    .finally(() => running.delete(s.id));
  p.type = s.type;                       // for the ping cap in tick()
  running.set(s.id, p);
  return p;
}
exports.checkNow = checkNow;

// Seconds to the next check: the retry interval while retrying, else the heartbeat interval.
const every = (s) => (s.status === 'retry' && s.retry_interval_sec ? s.retry_interval_sec : s.interval_sec);

async function tick() {
  if (!require('../../../app/core/addons').isActive(ADDON_ID)) return;
  const free = MAX_RUNNING - running.size;
  if (free > 0) {
    const due = (await model.enabled())
      .filter((s) => !running.has(s.id) && (!s.last_checked_at || Date.now() - new Date(s.last_checked_at).getTime() >= every(s) * 1000))
      .sort((a, b) => String(a.last_checked_at || '').localeCompare(String(b.last_checked_at || '')));
    // Longest-waiting first; pings (a process each) have a smaller cap of their own.
    let pings = [...running.values()].filter((r) => r.type === 'ping').length, started = 0;
    for (const s of due) {
      if (started >= free) break;
      if (s.type === 'ping') { if (pings >= MAX_PINGS) continue; pings++; }
      started++;
      checkNow(s).catch((err) => console.error(`Service Monitor: check of "${s.name}" failed:`, err.message));
    }
  }
  if (Date.now() - lastPrune >= PRUNE_EVERY_MS) {
    lastPrune = Date.now();
    await model.prune();
  }
  // Settings > Auto reset statistics (looks once a minute whether a reset is due)
  await require('./autoreset.service').tick();
}

/** Starts the background checks (once). */
exports.start = function () {
  if (timer) return;
  const safeTick = () => tick().catch((err) => console.error('Service Monitor:', err.message));
  timer = setInterval(safeTick, TICK_MS);
  if (timer.unref) timer.unref();
  setTimeout(safeTick, 3000).unref();
};
