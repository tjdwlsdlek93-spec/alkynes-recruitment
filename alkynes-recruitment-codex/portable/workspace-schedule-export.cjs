'use strict';
// Optional local-only export for SEONGJIN MIN WORKSPACE.
// Prerequisite: Google Drive for desktop sync folder; no remote API access, no credentials.
// Run: node portable/workspace-schedule-export.cjs "G:\\My Drive\\SEONGJIN-SYNC"
// Exports ONLY interview ID, title, ISO time, status; no phone, email, resume, notes, evaluation.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

function exportSchedule(dbPath,outputDir){
  if(!path.isAbsolute(outputDir))throw Error('동기화 폴더는 절대 경로여야 합니다.');
  if(!fs.existsSync(outputDir)||!fs.statSync(outputDir).isDirectory())throw Error('동기화 폴더가 존재하지 않습니다: '+outputDir);
  if(!fs.existsSync(dbPath))throw Error('채용관리 DB가 없습니다. 앱을 먼저 실행하세요.');
  const db=new DatabaseSync(dbPath,{readOnly:true});
  let data;
  try{
    const row=db.prepare('SELECT payload FROM workspace WHERE id=1').get();
    if(!row)throw Error('채용관리 데이터가 아직 저장되지 않았습니다.');
    data=JSON.parse(row.payload);
    if(data&&data.storageSchema===2&&Array.isArray(data.fields)){
      // Current Windows app stores individual entities in records; workspace.payload
      // contains only the schema marker. Mirror native-services.ts snapshot() read path.
      const required=['interviews','candidates','requisitions'];
      const missing=required.filter(k=>!data.fields.includes(k));
      if(missing.length)throw Error('채용관리 분리형 저장소에 필수 필드가 없습니다: '+missing.join(', '));
      const hydrated={version:1};
      const stmt=db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY position');
      for(const kind of required)hydrated[kind]=stmt.all(kind).map(x=>JSON.parse(String(x.payload)));
      if(data.fields.includes('requests'))hydrated.requests=stmt.all('requests').map(x=>JSON.parse(String(x.payload)));
      data=hydrated;
    }
  } finally {db.close();}
  if(!data||typeof data!=='object'||!Array.isArray(data.interviews)||!Array.isArray(data.candidates)||!Array.isArray(data.requisitions)){
    // Diagnostics contain field names and container types only. Never print stored applicant values.
    const shape=x=>x===null?'null':Array.isArray(x)?'배열':typeof x;
    const keys=data&&typeof data==='object'?Object.keys(data).slice(0,25).join(', '):'(객체 아님)';
    throw Error('채용관리 데이터 형식 오류. 최상위 필드명: ['+keys+']; 필수 배열 상태: interviews='+shape(data?.interviews)+', candidates='+shape(data?.candidates)+', requisitions='+shape(data?.requisitions)+'. 개인정보 값은 표시하지 않습니다.');
  }
  const people=new Map(data.candidates.map(x=>[x.id,x]));
  const jobs=new Map(data.requisitions.map(x=>[x.id,x]));
  // Match lib/candidate-state.ts endedCandidate(), including Excel fields.
  // A stale interview may still say 면접예정 after Excel marks the person 전형종료/지원포기.
  const compact=v=>String(v||'').replace(/\s+/g,'');
  const ended=new Set(['서류불합격','불합격','지원포기','입사포기','실제입사','입사완료','전형종료','최종불합격']);
  const isEnded=c=>!!c&&(ended.has(compact(c.status))||ended.has(compact(c.excelFinal))||
    compact(c.excelStage)==='전형종료'||!!c.actualJoin);
  const closed=new Set(['채용완료','채용취소','자체종결','채용보류']);
  const items=data.interviews.filter(i=>i&&i.id&&i.startsAt&&i.status!=='취소').map(i=>{
    const c=people.get(i.candidateId);
    const job=c?jobs.get(c.requisitionId):null;
    if(!c||!job||c.privacyErasedAt||c.excelMissing||job.excelMissing||closed.has(job.status)||isEnded(c))return null;
    const when=new Date(i.startsAt);
    if(!Number.isFinite(when.getTime()))return null;
    const part=[String(job.department||job.role||'채용').trim(),String(c.name||'지원자').trim()+' 면접'];
    return {id:String(i.id).slice(0,150),title:part.join(' · ').slice(0,250),startsAt:when.toISOString(),status:['면접예정','면접완료','확인 필요'].includes(i.status)?i.status:'확인 필요'};
  }).filter(Boolean);
  // The recruitment app's IN PROGRESS panel shows applicant-level scheduled
  // processes, not all job vacancies. Include interviews and aptitude exams.
  // Honour candidate's terminal Excel status even if old process records remain.
  const requests=Array.isArray(data.requests)?data.requests:[];
  const inProgressCandidates=data.candidates.filter(c=>{
    const job=jobs.get(c.requisitionId);
    return c&&c.id&&!c.excelMissing&&!c.privacyErasedAt&&job&&!job.excelMissing&&!closed.has(job.status)&&!isEnded(c);
  }).map(c=>{
    const job=jobs.get(c.requisitionId);
    const interview=data.interviews.filter(i=>i&&i.candidateId===c.id&&i.status==='면접예정'&&i.startsAt&&Number.isFinite(Date.parse(i.startsAt)))
      .sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt))[0];
    // The recruitment app calendar also reads candidate.examDates when no
    // matching dated aptitude request is present (lib/scheduling.ts).
    const aptitudeRequests=requests.filter(q=>q&&q.candidateId===c.id&&q.stage==='인적성 검사 요청'&&
      q.status!=='취소'&&q.examStatus!=='실시완료');
    const aptitude=aptitudeRequests.filter(q=>q.examAt&&Number.isFinite(Date.parse(q.examAt)))
      .sort((a,b)=>Date.parse(b.examAt)-Date.parse(a.examAt))[0];
    const fallbackDates=Array.isArray(c.examDates)?c.examDates.filter(d=>Number.isFinite(Date.parse(d))):[];
    const fallbackAt=fallbackDates.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||'';
    const examAt=aptitude?.examAt||fallbackAt;
    // A requested aptitude exam is IN PROGRESS even before its date is set.
    // Example: status='요청 완료', examStatus='미실시', examAt=''.
    // Never invent an exam date; leave interviewAt empty for an undated exam.
    const pendingAptitude=aptitudeRequests.length>0;
    const process=interview?{status:'면접예정',at:interview.startsAt,href:'/interviews?candidate='}:
      (pendingAptitude||examAt)?{status:'인적성 검사예정',at:examAt||'',href:'/aptitudes'}:null;
    if(!process)return null;
    return {
      id:String(c.id).slice(0,150),
      name:String(c.name||'지원자').slice(0,100),
      department:String(job.department||'').slice(0,100),
      role:String(job.role||'').slice(0,150),
      requisitionId:String(job.id).slice(0,150),
      status:process.status,
      interviewAt:process.at?new Date(process.at).toISOString():'',
      processPath:process.href
    };
  }).filter(Boolean).sort((a,b)=>{
    if(!a.interviewAt)return b.interviewAt?1:a.name.localeCompare(b.name,'ko');
    if(!b.interviewAt)return -1;
    return b.interviewAt.localeCompare(a.interviewAt);
  });
  const payload={version:1,generatedAt:new Date().toISOString(),interviews:items,inProgressCandidates};
  const target=path.join(outputDir,'seongjin-recruitment-schedule.json');
  // Google Drive for desktop observes updates to the same path.
  fs.writeFileSync(target,JSON.stringify(payload,null,2),'utf8');
  return {file:target,count:items.length,at:payload.generatedAt};
}
if(require.main===module){
  const outputDir=process.argv[2];
  if(!outputDir){console.error('사용법: node portable/workspace-schedule-export.cjs "Google Drive 동기화 폴더 경로"');process.exit(2);}
  const dataDir=process.env.ALKYNES_DATA_DIR||(process.platform==='win32'&&process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'AlkynesRecruitment','config'):path.join(__dirname,'config'));
  const db=path.join(dataDir,'recruitment.sqlite');
  const tick=()=>{try{const v=exportSchedule(db,outputDir);console.log('면접 일정 동기화 준비:',v.count,'건',v.at)}catch(e){console.error('일정 동기화 실패:',e.message)}};
  tick();
  setInterval(tick,30000);
}
module.exports={exportSchedule};
