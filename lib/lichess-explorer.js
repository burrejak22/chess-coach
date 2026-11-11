// Live Lichess Opening Explorer client. Real human move distributions for any position,
// segmented by rating band, from millions of real games. Covers opening and early middle-
// game positions well; sparse or empty in late middlegame and endgames.
//
// API docs: https://lichess.org/api#tag/Opening-Explorer
// Endpoint: https://explorer.lichess.ovh/lichess
// No API key needed. Rate limit is generous for a single-user client; we cache aggressively
// to be a good citizen.
//
// On failure (network down, CORS, rate limit, 404) we return null and the caller falls
// back to the heuristic model. Silent — no retry, no log spam.
//
// Gated on the Chrome extension environment: if `chrome` is undefined (e.g., node tests),
// we never fire the network. Tests should hit the model path, not the real API.

const ENDPOINT = 'https://explorer.lichess.ovh/lichess';
const inBrowser = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

// Lichess rating bands available in the API. We map our "Play like" levels to the nearest.
const BANDS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

const closestBand = (level) => BANDS.reduce((best, b) => (
    Math.abs(b - level) < Math.abs(best - level) ? b : best
), BANDS[0]);

// In-memory LRU-ish cache; keyed by `${fen-placement}-${band}`. Caps at 500 entries so a
// long session doesn't balloon memory. Persist with chrome.storage.local when available.
const mem = new Map();
const CAP = 500;
const TTL_MS = 24 * 60 * 60 * 1000; // a day is plenty; the data moves slowly

const cacheKey = (fen, band) => `${fen.split(' ').slice(0, 2).join(' ')}#${band}`;

const loadPersisted = async () => {
    try {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        const { __lichess_explorer } = await chrome.storage.local.get('__lichess_explorer');
        if (__lichess_explorer && typeof __lichess_explorer === 'object') {
            const now = Date.now();
            for (const [k, v] of Object.entries(__lichess_explorer)) {
                if (v && (now - v.t) < TTL_MS) mem.set(k, v);
            }
        }
    } catch { /* ignore */ }
};

// fire-and-forget initial hydration
loadPersisted();

let persistTimer = null;
const schedulePersist = () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
        try {
            const dump = {};
            for (const [k, v] of mem.entries()) dump[k] = v;
            await chrome.storage.local.set({ __lichess_explorer: dump });
        } catch { /* ignore */ }
    }, 2000);
};

/**
 * Normalize the Lichess API response into { moves: [{san, uci, share, avgRating, games}], games }.
 * `share` is the fraction of games in which that move was played at this rating band. `games` on
 * the top level is the total game count that went into the shares.
 */
const normalize = (raw) => {
    if (!raw || !Array.isArray(raw.moves)) return null;
    const totalGames = raw.moves.reduce((s, m) => s + (m.white || 0) + (m.draws || 0) + (m.black || 0), 0);
    if (!totalGames) return null;
    const moves = raw.moves.map((m) => {
        const games = (m.white || 0) + (m.draws || 0) + (m.black || 0);
        return {
            san: m.san,
            uci: m.uci,
            share: games / totalGames,
            avgRating: m.averageRating || null,
            games,
        };
    });
    return { moves, games: totalGames };
};

/**
 * Fetch move distribution for `fen` from Lichess at the rating band closest to `level`.
 * Returns the normalized shape above, or null on any failure.
 *
 * @param {string} fen
 * @param {number} level target rating (we pick the nearest Lichess band)
 * @param {{timeoutMs?: number}} [opts]
 */
export const explorerShares = async (fen, level = 1600, { timeoutMs = 4000 } = {}) => {
    if (!inBrowser) return null;
    const band = closestBand(Number(level) || 1600);
    const key = cacheKey(fen, band);

    const cached = mem.get(key);
    if (cached && (Date.now() - cached.t) < TTL_MS) {
        return cached.v;
    }

    // Lichess accepts comma-separated rating bands; we use just the one closest to our level
    const url = `${ENDPOINT}?variant=standard&fen=${encodeURIComponent(fen)}&ratings=${band}&speeds=blitz,rapid,classical&moves=12&topGames=0&recentGames=0`;

    let controller;
    try {
        controller = new AbortController();
        const to = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(to);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const shape = normalize(raw);
        if (!shape) throw new Error('no games');

        mem.set(key, { v: shape, t: Date.now() });
        if (mem.size > CAP) {
            // drop the oldest ~10 entries to leave headroom
            const entries = [...mem.entries()].sort((a, b) => a[1].t - b[1].t);
            for (let i = 0; i < 10; i += 1) mem.delete(entries[i][0]);
        }
        schedulePersist();
        return shape;
    } catch {
        // cache the miss too, briefly, so we don't retry every 80ms during analysis churn
        mem.set(key, { v: null, t: Date.now() - (TTL_MS - 60_000) });
        return null;
    }
};

/**
 * Synchronous read of the in-memory cache only. Useful inside the hot path where an async
 * fetch would stall rendering. Caller is responsible for kicking off an `explorerShares()`
 * call in the background to warm the cache for next time.
 */
export const explorerCached = (fen, level = 1600) => {
    const band = closestBand(Number(level) || 1600);
    const key = cacheKey(fen, band);
    const cached = mem.get(key);
    return cached && (Date.now() - cached.t) < TTL_MS ? cached.v : null;
};

/**
 * Prime the cache for `fen`: fires an `explorerShares` request without awaiting.
 */
export const explorerPrime = (fen, level = 1600) => {
    if (!inBrowser) return;
    const band = closestBand(Number(level) || 1600);
    const key = cacheKey(fen, band);
    if (!mem.has(key)) {
        void explorerShares(fen, level);
    }
};
