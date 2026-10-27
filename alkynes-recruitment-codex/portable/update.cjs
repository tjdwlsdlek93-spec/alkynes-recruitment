const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const APP = 'alkynes-recruitment';
const MAX = 24 * 1024 * 1024;
const files = new Set(['server.cjs', 'excel-source.cjs', 'update.cjs', 'update-worker.cjs', 'setup.cjs', 'version.json']);
function safeName(name) {
  return typeof name === 'string' && !name.includes('\\') && !name.includes('\0') && !name.split('/').some(s => !s || s === '.' || s === '..') && (files.has(name) || name.startsWith('site/'));
}
function version(v) {
  if (typeof v !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/.test(v)) throw Error('업데이트 버전 형식이 올바르지 않습니다.');
  return v.split('.').map(Number);
}
function newer(a, b) {
  const x = version(a), y = version(b);
  for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
async function bounded(response, max = MAX) {
  if (!response.ok) throw Error(response.status === 404 ? '공개 저장소 또는 최신 릴리스를 찾지 못했습니다. 저장소 이름과 배포 상태를 확인해 주세요.' : '업데이트 서버 응답 오류 (' + response.status + ')');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; if (length > max) throw Error('업데이트 파일이 허용 크기를 초과했습니다.'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
async function get(url, max, fetcher, redirects = 0) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname)) throw Error('허용된 GitHub 배포 주소가 아닙니다.');
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'Alkynes-Recruitment-Updater', Accept: 'application/vnd.github+json' } });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= 5) throw Error('업데이트 주소 이동이 너무 많습니다.');
    return get(new URL(response.headers.get('location'), url).href, max, fetcher, redirects + 1);
  }
  return bounded(response, max);
}
async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try { await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(tmp, file); } finally { await fs.rm(tmp, { force: true }); }
}
function createUpdateHandler({ root, dataDir, port, stop, fetcher = fetch, launch }) {
  let checking = false, applying = false, available = null;
  const configFile = path.join(dataDir, 'updates.json');
  async function config() { try { return JSON.parse(await fs.readFile(configFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return { repository: '' }; throw Error('업데이트 설정 파일을 읽지 못했습니다.'); } }
  async function result() { try { return JSON.parse(await fs.readFile(path.join(dataDir, 'update-result.json'), 'utf8')); } catch { return null; } }
  async function installed() { return JSON.parse(await fs.readFile(path.join(root, 'version.json'), 'utf8')); }
  async function check() {
    const { repository } = await config();
    if (!repository) throw Error('GitHub 릴리스 저장소를 먼저 지정해 주세요.');
    const release = JSON.parse((await get('https://api.github.com/repos/' + repository + '/releases/latest', 1024 * 1024, fetcher)).toString());
    const asset = release.assets?.find(a => a.name === 'alkynes-update.json');
    if (!asset) throw Error('이 릴리스에 앱 업데이트 파일이 없습니다. alkynes-update.json 배포가 필요합니다.');
    const manifest = JSON.parse((await get(asset.browser_download_url, 65536, fetcher)).toString());
    version(manifest.version);
    const payload = release.assets.find(a => a.name === 'alkynes-update.json.gz');
    if (manifest.app !== APP || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !payload) throw Error('업데이트 명세 또는 배포 파일이 올바르지 않습니다.');
    const current = await installed();
    available = newer(manifest.version, current.version) ? { ...manifest, url: payload.browser_download_url, repository } : null;
    return { currentVersion: current.version, availableVersion: available?.version || '', notes: typeof manifest.notes === 'string' ? manifest.notes.slice(0, 4000) : '', repository };
  }
  async function stage(info) {
    const bytes = await get(info.url, MAX, fetcher);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== info.sha256) throw Error('다운로드 검증에 실패했습니다. 기존 앱은 변경하지 않았습니다.');
    const payload = JSON.parse(zlib.gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString());
    if (payload.app !== APP || payload.version !== info.version || !Array.isArray(payload.files) || payload.files.length > 2000) throw Error('업데이트 내용이 올바르지 않습니다.');
    const seen = new Set(); let size = 0;
    for (const file of payload.files) {
      if (!safeName(file.name) || seen.has(file.name) || typeof file.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)) throw Error('허용되지 않은 업데이트 파일입니다.');
      seen.add(file.name); size += Buffer.byteLength(file.content, 'base64');
      if (size > 40 * 1024 * 1024) throw Error('업데이트 내용이 너무 큽니다.');
    }
    for (const name of [...files, 'site/dashboard.html', 'site/settings.html', 'site/_server/native-services.cjs']) if (!seen.has(name)) throw Error('필수 업데이트 파일이 누락되었습니다: ' + name);
    const declared = JSON.parse(Buffer.from(payload.files.find(f => f.name === 'version.json').content, 'base64'));
    if (declared.app !== APP || declared.version !== info.version) throw Error('앱 버전이 일치하지 않습니다.');
    const dir = path.join(root, '.updates', crypto.randomUUID());
    await fs.mkdir(dir, { recursive: true });
    for (const file of payload.files) { const dest = path.join(dir, file.name); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, Buffer.from(file.content, 'base64')); }
    return dir;
  }
  return async (req, res, name) => {
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const hosts = ['127.0.0.1:' + port, 'localhost:' + port];
      if (!hosts.includes(req.headers.host) || req.headers['x-alkynes-client'] !== '1' || (req.headers.origin && !hosts.map(h => 'http://' + h).includes(req.headers.origin))) return send(403, { error: '앱의 같은 주소에서만 업데이트할 수 있습니다.' });
      if (req.method === 'GET' && name === '/__alkynes/update') return send(200, { currentVersion: (await installed()).version, ...(await config()), availableVersion: available?.version || '', result: await result() });
      if (req.method !== 'POST' || !String(req.headers['content-type']).startsWith('application/json')) return send(405, { error: '지원하지 않는 요청입니다.' });
      let input = ''; for await (const part of req) { input += part; if (Buffer.byteLength(input) > 8192) throw Error('요청 내용이 너무 큽니다.'); }
      const body = JSON.parse(input || '{}');
      if (checking || applying) return send(409, { error: '업데이트 작업이 진행 중입니다.' });
      if (name === '/__alkynes/update/config') {
        if (typeof body.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(body.repository) || body.repository.endsWith('/..') || body.repository.endsWith('/.')) throw Error('GitHub 저장소는 소유자/저장소 형식으로 입력해 주세요.');
        await atomic(configFile, { repository: body.repository }); available = null;
        return send(200, { repository: body.repository });
      }
      if (name === '/__alkynes/update/check') {
        checking = true; try { return send(200, await check()); } finally { checking = false; }
      }
      if (name === '/__alkynes/update/apply') {
        applying = true;
        try {
          const result = await check();
          if (!available || body.version !== available.version) throw Error('업데이트 버전이 변경되었습니다. 다시 확인해 주세요.');
          if (process.platform !== 'win32' && !launch) throw Error('앱 업데이트 적용은 Windows 설치 앱에서 사용할 수 있습니다.');
          const dir = await stage(available);
          // Run the currently trusted worker, not code from the incoming bundle.
          const args = [path.join(root, 'update-worker.cjs'), root, dir, String(process.pid), String(port), dataDir];
          const child = launch ? launch(args) : spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true });
          await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
          child.unref();
          send(200, { restarting: true, version: result.availableVersion });
          setTimeout(stop, 300);
          return;
        } catch (e) { applying = false; throw e; }
      }
      send(404, { error: '지원하지 않는 요청입니다.' });
    } catch (e) { if (!res.headersSent) send(400, { error: e.message || '업데이트에 실패했습니다.' }); }
  };
}
module.exports = { createUpdateHandler, safeName, newer };
