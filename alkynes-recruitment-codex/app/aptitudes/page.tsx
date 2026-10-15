'use client';
import { useState, type FormEvent } from 'react';
import { useRecruitment } from '@/components/RecruitmentProvider';
import { Modal, Field, Actions, Empty, value } from '@/components/Forms';
import { MessageLauncher } from '@/components/MessageLauncher';
import { ShareMessage } from '@/components/ShareMessage';
import { aptitudeMessage } from '@/lib/messages';
import { closedJob } from '@/lib/recruitment-view';
import { endedCandidate } from '@/lib/candidate-state';
import { newStamp, formatDate, localDateTime, type ProcessRequest } from '@/lib/recruitment';
import { defaultDueDate } from '@/lib/scheduling';
export default function Page() {
  const { data, commit } = useRecruitment();
  const [editing, setEditing] = useState<ProcessRequest | null | undefined>(), [sharing, setSharing] = useState<ProcessRequest | null>(null), [job, setJob] = useState(''), [group, setGroup] = useState('active'), [error, setError] = useState('');
  const all = (data.requests || []).filter(q => q.stage === '인적성 검사 요청');
  const ended = (q: ProcessRequest) => q.status === '취소' || q.examStatus === '실시완료' || data.candidates.some(c => c.id === q.candidateId && endedCandidate(c)) || data.requisitions.some(r => r.id === q.requisitionId && (closedJob(r) || r.excelMissing));
  const shareable = all.filter(q => q.status !== '취소' && !data.candidates.some(c => c.id === q.candidateId && endedCandidate(c)));
  const rows = all.filter(q => (!job || q.requisitionId === job) && (group === 'all' || ended(q) === (group === 'ended'))).sort((a,b) => b.receivedAt.localeCompare(a.receivedAt));
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    const f = new FormData(e.currentTarget), person = data.candidates.find(c => c.id === value(f, 'candidateId'));
    if (!person) { setError('지원자를 선택해 주세요.'); return; }
    const iso = (key: string) => value(f, key) ? new Date(value(f, key) + ':00+09:00').toISOString() : '';
    const status = value(f, 'status') as ProcessRequest['status'];
    const fields = { candidateId: person.id, requisitionId: person.requisitionId, stage: '인적성 검사 요청' as const, receivedAt: iso('receivedAt'), dueAt: iso('dueAt'), completedAt: status === '요청 전' ? '' : iso('completedAt'), status, examAt: iso('examAt'), examStatus: value(f,'examStatus') as ProcessRequest['examStatus'], owner: value(f,'owner'), notes: value(f,'notes') };
    if (status === '요청 완료' && !fields.completedAt) { setError('요청 처리 완료일시를 입력해 주세요. 검사 실시일과는 별개입니다.'); return; }
    if ((fields.dueAt && fields.dueAt < fields.receivedAt) || (fields.completedAt && fields.completedAt < fields.receivedAt)) { setError('기한과 처리 완료일시는 요청일 이후여야 합니다.'); return; }
    if (fields.examStatus === '실시완료' && !fields.examAt) { setError('검사 실시일시를 입력해 주세요.'); return; }
    if (commit('인적성 검사 요청 저장: ' + person.name, d => {
      d.requests ||= [];
      if (editing) Object.assign(d.requests.find(q => q.id === editing.id)!, fields, { updatedAt: new Date().toISOString() });
      else d.requests.unshift({ ...newStamp(), ...fields, excelJobId: '', round: Math.max(0,...d.requests.filter(q => q.candidateId === person.id && q.stage === fields.stage).map(q => q.round)) + 1 });
    })) setEditing(undefined);
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">인적성 관리</h1><p className="mt-2 text-sm text-slate-500">지원자별 요청 처리와 검사 실시를 각각 관리합니다. 요청 처리 완료가 검사 실시 완료를 뜻하지는 않습니다.</p></div></div>
    <div className="flex flex-wrap items-center gap-3"><div className="segmented" aria-label="인적성 분류" role="group">{[['active','진행중'],['ended','완료·종료'],['all','전체']].map(([key,label]) => <button key={key} className={group===key?'selected':''} aria-pressed={group===key} onClick={() => setGroup(key)}>{label}<span>{all.filter(q => (!job || q.requisitionId===job) && (key==='all' || ended(q)===(key==='ended'))).length}</span></button>)}</div><select aria-label="인적성 채용공고 필터" className="field max-w-sm" value={job} onChange={e => setJob(e.target.value)}><option value="">전체 채용공고</option>{data.requisitions.map(r => <option key={r.id} value={r.id}>{r.role} · {r.department}</option>)}</select></div>
    <div className="flex flex-wrap items-center gap-3"><MessageLauncher kind="인적성" records={shareable.map(q => ({ id: q.id, label: (data.candidates.find(c => c.id === q.candidateId)?.name || '공통 요청') + ' · ' + q.round + '회차 · ' + q.status, generate: audience => aptitudeMessage(data, q, audience) }))} /><span className="text-sm text-slate-500">공유 가능한 인적성 요청 {shareable.length}건 · 기록이 없으면 예시를 확인할 수 있습니다.</span></div>
    <p className="text-sm text-slate-500">인적성 요청은 엑셀에서 등록합니다. 각 요청 카드의 「카톡 안내문」 버튼에서 문구를 확인·복사할 수 있습니다.</p>
    <p className="text-xs leading-6 text-slate-500">앱 수정은 엑셀에 쓰이지 않습니다. 엑셀 연결 기록의 요청일·검사 일정 등 원본 항목은 다음 동기화 시 원본 값으로 갱신됩니다. 앱에서 기록한 검사 실시 상태는 유지됩니다.</p>
    <div className="space-y-4">{rows.map(q => { const person = data.candidates.find(c=>c.id===q.candidateId), r=data.requisitions.find(r=>r.id===q.requisitionId); return <article className="card p-5" key={q.id}><div className="flex flex-wrap justify-between gap-4"><div><p className="text-xs text-slate-500">{r?.role} · {r?.department}</p><h2 className="mt-2 text-lg font-bold">{person?.name || '공통 요청 (지원자 미지정)'} <span className="text-sm font-normal text-slate-500">{q.round}회차</span></h2></div><div className="flex flex-wrap gap-2"><span className="badge bg-teal-50 text-teal-800">요청: {q.status}</span><span className="badge bg-slate-100">검사: {q.examStatus || '미실시'}</span></div></div><div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><p>요청일: {q.receivedAt ? formatDate(q.receivedAt) : '미입력'}</p><p>처리기한: {q.dueAt ? formatDate(q.dueAt) : '미입력'}</p><p>검사 일정: {q.examAt ? formatDate(q.examAt) : '미정'}</p><p>담당자: {q.owner || '미지정'}</p></div>{q.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-500">{q.notes}</p>}<div className="mt-4 flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => { setEditing(q); setError(''); }}>상세 / 수정</button><button className="btn-primary" onClick={() => setSharing(q)}>카톡 안내문</button></div></article>; })}{!rows.length && <div className="card"><Empty>해당하는 인적성 요청이 없습니다. 엑셀의 요청 구분이 「인적성 검사 요청」인지 확인하고 엑셀 업데이트를 누르세요. 완료·종료 또는 전체 분류에서도 확인할 수 있습니다.</Empty></div>}</div>
    {sharing && <ShareMessage title="인적성 카톡 안내문" generate={audience => aptitudeMessage(data, sharing, audience)} onClose={() => setSharing(null)} />}
    {editing !== undefined && <Modal title={editing ? '인적성 요청 수정' : '인적성 요청 등록'} onClose={() => setEditing(undefined)}><form onSubmit={save} className="grid gap-4 sm:grid-cols-2"><Field label="지원자 *"><select className="field" name="candidateId" required defaultValue={editing?.candidateId || ''} disabled={!!editing?.candidateId}><option value="">지원자 선택</option>{data.candidates.filter(c => editing?.candidateId===c.id || (!endedCandidate(c) && !c.excelMissing)).map(c=><option key={c.id} value={c.id}>{c.name} · {data.requisitions.find(r=>r.id===c.requisitionId)?.role}</option>)}</select>{editing?.candidateId && <input type="hidden" name="candidateId" value={editing.candidateId}/>}</Field><Field label="요청 처리 상태"><select className="field" name="status" defaultValue={editing?.status || '요청 전'}>{['요청 전','요청 완료','취소'].map(s=><option key={s}>{s}</option>)}</select></Field>
      <Field label="요청일시 *"><input className="field" name="receivedAt" type="datetime-local" required defaultValue={localDateTime(editing?.receivedAt || new Date().toISOString())}/></Field><Field label="처리기한"><input className="field" name="dueAt" type="datetime-local" defaultValue={editing ? localDateTime(editing.dueAt || '') : defaultDueDate(localDateTime(new Date().toISOString()))}/></Field><Field label="요청 처리 완료일시"><input className="field" name="completedAt" type="datetime-local" defaultValue={localDateTime(editing?.completedAt || '')}/></Field><Field label="검사 예정 / 실시일시"><input className="field" name="examAt" type="datetime-local" defaultValue={localDateTime(editing?.examAt || '')}/></Field><Field label="검사 실시 상태"><select className="field" name="examStatus" defaultValue={editing?.examStatus || (editing?.examAt ? '검사예정' : '미실시')}>{['미실시','검사예정','실시완료'].map(s=><option key={s}>{s}</option>)}</select></Field><Field label="담당자"><input className="field" name="owner" maxLength={80} defaultValue={editing?.owner}/></Field><Field label="메모"><textarea className="field" name="notes" maxLength={2000} rows={3} defaultValue={editing?.notes}/></Field>{error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}<Actions onCancel={()=>setEditing(undefined)}/></form></Modal>}
  </div>;
}
