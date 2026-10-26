'use client';
import { useState } from 'react';
import { screenVersion, useAppVersion } from '@/lib/app-version';
import { copyText } from '@/lib/clipboard';
import { useRecruitment } from './RecruitmentProvider';
export function AppDiagnostics() {
  const { version, outdated } = useAppVersion();
  const { readOnly, storage, data } = useRecruitment();
  const [message, setMessage] = useState('');
  return <footer aria-label="앱 버전 및 진단" className="mt-8 space-y-2 border-t border-stone-300 pt-4 text-xs text-slate-500">
    <p>현재 화면 버전 {screenVersion || '확인 불가'}</p>
    <p>노트북 앱 버전 {version || '연결 확인 중'}</p>
    {version && <p className={outdated ? 'font-semibold text-amber-800' : ''}>{outdated ? '화면 갱신 필요' : '화면·서버 버전 일치'}</p>}
    <button type="button" className="btn-secondary" onClick={async () => {
      const details = ['알킨스 채용관리 진단', '현재 화면 버전: ' + (screenVersion || '확인 불가'), '노트북 앱 버전: ' + (version || '확인 불가'), '접속 방식: ' + (readOnly ? '모바일 읽기 전용' : '노트북'), '저장소: ' + storage, '최근 엑셀 반영: ' + (data.excelRuns?.[0]?.at || '기록 없음'), '접속 주소: ' + location.origin + location.pathname, '확인 시각: ' + new Date().toISOString()].join('\n');
      try { await copyText(details); setMessage('복사했습니다. 채팅에 붙여넣어 주세요.'); }
      catch { setMessage(details); }
    }}>진단정보 복사</button>
    {message && <p role="status" className="whitespace-pre-wrap break-all">{message}</p>}
  </footer>;
}
