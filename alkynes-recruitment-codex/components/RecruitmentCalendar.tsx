'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRecruitment } from './RecruitmentProvider';
import { calendarEvents, koreaDate } from '@/lib/scheduling';
export function RecruitmentCalendar() {
  const { data } = useRecruitment(),
    today = koreaDate();
  const [month, setMonth] = useState(today.slice(0, 7)),
    [selected, setSelected] = useState(today);
  const events = useMemo(() => calendarEvents(data), [data]);
  const first = new Date(month + '-01T00:00:00Z'),
    days = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
  const blanks = first.getUTCDay();
  function move(n: number) {
    const next = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + n, 1),
    )
      .toISOString()
      .slice(0, 7);
    setMonth(next);
    setSelected(next + '-01');
  }
  return (
    <section className="card calendar-panel p-4 sm:p-5" aria-label="채용 일정 캘린더">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="section-label">SCHEDULE</span><h2 className="font-bold">채용 캘린더</h2>
          <p className="mt-1 text-xs text-slate-500">
            면접 · 요청 접수 · 미완료 요청 마감
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary"
            onClick={() => move(-1)}
            aria-label="이전 달"
          >
            ‹
          </button>
          <input
            className="field w-40"
            style={{ width: 140, minWidth: 0 }}
            aria-label="캘린더 월"
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) {
                setMonth(e.target.value);
                setSelected(e.target.value + '-01');
              }
            }}
          />
          <button
            className="btn-secondary"
            onClick={() => move(1)}
            aria-label="다음 달"
          >
            ›
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setMonth(today.slice(0, 7));
              setSelected(today);
            }}
          >
            오늘
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-7 text-center text-xs text-slate-500">
            {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
              <div className="py-2" key={day}>
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 border-l border-t">
            {Array.from({ length: blanks }, (_, i) => (
              <div
                key={'blank' + i}
                className="border-b border-r bg-slate-50"
              />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const date = month + '-' + String(i + 1).padStart(2, '0'),
                rows = events.filter((e) => e.date === date);
              return (
                <button
                  type="button"
                  key={date}
                  aria-label={date + ' 일정 ' + rows.length + '건'}
                  aria-pressed={selected === date}
                  onClick={() => setSelected(date)}
                  className={
                    'min-h-28 min-w-0 border-b border-r p-2 text-left align-top ' +
                    (selected === date
                      ? 'bg-blue-50 ring-2 ring-inset ring-blue-500'
                      : 'hover:bg-slate-50')
                  }
                >
                  <span
                    className={
                      'text-sm ' +
                      (today === date
                        ? 'rounded-full bg-slate-900 px-2 py-1 text-white'
                        : '')
                    }
                  >
                    {i + 1}
                  </span>
                  {rows.slice(0, 3).map((e) => (
                    <span
                      key={e.id}
                      className={
                        'mt-1 block truncate rounded px-1 py-0.5 text-[11px] ' +
                        (e.status === '요청 전'
                          ? 'bg-amber-100 text-amber-900'
                          : e.status === '요청 완료'
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-slate-100 text-slate-700')
                      }
                    >
                      {e.time === '00:00' ? '' : e.time + ' '}
                      {e.title} · {e.status}
                    </span>
                  ))}
                  {rows.length > 3 && (
                    <span className="text-xs text-slate-500">
                      +{rows.length - 3}건 더 보기
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2" aria-label="선택한 날짜 일정">
        <h3 className="font-semibold">{selected} 일정</h3>
        {events
          .filter((e) => e.date === selected)
          .map((e) => (
            <Link
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm hover:bg-slate-50"
              key={e.id}
              href={e.href}
            >
              <span>
                {e.time === '00:00' ? '시간 미입력' : e.time} · {e.title}
              </span>
              <span className="flex flex-wrap gap-2">
                <span className="badge bg-slate-100">{e.status}</span>
                {e.timing && (
                  <span className="text-xs text-amber-800">{e.timing}</span>
                )}
              </span>
            </Link>
          ))}
        {!events.some((e) => e.date === selected) && (
          <p className="py-4 text-sm text-slate-500">등록된 일정이 없습니다.</p>
        )}
      </div>
    </section>
  );
}
