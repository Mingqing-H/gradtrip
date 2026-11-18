import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type RefObject, type SelectHTMLAttributes } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { SaveStatus } from '../../contracts/services';
export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props} />;
}
export function Input({ label, error, id, inputRef, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; inputRef?: Ref<HTMLInputElement> }) {
  const generated = useId(); const inputId = id ?? generated;
  return <div className="field"><label htmlFor={inputId}>{label}</label><input ref={inputRef} id={inputId} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} {...props}/>{error ? <span id={`${inputId}-error`} className="field-error">{error}</span> : null}</div>;
}
export function Select({ label, error, id, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  const generated = useId(); const inputId = id ?? generated;
  return <div className="field"><label htmlFor={inputId}>{label}</label><select id={inputId} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} {...props}>{children}</select>{error ? <span id={`${inputId}-error`} className="field-error">{error}</span> : null}</div>;
}
export interface DialogProps { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; returnFocusRef?: RefObject<HTMLElement | null> }
function Modal({ open, title, onClose, children, footer, returnFocusRef, drawer = false }: DialogProps & { drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnTarget = returnFocusRef?.current ?? previous;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')?.focus();
    return () => {
      dialog.close();
      const target = returnTarget;
      requestAnimationFrame(() => {
        if (target?.isConnected && !target.closest('dialog:not([open])')) target.focus();
      });
    };
  }, [open, returnFocusRef]);
  return <dialog ref={ref} className={drawer ? 'modal drawer' : 'modal'} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="modal-heading"><h2 id={titleId}>{title}</h2><Button variant="ghost" aria-label="关闭" onClick={onClose}><X size={20}/></Button></header>
    <div className="modal-body">{children}</div>{footer ? <footer className="modal-footer">{footer}</footer> : null}
  </dialog>;
}
export function Dialog(props: DialogProps) { return <Modal {...props}/>; }
export function Drawer(props: DialogProps) { return <Modal {...props} drawer/>; }
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  return <details className="menu" ref={ref} onKeyDown={event => { if (event.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }}><summary>{label}<ChevronDown size={16} aria-hidden="true"/></summary><div className="menu-items" onClick={() => { if (ref.current) ref.current.open = false; }}>{children}</div></details>;
}
const statuses: Record<SaveStatus, string> = { saved: '已保存到此设备', saving: '正在保存…', unsaved: '尚未保存', conflict: '其他标签页已更新', memoryOnly: '临时体验 · 刷新后丢失' };
export function Status({ status }: { status: SaveStatus }) {
  const Icon = status === 'saved' ? CheckCircle2 : status === 'saving' ? LoaderCircle : CircleAlert;
  return <span role="status" aria-label="保存状态" className={`save-status status-${status}`}><Icon size={16} aria-hidden="true"/>{statuses[status]}</span>;
}
export function ErrorNotice({ children }: { children: ReactNode }) { return <div role="alert" className="error-notice">{children}</div>; }
