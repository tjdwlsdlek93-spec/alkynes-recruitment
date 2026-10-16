// SQLite lives under config/, outside the files replaced by app updates.
function createDataHandler({ port, dataDir, validate }) {
  const fs = require('node:fs');
  const path = require('node:path');
  const databasePath = path.join(dataDir, 'recruitment.sqlite');
  let db;
  function open() {
    if (!db) {
      const { DatabaseSync } = require('node:sqlite');
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      db = new DatabaseSync(databasePath);
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history (revision INTEGER PRIMARY KEY, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS migration_backup (id INTEGER PRIMARY KEY CHECK(id=1), created_at TEXT NOT NULL, payload TEXT NOT NULL);`);
    }
    return db;
  }
  function valid(value) {
    try {
      return validate(value);
    } catch {
      return false;
    }
  }
  const handler = async (req, res, name) => {
    const send = (status, value, headers = {}) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Alkynes-App': 'portable-v1',
        ...headers,
      });
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };
    const hosts = ['127.0.0.1:' + port, 'localhost:' + port];
    if (
      !hosts.includes(req.headers.host) ||
      req.headers['x-alkynes-client'] !== '1' ||
      (req.headers.origin &&
        !hosts.map((h) => 'http://' + h).includes(req.headers.origin))
    )
      return send(403, {
        error: '앱의 같은 주소에서만 저장소를 사용할 수 있습니다.',
      });
    if (!['/__alkynes/data', '/__alkynes/data/migrate'].includes(name))
      return send(404, { error: '저장소 경로를 확인해 주세요.' });
    if (
      !['GET', 'POST'].includes(req.method) ||
      (name.endsWith('/migrate') && req.method !== 'POST')
    )
      return send(405, { error: '허용되지 않은 요청입니다.' });
    try {
      const sql = open();
      if (req.method === 'GET') {
        const metadata = sql
          .prepare('SELECT revision FROM workspace WHERE id=1')
          .get();
        if (
          metadata &&
          req.headers['if-none-match'] === '"' + metadata.revision + '"'
        )
          return send(304);
        const row = sql.prepare('SELECT * FROM workspace WHERE id=1').get();
        const revision = row?.revision || 0;
        const data = row ? JSON.parse(row.payload) : null;
        if (row && !valid(data))
          throw Error(
            '저장된 DB 데이터를 검증하지 못했습니다. 백업을 확인해 주세요.',
          );
        return send(
          200,
          {
            data,
            revision,
            updatedAt: row?.updated_at || '',
            databasePath,
            storage: 'sqlite',
          },
          { ETag: '"' + revision + '"' },
        );
      }
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 128 * 1024 * 1024)
          return send(413, {
            error: '한 번의 저장은 128MB 이하로 나눠 주세요.',
          });
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { error: '저장 형식이 올바르지 않습니다.' });
      }
      const migrating = name.endsWith('/migrate');
      if (
        !body ||
        !valid(body.data) ||
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0 ||
        (migrating &&
          (body.revision !== 0 || (body.legacy != null && !valid(body.legacy))))
      )
        return send(400, {
          error: '데이터 형식이나 연결 정보를 확인해 주세요.',
        });
      sql.exec('BEGIN IMMEDIATE');
      try {
        const previous = sql
          .prepare('SELECT * FROM workspace WHERE id=1')
          .get();
        if (
          (previous?.revision || 0) !== body.revision ||
          (migrating && previous)
        ) {
          sql.exec('ROLLBACK');
          return send(409, {
            error:
              '다른 창에서 먼저 저장했습니다. 최신 내용을 확인하고 다시 저장해 주세요.',
          });
        }
        const revision = body.revision + 1,
          updatedAt = new Date().toISOString();
        if (previous)
          sql
            .prepare('INSERT OR REPLACE INTO history VALUES (?, ?, ?)')
            .run(previous.revision, previous.updated_at, previous.payload);
        if (migrating && body.legacy)
          sql
            .prepare('INSERT OR IGNORE INTO migration_backup VALUES (1, ?, ?)')
            .run(updatedAt, JSON.stringify(body.legacy));
        sql
          .prepare(
            'INSERT INTO workspace VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, payload=excluded.payload',
          )
          .run(revision, updatedAt, JSON.stringify(body.data));
        sql.exec(
          'DELETE FROM history WHERE revision NOT IN (SELECT revision FROM history ORDER BY revision DESC LIMIT 5)',
        );
        sql.exec('COMMIT');
        return send(200, {
          revision,
          updatedAt,
          databasePath,
          storage: 'sqlite',
        });
      } catch (error) {
        try {
          sql.exec('ROLLBACK');
        } catch {}
        throw error;
      }
    } catch (error) {
      send(500, {
        error:
          '노트북 DB를 읽거나 저장하지 못했습니다. 기존 데이터는 유지됩니다. ' +
          (error.code || error.message || ''),
      });
    }
  };
  handler.close = () => {
    if (db) {
      db.close();
      db = undefined;
    }
  };
  return handler;
}
function startServer() {
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
  const handleUpdate = createUpdateHandler({
    root: __dirname,
    port,
    dataDir: process.env.ALKYNES_DATA_DIR || path.join(__dirname, 'config'),
    stop: () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    },
  });
  const handleData = createDataHandler({
    port,
    dataDir: process.env.ALKYNES_DATA_DIR || path.join(__dirname, 'config'),
    validate: (value) =>
      require(path.join(root, '_server/recruitment.cjs')).validateData(value),
  });
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
    if (name.startsWith('/__alkynes/data')) {
      void handleData(req, res, name);
      return;
    }
    if (name.startsWith('/_server/')) return reply(res, 403, 'Forbidden');
    if (name.startsWith('/__alkynes/update')) {
      void handleUpdate(req, res, name);
      return;
    }
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
      return res.end(
        JSON.stringify({
          app: 'alkynes-recruitment',
          ready: true,
          version,
          storage: 'sqlite',
        }),
      );
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
  server.on('close', () => handleData.close());
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
}
if (require.main === module) startServer();
module.exports = { createDataHandler };
