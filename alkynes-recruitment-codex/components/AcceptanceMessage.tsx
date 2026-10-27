'use client';
import { useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { Modal, Field } from './Forms';
import { copyText } from '@/lib/clipboard';
import { useRecruitment } from './RecruitmentProvider';
import { acceptanceMessage } from '@/lib/messages';
import type { Candidate } from '@/lib/recruitment';
function GrowingTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const element = ref.current;
    if (!element || !element.clientWidth) return;
    element.style.height = 'auto';
    const style = getComputedStyle(element);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    element.style.height = `${element.scrollHeight + border}px`;
  };
  useLayoutEffect(resize, [props.value]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let previousWidth = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== previousWidth) {
        previousWidth = element.clientWidth;
        resize();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <textarea {...props} ref={ref} rows={3} style={{ minHeight: 96, resize: 'none', overflow: 'hidden' }} />;
}
export function AcceptanceMessage({ person, role, onClose }: { person: Candidate; role: string; onClose: () => void }) {
  const {data,commit,saving,readOnly}=useRecruitment();
  const signature=JSON.stringify([person.name,role,person.actualJoin || '']);
  const saved=data.messageDrafts?.find(d=>d.id==='acceptance-'+person.id);
  const template=data.messageDrafts?.find(d=>d.id==='acceptance-template');
  const valid=saved?.signature===signature?saved:undefined;
  const [date, setDate] = useState(valid?.date ?? person.actualJoin?.slice(0, 10) ?? '');
  const [documents, setDocuments] = useState(valid?.documents ?? template?.documents ?? '');
  const [includeDocuments, setIncludeDocuments] = useState(valid?.includeDocuments ?? template?.includeDocuments ?? true);
  const [additional, setAdditional] = useState(valid?.additional ?? template?.additional ?? '');
  const [edited, setEdited] = useState<string | null>(valid?.text || null);
  const [status, setStatus] = useState('');
  const message = edited ?? acceptanceMessage(person.name, role, date, includeDocuments ? documents : null, additional);
  return <Modal title="합격 안내문" onClose={onClose}>
    <div className="space-y-4">
      {saved && !valid && <p className="text-sm text-amber-800">지원자 정보가 바뀌어 이전 초안 대신 최신 안내문을 작성합니다.</p>}
      <Field label="출근일"><input type="date" className="field" value={date} onChange={e => { setDate(e.target.value); setEdited(null); setStatus(''); }} /></Field>
      <p className="text-sm text-slate-500">출근시간 08시 30분 · 사무동 2층(면접 본 건물)<br/>날짜를 지정하지 않으면 전화로 협의한다고 안내합니다.</p>
      {includeDocuments ? <div className="relative">
        <button type="button" className="absolute right-0 top-0 flex h-7 w-7 items-center justify-center rounded-md border border-stone-300 hover:bg-red-50 hover:text-red-700" aria-label="제출서류 삭제" title="안내문에서 제출서류 제외" onClick={() => { setIncludeDocuments(false); setEdited(null); setStatus(''); }}>×</button>
        <Field label="제출서류"><GrowingTextarea aria-label="제출서류" className="field" value={documents} placeholder="필요한 서류를 입력해 주세요." onChange={e => { setDocuments(e.target.value); setEdited(null); setStatus(''); }} /></Field>
      </div> : <button type="button" className="btn-secondary" onClick={() => { setIncludeDocuments(true); setEdited(null); setStatus(''); }}>+ 제출서류 추가</button>}
      <Field label="기타 안내사항 (선택)"><GrowingTextarea aria-label="기타 안내사항 (선택)" className="field" value={additional} placeholder="필요한 안내를 자유롭게 작성해 주세요." onChange={e => { setAdditional(e.target.value); setEdited(null); setStatus(''); }} /></Field>
      <Field label="카톡에 보낼 내용"><GrowingTextarea aria-label="카톡에 보낼 내용" className="field" value={message} onChange={e => { setEdited(e.target.value); setStatus(''); }} /></Field>
      <p className="text-sm text-slate-500">출근일·제출서류를 확인한 뒤 복사해 직접 보내세요. 앱에서 자동 발송하지 않습니다.</p>
      <button className="btn-primary" disabled={includeDocuments && !documents.trim()} onClick={async () => {
        try { await copyText(message); setStatus('복사했습니다. 카톡에 붙여넣어 주세요.'); }
        catch { setStatus('자동 복사가 지원되지 않습니다. 안내문을 길게 누르거나 선택해 복사해 주세요.'); }
      }}>안내문 복사</button>
      {!readOnly && <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={saving} onClick={async()=>{if(await commit('합격 안내문 초안 저장',d=>{d.messageDrafts=(d.messageDrafts || []).filter(x=>x.id!=='acceptance-'+person.id);d.messageDrafts.push({id:'acceptance-'+person.id,candidateId:person.id,kind:'acceptance',audience:'candidate',signature,text:message,date,documents,additional,includeDocuments,updatedAt:new Date().toISOString()});}))setStatus('이 지원자의 초안을 저장했습니다.');}}>초안 저장</button><button className="btn-secondary" disabled={saving} onClick={async()=>{if(await commit('합격 안내 공통 양식 저장',d=>{d.messageDrafts=(d.messageDrafts || []).filter(x=>x.id!=='acceptance-template');d.messageDrafts.push({id:'acceptance-template',candidateId:'',kind:'template',audience:'candidate',signature:'template',text:'',documents,additional,includeDocuments,updatedAt:new Date().toISOString()});}))setStatus('제출서류·기타 안내를 공통 양식으로 저장했습니다.');}}>공통 양식 저장</button></div>}
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  </Modal>;
}
