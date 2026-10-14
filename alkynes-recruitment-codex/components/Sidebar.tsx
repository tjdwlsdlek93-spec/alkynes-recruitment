'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, BriefcaseBusiness, Users, ClipboardList, CalendarDays, ClipboardCheck, Settings, Sparkles } from 'lucide-react';
const items = [
  ['대시보드', '/dashboard', LayoutDashboard],
  ['채용 요청', '/requisitions', BriefcaseBusiness],
  ['지원자', '/candidates', Users],
  ['엑셀 연동', '/requests', ClipboardList],
  ['면접 일정', '/interviews', CalendarDays],
  ['면접 평가', '/evaluations', ClipboardCheck],
  ['설정', '/settings', Settings],
] as const;
export function Sidebar() {
  const path = usePathname();
  return <aside className="sidebar p-5 md:w-64 md:min-h-screen md:fixed md:left-0 md:top-0">
    <div className="mb-8 flex items-center gap-3 px-2 pt-3"><div className="rounded-xl bg-teal-700 p-2.5 text-white"><Sparkles size={23}/></div><div><div className="text-[10px] font-bold tracking-[0.2em] text-teal-700">ALKYNES</div><div className="text-xl font-bold">채용관리</div></div></div>
    <div className="mb-3 px-3 text-[10px] font-bold tracking-widest text-slate-400">WORKSPACE</div>
    <nav className="flex flex-wrap gap-1 md:block md:space-y-2">{items.map(([label, href, Icon]) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined} className={'nav-item ' + (path === href ? 'active' : '')}><Icon size={18}/>{label}</Link>)}</nav>
    <div className="hidden md:block absolute bottom-6 left-5 right-5 rounded-2xl bg-teal-50 p-4 text-xs leading-6 text-teal-900"><span className="font-bold">함께 만드는 채용</span><br/>경영지원팀의 채용 워크스페이스<Link href="/settings#app-update" className="mt-3 block rounded-lg border border-teal-200 bg-white px-3 py-2 text-center font-semibold">앱 업데이트</Link></div>
  </aside>;
}
