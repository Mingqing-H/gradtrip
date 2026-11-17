import { useState } from 'react';
import type { ExternalPageProps } from '../../contracts/services';
import { snapshotToNewTripDraft } from '../../domain/sharing';
import type { PublicActivity, SnapshotBody } from '../../domain/sharing/types';
import { useDecodedEnvelope } from './useEnvelope';
import { Button } from '../../components/ui';
import { formatMoney } from '../../domain/money';

function ActivityRow({ activity }: { activity: PublicActivity }) {
  return (
    <div style={{ display: 'flex', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
      <span style={{ minWidth: '100px', color: 'var(--color-muted)', fontSize: '14px' }}>
        {activity.startTime ? `${activity.startTime}–${activity.endTime}` : '未定时间'}
      </span>
      <div>
        <strong>{activity.title}</strong>
        <span style={{ marginLeft: '8px', color: 'var(--color-muted)', fontSize: '14px' }}>{activity.category}</span>
        {activity.budgetBucket === 'included' && (
          <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--color-success)' }}>费用已含于方案</span>
        )}
        {activity.budgetBucket === 'activities' && activity.perPersonEstimate !== null && (
          <span style={{ marginLeft: '8px', fontSize: '13px' }}>{formatMoney(activity.perPersonEstimate)}/人</span>
        )}
        {activity.budgetBucket === 'activities' && activity.perPersonEstimate === null && (
          <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--color-warning)' }}>待估算</span>
        )}
      </div>
    </div>
  );
}

export function SnapshotPage({ data, repository, services }: ExternalPageProps) {
  const decoded = useDecodedEnvelope(data);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!decoded.ok) {
    return (
      <div className="external-page">
        <h1>计划快照</h1>
        <p className="error-notice">{decoded.error}</p>
        <a href="#/" className="button button-secondary">返回旅行</a>
      </div>
    );
  }

  const envelope = decoded.envelope;
  if (envelope.type !== 'snapshot') {
    return (
      <div className="external-page">
        <h1>计划快照</h1>
        <p className="error-notice">这不是计划快照数据（类型：{envelope.type}）</p>
        <a href="#/" className="button button-secondary">返回旅行</a>
      </div>
    );
  }

  const body = envelope.body as SnapshotBody;
  const { plan, confirmation, estimateSummary, itinerary } = body;

  async function handleSaveAsNew() {
    setSaving(true);
    setError(null);
    try {
      const draft = snapshotToNewTripDraft(
        { ...envelope, body } as Parameters<typeof snapshotToNewTripDraft>[0],
        { newTripId: services.createId(), now: services.now(), idFactory: { nextId: (kind, oldId) => `${services.createId()}_${kind}_${oldId}` } },
      );
      if (!draft.ok) { setError(draft.error.message); return; }
      const created = await repository.create(draft.value);
      if (!created.ok) { setError(created.error.message); return; }
      setSaved(true);
      // 导航到新旅行
      window.location.hash = `#/trip/${created.value.id}/squad`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  // 按天分组日程
  const byDay = new Map<string, PublicActivity[]>();
  if (itinerary) {
    for (const activity of itinerary.activities) {
      const list = byDay.get(activity.date) ?? [];
      list.push(activity);
      byDay.set(activity.date, list);
    }
  }

  return (
    <div className="external-page">
      <header style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--color-muted)', background: 'var(--color-primary-soft)', padding: '2px 8px', borderRadius: '4px' }}>只读快照</span>
          <span style={{ fontSize: '13px', color: 'var(--color-muted)' }}>生成后不会自动更新</span>
        </div>
        <h1>{body.tripName}</h1>
        <p style={{ color: 'var(--color-muted)', margin: '8px 0 0' }}>
          {plan.destinationName} · {plan.startDate} 起 {plan.days} 天{plan.days - 1} 晚
        </p>
        <div style={{ marginTop: '8px' }}>
          {confirmation.status === 'confirmed' ? (
            <span style={{ color: 'var(--color-success)', fontSize: '14px' }}>✓ 生成时已确认</span>
          ) : (
            <span style={{ color: 'var(--color-warning)', fontSize: '14px' }}>未确认（草稿快照）</span>
          )}
        </div>
      </header>

      <section style={{ background: 'white', border: '1px solid var(--color-border)', borderRadius: '16px', padding: '24px', marginBottom: '24px' }}>
        <h2 style={{ marginBottom: '16px' }}>公开估算总览</h2>
        <div style={{ display: 'grid', gap: '8px', fontSize: '15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>人均公共基准（不含往返交通）</span>
            <strong>{formatMoney(estimateSummary.basePerPersonCents)}</strong>
          </div>
          {itinerary && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>日程活动已知金额合计</span>
                <strong>{formatMoney(estimateSummary.itineraryActivitiesCents)}</strong>
              </div>
              {estimateSummary.itineraryUnknownCount > 0 && (
                <p style={{ color: 'var(--color-warning)', fontSize: '14px', margin: 0 }}>
                  还有 {estimateSummary.itineraryUnknownCount} 项活动待估算，以上不是完整预算
                </p>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', color: estimateSummary.deltaCents !== 0 ? 'var(--color-warning)' : 'inherit' }}>
                <span>日程相对方案活动分项的差额</span>
                <strong>{estimateSummary.deltaCents >= 0 ? '+' : ''}{formatMoney(estimateSummary.deltaCents)}</strong>
              </div>
            </>
          )}
          <p style={{ fontSize: '13px', color: 'var(--color-muted)', margin: '8px 0 0' }}>
            内置估算，非实时报价。交通费用因出发城市不同而未包含。
          </p>
        </div>
      </section>

      {itinerary && byDay.size > 0 && (
        <section style={{ background: 'white', border: '1px solid var(--color-border)', borderRadius: '16px', padding: '24px', marginBottom: '24px' }}>
          <h2 style={{ marginBottom: '16px' }}>日程安排</h2>
          {[...byDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, activities], index) => (
              <div key={date} style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', marginBottom: '8px', color: 'var(--color-muted)' }}>
                  Day {index + 1} · {date}
                </h3>
                {activities.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            ))}
        </section>
      )}

      <footer style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <Button onClick={handleSaveAsNew} disabled={saving || saved}>
          {saving ? '保存中…' : saved ? '已另存' : '另存为我的旅行'}
        </Button>
        <span style={{ fontSize: '13px', color: 'var(--color-muted)' }}>
          另存后成为独立旅行，不继承原确认、意向、邀请或账本
        </span>
        {error && <p className="error-notice" style={{ width: '100%' }}>{error}</p>}
      </footer>

      <p style={{ fontSize: '13px', color: 'var(--color-muted)', marginTop: '16px' }}>
        生成时间：{new Date(envelope.createdAt).toLocaleString('zh-CN')} · 此快照为生成时的只读副本
      </p>
    </div>
  );
}
