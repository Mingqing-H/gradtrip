// 方案评估读模型：逐成员时间/预算适配、人数统计、偏好分与确定性排序（BR-05）。
// 全部为纯函数；派生结果不持久化。

import { addDays, toDayNumber } from './calendar';
import { computeEstimateBreakdown, estimateRangeOf, resolveTransportCents } from './estimates';
import { getMemberProfileStatus } from './profile';
import { getTimeState, getMergedAvailability } from './availability';
import type { Cents, DateOnly, Id, Intent, Member, Plan, Range } from './contract';
import type {
  CurrentIntentView,
  MemberPlanStatus,
  PlanEvaluation,
  PlanSortKey,
  PlanningContext,
  PlanningDeps,
} from './types';

/** 单成员单方案的完整适配（时间 + 预算 + 汇总状态）。 */
export function evaluateMemberAgainstPlan(
  member: Member,
  plan: Plan,
  deps: PlanningDeps,
): MemberPlanStatus {
  return evaluatePreparedMember(member, plan, deps, getMemberProfileStatus(member), getTimeState(member, plan.startDate, plan.days));
}

function evaluatePreparedMember(
  member: Member, plan: Plan, deps: PlanningDeps,
  profile: MemberPlanStatus['profile'], time: MemberPlanStatus['time'],
): MemberPlanStatus {
  const breakdown = computeEstimateBreakdown(plan, member, deps);
  const estimate = breakdown.total;

  let budget: MemberPlanStatus['budget'] = 'unknown';
  let overBudgetBy: Cents | null = null;
  if (member.budgetCap !== null && estimate !== null) {
    if (estimate <= member.budgetCap) {
      budget = 'pass';
    } else {
      budget = 'conflict';
      overBudgetBy = estimate - member.budgetCap;
    }
  }

  let overall: MemberPlanStatus['overall'];
  if (profile === 'complete' && time === 'pass' && budget === 'pass') {
    overall = 'pass';
  } else if (time === 'conflict' || budget === 'conflict') {
    // 至少一个已知硬约束失败 → 明确冲突；缺资料但无已知失败 → 待补充（BR-05）。
    overall = 'conflict';
  } else {
    overall = 'unknown';
  }

  return { memberId: member.id, profile, time, budget, estimate, overBudgetBy, overall };
}

/** 偏好平均分：有偏好成员按 交集标签数/该成员偏好数 计分再平均；
 *  无偏好成员不参与；全部无偏好时为 0（BR-05）。 */
export function computePreferenceScore(
  members: readonly Member[],
  destinationTags: readonly string[],
): number {
  const memberPrefs = members.filter((m) => (m.preferences ?? []).length > 0);
  if (memberPrefs.length === 0) return 0;
  const tags = new Set(destinationTags);
  let sum = 0;
  for (const member of memberPrefs) {
    const own = member.preferences ?? [];
    const hit = own.filter((tag) => tags.has(tag)).length;
    sum += hit / own.length;
  }
  return sum / memberPrefs.length;
}

/** 是否为绑定当前方案版本与约束版本的“当前意向”。 */
export function isCurrentIntent(
  intent: Intent,
  planVersion: number,
  constraintRevision: number,
): boolean {
  return intent.planVersion === planVersion && intent.constraintRevision === constraintRevision;
}

/** 当前意向视图（最新一条；异常重复时取 recordedAt 最大者，稳定排序）。 */
export function getCurrentIntent(
  intents: readonly Intent[],
  memberId: Id,
  planId: Id,
  planVersion: number,
  constraintRevision: number,
): CurrentIntentView | undefined {
  let latest: Intent | undefined;
  for (const intent of intents) {
    if (intent.memberId === memberId && intent.planId === planId && isCurrentIntent(intent, planVersion, constraintRevision)
      && (!latest || intent.recordedAt >= latest.recordedAt)) latest = intent;
  }
  return latest ? { value: latest.value, source: latest.source, recordedAt: latest.recordedAt } : undefined;
}

/**
 * 全部候选方案的评估结果，按 BR-05 排序元组升序返回。
 * deps 注入目的地标签与交通表解析；排序完全确定，相同输入结果稳定。
 */
export function getPlanEvaluations(context: PlanningContext, deps: PlanningDeps): PlanEvaluation[] {
  const sortedMembers = [...context.members].sort(compareMemberId);
  const lookup = createIntentLookup(context.intents ?? []);
  // Availability/profile depend only on the member. Prepare them once per query, not once per candidate.
  const prepared = sortedMembers.map(member => ({ member, profile: getMemberProfileStatus(member),
    ranges: getMergedAvailability(member).map(range => ({ start: toDayNumber(range.start), end: toDayNumber(range.end) })) }));
  return context.plans
    .map((plan) => evaluatePlan(plan, sortedMembers, context, deps, lookup, prepared))
    .sort((a, b) => comparePlanEvaluation(a.sortKey, b.sortKey));
}

function evaluatePlan(
  plan: Plan,
  sortedMembers: readonly Member[],
  context: PlanningContext,
  deps: PlanningDeps,
  lookup: ReturnType<typeof createIntentLookup>,
  prepared: readonly { member: Member; profile: MemberPlanStatus['profile']; ranges: { start: number; end: number }[] }[],
): PlanEvaluation {
  const travelRange: Range = { start: plan.startDate, end: addDays(plan.startDate, plan.days - 1) };
  const startDay = toDayNumber(plan.startDate);
  const endDay = startDay + plan.days - 1;
  const memberStatuses = prepared.map(({ member, profile, ranges }) => evaluatePreparedMember(member, plan, deps, profile,
    ranges.length === 0 ? 'unknown' : ranges.some(range => range.start <= startDay && range.end >= endDay) ? 'pass' : 'conflict'));

  const conflictMembers = memberStatuses.filter((s) => s.overall === 'conflict').map((s) => s.memberId);
  const unknownMembers = memberStatuses.filter((s) => s.overall === 'unknown').map((s) => s.memberId);
  const unknownEstimateMembers = memberStatuses.filter((s) => s.estimate === null).map((s) => s.memberId);
  const totals = memberStatuses.map((s) => s.estimate);
  const estimateRange = estimateRangeOf(totals);
  const estimateComplete = memberStatuses.length > 0 && unknownEstimateMembers.length === 0;
  const totalEstimate = estimateComplete
    ? totals.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;

  const destination = deps.resolveDestination(plan.templateVersion, plan.destinationId);
  const preferenceScore = computePreferenceScore(sortedMembers, destination?.tags ?? []);

  const intents = summarizeIntents(context, plan, lookup);

  const allHardPass =
    memberStatuses.length > 0 &&
    memberStatuses.every((s) => s.overall === 'pass');

  const sortKey: PlanSortKey = [
    allHardPass ? 0 : 1,
    conflictMembers.length,
    unknownMembers.length,
    -preferenceScore,
    totalEstimate ?? Number.POSITIVE_INFINITY,
    toDayNumber(plan.startDate),
    plan.id,
  ];

  return {
    planId: plan.id,
    planVersion: plan.version,
    destinationId: plan.destinationId,
    startDate: plan.startDate,
    days: plan.days,
    travelRange,
    members: memberStatuses,
    counts: {
      total: memberStatuses.length,
      timePass: memberStatuses.filter((s) => s.time === 'pass').length,
      budgetPass: memberStatuses.filter((s) => s.budget === 'pass').length,
      hardPass: memberStatuses.filter((s) => s.overall === 'pass').length,
      conflictMembers,
      unknownMembers,
      unknownEstimateMembers,
    },
    estimateRange,
    estimateComplete,
    totalEstimate,
    preferenceScore,
    allHardPass,
    intents,
    sortKey,
  };
}

function summarizeIntents(
  context: PlanningContext,
  plan: Plan,
  lookup: ReturnType<typeof createIntentLookup>,
): PlanEvaluation['intents'] {
  const byMember: Record<Id, CurrentIntentView | undefined> = {};
  let approve = 0;
  let acceptable = 0;
  let decline = 0;
  let pending = 0;
  for (const member of context.members) {
    const view = lookup(
      member.id,
      plan.id,
      plan.version,
      context.constraintRevision,
    );
    byMember[member.id] = view;
    if (!view) pending += 1;
    else if (view.value === 'approve') approve += 1;
    else if (view.value === 'acceptable') acceptable += 1;
    else decline += 1;
  }
  return { approve, acceptable, decline, pending, byMember };
}

function compareMemberId(a: Member, b: Member): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function comparePlanEvaluation(a: PlanSortKey, b: PlanSortKey): number {
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

/** 供 T04 邀请端使用：不需要完整 Trip，仅凭共用估算参数与目标成员自身资料求适配。 */
export interface InviteePlanInput {
  planId: Id;
  planVersion: number;
  destinationId: Id;
  startDate: DateOnly;
  days: Plan['days'];
  templateVersion: number;
  estimate: {
    lodgingPerNight: Cents;
    foodPerDay: Cents;
    activities: Cents;
    reserve: Cents;
    /** 邀请可选附带的目标成员专属手工交通（须与填写城市一致才生效）。 */
    ownTransportOverride?: { originCity: string; amount: Cents } | null;
  };
}

export interface InviteeEvaluation {
  planId: Id;
  planVersion: number;
  /** 个人估算；交通未知为 null（不伪造总额）。 */
  estimate: Cents | null;
  transportSource: 'override' | 'table' | 'unknown';
  time: 'pass' | 'conflict' | 'unknown';
  budget: 'pass' | 'conflict' | 'unknown';
  overall: 'pass' | 'conflict' | 'unknown';
}

/** 目标成员对各候选的个人适配：成员资料来自填写页输入，不依赖其他成员信息。 */
export function evaluateInviteePlans(
  plans: readonly InviteePlanInput[],
  member: {
    originCity: string | null;
    budgetCap: Cents | null;
    availability: Range[];
  },
  deps: PlanningDeps,
): InviteeEvaluation[] {
  const pseudoMember: Member = {
    id: 'invitee',
    name: 'invitee',
    originCity: member.originCity,
    budgetCap: member.budgetCap,
    availability: member.availability ?? [],
    preferences: [],
  };
  return plans.map((input) => {
    const planLike: Plan = {
      id: input.planId,
      version: input.planVersion,
      destinationId: input.destinationId,
      templateVersion: input.templateVersion,
      startDate: input.startDate,
      days: input.days,
      estimate: {
        transportByMember: input.estimate.ownTransportOverride
          ? { [pseudoMember.id]: input.estimate.ownTransportOverride }
          : {},
        lodgingPerNight: input.estimate.lodgingPerNight,
        foodPerDay: input.estimate.foodPerDay,
        activities: input.estimate.activities,
        reserve: input.estimate.reserve,
      },
    };
    const status = evaluateMemberAgainstPlan(pseudoMember, planLike, deps);
    const transport = resolveTransportCents(planLike, pseudoMember, deps);
    return {
      planId: input.planId,
      planVersion: input.planVersion,
      estimate: status.estimate,
      transportSource: transport.source,
      time: status.time,
      budget: status.budget,
      overall: status.overall,
    };
  });
}

/** Query-scoped index: no retained mutable cache, and no repeated history scans per member/plan. */
export function createIntentLookup(intents: readonly Intent[], current?: { planId: Id; planVersion: number; constraintRevision: number }) {
  const index = new Map<string, Intent>();
  const key = (memberId: Id, planId: Id, planVersion: number, revision: number) => [memberId, planId, planVersion, revision].join('|');
  for (const intent of intents) {
    if (current && (intent.planId !== current.planId || !isCurrentIntent(intent, current.planVersion, current.constraintRevision))) continue;
    const binding = key(intent.memberId, intent.planId, intent.planVersion, intent.constraintRevision);
    const prior = index.get(binding);
    if (!prior || intent.recordedAt >= prior.recordedAt) index.set(binding, intent);
  }
  return (memberId: Id, planId: Id, planVersion: number, revision: number): CurrentIntentView | undefined => {
    const intent = index.get(key(memberId, planId, planVersion, revision));
    return intent ? { value: intent.value, source: intent.source, recordedAt: intent.recordedAt } : undefined;
  };
}