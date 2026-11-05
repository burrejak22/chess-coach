// Talks UCI to an engine running in a Web Worker: Stockfish if it's installed, otherwise the backup engine.

/** Parses one UCI `info` line into { depth, multipv, scoreCp, mate, pv }, or null. */
export const parseInfo = (line) => {
  if (!line.startsWith('info ') || !line.includes(' pv ') || / (lowerbound|upperbound)/.test(line)) {
    return null;
  }

  const num = (key) => {
    const m = new RegExp(` ${key} (-?\\d+)`).exec(line);

    return m ? parseInt(m[1], 10) : null;
  };

  const scoreMatch = / score (cp|mate) (-?\d+)/.exec(line);
  const pv = line.split(' pv ')[1].trim().split(/\s+/);

  if (!scoreMatch || !pv.length) {
    return null;
  }

  return {
    depth: num('depth'),
    multipv: num('multipv') || 1,
    scoreCp: scoreMatch[1] === 'cp' ? parseInt(scoreMatch[2], 10) : null,
    mate: scoreMatch[1] === 'mate' ? parseInt(scoreMatch[2], 10) : null,
    pv,
  };
};

export class Engine {
  constructor() {
    this.worker = null;
    this.name = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.generation = 0;
  }

  /** Starts Stockfish (from engine/engine.json, written by the setup step), falling back to the backup engine. */
  async start() {
    if (this.worker) {
      return this.name;
    }

    let file = null;

    try {
      const res = await fetch(chrome.runtime.getURL('engine/engine.json'));

      if (res.ok) {
        ({ file } = await res.json());
      }
    } catch {
      file = null;
    }

    if (file) {
      try {
        await this.boot(new Worker(chrome.runtime.getURL(`engine/${file}`)));
        this.name = this.name || 'Stockfish';

        return this.name;
      } catch (error) {
        console.warn('[Chess Coach] Stockfish failed to start, using the backup engine:', error);
        this.worker?.terminate();
        this.worker = null;
      }
    }

    await this.boot(new Worker(chrome.runtime.getURL('engine/basic-worker.js'), { type: 'module' }));
    this.name = 'Basic engine (backup; run the setup for Stockfish)';

    return this.name;
  }

  boot(worker) {
    this.worker = worker;
    worker.onmessage = (e) => {
      const line = String(e.data ?? '');

      if (line.startsWith('id name ')) {
        this.name = line.slice('id name '.length);
      }

      this.listeners.forEach((fn) => fn(line));
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('engine did not answer uci')), 15000);
      const onLine = (line) => {
        if (line === 'uciok') {
          clearTimeout(timer);
          this.listeners.delete(onLine);
          resolve();
        }
      };

      worker.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };

      this.listeners.add(onLine);
      worker.postMessage('uci');
    });
  }

  send(cmd) {
    this.worker?.postMessage(cmd);
  }

  /**
   * Analyzes `fen`; resolves with the lines (best first) at the deepest completed depth.
   * A newer call cancels an older one, which then resolves with `null`.
   *
   * @param {string} fen
   * @param {{ multipv?: number, depth?: number, movetime?: number, onUpdate?: Function }} [options]
   */
  analyze(fen, options = {}) {
    const generation = ++this.generation;

    if (this.searching) {
      this.send('stop');
    }

    const run = () => new Promise((resolve) => {
      if (generation !== this.generation) {
        resolve(null);

        return;
      }

      const { multipv = 1, depth = 14, movetime = null, onUpdate = null } = options;
      const lines = new Map();
      let lastDepth = 0;

      const onLine = (line) => {
        const info = parseInfo(line);

        if (info) {
          if (info.depth >= lastDepth || !lines.has(info.multipv)) {
            lines.set(info.multipv, info);
            lastDepth = Math.max(lastDepth, info.depth || 0);
          }

          if (onUpdate && info.multipv === 1 && generation === this.generation) {
            onUpdate([...lines.values()].sort((a, b) => a.multipv - b.multipv));
          }

          return;
        }

        if (line.startsWith('bestmove')) {
          this.listeners.delete(onLine);
          this.searching = false;

          const result = [...lines.values()]
            .filter((l) => l.pv?.length)
            .sort((a, b) => a.multipv - b.multipv);

          resolve(generation === this.generation ? result : null);
        }
      };

      this.listeners.add(onLine);
      this.searching = true;
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
    });

    // one search at a time; each waits for the previous one to report bestmove
    this.queue = this.queue.then(run, run);

    return this.queue;
  }
}
