"use client";
import { useEffect, useState } from "react";
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
          if (active && result.background) setStatus(result);
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
          <details open={status.issues.length > 0}>
            <summary>입력 점검 {status.issues.length}건</summary>
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
