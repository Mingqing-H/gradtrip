import { useState } from 'react';
import type { ExternalPageProps } from '../../contracts/services';
import type { ResponseBody } from '../../domain/sharing/types';
import { useDecodedEnvelope, useSharingApp } from './useEnvelope';
import { Button, ErrorNotice } from '../../components/ui';
import { formatMoney } from '../../domain/money';

export function ResponsePage({ data, repository, services, openImport }: ExternalPageProps) {
  const decoded = useDecodedEnvelope(data);
  const app = useSharingApp(services);
  const [copied, setCopied] = useState(false);
  const [localTrip, setLocalTrip] = useState<boolean | null>(null);

  if (!decoded.ok) {
    return (
      <div className="external-page">
        <h1>反馈回传</h1>
        <ErrorNotice>{decoded.error}</ErrorNotice>
        <a href="#/" className="button button-secondary">返回</a>
      </div>
    );
  }

  const envelope = decoded.envelope;
  if (envelope.type !== 'response') {
    return (
      <div className="external-page">
        <h1>反馈回传</h1>
        <ErrorNotice>这不是成员反馈数据（类型：{envelope.type}）</ErrorNotice>
        <a href="#/" className="button button-secondary">返回</a>
      </div>
    );
  }

  const body = envelope.body as ResponseBody;
  const shareUrl = app.createShareUrl('response', envelope);

  async function handleCopy() {
    if (!shareUrl.ok) return;
    const result = await app.copyShareUrl(shareUrl.value);
    setCopied(result.ok);
  }

  function handleDownload() {
    app.downloadEnvelope(envelope, `feedback-${body.memberId}.json`);
  }

  async function checkLocalTrip() {
    const trip = await repository.get(body.tripId);
    setLocalTrip(trip.ok);
  }

  // 页面加载时检查本地是否有对应旅行
  if (localTrip === null) {
    void checkLocalTrip();
  }

  return (
    <div className="external-page" style={{ maxWidth: '720px' }}>
      <header style={{ marginBottom: '24px' }}>
        <h1>反馈已生成</h1>
        <p style={{ color: 'var(--color-muted)' }}>把链接或文件发给组织者，由对方导入</p>
      </header>

      <section style={{ background: 'white', border: '1px solid var(--color-border)', borderRadius: '16px', padding: '24px', marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>{body.memberName} 的反馈</h2>
        <div style={{ display: 'grid', gap: '8px', fontSize: '15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>出发城市</span><strong>{body.profile.originCity ?? '未填写'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>预算上限</span>
            <strong>{body.profile.budgetCap !== null ? formatMoney(body.profile.budgetCap) : '未填写'}</strong>
          </div>
          {body.profile.availability.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>可用日期</span>
              <strong>{body.profile.availability[0]?.start} 至 {body.profile.availability[0]?.end}</strong>
            </div>
          )}
          {body.profile.preferences.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>偏好</span><strong>{body.profile.preferences.join('、')}</strong>
            </div>
          )}
        </div>
        {body.intents.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>方案意向</h3>
            {body.intents.map((intent) => (
              <div key={intent.planId} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '14px' }}>
                <span>{intent.planId}</span>
                <strong>{intent.value === 'approve' ? '赞成' : intent.value === 'acceptable' ? '可接受' : '不参加'}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {shareUrl.ok ? (
          <Button onClick={handleCopy}>{copied ? '已复制' : '复制反馈链接'}</Button>
        ) : (
          <Button onClick={handleDownload}>下载反馈文件</Button>
        )}
        <Button variant="secondary" onClick={handleDownload}>下载文件</Button>
      </div>

      {shareUrl.ok && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--color-muted)' }}>反馈链接（可手动复制）</label>
          <textarea
            readOnly
            value={shareUrl.value}
            style={{ width: '100%', minHeight: '60px', padding: '8px', fontSize: '12px', fontFamily: 'monospace' }}
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}

      {localTrip === true && (
        <div style={{ padding: '16px', background: 'var(--color-primary-soft)', borderRadius: '8px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 8px' }}>本设备存在对应旅行，可预览并导入此反馈</p>
          <Button variant="secondary" onClick={() => openImport(JSON.stringify(envelope))}>预览并导入</Button>
        </div>
      )}
      {localTrip === false && (
        <p style={{ fontSize: '14px', color: 'var(--color-muted)' }}>
          本设备没有对应旅行。请在保存原旅行的设备上导入此反馈。
        </p>
      )}
    </div>
  );
}
