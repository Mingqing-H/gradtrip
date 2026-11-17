import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import type { SaveStatus } from '../../contracts/services';
export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props} />;
}
export function Input({ label, error, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const generated = useId(); const inputId = id ?? generated;
  return <div className="field"><label htmlFor={inputId}>{label}</label><input id={inputId} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} {...props}/>{error ? <span id={`${inputId}-error`} className="field-error">{error}</span> : null}</div>;
}
export function Select({ label, error, id, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  const generated = useId(); const inputId = id ?? generated;
  return <div className="field"><label htmlFor={inputId}>{label}</label><select id={inputId} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} {...props}>{children}</select>{error ? <span id={`${inputId}-error`} className="field-error">{error}</span> : null}</div>;
}
export interface DialogProps { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }
function Modal({ open, title, onClose, children, footer, drawer = false }: DialogProps & { drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, [open]);
  return <dialog ref={ref} className={drawer ? 'modal drawer' : 'modal'} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="modal-heading"><h2 id={titleId}>{title}</h2><Button variant="ghost" aria-label="关闭" onClick={onClose}><X size={20}/></Button></header>
    <div className="modal-body">{children}</div>{footer ? <footer className="modal-footer">{footer}</footer> : null}
  </dialog>;
}
export function Dialog(props: DialogProps) { return <Modal {...props}/>; }
export function Drawer(props: DialogProps) { return <Modal {...props} drawer/>; }
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return <details className="menu" ref={ref} onKeyDown={event => { if (event.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }}><summary>{label}</summary><div className="menu-items" onClick={() => { if (ref.current) ref.current.open = false; }}>{children}</div></details>;
}
const statuses: Record<SaveStatus, string> = { saved: '已保存到此设备', saving: '正在保存…', unsaved: '尚未保存', conflict: '其他标签页已更新', memoryOnly: '临时体验 · 刷新后丢失' };
export function Status({ status }: { status: SaveStatus }) { return <span role="status" className={`save-status status-${status}`}>{statuses[status]}</span>; }
export function ErrorNotice({ children }: { children: ReactNode }) { return <div role="alert" className="error-notice">{children}</div>; }
