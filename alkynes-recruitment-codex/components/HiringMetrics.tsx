'use client';
import { useState } from 'react';
import { useRecruitment } from './RecruitmentProvider';
import { hiringMetrics } from '@/lib/metrics';
export function HiringMetrics({month}:{month:string}) {
  const {data}=useRecruitment(),[selected,setSelected]=useState(month),m=hiringMetrics(data,selected);
  return <details className="card p-5" aria-label="채용 업무 지표"><summary className="cursor-pointer font-bold">채용 업무 지표</summary><label className="mt-4 block text-sm">기준 월<input className="field mt-1 max-w-xs" type="month" value={selected} onChange={e=>setSelected(e.target.value || month)}/></label><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
    ['평균 요청 처리시간',m.meanHours===null?'자료 없음':m.meanHours.toFixed(1)+'시간',`선택 월 접수 중 처리 완료 ${m.completed}/${m.requests}건 · 달력 시간 기준`],
    ['면접 취소율',m.interviews?`${(100*m.cancelled/m.interviews).toFixed(1)}%`:'자료 없음',`선택 월 면접일 기준 ${m.cancelled}/${m.interviews}건`],
    ['지원·입사포기 비율',m.cohort?`${(100*m.forfeits/m.cohort).toFixed(1)}%`:'자료 없음',`선택 월 요청 접수 지원자의 현재 결과 ${m.forfeits}/${m.cohort}명`],
    ['평균 채용 소요일',m.meanJoinDays===null?'자료 없음':m.meanJoinDays.toFixed(1)+'일',`선택 월 실제 입사 ${m.joined}명 · 해당 공고 최초 요청부터 입사까지`]
  ].map(([title,value,caption])=><div className="rounded-xl border p-4" key={title}><h3 className="font-bold">{title}</h3><p className="my-2 text-xl font-bold">{value}</p><p className="text-xs leading-5 text-slate-500">{caption}</p></div>)}</div></details>;
}
