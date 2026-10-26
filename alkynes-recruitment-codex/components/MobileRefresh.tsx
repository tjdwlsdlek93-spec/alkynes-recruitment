'use client';
import { useEffect } from 'react';
import { reloadCurrentPage, useAppVersion } from '@/lib/app-version';
export function MobileRefresh() {
  const { version, outdated } = useAppVersion();
  useEffect(() => {
    if (!outdated) return;
    const refresh = () => {
      if (document.visibilityState === 'hidden' || document.querySelector('dialog[open]')) return;
      // Retry once per server version, without an automatic reload loop.
      try {
        if (sessionStorage.getItem('alkynes.screenReloadVersion') === version) return;
        sessionStorage.setItem('alkynes.screenReloadVersion', version);
      } catch { return; }
      reloadCurrentPage();
    };
    refresh(); const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [outdated, version]);
  return <div className="mt-2 space-y-2">
    {outdated && <p role="alert" className="text-sm text-amber-800">새 버전이 있습니다. 작성 중인 내용을 확인한 뒤 화면을 새로 불러오세요.</p>}
    <button type="button" className="btn-secondary" onClick={reloadCurrentPage}>최신 내용 불러오기</button>
  </div>;
}
