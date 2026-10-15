'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, RefreshCw } from 'lucide-react';
import { useExcelSync } from './ExcelSync';
import { updateApi, waitForAppRestart } from './AppUpdate';
export function SidebarUpdateActions() {
  const sync = useExcelSync();
  const [target, setTarget] = useState<HTMLElement | null>(null), [busy, setBusy] = useState<'app' | 'excel' | ''>(''), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const locked = useRef(false);
  useEffect(() => setTarget(document.getElementById('sidebar-update-actions')), []);
  async function run(kind: 'app' | 'excel') {
    if (locked.current) return;
    locked.current = true; setBusy(kind); setError(false); setMessage(kind === 'app' ? '새 버전 확인 중…' : '엑셀 파일 확인 중…');
    try {
      if (kind === 'excel') {
        const result = await sync.refresh(); setError(!result.ok); setMessage(result.message);
      } else {
        const latest = await updateApi('/check', {});
        if (!latest.availableVersion) { setMessage('현재 최신 버전입니다.'); return; }
        setMessage('새 버전 다운로드·검증 중…');
        await updateApi('/apply', { version: latest.availableVersion });
        setMessage('업데이트 적용·재시작 중…');
        await waitForAppRestart(latest.availableVersion);
      }
    } catch (e) { setError(true); setMessage(e instanceof Error ? e.message : '업데이트에 실패했습니다.'); }
    finally { locked.current = false; setBusy(''); }
  }
  if (!target) return null;
  return createPortal(<div className="space-y-2" aria-label="빠른 업데이트">
    <button className="btn-secondary w-full gap-2 border-teal-200 text-teal-900" disabled={!!busy} onClick={() => void run('app')}>{busy === 'app' ? <RefreshCw size={15} className="animate-spin"/> : <Download size={15}/>} {busy === 'app' ? '앱 업데이트 중…' : '앱 업데이트'}</button>
    <button className="btn-secondary w-full gap-2 border-teal-200 text-teal-900" disabled={!!busy || sync.working || sync.status.available === null} onClick={() => void run('excel')}><RefreshCw size={15} className={busy === 'excel' ? 'animate-spin' : ''}/>{busy === 'excel' ? '엑셀 반영 중…' : '엑셀 업데이트'}</button>
    {message && <p role={error ? 'alert' : 'status'} className={'break-words text-xs leading-5 ' + (error ? 'text-red-700' : 'text-teal-800')}>{message}</p>}
    <p className="text-[10px] leading-4 text-slate-500">앱 업데이트 시 완료 후 화면이 다시 열립니다.</p>
  </div>, target);
}
