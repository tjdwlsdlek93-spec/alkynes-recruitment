'use client';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useRecruitment } from '@/components/RecruitmentProvider';
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { error } = useRecruitment();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={onClose}
      className="w-[calc(100%-2rem)] max-w-2xl max-h-[90vh] rounded-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-950/40"
    >
      <div className="flex items-center justify-between border-b p-5">
        <h2 className="text-xl font-bold">{title}</h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={onClose}
          aria-label="닫기"
        >
          닫기
        </button>
      </div>
      <div className="p-5">
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {error}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5 text-sm font-medium">
      <label className="block" htmlFor={id}>
        {label}
      </label>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        ['input', 'select', 'textarea'].includes(String(child.type)) &&
        (child.props as { type?: string }).type !== 'hidden'
          ? cloneElement(child as ReactElement<{ id?: string }>, { id })
          : child,
      )}
    </div>
  );
}
export function Actions({
  onCancel,
  label = '저장',
}: {
  onCancel: () => void;
  label?: string;
}) {
  const { saving, readOnly } = useRecruitment();
  return (
    <div className="col-span-full mt-3 flex justify-end gap-2">
      <button type="button" className="btn-secondary" onClick={onCancel}>
        취소
      </button>
      <button type="submit" className="btn-primary" disabled={saving || readOnly}>
        {label}
      </button>
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty-state p-6 text-center text-sm text-slate-500">{children}</p>;
}
export function value(form: FormData, key: string) {
  return String(form.get(key) || '').trim();
}
