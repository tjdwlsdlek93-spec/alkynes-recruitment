import type { RecruitmentData } from './recruitment';
import { koreaDate } from './scheduling';
import { excludedSummary } from './excel';
export function hiringMetrics(data: RecruitmentData, month: string) {
  const requests=(data.requests || []).filter(q=>q.status!=='취소' && q.receivedAt && koreaDate(q.receivedAt).startsWith(month) && !excludedSummary(q,data));
  const hours=requests.filter(q=>q.completedAt).map(q=>(Date.parse(q.completedAt)-Date.parse(q.receivedAt))/3600000);
  const interviews=data.interviews.filter(i=>koreaDate(i.startsAt).startsWith(month));
  const cohort=data.candidates.filter(c=>!c.excelMissing && requests.some(q=>q.candidateId===c.id));
  const forfeits=cohort.filter(c=>/지원포기|입사포기/.test(c.excelFinal || c.status));
  const joinDays=data.candidates.filter(c=>!c.excelMissing && c.actualJoin && koreaDate(c.actualJoin)<=koreaDate() && koreaDate(c.actualJoin).startsWith(month)).flatMap(c=>{
    const received=(data.requests || []).filter(q=>q.requisitionId===c.requisitionId && q.receivedAt && q.status!=='취소').map(q=>Date.parse(q.receivedAt));
    if(!received.length)return [];const days=(Date.parse(c.actualJoin!)-Math.min(...received))/86400000;return days>=0?[days]:[];
  });
  return {requests:requests.length,completed:hours.length,meanHours:hours.length?hours.reduce((a,b)=>a+b,0)/hours.length:null,interviews:interviews.length,cancelled:interviews.filter(i=>i.status==='취소').length,cohort:cohort.length,forfeits:forfeits.length,joined:joinDays.length,meanJoinDays:joinDays.length?joinDays.reduce((a,b)=>a+b,0)/joinDays.length:null};
}
