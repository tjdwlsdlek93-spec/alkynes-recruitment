'use client';
import { useState } from 'react';
import { Modal, Field } from './Forms';
import { acceptanceMessage } from '@/lib/messages';
import type { Candidate } from '@/lib/recruitment';
export function AcceptanceMessage({ person, role, onClose }: { person: Candidate; role: string; onClose: () => void }) {
  const [date, setDate] = useState(person.expectedJoin?.slice(0, 10) || '');
  const [documents, setDocuments] = useState('');
  const [edited, setEdited] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const message = edited ?? acceptanceMessage(person.name, role, date, documents);
  return <Modal title="합격 안내문" onClose={onClose}>
    <div className="space-y-4">
      <Field label="출근일"><input type="date" className="field" value={date} onChange={e => { setDate(e.target.value); setEdited(null); setStatus(''); }} /></Field>
      <p className="text-sm text-slate-500">출근시간 08시 30분 · 사무동 2층(면접 본 건물)</p>
      <Field label="제출서류"><textarea className="field min-h-24" value={documents} placeholder="필요한 서류를 입력해 주세요." onChange={e => { setDocuments(e.target.value); setEdited(null); setStatus(''); }} /></Field>
      <Field label="카톡에 보낼 내용"><textarea className="field min-h-72" value={message} onChange={e => { setEdited(e.target.value); setStatus(''); }} /></Field>
      <p className="text-sm text-slate-500">출근일·제출서류를 확인한 뒤 복사해 직접 보내세요. 앱에서 자동 발송하지 않습니다.</p>
      <button className="btn-primary" disabled={!date || !documents.trim()} onClick={async () => {
        try { await navigator.clipboard.writeText(message); setStatus('복사했습니다. 카톡에 붙여넣어 주세요.'); }
        catch { setStatus('자동 복사가 지원되지 않습니다. 안내문을 길게 누르거나 선택해 복사해 주세요.'); }
      }}>안내문 복사</button>
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  </Modal>;
}
