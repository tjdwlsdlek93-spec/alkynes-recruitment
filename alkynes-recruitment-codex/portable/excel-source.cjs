const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_FILE = 8 * 1024 * 1024;
function error(status, message) {
  return Object.assign(new Error(message), { status });
}
function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let bytes = 0,
    parts = [];
  for await (const part of req) {
    bytes += part.length;
    if (bytes > 8192) throw error(413, '설정 내용이 너무 큽니다.');
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw error(400, '설정 형식이 올바르지 않습니다.');
  }
}
async function workbook(file) {
  if (
    typeof file !== 'string' ||
    file.length > 4096 ||
    !path.isAbsolute(file) ||
    path.extname(file).toLowerCase() !== '.xlsx' ||
    path.basename(file).startsWith('~$')
  )
    throw error(
      400,
      '전체 .xlsx 파일 경로를 입력해 주세요. Excel 임시 잠금 파일(~$)은 선택할 수 없습니다.',
    );
  try {
    const before = await fs.stat(file);
    if (!before.isFile()) throw error(400, '선택한 경로는 파일이 아닙니다.');
    if (before.size > MAX_FILE)
      throw error(413, '8MB 이하 Excel 파일만 연결할 수 있습니다.');
    const content = await fs.readFile(file);
    const after = await fs.stat(file);
    if (content.length > MAX_FILE)
      throw error(413, '8MB 이하 Excel 파일만 연결할 수 있습니다.');
    if (
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size ||
      content.length !== after.size
    )
      throw error(
        409,
        '파일이 저장 중입니다. 저장이 끝나면 자동으로 다시 확인합니다.',
      );
    if (content.length < 4 || content[0] !== 0x50 || content[1] !== 0x4b)
      throw error(
        422,
        '완성된 .xlsx 파일이 아닙니다. Excel 저장 또는 동기화 완료를 확인해 주세요.',
      );
    return {
      content,
      revision: crypto.createHash('sha256').update(content).digest('hex'),
      modifiedAt: after.mtime.toISOString(),
      name: path.basename(file),
    };
  } catch (e) {
    if (e.status) throw e;
    if (e.code === 'ENOENT')
      throw error(
        404,
        '연결한 파일을 찾을 수 없습니다. 네이버웍스 동기화와 파일 경로를 확인해 주세요.',
      );
    if (['EACCES', 'EPERM', 'EBUSY'].includes(e.code))
      throw error(
        423,
        '파일을 읽을 수 없습니다. Excel 저장 상태와 네이버웍스 로그인·파일 접근 권한을 확인해 주세요.',
      );
    throw error(
      503,
      '파일을 읽는 중 문제가 발생했습니다. 다음 확인 때 다시 시도합니다.',
    );
  }
}
function binary(res, source) {
  res.writeHead(200, {
    'Content-Type':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Length': source.content.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Alkynes-Revision': source.revision,
    ETag: '"' + source.revision + '"',
  });
  res.end(source.content);
}
function createSourceHandler({ port, dataDir, defaultFile }) {
  const configFile = path.join(dataDir, 'excel-source.json');
  async function readConfig() {
    try {
      const raw = JSON.parse(await fs.readFile(configFile, 'utf8'));
      if (typeof raw.path !== 'string' || typeof raw.enabled !== 'boolean')
        throw Error();
      // Older packages saved a suggested path with enabled=false even before any pause.
      if (raw.path && !raw.enabled && !raw.pausedAt && raw.autoConnectVersion !== 1) {
        const resumed = { ...raw, enabled: true, autoConnectVersion: 1 };
        await saveConfig(resumed);
        return resumed;
      }
      return raw;
    } catch (e) {
      if (e.code === 'ENOENT') {
        let suggested = '';
        try {
          const value = JSON.parse(await fs.readFile(defaultFile, 'utf8'));
          if (typeof value.path === 'string') suggested = value.path;
        } catch {}
        return { path: suggested, enabled: !!suggested, autoConnectVersion: 1 };
      }
      throw error(
        500,
        '연결 설정 파일을 읽지 못했습니다. 파일 경로를 다시 연결해 주세요.',
      );
    }
  }
  async function saveConfig(config) {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = configFile + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(tmp, JSON.stringify(config), { mode: 0o600 });
      await fs.rename(tmp, configFile);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }
  return async function handle(req, res, pathname) {
    try {
      const hosts = ['127.0.0.1:' + port, 'localhost:' + port];
      if (
        !hosts.includes(req.headers.host) ||
        req.headers['x-alkynes-client'] !== '1' ||
        (req.headers.origin &&
          !hosts.map((h) => 'http://' + h).includes(req.headers.origin))
      )
        throw error(
          403,
          '앱의 같은 브라우저 주소에서만 연결 설정에 접근할 수 있습니다.',
        );
      if (req.method === 'GET' && pathname === '/__alkynes/source') {
        return json(res, 200, await readConfig());
      }
      if (
        req.method === 'POST' &&
        ['/__alkynes/source', '/__alkynes/source/preview'].includes(pathname)
      ) {
        if (
          !String(req.headers['content-type'] || '').startsWith(
            'application/json',
          )
        )
          throw error(415, 'JSON 형식으로 요청해 주세요.');
        const config = await body(req),
          source = await workbook(config.path);
        if (pathname.endsWith('/preview')) return binary(res, source);
        if (config.expectedRevision !== source.revision)
          throw error(
            409,
            '미리보기 이후 파일이 변경되었습니다. 연결 미리보기를 다시 확인해 주세요.',
          );
        await saveConfig({ path: path.normalize(config.path), enabled: true, autoConnectVersion: 1 });
        return json(res, 200, {
          path: path.normalize(config.path),
          enabled: true,
          revision: source.revision,
        });
      }
      if (req.method === 'PATCH' && pathname === '/__alkynes/source') {
        if (
          !String(req.headers['content-type'] || '').startsWith(
            'application/json',
          )
        )
          throw error(415, 'JSON 형식으로 요청해 주세요.');
        const update = await body(req);
        // Pausing does not need the remote/synced file to be available.
        if (update.enabled !== false)
          throw error(400, '연결을 다시 켜려면 미리보기를 확인해 주세요.');
        const current = await readConfig();
        await saveConfig({ ...current, enabled: false, pausedAt: new Date().toISOString(), autoConnectVersion: 1 });
        return json(res, 200, { ...current, enabled: false });
      }
      if (req.method === 'GET' && pathname === '/__alkynes/source/file') {
        const config = await readConfig();
        if (!config.enabled || !config.path)
          throw error(409, '자동 연결이 일시 중지되어 있습니다.');
        const source = await workbook(config.path);
        if (req.headers['if-none-match'] === '"' + source.revision + '"') {
          res.writeHead(304, { 'Cache-Control': 'no-store' });
          return res.end();
        }
        return binary(res, source);
      }
      throw error(404, '지원하지 않는 연결 요청입니다.');
    } catch (e) {
      if (!res.headersSent)
        json(res, e.status || 500, {
          error: e.status
            ? e.message
            : '연결 설정을 저장하지 못했습니다. 폴더 쓰기 권한을 확인해 주세요.',
        });
      else res.destroy();
    }
  };
}
module.exports = { createSourceHandler };
