const crypto = require('crypto');
const config = require('../config');

// Constant-time compare so a caller cannot learn the token byte by byte from response
// timing. Lengths are compared first because timingSafeEqual throws on a length mismatch.
const tokenMatches = (given) => {
    if (typeof given !== 'string' || given.length !== config.AGENT_TOKEN.length) return false;
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(config.AGENT_TOKEN));
};

// Accept either form, so the agent works with a plain fetch as easily as with an HTTP client
// that only knows how to set Authorization:
//   Authorization: Bearer <token>
//   X-Agent-Token: <token>
const extractToken = (req) => {
    const header = req.get('authorization');
    if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
    const custom = req.get('x-agent-token');
    return custom ? custom.trim() : null;
};

// IPv4-mapped IPv6 (::ffff:10.0.0.5) is what Express reports on a dual-stack listener —
// strip the prefix so the allowlist can be written in the obvious form.
const normalizeIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

const isAllowedIp = (req, res, next) => {
    if (config.AGENT_ALLOWED_IPS.length === 0) return next();
    const ip = normalizeIp(req.ip);
    if (config.AGENT_ALLOWED_IPS.includes(ip)) return next();
    console.warn(`[agent] rejected request from ${ip} (not in AGENT_ALLOWED_IPS)`);
    return res.status(403).json({ success: false, error: 'Forbidden' });
};

const isAuthenticated = (req, res, next) => {
    if (!tokenMatches(extractToken(req))) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
};

module.exports = { isAllowedIp, isAuthenticated };
