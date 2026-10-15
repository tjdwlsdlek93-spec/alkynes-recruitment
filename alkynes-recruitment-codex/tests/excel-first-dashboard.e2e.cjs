const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
test('Excel-first UI removes create buttons, provides zero-record message previews, and dashboard resolves terminal candidates', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:8793';
  try {
    await page.clock.install({ time: new Date('2026-10-15T09:00:00+09:00') });
    for (const [route, create, title] of [['requisitions', '+ 채용 요청 등록', null], ['aptitudes', '+ 인적성 요청 등록', '인적성 안내문 예시'], ['interviews', '+ 면접 일정 등록', '면접 안내문 예시']]) {
      await page.goto(base + '/' + route);
      await page.getByRole('heading', { name: route === 'requisitions' ? '채용 요청' : route === 'aptitudes' ? '인적성 관리' : '면접 일정', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: create, exact: true }).count(), 0);
      if (title) {
        await page.getByRole('button', { name: '카톡 안내문 작성', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: title, exact: true });
        assert.ok((await dialog.getByLabel('공유 안내문', { exact: true }).inputValue()).includes('실제 요청이나 일정이 아닙니다'));
        await dialog.getByRole('button', { name: '닫기', exact: true }).last().click();
      }
    }
    await page.evaluate(() => {
      const stamp = { createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z' };
      const job = { ...stamp, id: 'job-real', code: 'HR-2026-001', department: '검증부서', requester: '', role: '검증공고', headcount: 1, reason: '', duties: '', requirements: '', preferred: '', targetJoin: '', status: '진행중' };
      const candidates = ['A','B','C'].map((key,i) => ({ ...stamp, id: 'person-'+key, requisitionId: job.id, name: '검증지원자'+key, source: '', career: '', phone: '', email: '', status: '확인 필요', excelStage: i < 2 ? '전형종료' : '확인 필요', excelFinal: ['입사포기','지원포기','미확정'][i], notes: '', resumeName: '', resumeData: '' }));
      const interviews = candidates.map((c,i) => ({ ...stamp, id: 'meeting-'+i, candidateId: c.id, startsAt: '2026-10-15T05:00:00.000Z', location: '검증회의실', interviewers: ['검증면접관'], status: '확인 필요', verification: '선발 단계 확인 필요' }));
      localStorage.setItem('alkynes.recruitment.v1', JSON.stringify({ version: 1, requisitions: [job], candidates, interviews, evaluations: [], activity: [], requests: [] }));
    });
    await page.goto(base + '/dashboard');
    await page.getByRole('heading', { name: '채용 현황', exact: true }).waitFor();
    const week = page.locator('.card').filter({ has: page.getByRole('heading', { name: '이번주 면접 · 한국시간 기준', exact: true }) });
    assert.ok((await week.innerText()).includes('검증지원자C'));
    assert.ok(!(await week.innerText()).includes('검증지원자A'));
    assert.ok(!(await week.innerText()).includes('검증지원자B'));
    await page.getByRole('button', { name: /2026-10-15 일정/ }).click();
    const details = page.getByLabel('선택한 날짜 일정', { exact: true });
    const text = await details.innerText();
    assert.ok(text.includes('전형 종료 · 입사포기')); assert.ok(text.includes('전형 종료 · 지원포기'));
    const terminated = details.getByRole('link').filter({ hasText: /검증지원자[AB]/ });
    for (const link of await terminated.all()) assert.ok(!(await link.innerText()).includes('확인 필요'));
    assert.ok(text.includes('확인 필요'));
    await page.screenshot({ path: '/workspace/scratch/dashboard-terminal-fixed.png', fullPage: true });
  } finally { await browser.close(); }
});
