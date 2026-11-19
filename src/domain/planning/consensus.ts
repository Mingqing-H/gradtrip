// 意向有效性与确认条件（BR-06 / BR-07）。
// - 意向绑定 memberId + planId + planVersion + constraintRevision；
// - 确认要求：≥2 位成员、资料完整、候选费用完整、日期有效（不早于操作当天）、
//   全员硬约束通过、全员当前意向为赞成或可接受；
// - 派生状态只有 筹备中 / 已确认 / 待重新确认，按数据求值，不允许直接写入。

import { compareDateOnly } from './calendar';
import { evaluateMembersAgainstPlan, getCurrentIntent, createIntentLookup } from './evaluation';
import { getMissingProfileFields } from './profile';
import type { DateOnly, Id, Intent, Member, Plan, Trip } from './contract';
import type { ConfirmationBlocker, ConsensusStatus, PlanningContext, PlanningDeps } from './types';

/** 确认要求的最低成员数（BR-07）。 */
export const MIN_MEMBERS_TO_CONFIRM = 2;

/**
 * 汇总确认某方案的全部阻止项；空数组表示可以确认。
 * today 为操作当天（YYYY-MM-DD），显式传入，不读系统时钟。
 */
export function getConfirmationBlockers(
  context: PlanningContext,
  planId: Id,
  today: DateOnly,
  deps: PlanningDeps,
): ConfirmationBlocker[] {
  const plan = context.plans.find((p) => p.id === planId);
  if (!plan) {
    return [{ kind: 'date-invalid', message: '方案不存在或已被替换' }];
  }
  const blockers: ConfirmationBlocker[] = [];
  const lookup = createIntentLookup(context.intents ?? [], { planId: plan.id, planVersion: plan.version, constraintRevision: context.constraintRevision });
  const members = [...context.members].sort((a, b) => (a.id < b.id ? -1 : 1));

  if (members.length < MIN_MEMBERS_TO_CONFIRM) {
    blockers.push({ kind: 'too-few-members', message: `确认至少需要 ${MIN_MEMBERS_TO_CONFIRM} 位成员` });
    return blockers;
  }

  if (compareDateOnly(plan.startDate, today) < 0) {
    blockers.push({ kind: 'date-invalid', message: '出发日期不得早于操作当天' });
  }

  const memberStatuses = evaluateMembersAgainstPlan(members, plan, deps);
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const status = memberStatuses[index];
    if (status.profile === 'incomplete') {
      const missing = getMissingProfileFields(member);
      blockers.push({
        kind: 'member-incomplete',
        memberId: member.id,
        missingFields: missing,
        message: '成员资料待补充',
      });
      continue;
    }
    if (status.estimate === null) {
      blockers.push({
        kind: 'estimate-unknown',
        memberId: member.id,
        message: '交通估算待补充，不能按 0 元确认',
      });
    }
    if (status.time === 'conflict') {
      blockers.push({ kind: 'time-conflict', memberId: member.id, message: '出行日期不在成员可用范围内' });
    }
    if (status.budget === 'conflict' && status.overBudgetBy !== null) {
      blockers.push({
        kind: 'budget-conflict',
        memberId: member.id,
        overBy: status.overBudgetBy,
        message: '个人估算超出预算上限',
      });
    }
  }

  for (const member of members) {
    const intent = lookup(
      member.id,
      plan.id,
      plan.version,
      context.constraintRevision,
    );
    if (!intent) {
      blockers.push({ kind: 'intent-missing', memberId: member.id, message: '成员尚未反馈意向' });
    } else if (intent.value === 'decline') {
      blockers.push({ kind: 'intent-declined', memberId: member.id, message: '成员已选择不参加' });
    }
  }

  return blockers;
}

/** 是否满足全部确认条件（阻止项为空）。 */
export function canConfirmPlan(
  context: PlanningContext,
  planId: Id,
  today: DateOnly,
  deps: PlanningDeps,
): boolean {
  return getConfirmationBlockers(context, planId, today, deps).length === 0;
}

/**
 * 派生共识状态（BR-07）：
 * - 从未确认 → preparing；
 * - 确认快照与当前输入一致、条件仍满足、全员当前意向赞成/可接受 → confirmed；
 * - 其他存在历史确认的情形 → needsReconfirm（附原因分类）。
 */
export function getConsensusStatus(context: PlanningContext, deps: PlanningDeps): ConsensusStatus {
  const confirmation = context.confirmation;
  if (!confirmation) {
    return { status: 'preparing', reason: null };
  }
  const plan = context.plans.find((p) => p.id === confirmation.planId);
  if (!plan) {
    return { status: 'needsReconfirm', reason: { kind: 'plan-missing', message: '已确认的方案已被移除' } };
  }
  if (context.constraintRevision !== confirmation.constraintRevision) {
    return {
      status: 'needsReconfirm',
      reason: { kind: 'constraints-changed', message: '成员或候选条件已变化，原确认失效' },
    };
  }
  if (plan.version !== confirmation.planVersion) {
    return {
      status: 'needsReconfirm',
      reason: { kind: 'plan-changed', message: '方案日期或估算参数已变化，原确认失效' },
    };
  }

  // 版本一致时逐项复查当前意向与硬条件（意向变化不增加版本，但使确认立即失效）。
  const lookup = createIntentLookup(context.intents ?? [], { planId: plan.id, planVersion: plan.version, constraintRevision: context.constraintRevision });
  const intentBlocked = context.members.some((member) => {
    const intent = lookup(
      member.id,
      plan.id,
      plan.version,
      context.constraintRevision,
    );
    return !intent || intent.value === 'decline';
  });
  if (intentBlocked) {
    return {
      status: 'needsReconfirm',
      reason: { kind: 'intents-changed', message: '成员意向已变化，原确认失效' },
    };
  }

  const conditionsHold =
    context.members.length >= MIN_MEMBERS_TO_CONFIRM &&
    evaluateMembersAgainstPlan(context.members, plan, deps).every(status => status.overall === 'pass');
  if (!conditionsHold) {
    return {
      status: 'needsReconfirm',
      reason: { kind: 'conditions-failed', message: '成员条件不再满足全员通过' },
    };
  }

  return { status: 'confirmed', reason: null };
}

/** 从 Trip 直接求值派生状态的便捷入口。 */
export function getConsensusStatusOfTrip(trip: Trip, deps: PlanningDeps): ConsensusStatus {
  return getConsensusStatus(
    {
      searchWindow: trip.searchWindow,
      duration: trip.duration,
      members: trip.members,
      plans: trip.plans,
      constraintRevision: trip.constraintRevision,
      intents: trip.intents,
      confirmation: trip.confirmation,
    },
    deps,
  );
}

/** 意向是否绑定给定方案版本与约束版本（BR-06 当前有效性）。 */
export function isIntentCurrentFor(intent: Intent, plan: Plan, constraintRevision: number): boolean {
  return (
    intent.planId === plan.id &&
    intent.planVersion === plan.version &&
    intent.constraintRevision === constraintRevision
  );
}

/** 当前确认方案中被置为“不参加”的成员（用于解释确认为何立即失效）。 */
export function findDecliningConfirmedMembers(context: PlanningContext): Id[] {
  const confirmation = context.confirmation;
  if (!confirmation) return [];
  const plan = context.plans.find((p) => p.id === confirmation.planId);
  if (!plan) return [];
  return context.members
    .filter((member: Member) => {
      const intent = getCurrentIntent(
        context.intents ?? [],
        member.id,
        plan.id,
        plan.version,
        context.constraintRevision,
      );
      return intent?.value === 'decline';
    })
    .map((member) => member.id);
}
