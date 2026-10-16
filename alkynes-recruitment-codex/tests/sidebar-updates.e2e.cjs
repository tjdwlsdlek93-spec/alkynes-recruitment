const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const crypto = require('node:crypto');
test('sidebar buttons update Excel and install app without leaving current page; manual Excel refresh preserves pause', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('채용프로세스 적시성');
  sheet.getRow(5).values = ['채용건명','의뢰 부서','의뢰자','지원자명','요청 구분','요청일','처리완료일','처리기한','기한 판정','인적성 검사 일시','면접 일시','현재 선발 단계','최종 결과','입사예정일','실제 입사일','비고'];
  sheet.getRow(6).values = ['검증공고','검증부서','담당자','검증지원자','면접 요청',new Date('2026-10-14T00:00:00Z'),null,null,null,null,new Date('2026-10-20T05:00:00Z'),'확인 필요','미확정'];
  const bytes = Buffer.from(await book.xlsx.writeBuffer()), revision = crypto.createHash('sha256').update(bytes).digest('hex');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  let reads = 0, checks = 0, applies = 0, latest = '', failure = false, sourceFailure = false;
  try {
    await page.route('**/__alkynes/source**', async route => {
      if (route.request().url().endsWith('/preview')) {
        reads++;
        if (sourceFailure) return route.fulfill({ status: 404, json: { error: '검증용 파일 없음' } });
        return route.fulfill({ body: bytes, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-Alkynes-Revision': revision } });
      }
      return route.fulfill({ json: { path: '/test.xlsx', enabled: false } });
    });
    await page.route('**/__alkynes/update**', async route => {
      const url = route.request().url();
      if (url.endsWith('/check')) { checks++; if (failure) return route.fulfill({ status: 400, json: { error: '검증용 배포 서버 오류' } }); }
      if (url.endsWith('/apply')) { applies++; assert.equal(route.request().postDataJSON().version, latest); return route.fulfill({ json: { restarting: true } }); }
      return route.fulfill({ json: { currentVersion: '2026.10.15.3', repository: 'company/app', availableVersion: latest } });
    });
    await page.route('**/__alkynes/health', route => route.fulfill({ json: { ready: true, version: latest } }));
    const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:8793';
    await page.goto(base + '/interviews');
    const actions = page.getByLabel('빠른 업데이트', { exact: true });
    const app = actions.getByRole('button', { name: '앱 업데이트', exact: true });
    const excel = actions.getByRole('button', { name: '엑셀 업데이트', exact: true });
    await excel.click();
    await actions.getByText('엑셀 1행 반영 완료 · 자동 연결은 일시 중지 상태입니다.', { exact: true }).waitFor();
    assert.ok((await actions.locator('.sync-timestamp').innerText()).includes('마지막 반영'));
    assert.ok(!(await actions.locator('.sync-timestamp').innerText()).includes('아직 없음'));
    assert.equal(await page.getByText('앱 업데이트 시 완료 후 화면이 다시 열립니다.', { exact: true }).count(), 0);
    assert.equal(await page.getByText('by MIN SEONG JIN', { exact: true }).count(), 1);
    assert.equal(await page.getByLabel('전구', { exact: true }).count(), 1);
    assert.equal(reads, 1); assert.equal(page.url(), base + '/interviews');
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('alkynes.recruitment.v1')))).candidates.length, 1);
    await app.click();
    await actions.getByText('현재 최신 버전입니다.', { exact: true }).waitFor();
    assert.equal(checks, 1); assert.equal(applies, 0);
    failure = true; await app.click();
    await actions.getByRole('alert').getByText('검증용 배포 서버 오류', { exact: true }).waitFor();
    assert.equal(applies, 0);
    sourceFailure = true; await excel.click();
    await actions.getByRole('alert').getByText('검증용 파일 없음', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('alkynes.recruitment.v1')))).candidates.length, 1);
    failure = false; latest = '2026.10.15.5';
    const reload = page.waitForEvent('framenavigated');
    await app.click(); await reload;
    await app.waitFor();
    assert.equal(applies, 1); assert.equal(page.url(), base + '/interviews');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.screenshot({ path: '/workspace/scratch/sidebar-updates.png', fullPage: true });
  } finally { await browser.close(); }
});
