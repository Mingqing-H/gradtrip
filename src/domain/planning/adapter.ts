// B0 契约适配层：把规划域纯函数包装成 T01 约定的统一签名。
// - 内部领域函数保持纯粹（commands.ts 用嵌套 payload + 显式 ctx，便于测试）；
// - 本文件只做签名适配：B0 用扁平 CommandPayload + CommandContext + Result<Trip>；
// - 不读写存储或时钟（now/today/ids 全部来自 CommandContext）。

import type {
  CommandContext,
  CommandPayload,
  PlanningCommand as B0PlanningCommand,
} from '../../domain/commands';
import type { Trip, Id, Member, Plan } from '../../domain/types';
import type { BusinessError } from '../../contracts/result';
import { failure, success, type Result } from '../../contracts/result';
import type {
  CommandHandler,
  PlanningService,
  DestinationTemplate,
  TemplateActivity,
  MemberPlanEvaluation,
  ConsensusStatus as ServiceConsensusStatus,
} from '../../contracts/services';
import {
  applyPlanningCommand as applyInternal,
  toPlanningContext,
  updateMemberConstraints as updateInternal,
  type PlanningCommandContext,
} from './commands';
import type { PlanningCommand as InternalCommand, MemberProfileInput } from './types';
import { validatePlanningTrip as validateInternal } from './validation';
import { getPlanEvaluations, evaluateMemberAgainstPlan } from './evaluation';
import { getConsensusStatus, getConfirmationBlockers } from './consensus';
import { findCommonDepartures as findCommonInternal } from './availability';
import { planningDataDeps, getDestination, CURRENT_TEMPLATE_VERSION } from '../../data/destinations';

function isPlanningPayload(payload: CommandPayload): payload is B0PlanningCommand {
  return payload.type.startsWith('member.') || payload.type.startsWith('plan.');
}

/** 由 Partial<Member> changes 与当前成员合并出完整约束资料。 */
function mergeProfile(current: Member, changes: Partial<Omit<Member, 'id'>>): MemberProfileInput {
  return {
    name: changes.name ?? current.name,
    originCity: has(changes, 'originCity') ? (changes.originCity as string | null) : current.originCity,
    budgetCap: has(changes, 'budgetCap') ? (changes.budgetCap as number | null) : current.budgetCap,
    availability: changes.availability ?? current.availability,
    preferences: changes.preferences ?? current.preferences,
  };
}

function has(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function firstTransportOverride(
  map: Plan['estimate']['transportByMember'],
): { memberId: Id; amount: number } | undefined {
  for (const [memberId, value] of Object.entries(map)) {
    if (value) return { memberId, amount: value.amount };
  }
  return undefined;
}

function toInternalCommand(trip: Trip, payload: B0PlanningCommand): InternalCommand | null {
  switch (payload.type) {
    case 'member.add':
      return null; // handler 直接使用 payload.member 的形状
    case 'member.update': {
      const current = trip.members.find((m) => m.id === payload.memberId);
      if (!current) return null; // handler 中已排除不存在成员
      return {
        type: 'member.update',
        payload: { memberId: payload.memberId, profile: mergeProfile(current, payload.changes) },
      };
    }
    case 'member.remove':
      return { type: 'member.remove', payload: { memberId: payload.memberId } };
    case 'plan.generate': {
      return {
        type: 'plan.generate',
        payload: {
          searchWindow: payload.searchWindow,
          duration: payload.duration,
          startDate: payload.plans[0]?.startDate ?? payload.searchWindow.start,
          destinationIds: payload.plans.map((p) => p.destinationId),
        },
      };
    }
    case 'plan.update': {
      const changes = payload.changes;
      const estimate = changes.estimate;
      return {
        type: 'plan.update',
        payload: {
          planId: payload.planId,
          ...(changes.startDate !== undefined ? { startDate: changes.startDate } : {}),
          ...(estimate
            ? {
                estimate: {
                  ...(estimate.lodgingPerNight !== undefined ? { lodgingPerNight: estimate.lodgingPerNight } : {}),
                  ...(estimate.foodPerDay !== undefined ? { foodPerDay: estimate.foodPerDay } : {}),
                  ...(estimate.activities !== undefined ? { activities: estimate.activities } : {}),
                  ...(estimate.reserve !== undefined ? { reserve: estimate.reserve } : {}),
                  ...(estimate.transportByMember !== undefined
                    ? { transportOverride: firstTransportOverride(estimate.transportByMember) }
                    : {}),
                },
              }
            : {}),
        },
      };
    }
    case 'plan.recordIntent':
      return {
        type: 'plan.recordIntent',
        payload: {
          planId: payload.planId,
          memberId: payload.memberId,
          value: payload.value,
          source: payload.source,
        },
      };
    case 'plan.confirm':
      return { type: 'plan.confirm', payload: { planId: payload.planId } };
    default:
      return null;
  }
}

function toInternalContext(context: CommandContext): PlanningCommandContext {
  return {
    now: context.now,
    today: context.today,
    newId: () => context.ids[0] ?? 'id',
    currentTemplateVersion: CURRENT_TEMPLATE_VERSION,
    deps: planningDataDeps,
  };
}

function mapErrorCode(code: string): BusinessError['code'] {
  switch (code) {
    case 'member.not-found':
    case 'plan.not-found':
    case 'intent.not-found':
      return 'NOT_FOUND';
    case 'member.limit-reached':
    case 'plan.limit-reached':
    case 'intent.limit-reached':
      return 'CAPACITY';
    case 'consensus.blocked':
    case 'member.referenced-by-ledger':
      return 'LOCKED';
    default:
      return 'VALIDATION';
  }
}

function fieldsOf(details: unknown): Record<string, string> | undefined {
  if (!details) return undefined;
  if (Array.isArray(details)) {
    const fields: Record<string, string> = {};
    for (const item of details) {
      if (item && typeof item === 'object' && 'field' in item && 'message' in item) {
        fields[String((item as { field: unknown }).field)] = String((item as { message: unknown }).message);
      }
    }
    return Object.keys(fields).length > 0 ? fields : undefined;
  }
  return undefined;
}

function toResult(result: { ok: true; trip: Trip } | { ok: false; error: { code: string; message: string; details?: unknown } }): Result<Trip> {
  if (result.ok) return success(result.trip);
  return failure(mapErrorCode(result.error.code), result.error.message, fieldsOf(result.error.details));
}

/** 规划命令 handler（B0 签名）。 */
export const applyPlanningCommand: CommandHandler = (trip, payload, context) => {
  if (!isPlanningPayload(payload)) {
    return failure('VALIDATION', '不是规划域命令');
  }
  if (payload.type === 'member.add') {
    // B0 规定 ID 由上层预分配，直接采用 payload.member（不再内部生成）。
    if (trip.members.length >= 20) return failure('CAPACITY', '每个旅行最多 20 位成员');
    if (trip.members.some((m) => m.id === payload.member.id)) {
      return failure('VALIDATION', '成员 ID 重复');
    }
    return success({
      ...trip,
      members: [...trip.members, { ...payload.member }],
      constraintRevision: trip.constraintRevision + 1,
    });
  }
  if (payload.type === 'plan.generate') {
    // B0 的上层已生成完整候选（含预分配 ID）并递增版本；这里按传入候选采用，
    // 不再用内部生成器重复生成，避免 ID 不一致或重复递增 constraintRevision。
    if (payload.plans.length < 1 || payload.plans.length > 20) {
      return failure('VALIDATION', '候选方案数量需在 1～20 之间');
    }
    return success({
      ...trip,
      searchWindow: payload.searchWindow,
      duration: payload.duration,
      plans: payload.plans.map((p) => ({ ...p })),
      intents: [],
      constraintRevision: trip.constraintRevision + 1,
    });
  }
  const internal = toInternalCommand(trip, payload);
  if (!internal) return failure('NOT_IMPLEMENTED', '该规划命令尚未实现');
  return toResult(applyInternal(trip, internal, toInternalContext(context)));
};

/** B0 校验器：返回 BusinessError[]（空数组表示通过）。 */
export function validatePlanningTripB0(trip: Trip): BusinessError[] {
  const issues = validateInternal(trip, planningDataDeps);
  return issues.map((issue) => ({
    code: 'VALIDATION' as const,
    message: `${issue.path}: ${issue.message}`,
    fields: { [issue.path]: issue.message },
  }));
}

function toDestinationTemplate(version: number, destinationId: Id): DestinationTemplate | null {
  const template = getDestination(version, destinationId);
  if (!template) return null;
  const activities: TemplateActivity[] = template.activitySeeds.map((seed) => ({
    key: `${template.id}-d${seed.day}-${seed.title}`,
    dayOffset: seed.day - 1,
    title: seed.title,
    category: seed.category,
    startTime: null,
    endTime: null,
    budgetBucket: seed.budgetBucket,
    perPersonEstimate: seed.perPersonEstimate,
    note: '',
  }));
  return {
    id: template.id,
    version,
    name: template.name,
    tags: template.tags,
    supportedDays: template.supportedDurations,
    estimate: template.estimate,
    activities,
    assetId: template.assetId ?? '',
  };
}

function toMemberEvaluation(memberId: Id, status: ReturnType<typeof evaluateMemberAgainstPlan>): MemberPlanEvaluation {
  return {
    memberId,
    total: status.estimate,
    timeFits: status.time === 'unknown' ? null : status.time === 'pass',
    budgetFits: status.budget === 'unknown' ? null : status.budget === 'pass',
    reasons: [
      ...(status.profile === 'incomplete' ? ['资料待补充'] : []),
      ...(status.time === 'conflict' ? ['时间不在可用范围内'] : []),
      ...(status.budget === 'conflict' ? [`超出预算 ${status.overBudgetBy ?? 0} 分`] : []),
      ...(status.estimate === null ? ['交通估算待补充'] : []),
    ],
  };
}

/** B0 PlanningService 完整实现：所有查询供 T01/T03/T04 通过依赖注入使用。 */
export const planningService: PlanningService = {
  getPlanEvaluations(trip) {
    return getPlanEvaluations(toPlanningContext(trip), planningDataDeps).map((evaluation) => ({
      planId: evaluation.planId,
      members: evaluation.members.map((m) => toMemberEvaluation(m.memberId, m)),
      feasible: evaluation.allHardPass,
      timeMatchCount: evaluation.counts.timePass,
      budgetMatchCount: evaluation.counts.budgetPass,
      incompleteCount: evaluation.counts.unknownMembers.length,
      minEstimate: evaluation.estimateRange?.min ?? null,
      maxEstimate: evaluation.estimateRange?.max ?? null,
    }));
  },

  getConsensusStatus(trip, planId, today): ServiceConsensusStatus {
    const status = getConsensusStatus(toPlanningContext(trip), planningDataDeps);
    const reasons: string[] = [];
    if (status.reason) reasons.push(status.reason.message);
    const plan = trip.plans.find((p) => p.id === planId);
    if (plan) {
      for (const blocker of getConfirmationBlockers(toPlanningContext(trip), planId, today, planningDataDeps)) {
        if ('message' in blocker) reasons.push(blocker.message);
      }
    }
    return {
      canConfirm: reasons.length === 0,
      confirmed: status.status === 'confirmed' && plan?.id === trip.confirmation?.planId,
      reasons: [...new Set(reasons)],
    };
  },

  findCommonDepartures(members, window, days) {
    return findCommonInternal(members, window, days).dates;
  },

  updateMemberConstraints(trip, memberId, changes): Result<Trip> {
    const current = trip.members.find((m) => m.id === memberId);
    if (!current) return failure('NOT_FOUND', '成员不存在或已被移除');
    return toResult(updateInternal(trip, memberId, mergeProfile(current, changes)));
  },

  evaluatePersonalPlan({ member, plan }) {
    return toMemberEvaluation(member.id, evaluateMemberAgainstPlan(member, plan, planningDataDeps));
  },

  getTemplate(destinationId, version): Result<DestinationTemplate> {
    const template = toDestinationTemplate(version, destinationId);
    if (!template) return failure('NOT_FOUND', '未知的目的地模板版本或 ID');
    return success(template);
  },
};
