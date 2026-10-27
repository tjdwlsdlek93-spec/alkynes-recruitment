import type { ExcelPlan } from "./excel";
import { candidateStatuses, type RecruitmentData } from "./recruitment";
import { finalStatus } from "./candidate-state";
export type QualityIssue = {
  row: number;
  field: string;
  message: string;
  severity: "warning" | "error";
};
export function qualityIssues(plan: ExcelPlan, now = new Date()) {
  const issues: QualityIssue[] = [];
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    dateStyle: "short",
  }).format(now);
  for (const q of plan.requests) {
    const row = q.sourceRow || 0,
      values = q.excelValues || {},
      stage = values["현재 선발 단계"] || "",
      final = values["최종 결과"] || "";
    const add = (field: string, message: string) =>
      issues.push({ row, field, message, severity: "warning" });
    if (values["면접 일시"] && !stage.trim())
      add("현재 선발 단계", "면접일시가 있지만 현재 선발단계가 비어 있습니다.");
    if (
      stage &&
      !candidateStatuses.some(
        (s) => s.replace(/\s/g, "") === stage.replace(/\s/g, ""),
      )
    )
      add(
        "현재 선발 단계",
        "알 수 없는 선발단계입니다. 정해진 단계명으로 입력해 주세요.",
      );
    if (final && final !== "미확정" && !finalStatus(final))
      add(
        "최종 결과",
        "해석할 수 없는 최종결과입니다. 합격·불합격·지원포기·입사포기 등의 값을 확인하세요.",
      );
    if (q.candidateId && !q.receivedAt)
      add("요청일", "요청일이 없어 처리기한을 계산할 수 없습니다.");
    if (finalStatus(final) && /면접예정|확인\s*필요/.test(stage))
      add(
        "최종 결과",
        "최종 결과가 입력되어 현재 선발단계보다 우선 적용됩니다.",
      );
    const c = plan.candidates.find((c) => c.id === q.candidateId);
    if (
      c?.actualJoin &&
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Seoul",
        dateStyle: "short",
      }).format(new Date(c.actualJoin)) > today
    )
      add(
        "실제 입사일",
        "미래 입사일입니다. 해당 날짜 전에는 입사확정으로 분류합니다.",
      );
    if (q.stage === "인적성 검사 요청" && q.status === "요청 완료" && !q.examAt)
      add(
        "인적성 검사 일시",
        "인적성 요청은 완료됐지만 검사일시가 비어 있습니다.",
      );
  }
  return issues;
}
// Existing IDs are retained; explicit workbook IDs take precedence over row positions.
export function stabilizePlan(plan: ExcelPlan, previous: RecruitmentData) {
  const requestIds = new Map<string, string>();
  for (const q of plan.requests) {
    if (q.explicitId || previous.requests?.some((old) => old.id === q.id))
      continue;
    const matches = (previous.requests || []).filter(
      (old) =>
        old.source === "kpi-excel" &&
        old.candidateId === q.candidateId &&
        old.requisitionId === q.requisitionId &&
        old.stage === q.stage &&
        old.sourceRow === q.sourceRow &&
        !plan.requests.some((next) => next.id === old.id),
    );
    if (matches.length === 1) requestIds.set(q.id, matches[0].id);
  }
  for (const q of plan.requests) q.id = requestIds.get(q.id) || q.id;
  for (const i of plan.interviews)
    if (i.sourceRequestId)
      i.sourceRequestId =
        requestIds.get(i.sourceRequestId) || i.sourceRequestId;
  const interviewIds = new Map<string, string>();
  for (const i of plan.interviews) {
    if (previous.interviews.some((old) => old.id === i.id)) continue;
    if ((i as typeof i & { explicitId?: boolean }).explicitId) continue;
    const incomingRequests = plan.requests.filter(
      (q) => q.candidateId === i.candidateId,
    );
    const candidates = previous.interviews.filter(
      (old) =>
        old.source === "kpi-excel" &&
        old.candidateId === i.candidateId &&
        !plan.interviews.some((next) => next.id === old.id),
    );
    const sourceId = (i as typeof i & { sourceRequestId?: string })
      .sourceRequestId;
    const exact = sourceId
      ? candidates.filter(
          (old) =>
            (old as typeof old & { sourceRequestId?: string })
              .sourceRequestId === sourceId,
        )
      : [];
    const match =
      exact.length === 1
        ? exact[0]
        : candidates.length === 1 &&
            plan.interviews.filter(
              (next) =>
                next.candidateId === i.candidateId &&
                !previous.interviews.some((old) => old.id === next.id),
            ).length === 1 &&
            incomingRequests.length > 0 &&
            !!sourceId &&
            !!previous.requests?.some((q) => q.id === sourceId)
          ? candidates[0]
          : undefined;
    if (match) interviewIds.set(i.id, match.id);
    else if (candidates.length)
      throw Error(
        "면접 일정 연결이 모호합니다. 고유번호가 포함된 엑셀 사본을 사용해 주세요. 기존 기록은 유지했습니다.",
      );
  }
  for (const i of plan.interviews) i.id = interviewIds.get(i.id) || i.id;
  for (const job of plan.jobs.filter(
    (j) => !previous.requisitions.some((old) => old.id === j.id),
  )) {
    const rows = plan.requests
      .filter((q) => q.requisitionId === job.id)
      .map((q) => q.sourceRow);
    if (
      previous.requisitions.some(
        (old) =>
          old.id.startsWith("excel-job-") &&
          !old.excelMissing &&
          !plan.jobs.some((next) => next.id === old.id) &&
          previous.requests?.some(
            (q) => q.requisitionId === old.id && rows.includes(q.sourceRow),
          ),
      )
    )
      throw Error(
        "채용건명 변경 또는 교체를 확인해야 합니다. 고유번호를 유지해 연결해 주세요. 기존 기록은 보존했습니다.",
      );
  }
  const newPeople = plan.candidates.filter(
    (c) => !previous.candidates.some((old) => old.id === c.id),
  );
  const missing = previous.candidates.filter(
    (c) =>
      c.id.startsWith("excel-person-") &&
      !c.excelMissing &&
      !plan.candidates.some((next) => next.id === c.id),
  );
  for (const c of newPeople) {
    const request = plan.requests.find((q) => q.candidateId === c.id);
    if (
      missing.some(
        (old) =>
          old.requisitionId === c.requisitionId &&
          previous.requests?.some(
            (q) =>
              q.candidateId === old.id && q.sourceRow === request?.sourceRow,
          ),
      )
    )
      throw Error(
        "지원자 이름 변경 또는 교체를 확인해야 합니다. 고유번호 사본에 기존 지원자 고유번호를 유지해 주세요. 자동으로 다른 사람의 기록을 합치지 않았습니다.",
      );
  }
  return plan;
}
