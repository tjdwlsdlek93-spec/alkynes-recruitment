const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

test('calendar renders weekend colors, named holidays, lunar holidays and substitutes offline', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.clock.install({ time: new Date('2026-10-09T10:00:00+09:00') });
    await page.goto((process.env.E2E_BASE_URL || 'http://127.0.0.1:8793') + '/dashboard');
    const calendar = page.getByRole('region', { name: '채용 일정 캘린더' });
    await calendar.getByRole('heading', { name: '채용 캘린더', exact: true }).waitFor();
    const day = (date) => calendar.getByRole('button', { name: new RegExp('^' + date) });
    const numberColor = button => button.locator('span').first().evaluate(el => getComputedStyle(el).color);
    const holiday = day('2026년 10월 9일');
    await holiday.getByText('한글날', { exact: true }).waitFor();
    assert.equal(await numberColor(holiday), 'rgb(220, 38, 38)');
    assert.ok(await holiday.locator('span').first().evaluate(el => el.classList.contains('rounded-full')));
    assert.equal(await numberColor(day('2026년 10월 10일')), 'rgb(37, 99, 235)');
    assert.equal(await numberColor(day('2026년 10월 11일')), 'rgb(220, 38, 38)');
    assert.equal(await numberColor(day('2026년 10월 3일')), 'rgb(220, 38, 38)');
    await day('2026년 10월 5일').getByText('개천절 (대체공휴일)', { exact: true }).waitFor();
    await holiday.click();
    await page.getByLabel('선택한 날짜 일정', { exact: true }).getByText('한글날', { exact: true }).waitFor();
    await page.screenshot({ path: '/workspace/scratch/calendar-holidays.png', fullPage: true });
    // All future-month calculations continue without a network connection.
    await page.context().setOffline(true);
    await page.getByLabel('캘린더 월', { exact: true }).fill('2026-02');
    for (const n of [16, 17, 18]) {
      const cell = day('2026년 2월 ' + n + '일');
      await cell.getByText('설날', { exact: true }).waitFor();
      assert.equal(await numberColor(cell), 'rgb(220, 38, 38)');
    }
    assert.equal(await day('2026년 2월 19일').getByText('설날', { exact: true }).count(), 0);
    await page.getByLabel('캘린더 월', { exact: true }).fill('2027-02');
    await day('2027년 2월 9일').getByText('설날 (대체공휴일)', { exact: true }).waitFor();
    await page.context().setOffline(false);
    await page.clock.setFixedTime(new Date('2026-10-10T10:00:00+09:00'));
    await page.reload();
    const saturday = day('2026년 10월 10일');
    await saturday.waitFor();
    assert.equal(await numberColor(saturday), 'rgb(37, 99, 235)');
    assert.ok(await saturday.locator('span').first().evaluate(el => el.classList.contains('rounded-full')));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
