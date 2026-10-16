'use client';
import { useState, type CSSProperties } from 'react';
import { Archive, BadgeCheck, Building2, CalendarClock, CalendarDays, CircleAlert, CircleX, ClipboardCheck, ClipboardList, FileCheck2, FileX2, Handshake, PartyPopper, UserMinus, UserX } from 'lucide-react';
import type { Candidate } from '@/lib/recruitment';
const styles = {
  '검토중': { tone: 'review', Icon: ClipboardList },
  '서류합격': { tone: 'passed', Icon: FileCheck2 },
  '서류불합격': { tone: 'rejected', Icon: FileX2 },
  '일정조율': { tone: 'coordination', Icon: CalendarClock },
  '면접예정': { tone: 'scheduled', Icon: CalendarDays },
  '면접완료': { tone: 'completed', Icon: ClipboardCheck },
  '처우협의': { tone: 'completed', Icon: Handshake },
  '최종합격': { tone: 'celebration', Icon: PartyPopper },
  '불합격': { tone: 'rejected', Icon: CircleX },
  '입사확정': { tone: 'confirmed', Icon: BadgeCheck },
  '입사포기': { tone: 'withdrawn', Icon: UserX },
  '지원포기': { tone: 'withdrawn', Icon: UserMinus },
  '전형종료': { tone: 'ended', Icon: Archive },
  '확인 필요': { tone: 'attention', Icon: CircleAlert },
  '실제 입사': { tone: 'confirmed', Icon: Building2 },
} satisfies Record<Candidate['status'], { tone: string; Icon: typeof PartyPopper }>;
const confetti = [
  [-41,-22,-30,'#e88098'], [-24,-33,25,'#62b7ca'], [0,-36,-18,'#e0ac36'], [27,-30,35,'#af8fd3'], [42,-14,-25,'#72b793'], [-36,15,38,'#af8fd3'], [34,18,-40,'#e88098'],
] as const;
export function CandidateStatusBadge({ status }: { status: Candidate['status'] }) {
  const [burst, setBurst] = useState(0);
  const { tone, Icon } = styles[status], celebrating = status === '최종합격';
  return <span className={'candidate-status candidate-status--' + tone} onMouseEnter={() => { if (celebrating) setBurst(value => value + 1); }} title={celebrating ? '최종합격을 축하합니다!' : undefined}>
    <Icon size={16} strokeWidth={1.9} aria-hidden="true" className={celebrating ? 'candidate-status-popper' : undefined}/><span>{status}</span>
    {celebrating && <span key={burst} className="candidate-confetti" aria-hidden="true">{confetti.map(([x,y,rotation,color], index) => <i key={index} style={{ '--confetti-x': x + 'px', '--confetti-y': y + 'px', '--confetti-turn': rotation + 'deg', backgroundColor: color, animationDelay: (index % 3) * 35 + 'ms' } as CSSProperties}/>)}</span>}
  </span>;
}
