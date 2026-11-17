export function Unavailable({ title }: { title: string }) {
  return <section><div className="page-heading"><h1>{title}</h1></div><div className="empty-state"><h2>此功能正在开发</h2><p className="muted">基础工程已就绪，等待功能模块接入。</p></div></section>;
}
