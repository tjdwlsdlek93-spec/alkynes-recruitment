import type { RecruitmentData } from './recruitment';
export function redactPerson(value: RecruitmentData, candidateId: string, at: string, secrets: string[] = []) {
  const data=structuredClone(value), c=data.candidates.find(c=>c.id===candidateId);
  if(c) secrets.push(c.name,c.phone,c.email,c.resumeName);
  // Scrub historical text as well as the current candidate card. Keep IDs/dates intact.
  const words=[...new Set(secrets.filter(s=>s && s!=='개인정보 삭제' && s.length>=2))].sort((a,b)=>b.length-a.length);
  function scrub(v: unknown, key=''): unknown {
    if(typeof v==='string') return /^(id|.*Id|at|.*At|createdAt|updatedAt|resumeData)$/.test(key)?v:words.reduce((s,w)=>s.split(w).join('[삭제]'),v);
    if(Array.isArray(v))return v.map(x=>scrub(x));
    if(v && typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,scrub(x,k)]));
    return v;
  }
  const result=scrub(data) as RecruitmentData;
  const person=result.candidates.find(c=>c.id===candidateId);
  if(person)Object.assign(person,{name:'개인정보 삭제',phone:'',email:'',career:'',notes:'',appNotes:'',resumeName:'',resumeData:'',resumeId:undefined,privacyErasedAt:at});
  const interviews=new Set(result.interviews.filter(i=>i.candidateId===candidateId).map(i=>i.id));
  for(const q of result.requests || [])if(q.candidateId===candidateId){q.notes='';q.appNotes='';if(q.excelValues)for(const key of Object.keys(q.excelValues))if(/지원자|비고|메모|연락|이메일/.test(key))q.excelValues[key]='';}
  for(const i of result.interviews)if(interviews.has(i.id))i.appNotes='';
  for(const e of result.evaluations)if(interviews.has(e.interviewId))e.comment='';
  result.messageDrafts=result.messageDrafts?.filter(d=>d.candidateId!==candidateId);
  result.sharedNotices=result.sharedNotices?.filter(n=>n.candidateId!==candidateId);
  for(const r of result.auditTrail || [])if(r.candidateId===candidateId)r.fields=[];
  for(const run of result.excelRuns || [])for(const change of run.changes)if(change.candidateId===candidateId)change.detail='개인정보 삭제';
  return result;
}
export function preservePrivacy(before: RecruitmentData, after: RecruitmentData) {
  let data=after;
  for(const c of before.candidates.filter(c=>c.privacyErasedAt))data=redactPerson(data,c.id,c.privacyErasedAt!);
  return data;
}
