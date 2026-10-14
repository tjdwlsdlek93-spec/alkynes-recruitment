const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const [root, stage, previousPid, port, dataDir] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const names = ['site', 'server.cjs', 'excel-source.cjs', 'update.cjs', 'update-worker.cjs', 'setup.cjs', 'version.json'];
function health() {
  return new Promise(resolve => {
    const req = http.get('http://127.0.0.1:' + port + '/__alkynes/health', res => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.setTimeout(1000, () => req.destroy()); req.on('error', () => resolve(null));
  });
}
function start() {
  const child = spawn(process.execPath, [path.join(root, 'server.cjs')], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ALKYNES_PORT: port, ALKYNES_DATA_DIR: dataDir } });
  child.on('error', () => {}); child.unref(); return child;
}
(async () => {
  if (!root || !stage || !dataDir || !/^\d+$/.test(previousPid) || path.dirname(path.resolve(stage)) !== path.join(path.resolve(root), '.updates')) throw Error('업데이트 경로가 올바르지 않습니다.');
  // The old server must release its files before replacement.
  for (let i = 0; ; i++) {
    let alive = true; try { process.kill(Number(previousPid), 0); } catch (e) { if (e.code === 'ESRCH') alive = false; else throw e; }
    if (!alive) break;
    if (i >= 150) throw Error('기존 서버 종료를 확인하지 못했습니다.');
    await sleep(200);
  }
  const backup = path.join(root, '.updates', 'previous');
  await fs.rm(backup, { recursive: true, force: true }); await fs.mkdir(backup, { recursive: true });
  const replaced = [];
  let child;
  try {
    for (const name of names) {
      await fs.cp(path.join(root, name), path.join(backup, name), { recursive: true });
      replaced.push(name);
      await fs.rm(path.join(root, name), { recursive: true, force: true });
      await fs.cp(path.join(stage, name), path.join(root, name), { recursive: true });
    }
    const target = JSON.parse(await fs.readFile(path.join(stage, 'version.json'), 'utf8')).version;
    child = start();
    let ready = false;
    for (let i = 0; i < 40; i++) { await sleep(500); const state = await health(); if (state?.version === target) { ready = true; break; } }
    if (!ready) throw Error('새 버전 실행을 확인하지 못해 이전 버전으로 복원합니다.');
    await fs.writeFile(path.join(dataDir, 'update-result.json'), JSON.stringify({ ok: true, version: target, at: new Date().toISOString() }));
    await fs.rm(stage, { recursive: true, force: true });
  } catch (e) {
    if (child) { try { child.kill(); } catch {} await sleep(1000); }
    for (const name of replaced.reverse()) { await fs.rm(path.join(root, name), { recursive: true, force: true }); await fs.cp(path.join(backup, name), path.join(root, name), { recursive: true }); }
    start(); throw e;
  }
})().catch(async e => {
  try { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(path.join(dataDir, 'update-result.json'), JSON.stringify({ ok: false, error: e.message, at: new Date().toISOString() })); } catch {}
  process.exitCode = 1;
});
