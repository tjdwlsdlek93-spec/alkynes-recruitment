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
import { AppUpdate } from '@/components/AppUpdate';
export default function Page() {
  const { data, replace } = useRecruitment();
  const [backup, setBackup] = useState<RecruitmentData | null>(null),
    [error, setError] = useState('');
  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    try {
      if (file.size > 5 * 1024 * 1024)
        throw Error('백업은 5MB 이하 JSON 파일을 선택해 주세요.');
      const parsed: unknown = JSON.parse(await file.text());
      if (!validateData(parsed))
        throw Error('백업 형식이나 연결된 데이터가 올바르지 않습니다.');
      setBackup(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : '백업을 읽지 못했습니다.');
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">설정</h1>
        <p className="mt-1 text-sm text-slate-500">
          브라우저 데이터 백업과 변경 이력을 관리합니다.
        </p>
      </div>
      <AppUpdate />
      <div className="card space-y-4 p-6">
        <h2 className="font-bold">데이터 백업</h2>
        <p className="text-sm text-slate-600">
          같은 브라우저·같은 사이트에서 데이터가 유지됩니다. 브라우저 데이터를
          삭제하면 기록도 삭제됩니다. 백업 파일에는 연락처와 이력서도 포함되므로
          안전하게 보관해 주세요.
        </p>
        <button
          className="btn-primary"
          onClick={() =>
            download(
              'alkynes-backup-' +
                new Date().toISOString().slice(0, 10) +
                '.json',
              JSON.stringify(data, null, 2),
            )
          }
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
      <div className="card space-y-3 p-6">
        <h2 className="font-bold">운영 역할 안내</h2>
        <p className="text-sm text-slate-500">
          현재는 로컬 시연 모드로 아래 접근제어는 적용되지 않았습니다. 여러
          사용자 운영에는 Supabase 인증 및 권한 구현이 필요합니다.
        </p>
        {[
          ['경영지원팀', '전체 채용·지원자·면접·평가 관리'],
          ['요청부서장', '본인 부서 채용건 조회 및 의사결정'],
          ['면접관', '배정된 면접 및 평가 작성'],
        ].map(([role, desc]) => (
          <div key={role}>
            <div className="font-semibold">{role}</div>
            <div className="text-sm text-slate-500">{desc}</div>
          </div>
        ))}
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
            현재 데이터를 백업 내용으로 교체합니다. 기존 데이터를 먼저 백업해
            주세요.
          </p>
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
              onClick={() => {
                const next = structuredClone(backup);
                next.activity.unshift({
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  actor: '경영지원팀 (로컬)',
                  message: '백업 데이터를 복원했습니다.',
                });
                if (replace(next)) setBackup(null);
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
