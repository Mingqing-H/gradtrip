import { useEffect, useRef, useState } from 'react';
import type { RecoveryRecord, SharingPanelProps, Trip } from '../../contracts/services';
import { buildShareUrl, parseSharingInput } from '../../app/application/sharing';
import { buildBackupEnvelope, previewResponseImport, remapTripIds, validateBackupForImport, bytesToBase64Url } from '../../domain/sharing';
import type { BackupBody, InvitationBody, ResponseBody, SharingEnvelope } from '../../domain/sharing/types';
import { useSharingApp } from './useEnvelope';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { formatMoney } from '../../domain/money';

type CurrentProps = Omit<SharingPanelProps, 'trip'> & { trip: Trip };
function EnvelopeOutput({ envelope, services, filename }: { envelope: SharingEnvelope; services: SharingPanelProps['services']; filename: string }) {
  const app = useSharingApp(services);
  const [message, setMessage] = useState('');
  const result = envelope.type === 'backup' ? null : app.createShareUrl(envelope.type, envelope);
  const link = result?.ok ? result.value : null;
  const download = () => { const result = app.downloadEnvelope(envelope, filename); setMessage(result.ok ? '已请求下载文件' : result.error.message); };
  return <div className="stack">
    {link ? <label>分享链接<textarea aria-label="分享链接" readOnly value={link} rows={3} onFocus={event => event.target.select()}/></label> : envelope.type !== 'backup' ? <p>链接过长，请使用文件传递。</p> : null}
    <div className="toolbar">{link ? <Button onClick={() => void app.copyShareUrl(link).then(result => setMessage(result.ok ? '已复制' : result.error.message))}>复制链接</Button> : null}<Button variant="secondary" onClick={download}>下载{envelope.type === 'invitation' ? '邀请' : envelope.type === 'snapshot' ? '快照' : '备份'}文件</Button></div>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
function InvitePanel({ trip, panel, onClose, services }: CurrentProps & { panel: { type: 'invite'; memberId: string } }) {
  const app = useSharingApp(services, trip.id);
  const member = trip.members.find(m => m.id === panel.memberId);
  const [includeTransport, setIncludeTransport] = useState(false);
  const [envelope, setEnvelope] = useState<SharingEnvelope<InvitationBody> | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const manual = member ? trip.plans.map(plan => plan.estimate.transportByMember[member.id]).filter(value => value && value.originCity === member.originCity) : [];
  async function generate() {
    if (!member || busy) return;
    setBusy(true); setError('');
    try {
      const invitation = app.buildInvitation(trip, member.id, includeTransport);
      if (!invitation.ok) { setError(invitation.error.message); return; }
      const value = invitation.value;
      const result = await services.execute({ type: 'sharing.registerInvitation', invitation: {
        id: value.payloadId, memberId: member.id, constraintRevision: value.body.constraintRevision,
        planVersions: Object.fromEntries(value.body.plans.map(plan => [plan.id, plan.version])), createdAt: value.createdAt,
      } });
      if (!result.ok) { setError(result.error.message); return; }
      setEnvelope(value);
    } finally { setBusy(false); }
  }
  return <Dialog open title={'邀请' + (member?.name ?? '') + '填写'} onClose={onClose}>
    <p>包含旅行名称、此成员昵称和候选方案；不含其他成员资料或账本。</p>
    {manual.length ? <label><input type="checkbox" checked={includeTransport} onChange={event => setIncludeTransport(event.target.checked)} style={{ width: 'auto', minHeight: 44 }}/>附带此成员在{member?.originCity}出发的手工交通估算</label> : null}
    {error ? <ErrorNotice>{error}</ErrorNotice> : null}
    {envelope ? <EnvelopeOutput envelope={envelope} services={services} filename="invitation.json"/> : <Button disabled={busy} onClick={() => void generate()}>{busy ? '正在登记…' : '生成邀请链接'}</Button>}
  </Dialog>;
}
function SharePanel({ trip, panel, onClose, services }: CurrentProps & { panel: { type: 'share'; planId?: string } }) {
  const app = useSharingApp(services, trip.id);
  const [planId, setPlanId] = useState(panel.planId ?? trip.confirmation?.planId ?? trip.plans[0]?.id ?? '');
  const [envelope, setEnvelope] = useState<SharingEnvelope | null>(null);
  const [error, setError] = useState('');
  const selected = trip.plans.find(plan => plan.id === planId);
  const name = (id: string, version: number) => { const template = services.planning.getTemplate(id, version); return template.ok ? template.value.name : id; };
  const generate = () => { const result = app.buildSnapshot(trip, planId); if (result.ok) setEnvelope(result.value); else setError(result.error.message); };
  return <Dialog open title="分享计划" onClose={onClose}>
    <label className="field">选择方案<select value={planId} onChange={event => { setPlanId(event.target.value); setEnvelope(null); setError(''); }}>{trip.plans.map(plan => <option key={plan.id} value={plan.id}>{name(plan.destinationId, plan.templateVersion)} · {plan.startDate}</option>)}</select></label>
    {selected ? <p>{name(selected.destinationId, selected.templateVersion)} · {selected.startDate} 起 {selected.days} 天</p> : <p>请先生成候选方案。</p>}
    <p>仅包含公开计划、日程与估算，不含私人资料、备注或实际账目。链接生成后不会自动更新。</p>
    {error ? <><ErrorNotice>{error}</ErrorNotice><a href={'#/trip/' + trip.id + '/itinerary'} onClick={onClose}>去调整日程</a></> : null}
    {envelope ? <EnvelopeOutput envelope={envelope} services={services} filename="snapshot.json"/> : <Button disabled={!planId} onClick={generate}>生成分享链接</Button>}
  </Dialog>;
}
function ImportPanel({ panel, onClose, services, onApplied }: SharingPanelProps & { panel: { type: 'import'; data?: string } }) {
  const app = useSharingApp(services);
  const [text, setText] = useState(panel.data ?? '');
  const [envelope, setEnvelope] = useState<SharingEnvelope | null>(null);
  const [localTrip, setLocalTrip] = useState<Trip | null>(null);
  const [localRevision, setLocalRevision] = useState<number | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function parse(input: string) {
    setBusy(true); setError(''); setEnvelope(null); setLocalTrip(null); setLocalRevision(null); setOverwrite(false);
    try {
      const parsed = parseSharingInput(input, services.baseUrl);
      if (!parsed.ok) { setError(parsed.error.message); return; }
      const env = parsed.value;
      let targetId: string | undefined;
      if (env.type === 'response') targetId = (env.body as ResponseBody).tripId;
      if (env.type === 'backup') {
        const validated = validateBackupForImport(env as SharingEnvelope<BackupBody>);
        if (!validated.ok) { setError(validated.error.message); return; }
        targetId = validated.value.id;
      }
      if (targetId) {
        const listed = await services.repository.list();
        if (!listed.ok) { setError(listed.error.message); return; }
        const record = listed.value.find(record => record.id === targetId);
        if (record) {
          setLocalRevision(record.revision);
          const local = await services.repository.get(targetId);
          if (local.ok) setLocalTrip(local.value);
          else if (local.error.code !== 'CORRUPT') { setError(local.error.message); return; }
        }
      }
      setEnvelope(env);
    } finally { setBusy(false); }
  }
  async function readFile(file: File) {
    const result = await app.readFile(file);
    if (!result.ok) { setError(result.error.message); return; }
    setText(result.value); await parse(result.value);
  }
  async function applyResponse(env: SharingEnvelope<ResponseBody>) {
    setBusy(true); setError('');
    try {
      const body = env.body;
      const result = await app.service.applyResponse({ id: env.payloadId, invitationId: body.invitationId, tripId: body.tripId, memberId: body.memberId, constraintRevision: body.baseConstraintRevision,
        planVersions: Object.fromEntries(body.intents.map(intent => [intent.planId, intent.planVersion])), member: body.profile, intents: body.intents });
      if (result.ok) onApplied(result.value); else setError(result.error.message);
    } finally { setBusy(false); }
  }
  async function applyBackup(env: SharingEnvelope<BackupBody>) {
    setBusy(true); setError('');
    try {
      const validated = validateBackupForImport(env); if (!validated.ok) { setError(validated.error.message); return; }
      const now = services.now();
      if (overwrite && localRevision !== null) {
        const result = await services.repository.replace({ trip: validated.value, expectedRevision: localRevision, recoveryId: services.createId(), now });
        if (result.ok) onApplied(result.value); else setError(result.error.message);
      } else {
        const incoming = localRevision === null ? validated.value : remapTripIds(validated.value, { newTripId: services.createId(), now, nextId: () => services.createId() });
        const result = await services.repository.create(incoming);
        if (result.ok) onApplied(result.value); else setError(result.error.message);
      }
    } finally { setBusy(false); }
  }
  const openExternal = (env: SharingEnvelope) => {
    const site = new URL(services.baseUrl);
    const result = buildShareUrl({ origin: site.origin, basePath: site.pathname, type: env.type, json: JSON.stringify(env) });
    if (result.ok) location.href = result.value;
    else {
      // File previews may exceed the share-link limit, but are already validated and stay on this device.
      location.hash = '#/' + (env.type === 'invitation' ? 'join' : 'share') + '?data=' + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(env)));
    }
    onClose();
  };
  const preview = envelope?.type === 'response' && localTrip ? previewResponseImport(localTrip, envelope as SharingEnvelope<ResponseBody>, services.planning) : null;
  const backup = envelope?.type === 'backup' ? validateBackupForImport(envelope as SharingEnvelope<BackupBody>) : null;
  return <Dialog open title="导入" onClose={onClose}>
    {error ? <ErrorNotice>{error}</ErrorNotice> : null}
    {!envelope ? <div className="stack"><label className="field">粘贴链接或 JSON 内容<textarea aria-label="粘贴链接或 JSON 内容" value={text} rows={4} onChange={event => setText(event.target.value)}/></label>
      <div className="toolbar"><Button disabled={busy || !text.trim()} onClick={() => void parse(text)}>预览导入</Button><Button variant="secondary" onClick={() => fileRef.current?.click()}>选择文件</Button></div>
      <input ref={fileRef} type="file" accept=".json,application/json" aria-label="选择 JSON 文件" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); }}/></div>
      : <div className="stack">
        {envelope.type === 'response' ? <><h2>成员反馈预览</h2>{!preview ? <ErrorNotice>此设备没有可应用反馈的原旅行，请在组织者设备导入。</ErrorNotice> : <>
          <p>{preview.memberName}</p>
          {preview.profileBefore && preview.profileAfter ? <dl>{(['name', 'originCity', 'budgetCap', 'availability', 'preferences'] as const).filter(key => JSON.stringify(preview.profileBefore![key]) !== JSON.stringify(preview.profileAfter![key])).map(key => {
            const format = (profile: NonNullable<typeof preview.profileBefore>) => key === 'budgetCap' ? profile.budgetCap === null ? '未填写' : formatMoney(profile.budgetCap) : key === 'availability' ? profile.availability.map(range => range.start + ' 至 ' + range.end).join('、') || '未填写' : key === 'preferences' ? profile.preferences.join('、') || '无' : profile[key] || '未填写';
            return <div key={key}><dt>{({ name: '昵称', originCity: '出发城市', budgetCap: '预算上限', availability: '可用日期', preferences: '偏好' })[key]}</dt><dd>{format(preview.profileBefore!)} → {format(preview.profileAfter!)}</dd></div>;
          })}</dl> : null}
          {preview.intentsAfter.map((intent, index) => {
            const plan = localTrip!.plans.find(plan => plan.id === intent.planId);
            const template = plan && services.planning.getTemplate(plan.destinationId, plan.templateVersion);
            return <p key={intent.planId}>{template?.ok ? template.value.name + ' · ' + plan!.startDate : '方案 ' + (index + 1)}：{({ approve: '赞成', acceptable: '可接受', decline: '不参加' })[intent.value]}</p>;
          })}
          {preview.state === 'duplicate' ? <p>该反馈已应用过，不会再次写入。</p> : preview.state === 'applicable' || preview.state === 'resubmission' ? <Button disabled={busy} onClick={() => void applyResponse(envelope as SharingEnvelope<ResponseBody>)}>{preview.state === 'resubmission' ? '确认替换旧反馈' : '应用到此设备'}</Button> : <ErrorNotice>{preview.error?.message}</ErrorNotice>}
        </>}</> : null}
        {backup?.ok ? <><h2>备份预览</h2><p>{backup.value.name} · {backup.value.members.length} 人 · {backup.value.expenses.length} 笔费用</p>
          {localRevision !== null ? <><p>本地版本 {localRevision} · 备份版本 {backup.value.revision}{backup.value.revision < localRevision ? '，备份版本较旧' : ''}{!localTrip ? '；本地内容损坏，将保留原始恢复副本' : ''}</p><label><input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)} style={{ width: 'auto', minHeight: 44 }}/>覆盖同 ID 本地旅行并保留恢复副本</label></> : null}
          <Button disabled={busy} onClick={() => void applyBackup(envelope as SharingEnvelope<BackupBody>)}>{localRevision === null ? '导入备份' : overwrite ? '确认覆盖' : '另存副本'}</Button></> : null}
        {envelope.type === 'invitation' || envelope.type === 'snapshot' ? <><h2>{envelope.type === 'invitation' ? '成员邀请' : '计划快照'}</h2><Button onClick={() => openExternal(envelope)}>{envelope.type === 'invitation' ? '打开填写页' : '查看快照'}</Button></> : null}
        <Button variant="ghost" onClick={() => { setEnvelope(null); setError(''); }}>重新导入</Button>
      </div>}
  </Dialog>;
}
function BackupPanel({ trip, services, onClose }: CurrentProps) {
  const envelope = useSharingApp(services).buildBackup(trip);
  return <Dialog open title="导出完整备份" onClose={onClose}><p>包含全部成员资料与账本，仅下载到本设备，请妥善保管。</p><EnvelopeOutput envelope={envelope} services={services} filename="backup.json"/></Dialog>;
}
function RecoveryPanel({ trip, onClose, services, onApplied }: CurrentProps) {
  const app = useSharingApp(services);
  const [records, setRecords] = useState<RecoveryRecord[]>([]);
  const [selected, setSelected] = useState<Trip | null>(null);
  const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void services.repository.listRecovery(trip.id).then(result => { if (active) { if (result.ok) setRecords(result.value); else setError(result.error.message); } }); return () => { active = false; }; }, [services.repository, trip.id, refresh]);
  const preview = (record: RecoveryRecord) => {
    const parsed = parseSharingInput(record.raw, services.baseUrl);
    if (parsed.ok && parsed.value.type === 'backup') {
      const validated = validateBackupForImport(parsed.value as SharingEnvelope<BackupBody>); if (validated.ok) setSelected(validated.value); else setError(validated.error.message);
      return;
    }
    // Repository recovery.raw contains a Trip, not an envelope.
    try {
      const result = validateBackupForImport(buildBackupEnvelope(JSON.parse(record.raw) as Trip, { payloadId: services.createId(), now: record.createdAt }));
      if (result.ok) setSelected(result.value); else setError(result.error.message);
    } catch { setError('恢复内容已损坏，可先导出原始内容。'); }
  };
  const restore = async () => {
    if (!selected) return; setBusy(true);
    const result = await services.repository.replace({ trip: selected, expectedRevision: trip.revision, recoveryId: services.createId(), now: services.now() });
    setBusy(false); if (result.ok) onApplied(result.value); else setError(result.error.message);
  };
  return <Dialog open title="备份与恢复" onClose={onClose}>
    {error ? <ErrorNotice>{error}</ErrorNotice> : null}
    {records.length ? records.map(record => <div className="stack" key={record.id}><p>{new Date(record.createdAt).toLocaleString('zh-CN')}</p><div className="toolbar"><Button variant="secondary" onClick={() => preview(record)}>预览</Button><Button variant="secondary" onClick={() => { try { const result = app.downloadEnvelope(buildBackupEnvelope(JSON.parse(record.raw) as Trip, { payloadId: services.createId(), now: record.createdAt }), 'recovery.json'); if (!result.ok) setError(result.error.message); } catch { setError('无法导出此恢复副本'); } }}>导出</Button><Button variant="ghost" onClick={() => void services.repository.deleteRecovery(record.id).then(result => { if (result.ok) setRefresh(n => n + 1); else setError(result.error.message); })}>删除副本</Button></div></div>) : <p>暂无恢复副本。</p>}
    {selected ? <div className="stack"><h2>恢复预览</h2><p>{selected.name} · {selected.members.length} 人 · {selected.expenses.length} 笔费用</p><p>恢复前会保留当前版本。</p><Button disabled={busy} onClick={() => void restore()}>确认恢复此版本</Button></div> : null}
  </Dialog>;
}
export function SharingPanels(props: SharingPanelProps) {
  const { trip, panel } = props;
  if (panel.type === 'import') return <ImportPanel {...props} panel={panel}/>;
  if (!trip) return <Dialog open title="请选择旅行" onClose={props.onClose}><ErrorNotice>此操作需要先打开本地旅行。</ErrorNotice></Dialog>;
  const current = { ...props, trip };
  switch (panel.type) {
    case 'invite': return <InvitePanel {...current} panel={panel}/>;
    case 'share': return <SharePanel {...current} panel={panel}/>;
    case 'backup': return <BackupPanel {...current}/>;
    case 'recovery': return <RecoveryPanel {...current}/>;
  }
}
