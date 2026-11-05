// Copies the single-threaded "lite" Stockfish build from node_modules into engine/ and records its name.
import { copyFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'node_modules', 'stockfish', 'bin');
const out = join(root, 'engine');

if (!existsSync(bin)) {
  console.error('[setup] node_modules/stockfish/bin not found. Run "npm install" in this folder first.');
  process.exit(1);
}

mkdirSync(out, { recursive: true });

const files = readdirSync(bin).filter((f) => /lite-single/i.test(f) && /\.(js|wasm)$/i.test(f));
const loader = files.filter((f) => f.endsWith('.js')).sort((a, b) => a.length - b.length)[0];

if (!loader) {
  console.error('[setup] No lite-single Stockfish build found in', bin, '\nFiles there:', readdirSync(bin).join(', '));
  process.exit(1);
}

files.forEach((f) => copyFileSync(join(bin, f), join(out, f)));
writeFileSync(join(out, 'engine.json'), `${JSON.stringify({ file: loader }, null, 2)}\n`);

console.log(`[setup] Stockfish ready: engine/${loader} (+${files.length - 1} file${files.length === 2 ? '' : 's'})`);
