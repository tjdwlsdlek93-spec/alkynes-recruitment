'use client';
import { useState } from 'react';
import { Modal } from './Forms';
import type { Audience } from '@/lib/messages';
export function ShareMessage({ title, generate, onClose, internalOnly = false }: { title: string; internalOnly?: boolean; generate: (audience: Audience) => string; onClose: () => void }) {
  const [audience, setAudience] = useState<Audience>('internal'), [text, setText] = useState(() => generate('internal')), [message, setMessage] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(text); setMessage('복사했습니다. 카카오톡 대화방에 붙여넣어 전송하세요.'); }
    catch { setMessage('자동 복사를 사용할 수 없습니다. 아래 안내문을 직접 선택해 복사해 주세요.'); }
  }
  return <Modal title={title} onClose={onClose}><p className="mb-4 text-sm leading-6 text-slate-500">카카오톡에 붙여넣을 안내문입니다. 받는 사람·일정·장소를 확인하고 필요한 내용을 수정하세요. 자동 발송되지는 않습니다.</p>
    {!internalOnly && <label className="block text-sm font-medium">공유 대상<select aria-label="공유 대상" className="field mt-2" value={audience} onChange={e => { const next = e.target.value as Audience; setAudience(next); setText(generate(next)); setMessage(''); }}><option value="internal">사내 담당자 공유</option><option value="candidate">지원자 안내</option></select></label>}
    <label className="mt-4 block text-sm font-medium">공유 안내문<textarea aria-label="공유 안내문" className="field mt-2 leading-7" rows={13} value={text} onChange={e => { setText(e.target.value); setMessage(''); }}/></label>
    {message && <p role="status" className="mt-3 text-sm text-teal-700">{message}</p>}
    <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>닫기</button><button className="btn-primary" disabled={!text.trim()} onClick={() => void copy()}>카톡 메시지 복사</button></div>
  </Modal>;
}
