import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
let browser;
before(async () => {
  let executablePath = process.env.CHROMIUM_PATH;
  if (!executablePath) {
    try {
      await access('/usr/bin/chromium');
      executablePath = '/usr/bin/chromium';
    } catch {}
  }
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox'],
  });
});
after(async () => {
  await browser?.close();
});
const stored = (page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('alkynes.recruitment.v1')),
  );
async function open(page, route) {
  await page.goto(base + route);
  await page.getByRole('heading', { level: 1 }).waitFor();
}
async function submit(page) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '저장', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
async function addRequest(page, department = '테스트팀') {
  await page
    .getByRole('button', { name: '+ 채용 요청 등록', exact: true })
    .click();
  await page.getByLabel('요청부서 *', { exact: true }).fill(department);
  await page.getByLabel('직무 *', { exact: true }).fill('공정 엔지니어');
  await page.getByLabel('채용인원 *', { exact: true }).fill('2');
  await page.getByLabel('목표 입사일', { exact: true }).fill('2026-12-01');
  await page.getByLabel('충원사유', { exact: true }).fill('생산라인 증설');
  await submit(page);
}

test('complete recruitment workflow persists requests, candidates, interviews, evaluations and final decisions', async () => {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await open(page, '/requisitions');
    await addRequest(page);
    await page
      .getByText('테스트팀 · 공정 엔지니어 2명', { exact: true })
      .waitFor();
    let d = await stored(page);
    const req = d.requisitions.find((r) => r.department === '테스트팀');
    assert.match(req.code, /^HR-\d{4}-\d{3}$/);
    assert.equal(d.requisitions.length, 4);
    await page.reload();
    await page
      .getByText('테스트팀 · 공정 엔지니어 2명', { exact: true })
      .waitFor();
    await open(page, '/candidates?requisition=' + req.id);
    await page
      .getByRole('button', { name: '+ 지원자 등록', exact: true })
      .click();
    assert.equal(
      await page.getByLabel('채용건 *', { exact: true }).inputValue(),
      req.id,
    );
    await page
      .getByLabel('지원자 이름 *', { exact: true })
      .fill('테스트지원자');
    await page.getByLabel('지원경로', { exact: true }).fill('추천');
    await page.getByLabel('경력', { exact: true }).fill('5년');
    await page.getByLabel('이메일', { exact: true }).fill('test@example.com');
    await page
      .getByLabel('진행 상태', { exact: true })
      .selectOption('서류합격');
    await page
      .getByLabel('이력서 (PDF, 1MB 이하)', { exact: true })
      .setInputFiles({
        name: 'resume.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nTest resume\n%%EOF'),
      });
    await submit(page);
    await page
      .getByRole('cell', { name: '테스트지원자', exact: true })
      .waitFor();
    d = await stored(page);
    const person = d.candidates.find((c) => c.name === '테스트지원자');
    assert.ok(person.resumeData.startsWith('data:application/pdf;base64,'));
    await page.getByRole('link', { name: '면접 관리', exact: true }).click();
    await page
      .getByRole('button', { name: '+ 면접 일정 등록', exact: true })
      .click();
    await page
      .getByLabel('면접일시 * (한국시간)', { exact: true })
      .fill('2026-11-05T14:00');
    await page.getByLabel('장소 *', { exact: true }).fill('본사, 2층;회의실');
    await page
      .getByLabel('면접관 * (쉼표로 구분)', { exact: true })
      .fill('박팀장, 이부장');
    await submit(page);
    d = await stored(page);
    const interview = d.interviews.find((i) => i.candidateId === person.id);
    assert.equal(
      d.candidates.find((c) => c.id === person.id).status,
      '면접예정',
    );
    assert.equal(
      new Date(interview.startsAt).toISOString(),
      '2026-11-05T05:00:00.000Z',
    );
    const [calendar] = await Promise.all([
      page.waitForEvent('download'),
      page
        .getByRole('button', { name: '캘린더 다운로드', exact: true })
        .click(),
    ]);
    assert.ok(
      (await readFile(await calendar.path(), 'utf8')).includes(
        'DTSTART:20261105T050000Z',
      ),
    );
    await page
      .getByRole('button', { name: '면접 안내문 복사', exact: true })
      .click();
    await page
      .getByText('면접 안내문을 복사했습니다.', { exact: true })
      .waitFor();
    assert.ok(
      (await page.evaluate(() => navigator.clipboard.readText())).includes(
        '테스트지원자',
      ),
    );
    await page
      .getByRole('link', { name: '평가 작성 / 보기', exact: true })
      .click();
    await page.getByLabel('평가자', { exact: true }).selectOption('박팀장');
    for (const name of ['jobFit', 'capability', 'cultureFit'])
      await page.locator('input[name="' + name + '"][value="적합"]').check();
    await page.locator('input[name="overall"][value="추천"]').check();
    await page
      .getByLabel('추가 의견 (선택)', { exact: true })
      .fill('직무 경험 확인');
    await page.getByRole('button', { name: '평가 제출', exact: true }).click();
    await page
      .getByRole('button', { name: '평가 수정', exact: true })
      .waitFor();
    d = await stored(page);
    assert.equal(d.evaluations.length, 1);
    assert.equal(
      d.candidates.find((c) => c.id === person.id).status,
      '면접완료',
    );
    await page.locator('input[name="overall"][value="적극 추천"]').check();
    await page.getByRole('button', { name: '평가 수정', exact: true }).click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem('alkynes.recruitment.v1'))
          .evaluations[0].overall === '적극 추천',
    );
    assert.equal((await stored(page)).evaluations.length, 1);
    await page.getByLabel('평가자', { exact: true }).selectOption('이부장');
    for (const name of ['jobFit', 'capability', 'cultureFit'])
      await page.locator('input[name="' + name + '"][value="우수"]').check();
    await page.locator('input[name="overall"][value="추천"]').check();
    await page.getByRole('button', { name: '평가 제출', exact: true }).click();
    await page.getByText('평가 취합 · 2/2명 제출', { exact: true }).waitFor();
    await open(page, '/candidates?requisition=' + req.id);
    await page
      .getByRole('button', { name: '상세 / 수정', exact: true })
      .click();
    await page
      .getByLabel('진행 상태', { exact: true })
      .selectOption('입사확정');
    await submit(page);
    await page.getByRole('cell', { name: '입사확정', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('cell', { name: '입사확정', exact: true }).waitFor();
    await open(page, '/dashboard');
    assert.equal(
      await page
        .getByText('입사확정', { exact: true })
        .locator('..')
        .innerText(),
      '입사확정\n1',
    );
    d = await stored(page);
    assert.ok(d.activity.length >= 7);
    assert.equal(d.evaluations.length, 2);
    await open(page, '/settings');
    const [backup] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '백업 다운로드', exact: true }).click(),
    ]);
    const contents = await readFile(await backup.path(), 'utf8');
    assert.equal(JSON.parse(contents).candidates.length, 4);
    await page
      .getByLabel('백업 복원 (JSON)', { exact: true })
      .setInputFiles({
        name: 'backup.json',
        mimeType: 'application/json',
        buffer: Buffer.from(contents),
      });
    await page.getByRole('button', { name: '복원 확인', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(
      (await stored(page)).candidates.find((c) => c.id === person.id).status,
      '입사확정',
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('required fields, cancel and invalid PDF never create records', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await open(page, '/requisitions');
    await page
      .getByRole('button', { name: '+ 채용 요청 등록', exact: true })
      .click();
    await page.getByRole('button', { name: '저장', exact: true }).click();
    assert.equal(await page.getByRole('dialog').isVisible(), true);
    assert.equal(await stored(page), null);
    await page.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await stored(page), null);
    await open(page, '/candidates');
    await page
      .getByRole('button', { name: '+ 지원자 등록', exact: true })
      .click();
    await page.getByLabel('채용건 *', { exact: true }).selectOption('r1');
    await page.getByLabel('지원자 이름 *', { exact: true }).fill('파일검증');
    await page
      .getByLabel('이력서 (PDF, 1MB 이하)', { exact: true })
      .setInputFiles({
        name: 'fake.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('<html>not pdf</html>'),
      });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page
      .getByText('PDF 형식의 이력서만 등록할 수 있습니다.', { exact: true })
      .waitFor();
    assert.equal(await stored(page), null);
    await page
      .getByLabel('이력서 (PDF, 1MB 이하)', { exact: true })
      .setInputFiles({
        name: 'large.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(1024 * 1024 + 1),
      });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page
      .getByText('이력서는 1MB 이하 PDF 파일로 등록해 주세요.', { exact: true })
      .waitFor();
    assert.equal(await stored(page), null);
  } finally {
    await context.close();
  }
});

test('storage write failure keeps the form open and does not claim success', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await open(page, '/requisitions');
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('full', 'QuotaExceededError');
      };
    });
    await page
      .getByRole('button', { name: '+ 채용 요청 등록', exact: true })
      .click();
    await page.getByLabel('요청부서 *', { exact: true }).fill('저장실패팀');
    await page.getByLabel('직무 *', { exact: true }).fill('개발자');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.ok(
      (await page.getByRole('dialog').getByRole('alert').innerText()).includes(
        '변경 사항은 저장되지 않았습니다',
      ),
    );
    assert.equal(await stored(page), null);
    assert.equal(await page.getByRole('dialog').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('corrupt saved data is preserved and invalid backups are rejected', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await open(page, '/settings');
    await page.evaluate(() =>
      localStorage.setItem('alkynes.recruitment.v1', '{broken'),
    );
    await page.reload();
    await page
      .getByText('브라우저 저장 데이터를 읽을 수 없습니다.', { exact: false })
      .waitFor();
    await page
      .getByLabel('백업 복원 (JSON)', { exact: true })
      .setInputFiles({
        name: 'bad.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{"version":1}'),
      });
    await page
      .getByText('백업 형식이나 연결된 데이터가 올바르지 않습니다.', {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem('alkynes.recruitment.v1')),
      '{broken',
    );
  } finally {
    await context.close();
  }
});

test('mobile evaluation supports selection and submission without horizontal overflow', async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await open(page, '/evaluations?interview=i1');
    await page.getByLabel('평가자', { exact: true }).selectOption('박팀장');
    for (const name of ['jobFit', 'capability', 'cultureFit'])
      await page.locator('input[name="' + name + '"][value="우수"]').check();
    await page.locator('input[name="overall"][value="추천"]').check();
    await page.getByRole('button', { name: '평가 제출', exact: true }).click();
    await page
      .getByRole('button', { name: '평가 수정', exact: true })
      .waitFor();
    assert.equal((await stored(page)).evaluations.length, 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
  } finally {
    await context.close();
  }
});

test('same-browser tabs synchronize and adding requests preserves existing records', async () => {
  const context = await browser.newContext();
  const a = await context.newPage(),
    b = await context.newPage();
  a.setDefaultTimeout(10000);
  b.setDefaultTimeout(10000);
  try {
    await open(a, '/requisitions');
    await open(b, '/requisitions');
    await addRequest(a, '첫번째팀');
    await b
      .getByText('첫번째팀 · 공정 엔지니어 2명', { exact: true })
      .waitFor();
    await addRequest(b, '두번째팀');
    await a
      .getByText('두번째팀 · 공정 엔지니어 2명', { exact: true })
      .waitFor();
    const d = await stored(a);
    assert.equal(d.requisitions.length, 5);
    assert.equal(new Set(d.requisitions.map((r) => r.code)).size, 5);
    const row = a
      .locator('.card > div')
      .filter({ hasText: '첫번째팀 · 공정 엔지니어 2명' });
    await row.getByRole('button', { name: '상세 / 수정', exact: true }).click();
    await a.getByLabel('채용 상태', { exact: true }).selectOption('채용완료');
    await submit(a);
    await open(a, '/dashboard');
    assert.equal(
      await a
        .getByText('진행중 채용', { exact: true })
        .first()
        .locator('..')
        .innerText(),
      '진행중 채용\n4',
    );
  } finally {
    await context.close();
  }
});

test('candidate deletion cancels safely and removes related interviews and evaluations only after confirmation', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await open(page, '/evaluations?interview=i1');
    await page.getByLabel('평가자', { exact: true }).selectOption('박팀장');
    for (const name of ['jobFit', 'capability', 'cultureFit'])
      await page.locator('input[name="' + name + '"][value="적합"]').check();
    await page.locator('input[name="overall"][value="추천"]').check();
    await page.getByRole('button', { name: '평가 제출', exact: true }).click();
    await page
      .getByRole('button', { name: '평가 수정', exact: true })
      .waitFor();
    await open(page, '/candidates');
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: '홍길동', exact: true }) });
    await row.getByRole('button', { name: '상세 / 수정', exact: true }).click();
    await page
      .getByRole('button', { name: '지원자 삭제', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: '지원자 삭제 확인', exact: true })
      .getByRole('button', { name: '취소', exact: true })
      .click();
    assert.equal((await stored(page)).candidates.length, 3);
    await page
      .getByRole('button', { name: '지원자 삭제', exact: true })
      .click();
    await page.getByRole('button', { name: '삭제 확인', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const d = await stored(page);
    assert.equal(d.candidates.length, 2);
    assert.equal(d.interviews.length, 0);
    assert.equal(d.evaluations.length, 0);
    assert.equal(d.requisitions.length, 3);
  } finally {
    await context.close();
  }
});
