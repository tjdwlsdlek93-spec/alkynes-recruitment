const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module');
const ts = require('typescript'),
  ExcelJS = require('exceljs');
function load(name) {
  const filename = path.resolve(__dirname, '../lib/' + name + '.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = m.require.bind(m);
  m.require = request => request.startsWith('./') && fs.existsSync(path.resolve(path.dirname(filename), request + '.ts')) ? load(request.slice(2)) : originalRequire(request);
  m._compile(js, filename);
  return m.exports;
}
const { parseExcel, applyExcelPlan, excludedSummary } = load('excel');
const { seedData, validateData } = load('recruitment');
const { calendarEvents, requestTiming } = load('scheduling');
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
async function sample() {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('채용프로세스 적시성');
  sheet.getRow(5).values = headers;
  book.addWorksheet('채용프로세스 요약').getCell('B11').value = 2;
  const overview = book.addWorksheet('채용건별 현황');
  overview.getCell('A6').value = '생산직';
  overview.getCell('M6').value = '진행중';
  for (const [offset, name, received, complete, scheduled, note] of [
    [0, '', '2026-10-12', '2026-10-12', '', '기존 요약'],
    [
      1,
      '테스트갑',
      '2026-10-13',
      '',
      '2026-10-15T14:00',
      '연락 안 됨, 결과 확인 필요',
    ],
    [2, '테스트을', '2026-10-13', '2026-10-14T11:00', '2026-10-16T09:30', ''],
    [3, '테스트갑', '2026-10-14', '2026-10-14', '2026-10-15T14:00', '재요청'],
  ]) {
    const row = sheet.getRow(6 + offset);
    row.values = [
      '생산직',
      '생산팀',
      '담당자',
      name,
      '면접 요청',
      new Date(received + 'Z'),
      complete ? new Date(complete + 'Z') : null,
      null,
      null,
      null,
      scheduled ? new Date(scheduled + 'Z') : null,
      '확인 필요',
      '미확정',
      null,
      null,
      note,
    ];
    for (const i of [6, 7, 8, 10, 11, 14, 15])
      row.getCell(i).numFmt = 'yyyy-mm-dd hh:mm';
  }
  const bytes = await book.xlsx.writeBuffer();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}
test('imports distinct people and repeated requests, keeps unknown results and Korean times, and is repeatable', async () => {
  const plan = await parseExcel(await sample(), 'sample.xlsx');
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.requests.length, 4);
  assert.equal(plan.interviews.length, 2);
  const data = seedData();
  applyExcelPlan(data, plan);
  assert.equal(validateData(data), true);
  const person = data.candidates.find((p) => p.name === '테스트갑');
  assert.equal(person.status, '확인 필요');
  assert.equal(
    plan.interviews.find((i) => i.candidateId === person.id).startsAt,
    '2026-10-15T05:00:00.000Z',
  );
  assert.deepEqual(
    plan.requests
      .filter((q) => q.candidateId === person.id)
      .map((q) => q.round),
    [1, 2],
  );
  assert.equal(excludedSummary(plan.requests[0], data), true);
  assert.equal(
    requestTiming(plan.requests[1], Date.parse('2026-10-14T00:00:00Z')),
    '진행중',
  );
  person.phone = '010-1234-5678';
  person.resumeData = 'data:application/pdf;base64,JVBERg==';
  person.resumeName = 'resume.pdf';
  const before = [
    data.requisitions.length,
    data.candidates.length,
    data.interviews.length,
    data.requests.length,
  ];
  applyExcelPlan(data, plan);
  assert.deepEqual(
    [
      data.requisitions.length,
      data.candidates.length,
      data.interviews.length,
      data.requests.length,
    ],
    before,
  );
  assert.equal(
    data.candidates.find((p) => p.id === person.id).phone,
    '010-1234-5678',
  );
  assert.equal(
    data.candidates.find((p) => p.id === person.id).resumeName,
    'resume.pdf',
  );
  assert.equal(validateData(data), true);
  const events = calendarEvents(data);
  assert.ok(
    events.some(
      (e) =>
        e.date === '2026-10-15' &&
        e.time === '14:00' &&
        e.title.includes('테스트갑'),
    ),
  );
  assert.ok(
    events.some((e) => e.date === '2026-10-13' && e.status === '요청 전'),
  );
});
test('rejects incompatible layouts without modifying current app data', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Wrong sheet');
  const bytes = await book.xlsx.writeBuffer();
  await assert.rejects(
    () =>
      parseExcel(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
    /시트를 찾을 수 없습니다/,
  );
});
test(
  'reads the supplied October 14 workbook without changing its bytes',
  { skip: !process.env.KPI_TEST_FILE },
  async () => {
    const before = fs.readFileSync(process.env.KPI_TEST_FILE),
      plan = await parseExcel(
        before.buffer.slice(
          before.byteOffset,
          before.byteOffset + before.byteLength,
        ),
      );
    assert.deepEqual(
      [
        plan.rows,
        plan.jobs.length,
        plan.candidates.length,
        plan.requests.length,
        plan.interviews.length,
      ],
      [27, 8, 12, 27, 4],
    );
    const d = seedData();
    applyExcelPlan(d, plan);
    assert.equal(validateData(d), true);
    const p = plan.candidates.find((c) => c.name === (process.env.KPI_TEST_INTERVIEW_NAME || '테스트지원자A'));
    assert.equal(
      plan.interviews.find((i) => i.candidateId === p.id).startsAt,
      '2026-10-15T05:00:00.000Z',
    );
    const unconfirmed = plan.candidates.find((c) => c.name === (process.env.KPI_TEST_UNCONFIRMED_NAME || '테스트지원자B'));
    assert.equal(unconfirmed.status, '확인 필요');
    assert.equal(unconfirmed.actualJoin, '');
    assert.ok(!plan.interviews.some((i) => i.candidateId === unconfirmed.id));
    assert.equal(plan.requests.filter((q) => excludedSummary(q, d)).length, 3);
    applyExcelPlan(d, plan);
    assert.equal(d.requests.length, 27);
    assert.equal(validateData(d), true);
    assert.deepEqual(fs.readFileSync(process.env.KPI_TEST_FILE), before);
  },
);

test('removes only original sample jobs, cascades related records and preserves imported jobs', async () => {
  const { removeLegacySamples, removeJob, requestedPeople, closedJob } = load('recruitment-view');
  const data = seedData();
  const extra = structuredClone(data.requisitions[0]);
  extra.id = 'user-job'; extra.code = 'HR-2026-004';
  data.requisitions.push(extra);
  removeLegacySamples(data);
  assert.deepEqual(data.requisitions.map(r => r.id), ['user-job']);
  assert.equal(data.candidates.length, 0);
  assert.equal(data.interviews.length, 0);
  assert.ok(validateData(data));
  const file = process.env.KPI_TEST_FILE;
  if (file) {
    const plan = await parseExcel(fs.readFileSync(file), path.basename(file));
    const imported = seedData();
    applyExcelPlan(imported, plan);
    removeLegacySamples(imported);
    const active = imported.requisitions.filter(r => !closedJob(r));
    assert.equal(active.length, 4);
    assert.equal(active.reduce((sum, r) => sum + requestedPeople(imported, r.id).length, 0), 11);
    const job = active.find(r => requestedPeople(imported, r.id).length > 0);
    removeJob(imported, job.id);
    assert.ok(!imported.candidates.some(c => c.requisitionId === job.id));
    assert.ok(!(imported.requests || []).some(q => q.requisitionId === job.id));
    assert.ok(validateData(imported));
  }
});

test('Excel final outcomes override verification stage and survive later request rows and reimports', async () => {
  const { endedCandidate } = load('candidate-state');
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await sample());
  const sheet = book.getWorksheet('채용프로세스 적시성');
  // One person has more than one request: a later blank outcome must not reset it.
  sheet.getRow(7).getCell(13).value = '지원 포기';
  sheet.getRow(9).getCell(13).value = '미확정';
  sheet.getRow(8).getCell(13).value = '입사포기';
  let plan = await parseExcel(await book.xlsx.writeBuffer(), 'outcomes.xlsx');
  assert.equal(plan.candidates.find(c => c.name === '테스트갑').status, '지원포기');
  assert.equal(plan.candidates.find(c => c.name === '테스트을').status, '입사포기');
  assert.ok(plan.candidates.every(endedCandidate));
  const data = seedData(); applyExcelPlan(data, plan); assert.ok(validateData(data));
  sheet.getRow(7).getCell(13).value = '불합격';
  plan = await parseExcel(await book.xlsx.writeBuffer(), 'outcomes.xlsx');
  applyExcelPlan(data, plan);
  const applicant = data.candidates.filter(c => c.name === '테스트갑');
  assert.equal(applicant.length, 1); assert.equal(applicant[0].status, '불합격');
  // Old browser records also show the final outcome without requiring a fresh Excel import.
  applicant[0].status = '확인 필요';
  load('recruitment-view').removeLegacySamples(data);
  assert.equal(applicant[0].status, '불합격');
});

test('aptitude schedule imports from Excel, manual completion survives reimport, and private notes are excluded from share messages', async () => {
  const { aptitudeMessage, interviewMessage } = load('messages');
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await sample());
  const sheet = book.getWorksheet('채용프로세스 적시성');
  sheet.getRow(7).getCell(5).value = '인적성 검사 요청';
  sheet.getRow(7).getCell(10).value = new Date('2026-10-16T10:00:00Z');
  const plan = await parseExcel(await book.xlsx.writeBuffer(), 'test.xlsx');
  const data = seedData(); applyExcelPlan(data, plan);
  const request = data.requests.find(q => q.stage === '인적성 검사 요청');
  assert.equal(request.examAt, '2026-10-16T01:00:00.000Z');
  assert.equal(request.examStatus, '검사예정');
  const exams = calendarEvents(data).filter(e => e.id.startsWith('aptitude-'));
  assert.equal(exams.length, 1);
  assert.equal(exams[0].date, '2026-10-16');
  assert.equal(exams[0].time, '10:00');
  request.examStatus = '실시완료'; request.notes = '공유하면 안 되는 내부 메모';
  request.examDeadline = '2026-10-19T09:00:00.000Z';
  const aptitude = aptitudeMessage(data, request, 'internal');
  assert.ok(aptitude.includes('응시기한: 2026년 10월 19일'));
  assert.ok(!/처리기한|검사 일정|처리 상태|실시 상태|회차|회신/.test(aptitude));
  assert.ok(!aptitudeMessage(data, request, 'internal').includes(request.notes));
  const note = interviewMessage(data, data.interviews[0], 'candidate');
  assert.ok(!note.includes('면접관:'));
  assert.ok(note.includes('안녕하세요, 알킨스 경영지원팀 민성진 과장입니다.'));
  assert.ok(note.includes('(경기도 평택시 청북읍 청북중앙로 578-19)'));
  assert.ok(!/한국시간|회신/.test(note));
  const internal = interviewMessage(data, data.interviews[0], 'internal');
  assert.ok(internal.startsWith('안녕하세요!'));
  assert.ok(!internal.includes('청북중앙로'));
  applyExcelPlan(data, plan);
  assert.equal(data.requests.find(q => q.id === request.id).examStatus, '실시완료');
  assert.equal(data.requests.find(q => q.id === request.id).examDeadline, '2026-10-19T09:00:00.000Z');
  assert.ok(validateData(data));
  data.requests.find(q => q.id === request.id).examStatus = '잘못된상태';
  assert.equal(validateData(data), false);
});


test('dashboard and calendar honor terminal outcomes while preserving completed interviews and genuine unresolved records', () => {
  const { activeInterview, interviewGroup } = load('interview-state');
  const data = seedData(), person = data.candidates.find(c => c.id === data.interviews[0].candidateId), interview = data.interviews[0];
  person.status = '확인 필요'; person.excelStage = '전형종료'; person.excelFinal = '입사포기';
  interview.status = '확인 필요'; interview.verification = '선발 단계 확인 필요';
  assert.equal(activeInterview(data, interview), false);
  assert.equal(interviewGroup(data, interview), 'cancelled');
  const event = calendarEvents(data).find(e => e.id === 'interview-' + interview.id);
  assert.equal(event.status, '전형 종료 · 입사포기'); assert.equal(event.timing, '');
  interview.status = '면접완료';
  assert.equal(interviewGroup(data, interview), 'completed');
  assert.equal(calendarEvents(data).find(e => e.id === event.id).status, '면접완료');
  assert.equal(calendarEvents(data).find(e => e.id === event.id).timing, '');
  person.excelFinal = ''; interview.status = '확인 필요';
  assert.equal(interviewGroup(data, interview), 'cancelled');
  person.excelStage = ''; person.status = '확인 필요';
  assert.equal(activeInterview(data, interview), true);
  assert.equal(interviewGroup(data, interview), 'review');
});


test('a later unresolved request row cannot erase an explicit terminal stage', async () => {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await sample());
  const sheet = book.getWorksheet('채용프로세스 적시성');
  sheet.getRow(7).getCell(12).value = '전형종료'; sheet.getRow(7).getCell(13).value = '미확정';
  sheet.getRow(9).getCell(12).value = '확인 필요'; sheet.getRow(9).getCell(13).value = '미확정';
  const plan = await parseExcel(await book.xlsx.writeBuffer(), 'terminal.xlsx');
  const person = plan.candidates.find(c => c.name === '테스트갑');
  assert.equal(person.status, '전형종료'); assert.equal(person.excelStage, '전형종료');
});

test('optional interview fields update without duplicates, preserve evaluations and support older workbooks', async () => {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await sample());
  const sheet = book.getWorksheet('채용프로세스 적시성');
  sheet.getCell('AF5').value = '면접장소'; sheet.getCell('AG5').value = '면접관';
  sheet.getCell('AF7').value = '테스트 회의실'; sheet.getCell('AG7').value = '면접관갑, 면접관을\n면접관갑';
  const parse = () => book.xlsx.writeBuffer().then(bytes => parseExcel(bytes, 'fields.xlsx'));
  let plan = await parse();
  const person = plan.candidates.find(c => c.name === '테스트갑');
  const interview = plan.interviews.find(i => i.candidateId === person.id);
  assert.equal(interview.location, '테스트 회의실');
  assert.deepEqual(interview.interviewers, ['면접관갑', '면접관을']);
  const data = seedData(); applyExcelPlan(data, plan);
  const { ratings, recommendations } = load('recruitment');
  data.evaluations.push({id:'saved-evaluation', createdAt:interview.createdAt, updatedAt:interview.updatedAt,
    interviewId:interview.id, evaluator:'면접관갑', jobFit:ratings[0], capability:ratings[0], cultureFit:ratings[0], overall:recommendations[0], comment:'보존할 평가'});
  assert.ok(validateData(data));
  sheet.getCell('AF7').value = '변경 회의실'; sheet.getCell('AG7').value = '면접관병';
  plan = await parse(); applyExcelPlan(data, plan);
  let current = data.interviews.find(i => i.id === interview.id);
  assert.equal(data.interviews.filter(i => i.id === interview.id).length, 1);
  assert.equal(current.location, '변경 회의실'); assert.deepEqual(current.interviewers, ['면접관병']);
  assert.deepEqual(current.pastInterviewers, ['면접관갑']); assert.ok(validateData(data));
  applyExcelPlan(data, await parseExcel(await sample(), 'older.xlsx'));
  current = data.interviews.find(i => i.id === interview.id);
  assert.equal(current.location, '변경 회의실'); assert.deepEqual(current.interviewers, ['면접관병']);
  sheet.getCell('AF7').value = null; sheet.getCell('AG7').value = null;
  applyExcelPlan(data, await parse()); current = data.interviews.find(i => i.id === interview.id);
  assert.equal(current.location, '장소 미입력'); assert.deepEqual(current.interviewers, ['면접관 미지정']);
  assert.equal(data.evaluations.find(e => e.id === 'saved-evaluation').comment, '보존할 평가'); assert.ok(validateData(data));
  current.pastInterviewers = '잘못된 형식'; assert.equal(validateData(data), false);
  sheet.getCell('AH5').value = '면접관'; await assert.rejects(parse, /중복/);
});


test('Korean weekday dates match interview messages and Korean midnight boundaries', () => {
  const { formatDate, formatDateOnly } = load('recruitment');
  const { interviewMessage } = load('messages');
  const instant = '2026-10-22T05:00:00.000Z';
  assert.equal(formatDate(instant), '2026년 10월 22일(목) 오후 2:00');
  assert.equal(formatDateOnly('2026-10-22'), '2026년 10월 22일(목)');
  assert.equal(formatDateOnly('2026-10-21T15:00:00.000Z'), '2026년 10월 22일(목)');
  assert.equal(formatDateOnly('2026-10-21T14:59:00.000Z'), '2026년 10월 21일(수)');
  const data = seedData(), interview = { ...data.interviews[0], startsAt: instant };
  for (const audience of ['candidate', 'internal']) {
    assert.ok(interviewMessage(data, interview, audience).includes('일시: 2026년 10월 22일(목) 오후 2:00'));
  }
  assert.equal(formatDate(''), '미정');
});
test('actual join date, notes and interview fields remain aligned when the expected-date column is deleted', async () => {
  const book=new ExcelJS.Workbook();await book.xlsx.load(await sample());
  const sheet=book.getWorksheet('채용프로세스 적시성');
  sheet.getCell('N7').value=new Date('2026-10-19T00:00:00Z');
  sheet.getCell('O7').value=new Date('2026-10-20T00:00:00Z');
  sheet.getCell('P7').value='열 이동 검증 메모';
  sheet.getCell('AF5').value='면접장소';sheet.getCell('AF7').value='열 이동 검증 회의실';
  sheet.getCell('AG5').value='면접관';sheet.getCell('AG7').value='검증면접관';
  const parse=async()=>{const bytes=await book.xlsx.writeBuffer();return parseExcel(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'synthetic.xlsx');};
  const legacy=await parse();sheet.spliceColumns(14,1);const current=await parse();
  const person=plan=>plan.candidates.find(c=>c.name==='테스트갑');
  assert.ok(person(current).actualJoin);assert.equal(person(current).actualJoin,person(legacy).actualJoin);assert.equal(person(current).expectedJoin,'');assert.equal(person(current).status,'실제 입사');
  assert.deepEqual(current.interviews.map(i=>[i.id,i.location,i.interviewers]),legacy.interviews.map(i=>[i.id,i.location,i.interviewers]));
  assert.deepEqual(current.requests.map(q=>q.excelValues['비고']),legacy.requests.map(q=>q.excelValues['비고']));
  sheet.spliceColumns(14,1);await assert.rejects(parse,/열 제목/);
});
