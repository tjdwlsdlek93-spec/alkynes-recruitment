'use client';
import { MobileRefresh } from './MobileRefresh';

export function MobileSessionFooter({readOnly}: {readOnly:boolean}) {
  if (!readOnly) return null;
  return <footer aria-label="모바일 접속 관리" className="mobile-session-footer">
    <p role="status" className="font-semibold">노트북 데이터 · 읽기 전용</p>
    <div className="mobile-session-actions">
      <MobileRefresh />
      <form action="/__alkynes/mobile/logout" method="post">
        <button type="submit" className="btn-secondary">접속 종료</button>
      </form>
    </div>
  </footer>;
}
