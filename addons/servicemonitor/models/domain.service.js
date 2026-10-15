// Service Monitor: the registration expiry of a service's domain name, read over RDAP
// (rdap.org sends the query on to the registry of the top-level domain).
// Only public domain names are candidates: IP addresses, single-label names and internal suffixes
// (.local, .lan, .internal, ...) are skipped with the reason, shown on the page.
const net = require('net');
const axios = require('axios');

const RDAP = 'https://rdap.org/domain/';
const TIMEOUT_MS = 15000;
const INTERNAL = new Set(['local', 'localhost', 'lan', 'internal', 'intranet', 'corp', 'home', 'localdomain', 'private', 'test', 'invalid', 'example', 'arpa']);
// Second-level labels that are public suffixes under country-code TLDs (co.th, go.th, ac.th, co.uk, com.au, ...).
const SECOND_LEVEL = new Set(['co', 'ac', 'go', 'or', 'in', 'mi', 'net', 'com', 'org', 'gov', 'edu', 'gob', 'gouv', 'ne', 'nic', 'ltd', 'plc', 'med', 'sch']);

/** The registrable domain of a host name: { domain } or { skipped: reason }. */
function registrable(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h) return { skipped: 'No host name' };
  if (net.isIP(h)) return { skipped: `"${h}" is an IP address, not a domain name` };
  const labels = h.split('.');
  const tld = labels[labels.length - 1];
  if (labels.length < 2 || INTERNAL.has(tld)) return { skipped: `"${h}" is not a public domain name (its suffix ".${tld}" is not managed by ICANN)` };
  const take = tld.length === 2 && labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  if (labels.length < take) return { skipped: `"${h}" is a public suffix, not a registered domain` };
  return { domain: labels.slice(-take).join('.') };
}
exports.registrable = registrable;

const vcardName = (entity) => {
  const card = entity && Array.isArray(entity.vcardArray) && entity.vcardArray[1];
  const fn = Array.isArray(card) && card.find((p) => p[0] === 'fn');
  return fn ? String(fn[3] || '') : '';
};

/** { domain, expiresAt, registeredAt, registrar, error } for the host, or { skipped }. Never throws. */
exports.lookup = async function (host) {
  const r = registrable(host);
  if (!r.domain) return r;
  try {
    const res = await axios.get(RDAP + encodeURIComponent(r.domain), {
      timeout: TIMEOUT_MS, maxRedirects: 5, headers: { Accept: 'application/rdap+json, application/json' },
      validateStatus: (code) => code < 500
    });
    if (res.status === 404) return { domain: r.domain, error: 'Not found in RDAP (the registry may not publish expiry dates)' };
    if (res.status >= 400) return { domain: r.domain, error: `RDAP answered HTTP ${res.status}` };
    const d = res.data || {};
    const ev = (action) => ((d.events || []).find((e) => e.eventAction === action) || {}).eventDate || null;
    const registrar = (d.entities || []).find((e) => (e.roles || []).includes('registrar'));
    const expiresAt = ev('expiration');
    return {
      domain: r.domain,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      registeredAt: ev('registration') ? new Date(ev('registration')).toISOString() : null,
      registrar: vcardName(registrar),
      error: expiresAt ? '' : 'The registry does not publish an expiry date'
    };
  } catch (err) {
    return { domain: r.domain, error: err.code === 'ECONNABORTED' ? 'RDAP did not answer in time' : `RDAP lookup failed: ${err.message}` };
  }
};
