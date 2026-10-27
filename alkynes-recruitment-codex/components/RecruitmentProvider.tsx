'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  seedData,
  storageKey,
  validateData,
  type RecruitmentData,
} from '@/lib/recruitment';
import { MobileRefresh } from './MobileRefresh';
import { removeLegacySamples } from '@/lib/recruitment-view';
type Mode = 'loading' | 'sqlite' | 'browser';
type Snapshot = {
  data: RecruitmentData | null;
  revision: number;
  updatedAt: string;
  databasePath: string;
  backupWarning?: string;
  readOnly?: boolean;
};
type Store = {
  dataRevision: number;
  readOnly: boolean;
  data: RecruitmentData;
  ready: boolean;
  notice: string;
  error: string;
  saving: boolean;
  storage: Mode;
  databasePath: string;
  commit: (
    message: string,
    change: (draft: RecruitmentData) => void,
  ) => Promise<boolean>;
  replace: (data: RecruitmentData) => Promise<boolean>;
};
class StorageError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function database(
  body?: object,
  suffix = '',
  revision?: number,
): Promise<Snapshot | null> {
  const response = await fetch('/__alkynes/data' + suffix, {
    method: body ? 'POST' : 'GET',
    headers: {
      'X-Alkynes-Client': '1',
      'X-Alkynes-Compact': '1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(revision ? { 'If-None-Match': '"' + revision + '"' } : {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 304) return null;
  if (!response.ok) {
    let message =
      '노트북 DB에 연결하지 못했습니다. 앱 서버 실행 상태를 확인해 주세요.';
    try {
      const result = await response.json();
      if (typeof result.error === 'string') message = result.error;
    } catch {}
    throw new StorageError(message, response.status);
  }
  const result = await response.json();
  if (
    result.storage !== 'sqlite' ||
    !Number.isSafeInteger(result.revision) ||
    result.revision < 0
  )
    throw Error('DB 저장 응답을 확인하지 못했습니다.');
  return result;
}
const Context = createContext<Store | null>(null);
const empty = () => removeLegacySamples(seedData());
export function RecruitmentProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<RecruitmentData>(empty),
    [ready, setReady] = useState(false),
    [readOnly, setReadOnly] = useState(false),
    [dataRevision, setDataRevision] = useState(0),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [storage, setStorage] = useState<Mode>('loading'),
    [databasePath, setDatabasePath] = useState(''),
    [retry, setRetry] = useState(0),
    [backupWarning, setBackupWarning] = useState('');
  const state = useRef({
    mode: 'loading' as Mode,
    revision: 0,
    data: empty(),
    blocked: false,
    readOnly: false,
  });
  const queue = useRef(Promise.resolve(true)),
    pending = useRef(0);
  function adopt(next: RecruitmentData, revision: number) {
    state.current.data = next;
    state.current.revision = revision;
    setData(next);
    setDataRevision(revision);
  }
  function browserData() {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return empty();
    const value: unknown = JSON.parse(raw);
    if (!validateData(value))
      throw Error(
        '브라우저 기존 데이터의 형식을 확인해 주세요. 원본은 변경하지 않았습니다.',
      );
    return removeLegacySamples(structuredClone(value));
  }
  useEffect(() => {
    let active = true,
      polling = false;
    async function initialize() {
      setReady(false);
      setError('');
      state.current.mode = 'loading';
      state.current.blocked = false;
      try {
        let snapshot: Snapshot | null;
        try {
          snapshot = await database();
        } catch (e) {
          // Compatibility for static web previews / old servers only. Never fall back after DB errors.
          if (!(e instanceof StorageError) || e.status !== 404) throw e;
          const health = await fetch('/__alkynes/health', {
            cache: 'no-store',
          });
          if (health.ok) {
            try {
              const value = await health.json();
              if (value.storage === 'sqlite')
                throw new StorageError(
                  'DB 저장소 경로를 확인하지 못했습니다.',
                  500,
                );
            } catch (e) {
              if (e instanceof StorageError) throw e;
            }
          }
          if (!active) return;
          state.current.mode = 'browser';
          setStorage('browser');
          try {
            adopt(browserData(), 0);
          } catch (error) {
            state.current.blocked = true;
            setError(
              error instanceof Error
                ? error.message
                : '브라우저 데이터를 읽지 못했습니다.',
            );
          }
          setReady(true);
          return;
        }
        if (!snapshot) throw Error('DB 응답이 없습니다.');
        state.current.readOnly = snapshot.readOnly === true;
        setReadOnly(state.current.readOnly);
        if (!snapshot.data && snapshot.readOnly) snapshot = { ...snapshot, data: empty() };
        if (!snapshot.data) {
          const raw = localStorage.getItem(storageKey),
            legacy: unknown = raw !== null ? JSON.parse(raw) : null;
          if (raw !== null && !validateData(legacy))
            throw Error(
              '브라우저 기존 데이터를 검증하지 못해 이전을 중단했습니다. 원본은 유지됩니다.',
            );
          const next = legacy
            ? removeLegacySamples(structuredClone(legacy as RecruitmentData))
            : empty();
          try {
            const ack = await database(
              { data: next, revision: 0, legacy },
              '/migrate',
            );
            if (!ack) throw Error('이전 결과를 확인하지 못했습니다.');
            snapshot = { ...ack, data: ack.data || next };
          } catch (e) {
            if (!(e instanceof StorageError) || e.status !== 409) throw e;
            snapshot = await database();
          }
        }
        if (!snapshot?.data || !validateData(snapshot.data))
          throw Error(
            'DB 데이터를 검증하지 못했습니다. 기존 파일은 유지합니다.',
          );
        if (!active) return;
        state.current.mode = 'sqlite';
        setStorage('sqlite');
        setDatabasePath(snapshot.databasePath);
        setBackupWarning(snapshot.backupWarning || '');
        adopt(removeLegacySamples(snapshot.data), snapshot.revision);
        setReady(true);
      } catch (error) {
        if (active) {
          state.current.blocked = true;
          setError(
            error instanceof Error
              ? error.message
              : '저장소를 열지 못했습니다.',
          );
        }
      }
    }
    async function refresh() {
      if (
        !active ||
        polling ||
        pending.current ||
        state.current.mode !== 'sqlite'
      )
        return;
      polling = true;
      try {
        const requestedRevision = state.current.revision;
        const next = await database(undefined, '', requestedRevision);
        if (active && !pending.current && next) {
          if (state.current.revision !== requestedRevision) return;

          if (!next.data || !validateData(next.data))
            throw Error(
              'DB 데이터가 없어 새로 저장하지 않았습니다. 백업을 확인해 주세요.',
            );
          adopt(removeLegacySamples(next.data), next.revision);
          setBackupWarning(next.backupWarning || '');
          if (state.current.readOnly) { state.current.blocked = false; setReady(true); setError(''); }
        }
      } catch (error) {
        if (active && state.current.readOnly) {
          // An expired session or disconnected notebook must not leave stale schedules visible.
          adopt(empty(), 0);
          state.current.blocked = true;
          setReady(false);
          if (error instanceof StorageError && error.status === 401) {
            window.location.reload();
            return;
          }
        }
        if (active)
          setError(
            error instanceof Error ? error.message : 'DB 확인에 실패했습니다.',
          );
      } finally {
        polling = false;
      }
    }
    const sync = (event: StorageEvent) => {
      if (
        state.current.mode === 'browser' &&
        (event.key === storageKey || event.key === null)
      ) {
        try {
          adopt(browserData(), 0);
          state.current.blocked = false;
        } catch (e) {
          state.current.blocked = true;
          setError(e instanceof Error ? e.message : '저장 오류');
        }
      }
    };
    void initialize();
    const timer = setInterval(() => void refresh(), 3000);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', sync);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', sync);
    };
  }, [retry]);
  function write(
    message: string,
    change: (draft: RecruitmentData) => void,
    replacement?: RecruitmentData,
  ) {
    pending.current++;
    setSaving(true);
    const result = queue.current.then(async () => {
      try {
        if (state.current.readOnly) throw Error('휴대폰에서는 조회만 가능합니다. 노트북에서 수정해 주세요.');
        const mode = state.current.mode;
        if (mode === 'loading' || (state.current.blocked && !replacement))
          throw Error('저장소를 먼저 확인해 주세요.');
        let latest = state.current.data,
          revision = state.current.revision;
        if (mode === 'sqlite') {
          const saved = await database();
          if (!saved?.data || !validateData(saved.data))
            throw Error('기존 DB를 확인하지 못해 저장을 중단했습니다.');
          latest = saved.data;
          revision = saved.revision;
        } else if (!replacement) latest = browserData();
        const next = removeLegacySamples(
          structuredClone(replacement || latest),
        );
        change(next);
        if (!validateData(next))
          throw Error(
            '입력 값이나 데이터 연결이 올바르지 않습니다. 저장하지 않았습니다.',
          );
        if (mode === 'sqlite') {
          const ack = await database({ data: next, revision, ...(replacement ? { beforeRestore: true } : {}) });
          if (!ack) throw Error('DB 저장 결과를 확인하지 못했습니다.');
          revision = ack.revision;
          if (ack.data && validateData(ack.data)) { Object.assign(next, ack.data); }
          setBackupWarning(ack.backupWarning || '');
        } else localStorage.setItem(storageKey, JSON.stringify(next));
        adopt(next, revision);
        state.current.blocked = false;
        setError('');
        setNotice(message);
        return true;
      } catch (error) {
        setNotice('');
        setError(
          error instanceof Error
            ? error.message
            : '저장에 실패했습니다. 기존 데이터를 유지합니다.',
        );
        return false;
      } finally {
        pending.current--;
        if (!pending.current) setSaving(false);
      }
    });
    queue.current = result;
    return result;
  }
  function commit(message: string, change: (draft: RecruitmentData) => void) {
    return write(message, (draft) => {
      change(draft);
      draft.activity.unshift({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        actor: '경영지원팀 (로컬)',
        message,
      });
    });
  }
  function replace(next: RecruitmentData) {
    if (!validateData(next)) {
      setError('백업 형식이나 연결 정보가 올바르지 않습니다.');
      return Promise.resolve(false);
    }
    return write('백업 데이터를 복원했습니다.', () => {}, next);
  }
  return (
    <Context.Provider
      value={{
        data,
        ready,
        notice,
        error,
        saving,
        storage,
        databasePath,
        readOnly,
        dataRevision,
        commit,
        replace,
      }}
    >
      {readOnly && <div role="status" className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm"><span>노트북 데이터 · 읽기 전용</span><MobileRefresh /><form action="/__alkynes/mobile/logout" method="post" className="mt-2"><button className="btn-secondary text-xs">접속 종료</button></form></div>}
      {backupWarning && <div role="alert" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">DB 저장은 유지되지만 {backupWarning}. 설정에서 백업 폴더를 확인해 주세요.</div>}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
          {!ready && (
            <button
              className="btn-secondary ml-3"
              onClick={() => setRetry((x) => x + 1)}
            >
              다시 연결
            </button>
          )}
        </div>
      )}
      {ready ? (
        children
      ) : (
        <p role="status">노트북 저장소를 확인하는 중입니다…</p>
      )}
    </Context.Provider>
  );
}
export function useRecruitment() {
  const value = useContext(Context);
  if (!value) throw Error('RecruitmentProvider is required');
  return value;
}
