'use client';
import { useRecruitment } from './RecruitmentProvider';
import { candidateTimeline } from '@/lib/workspace';
import { formatDate } from '@/lib/recruitment';
export function CandidateTimeline({ candidateId, expanded = false }: { candidateId: string; expanded?: boolean }) {
  const { data } = useRecruitment(), items = candidateTimeline(data, candidateId);
  return <details open={expanded} className="my-4 rounded-xl border p-4"><summary className="cursor-pointer font-semibold">지원자 진행 이력 · {items.length}건</summary><ol className="mt-4 max-h-80 space-y-4 overflow-y-auto">{items.map(item => <li key={item.id} className="border-l-2 border-teal-200 pl-3"><p className="text-xs text-slate-500">{formatDate(item.at)}</p><p className="mt-1 text-sm font-semibold">{item.title}</p>{item.detail && <p className="mt-1 text-sm text-slate-600">{item.detail}</p>}</li>)}</ol>{!items.length && <p className="mt-3 text-sm text-slate-500">아직 기록된 일정이 없습니다.</p>}<p className="mt-3 text-xs text-slate-500">엑셀 변경 이력의 날짜는 앱 반영 시각입니다. 실제 전형 진행일과 다를 수 있습니다.</p></details>;
}
