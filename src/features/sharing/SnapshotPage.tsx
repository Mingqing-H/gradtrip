import { ExternalShell } from './ExternalShell';
import styles from './external.module.css';
import { useState } from 'react';
import type { ExternalPageProps } from '../../contracts/services';
import { snapshotToNewTripDraft } from '../../domain/sharing';
import type { PublicActivity, SnapshotBody } from '../../domain/sharing/types';
import { useDecodedEnvelope } from './useEnvelope';
import { Button, StatusChip } from '../../components/ui';
import { formatMoney } from '../../domain/money';

function ActivityRow({ activity }: { activity: PublicActivity }) {
  return (
    <div className={styles.activity}>
      <span className={styles.caption}>
        {activity.startTime ? `${activity.startTime}–${activity.endTime}` : '未定时间'}
      </span>
      <div>
        <strong>{activity.title}</strong>
        <span className={styles.caption}>{activity.category}</span>
        {activity.budgetBucket === 'included' && (
          <span className={styles.caption}>费用已含于方案</span>
        )}
        {activity.budgetBucket === 'activities' && activity.perPersonEstimate !== null && (
          <span className={styles.caption}>{formatMoney(activity.perPersonEstimate)}/人</span>
        )}
        {activity.budgetBucket === 'activities' && activity.perPersonEstimate === null && (
          <span className={styles.caption}>待估算</span>
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
      <ExternalShell wide>
        <h1>计划快照</h1>
        <p className="error-notice">{decoded.error}</p>
        <a href="#/" className="button button-secondary">返回旅行</a>
      </ExternalShell>
    );
  }

  const envelope = decoded.envelope;
  if (envelope.type !== 'snapshot') {
    return (
      <ExternalShell wide>
        <h1>计划快照</h1>
        <p className="error-notice">这不是计划快照数据（类型：{envelope.type}）</p>
        <a href="#/" className="button button-secondary">返回旅行</a>
      </ExternalShell>
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
        { newTripId: services.createId(), now: services.now(), idFactory: { nextId: () => services.createId() } },
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
    <ExternalShell wide>
      <header>
        <div>
          <StatusChip tone="info">只读快照</StatusChip>
          <span className={styles.caption}>生成后不会自动更新</span>
        </div>
        <h1>{body.tripName}</h1>
        <p >
          {plan.destinationName} · {plan.startDate} 起 {plan.days} 天{plan.days - 1} 晚
        </p>
        <div>
          {confirmation.status === 'confirmed' ? (
            <StatusChip tone="success">生成时已确认</StatusChip>
          ) : (
            <StatusChip tone="warning">未确认（草稿快照）</StatusChip>
          )}
        </div>
      </header>

      <section>
        <h2 className={styles.day}>公开估算总览</h2>
        <div className={styles.estimates}>
          <div className={styles.row}>
            <span>人均公共基准（不含往返交通）</span>
            <strong>{formatMoney(estimateSummary.basePerPersonCents)}</strong>
          </div>
          {itinerary && (
            <>
              <div className={styles.row}>
                <span>日程活动已知金额合计</span>
                <strong>{formatMoney(estimateSummary.itineraryActivitiesCents)}</strong>
              </div>
              {estimateSummary.itineraryUnknownCount > 0 && (
                <p className={styles.caption}>
                  还有 {estimateSummary.itineraryUnknownCount} 项活动待估算，以上不是完整预算
                </p>
              )}
              <div className={styles.row}>
                <span>日程相对方案活动分项的差额</span>
                <strong>{estimateSummary.deltaCents >= 0 ? '+' : ''}{formatMoney(estimateSummary.deltaCents)}</strong>
              </div>
            </>
          )}
          <p className={styles.caption}>
            内置估算，非实时报价。交通费用因出发城市不同而未包含。
          </p>
        </div>
      </section>

      {itinerary && byDay.size > 0 && (
        <section>
          <h2 className={styles.day}>日程安排</h2>
          {[...byDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, activities], index) => (
              <div key={date} className={styles.day}>
                <h3 className={styles.caption}>
                  Day {index + 1} · {date}
                </h3>
                {activities.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            ))}
        </section>
      )}

      <footer className={styles.footer}>
        <Button onClick={handleSaveAsNew} disabled={saving || saved}>
          {saving ? '保存中…' : saved ? '已另存' : '另存为我的旅行'}
        </Button>
        <span className={styles.caption}>
          另存后成为独立旅行，不继承原确认、意向、邀请或账本
        </span>
        {error && <p className="error-notice" >{error}</p>}
      </footer>

      <p className={styles.caption}>
        生成时间：{new Date(envelope.createdAt).toLocaleString('zh-CN')} · 此快照为生成时的只读副本
      </p>
    </ExternalShell>
  );
}
