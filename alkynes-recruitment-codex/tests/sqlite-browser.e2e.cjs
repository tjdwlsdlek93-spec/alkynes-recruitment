const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
test(
  'browser migrates to SQLite, saves Excel and edits durably, survives storage clearing/restart, and reports failed disk writes',
  { timeout: 90000 },
  async () => {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'alkynes-browser-db-'),
      ),
      config = path.join(root, 'config');
    const probe = http.createServer();
    await new Promise((r) => probe.listen(0, '127.0.0.1', r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const base = 'http://127.0.0.1:' + port;
    let child, browser;
    const health = async () => {
      try {
        return (
          await fetch(base + '/__alkynes/health', {
            signal: AbortSignal.timeout(300),
          })
        ).ok;
      } catch {
        return false;
      }
    };
    async function start() {
      child = spawn(process.execPath, [path.join(root, 'server.cjs')], {
        env: {
          ...process.env,
          ALKYNES_PORT: String(port),
          ALKYNES_DATA_DIR: config,
        },
        stdio: 'ignore',
      });
      for (let n = 0; !(await health()); n++) {
        if (n > 50) throw Error('SQLite server failed to start');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    async function stop() {
      if (child && child.exitCode === null) {
        const done = new Promise((r) => child.once('exit', r));
        child.kill();
        await done;
      }
    }
    const api = async (body) => {
      const res = await fetch(base + '/__alkynes/data', {
        method: body ? 'POST' : 'GET',
        headers: {
          'X-Alkynes-Client': '1',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(res.status, 200);
      return res.json();
    };
    const stamp = {
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    };
    const legacy = {
      version: 1,
      requisitions: [
        {
          ...stamp,
          id: 'legacy-job',
          code: 'HR-2026-001',
          department: '검증부서',
          requester: '',
          role: '기존 브라우저 채용',
          headcount: 1,
          reason: '',
          duties: '',
          requirements: '',
          preferred: '',
          targetJoin: '',
          status: '진행중',
        },
      ],
      candidates: [],
      interviews: [],
      evaluations: [],
      requests: [],
      activity: [],
    };
    try {
      await fs.cp(path.resolve(__dirname, '../portable'), root, {
        recursive: true,
      });
      await fs.cp(path.resolve(__dirname, '../out'), path.join(root, 'site'), {
        recursive: true,
      });
      await fs.mkdir(config);
      const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('채용프로세스 적시성');
      sheet.getRow(5).values = [
        '채용건명',
        '의뢰 부서',
        '의뢰자',
        '지원자명',
        '요청 구분',
        '요청일',
        '처리완료일',
        '처리기한',
        '기한 판정',
        '인적성 검사 일시',
        '면접 일시',
        '현재 선발 단계',
        '최종 결과',
        '입사예정일',
        '실제 입사일',
        '비고',
      ];
      sheet.getRow(6).values = [
        'DB검증공고',
        '검증부서',
        '담당자',
        'DB검증지원자',
        '인적성 검사 요청',
        new Date('2026-10-14T00:00:00Z'),
        null,
        null,
        null,
        null,
        null,
        '검토중',
        '미확정',
      ];
      const file = path.join(root, 'test.xlsx');
      await book.xlsx.writeFile(file);
      await fs.writeFile(
        path.join(config, 'excel-source.json'),
        JSON.stringify({
          path: file,
          enabled: false,
          pausedAt: new Date().toISOString(),
        }),
      );
      await start();
      browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox'],
      });
      const context = await browser.newContext();
      let page = await context.newPage();
      await page.addInitScript((value) => {
        if (!localStorage.getItem('test-initialized')) {
          localStorage.setItem('alkynes.recruitment.v1', JSON.stringify(value));
          localStorage.setItem('test-initialized', '1');
        }
      }, legacy);
      await page.goto(base + '/settings');
      await page.getByText('노트북 SQLite 저장', { exact: true }).waitFor();
      assert.deepEqual((await api()).data, legacy);
      let db = new DatabaseSync(path.join(config, 'recruitment.sqlite'));
      assert.deepEqual(
        JSON.parse(
          db.prepare('SELECT payload FROM migration_backup').get().payload,
        ),
        legacy,
      );
      db.close();
      await page
        .getByRole('button', { name: '엑셀 업데이트', exact: true })
        .click();
      await page
        .getByText(/엑셀 반영 완료.*신규 요청 1건.*자동 연결은 일시 중지 상태/, {
          exact: true,
        })
        .waitFor();
      assert.equal((await api()).data.requests.length, 1);
      await page.goto(base + '/aptitudes');
      await page
        .getByRole('button', { name: '상세 / 수정', exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('textarea[name=notes]').fill('디스크 저장 검증');
      let fail = true;
      await page.route('**/__alkynes/data', (route) =>
        fail && route.request().method() === 'POST'
          ? route.fulfill({
              status: 507,
              json: { error: '검증용 디스크 저장 실패' },
            })
          : route.continue(),
      );
      await dialog.getByRole('button', { name: '저장', exact: true }).click();
      await dialog
        .getByRole('alert')
        .getByText('검증용 디스크 저장 실패', { exact: true })
        .waitFor();
      assert.equal((await api()).data.requests[0].appNotes, undefined);
      assert.equal(await dialog.count(), 1);
      fail = false;
      await dialog.getByRole('button', { name: '저장', exact: true }).click();
      await page
        .getByText('개인 메모: 디스크 저장 검증', { exact: true })
        .waitFor();
      assert.equal((await api()).data.requests[0].appNotes, '디스크 저장 검증');
      // A slow poll from before a successful save must not rewind the visible data.
      const stale = await api();
      let held;
      let signal;
      const intercepted = new Promise(resolve => { signal = resolve; });
      const delayedRead = route => {
        if (!held && route.request().method() === 'GET' && route.request().headers()['if-none-match']) { held = route; signal(); }
        else return route.fallback();
      };
      await page.route('**/__alkynes/data', delayedRead);
      await intercepted;
      await page.getByRole('button', { name: '상세 / 수정', exact: true }).click();
      await page.locator('textarea[name=notes]').fill('최신 저장 유지 검증');
      await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
      await page.getByText('개인 메모: 최신 저장 유지 검증', { exact: true }).waitFor();
      await held.fulfill({ json: stale });
      await page.waitForTimeout(200);
      assert.equal(await page.getByText('개인 메모: 최신 저장 유지 검증', { exact: true }).count(), 1);
      await page.unroute('**/__alkynes/data', delayedRead);
      const snapshot = await api(),
        person = snapshot.data.candidates[0];
      for (let n = 0; n < 8; n++)
        snapshot.data.candidates.push({
          ...person,
          id: 'big-' + n,
          name: '대용량 검증지원자' + n,
          resumeData:
            'data:application/pdf;base64,' +
            Buffer.from('%PDF-1.4\n' + 'a'.repeat(700000)).toString('base64'),
          resumeName: 'test.pdf',
        });
      assert.ok(
        Buffer.byteLength(JSON.stringify(snapshot.data)) > 5 * 1024 * 1024,
      );
      await api({ data: snapshot.data, revision: snapshot.revision });
      await context.close();
      await stop();
      await start();
      const clean = await browser.newContext();
      page = await clean.newPage();
      await page.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === 'alkynes.recruitment.v1')
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
          return original.call(this, k, v);
        };
      });
      await page.goto(base + '/settings');
      await page.getByText('노트북 SQLite 저장', { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem('alkynes.recruitment.v1'),
        ),
        null,
      );
      await page.goto(base + '/candidates');
      await page.getByText('대용량 검증지원자7', { exact: true }).waitFor();
      assert.equal(
        await page.getByText('대용량 검증지원자7', { exact: true }).count(),
        1,
      );
      await page.goto(base + '/aptitudes');
      await page
        .getByRole('button', { name: '상세 / 수정', exact: true })
        .click();
      await page.locator('textarea[name=notes]').fill('5MB 초과 저장 검증');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '저장', exact: true })
        .click();
      await page
        .getByText('개인 메모: 5MB 초과 저장 검증', { exact: true })
        .waitFor();
      assert.equal((await api()).data.requests[0].appNotes, '5MB 초과 저장 검증');
      await page.goto(base + '/settings');
      const restore = (await api()).data;
      restore.requests[0].appNotes = '대용량 백업 복원 검증';
      await page.locator('input[type=file]').setInputFiles({ name: 'large-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(restore)) });
      const restoreDialog = page.getByRole('dialog', { name: '백업 복원 확인', exact: true });
      await restoreDialog.getByRole('button', { name: '복원 확인', exact: true }).click();
      await restoreDialog.waitFor({ state: 'hidden' });
      assert.equal((await api()).data.requests[0].appNotes, '대용량 백업 복원 검증');
      await page.screenshot({
        path: '/workspace/scratch/sqlite-storage-settings.png',
        fullPage: true,
      });
      await clean.close();
    } finally {
      await browser?.close();
      await stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
