'use client';
import { useEffect, useState } from 'react';
import { useRecruitment } from './RecruitmentProvider';
import { formatDate, validateData, type RecruitmentData } from '@/lib/recruitment';
type BackupStatus = { directory: string; error?: string; files: { name: string; at: string; size: number }[] };
async function api(suffix = '', body?: object) {
  const response = await fetch('/__alkynes/data/backups' + suffix, {
    method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: { 'X-Alkynes-Client': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let message = '백업 작업을 완료하지 못했습니다.';
    try { message = (await response.json()).error || message; } catch {}
    throw Error(message);
  }
  return response.json();
}
export function AutomaticBackups({ onRestore }: { onRestore: (data: RecruitmentData) => void }) {
  const { storage, saving } = useRecruitment();
  const [status, setStatus] = useState<BackupStatus | null>(null), [directory, setDirectory] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    if (storage === 'sqlite') api().then(value => { if (active) { setStatus(value); setDirectory(value.directory); setError(value.error || ''); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [storage]);
  async function run(action: 'create' | 'configure' | 'restore', name = '') {
    setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'restore') {
        const value = await api('/file?name=' + encodeURIComponent(name));
        if (!validateData(value.data)) throw Error('백업 형식이 올바르지 않습니다.');
        onRestore(value.data);
      } else {
        const value = await api('', { action, ...(action === 'configure' ? { directory: directory.trim().replace(/^"(.*)"$/, '$1') } : {}) });
        if (value.error) throw Error(value.error);
        const refreshed = await api(); setStatus(refreshed); setDirectory(refreshed.directory); setError(refreshed.error || '');
        setMessage(action === 'create' ? '별도 백업 파일을 저장했습니다.' : '백업 폴더를 변경하고 현재 데이터를 백업했습니다.');
      }
    } catch (e) { setError(e instanceof Error ? e.message : '백업 작업에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  return <section className="card space-y-4 p-6" aria-label="자동 백업"><h2>자동 백업</h2>
    {storage !== 'sqlite' ? <p className="text-sm text-slate-500">노트북 앱을 업데이트하면 날짜별 자동 백업을 사용할 수 있습니다.</p> : <>
      <p className="text-sm text-slate-600">저장 후 하루 첫 백업 30개, 시간별 백업 168개, 변경 시점별 백업 200개를 보관합니다. 같은 날 이전 백업을 덮어쓰지 않습니다. 수동 20개, 대량 변경 전 30개, 복원 직전 10개도 별도로 보관합니다. 변경이 없는 시간에는 새 백업을 만들지 않습니다.</p>
      <label className="block text-sm font-medium">백업 폴더 전체 경로<input className="field mt-2" value={directory} onChange={e => setDirectory(e.target.value)} disabled={busy}/></label>
      <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy || !directory.trim()} onClick={() => void run('configure')}>백업 폴더 저장</button><button className="btn-primary" disabled={busy || saving} onClick={() => void run('create')}>{busy ? '처리 중…' : '지금 백업'}</button></div>
      <p className="text-xs text-slate-500">기본 폴더는 문서의 AlkynesRecruitmentBackups입니다. 노트북 고장에도 대비하려면 외장 드라이브 등 별도 저장 위치를 지정하세요. 백업에도 지원자 개인정보가 포함됩니다.</p>
      {message && <p role="status" className="text-sm text-teal-700">{message}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <details><summary className="cursor-pointer text-sm font-semibold">저장된 백업 {status?.files.length || 0}개</summary><div className="mt-3 max-h-72 space-y-2 overflow-y-auto">{status?.files.map(file => <div key={file.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"><div><p className="text-sm">{formatDate(file.at)}</p><p className="text-xs text-slate-500">{file.name.includes('daily-') ? '하루 첫 백업' : file.name.includes('hourly-') ? '시간별 백업' : file.name.includes('checkpoint-') ? '변경 시점 백업' : file.name.includes('before-change-') ? '대량 변경 전 백업' : file.name.includes('before-restore-') ? '복원 직전 백업' : '수동 백업'} · {Math.ceil(file.size / 1024)}KB</p></div><button className="btn-secondary" disabled={busy || saving} onClick={() => void run('restore', file.name)}>복원 내용 미리보기</button></div>)}</div></details>
    </>}
  </section>;
}
