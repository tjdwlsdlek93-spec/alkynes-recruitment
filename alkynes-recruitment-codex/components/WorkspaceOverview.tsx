'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRecruitment } from './RecruitmentProvider';
import { formatDate, formatDateOnly } from '@/lib/recruitment';
import { todayWork, interviewConflicts } from '@/lib/workspace';
import { koreaDate } from '@/lib/scheduling';
import { changeSummary, groupExcelRuns } from '@/lib/excel-changes';
export function TodayWork() {
  const { data } = useRecruitment();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const items = todayWork(data, now), conflicts = interviewConflicts(data, now);
  const pending = items.length > 0 || conflicts.length > 0;
  return <section className={'card desk-note todo-note p-5' + (pending ? ' has-work' : '')} aria-label="오늘 챙길 일">
    <div className="flex items-center gap-2"><span className="todo-signal" aria-hidden="true"/><span className="section-label">TO DO</span></div>
    <h2 className="mt-2">오늘 챙길 일</h2>
    <p className="mt-2 text-xs font-semibold text-amber-900">{items.length}건{conflicts.length > 0 && ' · 일정 겹침 ' + conflicts.length + '건'}</p>
    <div className="todo-items mt-3 space-y-2">
      {conflicts.length > 0 && <Link className="block rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-800" href="/interviews">면접 시간·장소·면접관 겹침 {conflicts.length}건 확인</Link>}
      {items.map(item => <Link key={item.id} href={item.href} className={'block rounded-lg border p-3 text-xs ' + (item.urgent ? 'border-amber-300 bg-amber-50' : 'border-amber-200 bg-white/60')}><strong>{item.title}</strong><p className="mt-1 break-keep">{item.detail}</p><p className="mt-1 text-[11px] text-slate-500">{formatDate(item.at)}</p></Link>)}
    </div>
    {!pending && <p className="mt-3 text-sm text-slate-500">지금은 챙길 일이 없어요!</p>}
  </section>;
}
export function ExcelChangeHistory() {
  const { data } = useRecruitment();
  const groups = groupExcelRuns(data.excelRuns || []), today = koreaDate();
  const [selected, setSelected] = useState(''), [query, setQuery] = useState('');
  const selectedDate = selected || (groups.some(g => g.date === today) ? today : groups[0]?.date || '');
  const group = groups.find(g => g.date === selectedDate);
  const search = query.trim().toLocaleLowerCase();
  return <section className="card space-y-4 p-5" aria-label="엑셀 변경 내역"><div><h2>엑셀 변경 내역</h2><p className="mt-1 text-xs text-slate-500">날짜별 수정 내용을 누적 보관합니다. 수정일은 파일 저장 시각 기준이며, 이전 기록에 저장 시각이 없으면 앱 반영일을 사용합니다.</p></div>
    <div className="flex flex-wrap gap-3"><label className="text-sm">수정일 선택<select className="field mt-1" aria-label="엑셀 수정일 선택" value={selectedDate} onChange={e => setSelected(e.target.value)}><option value="" disabled>수정 이력 없음</option>{groups.map(day => <option key={day.date} value={day.date}>{formatDateOnly(day.date)} · 수정 {day.changes}건 · 반영 {day.runs.length}회</option>)}</select></label><label className="min-w-0 flex-1 text-sm">수정 내용 검색<input className="field mt-1" value={query} onChange={e => setQuery(e.target.value)} placeholder="지원자, 공고, 비고 등" aria-label="엑셀 수정 내용 검색"/></label></div>
    {!groups.length && <p className="text-sm text-slate-500">다음 엑셀 반영부터 변경 내용을 기록합니다.</p>}
    {group && <div className="space-y-3"><p className="text-sm font-semibold">{formatDateOnly(group.date)} · {changeSummary(group.counts)}</p>{group.runs.map(run => {
      const changes = run.changes.filter(change => !search || (change.label + ' ' + change.detail).toLocaleLowerCase().includes(search));
      if (search && !changes.length) return null;
      return <article key={run.id} className="rounded-xl border p-4"><p className="break-all text-xs text-slate-500">{run.sourceName}</p><p className="mt-1 text-xs text-slate-500">{run.sourceModifiedAt ? '파일 저장: ' + formatDate(run.sourceModifiedAt) + ' · ' : ''}앱 반영: {formatDate(run.at)}</p>
        {changes.length ? <ul className="mt-3 space-y-3">{changes.map((change,index) => <li key={index} className="border-l-2 border-amber-300 pl-3 text-sm"><strong>{change.label}</strong><p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{change.detail}</p></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">변경 없음 · 비교 기준 기록</p>}
      </article>;
    })}{search && !group.runs.some(run => run.changes.some(c => (c.label + ' ' + c.detail).toLocaleLowerCase().includes(search))) && <p className="text-sm text-slate-500">이 날짜에 검색어와 일치하는 수정이 없습니다.</p>}</div>}
    <p className="text-xs text-slate-500">앱이 확인한 저장본 사이의 변경을 기록합니다. 기록 시작 전 수정이나 앱 확인 사이에 덮어쓴 중간 저장본은 소급 복원할 수 없습니다.</p>
  </section>;
}
