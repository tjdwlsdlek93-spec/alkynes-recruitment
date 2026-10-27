const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createSourceHandler } = require('../portable/excel-source.cjs');
const { createUpdateHandler, safeName, newer } = require('../portable/update.cjs');
async function host(factory, run) {
  const server = http.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, handler = factory(port);
  server.on('request', (req, res) => void handler(req, res, new URL(req.url, 'http://localhost').pathname));
  const request = async (route, body, method = body ? 'POST' : 'GET', extra = {}) => {
    const response = await fetch('http://127.0.0.1:' + port + '/__alkynes/' + route, { method, headers: { 'X-Alkynes-Client': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 304 ? null : await response.json() };
  };
  try { await run(request); } finally { await new Promise(r => server.close(r)); }
}
test('Excel defaults connect automatically, transient file failures do not pause, manual pauses persist, old stopped config resumes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alkynes-sync-'));
  const file = path.join(dir, 'book.xlsx'), defaultFile = path.join(dir, 'default.json'), dataDir = path.join(dir, 'config');
  await fs.writeFile(defaultFile, JSON.stringify({ path: file }));
  try { await host(port => createSourceHandler({ port, dataDir, defaultFile }), async request => {
    assert.equal((await request('source')).body.enabled, true);
    assert.equal((await request('source/file')).status, 404);
    assert.equal((await request('source')).body.enabled, true);
    await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'excel-source.json'), JSON.stringify({ path: file, enabled: false }));
    assert.equal((await request('source')).body.enabled, true);
    assert.equal((await request('source', { enabled: false }, 'PATCH')).body.enabled, false);
    const paused = (await request('source')).body;
    assert.equal(paused.enabled, false); assert.ok(paused.pausedAt);
    assert.equal((await request('source', null, 'GET', { Origin: 'https://evil.test' })).status, 403);
  });
  // A new server instance retains an explicit pause across restarts.
  await host(port => createSourceHandler({ port, dataDir, defaultFile }), async request => assert.equal((await request('source')).body.enabled, false));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('updater checks GitHub releases, verifies checksum and stages only allowed app files, preserving configuration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alkynes-update-')), dataDir = path.join(root, 'config');
  await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'excel-source.json'), 'keep');
  await fs.writeFile(path.join(root, 'version.json'), JSON.stringify({ app: 'alkynes-recruitment', version: '2026.10.14.4' }));
  const current = '2026.10.14.5', app = 'alkynes-recruitment';
  const names = ['server.cjs', 'excel-source.cjs', 'update.cjs', 'update-worker.cjs', 'setup.cjs', 'version.json', 'site/dashboard.html', 'site/settings.html', 'site/_server/native-services.cjs'];
  let bundle = zlib.gzipSync(JSON.stringify({ app, version: current, files: names.map(name => ({ name, content: Buffer.from(name === 'version.json' ? JSON.stringify({ app, version: current }) : 'app content').toString('base64') })) }));
  const manifest = { app, version: current, sha256: crypto.createHash('sha256').update(bundle).digest('hex') };
  let corrupt = true, spawned = 0, stopped = 0;
  const base = 'https://github.com/company/app/releases/download/v5/';
  const fetcher = async url => {
    if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify({ assets: [{ name: 'alkynes-update.json', browser_download_url: base + 'alkynes-update.json' }, { name: 'alkynes-update.json.gz', browser_download_url: base + 'alkynes-update.json.gz' }] }));
    if (url.endsWith('.gz')) return new Response(corrupt ? Buffer.from('bad') : bundle);
    return new Response(JSON.stringify(manifest));
  };
  try { await host(port => createUpdateHandler({ root, dataDir, port, fetcher, stop: () => stopped++, launch: args => { spawned++; const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child; } }), async request => {
    assert.equal((await request('update')).body.currentVersion, '2026.10.14.4');
    assert.equal((await request('update/config', { repository: '../bad' })).status, 400);
    assert.equal((await request('update/config', { repository: 'company/app' })).status, 200);
    assert.equal((await request('update/check', {})).body.availableVersion, current);
    assert.equal((await request('update/apply', { version: current })).status, 400);
    assert.equal(spawned, 0);
    corrupt = false;
    assert.equal((await request('update/apply', { version: current })).body.restarting, true);
    assert.equal(spawned, 1);
    assert.equal(await fs.readFile(path.join(dataDir, 'excel-source.json'), 'utf8'), 'keep');
    const stages = await fs.readdir(path.join(root, '.updates')); assert.equal(stages.length, 1);
    assert.equal(await fs.readFile(path.join(root, '.updates', stages[0], 'site/dashboard.html'), 'utf8'), 'app content');
    assert.equal((await request('update', null, 'GET', { Origin: 'https://evil.test' })).status, 403);
  });
  await new Promise(r => setTimeout(r, 350)); assert.equal(stopped, 1);
  assert.equal(safeName('site/../../config/data'), false); assert.equal(safeName('config/excel-source.json'), false); assert.equal(safeName('runtime/node.exe'), false);
  assert.equal(newer('2026.10.14.5', '2026.10.14.4'), true); assert.equal(newer('2026.10.14.4', '2026.10.14.4'), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('update worker restarts the app and restores the previous version when replacement fails', { timeout: 40000 }, async () => {
  const { spawn } = require('node:child_process');
  const delay = ms => new Promise(r => setTimeout(r, ms));
  for (const fail of [false, true]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alkynes-worker-'));
    const dataDir = path.join(root, 'config'), stage = path.join(root, '.updates', 'incoming');
    const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
    const port = probe.address().port; await new Promise(r => probe.close(r));
    let old;
    const health = async () => { try { const response = await fetch('http://127.0.0.1:' + port + '/__alkynes/health', { signal: AbortSignal.timeout(500) }); return await response.json(); } catch { return null; } };
    try {
      await fs.cp(path.resolve(__dirname, '../portable'), root, { recursive: true });
      await fs.mkdir(path.join(root, 'site')); await fs.writeFile(path.join(root, 'site', 'dashboard.html'), 'old');
      await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'excel-source.json'), 'keep-this-config');
      const { DatabaseSync } = require('node:sqlite');
      const savedDb = new DatabaseSync(path.join(dataDir, 'recruitment.sqlite'));
      savedDb.exec("CREATE TABLE preserved(payload TEXT); INSERT INTO preserved VALUES ('private recruitment records');"); savedDb.close();
      await fs.mkdir(path.join(stage, 'site'), { recursive: true });
      for(const target of [path.join(root,'site','_server'),path.join(stage,'site','_server')]) await fs.cp(path.resolve(__dirname,'../public/_server'),target,{recursive:true});
      for (const name of ['server.cjs', 'excel-source.cjs', 'update.cjs', 'update-worker.cjs', 'setup.cjs', 'version.json']) await fs.copyFile(path.join(root, name), path.join(stage, name));
      await fs.writeFile(path.join(stage, 'version.json'), JSON.stringify({ app: 'alkynes-recruitment', version: '2026.10.14.5' }));
      if (fail) await fs.rm(path.join(stage, 'server.cjs'));
      old = spawn(process.execPath, [path.join(root, 'server.cjs')], { stdio: 'ignore', env: { ...process.env, ALKYNES_PORT: String(port), ALKYNES_DATA_DIR: dataDir } });
      for (let n = 0; !(await health()); n++) { if (n > 50) throw Error('Old server failed'); await delay(100); }
      const worker = spawn(process.execPath, [path.join(root, 'update-worker.cjs'), root, stage, String(old.pid), String(port), dataDir], { stdio: 'ignore' });
      const finished = new Promise(resolve => worker.once('exit', resolve));
      old.kill();
      assert.equal(await finished, fail ? 1 : 0);
      let running;
      for (let n = 0; !(running = await health()); n++) { if (n > 50) throw Error('Restart failed'); await delay(100); }
      assert.equal(running.version, fail ? require('../portable/version.json').version : '2026.10.14.5');
      assert.equal(await fs.readFile(path.join(dataDir, 'excel-source.json'), 'utf8'), 'keep-this-config');
      const restoredDb = new DatabaseSync(path.join(dataDir, 'recruitment.sqlite'));
      assert.equal(restoredDb.prepare('SELECT payload FROM preserved').get().payload, 'private recruitment records'); restoredDb.close();
      const result = JSON.parse(await fs.readFile(path.join(dataDir, 'update-result.json'), 'utf8'));
      assert.equal(result.ok, !fail);
    } finally {
      old?.kill();
      await fs.writeFile(path.join(root, '.stop-request'), 'stop');
      for (let i = 0; i < 30 && await health(); i++) await delay(100);
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});
