'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
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
    [message, setMessage] = useState('');
  useEffect(() => {
    setCandidate(
      new URLSearchParams(window.location.search).get('candidate') || '',
    );
  }, []);
  const close = () => setEditing(undefined);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
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
    };
    if (
      commit(
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
  async function copy(i: Interview) {
    const c = data.candidates.find((c) => c.id === i.candidateId)!;
    const r = data.requisitions.find((r) => r.id === c.requisitionId)!;
    const text = [
      '[알킨스 면접 안내]',
      c.name + '님 / ' + r.department + ' · ' + r.role,
      '일시: ' + formatDate(i.startsAt) + ' (한국시간)',
      '장소: ' + i.location,
      '면접관: ' + i.interviewers.join(' / '),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setMessage('면접 안내문을 복사했습니다.');
    } catch {
      setMessage('클립보드를 사용할 수 없어 안내문을 파일로 내려받았습니다.');
      download('면접안내.txt', text, 'text/plain;charset=utf-8');
    }
  }
  const rows = data.interviews
    .filter((i) => !candidate || i.candidateId === candidate)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">면접 일정</h1>
          <p className="mt-1 text-sm text-slate-500">
            지원자를 선택하고 일정·장소·면접관을 한 번에 지정합니다.
          </p>
        </div>
        <button
          className="btn-primary"
          disabled={!data.candidates.length}
          onClick={() => setEditing(null)}
        >
          + 면접 일정 등록
        </button>
      </div>
      <select
        aria-label="면접 지원자 필터"
        className="field max-w-sm"
        value={candidate}
        onChange={(e) => setCandidate(e.target.value)}
      >
        <option value="">전체 지원자</option>
        {data.candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ·{' '}
            {data.requisitions.find((r) => r.id === c.requisitionId)?.role}
          </option>
        ))}
      </select>
      {message && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((i) => {
          const c = data.candidates.find((c) => c.id === i.candidateId)!;
          const r = data.requisitions.find((r) => r.id === c.requisitionId)!;
          return (
            <div className="card p-5" key={i.id}>
              <div className="flex justify-between gap-2">
                <span className="text-sm text-slate-500">
                  {formatDate(i.startsAt)} (한국시간)
                </span>
                <span className="badge bg-slate-100">{i.status}</span>
              </div>
              {i.verification && (
                <p className="mt-2 text-xs text-amber-800">
                  확인 필요: {i.verification}
                </p>
              )}
              <div className="mt-2 font-bold">
                {r.department} · {c.name}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {i.location} · {i.interviewers.join(' / ')}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => setEditing(i)}>
                  일정 수정
                </button>
                {i.status !== '취소' && (
                  <>
                    <button className="btn-secondary" onClick={() => copy(i)}>
                      면접 안내문 복사
                    </button>
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
      {!rows.length && (
        <div className="card">
          <Empty>
            등록된 면접이 없습니다. 지원자를 선택하고 일정을 등록해 주세요.
          </Empty>
        </div>
      )}
      {editing !== undefined && (
        <Modal
          title={editing ? '면접 일정 수정' : '면접 일정 등록'}
          onClose={close}
        >
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
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
            <Field label="면접일시 * (한국시간)">
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
            <p className="text-sm text-slate-500">
              일정 등록 시 지원자 상태도 면접예정으로 연결됩니다. 캘린더 일정은
              기본 1시간입니다.
            </p>
            <Actions onCancel={close} />
          </form>
        </Modal>
      )}
    </div>
  );
}
