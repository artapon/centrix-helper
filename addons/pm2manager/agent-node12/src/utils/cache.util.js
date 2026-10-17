// Tiny TTL cache for expensive lookups (PM2 RPC/CLI reads, WMI and /proc probes).
//
// Behaviours that matter here:
//   * in-flight de-duplication — concurrent callers share one pending promise instead of
//     each spawning their own `pm2 jlist`
//   * optional stale-while-revalidate — within `staleMs` past expiry the cached value is
//     returned immediately and refreshed in the background, so a read never waits on a
//     1.3 s process spawn; past that window the caller waits for fresh data
//   * a rejected lookup is never cached as a value, but the *rejection* is held for a
//     short `errorMs` so a broken PM2 daemon cannot be re-probed once per request
//
// `invalidate()` after every mutation keeps this honest: the next read is always fresh.

// A failed probe is retried at most this often. Long enough that a down PM2 daemon or an
// unreachable WMI service is not re-dialled by every inbound request, short enough that a
// recovery is picked up within one dashboard refresh.
const DEFAULT_ERROR_MS = 1500;

const makeEntry = () => ({
    value: undefined,
    hasValue: false,
    expiresAt: 0,
    error: null,
    errorUntil: 0,
    inFlight: null
});

const load = (entry, fn, args, freshMs, errorMs) => {
    if (!entry.inFlight) {
        entry.inFlight = Promise.resolve()
            .then(() => fn(...args))
            .then(result => {
                entry.value = result;
                entry.hasValue = true;
                entry.expiresAt = Date.now() + freshMs;
                entry.error = null;
                entry.errorUntil = 0;
                return result;
            })
            .catch(err => {
                entry.error = err;
                entry.errorUntil = Date.now() + errorMs;
                throw err;
            })
            .finally(() => { entry.inFlight = null; });
    }
    return entry.inFlight;
};

const readEntry = (entry, fn, args, freshMs, staleMs, errorMs) => {
    const now = Date.now();
    if (entry.hasValue && now < entry.expiresAt) return Promise.resolve(entry.value);

    // Serve slightly stale data instantly, but only up to staleMs — beyond that the value
    // is too old to show without checking.
    if (entry.hasValue && staleMs > 0 && now < entry.expiresAt + staleMs) {
        load(entry, fn, args, freshMs, errorMs).catch(() => {});
        return Promise.resolve(entry.value);
    }

    // Recently failed and nothing usable cached: replay the failure rather than hammering
    // a resource that is already known to be unavailable.
    if (!entry.hasValue && entry.error && now < entry.errorUntil && !entry.inFlight) {
        return Promise.reject(entry.error);
    }

    return load(entry, fn, args, freshMs, errorMs);
};

// Cache for an argument-free lookup.
const cached = (fn, { freshMs, staleMs = 0, errorMs = DEFAULT_ERROR_MS } = {}) => {
    const entry = makeEntry();

    const wrapper = async () => readEntry(entry, fn, [], freshMs, staleMs, errorMs);

    wrapper.invalidate = () => {
        entry.value = undefined;
        entry.hasValue = false;
        entry.expiresAt = 0;
        entry.error = null;
        entry.errorUntil = 0;
    };

    // Whatever is cached right now, without triggering a lookup. Used by /health, which
    // must never itself be the reason a probe runs.
    wrapper.peek = () => (entry.hasValue && Date.now() < entry.expiresAt + staleMs ? entry.value : undefined);

    return wrapper;
};

// Cache keyed by the first argument (an app name, a log type, …). `maxEntries` bounds the
// map so a caller cycling through invented keys cannot grow it without limit — the agent
// only ever has a few dozen real keys, so a plain FIFO eviction is enough.
const cachedBy = (fn, { freshMs, staleMs = 0, errorMs = DEFAULT_ERROR_MS, maxEntries = 256 } = {}) => {
    const entries = new Map();

    const wrapper = async (key, ...rest) => {
        const k = String(key);
        let entry = entries.get(k);
        if (!entry) {
            if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
            entry = makeEntry();
            entries.set(k, entry);
        }
        return readEntry(entry, fn, [key, ...rest], freshMs, staleMs, errorMs);
    };

    wrapper.invalidate = (key) => {
        if (key === undefined) entries.clear();
        else entries.delete(String(key));
    };

    wrapper.size = () => entries.size;

    return wrapper;
};

module.exports = { cached, cachedBy };
