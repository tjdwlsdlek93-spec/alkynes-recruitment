'use client';
import { copyText } from '@/lib/clipboard';
import { reloadCurrentPage, useAppVersion } from '@/lib/app-version';
import { useState } from 'react';
import { Modal } from './Forms';
import { useRecruitment } from './RecruitmentProvider';
import { interviewRoom, type Audience } from '@/lib/messages';
import { markNotice, noticeSignature, noticeState, type NoticeTarget } from '@/lib/workspace';
export function ShareMessage({ title, generate, onClose, internalOnly = false, target }: { title: string; internalOnly?: boolean; generate: (audience: Audience) => string; onClose: () => void; target?: NoticeTarget }) {
  const { outdated } = useAppVersion();
  const { data, commit, saving, readOnly } = useRecruitment();
  const savedDraft=(a:Audience)=>data.messageDrafts?.find(d=>d.id===`${target?.kind}-${target?.id}-${a}` && d.signature===noticeSignature(data,target!));
  const [audience, setAudience] = useState<Audience>('internal'), [text, setText] = useState(() => (target && savedDraft('internal')?.text) || generate('internal')), [message, setMessage] = useState('');
  const [signature, setSignature] = useState(() => target ? noticeSignature(data, target) : '');
  const state = target ? noticeState(data, target, audience) : undefined;
  const stale = !!target && (!noticeSignature(data, target) || signature !== noticeSignature(data, target));
  const interview = target?.kind === 'interview' ? data.interviews.find(i => i.id === target.id) : undefined;
  const differentRoom = interview && interview.location && !/미입력|미지정|미정/.test(interview.location) && interview.location.replace(/\s+/g,'') !== interviewRoom.replace(/\s+/g,'');
  async function copy() {
    if (outdated) return;
    try { await copyText(text); setMessage('복사했습니다. 카카오톡에 전송한 뒤 안내 완료로 표시해 주세요.'); }
    catch { setMessage('아래 안내문을 직접 선택해 복사해 주세요.'); }
  }
  async function mark() {
    if (!target || stale) return;
    const done = !state?.current;
    if (await commit((audience === 'candidate' ? '지원자' : '사내') + ' 카톡 안내 ' + (done ? '완료 표시' : '표시 해제'), draft => markNotice(draft, target, audience, signature, done))) setMessage(done ? '안내 완료로 저장했습니다.' : '미안내로 변경했습니다.');
  }
  function regenerate(next = audience) { setAudience(next); setText((target && savedDraft(next)?.text) || generate(next)); setSignature(target ? noticeSignature(data, target) : ''); setMessage(''); }
  return <Modal title={title} onClose={onClose}>
    <p className="mb-4 text-sm leading-6 text-slate-500">내용을 확인해 카카오톡에 붙여넣어 전송하세요. 복사는 발송 완료로 처리되지 않습니다.</p>
    {outdated && <p role="alert" className="mb-4 text-sm text-amber-800">새 버전의 안내문이 있습니다. 작성한 내용을 확인한 뒤 <button className="underline" onClick={reloadCurrentPage}>새 버전 안내문 불러오기</button>를 눌러 주세요.</p>}
    {differentRoom && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">엑셀 장소는 「{interview.location}」입니다. 안내문은 기본 장소 「{interviewRoom}」로 작성되므로 실제 장소에 맞게 아래 문구를 확인·수정해 주세요.</p>}
    {!internalOnly && <label className="block text-sm font-medium">공유 대상<select aria-label="공유 대상" className="field mt-2" value={audience} onChange={e => regenerate(e.target.value as Audience)}><option value="internal">사내 담당자 공유</option><option value="candidate">지원자 안내</option></select></label>}
    <label className="mt-4 block text-sm font-medium">공유 안내문<textarea aria-label="공유 안내문" className="field mt-2 leading-7" rows={13} value={text} onChange={e => { setText(e.target.value); setMessage(''); }}/></label>
    {target && <p className="mt-3 text-sm font-semibold">{state?.current ? '안내 완료' : state?.saved ? '일정 변경 · 재안내 필요' : '미안내'}</p>}
    {stale && <p role="alert" className="mt-3 text-sm text-amber-800">작성 중 원본 정보가 바뀌었습니다. <button className="underline" onClick={() => regenerate()}>최신 안내문 다시 작성</button></p>}
    {target && !readOnly && <div className="mt-4 flex flex-wrap gap-3"><button className="btn-secondary" disabled={saving || stale || !text.trim()} onClick={async()=>{if(await commit('안내문 초안 저장',d=>{const id=`${target.kind}-${target.id}-${audience}`;d.messageDrafts=(d.messageDrafts || []).filter(x=>x.id!==id);const row=target.kind==='interview'?d.interviews.find(i=>i.id===target.id):d.requests?.find(q=>q.id===target.id);d.messageDrafts.push({id,candidateId:row?.candidateId || '',kind:target.kind,audience,text,signature,updatedAt:new Date().toISOString()});}))setMessage('초안을 저장했습니다.');}}>초안 저장</button>
      {audience==='candidate' && state?.current && <label className="text-sm">지원자 회신<select className="field mt-1" aria-label="지원자 회신" disabled={saving || stale} value={state.saved?.reply || '회신 대기'} onChange={e=>{const reply=e.target.value as '회신 대기'|'참석 확정'|'일정 재협의';void commit('지원자 회신 '+reply,d=>{const n=d.sharedNotices?.find(n=>n.kind===target.kind && n.targetId===target.id && n.audience===audience);if(!n || n.signature!==noticeSignature(d,target))throw Error('일정이 변경되었습니다. 다시 안내해 주세요.');n.reply=reply;n.replyAt=new Date().toISOString();});}}><option>회신 대기</option><option>참석 확정</option><option>일정 재협의</option></select></label>}</div>}
    {message && <p role="status" className="mt-3 text-sm text-teal-700">{message}</p>}
    <div className="mt-4 flex flex-wrap justify-end gap-2"><button className="btn-secondary" onClick={onClose}>닫기</button><button className="btn-primary" disabled={!text.trim() || stale || outdated} onClick={() => void copy()}>카톡 메시지 복사</button>{target && !readOnly && <button className="btn-secondary" disabled={saving || stale} onClick={() => void mark()}>{state?.current ? '미안내로 변경' : '안내 완료로 표시'}</button>}</div>
  </Modal>;
}
