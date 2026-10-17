const zlib = require('zlib');
const config = require('../config');

// Response compression, without a dependency.
//
// The agent's payloads are the most compressible thing there is: an app listing, a port
// table and a process table are the same two dozen JSON keys repeated once per row. They
// gzip 8-12x. On the LAN that is bandwidth nobody misses, but pm2-admin frequently polls
// agents across a WAN or a VPN, where the round trip is dominated by bytes on the wire.
//
// Only bodies over COMPRESS_MIN_BYTES are compressed: below roughly a TCP segment there is
// nothing to win, and the CPU and the ~300 KB zlib window per stream are pure loss. That
// covers /health and the monitor poll, which stay uncompressed.
//
// gzip level 1 rather than the default 6. On repetitive JSON the two are within a few
// percent of each other on size, and level 1 costs a fraction of the CPU — this runs on a
// machine whose CPU is the thing being monitored.
const GZIP_OPTIONS = {
    level: 1,
    // The default 128 KB chunk allocates far more than any agent response needs.
    chunkSize: 16 * 1024,
    memLevel: 8
};

const encodings = (header) => String(header || '')
    .toLowerCase()
    .split(',')
    .map(part => part.split(';')[0].trim());

// Picks the best encoding the caller accepts. gzip first: it is universal, and every HTTP
// client pm2-admin might use handles it, while br is a meaningful CPU step up for a gain
// that does not matter at these payload sizes.
const negotiate = (req) => {
    const accepted = encodings(req.headers['accept-encoding']);
    if (accepted.includes('gzip')) return 'gzip';
    if (accepted.includes('deflate')) return 'deflate';
    return null;
};

// Above this size the compression is handed to libuv's threadpool instead of run inline.
// Below it the synchronous call is the cheaper of the two — a threadpool hop costs more
// than gzipping a few kilobytes — and above it a blocking call would stall every other
// in-flight request behind one process table.
const ASYNC_ABOVE_BYTES = 128 * 1024;

const compress = (encoding, buffer) => {
    const gzip = encoding === 'gzip';
    if (buffer.length < ASYNC_ABOVE_BYTES) {
        return Promise.resolve(gzip ? zlib.gzipSync(buffer, GZIP_OPTIONS) : zlib.deflateSync(buffer, GZIP_OPTIONS));
    }
    return new Promise((resolve, reject) => {
        const fn = gzip ? zlib.gzip : zlib.deflate;
        fn(buffer, GZIP_OPTIONS, (err, out) => (err ? reject(err) : resolve(out)));
    });
};

// Wraps res.json rather than res.write/res.end. Every response the agent produces is a
// single JSON object built in memory, so there is no stream to pipe and no reason to carry
// a transform stream's machinery: serialise, compress the one buffer, send it.
const compression = () => (req, res, next) => {
    if (!config.COMPRESSION) return next();

    const encoding = negotiate(req);
    if (!encoding) return next();

    const json = res.json.bind(res);
    res.json = (body) => {
        let payload;
        try {
            payload = Buffer.from(JSON.stringify(body), 'utf8');
        } catch (_) {
            // Anything JSON.stringify cannot handle is Express's problem to report, not
            // this middleware's to swallow.
            return json(body);
        }

        if (payload.length < config.COMPRESS_MIN_BYTES) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(payload);
        }

        compress(encoding, payload).then((compressed) => {
            if (res.writableEnded) return;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Encoding', encoding);
            // The body varies with the request's Accept-Encoding, so any cache between
            // the agent and pm2-admin must key on it.
            res.setHeader('Vary', 'Accept-Encoding');
            res.setHeader('Content-Length', String(compressed.length));
            res.end(compressed);
        }).catch((err) => {
            console.warn(`[agent] compression failed, sending plain: ${err.message}`);
            if (!res.writableEnded) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(payload);
            }
        });

        return res;
    };

    next();
};

module.exports = { compression };
