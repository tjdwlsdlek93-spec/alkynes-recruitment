export const requisitionStatuses = [
  '진행중',
  '채용요청',
  '요청검토',
  '채용승인',
  '공고중',
  '서류검토',
  '면접예정',
  '면접완료',
  '처우협의',
  '입사확정',
  '채용완료',
  '채용보류',
  '채용취소',
  '자체종결',
] as const;
export const candidateStatuses = [
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
] as const;
export const ratings = ['우수', '적합', '보통', '미흡'] as const;
export const recommendations = ['적극 추천', '추천', '보류', '불합격'] as const;
export type Stamped = { id: string; createdAt: string; updatedAt: string };
export type Requisition = Stamped & {
  excelKey?: string;
  excelMissing?: boolean;
  code: string;
  department: string;
  requester: string;
  role: string;
  headcount: number;
  reason: string;
  duties: string;
  requirements: string;
  preferred: string;
  targetJoin: string;
  status: (typeof requisitionStatuses)[number];
};
export type Candidate = Stamped & {
  requisitionId: string;
  excelMissing?: boolean;
  excelStage?: string;
  excelFinal?: string;
  examDates?: string[];
  expectedJoin?: string;
  actualJoin?: string;
  name: string;
  source: string;
  career: string;
  phone: string;
  email: string;
  status: (typeof candidateStatuses)[number];
  notes: string;
  resumeName: string;
  resumeData: string;
};
export type Interview = Stamped & {
  candidateId: string;
  startsAt: string;
  location: string;
  interviewers: string[];
  pastInterviewers?: string[];
  source?: string;
  verification?: string;
  status: '면접예정' | '면접완료' | '취소' | '확인 필요';
};
export type Evaluation = Stamped & {
  interviewId: string;
  evaluator: string;
  jobFit: (typeof ratings)[number];
  capability: (typeof ratings)[number];
  cultureFit: (typeof ratings)[number];
  overall: (typeof recommendations)[number];
  comment: string;
};
export const requestStages = [
  '채용 공고 등록',
  '인적성 검사 요청',
  '면접 요청',
] as const;
export const requestStatuses = ['요청 전', '요청 완료', '취소'] as const;
export type ProcessRequest = Stamped & {
  requisitionId: string;
  candidateId: string;
  excelJobId: string;
  stage: (typeof requestStages)[number];
  round: number;
  receivedAt: string;
  dueAt: string;
  completedAt: string;
  source?: string;
  sourceRow?: number;
  examAt?: string;
  examDeadline?: string;
  examStatus?: '미실시' | '검사예정' | '실시완료';
  verification?: string;
  status: (typeof requestStatuses)[number];
  owner: string;
  notes: string;
};
export type Activity = {
  id: string;
  at: string;
  actor: string;
  message: string;
};
export type RecruitmentData = {
  version: 1;
  requisitions: Requisition[];
  candidates: Candidate[];
  interviews: Interview[];
  evaluations: Evaluation[];
  activity: Activity[];
  requests?: ProcessRequest[];
};
export const storageKey = 'alkynes.recruitment.v1';
export function newStamp(): Stamped {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}
export function nextCode(
  rows: Requisition[],
  year = Number(
    new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
    }).format(new Date()),
  ),
) {
  const prefix = 'HR-' + year + '-';
  const max = rows
    .filter((r) => r.code.startsWith(prefix))
    .reduce((n, r) => Math.max(n, Number(r.code.slice(prefix.length)) || 0), 0);
  return prefix + String(max + 1).padStart(3, '0');
}
export function seedData(): RecruitmentData {
  const stamp = {
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const base = {
    ...stamp,
    requester: '',
    reason: '',
    duties: '',
    requirements: '',
    preferred: '',
  };
  const person = {
    ...stamp,
    phone: '',
    email: '',
    notes: '',
    resumeName: '',
    resumeData: '',
  };
  return {
    version: 1,
    requisitions: [
      {
        ...base,
        id: 'r1',
        code: 'HR-2026-001',
        department: '생산팀',
        role: '생산직',
        headcount: 2,
        targetJoin: '2026-11-02',
        status: '면접예정',
      },
      {
        ...base,
        id: 'r2',
        code: 'HR-2026-002',
        department: '품질관리팀',
        role: '품질관리',
        headcount: 1,
        targetJoin: '2026-11-01',
        status: '서류검토',
      },
      {
        ...base,
        id: 'r3',
        code: 'HR-2026-003',
        department: '기술연구소',
        role: '연구원',
        headcount: 1,
        targetJoin: '',
        status: '공고중',
      },
    ],
    candidates: [
      {
        ...person,
        id: 'c1',
        requisitionId: 'r2',
        name: '홍길동',
        source: '사람인',
        career: '4년',
        status: '면접예정',
      },
      {
        ...person,
        id: 'c2',
        requisitionId: 'r1',
        name: '김지원',
        source: '잡코리아',
        career: '2년',
        status: '일정조율',
      },
      {
        ...person,
        id: 'c3',
        requisitionId: 'r3',
        name: '이연구',
        source: '추천',
        career: '5년',
        status: '검토중',
      },
    ],
    interviews: [
      {
        ...stamp,
        id: 'i1',
        candidateId: 'c1',
        startsAt: '2026-10-20T14:00:00+09:00',
        location: '본사 2층 회의실',
        interviewers: ['박팀장', '이부장'],
        status: '면접예정',
      },
    ],
    requests: [],
    evaluations: [],
    activity: [],
  };
}
export function formatDate(value: string) {
  return value
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '미정';
}
export function localDateTime(value: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date(value))
    .replace(' ', 'T');
}
export function download(
  name: string,
  content: string,
  type = 'application/json',
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function calendarFile(i: Interview, c: Candidate) {
  const date = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const escape = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  const start = new Date(i.startsAt),
    end = new Date(start.getTime() + 3600000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ALKYNES//Recruitment//KO',
    'BEGIN:VEVENT',
    'UID:' + i.id + '@alkynes.local',
    'DTSTAMP:' + date(new Date()),
    'DTSTART:' + date(start),
    'DTEND:' + date(end),
    'SUMMARY:' + escape(c.name + ' 면접'),
    'LOCATION:' + escape(i.location),
    'DESCRIPTION:' + escape('면접관: ' + i.interviewers.join(', ')),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return (
    lines
      .map((line) => {
        let out = '',
          count = 0;
        for (const char of line) {
          const size = new TextEncoder().encode(char).length;
          if (count + size > 73) {
            out += '\r\n ';
            count = 1;
          }
          out += char;
          count += size;
        }
        return out;
      })
      .join('\r\n') + '\r\n'
  );
}
export function validateData(value: unknown): value is RecruitmentData {
  if (!value || typeof value !== 'object') return false;
  const d = value as RecruitmentData;
  const str = (r: object, keys: string[]) =>
    keys.every((k) => typeof (r as Record<string, unknown>)[k] === 'string');
  const stamp = (r: Stamped) =>
    r &&
    str(r, ['id', 'createdAt', 'updatedAt']) &&
    !!r.id &&
    Number.isFinite(Date.parse(r.createdAt)) &&
    Number.isFinite(Date.parse(r.updatedAt));
  const unique = (rows: { id: string }[]) =>
    rows.every((r) => !!r && typeof r.id === 'string') &&
    new Set(rows.map((r) => r.id)).size === rows.length;
  if (
    d.version !== 1 ||
    ![
      'requisitions',
      'candidates',
      'interviews',
      'evaluations',
      'activity',
    ].every((k) => Array.isArray((d as unknown as Record<string, unknown>)[k]))
  )
    return false;
  if (
    !d.requisitions.every(
      (r) =>
        stamp(r) &&
        str(r, [
          'code',
          'department',
          'requester',
          'role',
          'reason',
          'duties',
          'requirements',
          'preferred',
          'targetJoin',
        ]) &&
        r.department.trim() &&
        r.role.trim() &&
        /^HR-\d{4}-\d+$/.test(r.code) &&
        Number.isInteger(r.headcount) &&
        r.headcount > 0 &&
        requisitionStatuses.includes(r.status) &&
        (!r.targetJoin || /^\d{4}-\d{2}-\d{2}$/.test(r.targetJoin)),
    )
  )
    return false;
  if (new Set(d.requisitions.map((r) => r.code)).size !== d.requisitions.length)
    return false;
  if (
    !d.candidates.every(
      (c) =>
        stamp(c) &&
        str(c, [
          'requisitionId',
          'name',
          'source',
          'career',
          'phone',
          'email',
          'notes',
          'resumeName',
          'resumeData',
        ]) &&
        c.name.trim() &&
        candidateStatuses.includes(c.status) &&
        d.requisitions.some((r) => r.id === c.requisitionId) &&
        (!c.resumeData ||
          (/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(
            c.resumeData,
          ) &&
            c.resumeData.length < 1500000)),
    )
  )
    return false;
  if (
    !d.interviews.every(
      (i) =>
        stamp(i) &&
        str(i, ['candidateId', 'startsAt', 'location']) &&
        Number.isFinite(Date.parse(i.startsAt)) &&
        Array.isArray(i.interviewers) &&
        i.interviewers.length > 0 &&
        i.interviewers.every((x) => typeof x === 'string' && x.trim()) &&
        (i.pastInterviewers === undefined || (Array.isArray(i.pastInterviewers) && i.pastInterviewers.every(x => typeof x === 'string' && x.trim()) && new Set(i.pastInterviewers).size === i.pastInterviewers.length)) &&
        ['면접예정', '면접완료', '취소', '확인 필요'].includes(i.status) &&
        d.candidates.some((c) => c.id === i.candidateId),
    )
  )
    return false;
  if (
    !d.evaluations.every(
      (e) =>
        stamp(e) &&
        str(e, ['interviewId', 'evaluator', 'comment']) &&
        e.evaluator.trim() &&
        ratings.includes(e.jobFit) &&
        ratings.includes(e.capability) &&
        ratings.includes(e.cultureFit) &&
        recommendations.includes(e.overall) &&
        d.interviews.some(
          (i) => i.id === e.interviewId && [...i.interviewers, ...(i.pastInterviewers || [])].includes(e.evaluator),
        ),
    )
  )
    return false;
  const optionalStrings = (row: object, keys: string[]) =>
    keys.every(
      (k) =>
        (row as Record<string, unknown>)[k] === undefined ||
        typeof (row as Record<string, unknown>)[k] === 'string',
    );
  if (
    !d.requisitions.every(
      (r) =>
        optionalStrings(r, ['excelKey']) &&
        (r.excelMissing === undefined || typeof r.excelMissing === 'boolean'),
    ) ||
    !d.candidates.every(
      (c) =>
        (c.excelMissing === undefined || typeof c.excelMissing === 'boolean') &&
        optionalStrings(c, [
          'excelStage',
          'excelFinal',
          'expectedJoin',
          'actualJoin',
        ]) &&
        [c.expectedJoin, c.actualJoin].every(
          (v) => !v || Number.isFinite(Date.parse(v)),
        ) &&
        (c.examDates === undefined ||
          (Array.isArray(c.examDates) &&
            c.examDates.every(
              (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)),
            ))),
    ) ||
    !d.interviews.every((i) => optionalStrings(i, ['source', 'verification']))
  )
    return false;
  if (
    d.requests !== undefined &&
    (!Array.isArray(d.requests) ||
      !unique(d.requests) ||
      !d.requests.every(
        (q) =>
          stamp(q) &&
          optionalStrings(q, ['source', 'verification', 'examAt', 'examDeadline']) &&
          (!q.examAt || Number.isFinite(Date.parse(q.examAt))) &&
          (!q.examDeadline || Number.isFinite(Date.parse(q.examDeadline))) &&
          (q.examStatus === undefined || ['미실시', '검사예정', '실시완료'].includes(q.examStatus)) &&
          (q.sourceRow === undefined ||
            (Number.isInteger(q.sourceRow) && q.sourceRow > 0)) &&
          str(q, [
            'requisitionId',
            'candidateId',
            'excelJobId',
            'receivedAt',
            'dueAt',
            'completedAt',
            'owner',
            'notes',
          ]) &&
          requestStages.includes(q.stage) &&
          requestStatuses.includes(q.status) &&
          Number.isInteger(q.round) &&
          q.round > 0 &&
          (!q.receivedAt || Number.isFinite(Date.parse(q.receivedAt))) &&
          (!q.dueAt ||
            (Number.isFinite(Date.parse(q.dueAt)) &&
              (!q.receivedAt ||
                Date.parse(q.dueAt) >= Date.parse(q.receivedAt)))) &&
          (!q.completedAt ||
            (Number.isFinite(Date.parse(q.completedAt)) &&
              (!q.receivedAt ||
                Date.parse(q.completedAt) >= Date.parse(q.receivedAt)))) &&
          (q.status === '요청 완료'
            ? !!q.completedAt
            : q.status !== '요청 전' || !q.completedAt) &&
          d.requisitions.some((r) => r.id === q.requisitionId) &&
          (!q.candidateId ||
            d.candidates.some(
              (c) =>
                c.id === q.candidateId && c.requisitionId === q.requisitionId,
            )),
      ))
  )
    return false;
  if (
    new Set(d.evaluations.map((e) => e.interviewId + '|' + e.evaluator))
      .size !== d.evaluations.length
  )
    return false;
  return (
    [d.requisitions, d.candidates, d.interviews, d.evaluations].every(unique) &&
    d.activity.every(
      (a) =>
        a &&
        str(a, ['id', 'at', 'actor', 'message']) &&
        Number.isFinite(Date.parse(a.at)),
    )
  );
}
