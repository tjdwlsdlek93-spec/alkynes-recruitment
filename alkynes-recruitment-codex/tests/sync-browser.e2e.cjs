const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
test('browser automatically imports on launch, retries file failure and retains user pause across restart', { skip: !process.env.KPI_TEST_FILE, timeout: 60000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alkynes-sync-ui-'));
  const file = path.join(dir, 'live.xlsx'), dataDir = path.join(dir, 'config');
  await fs.mkdir(dataDir); await fs.writeFile(path.join(dataDir, 'excel-source.json'), JSON.stringify({ path: file, enabled: true }));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const server = spawn(process.execPath, ['/workspace/.portable/windows/server.cjs'], { env: { ...process.env, ALKYNES_PORT: String(port), ALKYNES_DATA_DIR: dataDir }, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(20000);
    // Speed up the existing 30-second polling interval without changing production code.
    await page.addInitScript(() => { const interval = window.setInterval.bind(window); window.setInterval = (fn, ms, ...args) => interval(fn, ms === 30000 ? 500 : ms, ...args); });
    for (let i = 0; ; i++) { try { await fetch('http://127.0.0.1:' + port + '/__alkynes/health'); break; } catch { if (i > 50) throw Error('Server not ready'); await new Promise(r => setTimeout(r, 100)); } }
    await page.goto('http://127.0.0.1:' + port + '/requests');
    await page.getByText(/자동 연결 유지, 30초 후 재시도/).waitFor();
    await fs.copyFile(process.env.KPI_TEST_FILE, file);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('alkynes.recruitment.v1') || '{}').candidates?.length === 12);
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'excel-source.json'), 'utf8')).enabled, true);
    await page.getByRole('button', { name: '자동 연결 중지', exact: true }).click();
    await page.getByText('자동 연결 중지 — 저장된 앱 데이터는 유지합니다.', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('사용자가 자동 연결을 일시 중지했습니다.', { exact: true }).waitFor();
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'excel-source.json'), 'utf8')).enabled, false);
  } finally { await browser.close(); server.kill(); await new Promise(r => server.once('exit', r)); await fs.rm(dir, { recursive: true, force: true }); }
});
