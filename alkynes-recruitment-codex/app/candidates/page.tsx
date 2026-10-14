'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { koreaDate } from '@/lib/scheduling';
import { useRecruitment } from '@/components/RecruitmentProvider';
import { Modal, Field, Actions, Empty, value } from '@/components/Forms';
import { candidateStatuses, newStamp, type Candidate } from '@/lib/recruitment';
import { candidateStatus, endedCandidate, finalStatus } from '@/lib/candidate-state';
import { closedJob, latestRequest } from '@/lib/recruitment-view';
export default function Page() {
  const { data, commit } = useRecruitment();
  const [editing, setEditing] = useState<Candidate | null | undefined>(),
    [query, setQuery] = useState(''),
    [req, setReq] = useState(''),
    [status, setStatus] = useState(''),
    [group, setGroup] = useState('active'),
    [fileError, setFileError] = useState(''),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState<Candidate | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('requisition') || '';
    setReq(id);
    if (id && data.requisitions.some(r => r.id === id && closedJob(r))) setGroup('closed');
  }, []);
  const close = () => {
    setEditing(undefined);
    setFileError('');
  };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFileError('');
    setBusy(true);
    try {
      let resumeData = editing?.resumeData || '',
        resumeName = editing?.resumeName || '';
      if (form.get('removeResume')) {
        resumeData = '';
        resumeName = '';
      }
      const file = form.get('resume') as File;
      if (file?.size) {
        if (file.size > 1024 * 1024)
          throw Error('이력서는 1MB 이하 PDF 파일로 등록해 주세요.');
        const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
        if (new TextDecoder().decode(bytes) !== '%PDF-')
          throw Error('PDF 형식의 이력서만 등록할 수 있습니다.');
        resumeData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(Error('파일을 읽지 못했습니다.'));
          reader.readAsDataURL(new Blob([file], { type: 'application/pdf' }));
        });
        resumeName = file.name;
      }
      const fields = {
        requisitionId: value(form, 'requisitionId'),
        name: value(form, 'name'),
        source: value(form, 'source'),
        career: value(form, 'career'),
        phone: value(form, 'phone'),
        email: value(form, 'email'),
        status: value(form, 'status') as Candidate['status'],
        notes: value(form, 'notes'),
        resumeData,
        resumeName,
      };
      if (!fields.name || !fields.requisitionId)
        throw Error('채용건과 지원자 이름을 입력해 주세요.');
      if (
        commit(
          '지원자 ' +
            fields.name +
            ': ' +
            (editing?.status || '신규') +
            ' → ' +
            fields.status,
          (draft) => {
            if (editing) {
              Object.assign(
                draft.candidates.find((c) => c.id === editing.id)!,
                fields,
                { updatedAt: new Date().toISOString() },
              );
            } else draft.candidates.unshift({ ...newStamp(), ...fields });
          },
        )
      )
        close();
    } catch (e) {
      setFileError(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  const rows = data.candidates.filter(
    (c) =>
      (!req || c.requisitionId === req) &&
      (group === 'all' || (group === 'ended' ? endedCandidate(c) : group === 'closed' ? closedJob(data.requisitions.find(r => r.id === c.requisitionId)!) : !closedJob(data.requisitions.find(r => r.id === c.requisitionId)!) && !endedCandidate(c))) &&
      (status === '__archived' ? !!c.excelMissing : !c.excelMissing) &&
      (!status || status === '__archived' || candidateStatus(c) === status) &&
      (c.name + c.source + c.career)
        .toLowerCase()
        .includes(query.toLowerCase()),
  ).sort((a, b) => latestRequest(data, b.requisitionId, b.id).localeCompare(latestRequest(data, a.requisitionId, a.id)));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">지원자</h1>
          <p className="mt-1 text-sm text-slate-500">
            진행중인 지원자를 기본으로 표시합니다. 불합격·지원포기·입사포기·실제 입사자는 전형 종료에서 확인하세요.
          </p>
        </div>
        <button
          className="btn-primary"
          disabled={!data.requisitions.length}
          onClick={() => setEditing(null)}
        >
          + 지원자 등록
        </button>
      </div>
      {!data.requisitions.length && <p>먼저 채용 요청을 등록해 주세요.</p>}
      <div className="flex flex-wrap gap-3">
        <select className="field max-w-xs" aria-label="지원자 채용 분류" value={group} onChange={e => { setGroup(e.target.value); setReq(''); }}><option value="active">전형 진행중</option><option value="ended">전형 종료 (불합격·포기·입사)</option><option value="closed">채용 완료 기록</option><option value="all">전체 지원자</option></select>
        <input
          className="field max-w-xs"
          aria-label="지원자 검색"
          placeholder="이름, 경력, 지원경로 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="field max-w-xs"
          aria-label="채용건 필터"
          value={req}
          onChange={(e) => setReq(e.target.value)}
        >
          <option value="">전체 채용건</option>
          {data.requisitions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.role}
            </option>
          ))}
        </select>
        <select
          className="field max-w-xs"
          aria-label="지원자 상태 필터"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">전체 상태</option>
          <option value="__archived">엑셀에서 제외된 기록</option>
          {candidateStatuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {[
                '지원자',
                '채용번호',
                '지원경로',
                '경력',
                '진행 상태',
                '관리',
              ].map((h) => (
                <th className="px-5 py-3 text-left font-medium" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr className="border-t" key={c.id}>
                <td className="px-5 py-4 font-semibold">{c.name}</td>
                <td className="px-5 py-4">
                  {
                    data.requisitions.find((r) => r.id === c.requisitionId)
                      ?.code
                  }
                </td>
                <td className="px-5 py-4">{c.source || '—'}</td>
                <td className="px-5 py-4">{c.career || '—'}</td>
                <td className="px-5 py-4">
                  <span className="badge bg-slate-100">{candidateStatus(c)}</span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary"
                      onClick={() => setEditing(c)}
                    >
                      상세 / 수정
                    </button>
                    <Link
                      className="btn-secondary"
                      href={'/interviews?candidate=' + c.id}
                    >
                      면접 관리
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty>조건에 맞는 지원자가 없습니다.</Empty>}
      </div>
      {editing !== undefined && (
        <Modal
          title={editing ? '지원자 상세 / 수정' : '지원자 등록'}
          onClose={() => {
            if (!busy) close();
          }}
        >
          {editing?.excelStage !== undefined && (
            <p className="mb-4 rounded-xl bg-slate-50 p-3 text-sm">
              {finalStatus(editing.excelFinal) ? '최종 결과 반영 상태' : '엑셀 선발 단계'}: {finalStatus(editing.excelFinal) ? candidateStatus(editing) : editing.excelStage || '미입력'} · 최종 결과:{' '}
              {editing.excelFinal || '미입력'} · 입사예정일:{' '}
              {editing.expectedJoin
                ? koreaDate(editing.expectedJoin)
                : '미입력'}{' '}
              · 실제입사일:{' '}
              {editing.actualJoin ? koreaDate(editing.actualJoin) : '미입력'}
            </p>
          )}
          <form onSubmit={save}>
            <fieldset
              disabled={busy}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <Field label="채용건 *">
                <select
                  className="field"
                  name="requisitionId"
                  required
                  defaultValue={editing?.requisitionId || req || ''}
                >
                  <option value="">채용건 선택</option>
                  {data.requisitions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} · {r.department} / {r.role}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="지원자 이름 *">
                <input
                  className="field"
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={editing?.name}
                />
              </Field>
              <Field label="지원경로">
                <input
                  className="field"
                  name="source"
                  maxLength={80}
                  placeholder="사람인, 잡코리아, 추천 등"
                  defaultValue={editing?.source}
                />
              </Field>
              <Field label="경력">
                <input
                  className="field"
                  name="career"
                  maxLength={200}
                  defaultValue={editing?.career}
                />
              </Field>
              <Field label="연락처">
                <input
                  className="field"
                  name="phone"
                  type="tel"
                  maxLength={40}
                  defaultValue={editing?.phone}
                />
              </Field>
              <Field label="이메일">
                <input
                  className="field"
                  name="email"
                  type="email"
                  maxLength={200}
                  defaultValue={editing?.email}
                />
              </Field>
              <Field label="진행 상태">
                <select
                  className="field"
                  name="status"
                  defaultValue={editing?.status || '검토중'}
                >
                  {candidateStatuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="이력서 (PDF, 1MB 이하)">
                <input
                  className="field"
                  name="resume"
                  type="file"
                  accept=".pdf,application/pdf"
                />
              </Field>
              {editing?.resumeData && (
                <div className="col-span-full space-y-2">
                  <a
                    className="text-sm underline"
                    href={editing.resumeData}
                    download={editing.resumeName}
                  >
                    이력서 다운로드: {editing.resumeName}
                  </a>
                  <label className="block text-sm">
                    <input type="checkbox" name="removeResume" /> 기존 이력서
                    삭제
                  </label>
                </div>
              )}
              <div className="col-span-full">
                <Field label="메모">
                  <textarea
                    className="field"
                    name="notes"
                    rows={3}
                    maxLength={3000}
                    defaultValue={editing?.notes}
                  />
                </Field>
              </div>
              {fileError && (
                <p role="alert" className="col-span-full text-sm text-red-700">
                  {fileError}
                </p>
              )}
              <Actions onCancel={close} label={busy ? '저장 중…' : '저장'} />
              {editing && (
                <button
                  type="button"
                  className="text-left text-sm text-red-700 underline"
                  onClick={() => setRemoving(editing)}
                >
                  지원자 삭제
                </button>
              )}
            </fieldset>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal title="지원자 삭제 확인" onClose={() => setRemoving(null)}>
          <p>
            {removing.name} 지원자와 연결된 면접·평가를 모두 삭제합니다. 되돌릴
            수 없습니다.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRemoving(null)}>
              취소
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                if (
                  commit(
                    removing.name +
                      ' 지원자와 연결된 면접·평가를 삭제했습니다.',
                    (d) => {
                      const ids = d.interviews
                        .filter((i) => i.candidateId === removing.id)
                        .map((i) => i.id);
                      d.evaluations = d.evaluations.filter(
                        (e) => !ids.includes(e.interviewId),
                      );
                      d.interviews = d.interviews.filter(
                        (i) => i.candidateId !== removing.id,
                      );
                      d.requests = (d.requests || []).filter(
                        (q) => q.candidateId !== removing.id,
                      );
                      d.candidates = d.candidates.filter(
                        (c) => c.id !== removing.id,
                      );
                    },
                  )
                ) {
                  setRemoving(null);
                  close();
                }
              }}
            >
              삭제 확인
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
