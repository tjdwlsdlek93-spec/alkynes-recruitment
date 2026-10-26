'use client';
import { useEffect, useState } from 'react';
export const screenVersion = process.env.NEXT_PUBLIC_ALKYNES_APP_VERSION || '';
export function reloadCurrentPage() {
  const url = new URL(window.location.href);
  url.searchParams.set('_refresh', Date.now() + '-' + Math.random().toString(36).slice(2));
  window.location.replace(url.href);
}
export function useAppVersion() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    let active = true, checking = false;
    async function check() {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await fetch('/__alkynes/health', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) return;
        const value = await response.json();
        if (active && typeof value.version === 'string') setVersion(value.version);
      } catch {} finally { checking = false; }
    }
    void check();
    const timer = setInterval(() => void check(), 30000);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); window.removeEventListener('pageshow', check); document.removeEventListener('visibilitychange', check); };
  }, []);
  return { version, outdated: !!version && !!screenVersion && version !== screenVersion };
}
