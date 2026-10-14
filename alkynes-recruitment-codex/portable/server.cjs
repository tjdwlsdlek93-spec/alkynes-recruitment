const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, 'site');
const port = Number(process.env.ALKYNES_PORT || 8790);
const { createSourceHandler } = require('./excel-source.cjs');
const handleSource = createSourceHandler({
  port,
  dataDir: process.env.ALKYNES_DATA_DIR || path.join(__dirname, 'config'),
  defaultFile: path.join(__dirname, 'source-default.json'),
});
const { createUpdateHandler } = require('./update.cjs');
const version = require('./version.json').version;
const handleUpdate = createUpdateHandler({ root: __dirname, port, dataDir: process.env.ALKYNES_DATA_DIR || path.join(__dirname, 'config'), stop: () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); } });
const stopFile = path.join(__dirname, '.stop-request');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
function reply(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Alkynes-App': 'portable-v1',
  });
  res.end(body);
}
const server = http.createServer((req, res) => {
  let name;
  try {
    name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return reply(res, 400, 'Bad request');
  }
  if (name.startsWith('/__alkynes/update')) { void handleUpdate(req, res, name); return; }
  if (name.startsWith('/__alkynes/source')) {
    void handleSource(req, res, name);
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method))
    return reply(res, 405, 'Method not allowed');
  if (name === '/__alkynes/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Alkynes-App': 'portable-v1',
    });
    return res.end(JSON.stringify({ app: 'alkynes-recruitment', ready: true, version }));
  }
  if (name === '/') {
    res.writeHead(302, { Location: '/dashboard' });
    return res.end();
  }
  let file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep) || name.includes('\0'))
    return reply(res, 403, 'Forbidden');
  if (!path.extname(file)) file += req.headers.rsc === '1' ? '.txt' : '.html';
  try {
    if (!fs.realpathSync(file).startsWith(root + path.sep))
      return reply(res, 403, 'Forbidden');
    const stat = fs.statSync(file);
    if (!stat.isFile()) return reply(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'X-Alkynes-App': 'portable-v1',
      'Cache-Control': name.startsWith('/_next/static/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  } catch {
    reply(res, 404, 'Not found');
  }
});
server.on('error', (error) => {
  console.error('채용관리 서버를 시작하지 못했습니다:', error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log('알킨스 채용관리: http://127.0.0.1:' + port);
  if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
  fs.watchFile(stopFile, { interval: 500 }, () => {
    if (!fs.existsSync(stopFile)) return;
    fs.unlinkSync(stopFile);
    fs.unwatchFile(stopFile);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
});
