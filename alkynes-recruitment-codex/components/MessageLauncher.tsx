'use client';
import { useState } from 'react';
import { Modal } from './Forms';
import { ShareMessage } from './ShareMessage';
import { sampleMessage, type Audience } from '@/lib/messages';
type Record = { id: string; label: string; generate: (audience: Audience) => string };
export function MessageLauncher({ kind, records }: { kind: '인적성' | '면접'; records: Record[] }) {
  const [choosing, setChoosing] = useState(false), [selected, setSelected] = useState(''), [sharing, setSharing] = useState<Record | null>(null);
  function open() {
    if (records.length) { setSelected(''); setChoosing(true); }
    else setSharing({ id: 'sample', label: '예시', generate: audience => sampleMessage(kind, audience) });
  }
  return <><button className="btn-primary" onClick={open}>카톡 안내문 작성</button>
    {choosing && <Modal title="안내문 대상 선택" onClose={() => setChoosing(false)}><label className="block text-sm">공유할 요청 / 일정<select aria-label="안내문 대상" className="field mt-2" value={selected} onChange={e => setSelected(e.target.value)}><option value="">대상 선택</option>{records.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label><div className="mt-4 flex justify-end"><button className="btn-primary" disabled={!selected} onClick={() => { const record = records.find(r => r.id === selected); if (record) { setChoosing(false); setSharing(record); } }}>안내문 열기</button></div></Modal>}
    {sharing && <ShareMessage internalOnly={kind === '인적성'} title={kind + (sharing.id === 'sample' ? ' 안내문 예시' : ' 카톡 안내문')} generate={records.find(r => r.id === sharing.id)?.generate || sharing.generate} target={sharing.id === 'sample' ? undefined : { kind: kind === '면접' ? 'interview' : 'aptitude', id: sharing.id }} onClose={() => setSharing(null)} />}
  </>;
}
