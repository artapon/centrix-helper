// HTTP client for a pm2-agent (pm2-admin project) on another server: one JSON document per call with
// the X-Agent-Token header. Built on http/https so the parts that matter are explicit: a hard timeout,
// a response size cap, and never following a redirect (it would replay the token to another host).
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// status: what this server answers; 502 means the failure is the agent's, not the request's.
class AgentError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'AgentError';
    this.status = status;
    this.expose = true;
  }
}

// An absolute http(s) origin without embedded credentials (the token is the credential).
function parseAgentUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch (e) { throw new AgentError('Agent URL is not a valid URL', 400); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AgentError('Agent URL must start with http:// or https://', 400);
  if (!url.hostname) throw new AgentError('Agent URL has no host', 400);
  if (url.username || url.password) throw new AgentError('Agent URL must not contain credentials; use the agent token', 400);
  return url;
}

// Keeps a base path, so an agent behind https://host/pm2-agent/ works like one at the root.
function buildUrl(baseUrl, agentPath, query) {
  const url = parseAgentUrl(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, '') + (agentPath.startsWith('/') ? agentPath : `/${agentPath}`);
  url.search = '';
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  return url;
}

const NET_ERRORS = {
  ECONNREFUSED: 'Connection refused. Is the agent running?',
  ENOTFOUND: 'Host not found. Check the agent URL.',
  ETIMEDOUT: 'Connection timed out',
  EHOSTUNREACH: 'Host unreachable',
  ECONNRESET: 'Connection reset by the agent',
  CERT_HAS_EXPIRED: 'The agent\'s TLS certificate has expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The agent uses a self-signed certificate. Turn on "Allow self-signed TLS" for it.',
  SELF_SIGNED_CERT_IN_CHAIN: 'The agent uses a self-signed certificate. Turn on "Allow self-signed TLS" for it.',
  ERR_TLS_CERT_ALTNAME_INVALID: 'The agent\'s TLS certificate does not match the host name'
};

/** One request; resolves with the agent's `data`, rejects with an AgentError fit to show. */
function request(target, agentPath, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, query, method = 'GET', body } = options;
  const url = buildUrl(target.url, agentPath, query);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = method === 'GET' ? null : Buffer.from(JSON.stringify(body || {}), 'utf8');

  return new Promise((resolveRaw, rejectRaw) => {
    // a destroyed request fires 'error' right after: the first, accurate reason wins
    let settled = false;
    const resolve = (v) => { if (!settled) { settled = true; resolveRaw(v); } };
    const reject = (e) => { if (!settled) { settled = true; rejectRaw(e); } };

    const req = transport.request(url, {
      method,
      headers: Object.assign({
        'X-Agent-Token': target.token,
        Accept: 'application/json',
        'User-Agent': 'centrix-pm2manager'
      }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      rejectUnauthorized: url.protocol === 'https:' ? !target.allowInsecureTls : undefined
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        return reject(new AgentError(`The agent answered with a redirect (${res.statusCode}). Check the URL.`));
      }
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { req.destroy(); return reject(new AgentError('The agent\'s answer is too large')); }
        chunks.push(chunk);
      });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {
          return reject(new AgentError(res.statusCode === 200 ? 'The answer is not JSON. Is this really a pm2-agent?' : `The agent answered HTTP ${res.statusCode}`));
        }
        if (res.statusCode === 401) return reject(new AgentError('The agent rejected the token', 401));
        if (res.statusCode === 403) return reject(new AgentError((parsed && parsed.error) || 'The agent refused this server\'s IP', 403));
        if (res.statusCode === 404) return reject(new AgentError((parsed && parsed.error) || 'Not found on the agent', 404));
        if (res.statusCode === 429) return reject(new AgentError('The agent\'s rate limit was reached. Slow down.', 429));
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new AgentError((parsed && parsed.error) || `The agent answered HTTP ${res.statusCode}`));
        if (!parsed || parsed.success !== true) return reject(new AgentError((parsed && parsed.error) || 'The agent reported a failure'));
        resolve(parsed.data);
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new AgentError(`The agent did not answer within ${Math.round(timeoutMs / 1000)} s`, 504));
    });
    req.on('error', (err) => reject(new AgentError(NET_ERRORS[err.code] || err.message || 'Could not reach the agent')));
    req.end(payload || undefined);
  });
}

exports.AgentError = AgentError;
exports.parseAgentUrl = parseAgentUrl;
exports.get = (target, agentPath, options = {}) => request(target, agentPath, Object.assign({}, options, { method: 'GET' }));
exports.send = (target, agentPath, options = {}) => request(target, agentPath, Object.assign({}, options, { method: options.method || 'POST' }));
