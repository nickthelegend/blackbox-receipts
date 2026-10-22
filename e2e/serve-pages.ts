// Serves the static Pages export in public/ under its base path, the way GitLab or GitHub Pages would.
// Build it first: pnpm build:pages -- --base-path /blackbox-receipts
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { PAGES, REPO } from './env.ts';

const root = join(REPO, 'public');
if (!existsSync(join(root, 'index.html'))) { console.error('serve-pages: public/index.html is missing. Run pnpm build:pages -- --base-path /blackbox-receipts first.'); process.exit(1); }
const html = readFileSync(join(root, 'index.html'), 'utf8');
if (!html.includes(`${PAGES.base}/_next/`)) { console.error(`serve-pages: public/ was not built for base path ${PAGES.base}. Rebuild with --base-path ${PAGES.base}.`); process.exit(1); }

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (!path.startsWith(`${PAGES.base}/`)) { response.writeHead(404).end('Not found'); return; }
  let file = normalize(join(root, path.slice(PAGES.base.length)));
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { response.writeHead(404, { 'Content-Type': 'text/html' }).end(existsSync(join(root, '404.html')) ? readFileSync(join(root, '404.html')) : 'Not found'); return; }
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
}).listen(PAGES.port, '127.0.0.1', () => console.log(`serve-pages: pid ${process.pid} on http://127.0.0.1:${PAGES.port}${PAGES.base}/`));
