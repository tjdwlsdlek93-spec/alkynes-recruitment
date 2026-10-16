'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRecruitment } from '@/components/RecruitmentProvider';
import { Field, Empty, value } from '@/components/Forms';
import {
  newStamp,
  formatDate,
  ratings,
  recommendations,
  type Evaluation,
} from '@/lib/recruitment';
const criteria = [
  ['jobFit', '직무 적합성'],
  ['capability', '경력 / 역량'],
  ['cultureFit', '조직 적합성'],
] as const;
export default function Page() {
  const { data, commit } = useRecruitment();
  const [interviewId, setInterviewId] = useState(''),
    [evaluator, setEvaluator] = useState('');
  const interviews = data.interviews.filter((i) => i.status !== '취소');
  useEffect(() => {
    setInterviewId(
      new URLSearchParams(window.location.search).get('interview') || '',
    );
  }, []);
  const interview = interviews.find((i) => i.id === interviewId);
  const person = data.candidates.find((c) => c.id === interview?.candidateId);
  const existing = data.evaluations.find(
    (e) => e.interviewId === interviewId && e.evaluator === evaluator,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!interview || !evaluator) return;
    const f = new FormData(event.currentTarget);
    const fields = {
      interviewId,
      evaluator,
      jobFit: value(f, 'jobFit') as Evaluation['jobFit'],
      capability: value(f, 'capability') as Evaluation['capability'],
      cultureFit: value(f, 'cultureFit') as Evaluation['cultureFit'],
      overall: value(f, 'overall') as Evaluation['overall'],
      comment: value(f, 'comment'),
    };
    await commit(
      '면접 평가 ' +
        person?.name +
        ' / ' +
        evaluator +
        ': ' +
        fields.overall +
        (existing ? ' (수정)' : ' (제출)'),
      (d) => {
        if (existing)
          Object.assign(
            d.evaluations.find((e) => e.id === existing.id)!,
            fields,
            { updatedAt: new Date().toISOString() },
          );
        else d.evaluations.unshift({ ...newStamp(), ...fields });
        const i = d.interviews.find((i) => i.id === interviewId)!;
        i.status = '면접완료';
        i.updatedAt = new Date().toISOString();
        const c = d.candidates.find((c) => c.id === i.candidateId)!;
        if (['검토중', '서류합격', '일정조율', '면접예정'].includes(c.status)) {
          c.status = '면접완료';
          c.updatedAt = i.updatedAt;
        }
      },
    );
  }
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">면접 평가</h1>
        <p className="mt-1 text-sm text-slate-500">
          선택식 평가를 제출하고 면접관별 의견을 한 화면에서 확인합니다.
        </p>
      </div>
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label="평가할 면접">
          <select
            className="field"
            value={interviewId}
            onChange={(e) => {
              setInterviewId(e.target.value);
              setEvaluator('');
            }}
          >
            <option value="">면접 선택</option>
            {interviews.map((i) => (
              <option key={i.id} value={i.id}>
                {data.candidates.find((c) => c.id === i.candidateId)?.name} ·{' '}
                {formatDate(i.startsAt)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="평가자">
          <select
            className="field"
            value={evaluator}
            disabled={!interview}
            onChange={(e) => setEvaluator(e.target.value)}
          >
            <option value="">배정된 면접관 선택</option>
            {interview?.interviewers.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </Field>
      </div>
      {interview && evaluator ? (
        <form
          key={interviewId + evaluator + (existing?.updatedAt || 'new')}
          className="card p-6"
          onSubmit={submit}
        >
          <div className="mb-5">
            <div className="text-sm text-slate-500">
              {
                data.requisitions.find((r) => r.id === person?.requisitionId)
                  ?.department
              }
            </div>
            <div className="text-xl font-bold">{person?.name} 지원자</div>
            <p className="mt-1 text-sm text-slate-500">
              {evaluator} ·{' '}
              {existing
                ? '제출된 평가를 수정할 수 있습니다.'
                : '모든 평가 항목을 선택해 주세요.'}
            </p>
          </div>
          {criteria.map(([key, label]) => (
            <fieldset className="mb-5" key={key}>
              <legend className="mb-2 font-semibold">{label} *</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ratings.map((x) => (
                  <label
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 text-sm has-[:checked]:border-slate-900 has-[:checked]:bg-slate-100"
                    key={x}
                  >
                    <input
                      type="radio"
                      name={key}
                      value={x}
                      required
                      defaultChecked={existing?.[key] === x}
                    />
                    {x}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <fieldset className="mb-5">
            <legend className="mb-2 font-semibold">종합의견 *</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {recommendations.map((x) => (
                <label
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 text-sm has-[:checked]:border-slate-900 has-[:checked]:bg-slate-100"
                  key={x}
                >
                  <input
                    type="radio"
                    name="overall"
                    value={x}
                    required
                    defaultChecked={existing?.overall === x}
                  />
                  {x}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="추가 의견 (선택)">
            <textarea
              className="field"
              name="comment"
              rows={3}
              maxLength={3000}
              defaultValue={existing?.comment}
              placeholder="추가 의견은 필요한 경우에만 작성"
            />
          </Field>
          <button className="btn-primary mt-4 w-full">
            {existing ? '평가 수정' : '평가 제출'}
          </button>
        </form>
      ) : (
        <div className="card">
          <Empty>
            면접과 평가자를 선택해 주세요. 면접관 배정은 면접 일정에서 할 수
            있습니다.
          </Empty>
        </div>
      )}
      <div className="card p-5">
        <h2 className="mb-4 font-bold">
          평가 취합{' '}
          {interview &&
            '· ' +
              data.evaluations.filter((e) => e.interviewId === interviewId)
                .length +
              '/' +
              interview.interviewers.length +
              '명 제출'}
        </h2>
        {(interview
          ? data.evaluations.filter((e) => e.interviewId === interviewId)
          : data.evaluations
        ).map((e) => (
          <div key={e.id} className="mb-3 rounded-xl border p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-semibold">
                {
                  data.candidates.find(
                    (c) =>
                      c.id ===
                      data.interviews.find((i) => i.id === e.interviewId)
                        ?.candidateId,
                  )?.name
                }{' '}
                · {e.evaluator}
              </span>
              <span className="badge bg-slate-100">{e.overall}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              직무 {e.jobFit} · 역량 {e.capability} · 조직 {e.cultureFit}
            </p>
            {e.comment && (
              <p className="mt-2 whitespace-pre-wrap text-sm">{e.comment}</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              수정일 {formatDate(e.updatedAt)}
            </p>
          </div>
        ))}
        {!(
          interview
            ? data.evaluations.filter((e) => e.interviewId === interviewId)
            : data.evaluations
        ).length && <Empty>제출된 평가가 없습니다.</Empty>}
        <p className="mt-3 text-sm text-slate-500">
          평가는 의견 기록입니다. 최종합격·입사확정 등 최종 결정은 지원자
          상세에서 변경해 주세요.
        </p>
      </div>
    </div>
  );
}
