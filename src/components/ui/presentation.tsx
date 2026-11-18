import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleAlert, CircleDashed, Clock, Info, Check, Ellipsis } from 'lucide-react';

export type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';
const toneIcons = { neutral: CircleDashed, success: CircleCheck, info: Info, warning: Clock, danger: CircleAlert };
export function StatusChip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const Icon = toneIcons[tone];
  return <span className={`status-chip tone-${tone}`}><Icon size={14} aria-hidden="true"/>{children}</span>;
}
export function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return <span className="avatar" data-tone={index % 6} aria-hidden="true">{Array.from(name)[0]}</span>;
}
export function TagChip({ children, selected = false }: { children: ReactNode; selected?: boolean }) {
  return <span className={`tag-chip${selected ? ' selected' : ''}`}>{selected && <Check size={14} aria-hidden="true"/>}{children}</span>;
}
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}
export function Sheet({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return <section className={`sheet ${className}`}>{title && <div className="sheet-head"><h2>{title}</h2></div>}<div className="sheet-body">{children}</div></section>;
}
export function StatStrip({ children }: { children: ReactNode }) { return <div className="stat-strip">{children}</div>; }
export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong>{note && <div className="stat-note">{note}</div>}</div>;
}
export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const Icon = toneIcons[tone];
  return <div className={`notice tone-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}><Icon size={20} aria-hidden="true"/><div>{children}</div></div>;
}
export function Brand() { return <><span className="brand-seal" aria-hidden="true">同</span><span className="brand-word">同路</span></>; }

export function SegmentedControl({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <div className="segment-field"><span>{label}</span><div className="segmented-control" role="radiogroup" aria-label={label} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = options.findIndex(option => option.value === value);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }}>{options.map(option => <button key={option.value} role="radio" aria-checked={value === option.value} tabIndex={value === option.value ? 0 : -1} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></div>;
}

/** Row actions do not add another details/summary to the workspace. */
export function ActionMenu({ children }: { children: ReactNode }) {
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
    <button ref={trigger} className="button button-ghost icon-button" aria-label="操作" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Ellipsis size={20}/></button>
    {open && <div id={id} className="menu-items" onClick={() => { setOpen(false); trigger.current?.focus(); }}>{children}</div>}
  </div>;
}
