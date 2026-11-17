import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Compass, Map, Plus, Share2, Users, Wallet } from 'lucide-react';
import { Button, Dialog, ErrorNotice, Menu, Select, Status, Input } from '../components/ui';
import type { ExternalPageProps, SharingApplicationDependencies, SharingPanel, WorkspaceProps } from '../contracts/services';
import { getRuntime, dateToday, type Runtime } from './runtime';
import { useWorkspace } from './useWorkspace';
import { dependencies, featureExports } from './modules';
import { Unavailable } from './placeholders/Unavailable';
import { downloadRaw } from './application/download';
const navigation = [
  { path: 'squad', label: '小队', Icon: Users }, { path: 'plans', label: '方案', Icon: Map },
  { path: 'itinerary', label: '日程', Icon: CalendarDays }, { path: 'ledger', label: '账本', Icon: Wallet },
] as const;
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* Keep private trip contents out of telemetry. */ }
  render() {
    return this.state.failed ? <main className="external-page"><h1>页面暂时无法显示</h1><p>本地内容仍保留。重新载入后可恢复或导出。</p><Button onClick={() => location.reload()}>重新载入</Button></main> : this.props.children;
  }
}
function SkipLink() {
  return <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>跳转主内容</a>;
}
function Workbench({ runtime }: { runtime: Runtime }) {
  const params = useParams(); const navigate = useNavigate(); const [search] = useSearchParams();
  const workspace = navigation.find(item => item.path === params.workspace)?.path ?? 'squad';
  const state = useWorkspace(runtime, params.tripId, workspace);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | 'reset' | null>(null);
  const [name, setName] = useState(''); const [initialName, setInitialName] = useState(''); const [discardForm, setDiscardForm] = useState(false); const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false); const [panel, setPanel] = useState<SharingPanel | null>(() => search.get('import') === '1' ? { type: 'import', data: search.get('data') ?? undefined } : null);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const trip = state.trip;
  const currentRecord = state.records.find(record => record.id === params.tripId);
  const go = (target: string) => {
    if (state.saveStatus === 'unsaved' || state.saveStatus === 'conflict' || state.saveStatus === 'saving') setLeaveTarget(target);
    else navigate(target);
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (state.saveStatus === 'unsaved' || state.saveStatus === 'saving') { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [state.saveStatus]);
  if (params.workspace && !navigation.some(item => item.path === params.workspace)) return <MissingPage/>;
  if (!params.tripId && !state.loading && state.records.length) {
    const id = state.records.some(r => r.id === state.settings.lastTripId) ? state.settings.lastTripId : state.records[0].id;
    return <Navigate replace to={'/trip/' + id + '/' + (state.settings.workspace ?? 'squad') + (search.size ? '?' + search.toString() : '')}/>;
  }
  const sharingServices: SharingApplicationDependencies = {
    repository: runtime.repository, planning: dependencies.planning, execute: state.execute,
    now: () => new Date().toISOString(), today: () => dateToday(new Date()), createId: () => crypto.randomUUID(),
    baseUrl: new URL(import.meta.env.BASE_URL, location.origin).href,
  };
  const props: WorkspaceProps | null = trip ? {
    trip, execute: state.execute, saveStatus: state.saveStatus, services: dependencies,
    openInvite: memberId => setPanel({ type: 'invite', memberId }), openImport: () => setPanel({ type: 'import' }),
    openShare: planId => setPanel({ type: 'share', planId }),
  } : null;
  const Page = { squad: featureExports.SquadPage, plans: featureExports.PlansPage, itinerary: featureExports.ItineraryPage, ledger: featureExports.LedgerPage }[workspace];
  const Panels = featureExports.SharingPanels;
  const openDialog = (kind: typeof dialog) => {
    const initial = kind === 'rename' ? trip?.name ?? '' : '';
    setName(initial); setInitialName(initial); setFormError(''); setDialog(kind);
  };
  const requestCloseForm = () => {
    if (submitting) return;
    if (name !== initialName && state.saveStatus !== 'unsaved' && state.saveStatus !== 'conflict') setDiscardForm(true);
    else setDialog(null);
  };
  const exportRaw = async () => {
    if (trip) downloadRaw(JSON.stringify(trip, null, 2), 'tonglu-raw-' + trip.id + '.json');
    else if (params.tripId) {
      const result = await runtime.repository.getRaw(params.tripId);
      if (result.ok) downloadRaw(result.value, 'tonglu-corrupt-' + params.tripId + '.json'); else state.setError(result.error);
    }
  };
  const submitName = async () => {
    if (!name.trim() || name.trim().length > 80) { setFormError('请输入 1 至 80 字的旅行名称'); return; }
    setSubmitting(true);
    const result = dialog === 'create' ? await state.create(name) : await state.execute({ type: 'trip.rename', name: name.trim() });
    setSubmitting(false);
    if (result.ok) { setDialog(null); if (dialog === 'create') navigate('/trip/' + result.value.id + '/squad'); }
    else setFormError(result.error.message);
  };
  const remove = async () => {
    if (!currentRecord) return;
    setSubmitting(true); const result = await state.remove(currentRecord.id, currentRecord.revision); setSubmitting(false);
    if (result.ok) { setDialog(null); navigate('/'); } else setFormError(result.error.message);
  };
  return <><SkipLink/><div className="shell">
    <aside className="sidebar"><Link className="brand" to="/"><Compass size={28}/>同路</Link><nav aria-label="工作区">{navigation.map(({ path, label, Icon }) =>
      <Link key={path} to={params.tripId ? '/trip/' + params.tripId + '/' + path : '/'} className={'nav-link' + (path === workspace ? ' active' : '')} aria-current={path === workspace ? 'page' : undefined} onClick={event => { event.preventDefault(); go(params.tripId ? '/trip/' + params.tripId + '/' + path : '/'); }}><Icon size={20}/>{label}</Link>
    )}</nav><div className="sidebar-note">毕业旅行<br/>本地工作副本</div></aside>
    <div className="workspace">
      <header className="topbar">
        {state.records.length ? <Select label="选择旅行" value={params.tripId ?? ''} onChange={event => go('/trip/' + event.target.value + '/squad')}>
          {!currentRecord ? <option value="">选择旅行</option> : null}
          {state.records.map(record => <option key={record.id} value={record.id}>{record.name}{record.isDemo ? ' · 示例' : ''}</option>)}
        </Select> : <strong>毕业旅行</strong>}
        <div className="toolbar">{trip ? <Status status={state.saveStatus}/> : null}
          {trip ? <Button variant="secondary" onClick={() => setPanel({ type: 'share' })}><Share2 size={20}/>分享</Button> : null}
          <Menu label="更多"><Button variant="ghost" onClick={() => { const demo = state.records.find(record => record.isDemo); if (demo) go("/trip/" + demo.id + "/squad"); else void state.create("", true).then(result => { if (result.ok) navigate("/trip/" + result.value.id + "/squad"); }); }}>体验示例</Button><Button variant="ghost" onClick={() => openDialog('create')}><Plus size={20}/>创建旅行</Button>
            {trip ? <><Button variant="ghost" onClick={() => openDialog('rename')}>重命名</Button><Button variant="ghost" onClick={() => setPanel({ type: 'backup' })}>完整备份</Button>{trip.isDemo ? <Button variant="ghost" onClick={() => openDialog('reset')}>重置示例</Button> : null}</> : null}
            <Button variant="ghost" onClick={() => setPanel({ type: 'import' })}>导入</Button>
            {currentRecord ? <><Button variant="ghost" onClick={() => setPanel({ type: 'recovery' })}>本地恢复</Button><Button variant="ghost" onClick={() => openDialog('delete')}>删除旅行</Button></> : null}
          </Menu>
        </div>
      </header>
      {runtime.repository.mode === 'memory' ? <div className="banner" role="status">临时体验模式：此浏览器无法持久保存，刷新后内容会丢失。{trip ? <Button variant="ghost" onClick={() => void exportRaw()}>导出当前内容</Button> : null}</div> : null}
      {runtime.warnings.length || state.settingsWarning ? <div className="banner">{[...runtime.warnings, state.settingsWarning].filter(Boolean).join('；')}</div> : null}
      <main id="main" tabIndex={-1} className="content">
        {state.error ? <ErrorNotice>{state.error.message}{state.saveStatus === 'unsaved' || state.saveStatus === 'conflict' || state.error.code === 'CORRUPT' ? <div className="recovery-actions">{state.saveStatus === 'unsaved' ? <Button variant="secondary" onClick={() => void state.retry()}>重试保存</Button> : null}<Button variant="secondary" onClick={() => void exportRaw()}>导出当前内容</Button><Button variant="secondary" onClick={state.reload}>重新载入</Button></div> : null}</ErrorNotice> : null}
        {state.saveStatus === 'conflict' && !state.error ? <ErrorNotice>其他标签页已更新。重新载入前请保留当前编辑内容。<div className="recovery-actions"><Button variant="secondary" onClick={() => void exportRaw()}>导出当前内容</Button><Button variant="secondary" onClick={state.reload}>重新载入</Button></div></ErrorNotice> : null}
        {state.loading ? <div aria-label="正在读取本地旅行" role="status"><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/></div>
          : params.tripId && !trip ? <section className="empty-state"><h1>暂时无法打开此旅行</h1><p>请选择已有旅行，或导入备份恢复。</p><div className="toolbar"><Button onClick={() => setPanel({ type: 'import' })}>导入备份</Button>{currentRecord ? <Button variant="secondary" onClick={() => void exportRaw()}>导出原始内容</Button> : null}<Link to="/">返回旅行</Link></div></section>
          : trip && props ? <div key={trip.id + ':' + state.reloadKey}>{trip.isDemo ? <p className="muted">示例旅行 · 成员与账目均为虚构</p> : null}{Page ? <Suspense fallback={<div role="status" className="skeleton" aria-label="正在加载工作区"/>}><Page {...props}/></Suspense> : <Unavailable title={navigation.find(n => n.path === workspace)!.label}/>}</div>
          : <section className="empty-state"><h1>出发，从一支小队开始</h1><div className="recovery-actions"><Button onClick={() => openDialog('create')}><Plus size={20}/>创建旅行</Button><Button variant="secondary" onClick={() => void state.create('', true).then(result => { if (result.ok) navigate('/trip/' + result.value.id + '/squad'); })}>体验示例</Button></div></section>}
      </main>
    </div>
  </div>
  <Dialog open={dialog === 'create' || dialog === 'rename'} title={dialog === 'rename' ? '重命名旅行' : '创建旅行'} onClose={requestCloseForm}>
    <form onSubmit={event => { event.preventDefault(); void submitName(); }}><Input inputRef={nameInputRef} label="旅行名称" autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)} error={formError}/><Button type="submit" disabled={submitting}>{submitting ? '正在保存…' : dialog === 'rename' ? '保存名称' : '创建旅行'}</Button></form>
  </Dialog>
  <Dialog returnFocusRef={nameInputRef} open={discardForm} title="放弃未保存的名称？" onClose={() => setDiscardForm(false)} footer={<><Button variant="secondary" onClick={() => setDiscardForm(false)}>继续编辑</Button><Button variant="danger" onClick={() => { setDiscardForm(false); setDialog(null); }}>放弃修改</Button></>}>
    <p>名称尚未保存。</p>
  </Dialog>
  <Dialog open={dialog === 'delete'} title={'删除“' + (currentRecord?.name ?? '') + '”？'} onClose={() => { if (!submitting) setDialog(null); }} footer={<><Button variant="secondary" onClick={() => void exportRaw()}>先导出原始内容</Button><Button variant="danger" disabled={submitting} onClick={() => void remove()}>确认删除</Button></>}>
    <p>将删除此设备中的旅行和恢复副本。此操作无法撤销。</p>{formError ? <ErrorNotice>{formError}</ErrorNotice> : null}
  </Dialog>
  <Dialog open={dialog === 'reset'} title="重置示例旅行？" onClose={() => setDialog(null)} footer={<Button variant="danger" onClick={() => void state.execute({ type: 'trip.resetDemo' }).then(result => { if (result.ok) setDialog(null); else setFormError(result.error.message); })}>确认重置示例</Button>}>
    <p>将丢弃此示例的修改，不影响其他旅行。</p>{formError ? <ErrorNotice>{formError}</ErrorNotice> : null}
  </Dialog>
  <Dialog open={leaveTarget !== null} title="保留当前未保存内容" onClose={() => setLeaveTarget(null)} footer={<><Button variant="secondary" onClick={() => void exportRaw()}>导出当前内容</Button><Button variant="danger" onClick={() => { const target = leaveTarget; setLeaveTarget(null); if (target) { state.reload(); navigate(target); } }}>放弃本页修改并继续</Button></>}>
    <p>切换前可先导出当前内容，或留在此页处理保存问题。</p>
  </Dialog>
  {panel && Panels ? <Suspense fallback={<div role="status" className="banner">正在打开面板…</div>}><Panels trip={trip} panel={panel} onClose={() => setPanel(null)} repository={runtime.repository} services={sharingServices} onApplied={updated => { setPanel(null); navigate('/trip/' + updated.id + '/' + workspace); state.reload(); }}/></Suspense> : null}
  <Dialog open={panel !== null && !Panels} title={panel?.type === 'backup' ? '完整备份' : panel?.type === 'recovery' ? '本地恢复' : panel?.type === 'import' ? '导入' : '分享'} onClose={() => setPanel(null)}>
    <ErrorNotice>分享与导入模块尚未接入。</ErrorNotice>{trip || currentRecord ? <><p>可先导出包含成员资料与账目的原始 JSON。恢复时需要匹配的导入工具。</p><Button variant="secondary" onClick={() => void exportRaw()}>导出原始数据</Button></> : null}
  </Dialog>
  </>;
}
function ExternalPage({ runtime, kind }: { runtime: Runtime; kind: 'share' | 'join' | 'response' }) {
  const [search] = useSearchParams(); const navigate = useNavigate();
  const Page = { share: featureExports.SnapshotPage, join: featureExports.JoinPage, response: featureExports.ResponsePage }[kind];
  const props: ExternalPageProps = {
    data: search.get('data'), repository: runtime.repository,
    services: { repository: runtime.repository, planning: dependencies.planning, execute: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '请在原旅行中预览并应用' } }), now: () => new Date().toISOString(), today: () => dateToday(new Date()), createId: () => crypto.randomUUID(), baseUrl: new URL(import.meta.env.BASE_URL, location.origin).href },
    openImport: data => navigate('/?import=1' + (data ? '&data=' + encodeURIComponent(data) : '')),
  };
  return Page ? <Suspense fallback={<div role="status" className="skeleton" aria-label="正在加载工作区"/>}><Page {...props}/></Suspense> : <main className="external-page"><h1>暂时无法读取分享内容</h1><p>分享模块尚未接入，原有本地旅行不会改变。</p><Link to="/">返回旅行</Link></main>;
}
function MissingPage() { return <main className="external-page"><h1>没有找到这个页面</h1><p><Link to="/">返回旅行</Link></p></main>; }
export function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  useEffect(() => { let active = true; void getRuntime().then(value => { if (active) setRuntime(value); }); return () => { active = false; }; }, []);
  return <ErrorBoundary><HashRouter>{runtime ? <Routes>
    <Route path="/" element={<Workbench runtime={runtime}/>}/><Route path="/trip/:tripId/:workspace" element={<Workbench runtime={runtime}/>}/>
    <Route path="/share" element={<ExternalPage runtime={runtime} kind="share"/>}/><Route path="/join" element={<ExternalPage runtime={runtime} kind="join"/>}/><Route path="/response" element={<ExternalPage runtime={runtime} kind="response"/>}/>
    <Route path="*" element={<MissingPage/>}/>
  </Routes> : <main className="external-page" role="status">正在打开本地工作区…</main>}</HashRouter></ErrorBoundary>;
}
