const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fixture = process.env.KPI_TEST_FILE;
test(
  'browser imports October 14 Excel, preserves uncertain evidence, updates calendar and reimports without duplicates',
  { skip: !fixture },
  async () => {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true,
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:8790';
    const data = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('alkynes.recruitment.v1')),
      );
    try {
      await page.goto(base + '/requests');
      await page
        .getByRole('heading', { name: '엑셀 연동', exact: true })
        .waitFor();
      await page
        .getByLabel('엑셀 파일 (.xlsx)', { exact: true })
        .setInputFiles(fixture);
      const preview = page.getByRole('dialog', { name: '엑셀 가져오기 확인' });
      await preview.waitFor();
      assert.ok(
        (await preview.innerText()).includes(
          '채용 8건 · 지원자 12명 · 요청 27건 · 면접 4건',
        ),
      );
      await page
        .getByRole('button', { name: '가져오기 적용', exact: true })
        .click();
      await preview.waitFor({ state: 'hidden' });
      let d = await data();
      assert.deepEqual(
        [
          d.requisitions.length,
          d.candidates.length,
          d.requests.length,
          d.interviews.length,
        ],
        [8, 12, 27, 4],
      );
      assert.equal(
        d.requests.filter((q) => q.source === 'kpi-excel').length,
        27,
      );
      assert.ok(
        (await page.getByText('확인 필요:', { exact: false }).count()) > 0,
      );
      await page
        .getByLabel('엑셀 파일 (.xlsx)', { exact: true })
        .setInputFiles(fixture);
      await preview.waitFor();
      await page
        .getByRole('button', { name: '가져오기 적용', exact: true })
        .click();
      await preview.waitFor({ state: 'hidden' });
      d = await data();
      assert.deepEqual(
        [
          d.requisitions.length,
          d.candidates.length,
          d.requests.length,
          d.interviews.length,
        ],
        [8, 12, 27, 4],
      );
      await page.getByRole('link', { name: '대시보드', exact: true }).click();
      await page
        .getByRole('heading', { name: '채용 현황', exact: true })
        .waitFor();
      const cards = page.locator('.grid > .card');
      assert.ok((await cards.nth(0).innerText()).includes('4'));
      assert.ok((await cards.nth(1).innerText()).includes('11'));
      assert.ok((await cards.nth(4).innerText()).includes('0'));
      await page.getByLabel('캘린더 월', { exact: true }).fill('2026-10');
      await page.getByRole('button', { name: /2026-10-15 일정/ }).click();
      const selected = page.getByLabel('선택한 날짜 일정', { exact: true });
      assert.ok((await selected.innerText()).includes('14:00'));
      assert.ok((await selected.innerText()).includes((process.env.KPI_TEST_INTERVIEW_NAME || '테스트지원자A')));
      assert.ok((await selected.innerText()).includes('확인 필요'));
      await page.screenshot({
        path: '/workspace/scratch/excel-calendar-verified.png',
        fullPage: true,
      });
      await selected.getByRole('link').first().click();
      await page
        .getByRole('heading', { name: '면접 일정', exact: true })
        .waitFor();
      assert.ok((await page.locator('main').innerText()).includes((process.env.KPI_TEST_INTERVIEW_NAME || '테스트지원자A')));
      await page.reload();
      await page
        .getByRole('heading', { name: '면접 일정', exact: true })
        .waitFor();
      assert.equal((await data()).requests.length, 27);
      await page.goto(base + '/requisitions');
      await page.getByRole('heading', { name: '채용 요청', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '삭제', exact: true }).count(), 4);
      await page.getByRole('button', { name: /^채용 완료/ }).click();
      assert.equal(await page.getByRole('button', { name: '삭제', exact: true }).count(), 4);
      await page.getByRole('button', { name: /^채용중/ }).click();
      await page.getByRole('button', { name: '상세 / 수정', exact: true }).first().click();
      assert.equal(await page.locator('select[name=status] option').count(), 2);
      await page.getByRole('button', { name: '취소', exact: true }).click();
      await page.screenshot({ path: '/workspace/scratch/recruitment-redesign.png', fullPage: true });
      const before = await data();
      await page.getByRole('button', { name: '삭제', exact: true }).first().click();
      await page.getByRole('button', { name: '취소', exact: true }).click();
      assert.equal((await data()).requisitions.length, before.requisitions.length);
      await page.getByRole('button', { name: '삭제', exact: true }).first().click();
      await page.getByRole('button', { name: '삭제 확인', exact: true }).click();
      assert.equal((await data()).requisitions.length, 7);
      await page.reload();
      await page.getByRole('heading', { name: '채용 요청', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '삭제', exact: true }).count(), 3);
      const endedNames = await page.evaluate(() => {
        const key = 'alkynes.recruitment.v1', d = JSON.parse(localStorage.getItem(key));
        const closed = ['채용완료', '채용취소', '자체종결', '채용보류'];
        const people = d.candidates.filter(c => !closed.includes(d.requisitions.find(r => r.id === c.requisitionId).status)).slice(0, 3);
        people.forEach((c, i) => { c.excelFinal = ['지원포기', '입사포기', '불합격'][i]; c.status = '확인 필요'; });
        localStorage.setItem(key, JSON.stringify(d)); return people.map(c => c.name);
      });
      await page.goto(base + '/candidates');
      await page.getByRole('heading', { name: '지원자', exact: true }).waitFor();
      for (const name of endedNames) assert.equal(await page.getByRole('cell', { name, exact: true }).count(), 0);
      await page.getByLabel('지원자 채용 분류').selectOption('ended');
      for (const name of endedNames) assert.equal(await page.getByRole('cell', { name, exact: true }).count(), 1);
      for (const result of ['지원포기', '입사포기', '불합격']) assert.equal(await page.getByRole('cell', { name: result, exact: true }).count(), 1);
      await page.getByRole('row').filter({ has: page.getByRole('cell', { name: endedNames[0], exact: true }) }).getByRole('button', { name: '상세 / 수정', exact: true }).click();
      const detail = page.getByRole('dialog');
      assert.ok((await detail.innerText()).includes('최종 결과 반영 상태: 지원포기'));
      assert.ok(!(await detail.locator('p').first().innerText()).includes('확인 필요'));
      await page.getByRole('button', { name: '취소', exact: true }).click();
      assert.equal(await page.getByText('브라우저 저장 ·', { exact: false }).count(), 0);
      await page.goto(base + '/settings');
      await page.getByRole('heading', { name: '앱 업데이트', exact: true }).waitFor();
      await page.getByLabel('GitHub 릴리스 저장소', { exact: true }).waitFor();
      await page.screenshot({ path: '/workspace/scratch/update-settings.png', fullPage: true });
      await page.route('**/__alkynes/update**', async route => {
        const url = new URL(route.request().url());
        await route.fulfill({ json: { currentVersion: '2026.10.14.4', repository: 'company/app', availableVersion: url.pathname.endsWith('/check') ? '2026.10.14.5' : '', notes: '업데이트 기능 확인' } });
      });
      await page.reload();
      await page.getByRole('button', { name: '업데이트 확인', exact: true }).click();
      await page.getByRole('button', { name: '새 버전 업데이트', exact: true }).click();
      await page.getByRole('dialog', { name: '앱 업데이트 확인', exact: true }).waitFor();
      await page.getByRole('button', { name: '취소', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await browser.close();
    }
  },
);
