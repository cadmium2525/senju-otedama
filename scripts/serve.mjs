import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!filename.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (!(await stat(filename)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(filename));
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); }
});
server.listen(port, '0.0.0.0', () => console.log(`千手お手玉 Local: http://localhost:${port}`));
