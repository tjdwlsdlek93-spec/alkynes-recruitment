"use client";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/recruitment";
import { useRecruitment } from "./RecruitmentProvider";
export type SyncStatus = {
  background: boolean;
  phase: string;
  enabled: boolean;
  lastCheck: string;
  lastSuccess: string;
  sourceModifiedAt: string;
  sourceName: string;
  dbRevision: number;
  message: string;
  pending?: {revision:string;removed:number;changed:number;total:number;interviewsRemoved:number;interviewsChanged:number};
  issuesAvailable?: boolean;
  issues: { row: number; field: string; message: string; severity: string }[];
};
export function useSyncHealth() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  useEffect(() => {
    let active = true,
      pending = false;
    async function check() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/__alkynes/sync", {
          headers: { "X-Alkynes-Client": "1" },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          const result = await response.json();
          if (active && result && typeof result === "object" && result.background === true) {
            const issuesAvailable = Array.isArray(result.issues);
            setStatus({ ...result, issuesAvailable, issues: issuesAvailable ? result.issues.filter((issue: unknown) => issue && typeof issue === 'object' && typeof (issue as {message?: unknown}).message === 'string') : [] });
          }
        }
      } catch {
      } finally {
        pending = false;
      }
    }
    void check();
    const timer = setInterval(() => void check(), 5000);
    const focus = () => void check();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);
  return status;
}
export function SyncHealth({ compact = false }: { compact?: boolean }) {
  const status = useSyncHealth(),
    { readOnly } = useRecruitment(),
    [error, setError] = useState("");
  if (!status) return null;
  async function downloadIds() {
    try {
      const response = await fetch("/__alkynes/source/identified", {
        headers: { "X-Alkynes-Client": "1" },
        cache: "no-store",
      });
      if (!response.ok)
        throw Error(
          (await response.json()).error || "사본을 만들지 못했습니다.",
        );
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "채용관리_고유번호포함.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section
      aria-label="엑셀 연동 진단"
      className={compact ? "space-y-1 text-xs" : "card space-y-3 p-5"}
    >
      {!compact && <h2 className="font-bold">입력 점검 · 서버 자동 연동</h2>}
      <p
        className={status.phase === "error" ? "font-semibold text-red-700" : ""}
      >
        {status.enabled ? "서버 자동 연결" : "자동 연결 중지"} ·{" "}
        {status.message}
      </p>
      <p>
        원본 저장:{" "}
        {status.sourceModifiedAt
          ? formatDate(status.sourceModifiedAt)
          : "확인 전"}
      </p>
      <p>
        앱 반영:{" "}
        {status.lastSuccess ? formatDate(status.lastSuccess) : "반영 전"} · 엑셀
        반영 버전 {status.dbRevision}
      </p>
      <p>
        최근 확인: {status.lastCheck ? formatDate(status.lastCheck) : "확인 전"}
      </p>
      {!compact && (
        <>
          <p className="text-sm text-slate-500">
            노트북 서버와 네이버웍스 동기화가 실행 중이면 브라우저를 닫아도
            반영합니다. 파일 저장 중·읽기 오류 시 마지막 정상 데이터를
            유지합니다.
          </p>
          {status.phase==='review' && status.pending && !readOnly && <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="font-bold">대량 변경 적용 보류</p><p className="text-sm">기존 {status.pending.total}명 중 원본 제외 {status.pending.removed}명 · 주요 정보 변경 {status.pending.changed}명 · 면접 제외 {status.pending.interviewsRemoved}건 / 변경 {status.pending.interviewsChanged}건. 엑셀 파일과 내용을 먼저 확인하세요. 승인하면 적용 직전 백업을 남깁니다.</p><button className="btn-secondary" onClick={async()=>{try{const r=await fetch('/__alkynes/sync/approve',{method:'POST',headers:{'X-Alkynes-Client':'1'}});const v=await r.json();if(!r.ok || v.phase==='error')throw Error(v.error || v.message || '승인 실패');setError(v.phase==='review'?'승인 중 원본이 변경되었습니다. 새 변경 내용을 다시 확인하세요.':'승인한 변경을 반영했습니다.');}catch(e){setError((e as Error).message);}}}>변경 내용 확인 · 반영 승인</button></div>}
          <details open={status.issues.length > 0}>
            <summary>입력 점검 {status.issuesAvailable === false ? "확인 불가" : status.issues.length + "건"}</summary>
            {status.issuesAvailable === false && <p className="mt-2 text-sm text-amber-800">서버 응답에 입력 점검 목록이 없습니다. 노트북 앱 업데이트 후 다시 확인하세요. 채용 데이터는 그대로 유지됩니다.</p>}
            <ul className="mt-3 space-y-2 text-sm">
              {status.issues.map((issue, index) => (
                <li key={index}>
                  {issue.row}행 · {issue.field}: {issue.message}
                </li>
              ))}
            </ul>
          </details>
          {!readOnly && (
            <>
              <button
                className="btn-secondary"
                onClick={() => void downloadIds()}
              >
                고유번호 포함 사본 다운로드
              </button>
              <p className="text-xs text-slate-500">
                원본은 변경하지 않습니다. 사본의 숨김 고유번호 열을 유지하면
                이름·날짜·행 순서를 바꿔도 기록을 연결합니다. 사본의 고유번호
                4열만 기존 파일의 빈 열에 복사해 사용할 수도 있습니다. 수식은
                기존 파일에서 유지하세요.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function SyncAlerts() {
  const status=useSyncHealth(),[now,setNow]=useState(Date.now),[permission,setPermission]=useState(''),sent=useRef('');
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(t);},[]);
  const stale=!!status?.enabled && !!status.lastCheck && now-Date.parse(status.lastCheck)>60000;
  const warning=status && (status.phase==='error' || status.phase==='review' || stale);
  const summary=warning?(stale?'엑셀 연동 확인이 1분 이상 지연되었습니다.':status.message):'';
  useEffect(()=>{if(!summary){sent.current='';return;}if(sent.current===summary)return;sent.current=summary;
    if(typeof Notification!=='undefined' && Notification.permission==='granted' && localStorage.getItem('alkynes.syncNotifications')==='1')new Notification('채용관리 · 연동 확인 필요',{body:'앱에서 엑셀 연결 상태를 확인하세요.'});
  },[summary]);
  if(!status)return null;
  return <section aria-label="연동 알림" className={warning?'card space-y-2 border-amber-400 bg-amber-50 p-4':'text-xs text-slate-500'}>{warning && <><h2 className="font-bold">엑셀 연결 확인 필요</h2><p className="text-sm break-keep">{summary}</p><a href="/requests" className="inline-block underline">엑셀 연동에서 확인</a></>}
    <button className="mt-1 text-xs underline" onClick={async()=>{if(typeof Notification==='undefined' || !window.isSecureContext){setPermission('이 접속 환경에서는 브라우저 알림을 지원하지 않습니다. 앱 내 알림으로 확인하세요.');return;}const p=await Notification.requestPermission();localStorage.setItem('alkynes.syncNotifications',p==='granted'?'1':'0');setPermission(p==='granted'?'연동 오류 알림을 켰습니다. 브라우저가 열려 있을 때 표시됩니다.':'알림 권한이 허용되지 않았습니다.');}}>연동 오류 브라우저 알림 켜기</button>{permission && <p role="status" className="text-xs">{permission}</p>}</section>;
}
