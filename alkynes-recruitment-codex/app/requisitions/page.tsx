'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRecruitment } from '@/components/RecruitmentProvider';
import { Modal, Field, Actions, Empty, value } from '@/components/Forms';
import {
  formatDateOnly,
  newStamp,
  nextCode,
  type Requisition,
} from '@/lib/recruitment';
import { closedJob, latestRequest, removeJob } from '@/lib/recruitment-view';
export default function Page() {
  const { data, commit } = useRecruitment();
  const [editing, setEditing] = useState<Requisition | null | undefined>(
      undefined,
    ),
    [query, setQuery] = useState(''),
    [group, setGroup] = useState('active'),
    [removing, setRemoving] = useState<Requisition | null>(null);
  const close = () => setEditing(undefined);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = {
      department: value(form, 'department'),
      requester: value(form, 'requester'),
      role: value(form, 'role'),
      headcount: Number(form.get('headcount')),
      reason: value(form, 'reason'),
      duties: value(form, 'duties'),
      requirements: value(form, 'requirements'),
      preferred: value(form, 'preferred'),
      targetJoin: value(form, 'targetJoin'),
      status: (editing && closedJob(editing) === (value(form, 'status') === '채용완료') ? editing.status : value(form, 'status')) as Requisition['status'],
    };
    if (editing?.excelKey) {
      if (await commit('채용 앱 관리 정보 저장', draft => {
        const row = draft.requisitions.find(r => r.id === editing.id);
        if (!row) throw Error('채용 원본이 변경되었습니다. 다시 확인해 주세요.');
        // These supplementary fields are not supplied by the current workbook.
        Object.assign(row, { headcount: fields.headcount, reason: fields.reason, duties: fields.duties, requirements: fields.requirements, preferred: fields.preferred });
      })) close();
      return;
    }
    if (
      !fields.department ||
      !fields.role ||
      !Number.isInteger(fields.headcount) ||
      fields.headcount < 1
    )
      return;
    if (
      await commit(
        '채용 요청 ' +
          fields.department +
          ' / ' +
          fields.role +
          ': ' +
          (editing?.status || '신규') +
          ' → ' +
          fields.status,
        (draft) => {
          if (editing) {
            Object.assign(
              draft.requisitions.find((r) => r.id === editing.id)!,
              fields,
              { updatedAt: new Date().toISOString() },
            );
          } else
            draft.requisitions.unshift({
              ...newStamp(),
              ...fields,
              code: nextCode(draft.requisitions),
            });
        },
      )
    )
      close();
  }
  const rows = data.requisitions.filter(
    (r) =>
      (group === 'closed' ? closedJob(r) || !!r.excelMissing : !r.excelMissing && !closedJob(r)) &&
      (r.code + r.department + r.role)
        .toLowerCase()
        .includes(query.toLowerCase()),
  ).sort((a, b) => latestRequest(data, b.id).localeCompare(latestRequest(data, a.id)));
  return (
    <div className="space-y-6">
      <section className="recruitment-hero">
        <div className="relative z-10 max-w-xl">
          <div className="mb-4 text-xs font-semibold tracking-[0.22em] text-teal-200">ALKYNES · RECRUITMENT</div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">좋은 동료를 만나는 시작</h1>
          <p className="mt-4 text-sm leading-7 text-slate-200">채용 요청부터 새로운 동료의 합류까지,<br />지금 필요한 채용을 한눈에 확인하세요.</p>
          <p className="mt-6 text-sm text-teal-100">채용 요청은 엑셀에서 등록·관리합니다.</p>
        </div>
        <div aria-hidden="true" className="hero-art"><div className="hero-orbit"/><div className="hero-paper"><div className="hero-avatar">✦</div><div className="hero-line"/><div className="hero-line short"/><div className="hero-check">✓</div></div><span className="hero-dot"/></div>
      </section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-xl font-bold">채용 요청</h2><p className="mt-1 text-sm text-slate-500">최신 요청 순으로 표시합니다.</p></div>
        <div className="segmented" role="group" aria-label="채용 분류">
          {([['active', '채용중'], ['closed', '채용 완료']] as const).map(([key, label]) => <button key={key} aria-pressed={group === key} className={group === key ? 'selected' : ''} onClick={() => setGroup(key)}>{label}<span>{data.requisitions.filter(r => key === 'active' ? !r.excelMissing && !closedJob(r) : closedJob(r) || r.excelMissing).length}</span></button>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          aria-label="채용 요청 검색"
          className="field max-w-sm"
          placeholder="채용번호, 부서, 직무 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-sm text-slate-500">총 <strong className="text-slate-900">{rows.length}</strong>건</span>
      </div>
      <div className="space-y-4">
        {rows.length ? (
          rows.map((r) => (
            <div
              key={r.id}
              className="job-card flex flex-wrap items-center justify-between gap-5 p-6"
            >
              <div>
                <div className="text-xs text-slate-500">{r.code}</div>
                <div className="mt-2 text-lg font-bold">
                  {r.role}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {r.department} · 목표 입사일 {r.targetJoin ? formatDateOnly(r.targetJoin) : '협의'} · 지원자{' '}
                  {
                    data.candidates.filter((c) => c.requisitionId === r.id)
                      .length
                  }
                  명
                </div>
                {r.reason && (
                  <p className="mt-3 max-w-2xl text-xs leading-6 text-slate-500">{r.reason}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={"badge " + (closedJob(r) || r.excelMissing ? "bg-slate-100 text-slate-600" : "bg-teal-50 text-teal-700")}><span className="mr-1.5">●</span>{closedJob(r) || r.excelMissing ? '채용 완료' : '채용중'}</span>
                <Link
                  href={'/candidates?requisition=' + r.id}
                  className="btn-secondary"
                >
                  지원자 보기
                </Link>
                <button className="btn-secondary" onClick={() => setEditing(r)}>
                  상세 / 수정
                </button>
                <button className="btn-secondary text-red-700" onClick={() => setRemoving(r)}>삭제</button>
              </div>
            </div>
          ))
        ) : (
          <Empty>조건에 맞는 채용 요청이 없습니다.</Empty>
        )}
      </div>
      {removing && <Modal title="채용 요청 삭제" onClose={() => setRemoving(null)}>
        <p className="mb-3">{removing.department} · {removing.role} 채용요청을 삭제하시겠습니까?</p>
        <p className="mb-4 text-sm text-red-700">연결된 지원자 {data.candidates.filter(c => c.requisitionId === removing.id).length}명과 전형 요청·면접·평가도 함께 삭제됩니다. 복구하려면 설정에서 미리 백업해 주세요.</p>
        {removing.excelKey && <p className="mb-4 text-sm">엑셀 원본은 변경되지 않습니다. 원본에 남아 있으면 다음 엑셀 반영 시 다시 등록됩니다.</p>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setRemoving(null)}>취소</button><button className="btn-primary" onClick={async () => { if (await commit('채용 요청 삭제: ' + removing.role, d => removeJob(d, removing.id))) setRemoving(null); }}>삭제 확인</button></div>
      </Modal>}
      {editing !== undefined && (
        <Modal
          title={editing ? '채용 요청 수정' : '채용 요청 등록'}
          onClose={close}
        >
          <form
            onSubmit={save}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <p className="col-span-full text-sm text-slate-500">
              채용번호: {editing?.code || '저장 시 자동 생성'} · * 필수 항목
            </p>
            {editing?.excelKey && <p className="col-span-full rounded-xl bg-amber-50 p-3 text-sm">부서·직무·요청자·채용상태·목표 입사일은 엑셀에서 수정합니다. 인원·상세 업무 내용은 앱에서 보완할 수 있습니다.</p>}
            <Field label="요청부서 *">
              <input
                className="field"
                name="department"
                disabled={!!editing?.excelKey}
                required
                maxLength={80}
                defaultValue={editing?.department}
              />
            </Field>
            <Field label="직무 *">
              <input
                className="field"
                name="role"
                disabled={!!editing?.excelKey}
                required
                maxLength={80}
                defaultValue={editing?.role}
              />
            </Field>
            <Field label="채용인원 *">
              <input
                className="field"
                name="headcount"
                type="number"
                min="1"
                max="999"
                required
                defaultValue={editing?.headcount || 1}
              />
            </Field>
            <Field label="요청자">
              <input
                className="field"
                name="requester"
                disabled={!!editing?.excelKey}
                maxLength={80}
                defaultValue={editing?.requester}
              />
            </Field>
            <Field label="목표 입사일">
              <input
                className="field"
                name="targetJoin"
                disabled={!!editing?.excelKey}
                type="date"
                defaultValue={editing?.targetJoin}
              />
            </Field>
            <Field label="채용 상태">
              <select
                className="field"
                name="status"
                disabled={!!editing?.excelKey}
                defaultValue={editing && closedJob(editing) ? '채용완료' : '진행중'}
              >
                <option value="진행중">채용중</option>
                <option value="채용완료">채용 완료</option>
              </select>
            </Field>
            {(
              [
                ['reason', '충원사유'],
                ['duties', '주요업무'],
                ['requirements', '필수사항'],
                ['preferred', '우대사항'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <textarea
                  className="field"
                  name={key}
                  rows={2}
                  maxLength={2000}
                  defaultValue={editing?.[key]}
                />
              </Field>
            ))}
            <Actions onCancel={close} />
          </form>
        </Modal>
      )}
    </div>
  );
}
