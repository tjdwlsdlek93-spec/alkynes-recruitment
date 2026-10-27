import { formatDate } from './recruitment';
import { qualityIssues, type QualityIssue } from './excel-integrity';
import { excelChanges } from './excel-changes';
import { candidateStatus, finalStatus } from './candidate-state';
import type { CellValue } from 'exceljs';
import type {
  Candidate,
  Interview,
  ProcessRequest,
  RecruitmentData,
  Requisition,
} from './recruitment';

export type ExcelPlan = {
  qualityIssues?: QualityIssue[];
  jobs: Requisition[];
  candidates: Candidate[];
  requests: ProcessRequest[];
  interviews: Interview[];
  warnings: string[];
  rows: number;
  businessDays: number;
  interviewFields?: { location: boolean; interviewers: boolean };
  sourceName: string;
  sourceModifiedAt?: string;
};
function unwrap(v: CellValue): unknown {
  if (v && typeof v === 'object' && 'formula' in v) return v.result;
  if (v && typeof v === 'object' && 'sharedFormula' in v) return v.result;
  if (v && typeof v === 'object' && 'richText' in v)
    return v.richText.map((x) => x.text).join('');
  if (v && typeof v === 'object' && 'text' in v) return v.text;
  return v;
}
function text(v: CellValue) {
  const raw = unwrap(v);
  return typeof raw === 'string'
    ? raw.trim()
    : typeof raw === 'number'
      ? String(raw)
      : '';
}
function date(v: CellValue, label: string, endOfDay = false): string {
  let raw = unwrap(v);
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number')
    raw = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
  let local = '';
  if (raw instanceof Date && Number.isFinite(raw.getTime()))
    local = raw.toISOString().slice(0, 19);
  else if (
    typeof raw === 'string' &&
    /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(raw)
  )
    local = raw.replace(' ', 'T');
  else
    throw Error(
      label +
        '의 날짜 형식이 올바르지 않습니다. Excel 날짜 셀로 입력해 주세요.',
    );
  const day = local.slice(0, 10);
  if (endOfDay) local = day + 'T23:59:59';
  else if (local.length === 10) local += 'T00:00:00';
  else if (local.length === 16) local += ':00';
  const instant = new Date(local + '+09:00');
  if (
    !Number.isFinite(instant.getTime()) ||
    new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day
  )
    throw Error(label + '의 날짜를 확인해 주세요.');
  return instant.toISOString();
}
async function key(prefix: string, parts: string[]) {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(parts)),
  );
  return (
    prefix +
    '-' +
    Array.from(new Uint8Array(buffer), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
  );
}
function due(received: string, days: number) {
  if (!received) return '';
  const day = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(received));
  const d = new Date(day + 'T00:00:00Z');
  for (let n = 0; n < days; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![0, 6].includes(d.getUTCDay())) n++;
  }
  return new Date(
    d.toISOString().slice(0, 10) + 'T23:59:59+09:00',
  ).toISOString();
}
const stamp = (id: string) => {
  const now = new Date().toISOString();
  return { id, createdAt: now, updatedAt: now };
};
export async function parseExcel(
  buffer: ArrayBuffer,
  sourceName = 'Excel',
): Promise<ExcelPlan> {
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as Parameters<typeof book.xlsx.load>[0]);
  } catch {
    throw Error(
      '엑셀을 읽지 못했습니다. 암호가 없는 .xlsx 파일인지 확인해 주세요.',
    );
  }
  const sheet = book.getWorksheet('채용프로세스 적시성');
  if (!sheet) throw Error('채용프로세스 적시성 시트를 찾을 수 없습니다.');
  const headers = [
    '채용건명',
    '의뢰 부서',
    '의뢰자',
    '지원자명',
    '요청 구분',
    '요청일',
    '처리완료일',
    '처리기한',
    '기한 판정',
    '인적성 검사 일시',
    '면접 일시',
    '현재 선발 단계',
    '최종 결과',
    '입사예정일',
    '실제 입사일',
    '비고',
  ];
  // The legacy expected-date column is optional. Keep logical field indices stable.
  const expectedColumnPresent = text(sheet.getRow(5).getCell(14).value) === '입사예정일';
  const sourceHeaders = headers.filter(header => header !== '입사예정일' || expectedColumnPresent);
  if (sourceHeaders.some((header, index) => text(sheet.getRow(5).getCell(index + 1).value) !== header))
    throw Error('5행 열 제목을 확인해 주세요. 입사예정일 열은 생략할 수 있으며, 실제 입사일·비고 등 나머지 기본 열은 유지해야 합니다.');
  const sourceColumns = headers.map(header => sourceHeaders.indexOf(header) + 1);
  const optionalColumn = (names: string[]) => {
    const columns: number[] = [];
    for (let col = sourceHeaders.length + 1; col <= sheet.columnCount; col++) {
      if (names.includes(text(sheet.getRow(5).getCell(col).value).replace(/\s+/g, ''))) columns.push(col);
    }
    if (columns.length > 1) throw Error(names[0] + ' 열이 중복되어 있습니다. 제목을 확인해 주세요.');
    return columns[0] || 0;
  };
  const locationColumn = optionalColumn(['면접장소']), interviewerColumn = optionalColumn(['면접관', '면접관명']);
  const jobIdColumn=optionalColumn(['채용고유번호','채용ID']), personIdColumn=optionalColumn(['지원자고유번호','지원자ID']), requestIdColumn=optionalColumn(['요청고유번호','요청ID']), interviewIdColumn=optionalColumn(['면접고유번호','면접ID']);
  const explicit = (row: import('exceljs').Row, col: number, prefix: string) => { const value=col?text(row.getCell(col).value):''; if(!value)return ''; if(!new RegExp('^'+prefix+'-[a-zA-Z0-9-]{8,100}$').test(value))throw Error(row.number+'행 고유번호 형식을 확인해 주세요. 앱에서 내려받은 번호를 사용하세요.'); return value; };
  const businessDays = Number(
    unwrap(book.getWorksheet('채용프로세스 요약')?.getCell('B11').value ?? 1),
  );
  if (!Number.isInteger(businessDays) || businessDays < 0 || businessDays > 60)
    throw Error('허용 처리기한(B11)은 0~60 영업일이어야 합니다.');
  const warnings = [
    '원본 파일은 수정하지 않습니다. 수식은 실행하지 않으며 입력값과 저장된 수식 결과를 읽습니다.',
    '시간이 없는 날짜는 시각을 추정하지 않습니다. 달력에서 일자만 표시합니다.',
    '고유번호가 없으면 동일 채용건·동일 이름을 한 지원자로 연결합니다. 동명이인은 지원자 고유번호로 구분해 주세요.',
    '날짜가 지난 일정도 면접완료로 추정하지 않습니다. 원본 선발 단계와 확인 필요 메모를 보존합니다.',
    '다시 가져오기는 같은 식별 키를 갱신합니다. 파일에서 삭제한 행은 앱에서 자동 삭제하지 않습니다.',
  ];
  const plan: ExcelPlan = {
    jobs: [],
    candidates: [],
    requests: [],
    interviews: [],
    warnings,
    rows: 0,
    businessDays,
    interviewFields: { location: !!locationColumn, interviewers: !!interviewerColumn },
    sourceName,
  };
  const jobMap = new Map<string, Requisition>(),
    candidateMap = new Map<string, Candidate>(),
    requestGroups = new Map<string, number>(),
    roundGroups = new Map<string, number>(),
    interviewMap = new Map<string, Interview>();
  const stateMap = new Map<string, string>();
  const overview = book.getWorksheet('채용건별 현황');
  overview?.eachRow((r, n) => {
    if (n >= 6 && text(r.getCell(1).value))
      stateMap.set(text(r.getCell(1).value), text(r.getCell(13).value));
  });
  for (let n = 6; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n),
      v = (col: number) => sourceColumns[col - 1] ? row.getCell(sourceColumns[col - 1]).value : null;
    const title = text(v(1));
    if (!title) continue;
    plan.rows++;
    const department = text(v(2)) || '미입력',
      requester = text(v(3)),
      name = text(v(4)),
      stage = text(v(5));
    if (!['채용 공고 등록', '인적성 검사 요청', '면접 요청'].includes(stage))
      throw Error(n + '행의 요청 구분을 확인해 주세요: ' + stage);
    const jobId = explicit(row,jobIdColumn,'excel-job') || await key('excel-job', [title, department]);
    if(jobMap.has(jobId) && (jobMap.get(jobId)!.role!==title || jobMap.get(jobId)!.department!==department))throw Error(n+'행 채용 고유번호가 다른 채용건과 중복됩니다.');
    if (!jobMap.has(jobId)) {
      const closed = stateMap.get(title);
      jobMap.set(jobId, {
        ...stamp(jobId),
        excelKey: title + ' | ' + department,
        code: '',
        department,
        requester,
        role: title,
        headcount: 1,
        reason:
          'Excel 연동 · 채용인원은 원본에 없어 기본 1명으로 표시합니다. 실제 인원은 수정해 주세요.',
        duties: '',
        requirements: '',
        preferred: '',
        targetJoin: '',
        status:
          closed === '채용완료'
            ? '채용완료'
            : closed === '자체종결'
              ? '자체종결'
              : '진행중',
      });
    }
    const receivedAt = date(v(6), n + '행 요청일'),
      completedAt = date(v(7), n + '행 처리완료일'),
      cachedDue = date(v(8), n + '행 처리기한', true);
    const examAt = date(v(10), n + '행 검사일시'),
      interviewAt = date(v(11), n + '행 면접일시'),
      expectedJoin = date(v(14), n + '행 입사예정일'),
      actualJoin = date(v(15), n + '행 실제입사일');
    if (
      receivedAt &&
      completedAt &&
      Date.parse(completedAt) < Date.parse(receivedAt)
    )
      throw Error(n + '행 처리완료일이 요청일보다 빠릅니다.');
    const current = text(v(12)),
      final = text(v(13)),
      note = text(v(16));
    let candidateId = '';
    const verification = [
      current === '확인 필요' && !finalStatus(final) ? '선발 단계 확인 필요' : '',
      /확인 필요|보류|취소|연락 안|불필요|타사/.test(note) ? note : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (name) {
      candidateId = explicit(row,personIdColumn,'excel-person') || await key('excel-person', [jobId, name]);
      if(candidateMap.has(candidateId) && (candidateMap.get(candidateId)!.name!==name || candidateMap.get(candidateId)!.requisitionId!==jobId))throw Error(n+'행 지원자 고유번호가 다른 지원자와 중복됩니다.');
      const old = candidateMap.get(candidateId);
      const known = [
        '검토중',
        '서류합격',
        '서류불합격',
        '일정조율',
        '면접예정',
        '면접완료',
        '처우협의',
        '최종합격',
        '불합격',
        '입사확정',
        '입사포기',
        '지원포기',
        '전형종료',
        '확인 필요',
        '실제 입사',
      ];
      const resolvedCurrent = (!current || current.replace(/\s/g, '') === '확인필요') && old?.excelStage?.replace(/\s/g, '') === '전형종료' ? old?.excelStage || current : current;
      const resolvedFinal = finalStatus(final) ? final : finalStatus(old?.excelFinal) ? old!.excelFinal! : final || old?.excelFinal || '';
      const status = candidateStatus({ status: known.includes(resolvedCurrent) ? resolvedCurrent as Candidate['status'] : old?.status || '확인 필요', excelStage: resolvedCurrent, excelFinal: resolvedFinal, actualJoin: actualJoin || old?.actualJoin });
      const notes = [old?.notes, '원본 ' + n + '행: ' + (note || '메모 없음')]
        .filter(Boolean)
        .join('\n');
      const picked: Candidate = {
        ...(old || {
          ...stamp(candidateId),
          requisitionId: jobId,
          name,
          source: 'Excel',
          career: '',
          phone: '',
          email: '',
          resumeName: '',
          resumeData: '',
        }),
        status,
        notes,
        excelStage: resolvedCurrent,
        excelFinal: resolvedFinal,
        expectedJoin: expectedJoin || old?.expectedJoin || '',
        actualJoin: actualJoin || old?.actualJoin || '',
      };
      candidateMap.set(candidateId, picked);
    }
    const group = [jobId, candidateId, stage, receivedAt],
      groupKey = JSON.stringify(group),
      round = (requestGroups.get(groupKey) || 0) + 1;
    requestGroups.set(groupKey, round);
    const roundKey = JSON.stringify(group.slice(0, 3)),
      stageRound = (roundGroups.get(roundKey) || 0) + 1;
    roundGroups.set(roundKey, stageRound);
    const id = explicit(row,requestIdColumn,'excel-request') || await key('excel-request', [...group, String(round)]);
    if(plan.requests.some(q=>q.id===id))throw Error(n+'행 요청 고유번호가 중복됩니다. 새 요청이면 복사한 요청 고유번호 셀을 비워 주세요.');
    const dateValues: Record<number, string> = { 6: receivedAt, 7: completedAt, 8: cachedDue, 10: examAt, 11: interviewAt, 14: expectedJoin, 15: actualJoin };
    const excelValues = Object.fromEntries(headers.map((header, index) => [header, index + 1 in dateValues ? (dateValues[index + 1] ? formatDate(dateValues[index + 1]) : '') : text(v(index + 1))]));
    if (locationColumn) excelValues['면접장소'] = text(row.getCell(locationColumn).value);
    if (interviewerColumn) excelValues['면접관'] = text(row.getCell(interviewerColumn).value);
    plan.requests.push({
      ...stamp(id),
      source: 'kpi-excel',
      sourceRow: n,
      explicitId: !!(requestIdColumn && text(row.getCell(requestIdColumn).value)),
      excelValues,
      verification,
      requisitionId: jobId,
      candidateId,
      excelJobId: jobId,
      stage: stage as ProcessRequest['stage'],
      round: stageRound,
      receivedAt,
      dueAt: cachedDue || due(receivedAt, businessDays),
      ...(stage === '인적성 검사 요청' ? { examAt } : {}),
      completedAt,
      status: completedAt ? '요청 완료' : '요청 전',
      owner: '',
      notes: note,
    });
    if (!receivedAt)
      warnings.push(
        n +
          '행: 요청일 미입력 — 요청을 보존하며 달력 접수일에는 표시하지 않습니다.',
      );
    if (interviewAt && candidateId) {
      const explicitId=explicit(row,interviewIdColumn,'excel-interview');
      const iid = explicitId || await key('excel-interview', [candidateId, interviewAt]);
      const completed =
        ['면접완료', '처우협의', '최종합격', '입사확정', '실제 입사'].includes(
          current,
        ) || !!actualJoin;
      const previous = interviewMap.get(iid);
      if(previous && (previous.candidateId!==candidateId || previous.startsAt!==interviewAt))throw Error(n+'행 면접 고유번호가 다른 일정과 중복됩니다. 새 면접이면 복사한 면접 고유번호 셀을 비워 주세요.');
      const location = locationColumn ? text(row.getCell(locationColumn).value) : '';
      const interviewers = interviewerColumn ? [...new Set(text(row.getCell(interviewerColumn).value).split(/[,，;；\r\n]+/).map(name => name.trim()).filter(Boolean))] : [];
      interviewMap.set(iid, {
        ...stamp(iid),
        source: 'kpi-excel',
        sourceRequestId: id,
        explicitId: !!explicitId,
        verification:
          verification ||
          (!completed ? '원본에서 면접 완료 여부를 확인해 주세요.' : ''),
        candidateId,
        startsAt: interviewAt,
        location: location || previous?.location || '장소 미입력',
        interviewers: interviewers.length ? interviewers : previous?.interviewers || ['면접관 미지정'],
        status: note.includes('면접취소')
          ? '취소'
          : completed
            ? '면접완료'
            : current === '면접예정'
              ? '면접예정'
              : '확인 필요',
      });
    }
    // Preserve exam dates as dated calendar records, without inventing interview events.
    if (candidateId && examAt) {
      const person = candidateMap.get(candidateId)!;
      person.examDates = [...new Set([...(person.examDates || []), examAt])];
      person.notes +=
        '\n인적성 검사 일시: ' +
        new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Seoul',
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(new Date(examAt));
    }
  }
  if (!plan.rows) throw Error('가져올 입력 행이 없습니다.');
  plan.jobs = [...jobMap.values()];
  plan.candidates = [...candidateMap.values()];
  plan.interviews = [...interviewMap.values()];
  for(const interview of plan.interviews) {const c=candidateMap.get(interview.candidateId);if(c && interview.status!=='취소' && ['면접완료','처우협의','최종합격','입사확정','실제 입사'].includes(candidateStatus(c)))interview.status='면접완료';}
  warnings.push(
    '불분명한 메모 ' +
      plan.requests.filter((q) => q.verification).length +
      '건은 확인 필요 표시로 남깁니다.',
  );
  plan.qualityIssues = qualityIssues(plan);
  plan.warnings.push(...plan.qualityIssues.map(issue=>issue.row+'행 '+issue.field+': '+issue.message));
  return plan;
}
export function applyExcelPlan(data: RecruitmentData, plan: ExcelPlan) {
  const upsert = <T extends { id: string; createdAt: string; updatedAt: string }>(
    rows: T[],
    next: T[],
    merge = false,
  ) => {
    for (const item of next) {
      const index = rows.findIndex((r) => r.id === item.id);
      if (index < 0) rows.push(structuredClone(item));
      else {
        const previous = rows[index];
        const next = { ...(merge ? previous : {}), ...structuredClone(item), createdAt: previous.createdAt } as T;
        const unchanged = JSON.stringify({ ...previous, createdAt: '', updatedAt: '' }) === JSON.stringify({ ...next, createdAt: '', updatedAt: '' });
        rows[index] = { ...next, updatedAt: unchanged ? previous.updatedAt : next.updatedAt };
      }
    }
  };
  const year = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
    }).format(new Date()),
    prefix = 'HR-' + year + '-';
  let serial = data.requisitions
    .filter((r) => r.code.startsWith(prefix))
    .reduce((n, r) => Math.max(n, Number(r.code.slice(prefix.length)) || 0), 0);
  const jobs = plan.jobs.map((j) => {
    const old = data.requisitions.find((r) => r.id === j.id);
    return {
      ...j,
      code: old?.code || prefix + String(++serial).padStart(3, '0'),
      headcount: old?.headcount || j.headcount,
      reason: old?.reason || j.reason, duties: old?.duties || j.duties, requirements: old?.requirements || j.requirements, preferred: old?.preferred || j.preferred,
    };
  });
  upsert(data.requisitions, jobs, true);
  // Personal contact data and resumes entered in the app remain intact.
  const people = plan.candidates.map((c) => {
    const old = data.candidates.find((p) => p.id === c.id);
    return old
      ? {
          ...c,
          phone: old.phone,
          email: old.email,
          resumeName: old.resumeName,
          resumeData: old.resumeData,
          resumeId: old.resumeId,
          career: old.career,
          appNotes: old.appNotes,
        }
      : c;
  });
  upsert(data.candidates, people, true);
  data.requests ||= [];
  upsert(data.requests, plan.requests.map(q => {
    const old = data.requests!.find(row => row.id === q.id);
    return q.stage === '인적성 검사 요청' ? { ...q, appNotes: old?.appNotes, examDeadline: old?.examDeadline || '', examStatus: old?.examStatus || (q.examAt ? '검사예정' as const : '미실시' as const) } : { ...q, appNotes: old?.appNotes };
  }));
  upsert(
    data.interviews,
    plan.interviews.map((i) => {
      const old = data.interviews.find((row) => row.id === i.id);
      const location = plan.interviewFields?.location ? i.location : old?.location || i.location;
      const interviewers = plan.interviewFields?.interviewers ? i.interviewers : old?.interviewers || i.interviewers;
      const pastInterviewers = [...new Set([...(old?.pastInterviewers || []), ...data.evaluations.filter(e => e.interviewId === i.id).map(e => e.evaluator)])].filter(name => !interviewers.includes(name));
      return { ...i, durationMinutes: old?.durationMinutes, appNotes: old?.appNotes, location, interviewers, ...(pastInterviewers.length ? { pastInterviewers } : {}) };
    }),
  );
}
export function excludedSummary(q: ProcessRequest, data: RecruitmentData) {
  return (
    !q.candidateId &&
    ['인적성 검사 요청', '면접 요청'].includes(q.stage) &&
    (data.requests || []).some(
      (r) =>
        r.requisitionId === q.requisitionId &&
        r.stage === q.stage &&
        !!r.candidateId &&
        !!r.receivedAt,
    )
  );
}

// Automatic mode follows one connected workbook; manually created records remain independent.
export function applyExcelSnapshot(data: RecruitmentData, plan: ExcelPlan) {
  const before = structuredClone(data);
  const jobs = new Set(plan.jobs.map((j) => j.id)),
    people = new Set(plan.candidates.map((c) => c.id)),
    requests = new Set(plan.requests.map((q) => q.id)),
    interviews = new Set(plan.interviews.map((i) => i.id));
  data.requests = (data.requests || []).filter(
    (q) => q.source !== 'kpi-excel' || requests.has(q.id),
  );
  data.interviews = data.interviews.filter((i) => {
    if (i.source !== 'kpi-excel' || interviews.has(i.id)) return true;
    if (data.evaluations.some((e) => e.interviewId === i.id)) {
      i.status = '취소';
      i.verification =
        '엑셀에서 제외된 일정입니다. 기존 평가 기록은 보존합니다.';
      return true;
    }
    return false;
  });
  for (const j of data.requisitions)
    if (j.id.startsWith('excel-job-')) j.excelMissing = !jobs.has(j.id);
  for (const c of data.candidates)
    if (c.id.startsWith('excel-person-')) c.excelMissing = !people.has(c.id);
  applyExcelPlan(data, plan);
  for (const j of data.requisitions) if (jobs.has(j.id)) j.excelMissing = false;
  for (const c of data.candidates) if (people.has(c.id)) c.excelMissing = false;
  const run = excelChanges(before, data, plan.sourceName);
  if (plan.sourceModifiedAt) run.sourceModifiedAt = plan.sourceModifiedAt;
  if (run.changes.length || !data.excelRuns?.length) data.excelRuns = [run, ...(data.excelRuns || [])];
}
