export type Requisition = {
  id:string; code:string; department:string; role:string; headcount:number; owner:string;
  status:string; nextAction:string; targetJoin:string;
};

export const requisitions: Requisition[] = [
  {id:'1',code:'HR-2026-001',department:'생산팀',role:'생산직',headcount:2,owner:'경영지원팀',status:'면접예정',nextAction:'10/20 면접',targetJoin:'11/2'},
  {id:'2',code:'HR-2026-002',department:'품질관리팀',role:'품질관리',headcount:1,owner:'경영지원팀',status:'서류검토',nextAction:'서류 선별',targetJoin:'11월'},
  {id:'3',code:'HR-2026-003',department:'기술연구소',role:'연구원',headcount:1,owner:'경영지원팀',status:'공고중',nextAction:'지원자 모집',targetJoin:'협의'}
];

export const candidates = [
  {id:'c1',name:'홍길동',req:'HR-2026-002',source:'사람인',career:'4년',document:'합격',interview:'10/20 14:00',result:'진행중'},
  {id:'c2',name:'김지원',req:'HR-2026-001',source:'잡코리아',career:'2년',document:'합격',interview:'일정조율',result:'진행중'},
  {id:'c3',name:'이연구',req:'HR-2026-003',source:'추천',career:'5년',document:'검토중',interview:'-',result:'진행중'}
];
