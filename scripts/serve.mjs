// Minimal static server for local development. Vercel serves public/ directly, so
// this exists only so the wall can be opened without a deploy.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = 'public';
const PORT = Number(process.env.PORT ?? 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // normalize collapses any ../ before it can escape the served root.
  const rel = normalize(url === '/' ? '/index.html' : url).replace(/^(\.\.[/\\])+/, '');
  const path = join(ROOT, rel);

  // Vercel is configured with cleanUrls, so /notes serves notes.html. Mirror that
  // here or local and production disagree about every link.
  const candidates = extname(path) ? [path] : [path, `${path}.html`];

  for (const candidate of candidates) {
    try {
      const data = await readFile(candidate);
      res.writeHead(200, {
        'content-type': TYPES[extname(candidate)] ?? 'application/octet-stream',
      });
      return res.end(data);
    } catch {
      // try the next candidate
    }
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}).listen(PORT, () => console.log(`wall at http://localhost:${PORT}`));
