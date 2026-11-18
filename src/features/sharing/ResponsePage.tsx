import { ExternalShell } from './ExternalShell';
import { useEffect, useState } from 'react';
import type { ExternalPageProps, Trip } from '../../contracts/services';
import type { ResponseBody } from '../../domain/sharing/types';
import { useDecodedEnvelope, useSharingApp } from './useEnvelope';
import { Button, ErrorNotice } from '../../components/ui';
import { formatMoney } from '../../domain/money';

export function ResponsePage({ data, repository, services, openImport }: ExternalPageProps) {
  const decoded = useDecodedEnvelope(data);
  const app = useSharingApp(services);
  const [message, setMessage] = useState('');
  const [local, setLocal] = useState<{ id: string; trip: Trip | null } | null>(null);
  const tripId = decoded.ok && decoded.envelope.type === 'response' ? (decoded.envelope.body as ResponseBody).tripId : null;
  useEffect(() => {
    if (!tripId) return;
    let active = true;
    void repository.get(tripId).then(result => { if (active) setLocal({ id: tripId, trip: result.ok ? result.value : null }); });
    return () => { active = false; };
  }, [repository, tripId]);
  if (!decoded.ok || decoded.envelope.type !== 'response') return <ExternalShell><h1>反馈回传</h1><ErrorNotice>{decoded.ok ? '这不是成员反馈数据' : decoded.error}</ErrorNotice><a href="#/">返回</a></ExternalShell>;
  const envelope = decoded.envelope; const body = envelope.body as ResponseBody;
  const shareUrl = app.createShareUrl('response', envelope);
  const localTrip = local?.id === tripId ? local.trip : null;
  const download = () => { const result = app.downloadEnvelope(envelope, 'feedback.json'); setMessage(result.ok ? '已请求下载文件' : result.error.message); };
  return <ExternalShell><div className="stack">
    <h1>{body.memberName}的反馈</h1>
    <dl>
      <div><dt>出发城市</dt><dd>{body.profile.originCity ?? '未填写'}</dd></div>
      <div><dt>预算上限</dt><dd>{body.profile.budgetCap === null ? '未填写' : formatMoney(body.profile.budgetCap)}</dd></div>
      <div><dt>可用日期</dt><dd>{body.profile.availability.map(range => range.start + ' 至 ' + range.end).join('、') || '未填写'}</dd></div>
      <div><dt>偏好</dt><dd>{body.profile.preferences.join('、') || '无'}</dd></div>
    </dl>
    {body.intents.map((intent, index) => {
      const plan = localTrip?.plans.find(plan => plan.id === intent.planId);
      const template = plan && services.planning.getTemplate(plan.destinationId, plan.templateVersion);
      return <p key={intent.planId}>{template?.ok ? template.value.name + ' · ' + plan!.startDate : '方案 ' + (index + 1)}：{({ approve: '赞成', acceptable: '可接受', decline: '不参加' })[intent.value]}</p>;
    })}
    <p>将链接或文件发给组织者，由对方预览后导入。</p>
    {shareUrl.ok ? <label className="field">反馈链接<textarea aria-label="反馈链接" readOnly rows={3} value={shareUrl.value} onFocus={event => event.target.select()}/></label> : <p>链接过长，请使用文件传递。</p>}
    <div className="toolbar">{shareUrl.ok ? <Button onClick={() => void app.copyShareUrl(shareUrl.value).then(result => setMessage(result.ok ? '已复制' : result.error.message))}>复制反馈链接</Button> : null}<Button variant="secondary" onClick={download}>下载反馈文件</Button></div>
    {message ? <p role="status">{message}</p> : null}
    {localTrip ? <Button onClick={() => openImport(JSON.stringify(envelope))}>预览并导入</Button> : local?.id === tripId ? <p>本设备没有原旅行，请在组织者设备导入。</p> : null}
    <a href="#/">返回工作台</a>
  </div></ExternalShell>;
}