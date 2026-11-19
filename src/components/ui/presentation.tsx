import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleAlert, CircleDashed, Clock, Info, Ellipsis } from 'lucide-react';
const brandMark = new URL('../../assets/illustrations/brand-mountains.webp', import.meta.url).href;

export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';
const toneIcons = { neutral: CircleDashed, success: CircleCheck, info: Info, warning: Clock, danger: CircleAlert };
export function StatusChip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const Icon = toneIcons[tone];
  return <span className={`status-chip tone-${tone}`}><Icon size={14} aria-hidden="true"/>{children}</span>;
}
export function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return <span className="avatar" data-tone={index % 6} aria-hidden="true">{Array.from(name)[0]}</span>;
}
export function PageHeader({ title, label, icon, subtitle, actions }: { title: ReactNode; label?: string; icon?: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return <header className="page-header"><div><h1 className={label ? 'workspace-heading' : undefined}>
    {label && <span className="sr-only">{label} · </span>}
    {icon && <span className="workspace-heading-icon" aria-hidden="true">{icon}</span>}
    <span className="workspace-heading-copy">{title}</span>
  </h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}
export function Brand() { return <><img className="brand-mark" src={brandMark} width={40} height={30} alt=""/><span className="brand-word">同路</span></>; }

/** Row actions do not add another details/summary to the workspace. */
export function ActionMenu({ children, label = '操作' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return <div className="action-menu" ref={ref} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} className="button button-ghost icon-button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Ellipsis size={20}/></button>
    {open && <div id={id} className="menu-items" onClick={() => { setOpen(false); trigger.current?.focus(); }}>{children}</div>}
  </div>;
}
