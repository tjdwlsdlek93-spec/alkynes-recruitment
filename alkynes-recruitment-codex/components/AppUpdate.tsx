'use client';
import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Modal } from './Forms';
import { useRecruitment } from './RecruitmentProvider';
import { download } from '@/lib/recruitment';
type Info = { currentVersion: string; repository: string; availableVersion: string; notes?: string; result?: { ok: boolean; error?: string; version?: string } };
export async function updateApi(route = '', body?: unknown): Promise<Info> {
  const res = await fetch('/__alkynes/update' + route, { method: body ? 'POST' : 'GET', headers: { 'X-Alkynes-Client': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: AbortSignal.timeout(120000) });
  let json;
  try { json = await res.json(); } catch { throw Error('업데이트 기능이 포함된 최신 PC 패키지를 먼저 설치해 주세요.'); }
  if (!res.ok) throw Error(json.error || '업데이트 요청에 실패했습니다.');
  return json;
}
export function AppUpdate() {
  const { data } = useRecruitment();
  const [info, setInfo] = useState<Info | null>(null), [repository, setRepository] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [confirm, setConfirm] = useState(false);
  useEffect(() => { void updateApi().then(value => { setInfo(value); setRepository(value.repository || ''); if (value.result?.ok === false) setError(value.result.error || '이전 업데이트에 실패했습니다.'); }).catch(e => setError(e.message)); }, []);
  async function check() {
    setBusy(true); setError(''); setMessage('새 버전 확인 중…');
    try {
      if (repository.trim() !== info?.repository) await updateApi('/config', { repository: repository.trim() });
      const value = await updateApi('/check', {}); setInfo(value);
      setMessage(value.availableVersion ? '새 버전 ' + value.availableVersion + '을 설치할 수 있습니다.' : '현재 최신 버전입니다.');
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : '업데이트를 확인하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setConfirm(false); setError(''); setMessage('다운로드 및 파일 검증 중… 창을 닫지 마세요.');
    try {
      await updateApi('/apply', { version: info?.availableVersion });
      setMessage('새 버전 적용 및 서버 재시작 중…');
      await waitForAppRestart(info?.availableVersion || '');
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : '업데이트 적용에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  return <section id="app-update" className="card space-y-4 p-6" aria-label="앱 업데이트">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">앱 업데이트</h2><p className="mt-1 text-sm text-slate-500">현재 버전 {info?.currentVersion || '확인 중'}</p></div><RefreshCw className={busy ? 'animate-spin text-teal-700' : 'text-teal-700'} size={22}/></div>
    <p className="text-sm leading-6 text-slate-600">GitHub 릴리스에서 새 버전을 받아 검증한 뒤 앱을 다시 시작합니다. 노트북 DB와 엑셀 연결 설정은 유지됩니다.</p>
    <label className="block text-sm font-medium">GitHub 릴리스 저장소<input className="field mt-2 max-w-lg" placeholder="소유자/저장소" value={repository} disabled={busy} onChange={e => setRepository(e.target.value)} /></label>
    <p className="text-xs leading-6 text-slate-500">공개 저장소의 최신 정식 릴리스에 앱 배포 파일이 있어야 합니다. 저장소 주소가 바뀌면 이곳에서 수정할 수 있습니다.</p>
    <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy || !repository.trim() || !info} onClick={() => void check()}><RefreshCw size={15} className="mr-2"/>업데이트 확인</button>{info?.availableVersion && <button className="btn-primary" disabled={busy} onClick={() => setConfirm(true)}><Download size={16} className="mr-2"/>새 버전 업데이트</button>}</div>
    {message && <p role="status" className="text-sm text-teal-700">{message}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {confirm && <Modal title="앱 업데이트 확인" onClose={() => setConfirm(false)}><p className="text-sm leading-7">버전 {info?.availableVersion}으로 업데이트합니다. 저장하지 않은 입력을 마친 뒤 진행해 주세요. 적용 중 잠시 연결이 끊기며 완료되면 화면을 새로고침합니다.</p>{info?.notes && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm">{info.notes}</p>}<div className="mt-5 flex flex-wrap justify-end gap-2"><button className="btn-secondary" onClick={() => download('업데이트전백업.json', JSON.stringify(data, null, 2))}>데이터 백업</button><button className="btn-secondary" onClick={() => setConfirm(false)}>취소</button><button className="btn-primary" onClick={() => void apply()}>업데이트 적용</button></div></Modal>}
  </section>;
}

export async function waitForAppRestart(version: string) {
  for (let count = 0; count < 90; count++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const res = await fetch('/__alkynes/health', { cache: 'no-store', signal: AbortSignal.timeout(1500) });
      const value = await res.json();
      if (value.version === version) { window.location.reload(); return; }
      if (count > 25) { const current = await updateApi(); if (current.result?.ok === false) throw Object.assign(Error(current.result.error || '이전 버전으로 복원했습니다.'), { restored: true }); }
    } catch (e) { if (e instanceof Error && 'restored' in e) throw e; }
  }
  throw Error('재시작 확인 시간이 초과됐습니다. 앱을 다시 열어 버전을 확인해 주세요.');
}
