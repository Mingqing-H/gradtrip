import { createIntentLookup } from '../../domain/planning/evaluation';
import { Link } from 'react-router-dom';
import { localDateOnly, isDateOnly } from '../../domain/dates';
// P02 方案工作区：筛选、候选比较、方案详情（成员适配/估算/意向/确认）。
// 所有业务查询通过 services.planning，所有写入通过 execute（扁平 CommandPayload）。
import { useId, useMemo, useRef, useState } from 'react';
import { TriangleAlert, CalendarDays, Search, ChevronDown, ArrowRight } from 'lucide-react';
import { Button, Drawer, ErrorNotice, Input, Select, PageHeader, StatusChip, Avatar } from '../../components/ui';
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
  const filterId = useId();
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(trip.plans.length === 0);
  const [windowStart, setWindowStart] = useState(trip.searchWindow.start);
  const [windowEnd, setWindowEnd] = useState(trip.searchWindow.end);
  const [duration, setDuration] = useState<string>(String(trip.duration));
  const [departure, setDeparture] = useState(trip.plans[0]?.startDate ?? '');
  const [selectedPlanId, setSelectedPlanId] = useState<Id | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [intentMember, setIntentMember] = useState<Id | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [estimateDraft, setEstimateDraft] = useState<EstimateDraft | null>(null);

  const intentLookup = useMemo(() => createIntentLookup(trip.intents), [trip.intents]);
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
    setFiltersOpen(false);
    filterToggleRef.current?.focus();
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


  return (
    <div className={styles.plansPage}>
      <PageHeader title={<>方案 {statusKind !== 'preparing' ? <StatusChip tone={statusKind === 'confirmed' ? 'success' : 'warning'}>{statusText}</StatusChip> : null}</>} subtitle={sortedPlans.length + ' 个候选 · ' + evaluations.filter(e => e.feasible).length + ' 个全员可行'} actions={<Button onClick={generatePlans} disabled={busy || trip.members.length === 0} aria-busy={busy}><Search size={20}/>{busy ? '生成中…' : '生成方案'}</Button>}/>
      <div className={styles.filterBar}>
        <Select label="出发日期" value={departure} onChange={event => setDeparture(event.target.value)}><option value="">自动（共同日期）</option>{commonDates.map(date => <option key={date} value={date}>{date}</option>)}</Select>
        <Select label="出行时长" value={duration} onChange={event => setDuration(event.target.value)}>{[2,3,4,5].map(days => <option key={days} value={days}>{days}天{days - 1}晚</option>)}</Select>
        <button ref={filterToggleRef} className={styles.filterToggle} aria-expanded={filtersOpen} aria-controls={filterId} onClick={() => setFiltersOpen(open => !open)}><CalendarDays size={18}/>{filtersOpen ? '收起日期' : '调整日期'}<ChevronDown size={16}/></button>
        <span className={styles.destNote}>内置估算，非实时报价</span>
      </div>
      <div className={styles.filters} id={filterId} data-expanded={filtersOpen}>
        <Input label="窗口起日" type="date" value={windowStart} onChange={event => setWindowStart(event.target.value)}/>
        <Input label="窗口止日" type="date" value={windowEnd} onChange={event => setWindowEnd(event.target.value)}/>
        <span className={styles.formHint}>更改后点击“生成方案”应用</span>
      </div>
      {trip.members.length === 0 ? (
        <div className="empty-state"><p>先在“小队”添加成员，再生成候选方案。</p></div>
      ) : commonDates.length === 0 && trip.plans.length === 0 ? (
        <div className="empty-state">
          <p>当前资料没有共同出发日期。请回小队补全成员的可用日期，或放宽搜索窗口。</p>
        </div>
      ) : null}
      {submitError ? <ErrorNotice>{submitError}</ErrorNotice> : null}
      <div className={styles.comparisonHead} aria-hidden="true"><span>目的地与行程</span><span>人均费用（估算）</span><span>约束条件</span><span>意向情况</span></div>

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
          const intentCounts = { approve: 0, acceptable: 0, decline: 0, pending: 0 };
          for (const member of trip.members) intentCounts[intentLookup(member.id, plan.id, plan.version, trip.constraintRevision)?.value ?? 'pending']++;

          return (
            <article className={styles.planCard} key={plan.id} data-destination={plan.destinationId}>
              <div className={styles.imageFrame}><span className={styles.imageFallback} aria-hidden="true">{template?.name ?? plan.destinationId}</span>{asset ? <img className={styles.cardImage} src={asset.card} alt={asset.alt} width={480} height={270} loading="lazy" decoding="async" onError={event => { event.currentTarget.hidden = true; }}/> : null}{asset?.illustrative && <span className={styles.stamp}>示意图</span>}</div>
              <div className={styles.cardBody}>
                <h2>{template?.name ?? plan.destinationId}</h2>
                <span className={styles.cardMeta}>{plan.startDate.slice(5).replace('-', '.')} 出发 · {plan.days}天{plan.days - 1}晚</span>
                <div className={styles.cardEstimate}>{min === null ? '估算待补充' : max !== null && min !== max ? formatMoney(min).replace(/\.00$/, '') + ' – ' + formatMoney(max).replace(/^¥/, '').replace(/\.00$/, '') : formatMoney(min).replace(/\.00$/, '')}{min !== null ? <small>/人</small> : null}</div>
              </div>
              <div className={styles.metrics}>
                {(['时间', '预算'] as const).map((label, index) => {
                  const count = index === 0 ? timePass : budgetPass;
                  const conflict = evalItem?.members.filter(member => (index === 0 ? member.timeFits : member.budgetFits) === false).length ?? 0;
                  const tone = count === trip.members.length && trip.members.length > 0 ? 'success' : conflict > 0 ? 'danger' : 'warning';
                  return <div className={styles.fitMetric} data-tone={tone} key={label}>
                    <div className={styles.fitLabel}><span>{label} {count}/{trip.members.length}</span>{conflict > 0 ? <span className={styles.fitWarning}><TriangleAlert size={14}/>{conflict}人{index === 0 ? '日期冲突' : '超预算'}</span> : null}</div>
                    <div className={styles.fitTrack} role="progressbar" aria-label={label + '满足人数'} aria-valuemin={0} aria-valuemax={Math.max(1, trip.members.length)} aria-valuenow={count}><span style={{ width: (trip.members.length ? count / trip.members.length * 100 : 0) + '%' }}/></div>
                  </div>;
                })}
                {incomplete > 0 ? <span className={styles.metricUnknown}>{incomplete}人待补资料</span> : null}
                <ul className="sr-only" aria-label="成员适配">{evalItem?.members.map(fit => <li key={fit.memberId}>{trip.members.find(member => member.id === fit.memberId)?.name}：{fit.reasons.join('、') || '时间与预算满足'}</li>)}</ul>
              </div>
              <div className={styles.intentArea}>
                <div className={styles.intentLegend}>{intentCounts.approve > 0 ? '赞成' + intentCounts.approve + ' · ' : ''}{intentCounts.acceptable > 0 ? '可接受' + intentCounts.acceptable + ' · ' : ''}{intentCounts.decline > 0 ? '不参加' + intentCounts.decline + ' · ' : ''}待反馈{intentCounts.pending}</div>
                <Button variant="ghost" onClick={() => openDetail(plan.id)}>查看方案<ArrowRight size={18}/></Button>
                {trip.confirmation?.planId === plan.id && statusKind === 'confirmed' ? <StatusChip tone="success">已确认</StatusChip> : null}
              </div>
            </article>
          );
        })}
      </div>

      <Drawer open={selectedPlan !== null} title={selectedPlan ? (getDestinations(selectedPlan.templateVersion)?.find((t) => t.id === selectedPlan.destinationId)?.name ?? '方案详情') : '方案详情'}
        onClose={() => setSelectedPlanId(null)}
        footer={<>
          {selectedPlan ? <Button variant="ghost" onClick={() => { setSelectedPlanId(null); openShare(selectedPlan.id); }}>分享方案</Button> : null}
          <Button variant="secondary" onClick={() => setSelectedPlanId(null)}>关闭</Button>
          {selectedPlan && !consensus?.confirmed ? <Button onClick={confirm} disabled={busy || !consensus?.canConfirm}>{busy ? '确认中…' : '确认此方案'}</Button> : <Link className="button button-primary" to={'/trip/' + trip.id + '/itinerary'}>查看日程</Link>}
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
                const currentIntent = intentLookup(memberEval.memberId, selectedPlan.id, selectedPlan.version, trip.constraintRevision);
                return (
                  <div className={styles.memberFitRow} key={memberEval.memberId} role="group" aria-label={(member?.name ?? memberEval.memberId) + "方案适配"}>
                    <strong className={styles.memberName}><Avatar name={member?.name ?? ''} index={trip.members.findIndex(m => m.id === memberEval.memberId)}/>{member?.name ?? memberEval.memberId}</strong>
                    <span>{memberEval.total === null ? '估算待补' : formatMoney(memberEval.total)}<small className={styles.budgetCap}>预算上限 {member?.budgetCap === null || member?.budgetCap === undefined ? '待补充' : formatMoney(member.budgetCap)}</small></span>
                    <div className={styles.fitStates}><StatusChip tone={memberEval.timeFits === null ? 'warning' : memberEval.timeFits ? 'success' : 'danger'}>时间{memberEval.timeFits === null ? '待补' : memberEval.timeFits ? '通过' : '冲突'}</StatusChip><StatusChip tone={memberEval.budgetFits === null ? 'warning' : memberEval.budgetFits ? 'success' : 'danger'}>预算{memberEval.budgetFits === null ? '待补' : memberEval.budgetFits ? '通过' : '冲突'}</StatusChip></div>
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

            <section className={styles.section}><button className="button button-secondary" aria-expanded={templateOpen} onClick={() => setTemplateOpen(!templateOpen)}>日程模板预览<ChevronDown size={16}/></button>{templateOpen && (() => { const template = services.planning.getTemplate(selectedPlan.destinationId, selectedPlan.templateVersion); return template.ok ? <ul className={styles.templateList}>{template.value.activities.filter(a => a.dayOffset < selectedPlan.days).map(a => <li key={a.key}><span>第 {a.dayOffset + 1} 天 · {a.startTime ?? '未定时间'}</span><strong>{a.title}</strong></li>)}</ul> : <p>{template.error.message}</p>; })()}</section>
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
