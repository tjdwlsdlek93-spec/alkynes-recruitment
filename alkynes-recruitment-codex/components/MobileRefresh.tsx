'use client';
import { useEffect, useState } from 'react';
export function MobileRefresh() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/__alkynes/health', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (active && typeof value?.version === 'string') setVersion(value.version); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return <div className="mt-2 space-y-2">
    {version && <p className="text-xs text-slate-500">노트북 앱 버전 {version}</p>}
    <button type="button" className="btn-secondary" onClick={() => {
      const url = new URL(window.location.href);
      url.searchParams.set('_refresh', Date.now() + '-' + Math.random().toString(36).slice(2));
      window.location.replace(url.href);
    }}>최신 내용 불러오기</button>
  </div>;
}
