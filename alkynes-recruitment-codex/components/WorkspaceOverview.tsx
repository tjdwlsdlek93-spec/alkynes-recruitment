'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRecruitment } from './RecruitmentProvider';
import { formatDate } from '@/lib/recruitment';
import { todayWork, interviewConflicts } from '@/lib/workspace';
import { changeSummary } from '@/lib/excel-changes';
export function TodayWork() {
  const { data } = useRecruitment();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const items = todayWork(data, now), conflicts = interviewConflicts(data, now);
  return <section className="card p-5" aria-label="오늘 챙길 일"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="section-label">TO DO</span><h2>오늘 챙길 일</h2></div><span className="badge bg-amber-50 text-amber-900">{items.length}건 · 일정 겹침 {conflicts.length}건</span></div>
    {conflicts.length > 0 && <Link className="mt-4 block rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800" href="/interviews">면접 시간·장소·면접관 겹침 {conflicts.length}건을 확인해 주세요.</Link>}
    <div className="mt-4 grid gap-3 lg:grid-cols-2">{items.slice(0,8).map(item => <Link key={item.id} href={item.href} className={'rounded-xl border p-3 text-sm ' + (item.urgent ? 'border-amber-200 bg-amber-50' : 'bg-white/60')}><strong>{item.title}</strong><p className="mt-1 break-keep">{item.detail}</p><p className="mt-1 text-xs text-slate-500">{formatDate(item.at)}</p></Link>)}</div>
    {items.length > 8 && <details className="mt-3 text-sm"><summary className="cursor-pointer">나머지 {items.length - 8}건 보기</summary><div className="mt-3 space-y-2">{items.slice(8).map(item => <Link key={item.id} href={item.href} className="block rounded-xl border p-3">{item.title} · {item.detail} · {formatDate(item.at)}</Link>)}</div></details>}
    {!items.length && !conflicts.length && <p className="mt-4 text-sm text-slate-500">지금 챙길 일이 없습니다. 오늘도 순조롭네요!</p>}
  </section>;
}
export function ExcelChangeHistory({ compact = false }: { compact?: boolean }) {
  const { data } = useRecruitment();
  const runs = (data.excelRuns || []).slice(0, compact ? 1 : 30);
  return <section className="card space-y-3 p-5" aria-label="엑셀 변경 내역"><h2>엑셀 변경 내역</h2>{!runs.length && <p className="text-sm text-slate-500">다음 엑셀 반영부터 변경 내용을 기록합니다.</p>}{runs.map(run => <div key={run.id} className="rounded-xl border p-3"><p className="text-xs text-slate-500">{formatDate(run.at)} · {run.sourceName}</p><p className="mt-2 text-sm font-semibold">{changeSummary(run.counts)}</p>{run.changes.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer">상세 변경 {run.changes.length}건</summary><ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">{run.changes.map((change,index) => <li key={index} className="border-l-2 border-amber-300 pl-3"><strong>{change.label}</strong> · {change.detail}</li>)}</ul></details>}</div>)}{compact && <Link className="inline-block text-sm underline" href="/requests">전체 변경 내역 보기</Link>}</section>;
}
