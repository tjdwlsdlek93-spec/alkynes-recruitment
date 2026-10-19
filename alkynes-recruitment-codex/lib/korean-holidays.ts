import Holidays from 'date-holidays';

// Offline Korean public-holiday rules, including lunar dates and substitutes.
// Source: date-holidays/data/countries/KR.yaml (CC BY-SA 3.0), version pinned in package.json.
// One-off holidays are explicit: they cannot be predicted by a recurring rule.
const announcedHolidays: Record<string, string> = {
  '2023-10-02': '임시공휴일',
  '2024-04-10': '국회의원 선거일',
  '2024-10-01': '임시공휴일',
  '2025-01-27': '임시공휴일',
  '2025-06-03': '대통령 선거일',
  '2026-06-03': '전국동시지방선거일',
};
const dayMs = 24 * 60 * 60 * 1000;
const cache = new Map<number, Readonly<Record<string, readonly string[]>>>();
let calendar: Holidays | undefined;

export function koreanHolidays(year: number): Readonly<Record<string, readonly string[]>> {
  const saved = cache.get(year);
  if (saved) return saved;
  calendar ??= new Holidays('KR', { languages: 'ko', timezone: 'Asia/Seoul', types: ['public'] });
  const result: Record<string, string[]> = {};
  const add = (date: string, name: string) => {
    if (!date.startsWith(year + '-')) return;
    const names = result[date] ??= [];
    if (!names.includes(name)) names.push(name);
  };
  for (const holiday of calendar.getHolidays(year)) {
    if (holiday.type !== 'public') continue;
    // 3.37.0 anchors Seollal's 3-day span at lunar Jan 1 instead of the eve.
    // Move that span back one day; explicit substitute rules are already correct.
    const offset = holiday.rule === 'korean 01-0-01 P3D' ? -dayMs : 0;
    const name = holiday.name.replace('석가탄신일', '부처님오신날').replace('기독탄신일', '성탄절');
    for (let at = holiday.start.getTime() + offset; at < holiday.end.getTime() + offset; at += dayMs) {
      // Convert the Korean midnight boundary to a date key without host-timezone dependence.
      add(new Date(at + 9 * 60 * 60 * 1000).toISOString().slice(0, 10), name);
    }
  }
  for (const [date, name] of Object.entries(announcedHolidays)) add(date, name);
  const frozen = Object.freeze(Object.fromEntries(Object.entries(result).map(([date, names]) => [date, Object.freeze(names)])));
  cache.set(year, frozen);
  return frozen;
}

export function calendarDay(date: string) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const holidays = koreanHolidays(Number(date.slice(0, 4)))[date] || [];
  return { holidays, tone: holidays.length || weekday === 0 ? 'red' : weekday === 6 ? 'blue' : 'normal' } as const;
}
