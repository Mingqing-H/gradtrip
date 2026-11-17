// 规划域命令处理（member.* / plan.* 族，归属见并行总约定 §4.1）。
//
// 约定：
// - 输入完整 Trip + 载荷级命令 + 显式上下文（now/today/预分配 ID/依赖），
//   返回新 Trip 或结构化错误；不持久化、不读时钟、不生成随机数；
// - trip.revision / updatedAt 由 T01 仓库事务层负责，本模块不改；
// - constraintRevision / plan.version 的递增规则遵循 BR-02 / BR-07；
//   相同值重复保存不增加任何版本。

import { diffInDays, isDateInRange, isValidDateOnly, isValidRange } from './calendar';
import { getConfirmationBlockers } from './consensus';
import { ESTIMATE_CAP_CENTS, areEstimateParamsValid, findMembersOverEstimateCap } from './estimates';
import { MAX_MEMBER_COUNT, isSameProfile, memberFromProfile, applyProfileToMember, validateMemberProfileInput } from './profile';
import type { DateOnly, Id, Member, Plan, Trip } from './contract';
import type {
  DestinationInfo,
  MemberProfileInput,
  PlanningCommand,
  PlanningContext,
  PlanningDeps,
  PlanningError,
  PlanningResult,
} from './types';

/** 每旅行候选方案上限（业务规则 §1）。 */
export const MAX_PLAN_COUNT = 20;
/** 意向历史（含失效）上限。 */
export const MAX_INTENT_COUNT = 2000;
/** 搜索窗口最长 180 天（BR-03）。 */
export const MAX_SEARCH_WINDOW_DAYS = 180;

/** 命令执行上下文：外部输入全部显式注入。 */
export interface PlanningCommandContext {
  /** ISO 8601 时间戳，用于 recordedAt / confirmedAt。 */
  now: string;
  /** 操作当天（YYYY-MM-DD），用于出发日期有效性判断。 */
  today: DateOnly;
  /** 预分配 ID 生成器（幂等性由 T01 事务层保证，这里只取值）。 */
  newId: () => Id;
  /** 当前内置估算模板版本（生成候选时使用）。 */
  currentTemplateVersion: number;
  /** 目的地与交通表解析依赖。 */
  deps: PlanningDeps;
  /**
   * T03 提供的模板日程构建器，由应用层注入（总约定 §4.2）。
   * 未注入时首次确认不生成日程；该缺口由集成层如实报告，不伪造日程。
   */
  buildTemplateItinerary?: (input: { plan: Plan; trip: Trip }) => Trip['itinerary'];
}

/** 从完整 Trip 切出规划域只读上下文。 */
export function toPlanningContext(trip: Trip): PlanningContext {
  return {
    searchWindow: trip.searchWindow,
    duration: trip.duration,
    members: trip.members,
    plans: trip.plans,
    constraintRevision: trip.constraintRevision,
    intents: trip.intents,
    confirmation: trip.confirmation,
  };
}

function err(code: PlanningError['code'], message: string, details?: unknown): PlanningResult {
  return { ok: false, error: { code, message, details } };
}

/** 规划命令统一入口。 */
export function applyPlanningCommand(
  trip: Trip,
  command: PlanningCommand,
  ctx: PlanningCommandContext,
): PlanningResult {
  switch (command.type) {
    case 'member.add':
      return applyMemberAdd(trip, command.payload.profile, ctx);
    case 'member.update':
      return applyMemberUpdate(trip, command.payload.memberId, command.payload.profile);
    case 'member.remove':
      return applyMemberRemove(trip, command.payload.memberId);
    case 'plan.generate':
      return applyPlanGenerate(trip, command.payload, ctx);
    case 'plan.update':
      return applyPlanUpdate(trip, command.payload, ctx);
    case 'plan.recordIntent':
      return applyRecordIntent(trip, command.payload, ctx);
    case 'plan.confirm':
      return applyPlanConfirm(trip, command.payload.planId, ctx);
    default:
      return err('command.invalid', '未知的规划命令');
  }
}

/**
 * 约束资料更新的唯一公共入口（BR-02 / BR-14）：
 * 变更必填资料或偏好 → constraintRevision + 1（旧意向按版本自然失效，保留为历史）；
 * 相同值保存不增加版本。T04 应用成员反馈时复用本函数，不自行复制失效逻辑。
 */
export function updateMemberConstraints(
  trip: Trip,
  memberId: Id,
  profile: MemberProfileInput,
): { ok: true; trip: Trip; changed: boolean } | { ok: false; error: PlanningError } {
  const member = trip.members.find((m) => m.id === memberId);
  if (!member) {
    return { ok: false, error: { code: 'member.not-found', message: '成员不存在或已被移除' } };
  }
  const inputErrors = validateMemberProfileInput(profile);
  if (inputErrors.length > 0) {
    return {
      ok: false,
      error: { code: 'member.invalid-profile', message: '成员资料不合法', details: inputErrors },
    };
  }
  if (isSameProfile(member, profile)) {
    return { ok: true, trip, changed: false };
  }
  const updated = applyProfileToMember(member, profile);
  return {
    ok: true,
    changed: true,
    trip: {
      ...trip,
      members: trip.members.map((m) => (m.id === memberId ? updated : m)),
      constraintRevision: trip.constraintRevision + 1,
    },
  };
}

function applyMemberAdd(trip: Trip, profile: MemberProfileInput, ctx: PlanningCommandContext): PlanningResult {
  if (trip.members.length >= MAX_MEMBER_COUNT) {
    return err('member.limit-reached', `每个旅行最多 ${MAX_MEMBER_COUNT} 位成员`, { count: trip.members.length });
  }
  const inputErrors = validateMemberProfileInput(profile);
  if (inputErrors.length > 0) {
    return err('member.invalid-profile', '成员资料不合法', inputErrors);
  }
  const member: Member = memberFromProfile(ctx.newId(), profile);
  return {
    ok: true,
    trip: {
      ...trip,
      members: [...trip.members, member],
      constraintRevision: trip.constraintRevision + 1,
    },
  };
}

function applyMemberUpdate(trip: Trip, memberId: Id, profile: MemberProfileInput): PlanningResult {
  const result = updateMemberConstraints(trip, memberId, profile);
  if (!result.ok) return result;
  return { ok: true, trip: result.trip };
}

function applyMemberRemove(trip: Trip, memberId: Id): PlanningResult {
  const member = trip.members.find((m) => m.id === memberId);
  if (!member) {
    return err('member.not-found', '成员不存在或已被移除');
  }
  // 已有实际费用的垫付人/参与人、结算记录（含已撤销）的转出/转入人不可删除（BR-02）。
  const expenseIds = trip.expenses
    .filter((e) => e.payerId === memberId || e.allocations.some((a) => a.memberId === memberId))
    .map((e) => e.id);
  const settlementIds = trip.settlements
    .filter((s) => s.fromId === memberId || s.toId === memberId)
    .map((s) => s.id);
  if (expenseIds.length > 0 || settlementIds.length > 0) {
    return err('member.referenced-by-ledger', '成员已被账目或结算记录引用，不能删除', {
      expenseIds,
      settlementIds,
    });
  }
  return {
    ok: true,
    trip: {
      ...trip,
      members: trip.members.filter((m) => m.id !== memberId),
      invitations: trip.invitations.filter(invitation => invitation.memberId !== memberId),
      appliedResponses: trip.appliedResponses.filter(response => !trip.invitations.some(invitation => invitation.id === response.invitationId && invitation.memberId === memberId)),
      intents: trip.intents.filter((i) => i.memberId !== memberId),
      plans: trip.plans.map((plan) => {
        if (!(memberId in plan.estimate.transportByMember)) return plan;
        const transportByMember = { ...plan.estimate.transportByMember };
        delete transportByMember[memberId];
        return { ...plan, estimate: { ...plan.estimate, transportByMember } };
      }),
      constraintRevision: trip.constraintRevision + 1,
    },
  };
}

type PlanGeneratePayload = Extract<PlanningCommand, { type: 'plan.generate' }>['payload'];
type PlanUpdatePayload = Extract<PlanningCommand, { type: 'plan.update' }>['payload'];
type RecordIntentPayload = Extract<PlanningCommand, { type: 'plan.recordIntent' }>['payload'];

function applyPlanGenerate(trip: Trip, payload: PlanGeneratePayload, ctx: PlanningCommandContext): PlanningResult {
  if (!isValidRange(payload.searchWindow)) {
    return err('plan.invalid-window', '搜索窗口需为合法日期区间');
  }
  if (diffInDays(payload.searchWindow.end, payload.searchWindow.start) + 1 > MAX_SEARCH_WINDOW_DAYS) {
    return err('plan.invalid-window', `搜索窗口最长 ${MAX_SEARCH_WINDOW_DAYS} 天`);
  }
  if (payload.duration < 2 || payload.duration > 5) {
    return err('plan.invalid-duration', '出行时长需为 2～5 天');
  }
  if (!isValidDateOnly(payload.startDate) || !isDateInRange(payload.startDate, payload.searchWindow)) {
    return err('plan.invalid-date', '出发日期需在搜索窗口内');
  }
  const uniqueIds = [...new Set(payload.destinationIds)];
  if (uniqueIds.length === 0) {
    return err('command.invalid', '至少选择一个目的地');
  }
  if (uniqueIds.length > MAX_PLAN_COUNT) {
    return err('plan.limit-reached', `候选方案最多 ${MAX_PLAN_COUNT} 个`);
  }
  const resolved: { destinationId: Id; template: DestinationInfo }[] = [];
  const unknownIds: Id[] = [];
  for (const destinationId of uniqueIds) {
    const template = ctx.deps.resolveDestination(ctx.currentTemplateVersion, destinationId);
    if (template) resolved.push({ destinationId, template });
    else unknownIds.push(destinationId);
  }
  if (unknownIds.length > 0) {
    return err('plan.unknown-destination', '存在未知的目的地模板', { destinationIds: unknownIds });
  }

  const plans: Plan[] = resolved.map(({ destinationId, template }) => ({
    id: ctx.newId(),
    version: 1,
    destinationId,
    templateVersion: ctx.currentTemplateVersion,
    startDate: payload.startDate,
    days: payload.duration,
    estimate: {
      transportByMember: {},
      lodgingPerNight: template.estimate.lodgingPerNight,
      foodPerDay: template.estimate.foodPerDay,
      activities: template.estimate.activities,
      reserve: template.estimate.reserve,
    },
  }));

  const newPlanIds = new Set(plans.map((p) => p.id));
  return {
    ok: true,
    trip: {
      ...trip,
      searchWindow: payload.searchWindow,
      duration: payload.duration,
      plans,
      // 被替换方案的意向不再保留（其方案 ID 已不存在），保留引用完整性；
      // 存续方案的旧版本意向历史由 plan.update 的版本递增机制承担。
      intents: trip.intents.filter((i) => newPlanIds.has(i.planId)),
      constraintRevision: trip.constraintRevision + 1,
    },
  };
}

function applyPlanUpdate(trip: Trip, payload: PlanUpdatePayload, ctx: PlanningCommandContext): PlanningResult {
  const planIndex = trip.plans.findIndex((p) => p.id === payload.planId);
  if (planIndex < 0) {
    return err('plan.not-found', '方案不存在或已被替换');
  }
  const plan = trip.plans[planIndex];

  let nextStartDate = plan.startDate;
  if (payload.startDate !== undefined) {
    if (!isValidDateOnly(payload.startDate) || !isDateInRange(payload.startDate, trip.searchWindow)) {
      return err('plan.invalid-date', '出发日期需为合法日期且在搜索窗口内');
    }
    nextStartDate = payload.startDate;
  }

  let nextDestinationId = plan.destinationId;
  let estimate = plan.estimate;
  if (payload.destinationId !== undefined && payload.destinationId !== plan.destinationId) {
    const template = ctx.deps.resolveDestination(plan.templateVersion, payload.destinationId);
    if (!template) {
      return err('plan.unknown-destination', '未知的目的地模板');
    }
    nextDestinationId = payload.destinationId;
    // 换目的地：估算参数回到模板默认值，清空手工交通（绑定已不适用）。
    estimate = {
      transportByMember: {},
      lodgingPerNight: template.estimate.lodgingPerNight,
      foodPerDay: template.estimate.foodPerDay,
      activities: template.estimate.activities,
      reserve: template.estimate.reserve,
    };
  }

  const paramPatch = payload.estimate ?? {};
  const mergedParams = {
    lodgingPerNight: paramPatch.lodgingPerNight ?? estimate.lodgingPerNight,
    foodPerDay: paramPatch.foodPerDay ?? estimate.foodPerDay,
    activities: paramPatch.activities ?? estimate.activities,
    reserve: paramPatch.reserve ?? estimate.reserve,
  };
  if (!areEstimateParamsValid(mergedParams)) {
    return err('plan.invalid-estimate', '估算参数需为非负整数分');
  }

  const transportByMember = { ...estimate.transportByMember };
  if (paramPatch.transportOverride !== undefined) {
    const member = trip.members.find((m) => m.id === paramPatch.transportOverride!.memberId);
    if (!member) {
      return err('member.not-found', '手工交通估算对应的成员不存在');
    }
    if (!Number.isSafeInteger(paramPatch.transportOverride.amount) || paramPatch.transportOverride.amount < 0) {
      return err('plan.invalid-estimate', '交通估算需为非负整数分');
    }
    if (member.originCity === null) {
      return err('plan.invalid-estimate', '需先补充成员出发城市，再设置手工交通估算');
    }
    // 绑定当前城市；成员换城市后旧覆盖值失效（BR-04，读取侧同样防御）。
    transportByMember[member.id] = { originCity: member.originCity, amount: paramPatch.transportOverride.amount };
  }
  if (paramPatch.removeTransportOverride !== undefined) {
    const memberId = paramPatch.removeTransportOverride;
    if (!trip.members.some((m) => m.id === memberId)) {
      return err('member.not-found', '手工交通估算对应的成员不存在');
    }
    delete transportByMember[memberId];
  }

  const nextPlan: Plan = {
    ...plan,
    startDate: nextStartDate,
    destinationId: nextDestinationId,
    estimate: { ...mergedParams, transportByMember },
  };

  if (plansEqual(plan, nextPlan)) {
    return { ok: true, trip };
  }

  const overCap = findMembersOverEstimateCap(
    nextPlan,
    trip.members,
    ctx.deps,
  );
  if (overCap.length > 0) {
    return err('plan.estimate-over-cap', '调整后个人估算超过 ¥100,000', { memberIds: overCap, cap: ESTIMATE_CAP_CENTS });
  }

  const plans = trip.plans.map((p) => (p.id === plan.id ? { ...nextPlan, version: plan.version + 1 } : p));
  return {
    ok: true,
    trip: { ...trip, plans, constraintRevision: trip.constraintRevision + 1 },
  };
}

function plansEqual(a: Plan, b: Plan): boolean {
  return (
    a.startDate === b.startDate &&
    a.destinationId === b.destinationId &&
    a.estimate.lodgingPerNight === b.estimate.lodgingPerNight &&
    a.estimate.foodPerDay === b.estimate.foodPerDay &&
    a.estimate.activities === b.estimate.activities &&
    a.estimate.reserve === b.estimate.reserve &&
    sameTransportMaps(a.estimate.transportByMember, b.estimate.transportByMember)
  );
}

export function sameTransportMaps(
  a: Record<Id, { originCity: string; amount: number } | null>,
  b: Record<Id, { originCity: string; amount: number } | null>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key] ?? null;
    const right = b[key] ?? null;
    if (left === null || right === null) {
      if (left !== right) return false;
    } else if (left.originCity !== right.originCity || left.amount !== right.amount) {
      return false;
    }
  }
  return true;
}

function applyRecordIntent(trip: Trip, payload: RecordIntentPayload, ctx: PlanningCommandContext): PlanningResult {
  const plan = trip.plans.find((p) => p.id === payload.planId);
  if (!plan) {
    return err('plan.not-found', '方案不存在或已被替换');
  }
  if (!trip.members.some((m) => m.id === payload.memberId)) {
    return err('member.not-found', '成员不存在或已被移除');
  }
  const index = trip.intents.findIndex(
    (i) =>
      i.memberId === payload.memberId &&
      i.planId === payload.planId &&
      i.planVersion === plan.version &&
      i.constraintRevision === trip.constraintRevision,
  );
  if (index >= 0) {
    const existing = trip.intents[index];
    if (existing.value === payload.value && existing.source === payload.source) {
      return { ok: true, trip }; // 相同值重复记录不产生变化
    }
    const intents = trip.intents.map((i, n) =>
      n === index ? { ...i, value: payload.value, source: payload.source, recordedAt: ctx.now } : i,
    );
    return { ok: true, trip: { ...trip, intents } };
  }
  if (trip.intents.length >= MAX_INTENT_COUNT) {
    return err('intent.limit-reached', `意向历史最多 ${MAX_INTENT_COUNT} 条，请先导出`); // 触达上限：阻止并提示导出
  }
  const intents = [
    ...trip.intents,
    {
      memberId: payload.memberId,
      planId: payload.planId,
      planVersion: plan.version,
      constraintRevision: trip.constraintRevision,
      value: payload.value,
      source: payload.source,
      recordedAt: ctx.now,
    },
  ];
  // 意向变化不增加 constraintRevision；对已确认方案的 decline 由派生状态即时失效（BR-07）。
  return { ok: true, trip: { ...trip, intents } };
}

function applyPlanConfirm(trip: Trip, planId: Id, ctx: PlanningCommandContext): PlanningResult {
  const plan = trip.plans.find((p) => p.id === planId);
  if (!plan) {
    return err('plan.not-found', '方案不存在或已被替换');
  }
  const blockers = getConfirmationBlockers(toPlanningContext(trip), planId, ctx.today, ctx.deps);
  if (blockers.length > 0) {
    return err('consensus.blocked', '当前条件不满足全员确认', blockers);
  }
  let itinerary = trip.itinerary;
  const hasItinerary = itinerary.dateRange !== null || itinerary.activities.length > 0;
  if (!hasItinerary && ctx.buildTemplateItinerary) {
    itinerary = ctx.buildTemplateItinerary({ plan, trip });
  }
  return {
    ok: true,
    trip: {
      ...trip,
      confirmation: {
        planId: plan.id,
        planVersion: plan.version,
        constraintRevision: trip.constraintRevision,
        confirmedAt: ctx.now,
      },
      itinerary, // 已有日程默认保留；替换属于显式操作（T03 replaceFromTemplate）
    },
  };
}
