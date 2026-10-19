'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { NoticeBadges } from '@/components/NoticeBadges';
import { interviewConflicts } from '@/lib/workspace';
import { interviewGroup } from '@/lib/interview-state';
import { MessageLauncher } from '@/components/MessageLauncher';
import { ShareMessage } from '@/components/ShareMessage';
import { interviewMessage } from '@/lib/messages';
import { candidateStatus, endedCandidate } from '@/lib/candidate-state';
import { useRecruitment } from '@/components/RecruitmentProvider';
import { Modal, Field, Actions, Empty, value } from '@/components/Forms';
import {
  newStamp,
  formatDate,
  localDateTime,
  calendarFile,
  download,
  type Interview,
} from '@/lib/recruitment';
export default function Page() {
  const { data, commit } = useRecruitment();
  const [editing, setEditing] = useState<Interview | null | undefined>(),
    [candidate, setCandidate] = useState(''),
    [job, setJob] = useState(''),
    [group, setGroup] = useState('scheduled'),
    [sharing, setSharing] = useState<Interview | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('candidate') || '';
    setCandidate(id);
    const person = data.candidates.find(c => c.id === id);
    if (person) {
      setJob(person.requisitionId);
      const related = data.interviews.filter(i => i.candidateId === id).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
      const upcoming = related.find(i => i.status === '면접예정' && Date.parse(i.startsAt) >= Date.now());
      if (upcoming || related[0]) setGroup(classify(upcoming || related[0]));
    }
  }, []);
  const close = () => setEditing(undefined);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (editing?.source === 'kpi-excel') {
      if (await commit('면접 앱 메모·소요시간 저장', draft => {
        const row = draft.interviews.find(i => i.id === editing.id);
        if (!row) throw Error('원본 일정이 변경되었습니다. 다시 확인해 주세요.');
        row.durationMinutes = Number(f.get('durationMinutes'));
        row.appNotes = value(f, 'appNotes');
      })) close();
      return;
    }
    const fields = {
      candidateId: value(f, 'candidateId'),
      startsAt: new Date(value(f, 'startsAt') + ':00+09:00').toISOString(),
      location: value(f, 'location'),
      interviewers: [
        ...new Set(
          value(f, 'interviewers')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ],
      status: value(f, 'status') as Interview['status'],
      durationMinutes: Number(f.get('durationMinutes')),
      appNotes: value(f, 'appNotes'),
    };
    if (
      await commit(
        '면접 일정 ' +
          (data.candidates.find((c) => c.id === fields.candidateId)?.name ||
            '') +
          ': ' +
          (editing?.status || '신규') +
          ' → ' +
          fields.status,
        (d) => {
          if (editing) {
            if (
              d.evaluations.some(
                (e) =>
                  e.interviewId === editing.id &&
                  !fields.interviewers.includes(e.evaluator),
              )
            )
              throw Error('제출된 평가가 있는 면접관은 제거할 수 없습니다.');
            Object.assign(
              d.interviews.find((i) => i.id === editing.id)!,
              fields,
              { updatedAt: new Date().toISOString() },
            );
          } else d.interviews.unshift({ ...newStamp(), ...fields });
          const c = d.candidates.find((c) => c.id === fields.candidateId)!;
          if (
            ['검토중', '서류합격', '일정조율', '면접예정', '면접완료'].includes(
              c.status,
            ) &&
            fields.status !== '취소'
          )
            Object.assign(c, {
              status: fields.status,
              updatedAt: new Date().toISOString(),
            });
          if (
            fields.status === '취소' &&
            c.status === '면접예정' &&
            !d.interviews.some(
              (i) => i.candidateId === c.id && i.status === '면접예정',
            )
          )
            Object.assign(c, {
              status: '일정조율',
              updatedAt: new Date().toISOString(),
            });
        },
      )
    )
      close();
  }
  const classify = (i: Interview) => interviewGroup(data, i);
  const scope = data.interviews.filter(i => {
    const person = data.candidates.find(c => c.id === i.candidateId);
    return (!candidate || i.candidateId === candidate) && (!job || person?.requisitionId === job);
  });
  const rows = scope.filter(i => classify(i) === group).sort((a, b) => group === 'completed' ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const jobs = data.requisitions.filter(r => rows.some(i => data.candidates.find(c => c.id === i.candidateId)?.requisitionId === r.id)).sort((a, b) => {
    const date = (id: string) => rows.find(i => data.candidates.find(c => c.id === i.candidateId)?.requisitionId === id)?.startsAt || '';
    return group === 'completed' ? date(b.id).localeCompare(date(a.id)) : date(a.id).localeCompare(date(b.id));
  });
  const conflicts = interviewConflicts(data);
  const shared = sharing ? data.interviews.find(i => i.id === sharing.id) || sharing : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">면접 일정</h1>
          <p className="mt-1 text-sm text-slate-500">
            예정·완료 일정을 채용공고별로 확인합니다. 날짜가 지났어도 완료가 확인되지 않은 면접은 확인 필요로 표시합니다.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3"><MessageLauncher kind="면접" records={data.interviews.filter(i => classify(i) !== 'cancelled').map(i => ({ id: i.id, label: (data.candidates.find(c => c.id === i.candidateId)?.name || '미지정') + ' · ' + formatDate(i.startsAt) + ' · ' + i.status, generate: audience => interviewMessage(data, i, audience) }))} /><span className="text-sm text-slate-500">공유 가능한 일정 {data.interviews.filter(i => classify(i) !== 'cancelled').length}건 · 기록이 없으면 예시를 확인할 수 있습니다.</span></div>
      <p className="text-sm text-slate-500">안내문은 각 면접 카드의 「카톡 안내문」 버튼에서 확인합니다. 일정이 없다면 엑셀 연동 후 분류·공고 필터를 확인하세요.</p>
      <div className="segmented w-fit max-w-full flex-wrap" role="group" aria-label="면접 일정 분류">
        {([['scheduled', '예정'], ['review', '확인 필요'], ['completed', '완료'], ['cancelled', '취소']] as const).map(([key, label]) => <button key={key} aria-pressed={group === key} className={group === key ? 'selected' : ''} onClick={() => setGroup(key)}>{label}<span>{scope.filter(i => classify(i) === key).length}</span></button>)}
      </div>
      <div className="flex flex-wrap gap-3">
        <select aria-label="면접 채용공고 필터" className="field max-w-sm" value={job} onChange={e => { setJob(e.target.value); setCandidate(''); }}>
          <option value="">전체 채용공고</option>
          {data.requisitions.map(r => <option key={r.id} value={r.id}>{r.role} · {r.department} · {r.code}</option>)}
        </select>
        <select aria-label="면접 지원자 필터" className="field max-w-sm" value={candidate} onChange={e => setCandidate(e.target.value)}>
          <option value="">전체 지원자</option>
          {data.candidates.filter(c => !job || c.requisitionId === job).map(c => <option key={c.id} value={c.id}>{c.name} · {data.requisitions.find(r => r.id === c.requisitionId)?.role}</option>)}
        </select>
      </div>
      {conflicts.length > 0 && <section className="card space-y-3 border-red-200 bg-red-50 p-5" aria-label="면접 일정 겹침"><h2>일정 겹침 {conflicts.length}건</h2><p className="text-xs text-slate-600">입력한 소요시간 기준입니다. 미입력 시 60분으로 확인합니다.</p>{conflicts.map(pair => <p key={pair.first.id + pair.second.id} className="text-sm text-red-800">{data.candidates.find(c => c.id === pair.first.candidateId)?.name} / {data.candidates.find(c => c.id === pair.second.candidateId)?.name} · {formatDate(pair.first.startsAt)} · {pair.reasons.join(' / ')}</p>)}</section>}
      {jobs.map(jobRow => <section key={jobRow.id} className="space-y-3" aria-label={'채용공고: ' + jobRow.role}>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-100 bg-teal-50 px-5 py-4"><div><h2 className="font-bold text-teal-900">{jobRow.role}</h2><p className="mt-1 text-xs text-teal-700">{jobRow.department} · {jobRow.code}</p></div><span className="badge bg-white text-teal-800">{rows.filter(i => data.candidates.find(c => c.id === i.candidateId)?.requisitionId === jobRow.id).length}건</span></div>
        <div className="grid gap-4 lg:grid-cols-2">
        {rows.filter(i => data.candidates.find(c => c.id === i.candidateId)?.requisitionId === jobRow.id).map((i) => {
          const c = data.candidates.find((c) => c.id === i.candidateId)!;
          const r = data.requisitions.find((r) => r.id === c.requisitionId)!;
          return (
            <div className="card p-5" key={i.id}>
              <div className="flex justify-between gap-2">
                <span className="text-sm text-slate-500">
                  {formatDate(i.startsAt)}
                </span>
                <span className={"badge " + (group === 'completed' ? 'bg-slate-100 text-slate-600' : group === 'review' ? 'bg-amber-50 text-amber-800' : 'bg-teal-50 text-teal-700')}>{classify(i) === 'review' ? '확인 필요' : classify(i) === 'cancelled' && i.status !== '취소' ? '전형 종료' : i.status}</span>
              </div>
              {classify(i) === 'review' && i.status === '면접예정' && <p className="mt-2 text-xs text-amber-800">예정 시간이 지났습니다. 면접 실시 여부를 확인해 주세요.</p>}
              {classify(i) === 'cancelled' && endedCandidate(c) && <p className="mt-2 text-xs text-slate-600">지원자 최종 상태: {candidateStatus(c)} · 미완료 일정은 취소 분류로 보관합니다.</p>}
              {i.verification && classify(i) === 'review' && (
                <p className="mt-2 text-xs text-amber-800">
                  확인 필요: {i.verification}
                </p>
              )}
              <div className="mt-2 font-bold">
                {r.department} · {c.name}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {i.location} · {i.interviewers.join(' / ')} · {i.durationMinutes || 60}분{!i.durationMinutes && ' (기본)'}
              </div>
              <NoticeBadges target={{ kind: 'interview', id: i.id }} />
              {i.appNotes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">개인 메모: {i.appNotes}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => setEditing(i)}>
                  {i.source === 'kpi-excel' ? '상세 / 앱 메모' : '일정 수정'}
                </button>
                {classify(i) !== 'cancelled' && (
                  <>
<button className="btn-secondary" onClick={() => setSharing(i)}>카톡 안내문</button>
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        download(
                          '면접-' + c.name + '.ics',
                          calendarFile(i, c),
                          'text/calendar;charset=utf-8',
                        )
                      }
                    >
                      캘린더 다운로드
                    </button>
                    <Link
                      href={'/evaluations?interview=' + i.id}
                      className="btn-primary"
                    >
                      평가 작성 / 보기
                    </Link>
                  </>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </section>)}
      {!rows.length && (
        <div className="card">
          <Empty>
            선택한 분류와 채용공고에 해당하는 면접이 없습니다.
          </Empty>
        </div>
      )}
      {shared && <ShareMessage target={{ kind: 'interview', id: shared.id }} title="면접 일정 카톡 안내문" generate={audience => interviewMessage(data, shared, audience)} onClose={() => setSharing(null)} />}
      {editing !== undefined && (
        <Modal
          title={editing?.source === 'kpi-excel' ? '면접 상세 / 앱 메모' : editing ? '면접 일정 수정' : '면접 일정 등록'}
          onClose={close}
        >
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
            {editing?.source === 'kpi-excel' && <p className="sm:col-span-2 rounded-xl bg-amber-50 p-3 text-sm">일시·장소·면접관·진행상태는 엑셀에서 수정하세요. 소요시간과 개인 메모는 앱에만 저장되며 연동 후에도 유지됩니다.</p>}
            <fieldset className="contents" disabled={editing?.source === 'kpi-excel'}>
            <Field label="지원자 *">
              <select
                className="field"
                name="candidateId"
                required
                defaultValue={editing?.candidateId || candidate || ''}
                disabled={!!editing}
              >
                <option value="">지원자 선택</option>
                {data.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ·{' '}
                    {
                      data.requisitions.find((r) => r.id === c.requisitionId)
                        ?.code
                    }
                  </option>
                ))}
              </select>
              {editing && (
                <input
                  type="hidden"
                  name="candidateId"
                  value={editing.candidateId}
                />
              )}
            </Field>
            <Field label="면접일시 *">
              <input
                className="field"
                type="datetime-local"
                name="startsAt"
                required
                defaultValue={localDateTime(editing?.startsAt || '')}
              />
            </Field>
            <Field label="장소 *">
              <input
                className="field"
                name="location"
                required
                maxLength={200}
                defaultValue={editing?.location}
              />
            </Field>
            <Field label="면접관 * (쉼표로 구분)">
              <input
                className="field"
                name="interviewers"
                required
                maxLength={300}
                placeholder="박팀장, 이부장"
                defaultValue={editing?.interviewers.join(', ')}
              />
            </Field>
            <Field label="면접 상태">
              <select
                className="field"
                name="status"
                defaultValue={editing?.status || '면접예정'}
              >
                {['면접예정', '면접완료', '취소', '확인 필요'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            </fieldset>
            <Field label="면접 소요시간 (분)"><input className="field" name="durationMinutes" type="number" min="5" max="480" step="5" required defaultValue={editing?.durationMinutes || 60}/></Field>
            <Field label="개인 메모 (앱에만 저장)"><textarea className="field" name="appNotes" rows={3} maxLength={3000} defaultValue={editing?.appNotes}/></Field>
            <Actions onCancel={close} />
          </form>
        </Modal>
      )}
    </div>
  );
}
