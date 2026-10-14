'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  seedData,
  storageKey,
  validateData,
  type RecruitmentData,
} from '@/lib/recruitment';
import { removeLegacySamples } from '@/lib/recruitment-view';
type Store = {
  data: RecruitmentData;
  ready: boolean;
  notice: string;
  error: string;
  commit: (
    message: string,
    change: (draft: RecruitmentData) => void,
  ) => boolean;
  replace: (data: RecruitmentData) => boolean;
};
const Context = createContext<Store | null>(null);
export function RecruitmentProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<RecruitmentData>(() => removeLegacySamples(seedData())),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const load = () => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (!validateData(parsed)) throw Error();
          const cleaned = removeLegacySamples(structuredClone(parsed));
          if (JSON.stringify(cleaned) !== saved) localStorage.setItem(storageKey, JSON.stringify(cleaned));
          setData(cleaned);
        } else setData(removeLegacySamples(seedData()));
        setBlocked(false);
      } catch {
        setError(
          '브라우저 저장 데이터를 읽을 수 없습니다. 기존 데이터 보호를 위해 저장을 중단했습니다. 설정에서 정상 백업을 복원하거나 저장 권한을 확인해 주세요.',
        );
        setBlocked(true);
      }
      setReady(true);
    };
    load();
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) load();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function persist(next: RecruitmentData, message: string) {
    try {
      if (!validateData(next))
        throw Error('입력 값이나 연결된 데이터가 올바르지 않습니다.');
      localStorage.setItem(storageKey, JSON.stringify(next));
      setData(next);
      setNotice(message);
      setError('');
      return true;
    } catch (e) {
      setNotice('');
      setError(
        e instanceof Error &&
          e.message === '입력 값이나 연결된 데이터가 올바르지 않습니다.'
          ? e.message
          : '저장 공간이 부족하거나 브라우저 저장이 차단되었습니다. 이력서 크기를 줄이거나 저장 권한을 확인해 주세요. 변경 사항은 저장되지 않았습니다.',
      );
      return false;
    }
  }
  function commit(message: string, change: (draft: RecruitmentData) => void) {
    if (!ready || blocked) return false;
    let next: RecruitmentData;
    try {
      const raw = localStorage.getItem(storageKey);
      const latest: unknown = raw ? JSON.parse(raw) : data;
      if (!validateData(latest))
        throw Error(
          '저장 데이터를 읽을 수 없습니다. 정상 백업을 복원해 주세요.',
        );
      next = removeLegacySamples(structuredClone(latest));
      change(next);
    } catch (e) {
      setNotice('');
      setError(e instanceof Error ? e.message : '저장할 수 없습니다.');
      return false;
    }
    next.activity.unshift({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: '경영지원팀 (로컬)',
      message,
    });
    return persist(next, message);
  }
  function replace(next: RecruitmentData) {
    if (!validateData(next)) {
      setError('백업 파일의 형식 또는 데이터 연결이 올바르지 않습니다.');
      return false;
    }
    const result = persist(removeLegacySamples(structuredClone(next)), '백업 데이터를 복원했습니다.');
    if (result) setBlocked(false);
    return result;
  }
  return (
    <Context.Provider value={{ data, ready, notice, error, commit, replace }}>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {ready ? children : <p role="status">채용 데이터를 불러오는 중입니다…</p>}
    </Context.Provider>
  );
}
export function useRecruitment() {
  const value = useContext(Context);
  if (!value) throw Error('RecruitmentProvider is required');
  return value;
}
