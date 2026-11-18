// Minimal static server for the hand-off tests (no directory listing, no caching).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

/** Listens on both loopback addresses, so localhost (often ::1) and 127.0.0.1 are two origins on one server. */
export async function serve(root, port) {
  const handler = (req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, path.normalize(rel));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
  };
  const servers = [];
  for (const host of ['127.0.0.1', '::1']) {
    const server = http.createServer(handler);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    servers.push(server);
  }
  return { close: () => servers.forEach(s => s.close()) };
}
