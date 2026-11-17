import { localDateOnly, isDateOnly } from '../../domain/dates';
// P02 方案工作区：筛选、候选比较、方案详情（成员适配/估算/意向/确认）。
// 所有业务查询通过 services.planning，所有写入通过 execute（扁平 CommandPayload）。
import { useMemo, useState } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import { Button, Drawer, ErrorNotice, Input, Select } from '../../components/ui';
import type { Id, WorkspaceProps } from '../../contracts/services';
import type { IntentValue, Plan } from '../../domain/types';
import { formatMoney, parseMoney } from '../../domain/money';
import { getDestinationAsset } from '../../data/assetsPlanning';
import { getDestinations, CURRENT_TEMPLATE_VERSION } from '../../data/destinations';
import styles from './plans.module.css';

type ConsensusKind = 'preparing' | 'confirmed' | 'needsReconfirm';

interface EstimateDraft {
  lodgingPerNight: string;
  foodPerDay: string;
  activities: string;
  reserve: string;
}

export function PlansPage({ trip, execute, services, openShare }: WorkspaceProps) {
  const [windowStart, setWindowStart] = useState(trip.searchWindow.start);
  const [windowEnd, setWindowEnd] = useState(trip.searchWindow.end);
  const [duration, setDuration] = useState<string>(String(trip.duration));
  const [departure, setDeparture] = useState(trip.plans[0]?.startDate ?? '');
  const [selectedPlanId, setSelectedPlanId] = useState<Id | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [intentMember, setIntentMember] = useState<Id | null>(null);
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [estimateDraft, setEstimateDraft] = useState<EstimateDraft | null>(null);

  const evaluations = useMemo(
    () => services.planning.getPlanEvaluations(trip),
    [services.planning, trip],
  );
  const evalById = useMemo(() => new Map(evaluations.map((e) => [e.planId, e])), [evaluations]);
  const sortedPlans = useMemo(() => {
    const plans = new Map(trip.plans.map(plan => [plan.id, plan]));
    return evaluations.map(evaluation => plans.get(evaluation.planId)).filter((plan): plan is Plan => !!plan);
  }, [trip.plans, evaluations]);
  const selectedPlan = trip.plans.find((p) => p.id === selectedPlanId) ?? null;
  const selectedEval = selectedPlanId ? evalById.get(selectedPlanId) : undefined;
  const consensus = selectedPlan
    ? services.planning.getConsensusStatus(trip, selectedPlan.id, localDateOnly(new Date()))
    : null;
  const statusKind: ConsensusKind = trip.confirmation
    ? (services.planning.getConsensusStatus(trip, trip.confirmation.planId, localDateOnly(new Date())).confirmed ? 'confirmed' : 'needsReconfirm')
    : 'preparing';

  const commonDates = useMemo(
    () => isDateOnly(windowStart) && isDateOnly(windowEnd) && windowStart <= windowEnd ? services.planning.findCommonDepartures(trip.members, { start: windowStart, end: windowEnd }, Number(duration)) : [],
    [services.planning, trip.members, windowStart, windowEnd, duration],
  );

  const openDetail = (planId: Id) => {
    setSelectedPlanId(planId);
    setSubmitError(''); setIntentMember(null); setEditingEstimate(false);
    const plan = trip.plans.find((p) => p.id === planId);
    if (plan) setEstimateDraft({
      lodgingPerNight: String(plan.estimate.lodgingPerNight / 100),
      foodPerDay: String(plan.estimate.foodPerDay / 100),
      activities: String(plan.estimate.activities / 100),
      reserve: String(plan.estimate.reserve / 100),
    });
  };

  const generatePlans = async () => {
    setBusy(true); setSubmitError('');
    const days = Number(duration) as Plan['days'];
    const templates = (getDestinations(CURRENT_TEMPLATE_VERSION) ?? []).filter((t) => t.supportedDurations.includes(days));
    const existingFor = (destinationId: string) => trip.plans.find(plan => plan.destinationId === destinationId && plan.id === trip.itinerary.sourcePlanId)
      ?? trip.plans.find(plan => plan.destinationId === destinationId && plan.id === trip.confirmation?.planId)
      ?? trip.plans.find(plan => plan.destinationId === destinationId);
    const plans: Plan[] = templates.map(template => ({
      id: existingFor(template.id)?.id ?? crypto.randomUUID(),
      version: (existingFor(template.id)?.version ?? 0) + 1,
      destinationId: template.id,
      templateVersion: CURRENT_TEMPLATE_VERSION,
      startDate: departure || commonDates[0] || windowStart,
      days,
      estimate: {
        transportByMember: {},
        lodgingPerNight: template.estimate.lodgingPerNight,
        foodPerDay: template.estimate.foodPerDay,
        activities: template.estimate.activities,
        reserve: template.estimate.reserve,
      },
    }));
    const result = await execute({
      type: 'plan.generate',
      searchWindow: { start: windowStart, end: windowEnd },
      duration: days,
      plans,
    });
    setBusy(false);
    if (!result.ok) { setSubmitError(result.error.message); return; }
    setSelectedPlanId(null);
  };

  const recordIntent = async (memberId: Id, value: IntentValue) => {
    if (!selectedPlan) return;
    setBusy(true); setSubmitError('');
    const result = await execute({
      type: 'plan.recordIntent', memberId, planId: selectedPlan.id, value, source: 'organizer',
    });
    setBusy(false);
    if (!result.ok) { setSubmitError(result.error.message); return; }
    setIntentMember(null);
  };

  const saveEstimate = async () => {
    if (!selectedPlan || !estimateDraft) return;
    const parse = (text: string) => {
      try { return parseMoney(text); } catch { return null; }
    };
    const values = {
      lodgingPerNight: parse(estimateDraft.lodgingPerNight),
      foodPerDay: parse(estimateDraft.foodPerDay),
      activities: parse(estimateDraft.activities),
      reserve: parse(estimateDraft.reserve),
    };
    if (Object.values(values).some((v) => v === null)) { setSubmitError('估算参数需为非负金额，最多两位小数'); return; }
    const estimate = {
      lodgingPerNight: values.lodgingPerNight as number,
      foodPerDay: values.foodPerDay as number,
      activities: values.activities as number,
      reserve: values.reserve as number,
      transportByMember: selectedPlan.estimate.transportByMember,
    };
    setBusy(true); setSubmitError('');
    const result = await execute({
      type: 'plan.update', planId: selectedPlan.id,
      changes: { estimate },
    });
    setBusy(false);
    if (!result.ok) { setSubmitError(result.error.message); return; }
    setEditingEstimate(false);
  };

  const setTransportOverride = async (memberId: Id, yuanText: string) => {
    if (!selectedPlan) return;
    let value: number | null = null;
    try { value = yuanText.trim() ? parseMoney(yuanText) : null; } catch { setSubmitError('交通估算需为非负金额，最多两位小数'); return; }
    const member = trip.members.find((m) => m.id === memberId);
    if (!member?.originCity) { setSubmitError('请先补全成员出发城市'); return; }
    setBusy(true); setSubmitError('');
    const result = await execute({
      type: 'plan.update', planId: selectedPlan.id,
      changes: { estimate: {
        lodgingPerNight: selectedPlan.estimate.lodgingPerNight,
        foodPerDay: selectedPlan.estimate.foodPerDay,
        activities: selectedPlan.estimate.activities,
        reserve: selectedPlan.estimate.reserve,
        transportByMember: { ...selectedPlan.estimate.transportByMember, [memberId]: value === null ? null : { originCity: member.originCity, amount: value } },
      } },
    });
    setBusy(false);
    if (!result.ok) setSubmitError(result.error.message);
  };

  const confirm = async () => {
    if (!selectedPlan) return;
    setBusy(true); setSubmitError('');
    const hasItinerary = trip.itinerary.dateRange !== null || trip.itinerary.activities.length > 0;
    const result = await execute({
      type: 'plan.confirm', planId: selectedPlan.id, itineraryMode: hasItinerary ? 'preserve' : 'replace',
    });
    setBusy(false);
    if (!result.ok) { setSubmitError(result.error.message); return; }
  };

  const statusText = statusKind === 'confirmed' ? '已确认' : statusKind === 'needsReconfirm' ? '待重新确认' : '筹备中';
  const statusClass = statusKind === 'confirmed' ? styles.confirmed : statusKind === 'needsReconfirm' ? styles.stale : '';

  return (
    <div className={styles.plansPage}>
      <div className="page-heading">
        <h1>方案 <span className={`${styles.statusChip} ${statusClass}`}>{statusText}</span></h1>
        <Button variant="secondary" onClick={() => selectedPlan && openShare(selectedPlan.id)} disabled={!selectedPlan}>分享方案</Button>
      </div>
      <div className={styles.filters}>
        <Input label="窗口起日" type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
        <Input label="窗口止日" type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
        <Select label="出行时长" value={duration} onChange={(e) => setDuration(e.target.value)}>
          {[2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} 天 {d - 1} 晚</option>)}
        </Select>
        <Select label="出发日期" value={departure} onChange={(e) => setDeparture(e.target.value)}>
          <option value="">自动（共同日期）</option>
          {commonDates.map((date) => <option key={date} value={date}>{date}</option>)}
        </Select>
        <div className={styles.filterActions}>
          <Button onClick={generatePlans} disabled={busy || trip.members.length === 0}><Search size={18} /> 生成方案</Button>
        </div>
      </div>
      {trip.members.length === 0 ? (
        <div className="empty-state"><p>先在“小队”添加成员，再生成候选方案。</p></div>
      ) : commonDates.length === 0 && trip.plans.length === 0 ? (
        <div className="empty-state">
          <p>当前资料没有共同出发日期。请回小队补全成员的可用日期，或放宽搜索窗口。</p>
        </div>
      ) : null}
      {submitError ? <ErrorNotice>{submitError}</ErrorNotice> : null}
      <p className={styles.destNote}>内置估算，非实时报价 · 选择日期与时长后生成候选</p>

      <div className={styles.cards}>
        {sortedPlans.map((plan) => {
          const evalItem = evalById.get(plan.id);
          const asset = getDestinationAsset(plan.destinationId);
          const template = getDestinations(plan.templateVersion)?.find((t) => t.id === plan.destinationId);
          const timePass = evalItem?.timeMatchCount ?? 0;
          const budgetPass = evalItem?.budgetMatchCount ?? 0;
          const incomplete = evalItem?.incompleteCount ?? 0;
          const min = evalItem?.minEstimate ?? null;
          const max = evalItem?.maxEstimate ?? null;
          return (
            <article className={styles.planCard} key={plan.id}>
              {asset ? <img className={styles.cardImage} src={asset.card} alt={asset.alt} loading="lazy" decoding="async" /> : null}
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}><h2>{template?.name ?? plan.destinationId}</h2><span className={styles.cardMeta}>{plan.days} 天 {plan.days - 1} 晚</span></div>
                <span className={styles.cardMeta}>{plan.startDate} 出发 · {asset?.illustrative ? '示意图' : ''}</span>
                <div className={styles.cardEstimate}>
                  {min === null ? '估算待补充' : max === null ? formatMoney(min) : min === max ? formatMoney(min) : `${formatMoney(min)}～${formatMoney(max)} / 人`}
                </div>
                <div className={styles.metrics}>
                  <span className={timePass === trip.members.length ? styles.metricOk : styles.metricConflict}>时间 {timePass}/{trip.members.length}</span>
                  <span className={budgetPass === trip.members.length ? styles.metricOk : styles.metricConflict}>预算 {budgetPass}/{trip.members.length}</span>
                  {incomplete > 0 ? <span className={styles.metricUnknown}>待补充 {incomplete}</span> : null}
                </div>
                <div className={styles.cardActions}>
                  <Button variant="secondary" onClick={() => openDetail(plan.id)}>查看方案 <ChevronRight size={16} /></Button>
                  {trip.confirmation?.planId === plan.id && statusKind === 'confirmed' ? <span className={styles.metricOk}>已确认</span> : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <Drawer open={selectedPlan !== null} title={selectedPlan ? (getDestinations(selectedPlan.templateVersion)?.find((t) => t.id === selectedPlan.destinationId)?.name ?? '方案详情') : '方案详情'}
        onClose={() => setSelectedPlanId(null)}
        footer={<>
          <Button variant="secondary" onClick={() => setSelectedPlanId(null)}>关闭</Button>
          {selectedPlan && statusKind !== 'confirmed' ? <Button onClick={confirm} disabled={busy || !consensus?.canConfirm}>{busy ? '确认中…' : '确认此方案'}</Button> : null}
        </>}>
        {selectedPlan ? (
          <div>
            {(() => {
              const asset = getDestinationAsset(selectedPlan.destinationId);
              return asset ? <img className={styles.detailImage} src={asset.detail} alt={asset.alt} /> : null;
            })()}
            <p className={styles.cardMeta}>{selectedPlan.startDate} 出发 · {selectedPlan.days} 天 · 内置估算，非实时报价</p>
            {submitError ? <ErrorNotice>{submitError}</ErrorNotice> : null}

            <section className={styles.section}>
              <h2>成员适配</h2>
              {selectedEval?.members.length ? selectedEval.members.map((memberEval) => {
                const member = trip.members.find((m) => m.id === memberEval.memberId);
                const currentIntent = trip.intents
                  .filter((i) => i.memberId === memberEval.memberId && i.planId === selectedPlan.id && i.planVersion === selectedPlan.version && i.constraintRevision === trip.constraintRevision)
                  .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
                return (
                  <div className={styles.memberFitRow} key={memberEval.memberId} role="group" aria-label={(member?.name ?? memberEval.memberId) + "方案适配"}>
                    <strong>{member?.name ?? memberEval.memberId}</strong>
                    <span>{memberEval.total === null ? '估算待补' : formatMoney(memberEval.total)}</span>
                    <span className={memberEval.budgetFits === false ? styles.metricConflict : memberEval.budgetFits === true ? styles.metricOk : styles.metricUnknown}>
                      预算{memberEval.budgetFits === null ? '待补' : memberEval.budgetFits ? '通过' : '冲突'}
                    </span>
                    <span className={styles.intentControls}>
                      {intentMember === memberEval.memberId ? (
                        <>
                          {(['approve', 'acceptable', 'decline'] as IntentValue[]).map((value) => (
                            <button key={value} className={styles.intentBtn} disabled={busy}
                              onClick={() => recordIntent(memberEval.memberId, value)}>{value === 'approve' ? '赞成' : value === 'acceptable' ? '可接受' : '不参加'}</button>
                          ))}
                          <button className={styles.intentBtn} onClick={() => setIntentMember(null)}>取消</button>
                        </>
                      ) : (
                        <button className={styles.intentBtn} onClick={() => setIntentMember(memberEval.memberId)}>
                          {currentIntent ? (currentIntent.value === 'approve' ? '赞成' : currentIntent.value === 'acceptable' ? '可接受' : '不参加') : '代录意向'}
                        </button>
                      )}
                    </span>
                  </div>
                );
              }) : <p className={styles.cardMeta}>暂无成员</p>}
            </section>

            <section className={styles.section}>
              <h2>费用估算（人均）</h2>
              {editingEstimate && estimateDraft ? (
                <div>
                  <Input label="住宿（每晚，元）" inputMode="decimal" value={estimateDraft.lodgingPerNight} onChange={(e) => setEstimateDraft({ ...estimateDraft, lodgingPerNight: e.target.value })} />
                  <Input label="餐饮（每天，元）" inputMode="decimal" value={estimateDraft.foodPerDay} onChange={(e) => setEstimateDraft({ ...estimateDraft, foodPerDay: e.target.value })} />
                  <Input label="活动总额（元）" inputMode="decimal" value={estimateDraft.activities} onChange={(e) => setEstimateDraft({ ...estimateDraft, activities: e.target.value })} />
                  <Input label="机动预算（元）" inputMode="decimal" value={estimateDraft.reserve} onChange={(e) => setEstimateDraft({ ...estimateDraft, reserve: e.target.value })} />
                  <div className={styles.cardActions}>
                    <Button onClick={saveEstimate} disabled={busy}>保存估算</Button>
                    <Button variant="secondary" onClick={() => setEditingEstimate(false)}>取消</Button>
                  </div>
                </div>
              ) : (
                <>
                  <table className={styles.estimateTable}>
                    <tbody>
                      <tr><th>住宿</th><td className={styles.num}>{formatMoney(selectedPlan.estimate.lodgingPerNight)} / 晚</td></tr>
                      <tr><th>餐饮</th><td className={styles.num}>{formatMoney(selectedPlan.estimate.foodPerDay)} / 天</td></tr>
                      <tr><th>活动</th><td className={styles.num}>{formatMoney(selectedPlan.estimate.activities)}</td></tr>
                      <tr><th>机动</th><td className={styles.num}>{formatMoney(selectedPlan.estimate.reserve)}</td></tr>
                    </tbody>
                  </table>
                  <Button variant="secondary" onClick={() => setEditingEstimate(true)}>调整估算</Button>
                </>
              )}
              <p className={styles.formHint}>交通按出发城市逐人查表；未覆盖城市需手工补入，不能按 0 元处理。</p>
              {trip.members.map((member) => {
                const currentOverride = selectedPlan.estimate.transportByMember[member.id];
                return (
                  <div className={styles.memberFitRow} key={member.id}>
                    <span>{member.name} · {member.originCity ?? '城市待补'}</span>
                    <span>{currentOverride ? formatMoney(currentOverride.amount) : '按城市查表'}</span>
                    <span />
                    {member.originCity ? <Input label="手工交通（元，留空按表）" inputMode="decimal" defaultValue=""
                      key={`${member.id}-${currentOverride?.amount ?? 'none'}`}
                      onBlur={(e) => { if (e.target.value.trim() || currentOverride) void setTransportOverride(member.id, e.target.value); }} /> : <span className={styles.metricUnknown}>城市待补充</span>}
                  </div>
                );
              })}
            </section>

            <section className={styles.section}>
              <h2>确认条件</h2>
              {consensus?.reasons.length ? (
                <ul className={styles.blockerList}>{consensus.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
              ) : <p className={styles.metricOk}>全员条件满足，可以确认。</p>}
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
