// Speaks a small subset of UCI so the panel can treat the backup engine like Stockfish.
import { searchPosition } from '../lib/basic-engine.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let fen = START;
let multipv = 1;

self.onmessage = (event) => {
  const cmd = String(event.data || '').trim();

  if (cmd === 'uci') {
    self.postMessage('id name Basic engine (backup)');
    self.postMessage('uciok');
  } else if (cmd === 'isready') {
    self.postMessage('readyok');
  } else if (cmd.startsWith('setoption name MultiPV value')) {
    multipv = Math.max(1, parseInt(cmd.split(' ').pop(), 10) || 1);
  } else if (cmd.startsWith('position fen ')) {
    fen = cmd.slice('position fen '.length).split(' moves ')[0];
  } else if (cmd.startsWith('position startpos')) {
    fen = START;
  } else if (cmd.startsWith('go')) {
    const depthMatch = /depth (\d+)/.exec(cmd);
    // the backup engine is slow, so cap it: quick searches get depth 2, everything else depth 3
    const asked = depthMatch ? parseInt(depthMatch[1], 10) : 12;
    const depth = asked <= 6 ? 2 : 3;
    const lines = searchPosition(fen, { depth, multipv });

    lines.forEach((l) => {
      const score = l.mate !== null ? `mate ${l.mate}` : `cp ${l.scoreCp}`;

      self.postMessage(`info depth ${l.depth} multipv ${l.multipv} score ${score} pv ${l.pv.join(' ')}`);
    });

    self.postMessage(`bestmove ${lines[0]?.pv?.[0] || '(none)'}`);
  }
};
