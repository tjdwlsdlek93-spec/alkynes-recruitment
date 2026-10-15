import type { RecruitmentData, ProcessRequest } from './recruitment';
export function koreaDate(value = new Date().toISOString()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
export function defaultDueDate(received: string) {
  const date = new Date(received.slice(0, 10) + 'T00:00:00Z');
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while ([0, 6].includes(date.getUTCDay()));
  return date.toISOString().slice(0, 10) + 'T23:59';
}
export function requestTiming(q: ProcessRequest, now = Date.now()) {
  if (q.status === '취소') return '제외';
  if (!q.receivedAt || !q.dueAt) return '일자 확인 필요';
  if (q.status === '요청 완료')
    return Date.parse(q.completedAt) <= Date.parse(q.dueAt) ? 'OK' : '지연';
  return now > Date.parse(q.dueAt) ? '기한초과' : '진행중';
}
export type CalendarEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  status: string;
  timing: string;
  href: string;
};
export function calendarEvents(data: RecruitmentData): CalendarEvent[] {
  const labels = (reqId: string, candidateId: string) => {
    const req = data.requisitions.find((r) => r.id === reqId),
      c = data.candidates.find((c) => c.id === candidateId);
    return (req?.role || '') + ' ' + (c?.name || '채용건 공통');
  };
  const time = (value: string) =>
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  const events: CalendarEvent[] = data.interviews.map((i) => {
    const c = data.candidates.find((c) => c.id === i.candidateId);
    return {
      id: 'interview-' + i.id,
      date: koreaDate(i.startsAt),
      time: time(i.startsAt),
      title: labels(c?.requisitionId || '', i.candidateId) + ' 면접',
      status: i.status,
      timing: i.verification || '',
      href: '/interviews?candidate=' + i.candidateId,
    };
  });
  for (const c of data.candidates.filter(c=>!c.excelMissing)) {
    for (const [kind, dates] of [
      ['인적성 검사', (data.requests || []).some(q => q.candidateId === c.id && q.stage === '인적성 검사 요청' && q.examAt) ? [] : c.examDates || []],
      ['입사예정', c.expectedJoin ? [c.expectedJoin] : []],
      ['실제 입사', c.actualJoin ? [c.actualJoin] : []],
    ] as const) {
      for (const date of dates)
        events.push({
          id: kind + '-' + c.id + '-' + date,
          date: koreaDate(date),
          time: time(date),
          title: labels(c.requisitionId, c.id) + ' ' + kind,
          status: kind === '실제 입사' ? '입사 기록' : '일정 기록',
          timing: '',
          href: '/candidates?requisition=' + c.requisitionId,
        });
    }
  }
  for (const q of data.requests || []) {
    if (q.stage === '인적성 검사 요청' && q.examAt && q.status !== '취소') events.push({
      id: 'aptitude-' + q.id, date: koreaDate(q.examAt), time: time(q.examAt),
      title: labels(q.requisitionId, q.candidateId) + ' 인적성 검사 · ' + q.round + '회차',
      status: q.examStatus || '검사예정', timing: '', href: '/aptitudes',
    });
    if (q.receivedAt)
      events.push({
        id: 'request-' + q.id,
        date: koreaDate(q.receivedAt),
        time: time(q.receivedAt),
        title:
          labels(q.requisitionId, q.candidateId) +
          ' ' +
          q.stage +
          ' · ' +
          q.round +
          '회차',
        status: q.status,
        timing: requestTiming(q),
        href: '/requests?request=' + q.id,
      });
    if (q.status === '요청 전' && q.dueAt)
      events.push({
        id: 'due-' + q.id,
        date: koreaDate(q.dueAt),
        time: time(q.dueAt),
        title: labels(q.requisitionId, q.candidateId) + ' ' + q.stage + ' 마감',
        status: q.status,
        timing: requestTiming(q),
        href: '/requests?request=' + q.id,
      });
  }
  return events.sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time),
  );
}
export function requestsCSV(data: RecruitmentData) {
  const headers = [
    '요청ID',
    '채용건ID',
    '앱채용번호',
    '채용건명',
    '부서',
    '지원자ID',
    '지원자명',
    '단계',
    '회차',
    '접수일시',
    '처리기한',
    '완료일시',
    '진행상태',
    '기한판정',
    '예정일시',
    '담당자',
    '요청자',
    '취소여부',
    '비고',
    '원본행',
  ];
  const datetime = (v: string) =>
    v
      ? new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(v))
      : '';
  const quote = (v: unknown) => {
    let text = String(v ?? '');
    if (/^[=+@\-\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows = (data.requests || []).map((q) => {
    const r = data.requisitions.find((r) => r.id === q.requisitionId)!,
      c = data.candidates.find((c) => c.id === q.candidateId);
    return [
      q.id,
      q.excelJobId || r.code,
      r.code,
      r.department + ' ' + r.role,
      r.department,
      c?.id || '',
      c?.name || '',
      q.stage,
      q.round,
      datetime(q.receivedAt),
      datetime(q.dueAt),
      datetime(q.completedAt),
      q.status,
      requestTiming(q),
      '',
      q.owner,
      r.requester,
      q.status === '취소' ? '취소' : '정상',
      q.notes,
      '',
    ];
  });
  return (
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map(quote).join(',')).join('\r\n')
  );
}
