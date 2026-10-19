const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function load(name) {
  const filename = path.resolve(__dirname, '../lib/' + name + '.ts'), m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = request => request.startsWith('./') ? load(request.slice(2)) : original(request);
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop:true } }).outputText, filename);
  return m.exports;
}
const { seedData, validateData, calendarFile } = load('recruitment');
const { todayWork, interviewConflicts, noticeSignature, noticeState, markNotice, candidateTimeline } = load('workspace');
const { applyExcelSnapshot } = load('excel');
const now = Date.parse('2026-10-22T01:00:00Z');
function fixture() {
  const data = seedData();
  data.interviews = [{...data.interviews[0], id:'meeting-a', candidateId:data.candidates[0].id, startsAt:'2026-10-22T05:00:00Z', status:'면접예정', location:'검증회의실', interviewers:['면접관갑'], durationMinutes:30}];
  data.candidates[0].status = '면접예정';
  return data;
}
test('manual notice completion is independent for each audience, changes require renewed notice and stale dialogs cannot mark completion', () => {
  const data = fixture(), target = { kind:'interview', id:'meeting-a' };
  const original = noticeSignature(data,target);
  markNotice(data,target,'candidate',original,true);
  assert.equal(noticeState(data,target,'candidate').current,true);
  assert.equal(noticeState(data,target,'internal').current,false);
  assert.ok(validateData(data));
  markNotice(data,target,'internal',original,true);
  data.interviews[0].location = '변경회의실';
  assert.equal(noticeState(data,target,'candidate').current,false);
  assert.throws(()=>markNotice(data,target,'candidate',original,true),/변경/);
  markNotice(data,target,'candidate',noticeSignature(data,target),true);
  assert.equal(noticeState(data,target,'candidate').current,true);
  assert.equal(noticeState(data,target,'internal').current,false);
  assert.equal(data.sharedNotices.length,2);
  markNotice(data,target,'candidate',noticeSignature(data,target),false);
  assert.equal(noticeState(data,target,'candidate').current,false);
  const invalid=structuredClone(data);invalid.sharedNotices[0].at='invalid';assert.equal(validateData(invalid),false);
  data.interviews[0].durationMinutes=0;assert.equal(validateData(data),false);
});
test('conflicts respect half-open time intervals, duration, known resources and ended recruitments', () => {
  const data=fixture(), a=data.interviews[0];
  data.interviews.push({...a,id:'meeting-b',candidateId:data.candidates[1].id,startsAt:'2026-10-22T05:30:00Z'});
  assert.equal(interviewConflicts(data,now).length,0);
  a.durationMinutes=60;
  assert.deepEqual(interviewConflicts(data,now)[0].reasons,['같은 장소','면접관: 면접관갑']);
  data.interviews[1].status='면접완료';assert.equal(interviewConflicts(data,now).length,0);
  data.interviews[1].status='면접예정';data.candidates[1].status='지원포기';assert.equal(interviewConflicts(data,now).length,0);
  data.candidates[1].status='면접예정';
  for(const row of data.interviews){row.location='장소 미입력';row.interviewers=['면접관 미지정'];}
  assert.equal(interviewConflicts(data,now).length,0);
  assert.ok(calendarFile(a,data.candidates[0]).includes('DTEND:20261022T060000Z'));
});
test('today tasks exclude terminal people and closed jobs while retaining overdue work and unannounced upcoming meetings', () => {
  const data=fixture();let tasks=todayWork(data,now);
  assert.ok(tasks.some(i=>i.title==='오늘 면접'));assert.ok(tasks.some(i=>i.title==='면접 안내 확인'));
  for(const audience of ['candidate','internal'])markNotice(data,{kind:'interview',id:'meeting-a'},audience,noticeSignature(data,{kind:'interview',id:'meeting-a'}),true);
  assert.ok(!todayWork(data,now).some(i=>i.title==='면접 안내 확인'));
  data.candidates[0].status='입사포기';assert.equal(todayWork(data,now).length,0);
  data.candidates[0].status='면접예정';data.interviews[0].startsAt='2026-10-21T05:00:00Z';
  assert.ok(todayWork(data,now).some(i=>i.title==='면접 결과 확인'));
  data.requisitions.find(j=>j.id===data.candidates[0].requisitionId).status='채용완료';
  assert.equal(todayWork(data,now).length,0);
});
test('Excel snapshots produce deduplicated change history and keep app-owned fields and notice metadata', () => {
  const data=fixture(), old=data.candidates[0], job=data.requisitions.find(j=>j.id===old.requisitionId);
  job.id='excel-job-test';job.excelKey='test';old.id='excel-person-test';old.requisitionId=job.id;old.excelStage='면접예정';old.appNotes='개인 메모';
  data.interviews[0].candidateId=old.id;data.interviews[0].source='kpi-excel';data.interviews[0].appNotes='면접 메모';
  const interview=structuredClone(data.interviews[0]);
  const plan={jobs:[structuredClone(job)],candidates:[{...old,appNotes:undefined}],requests:[],interviews:[interview],warnings:[],rows:1,businessDays:1,sourceName:'synthetic.xlsx',interviewFields:{location:true,interviewers:true}};
  applyExcelSnapshot(data,plan);const firstRun=data.excelRuns[0].id;
  applyExcelSnapshot(data,plan);assert.equal(data.excelRuns[0].id,firstRun);
  plan.interviews[0].location='변경회의실';plan.candidates[0].status='지원포기';
  applyExcelSnapshot(data,plan);
  assert.equal(data.excelRuns[0].counts['면접 변경'],1);assert.equal(data.excelRuns[0].counts['전형 종료'],1);
  assert.equal(data.candidates.find(c=>c.id===old.id).appNotes,'개인 메모');
  assert.equal(data.interviews.find(i=>i.id===interview.id).durationMinutes,30);
  assert.equal(data.interviews.find(i=>i.id===interview.id).appNotes,'면접 메모');
  assert.ok(candidateTimeline(data,old.id).some(i=>i.title==='엑셀 반영 · 전형 종료'));
  assert.ok(validateData(data));
});

test('daily Excel history retains all updates, exposes note edits and groups by Korean file-save date', () => {
  const { excelChanges, groupExcelRuns } = load('excel-changes');
  const data=fixture(), job=data.requisitions[0], person=data.candidates[1];
  job.id='excel-job-history';person.id='excel-person-history';person.requisitionId=job.id;
  const q={id:'excel-request-history',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),requisitionId:job.id,candidateId:person.id,excelJobId:job.id,stage:'면접 요청',round:1,receivedAt:'2026-10-20T00:00:00Z',dueAt:'',completedAt:'',status:'요청 전',owner:'',notes:'기존 비고',source:'kpi-excel',sourceRow:6,excelValues:{'비고':'기존 비고','현재 선발 단계':'면접예정'}};
  data.requests=[q];
  const changed=structuredClone(data);changed.requests[0].notes='변경 비고';changed.requests[0].excelValues['비고']='변경 비고';
  const run=excelChanges(data,changed,'synthetic.xlsx','2026-10-22T04:00:00Z');
  assert.equal(run.counts['요청 변경'],1);assert.ok(run.changes[0].detail.includes('비고: 기존 비고 → 변경 비고'));
  run.sourceModifiedAt='2026-10-21T15:01:00Z';
  const older={...structuredClone(run),id:'older',at:'2026-10-22T02:00:00Z',sourceModifiedAt:'2026-10-21T14:59:00Z'};
  const groups=groupExcelRuns([run,{...run,id:'same-day',at:'2026-10-22T05:00:00Z'},older]);
  assert.deepEqual(groups.map(g=>[g.date,g.runs.length,g.changes]),[['2026-10-22',2,2],['2026-10-21',1,1]]);
  assert.equal(groups[0].counts['요청 변경'],2);assert.equal(groups[0].runs[0].id,'same-day');
  const plan={jobs:[job],candidates:[person],requests:[changed.requests[0]],interviews:[],warnings:[],rows:1,businessDays:1,sourceName:'synthetic.xlsx',sourceModifiedAt:'2026-10-22T01:00:00Z'};
  data.excelRuns=Array.from({length:35},(_,i)=>({...structuredClone(run),id:'saved-'+i}));
  applyExcelSnapshot(data,plan);assert.equal(data.excelRuns.length,36);assert.equal(data.excelRuns[0].sourceModifiedAt,plan.sourceModifiedAt);
  const latest=data.excelRuns[0].id;applyExcelSnapshot(data,plan);assert.equal(data.excelRuns.length,36);assert.equal(data.excelRuns[0].id,latest);
});
