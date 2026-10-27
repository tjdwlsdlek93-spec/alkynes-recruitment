'use client';
import { useState, type ChangeEvent } from 'react';
import { useRecruitment } from '@/components/RecruitmentProvider';
import { Modal, Empty } from '@/components/Forms';
import {
  download,
  formatDate,
  validateData,
  type RecruitmentData,
} from '@/lib/recruitment';
import { AutomaticBackups } from '@/components/AutomaticBackups';
import { MobileAccess } from '@/components/MobileAccess';
import { AppUpdate } from '@/components/AppUpdate';
export default function Page() {
  const { data, replace, storage, databasePath, saving, readOnly } = useRecruitment();
  const [backup, setBackup] = useState<RecruitmentData | null>(null),
    [error, setError] = useState('');
  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    try {
      if (file.size > 120 * 1024 * 1024)
        throw Error('백업은 120MB 이하 JSON 파일을 선택해 주세요.');
      const parsed: unknown = JSON.parse(await file.text());
      if (!validateData(parsed))
        throw Error('백업 형식이나 연결된 데이터가 올바르지 않습니다.');
      setBackup(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : '백업을 읽지 못했습니다.');
    }
  }
  if (readOnly) return <p>설정은 노트북에서 관리해 주세요.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">설정</h1>
        <p className="mt-1 text-sm text-slate-500">
          노트북 저장소, 데이터 백업과 변경 이력을 관리합니다.
        </p>
      </div>
      <AppUpdate />
      <MobileAccess />
      <div className="card space-y-3 p-6"><h2>데이터 저장소</h2><p className="font-bold">{storage === 'sqlite' ? '노트북 SQLite 저장' : '브라우저 저장 (미리보기 / 이전 서버)'}</p>{databasePath && <p className="break-all text-sm text-slate-600">{databasePath}</p>}<p className="text-sm text-slate-600">{storage === 'sqlite' ? '채용 기록은 이 노트북의 DB 파일에 저장됩니다. 브라우저 기록을 지워도 DB는 유지되며, 외부 서버로 전송하지 않습니다. 이전 시점의 브라우저 원본과 최근 5회 저장 이력도 DB에 보관합니다.' : '현재 서버에는 SQLite 저장 기능이 없습니다. 노트북 앱을 업데이트하면 기존 브라우저 데이터를 DB로 이전합니다.'}</p></div>
      <AutomaticBackups onRestore={setBackup} />
      <div className="card space-y-4 p-6">
        <h2 className="font-bold">데이터 백업</h2>
        <p className="text-sm text-slate-600">
          백업 파일에는 연락처와 이력서도 포함됩니다. 노트북 고장이나 DB 파일
          삭제에 대비해 별도 위치에 정기적으로 백업해 주세요.
        </p>
        <button
          className="btn-primary"
          onClick={async () => {
            try {
              let exported = data;
              if (storage === 'sqlite') {
                const response = await fetch('/__alkynes/data/export', { headers: { 'X-Alkynes-Client': '1' }, cache: 'no-store' });
                if (!response.ok) throw Error('전체 백업을 읽지 못했습니다.');
                exported = (await response.json()).data;
                if (!validateData(exported)) throw Error('백업 데이터 검증 실패');
              }
              download('alkynes-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(exported, null, 2));
            } catch (e) { setError(e instanceof Error ? e.message : '백업 실패'); }
          }}
        >
          백업 다운로드
        </button>
        <label className="block text-sm font-medium">
          백업 복원 (JSON)
          <input
            className="field mt-2 max-w-md"
            type="file"
            accept=".json,application/json"
            onChange={read}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
      <div className="card p-6">
        <h2 className="mb-4 font-bold">변경 이력 (로컬 기록)</h2>
        <div className="max-h-96 space-y-3 overflow-y-auto">
          {data.activity.map((a) => (
            <div key={a.id} className="rounded-xl border p-3 text-sm">
              <div>{a.message}</div>
              <div className="mt-1 text-xs text-slate-500">
                {formatDate(a.at)} · {a.actor}
              </div>
            </div>
          ))}
          {!data.activity.length && <Empty>아직 변경 이력이 없습니다.</Empty>}
        </div>
      </div>
      {backup && (
        <Modal title="백업 복원 확인" onClose={() => setBackup(null)}>
          <p>
            현재 데이터를 백업 내용으로 교체합니다. 노트북 앱에서는 복원 직전 데이터를 별도 파일로 자동 백업합니다.
          </p>
          <p className="mt-3 text-sm text-amber-800">엑셀 자동 연결이 켜져 있으면 다음 동기화에서 원본 항목이 다시 갱신됩니다. 복원 상태를 확인하려면 엑셀 자동 연결을 잠시 중지하세요.</p>
          <p className="mt-3 text-sm text-slate-600">
            채용요청 {backup.requisitions.length}건 · 지원자{' '}
            {backup.candidates.length}명 · 면접 {backup.interviews.length}건 ·
            평가 {backup.evaluations.length}건
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setBackup(null)}>
              취소
            </button>
            <button
              className="btn-primary"
              disabled={saving}
              onClick={async () => {
                const next = structuredClone(backup);
                next.activity.unshift({
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  actor: '경영지원팀 (로컬)',
                  message: '백업 데이터를 복원했습니다.',
                });
                if (await replace(next)) setBackup(null);
              }}
            >
              복원 확인
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
