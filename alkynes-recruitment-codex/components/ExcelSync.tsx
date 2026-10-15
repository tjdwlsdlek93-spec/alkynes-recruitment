'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRecruitment } from './RecruitmentProvider';
import { Modal } from './Forms';
import { parseExcel, applyExcelSnapshot, type ExcelPlan } from '@/lib/excel';
import { download, formatDate } from '@/lib/recruitment';
const META = 'alkynes.excelSync.v1';
const header = { 'X-Alkynes-Client': '1' };
type Connection = { path: string; enabled: boolean };
type Status = Connection & {
  available: boolean | null;
  phase: 'idle' | 'checking' | 'synced' | 'error';
  message: string;
  lastSuccess: string;
};
type Pending = { path: string; revision: string; plan: ExcelPlan };
type SyncContextValue = {
  status: Status;
  working: boolean;
  preview: (path: string) => Promise<void>;
  pause: () => Promise<void>;
  refresh: () => Promise<{ ok: boolean; message: string }>;
};
const SyncContext = createContext<SyncContextValue | null>(null);
async function responseError(response: Response) {
  let message = '최신 PC 실행 패키지에서만 자동 연결을 사용할 수 있습니다.';
  try {
    const body = await response.json();
    if (typeof body.error === 'string') message = body.error;
  } catch {}
  return Error(message);
}
function meta() {
  try {
    return JSON.parse(localStorage.getItem(META) || '{}') as {
      path?: string;
      revision?: string;
      lastSuccess?: string;
    };
  } catch {
    return {};
  }
}
async function request(url: string, init: RequestInit = {}) {
  return fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    ...init,
    headers: { ...header, ...init.headers },
  });
}
function demo(data: ReturnType<typeof useRecruitment>['data']) {
  return (
    data.activity.length === 0 &&
    data.requisitions.length === 3 &&
    data.requisitions.every((r) => ['r1', 'r2', 'r3'].includes(r.id))
  );
}
export function ExcelSyncProvider({ children }: { children: ReactNode }) {
  const store = useRecruitment(),
    storeRef = useRef(store);
  storeRef.current = store;
  const [status, setStatus] = useState<Status>({
    path: '',
    enabled: false,
    available: null,
    phase: 'idle',
    message: '',
    lastSuccess: '',
  });
  const [pending, setPending] = useState<Pending | null>(null),
    [working, setWorking] = useState(false),
    [cleanDemo, setCleanDemo] = useState(false);
  const connection = useRef<Connection>({ path: '', enabled: false }),
    busy = useRef(false),
    pendingRef = useRef(false),
    mounted = useRef(true);
  function failed(error: unknown) {
    if (mounted.current)
      setStatus((s) => ({
        ...s,
        phase: 'error',
        message:
          error instanceof Error
            ? error.message
            : '동기화에 실패했습니다. 기존 데이터는 유지합니다.',
      }));
  }
  function remember(path: string, revision: string) {
    const lastSuccess = new Date().toISOString();
    try {
      localStorage.setItem(
        META,
        JSON.stringify({ path, revision, lastSuccess }),
      );
    } catch {}
    if (mounted.current)
      setStatus((s) => ({
        ...s,
        path,
        enabled: connection.current.enabled,
        available: true,
        phase: 'synced',
        message: connection.current.enabled ? '자동 반영 완료' : '수동 반영 완료 · 자동 연결은 일시 중지 상태입니다.',
        lastSuccess,
      }));
  }
  async function poll(force = false) {
    if (busy.current || pendingRef.current) return { ok: false, message: '엑셀 확인 작업이 진행 중입니다. 잠시 후 다시 눌러 주세요.' };
    if (!connection.current.path) return { ok: false, message: '엑셀 연동에서 파일 경로를 먼저 연결해 주세요.' };
    if (!force && !connection.current.enabled) return { ok: false, message: '자동 연결이 일시 중지되어 있습니다.' };
    busy.current = true;
    const selectedPath = connection.current.path;
    try {
      if (mounted.current) setStatus((s) => ({ ...s, phase: 'checking' }));
      const saved = meta();
      const hasRecords = (storeRef.current.data.requests || []).some(
        (q) => q.source === 'kpi-excel',
      );
      const revision =
        !force && hasRecords && saved.path === selectedPath
          ? saved.revision
          : '';
      const response = force && !connection.current.enabled
        ? await request('/__alkynes/source/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: selectedPath }) })
        : await request('/__alkynes/source/file', { headers: revision ? { 'If-None-Match': '"' + revision + '"' } : {} });
      if (response.status === 304) {
        if (mounted.current)
          setStatus((s) => ({
            ...s,
            phase: 'synced',
            message: '파일 변경 없음',
          }));
        return { ok: true, message: '엑셀이 최신 상태입니다.' };
      }
      if (!response.ok) throw await responseError(response);
      const incomingRevision = response.headers.get('X-Alkynes-Revision');
      if (!incomingRevision)
        throw Error(
          '연결 파일의 버전을 확인하지 못했습니다. 기존 데이터는 유지합니다.',
        );
      const plan = await parseExcel(
        await response.arrayBuffer(),
        selectedPath.split(/[\\/]/).pop() || '연결 Excel',
      );
      if (
        !mounted.current ||
        connection.current.path !== selectedPath ||
        (!force && !connection.current.enabled)
      )
        return { ok: false, message: '연결 설정이 변경되어 반영을 중단했습니다.' };
      if (
        !storeRef.current.commit(
          '연결 Excel ' + plan.rows + '행 자동 반영',
          (d) => applyExcelSnapshot(d, plan),
        )
      )
        throw Error(
          '브라우저 저장에 실패했습니다. 마지막으로 저장된 데이터를 유지합니다. 저장 공간과 권한을 확인해 주세요.',
        );
      remember(selectedPath, incomingRevision);
      return { ok: true, message: '엑셀 ' + plan.rows + '행 반영 완료' + (connection.current.enabled ? '' : ' · 자동 연결은 일시 중지 상태입니다.') };
    } catch (error) {
      failed(error);
      return { ok: false, message: error instanceof Error ? error.message : '엑셀 반영에 실패했습니다.' };
    } finally {
      busy.current = false;
    }
  }
  const pollRef = useRef(poll);
  pollRef.current = poll;
  useEffect(() => {
    mounted.current = true;
    let initialized = false;
    async function initialize() {
      try {
        const response = await request('/__alkynes/source');
        if (!response.ok) throw await responseError(response);
        const config = (await response.json()) as Connection;
        if (
          typeof config.path !== 'string' ||
          typeof config.enabled !== 'boolean'
        )
          throw Error('연결 설정을 확인하지 못했습니다.');
        if (!mounted.current) return;
        connection.current = config;
        initialized = true;
        const saved = meta();
        setStatus({
          path: config.path,
          enabled: config.enabled,
          available: true,
          phase: 'idle',
          message: config.enabled ? '자동 연결 · 파일 확인 중' : '사용자가 자동 연결을 일시 중지했습니다.',
          lastSuccess:
            saved.path === config.path ? saved.lastSuccess || '' : '',
        });
        if (config.enabled) await pollRef.current();
      } catch {
        initialized = false;
        if (mounted.current)
          setStatus((s) => ({
            ...s,
            available: false,
            phase: 'idle',
            message:
              '자동 연결 기능이 포함된 PC 패키지에서 사용할 수 있습니다.',
          }));
      }
    }
    void initialize();
    const timer = setInterval(() => void (initialized ? pollRef.current() : initialize()), 30000);
    const visible = () => {
      if (document.visibilityState === 'visible') void (initialized ? pollRef.current() : initialize());
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  async function preview(input: string) {
    if (busy.current) return;
    const path = input.trim().replace(/^"(.*)"$/, '$1');
    if (!path) {
      failed(
        Error(
          '파일 탐색기의 경로 복사를 이용해 전체 파일 경로를 입력해 주세요.',
        ),
      );
      return;
    }
    busy.current = true;
    setWorking(true);
    try {
      const response = await request('/__alkynes/source/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!response.ok) throw await responseError(response);
      const revision = response.headers.get('X-Alkynes-Revision');
      if (!revision) throw Error('파일 버전을 확인하지 못했습니다.');
      const plan = await parseExcel(
        await response.arrayBuffer(),
        path.split(/[\\/]/).pop() || '연결 Excel',
      );
      setPending({ path, revision, plan });
      pendingRef.current = true;
      setCleanDemo(demo(storeRef.current.data));
      setStatus((s) => ({
        ...s,
        phase: 'idle',
        message: '연결 미리보기를 확인해 주세요.',
      }));
    } catch (error) {
      failed(error);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  async function confirm() {
    if (!pending || busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      const response = await request('/__alkynes/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: pending.path,
          expectedRevision: pending.revision,
        }),
      });
      if (!response.ok) throw await responseError(response);
      const config = (await response.json()) as Connection;
      connection.current = { path: config.path, enabled: true };
      setStatus(s => ({ ...s, path: config.path, enabled: true }));
      if (
        !storeRef.current.commit(
          '네이버웍스 동기화 파일 자동 연결 및 ' +
            pending.plan.rows +
            '행 반영',
          (d) => {
            if (cleanDemo && demo(d)) {
              d.requisitions = [];
              d.candidates = [];
              d.interviews = [];
              d.evaluations = [];
              d.requests = [];
            }
            applyExcelSnapshot(d, pending.plan);
          },
        )
      )
        throw Error(
          '앱 데이터를 저장하지 못했습니다. 기존 데이터는 유지하며 30초 후 다시 시도합니다.',
        );
      connection.current = { path: config.path, enabled: true };
      remember(config.path, pending.revision);
      setPending(null);
      pendingRef.current = false;
    } catch (error) {
      failed(error);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  async function pause() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      const response = await request('/__alkynes/source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{"enabled":false}',
      });
      if (!response.ok) throw await responseError(response);
      connection.current.enabled = false;
      setStatus((s) => ({
        ...s,
        enabled: false,
        phase: 'idle',
        message: '자동 연결 중지 — 저장된 앱 데이터는 유지합니다.',
      }));
    } catch (error) {
      failed(error);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  return (
    <SyncContext.Provider
      value={{ status, working, preview, pause, refresh: () => poll(true) }}
    >
      {status.enabled && (
        <div
          role="status"
          className={
            'mb-4 rounded-xl border px-4 py-3 text-sm ' +
            (status.phase === 'error'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-100 bg-emerald-50 text-emerald-900')
          }
        >
          Excel 자동 연결 · {status.path.split(/[\\/]/).pop()} ·{' '}
          {status.phase === 'checking' ? '변경 확인 중' : status.message}
          <span className="ml-2 text-xs">
            마지막 반영{' '}
            {status.lastSuccess ? formatDate(status.lastSuccess) : '아직 없음'}
          </span>
          {status.phase === 'error' && (
            <span className="block text-xs">
              기존 데이터는 유지됩니다. 파일 저장·네이버웍스 동기화 완료 후 다시
              확인합니다.
            </span>
          )}
        </div>
      )}
      {children}
      {pending && (
        <Modal
          title="자동 연결 확인"
          onClose={() => {
            if (!working) {
              setPending(null);
              pendingRef.current = false;
            }
          }}
        >
          <p className="break-all text-sm">{pending.path}</p>
          <div className="my-4 rounded-xl bg-slate-50 p-4">
            원본 {pending.plan.rows}행 · 채용 {pending.plan.jobs.length}건 ·
            지원자 {pending.plan.candidates.length}명 · 요청{' '}
            {pending.plan.requests.length}건 · 면접{' '}
            {pending.plan.interviews.length}건
          </div>
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
            <li>
              30초마다 변경을 확인하며, 이 Excel 파일을 기준으로 연결 데이터를
              자동 갱신합니다.
            </li>
            <li>
              파일에서 삭제되거나 날짜가 바뀐 요청도 반영합니다. 수동 등록
              기록·연락처·이력서는 유지합니다.
            </li>
            <li>
              파일에서 빠진 채용·지원자는 원본 제외 기록으로 보관하고, 기존
              평가가 있는 삭제 일정은 취소 이력으로 남깁니다.
            </li>
            <li>
              파일이 깨졌거나 읽을 수 없으면 마지막 정상 데이터를 유지합니다.
              원본 파일과 수식은 수정하지 않습니다.
            </li>
            <li>
              PC의 네이버웍스 동기화가 먼저 완료되어야 합니다. 앱을 다시 열면
              변경 내용을 자동 확인합니다.
            </li>
          </ul>
          {demo(store.data) && (
            <label className="mt-4 block text-sm">
              <input
                type="checkbox"
                checked={cleanDemo}
                onChange={(e) => setCleanDemo(e.target.checked)}
              />{' '}
              처음 제공된 예시 데이터 정리
            </label>
          )}
          {status.phase === 'error' && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {status.message}
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              className="btn-secondary"
              onClick={() =>
                download(
                  '자동연결전백업.json',
                  JSON.stringify(store.data, null, 2),
                )
              }
            >
              현재 데이터 백업
            </button>
            <button
              className="btn-secondary"
              disabled={working}
              onClick={() => {
                setPending(null);
                pendingRef.current = false;
              }}
            >
              취소
            </button>
            <button
              className="btn-primary"
              disabled={working}
              onClick={() => void confirm()}
            >
              자동 연결 시작
            </button>
          </div>
        </Modal>
      )}
    </SyncContext.Provider>
  );
}
export function ExcelSyncControls() {
  const context = useContext(SyncContext);
  if (!context) throw Error('ExcelSyncProvider is required');
  const { status, working, preview, pause, refresh } = context;
  const [input, setInput] = useState('');
  useEffect(() => setInput(status.path), [status.path]);
  return (
    <section className="card space-y-3 p-5" aria-label="네이버웍스 자동 연결">
      <h2 className="font-bold">네이버웍스 동기화 폴더 자동 연결</h2>
      <p className="text-sm text-slate-600">
        탐색기에서 Excel 파일을 Shift+우클릭 → 경로로 복사한 뒤 붙여 넣으세요.
        파일을 다시 업로드하지 않아도 저장 변경을 확인합니다.
      </p>
      <label className="block text-sm font-medium">
        동기화 파일 전체 경로
        <input
          className="field mt-2"
          placeholder="C:\\Users\\사용자\\네이버웍스\\채용관리.xlsx"
          value={input}
          disabled={working}
          onChange={(e) => setInput(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          disabled={working || status.available !== true}
          onClick={() => void preview(input)}
        >
          파일 확인 / 자동 연결
        </button>
        <button
          className="btn-secondary"
          disabled={working || !status.enabled}
          onClick={() => void refresh()}
        >
          지금 확인
        </button>
        <button
          className="btn-secondary"
          disabled={working || !status.enabled}
          onClick={() => void pause()}
        >
          자동 연결 중지
        </button>
      </div>
      <p
        className={
          'text-sm ' +
          (status.phase === 'error' ? 'text-red-700' : 'text-slate-500')
        }
      >
        {working
          ? '연결 파일 검증 중…'
          : status.phase === 'error' && status.enabled ? status.message + ' — 자동 연결 유지, 30초 후 재시도' : status.message || '연결할 파일을 지정해 주세요.'}
      </p>
      <p className="text-xs text-slate-500">
        로그인 시 앱 서버가 자동 시작됩니다. 원본 파일을 앱이 수정하지 않으며,
        브라우저가 열려 있는 동안 30초 간격으로 반영합니다. 네이버웍스
        클라이언트도 로그인·동기화 상태여야 합니다.
      </p>
    </section>
  );
}

export function useExcelSync() {
  const context = useContext(SyncContext);
  if (!context) throw Error('ExcelSyncProvider is required');
  return context;
}
