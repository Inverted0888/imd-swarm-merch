/**
 * vote.js — Vote I/O layer for "Created by the Swarm" merch vote site.
 * Exposes `getCounts(ids)` and `cast(id, dir)` so the backend can be swapped later.
 */
(function (global) {
  'use strict';

  const NAMESPACE = 'imd-swarm-merch-r3';
  const API_BASE = 'https://abacus.jasoncameron.dev';
  const CONCURRENCY_LIMIT = 6;
  const REQUEST_TIMEOUT_MS = 6500;
  const STORAGE_KEY = `${NAMESPACE}:votes:v1`;

  // In-memory cache of latest known counts: { [id]: { up: number, down: number } }
  const countCache = Object.create(null);
  let apiOffline = false;
  const statusListeners = new Set();

  function setOfflineStatus(offline) {
    if (apiOffline !== offline) {
      apiOffline = offline;
      statusListeners.forEach((fn) => {
        try {
          fn(apiOffline);
        } catch (_) {
          // ignore listener errors
        }
      });
    }
  }

  function onStatusChange(fn) {
    if (typeof fn === 'function') {
      statusListeners.add(fn);
    }
    return () => statusListeners.delete(fn);
  }

  /**
   * Read visitor's locally stored votes from localStorage.
   * Returns an object mapping idea id -> 'up' | 'down'.
   */
  function getLocalVotes() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function getLocalVote(id) {
    const votes = getLocalVotes();
    const v = votes[id];
    return v === 'up' || v === 'down' ? v : null;
  }

  function saveLocalVote(id, dir) {
    try {
      const votes = getLocalVotes();
      votes[id] = dir;
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(votes));
    } catch (_) {
      // localStorage may be unavailable in private browsing modes
    }
  }

  /**
   * Fetch JSON with timeout.
   * For Abacus `/get/`, HTTP 404 means the counter has not been created yet (value = 0).
   */
  // Abacus allows 30 requests per 10 s per visitor; stay under it so a full page load never trips the limit.
  const WINDOW_MS = 10000;
  const MAX_PER_WINDOW = 20; // background reads; the service allows ~30 per 10 s per visitor, the rest is kept for clicks
  const stamps = [];
  async function slot(priority) {
    if (priority) { // a visitor's click (vote, heart, feedback) never waits behind the background count reads
      stamps.push(Date.now());
      return;
    }
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= WINDOW_MS) stamps.shift();
      if (stamps.length < MAX_PER_WINDOW) {
        stamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, WINDOW_MS - (now - stamps[0]) + 25));
    }
  }

  async function fetchCounter(action, key, allow404, retried, priority) {
    await slot(priority || action === 'hit');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      : null;

    try {
      const url = `${API_BASE}/${action}/${NAMESPACE}/${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });

      if (res.status === 429 && !retried) {
        if (timer) clearTimeout(timer);
        await new Promise((r) => setTimeout(r, WINDOW_MS));
        return fetchCounter(action, key, allow404, true, priority);
      }

      if (allow404 && res.status === 404) {
        return 0;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const val = data && typeof data.value === 'number' ? Math.max(0, Math.floor(data.value)) : 0;
      return val;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Run async tasks with a concurrency limit.
   */
  async function runWithConcurrency(items, limit, workerFn) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runner() {
      while (nextIndex < items.length) {
        const idx = nextIndex++;
        results[idx] = await workerFn(items[idx], idx);
      }
    }

    const workers = [];
    const count = Math.min(limit, items.length);
    for (let i = 0; i < count; i++) {
      workers.push(runner());
    }
    await Promise.all(workers);
    return results;
  }

  /**
   * Ensure local vote is reflected as at least 1 in the displayed count
   * when the remote counter is 0 or unreachable.
   */
  function mergeWithLocalFloor(id, up, down) {
    const localChoice = getLocalVote(id);
    const finalUp = localChoice === 'up' ? Math.max(1, up) : up;
    const finalDown = localChoice === 'down' ? Math.max(1, down) : down;
    return { up: finalUp, down: finalDown };
  }

  /**
   * Read vote counts for an array of idea IDs.
   * @param {string[]} ids
   * @returns {Promise<Record<string, {up: number, down: number}>>}
   */
  async function getCounts(ids) {
    const uniqueIds = Array.from(new Set(Array.isArray(ids) ? ids : []));
    const output = {};

    // Build flat list of counter read jobs (2 per idea) so concurrency limit
    // applies directly to HTTP requests (<= 6 requests in flight at a time).
    const jobs = [];
    uniqueIds.forEach((id) => {
      output[id] = { up: 0, down: 0 };
      jobs.push({ id, dir: 'up', key: `${id}-up` });
      jobs.push({ id, dir: 'down', key: `${id}-down` });
    });

    let successCount = 0;
    let errorCount = 0;

    await runWithConcurrency(jobs, CONCURRENCY_LIMIT, async (job) => {
      try {
        const val = await fetchCounter('get', job.key, true);
        output[job.id][job.dir] = val;
        successCount++;
      } catch (_) {
        errorCount++;
        const cached = countCache[job.id];
        output[job.id][job.dir] = cached ? cached[job.dir] : 0;
      }
    });

    uniqueIds.forEach((id) => {
      const merged = mergeWithLocalFloor(id, output[id].up, output[id].down);
      output[id] = merged;
      countCache[id] = { up: merged.up, down: merged.down };
    });

    const isOfflineNow = jobs.length > 0 && successCount === 0 && errorCount > 0;
    setOfflineStatus(isOfflineNow);

    Object.defineProperty(output, '_offline', {
      value: isOfflineNow,
      enumerable: false
    });

    return output;
  }

  /**
   * Cast a vote ('up' or 'down') for an idea ID.
   * @param {string} id
   * @param {'up'|'down'} direction
   * @returns {Promise<{up: number, down: number}>}
   */
  async function cast(id, direction) {
    const dir = direction === 'down' ? 'down' : 'up';
    const otherDir = dir === 'up' ? 'down' : 'up';

    // Record visitor choice locally right away
    saveLocalVote(id, dir);

    const prev = countCache[id] || { up: 0, down: 0 };
    let nextUp = prev.up;
    let nextDown = prev.down;
    let failed = false;

    try {
      const [hitVal, otherVal] = await Promise.all([
        fetchCounter('hit', `${id}-${dir}`, false),
        fetchCounter('get', `${id}-${otherDir}`, true, false, true).catch(() => prev[otherDir])
      ]);
      if (dir === 'up') {
        nextUp = hitVal;
        nextDown = otherVal;
      } else {
        nextDown = hitVal;
        nextUp = otherVal;
      }
      setOfflineStatus(false);
    } catch (_) {
      failed = true;
      setOfflineStatus(true);
      if (dir === 'up') {
        nextUp = prev.up + 1;
      } else {
        nextDown = prev.down + 1;
      }
    }

    const result = mergeWithLocalFloor(id, nextUp, nextDown);
    countCache[id] = { up: result.up, down: result.down };

    Object.defineProperty(result, '_offline', {
      value: failed,
      enumerable: false
    });

    return result;
  }

  /* Product hearts: one counter per product photo (<idea>-p<n>-heart), read only when someone looks at that
   * product, so a page load does not spend the counter service's rate limit on them. */
  const HEARTS_KEY = `${NAMESPACE}:hearts:v1`;
  function getLocalHearts() {
    try {
      const parsed = JSON.parse(global.localStorage.getItem(HEARTS_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  function hasHeart(key) {
    return !!getLocalHearts()[key];
  }
  async function getHeart(key) {
    return fetchCounter('get', key, true);
  }
  async function heart(key) {
    try {
      const all = getLocalHearts();
      all[key] = 1;
      global.localStorage.setItem(HEARTS_KEY, JSON.stringify(all));
    } catch (_) {
      // private mode: the heart still counts, it just is not remembered
    }
    return fetchCounter('hit', key, false);
  }

  /* One count per browser session, so votes can be read against how many people came. */
  async function countVisit() {
    try {
      if (global.sessionStorage.getItem(`${NAMESPACE}:visit`)) return null;
      global.sessionStorage.setItem(`${NAMESPACE}:visit`, '1');
    } catch (_) {
      // no sessionStorage: count anyway
    }
    return fetchCounter('hit', 'visits', false).catch(() => null);
  }

  /* "Did you enjoy this?" at the end of the swipe deck: feedback-yes / feedback-no. */
  function feedback(answer) {
    return fetchCounter('hit', answer === 'yes' ? 'feedback-yes' : 'feedback-no', false).catch(() => null);
  }

  const VoteAPI = {
    NAMESPACE,
    feedback,
    getCounts,
    cast,
    hasHeart,
    getHeart,
    heart,
    countVisit,
    getLocalVotes,
    getLocalVote,
    isOffline: () => apiOffline,
    onStatusChange
  };

  global.VoteAPI = VoteAPI;
  global.getCounts = getCounts;
  global.cast = cast;
})(typeof window !== 'undefined' ? window : globalThis);
