import { useRef, useState } from 'react';
import type { SharingPanelProps } from '../../contracts/services';
import { previewResponseImport, validateBackupForImport, planBackupImport } from '../../domain/sharing';
import type { InvitationBody, ResponseBody, BackupBody, SharingEnvelope } from '../../domain/sharing/types';
import { useSharingApp } from './useEnvelope';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { parseSharingInput } from '../../app/application/sharing';

// ---------------------------------------------------------------------------
// D03 单成员邀请
// ---------------------------------------------------------------------------

function InvitePanel({ trip, panel, onClose, services }: SharingPanelProps & { panel: { type: 'invite'; memberId: string } }) {
  const app = useSharingApp(services, trip.id);
  const member = trip.members.find((m) => m.id === panel.memberId);
  const [includeTransport, setIncludeTransport] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [jsonFallback, setJsonFallback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [registering, setRegistering] = useState(false);

  const hasManualTransport = member && trip.plans.some((p) => {
    const t = p.estimate.transportByMember[member.id];
    return t && t.originCity === member.originCity;
  });

  async function handleGenerate() {
    if (!member) return;
    setRegistering(true);
    setError(null);
    try {
      // 先登记邀请
      const regResult = await services.execute({
        type: 'sharing.registerInvitation',
        invitation: {
          id: services.createId(),
          memberId: member.id,
          constraintRevision: trip.constraintRevision,
          planVersions: Object.fromEntries(trip.plans.map((p) => [p.id, p.version])),
          createdAt: services.now(),
        },
      });
      if (!regResult.ok) { setError(regResult.error.message); return; }

      const invitation = app.buildInvitation(trip, member.id, includeTransport);
      if (!invitation.ok) { setError(invitation.error.message); return; }

      const url = app.createShareUrl('invitation', invitation.value);
      if (url.ok) {
        setLink(url.value);
      } else {
        setJsonFallback(JSON.stringify(invitation.value, null, 2));
      }
    } finally {
      setRegistering(false);
    }
  }

  async function handleCopy() {
    if (!link) return;
    const result = await app.copyShareUrl(link);
    setCopied(result.ok);
  }

  function handleDownload() {
    const invitation = app.buildInvitation(trip, member?.id ?? '', includeTransport);
    if (invitation.ok) {
      app.downloadEnvelope(invitation.value, `invitation-${member?.id}.json`);
    }
  }

  return (
    <Dialog open title={`邀请${member?.name ?? ''}填写`} onClose={onClose}>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div style={{ marginBottom: '16px' }}>
        <p style={{ fontSize: '14px', color: 'var(--color-muted)' }}>
          将分享：旅行名称、目标成员昵称、候选方案公开信息{includeTransport && hasManualTransport ? '、该成员的手工交通估算' : ''}。
          不包含其他成员资料或账本。
        </p>
        {hasManualTransport && (
          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', fontSize: '14px' }}>
            <input type="checkbox" checked={includeTransport} onChange={(e) => setIncludeTransport(e.target.checked)} style={{ width: 'auto', minHeight: 'auto' }} />
            附带 {member?.name} 的手工交通估算（{member?.originCity}）
          </label>
        )}
      </div>
      {!link && !jsonFallback && (
        <Button onClick={handleGenerate} disabled={registering}>
          {registering ? '生成中…' : '生成邀请链接'}
        </Button>
      )}
      {link && (
        <div>
          <textarea readOnly value={link} style={{ width: '100%', minHeight: '60px', padding: '8px', fontSize: '12px', fontFamily: 'monospace' }} onFocus={(e) => e.target.select()} />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <Button onClick={handleCopy}>{copied ? '已复制' : '复制链接'}</Button>
            <Button variant="secondary" onClick={handleDownload}>下载邀请文件</Button>
          </div>
        </div>
      )}
      {jsonFallback && (
        <div>
          <p style={{ color: 'var(--color-warning)', fontSize: '14px' }}>链接过长，请下载邀请文件</p>
          <Button onClick={handleDownload}>下载邀请文件</Button>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// D09 分享计划
// ---------------------------------------------------------------------------

function SharePanel({ trip, panel, onClose, services }: SharingPanelProps & { panel: { type: 'share'; planId?: string } }) {
  const app = useSharingApp(services, trip.id);
  const [selectedPlanId, setSelectedPlanId] = useState(panel.planId ?? trip.confirmation?.planId ?? trip.plans[0]?.id ?? '');
  const [link, setLink] = useState<string | null>(null);
  const [jsonFallback, setJsonFallback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleGenerate() {
    setError(null);
    const snapshot = app.buildSnapshot(trip, selectedPlanId || undefined);
    if (!snapshot.ok) { setError(snapshot.error.message); return; }
    const url = app.createShareUrl('snapshot', snapshot.value);
    if (url.ok) {
      setLink(url.value);
    } else {
      setJsonFallback(JSON.stringify(snapshot.value, null, 2));
    }
  }

  async function handleCopy() {
    if (!link) return;
    const result = await app.copyShareUrl(link);
    setCopied(result.ok);
  }

  function handleDownload() {
    const snapshot = app.buildSnapshot(trip, selectedPlanId || undefined);
    if (snapshot.ok) {
      app.downloadEnvelope(snapshot.value, `snapshot-${trip.id}.json`);
    }
  }

  return (
    <Dialog open title="分享计划" onClose={onClose}>
      <div className="field">
        <label htmlFor="share-plan">选择方案</label>
        <select id="share-plan" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
          {trip.plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.destinationId} · {plan.startDate} · {plan.days}天
            </option>
          ))}
        </select>
      </div>
      <p style={{ fontSize: '14px', color: 'var(--color-muted)' }}>
        只分享公开计划内容：目的地、日期、公开日程、估算总览。不包含成员私人资料或实际账单。
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {!link && !jsonFallback && (
        <Button onClick={handleGenerate} disabled={!selectedPlanId}>生成分享链接</Button>
      )}
      {link && (
        <div>
          <textarea readOnly value={link} style={{ width: '100%', minHeight: '60px', padding: '8px', fontSize: '12px', fontFamily: 'monospace' }} onFocus={(e) => e.target.select()} />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <Button onClick={handleCopy}>{copied ? '已复制' : '复制链接'}</Button>
            <Button variant="secondary" onClick={handleDownload}>下载快照文件</Button>
          </div>
        </div>
      )}
      {jsonFallback && (
        <div>
          <p style={{ color: 'var(--color-warning)', fontSize: '14px' }}>链接过长，请下载快照文件</p>
          <Button onClick={handleDownload}>下载快照文件</Button>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// D10 导入与差异预览
// ---------------------------------------------------------------------------

function ImportPanel({ trip, onClose, services, onApplied }: SharingPanelProps & { panel: { type: 'import' } }) {
  const app = useSharingApp(services, trip.id);
  const [inputText, setInputText] = useState('');
  const [envelope, setEnvelope] = useState<SharingEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleParse() {
    setError(null);
    const result = parseSharingInput(inputText, services.baseUrl);
    if (!result.ok) { setError(result.error.message); return; }
    setEnvelope(result.value);
  }

  async function handleFile(file: File) {
    setError(null);
    const text = await app.readFile(file);
    if (!text.ok) { setError(text.error.message); return; }
    setInputText(text.value);
    const result = parseSharingInput(text.value, services.baseUrl);
    if (!result.ok) { setError(result.error.message); return; }
    setEnvelope(result.value);
  }

  async function handleApplyResponse(responseEnvelope: SharingEnvelope<ResponseBody>) {
    setApplying(true);
    setError(null);
    try {
      const input = {
        id: responseEnvelope.payloadId,
        invitationId: responseEnvelope.body.invitationId,
        tripId: responseEnvelope.body.tripId,
        memberId: responseEnvelope.body.memberId,
        constraintRevision: responseEnvelope.body.baseConstraintRevision,
        planVersions: Object.fromEntries(responseEnvelope.body.intents.map((i) => [i.planId, i.planVersion])),
        member: responseEnvelope.body.profile,
        intents: responseEnvelope.body.intents,
      };
      const result = await services.execute({ type: 'sharing.applyResponse', response: input });
      if (!result.ok) { setError(result.error.message); return; }
      onApplied(result.value);
      onClose();
    } finally {
      setApplying(false);
    }
  }

  async function handleImportBackup(backupEnvelope: SharingEnvelope<BackupBody>, mode: 'copy' | 'overwrite') {
    setApplying(true);
    setError(null);
    try {
      const validated = validateBackupForImport(backupEnvelope);
      if (!validated.ok) { setError(validated.error.message); return; }
      const plan = planBackupImport(
        mode === 'overwrite' ? trip : null,
        { ...backupEnvelope, body: { trip: validated.value } },
        { mode, newTripId: services.createId(), now: services.now(), nextId: (k, o) => `${services.createId()}_${k}_${o}` },
      );
      if (!plan.ok) { setError(plan.error.message); return; }
      if (plan.value.action === 'overwrite') {
        const result = await services.repository.replace({
          trip: plan.value.trip,
          expectedRevision: trip.revision,
          recoveryId: services.createId(),
          now: services.now(),
        });
        if (!result.ok) { setError(result.error.message); return; }
        onApplied(result.value);
      } else {
        const result = await services.repository.create(plan.value.trip);
        if (!result.ok) { setError(result.error.message); return; }
        onApplied(result.value);
      }
      onClose();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open title="导入" onClose={onClose}>
      {!envelope && (
        <>
          <div className="field">
            <label htmlFor="import-text">粘贴链接或 JSON 内容</label>
            <textarea
              id="import-text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="粘贴分享链接或 JSON 文件内容"
              style={{ minHeight: '100px' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <Button onClick={handleParse} disabled={!inputText.trim()}>解析</Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>选择文件</Button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
          </div>
        </>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {envelope && (
        <ImportPreview
          envelope={envelope}
          trip={trip}
          services={services}
          applying={applying}
          onApplyResponse={handleApplyResponse}
          onImportBackup={handleImportBackup}
          onReset={() => { setEnvelope(null); setError(null); }}
        />
      )}
    </Dialog>
  );
}

function ImportPreview({
  envelope, trip, services, applying, onApplyResponse, onImportBackup, onReset,
}: {
  envelope: SharingEnvelope;
  trip: SharingPanelProps['trip'];
  services: SharingPanelProps['services'];
  applying: boolean;
  onApplyResponse: (e: SharingEnvelope<ResponseBody>) => Promise<void>;
  onImportBackup: (e: SharingEnvelope<BackupBody>, mode: 'copy' | 'overwrite') => Promise<void>;
  onReset: () => void;
}) {
  const [overwrite, setOverwrite] = useState(false);

  if (envelope.type === 'response') {
    const response = envelope as SharingEnvelope<ResponseBody>;
    const preview = previewResponseImport(trip, response, services.planning);
    return (
      <div>
        <h3>成员反馈预览</h3>
        <p><strong>目标成员：</strong>{response.body.memberName}</p>
        <p><strong>资料变化：</strong>{preview.profileChanged === true ? '有变化' : preview.profileChanged === false ? '无变化' : '未知'}</p>
        {preview.state === 'applicable' && (
          <>
            <div style={{ margin: '12px 0' }}>
              {preview.intentsAfter.map((intent) => (
                <div key={intent.planId} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '14px' }}>
                  <span>{intent.planId}</span>
                  <strong>{intent.value === 'approve' ? '赞成' : intent.value === 'acceptable' ? '可接受' : '不参加'}</strong>
                </div>
              ))}
            </div>
            <Button onClick={() => void onApplyResponse(response)} disabled={applying}>
              {applying ? '应用中…' : '应用到此设备'}
            </Button>
          </>
        )}
        {preview.state === 'duplicate' && <p style={{ color: 'var(--color-muted)' }}>该反馈已应用过，不会再次写入</p>}
        {preview.state === 'stale' && <p style={{ color: 'var(--color-warning)' }}>反馈已过期：{preview.error?.message}</p>}
        {preview.state === 'resubmission' && (
          <div>
            <p style={{ color: 'var(--color-warning)' }}>同一邀请已有应用记录</p>
            <Button onClick={() => void onApplyResponse(response)} disabled={applying}>
              {applying ? '应用中…' : '确认替换旧反馈'}
            </Button>
          </div>
        )}
        {preview.state === 'invalid' && <ErrorNotice>{preview.error?.message}</ErrorNotice>}
        <Button variant="ghost" onClick={onReset} style={{ marginTop: '8px' }}>重新导入</Button>
      </div>
    );
  }

  if (envelope.type === 'backup') {
    const backup = envelope as SharingEnvelope<BackupBody>;
    const validated = validateBackupForImport(backup);
    if (!validated.ok) return <ErrorNotice>{validated.error.message}</ErrorNotice>;
    const tripData = validated.value;
    const sameId = trip.id === tripData.id;
    return (
      <div>
        <h3>备份预览</h3>
        <p><strong>名称：</strong>{tripData.name}</p>
        <p><strong>成员：</strong>{tripData.members.length} 人 · <strong>费用：</strong>{tripData.expenses.length} 笔</p>
        <p><strong>导出时间：</strong>{new Date(envelope.createdAt).toLocaleString('zh-CN')}</p>
        {sameId && (
          <div style={{ margin: '12px 0' }}>
            <p style={{ color: 'var(--color-warning)', fontSize: '14px' }}>
              本地存在同 ID 旅行（版本 {trip.revision} vs 备份 {tripData.revision}）
              {tripData.revision < trip.revision && '，导入版本较旧'}
            </p>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '14px' }}>
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} style={{ width: 'auto', minHeight: 'auto' }} />
              覆盖本地旅行（将先保留恢复副本）
            </label>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button onClick={() => void onImportBackup(backup, overwrite && sameId ? 'overwrite' : 'copy')} disabled={applying}>
            {applying ? '导入中…' : sameId && !overwrite ? '另存副本' : sameId && overwrite ? '确认覆盖' : '导入备份'}
          </Button>
          <Button variant="ghost" onClick={onReset}>重新导入</Button>
        </div>
      </div>
    );
  }

  if (envelope.type === 'invitation') {
    return (
      <div>
        <h3>成员邀请</h3>
        <p>旅行：{(envelope.body as InvitationBody).tripName}</p>
        <p>目标成员：{(envelope.body as InvitationBody).member.name}</p>
        <Button onClick={() => { window.location.hash = `#/join?data=${encodeURIComponent(JSON.stringify(envelope))}`; }}>打开填写页</Button>
        <Button variant="ghost" onClick={onReset} style={{ marginTop: '8px' }}>重新导入</Button>
      </div>
    );
  }

  if (envelope.type === 'snapshot') {
    return (
      <div>
        <h3>计划快照</h3>
        <p>旅行：{(envelope.body as { tripName: string }).tripName}</p>
        <Button onClick={() => { window.location.hash = `#/share?data=${encodeURIComponent(JSON.stringify(envelope))}`; }}>查看快照</Button>
        <Button variant="ghost" onClick={onReset} style={{ marginTop: '8px' }}>重新导入</Button>
      </div>
    );
  }

  return <ErrorNotice>未知的载荷类型</ErrorNotice>;
}

// ---------------------------------------------------------------------------
// D11 备份与恢复
// ---------------------------------------------------------------------------

function BackupPanel({ trip, onClose, services }: SharingPanelProps & { panel: { type: 'backup' } }) {
  const app = useSharingApp(services, trip.id);
  const [downloaded, setDownloaded] = useState(false);

  function handleExport() {
    const backup = app.buildBackup(trip);
    const result = app.downloadEnvelope(backup, `backup-${trip.name}-${new Date().toISOString().slice(0, 10)}.json`);
    if (result.ok) setDownloaded(true);
  }

  return (
    <Dialog open title="导出完整备份" onClose={onClose}>
      <p style={{ fontSize: '14px', color: 'var(--color-muted)' }}>
        备份包含：全部成员资料、方案、日程、实际费用和结算记录。文件仅保存到本设备，不会上传。
      </p>
      <p style={{ fontSize: '14px', color: 'var(--color-warning)' }}>
        注意：备份含成员私人资料，请妥善保管。
      </p>
      <Button onClick={handleExport}>{downloaded ? '已下载' : '下载备份文件'}</Button>
    </Dialog>
  );
}

function RecoveryPanel({ trip, onClose, services }: SharingPanelProps & { panel: { type: 'recovery' } }) {
  const [recoveries, setRecoveries] = useState<Array<{ id: string; createdAt: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadRecoveries() {
    const result = await services.repository.listRecovery(trip.id);
    if (result.ok) setRecoveries(result.value);
    else setError(result.error.message);
  }

  if (recoveries === null && !error) {
    void loadRecoveries();
  }

  async function handleDelete(id: string) {
    await services.repository.deleteRecovery(id);
    setRecoveries(null);
  }

  return (
    <Dialog open title="备份与恢复" onClose={onClose}>
      <h3 style={{ marginBottom: '12px' }}>覆盖前恢复副本</h3>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {recoveries && recoveries.length === 0 && (
        <p style={{ color: 'var(--color-muted)' }}>暂无恢复副本</p>
      )}
      {recoveries && recoveries.map((r) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: '14px' }}>{new Date(r.createdAt).toLocaleString('zh-CN')}</span>
          <Button variant="danger" onClick={() => void handleDelete(r.id)}>删除</Button>
        </div>
      ))}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 集中面板入口
// ---------------------------------------------------------------------------

export function SharingPanels(props: SharingPanelProps) {
  const { panel } = props;
  switch (panel.type) {
    case 'invite': return <InvitePanel {...props} panel={panel} />;
    case 'share': return <SharePanel {...props} panel={panel} />;
    case 'import': return <ImportPanel {...props} panel={panel} />;
    case 'backup': return <BackupPanel {...props} panel={panel} />;
    case 'recovery': return <RecoveryPanel {...props} panel={panel} />;
    default: return null;
  }
}
