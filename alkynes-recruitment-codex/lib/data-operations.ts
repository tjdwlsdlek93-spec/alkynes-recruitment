import type { RecruitmentData } from './recruitment';
export const entityKinds = ['requisitions','candidates','interviews','evaluations','activity','requests','sharedNotices','excelRuns','messageDrafts','auditTrail'] as const;
export type EntityPatch = { kind: typeof entityKinds[number]; upsert: {id:string}[]; remove: string[]; order?: string[] };
export function dataPatch(before: RecruitmentData, after: RecruitmentData): EntityPatch[] {
  const patches: EntityPatch[] = [];
  for (const kind of entityKinds) {
    const a = (before[kind] || []) as {id:string}[], b = (after[kind] || []) as {id:string}[];
    const old = new Map(a.map(r=>[r.id,JSON.stringify(r)])), ids = new Set(b.map(r=>r.id));
    const upsert=b.filter(r=>old.get(r.id)!==JSON.stringify(r)), remove=a.filter(r=>!ids.has(r.id)).map(r=>r.id);
    const order=a.map(r=>r.id).join('\0')!==b.map(r=>r.id).join('\0') ? b.map(r=>r.id) : undefined;
    if(upsert.length || remove.length || order) patches.push({kind,upsert,remove,...(order?{order}:{})});
  }
  return patches;
}
export function applyPatch(before: RecruitmentData, patches: EntityPatch[]): RecruitmentData {
  if(!Array.isArray(patches) || patches.length>entityKinds.length || new Set(patches.map(p=>p.kind)).size!==patches.length) throw Error('변경 요청 형식 오류');
  const data=structuredClone(before);
  for(const p of patches) {
    if(!entityKinds.includes(p.kind) || !Array.isArray(p.upsert) || !Array.isArray(p.remove) || p.upsert.some(r=>!r || typeof r.id!=='string') || p.remove.some(id=>typeof id!=='string')) throw Error('변경 항목 형식 오류');
    const rows=new Map(((data[p.kind] || []) as {id:string}[]).map(r=>[r.id,r]));
    for(const id of p.remove) rows.delete(id);
    for(const row of p.upsert) rows.set(row.id,row);
    if(p.order && (!Array.isArray(p.order) || p.order.length!==rows.size || new Set(p.order).size!==rows.size || p.order.some(id=>!rows.has(id)))) throw Error('변경 순서 형식 오류');
    (data as unknown as Record<string,unknown>)[p.kind]=p.order?p.order.map(id=>rows.get(id)):[...rows.values()];
  }
  return data;
}
export function auditChanges(before: RecruitmentData, after: RecruitmentData, actor='앱 / 엑셀') {
  const labels: Record<string,string>={name:'이름',requisitionId:'지원 공고',phone:'연락처',email:'이메일',career:'경력',notes:'메모',appNotes:'업무 메모',status:'상태',excelStage:'선발단계',excelFinal:'최종결과',actualJoin:'실제 입사일',startsAt:'면접일시',location:'면접장소',interviewers:'면접관',resumeId:'이력서',examStatus:'검사 실시 상태',examDeadline:'응시기한',reply:'회신 상태',text:'안내문 초안',code:'채용번호',department:'부서',requester:'의뢰자',role:'공고명',headcount:'채용인원',reason:'채용사유',duties:'담당업무',requirements:'자격요건',preferred:'우대사항',targetJoin:'목표 입사일',excelMissing:'원본 제외 여부',expectedJoin:'입사예정일',source:'지원경로 / 원본',resumeName:'이력서 파일명',examDates:'검사 일정',receivedAt:'요청일',dueAt:'처리기한',completedAt:'처리완료일',examAt:'검사일시',owner:'담당자',stage:'요청 구분',round:'회차',durationMinutes:'면접 소요시간',evaluator:'평가자',jobFit:'직무 적합성',capability:'역량',cultureFit:'조직 적합성',overall:'종합 평가',comment:'평가 의견',kind:'안내 구분',audience:'안내 대상',at:'안내일시',replyAt:'회신 기록일시',date:'출근일',documents:'제출서류',additional:'기타 안내',includeDocuments:'제출서류 포함 여부',privacyErasedAt:'개인정보 삭제일'};
  const result: NonNullable<RecruitmentData['auditTrail']>=[];
  for(const kind of ['requisitions','candidates','interviews','requests','evaluations','sharedNotices','messageDrafts'] as const) {
    const old=new Map(((before[kind] || []) as unknown as Record<string,unknown>[]).map(r=>[r.id,r]));
    const next=(after[kind] || []) as unknown as Record<string,unknown>[];
    for(const r of next) {
      const prior=old.get(r.id); old.delete(r.id);
      const candidateId=kind==='candidates'?String(r.id):String(r.candidateId || (kind==='evaluations'?after.interviews.find(i=>i.id===r.interviewId)?.candidateId:'' ) || '');
      const keys=[...new Set([...Object.keys(prior || {}),...Object.keys(r)])].filter(k=>!['id','createdAt','updatedAt','resumeData','signature','excelValues','explicitId','sourceRow','excelKey','excelJobId','sourceRequestId','pastInterviewers','verification','targetId','candidateId'].includes(k));
      const fields=keys.filter(k=>JSON.stringify(prior?.[k])!==JSON.stringify(r[k])).map(k=>({field:labels[k] || k,before:prior ? JSON.stringify(prior[k] ?? '') : '',after:JSON.stringify(r[k] ?? '')}));
      if(fields.length)result.push({id:crypto.randomUUID(),at:new Date().toISOString(),actor,entity:String(r.id),candidateId,kind,action:prior?'수정':'추가',fields});
    }
    for(const r of old.values())result.push({id:crypto.randomUUID(),at:new Date().toISOString(),actor,entity:String(r.id),candidateId:kind==='candidates'?String(r.id):String(r.candidateId || ''),kind,action:'삭제',fields:[]});
  }
  return result;
}
