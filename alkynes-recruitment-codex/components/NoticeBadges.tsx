'use client';
import { useRecruitment } from './RecruitmentProvider';
import { noticeState, type NoticeTarget } from '@/lib/workspace';
import { formatDate } from '@/lib/recruitment';
export function NoticeBadges({ target }: { target: NoticeTarget }) {
  const { data } = useRecruitment();
  const audiences = target.kind === 'aptitude' ? ['internal'] as const : ['candidate', 'internal'] as const;
  return <div className="mt-3 flex flex-wrap gap-2" aria-label="카톡 안내 상태">{audiences.map(audience => {
    const state = noticeState(data, target, audience);
    return <span key={audience} title={state.saved ? '마지막 표시: ' + formatDate(state.saved.at) : ''} className={'badge ' + (state.current ? 'bg-emerald-50 text-emerald-800' : state.saved ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600')}>
      {audience === 'candidate' ? '지원자' : '사내'} · {state.current ? '안내 완료' : state.saved ? '변경 · 재안내 필요' : '미안내'}
    </span>;
  })}</div>;
}
