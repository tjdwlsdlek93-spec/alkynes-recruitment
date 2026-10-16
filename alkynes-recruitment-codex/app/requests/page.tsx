'use client';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { ExcelSyncControls } from '@/components/ExcelSync';
import { useRecruitment } from '@/components/RecruitmentProvider';
import { Modal, Field, Actions, Empty, value } from '@/components/Forms';
import {
  newStamp,
  localDateTime,
  formatDate,
  requestStages,
  requestStatuses,
  download,
  type ProcessRequest,
} from '@/lib/recruitment';
import { defaultDueDate, requestTiming, requestsCSV } from '@/lib/scheduling';
import {
  applyExcelPlan,
  excludedSummary,
  parseExcel,
  type ExcelPlan,
} from '@/lib/excel';
export default function Page() {
  const { data, commit } = useRecruitment();
  const [editing, setEditing] = useState<ProcessRequest | null | undefined>(),
    [plan, setPlan] = useState<ExcelPlan | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState(''),
    [req, setReq] = useState(''),
    [candidate, setCandidate] = useState(''),
    [stage, setStage] = useState<string>('면접 요청'),
    [received, setReceived] = useState(''),
    [due, setDue] = useState(''),
    [completed, setCompleted] = useState(''),
    [state, setState] = useState<string>('요청 전'),
    [cleanDemo, setCleanDemo] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('request');
    if (id) {
      const row = (data.requests || []).find((q) => q.id === id);
      if (row) edit(row);
    }
  }, []);
  function edit(q: ProcessRequest | null) {
    setEditing(q);
    setReq(q?.requisitionId || '');
    setCandidate(q?.candidateId || '');
    setStage(q?.stage || '면접 요청');
    setReceived(localDateTime(q?.receivedAt || ''));
    setDue(localDateTime(q?.dueAt || ''));
    setCompleted(localDateTime(q?.completedAt || ''));
    setState(q?.status || '요청 전');
    setError('');
  }
  async function read(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 8 * 1024 * 1024)
        throw Error('8MB 이하 .xlsx 파일을 선택해 주세요.');
      const next = await parseExcel(await file.arrayBuffer(), file.name);
      setPlan(next);
      setCleanDemo(
        data.activity.length === 0 &&
          data.requisitions.length === 3 &&
          data.requisitions.every((r) => ['r1', 'r2', 'r3'].includes(r.id)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '엑셀을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const f = new FormData(e.currentTarget);
    const iso = (v: string) =>
      v ? new Date(v + ':00+09:00').toISOString() : '';
    if (state === '요청 완료' && !completed) {
      setError('요청 완료일시를 입력해 주세요.');
      return;
    }
    const fields = {
      requisitionId: req,
      candidateId: candidate,
      excelJobId: value(f, 'excelJobId'),
      stage: stage as ProcessRequest['stage'],
      round: editing?.round || Math.max(0, ...(data.requests || []).filter(q => q.requisitionId === req && q.candidateId === candidate && q.stage === stage).map(q => q.round)) + 1,
      receivedAt: iso(received),
      dueAt: iso(due),
      completedAt: state === '요청 전' ? '' : iso(completed),
      status: state as ProcessRequest['status'],
      owner: value(f, 'owner'),
      notes: value(f, 'notes'),
    };
    if (fields.dueAt && fields.receivedAt && fields.dueAt < fields.receivedAt) {
      setError('처리기한은 접수일시 이후여야 합니다.');
      return;
    }
    if (
      fields.completedAt &&
      fields.receivedAt &&
      fields.completedAt < fields.receivedAt
    ) {
      setError('완료일시는 접수일시 이후여야 합니다.');
      return;
    }
    if (
      await commit(stage + ' ' + state + ' 저장', (d) => {
        d.requests ||= [];
        if (editing)
          Object.assign(d.requests.find((q) => q.id === editing.id)!, fields, {
            updatedAt: new Date().toISOString(),
          });
        else d.requests.unshift({ ...newStamp(), ...fields });
      })
    )
      setEditing(undefined);
  }
  const rows = (data.requests || []).filter(
    (q) => !filter || q.status === filter,
  );
  const effective = (data.requests || []).filter(
    (q) => !excludedSummary(q, data) && q.status !== '취소',
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">엑셀 연동</h1>
          <p className="mt-1 text-sm text-slate-500">
            요청 1건을 1행으로 기록합니다. 요청 처리완료와 실제 면접일은
            별개입니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            disabled={!rows.length}
            onClick={() =>
              download(
                '채용요청상세.csv',
                requestsCSV(data),
                'text/csv;charset=utf-8',
              )
            }
          >
            CSV 내보내기
          </button>
          <button
            className="btn-primary"
            disabled={!data.requisitions.length}
            onClick={() => edit(null)}
          >
            + 전형 기록 등록
          </button>
        </div>
      </div>
      <ExcelSyncControls />
      <div className="card space-y-3 p-5">
        <h2 className="font-bold">엑셀 파일 직접 가져오기</h2>
        <p className="text-sm text-slate-600">
          파일은 이 브라우저에서 읽으며 외부에 업로드하지 않습니다. 원본 수식과
          파일은 변경하지 않습니다. 자동 연결을 사용하면 파일 저장 후 변경 내용이 반영됩니다. 직접 가져오기는 선택한 시점의 데이터만 반영합니다.
        </p>
        <label className="block text-sm font-medium">
          엑셀 파일 (.xlsx)
          <input
            className="field mt-2 max-w-xl"
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={read}
          />
        </label>
        {busy && <p role="status">엑셀 구조와 날짜를 검증하고 있습니다…</p>}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <p className="text-xs text-slate-500">
          요청일 → 접수 일정 / 처리완료일 → 요청 완료 / 면접 일시 → 면접 캘린더
          / 종결 선택 → 채용 진행 상태
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['유효 요청', effective.length],
          ['요청 전', effective.filter((q) => q.status === '요청 전').length],
          [
            '기한 내 완료',
            effective.filter((q) => requestTiming(q) === 'OK').length,
          ],
          [
            '확인 필요',
            (data.requests || []).filter((q) => q.verification).length,
          ],
        ].map(([label, count]) => (
          <div className="card p-4" key={label}>
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold">{count}</div>
          </div>
        ))}
      </div>
      <select
        className="field max-w-xs"
        aria-label="전형 기록 상태 필터"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="">전체 진행상황</option>
        {requestStatuses.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <div className="card divide-y">
        {rows.map((q) => {
          const r = data.requisitions.find((r) => r.id === q.requisitionId),
            c = data.candidates.find((c) => c.id === q.candidateId);
          return (
            <div className="space-y-2 p-4" key={q.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold">
                    {r?.role} · {c?.name || '채용건 공통'}
                  </span>
                  <p className="text-xs text-slate-500">
                    {r?.code} · {q.stage}{' '}
                    {q.sourceRow && '· 원본 ' + q.sourceRow + '행'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      'badge ' +
                      (q.status === '요청 완료'
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-amber-50 text-amber-900')
                    }
                  >
                    {q.status}
                  </span>
                  <button className="btn-secondary" onClick={() => edit(q)}>
                    요청 상세 / 수정
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                접수 {formatDate(q.receivedAt)} · 기한 {formatDate(q.dueAt)} ·
                완료 {formatDate(q.completedAt)} ·{' '}
                <strong>
                  {excludedSummary(q, data)
                    ? '집계 제외 (지원자별 기록 우선)'
                    : requestTiming(q)}
                </strong>
              </p>
              {q.notes && (
                <p className="whitespace-pre-wrap text-sm">{q.notes}</p>
              )}
              {q.verification && (
                <p className="text-xs text-amber-800">
                  확인 필요: {q.verification}
                </p>
              )}
              <Link className="text-xs underline" href="/dashboard">
                캘린더 보기
              </Link>
            </div>
          );
        })}
        {!rows.length && (
          <Empty>전형 기록을 등록하거나 업데이트 엑셀을 가져와 주세요.</Empty>
        )}
      </div>
      {editing !== undefined && (
        <Modal
          title={editing ? '전형 기록 수정' : '전형 기록 등록'}
          onClose={() => setEditing(undefined)}
        >
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            {error && (
              <p role="alert" className="col-span-full text-red-700">
                {error}
              </p>
            )}
            <Field label="채용건 *">
              <select
                className="field"
                required
                value={req}
                onChange={(e) => {
                  setReq(e.target.value);
                  setCandidate('');
                }}
              >
                <option value="">채용건 선택</option>
                {data.requisitions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.role} · {r.code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="지원자">
              <select
                className="field"
                value={candidate}
                onChange={(e) => setCandidate(e.target.value)}
              >
                <option value="">채용건 공통 / 이름 미입력</option>
                {data.candidates
                  .filter((c) => c.requisitionId === req)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="요청 구분">
              <select
                className="field"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                {requestStages.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="접수일시 *">
              <input
                className="field"
                type="datetime-local"
                required
                value={received}
                onChange={(e) => {
                  setReceived(e.target.value);
                  if (!editing && e.target.value)
                    setDue(defaultDueDate(e.target.value));
                }}
              />
            </Field>
            <Field label="처리기한 *">
              <input
                className="field"
                type="datetime-local"
                required
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
            <Field label="요청 진행상황">
              <select
                className="field"
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                {requestStatuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="처리완료일시">
              <input
                className="field"
                type="datetime-local"
                disabled={state === '요청 전'}
                required={state === '요청 완료'}
                value={completed}
                onChange={(e) => setCompleted(e.target.value)}
              />
            </Field>
            <Field label="담당자">
              <input
                className="field"
                name="owner"
                maxLength={100}
                defaultValue={editing?.owner}
              />
            </Field>
            <Field label="엑셀 채용건ID (선택)">
              <input
                className="field"
                name="excelJobId"
                defaultValue={editing?.excelJobId}
              />
            </Field>
            <div className="col-span-full">
              <Field label="업무 메모">
                <textarea
                  className="field"
                  name="notes"
                  rows={3}
                  maxLength={3000}
                  defaultValue={editing?.notes}
                />
              </Field>
              <p className="mt-2 text-xs text-slate-500">
                신규 요청의 기본기한은 다음 1영업일(주말 제외)입니다.
                공휴일·회사 휴무일은 기한을 직접 조정해 주세요. 면접 일시는 면접
                일정에서 등록합니다.
              </p>
            </div>
            <Actions onCancel={() => setEditing(undefined)} />
          </form>
        </Modal>
      )}
      {plan && (
        <Modal title="엑셀 가져오기 확인" onClose={() => setPlan(null)}>
          <p className="break-all text-sm text-slate-500">{plan.sourceName}</p>
          <div className="my-4 rounded-xl bg-slate-50 p-4 font-semibold">
            원본 {plan.rows}행 → 채용 {plan.jobs.length}건 · 지원자{' '}
            {plan.candidates.length}명 · 요청 {plan.requests.length}건 · 면접{' '}
            {plan.interviews.length}건
          </div>
          <p className="mb-3 text-sm">
            원본 설정: 허용 처리기한 {plan.businessDays}영업일(공휴일 미반영).
            기존 앱 데이터와 병합하며 Excel 연결 항목은 원본 값으로 갱신합니다.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {data.activity.length === 0 &&
            data.requisitions.length === 3 &&
            data.requisitions.every((r) =>
              ['r1', 'r2', 'r3'].includes(r.id),
            ) && (
              <label className="mt-4 block text-sm">
                <input
                  type="checkbox"
                  checked={cleanDemo}
                  onChange={(e) => setCleanDemo(e.target.checked)}
                />{' '}
                처음 제공된 예시 3건을 정리하고 실제 파일로 시작
              </label>
            )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              className="btn-secondary"
              onClick={() =>
                download('가져오기전백업.json', JSON.stringify(data, null, 2))
              }
            >
              현재 데이터 백업
            </button>
            <button className="btn-secondary" onClick={() => setPlan(null)}>
              취소
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                if (
                  await commit('엑셀 ' + plan.rows + '행을 가져왔습니다.', (d) => {
                    if (
                      cleanDemo &&
                      d.activity.length === 0 &&
                      d.requisitions.length === 3 &&
                      d.requisitions.every((r) =>
                        ['r1', 'r2', 'r3'].includes(r.id),
                      )
                    ) {
                      d.requisitions = [];
                      d.candidates = [];
                      d.interviews = [];
                      d.evaluations = [];
                      d.requests = [];
                    }
                    applyExcelPlan(d, plan);
                  })
                ) {
                  setPlan(null);
                  setError('');
                }
              }}
            >
              가져오기 적용
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
