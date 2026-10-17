const fsp = require('fs').promises;
const config = require('../config');

// Roughly how many bytes a log line takes. Used to size the single read that backs one
// page of output — generous enough that a page is almost always filled in one go.
const BYTES_PER_LINE = 200;

// Hard ceiling on one read, so a file of very long lines (a stack trace dumped as JSON,
// a minified bundle echoed to stdout) cannot make one request allocate unboundedly.
const MAX_READ_BYTES = 2 * 1024 * 1024;

const empty = (lines) => ({ lines: [], nextKey: -1, linesPerRequest: lines });

// Reads the tail of a log file backwards: `nextKey` is the byte offset the previous page
// stopped at, so a caller can page further back without holding the whole file in memory.
//
// The read is a single positional read into one pre-sized buffer rather than a stream:
// a stream costs an fd, a set of event registrations and a string concatenation per chunk,
// all to fetch ~10 KB that is already known to be contiguous. On a log view polling every
// three seconds, per-request garbage is the whole cost of the endpoint.
const readLogsReverse = async (params) => {
    const { filePath, nextKey } = params;
    const lines = parseInt(params.linesPerRequest ?? config.DEFAULTS.LINES_PER_REQUEST, 10);
    const endBytes = parseInt(nextKey, 10);

    if (!filePath || !Number.isFinite(lines) || lines < 1) {
        console.error('Input params error : ', { filePath, lines });
        return empty(config.DEFAULTS.LINES_PER_REQUEST);
    }

    let handle;
    try {
        handle = await fsp.open(filePath, 'r');
    } catch (err) {
        // A never-written log file is normal for an app that has produced no output
        return empty(lines);
    }

    try {
        const { size: fileSize } = await handle.stat();
        const end = Number.isFinite(endBytes) && endBytes >= 0 ? Math.min(endBytes, fileSize) : fileSize;
        const start = Math.max(0, end - Math.min(lines * BYTES_PER_LINE, MAX_READ_BYTES));
        const length = end - start;
        // The caller has paged back to the start of the file: -1 is the same "nothing
        // further" signal an unwritten log file returns.
        if (length <= 0) return empty(lines);

        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);

        // Decode once, from the exact slice that was read. Splitting the buffer on 0x0A
        // first would save the decode of the discarded head, but the head is at most one
        // partial line — not worth a second scan of the same bytes.
        let parts = buffer.toString('utf8', 0, bytesRead).split('\n');
        // The first element is whatever was mid-line at `start`; keeping one extra element
        // and dropping it below is what discards it.
        parts = parts.slice(-(lines + 1));
        const nextOffset = end - Buffer.byteLength(parts.join('\n'), 'utf8');
        parts.pop();

        return { lines: parts, nextKey: nextOffset, linesPerRequest: lines };
    } finally {
        await handle.close();
    }
};

module.exports = { readLogsReverse };
