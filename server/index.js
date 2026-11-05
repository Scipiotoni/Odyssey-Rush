// HTTP static server (gzip + caching) + WebSocket game server with persistent storage.
import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { createStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = +process.env.PORT || 3000;
const SEED = +process.env.SEED || 1337;
const DATA = process.env.DATA_FILE || path.join(ROOT, 'data', 'world.json');
const TICK_MS = 66; // ~15 Hz simulation + snapshots

const MOUNTS = [
  ['/lib/three/addons/', path.join(ROOT, 'node_modules/three/examples/jsm/'), true],
  ['/lib/three/', path.join(ROOT, 'node_modules/three/build/'), true],
  ['/shared/', path.join(ROOT, 'shared/'), false],
  ['/', path.join(ROOT, 'public/'), false],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);

// In-memory cache of static files: {mtime, raw, gz, etag}
const fileCache = new Map();
function getFile(file) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('not a file');
  let e = fileCache.get(file);
  if (!e || e.mtime !== st.mtimeMs) {
    const raw = fs.readFileSync(file);
    const ext = path.extname(file);
    e = { mtime: st.mtimeMs, raw, gz: COMPRESSIBLE.has(ext) ? zlib.gzipSync(raw, { level: 9 }) : null, etag: '"' + crypto.createHash('sha1').update(raw).digest('base64').slice(0, 20) + '"', type: TYPES[ext] || 'application/octet-stream' };
    fileCache.set(file, e);
  }
  return e;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('ok'); }
  for (const [prefix, dir, immutable] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    let e;
    try { e = getFile(file); } catch { res.writeHead(404); return res.end('not found'); }
    const headers = { 'Content-Type': e.type, ETag: e.etag, 'Cache-Control': immutable ? 'public, max-age=604800, immutable' : 'no-cache', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); return res.end(); }
    const gzipOk = e.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gzipOk) headers['Content-Encoding'] = 'gzip';
    const body = gzipOk ? e.gz : e.raw;
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    return res.end(body);
  }
  res.writeHead(404); res.end('not found');
});

const store = await createStore({ databaseUrl: process.env.DATABASE_URL, dataFile: DATA });
let saved = null;
try { saved = await store.load(); } catch (e) { console.error('[store] load failed:', e.message); }
console.log(`[store] using ${store.kind} storage${saved ? '' : ' (new world)'}`);
const game = new Game({ seed: SEED, saved });

let saving = null;
async function save() {
  if (saving) return saving;
  saving = (async () => {
    try { const n = await store.save(game.serialize()); console.log(`[store] saved world (${(n / 1024).toFixed(0)} KB)`); }
    catch (e) { console.error('[store] save failed:', e.message); }
    finally { saving = null; }
  })();
  return saving;
}
game.onSave = save;

const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 64 * 1024,
  perMessageDeflate: { zlibDeflateOptions: { level: 3 }, threshold: 2048, concurrencyLimit: 4 },
});
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  game.connect(ws);
});
// drop dead connections so sleepers appear promptly
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 20000);

setInterval(() => { try { game.tick(); } catch (e) { console.error('tick error', e); } }, TICK_MS);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[server] shutting down, saving world...');
  await save();
  await store.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`[server] Odyssey Rush running on http://localhost:${PORT}  (seed ${SEED})`));
