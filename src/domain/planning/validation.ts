// 规划域语义校验：用于持久化恢复、备份导入等边界的规划字段检查（T01 聚合执行）。
// 只检查规划域归属的字段与引用；返回问题列表，空数组表示通过。

import { isValidDateOnly, isValidRange, isDateInRange, diffInDays } from './calendar';
import { areEstimateParamsValid } from './estimates';
import { MAX_MEMBER_COUNT, MEMBER_NAME_MAX, MAX_AVAILABILITY_RANGES, BUDGET_CAP_MAX, hasValidAvailability, normalizeText } from './profile';
import { MAX_INTENT_COUNT, MAX_PLAN_COUNT, MAX_SEARCH_WINDOW_DAYS } from './commands';
import type { Trip } from './contract';
import type { PlanningDeps } from './types';

export interface ValidationIssue {
  code: string;
  /** 问题定位，如 members[2].availability[0].start。 */
  path: string;
  message: string;
}

/**
 * 校验旅行的规划域不变量。deps 提供时额外校验目的地模板引用存在。
 * 不重复 schema 层的结构检查（Zod），聚焦跨字段语义。
 */
export function validatePlanningTrip(trip: Trip, deps?: PlanningDeps): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, path: string, message: string) => issues.push({ code, path, message });

  // 搜索窗口与时长
  if (!isValidRange(trip.searchWindow)) {
    push('window-invalid', 'searchWindow', '搜索窗口需为合法日期区间');
  } else if (diffInDays(trip.searchWindow.end, trip.searchWindow.start) + 1 > MAX_SEARCH_WINDOW_DAYS) {
    push('window-too-long', 'searchWindow', `搜索窗口最长 ${MAX_SEARCH_WINDOW_DAYS} 天`);
  }
  if (trip.duration < 2 || trip.duration > 5) {
    push('duration-invalid', 'duration', '出行时长需为 2～5 天');
  }

  // 成员
  const memberIds = new Set<string>();
  if (trip.members.length > MAX_MEMBER_COUNT) {
    push('member-limit', 'members', `成员最多 ${MAX_MEMBER_COUNT} 位`);
  }
  trip.members.forEach((member, index) => {
    const base = `members[${index}]`;
    if (memberIds.has(member.id)) push('member-duplicate-id', `${base}.id`, '成员 ID 重复');
    memberIds.add(member.id);
    const name = normalizeText(member.name ?? '');
    if (name.length < 1 || name.length > MEMBER_NAME_MAX) {
      push('member-name-invalid', `${base}.name`, `昵称需 1～${MEMBER_NAME_MAX} 字`);
    }
    if (member.budgetCap !== null && (!Number.isSafeInteger(member.budgetCap) || member.budgetCap < 0 || member.budgetCap > BUDGET_CAP_MAX)) {
      push('member-budget-invalid', `${base}.budgetCap`, '预算需为 ¥0～¥100,000 的整数分');
    }
    const availability = member.availability ?? [];
    if (availability.length > MAX_AVAILABILITY_RANGES) {
      push('member-availability-limit', `${base}.availability`, `最多 ${MAX_AVAILABILITY_RANGES} 段可用日期`);
    } else if (!hasValidAvailability(availability) && availability.length > 0) {
      push('member-availability-invalid', `${base}.availability`, '可用日期区间不合法（起日不得晚于止日）');
    }
    if (member.preferences !== undefined && !Array.isArray(member.preferences)) {
      push('member-preferences-invalid', `${base}.preferences`, '偏好需为字符串数组');
    }
  });

  // 候选方案
  const planIds = new Set<string>();
  if (trip.plans.length > MAX_PLAN_COUNT) {
    push('plan-limit', 'plans', `候选方案最多 ${MAX_PLAN_COUNT} 个`);
  }
  trip.plans.forEach((plan, index) => {
    const base = `plans[${index}]`;
    if (planIds.has(plan.id)) push('plan-duplicate-id', `${base}.id`, '方案 ID 重复');
    planIds.add(plan.id);
    if (!Number.isSafeInteger(plan.version) || plan.version < 1) {
      push('plan-version-invalid', `${base}.version`, '方案版本需为正整数');
    }
    if (plan.days < 2 || plan.days > 5) {
      push('plan-days-invalid', `${base}.days`, '方案时长需为 2～5 天');
    }
    if (!isValidDateOnly(plan.startDate) || !isDateInRange(plan.startDate, trip.searchWindow)) {
      push('plan-start-invalid', `${base}.startDate`, '出发日期需为合法日期且在搜索窗口内');
    }
    if (!areEstimateParamsValid(plan.estimate)) {
      push('plan-estimate-invalid', `${base}.estimate`, '估算参数需为非负整数分');
    }
    for (const [memberId, override] of Object.entries(plan.estimate.transportByMember ?? {})) {
      if (!memberIds.has(memberId)) {
        push('plan-transport-ref-invalid', `${base}.estimate.transportByMember.${memberId}`, '手工交通引用了不存在的成员');
        continue;
      }
      if (override !== null && (!Number.isSafeInteger(override.amount) || override.amount < 0)) {
        push('plan-transport-amount-invalid', `${base}.estimate.transportByMember.${memberId}`, '交通估算需为非负整数分');
      }
    }
    if (deps && !deps.resolveDestination(plan.templateVersion, plan.destinationId)) {
      push('plan-destination-unknown', `${base}.destinationId`, '未知的目的地模板');
    }
  });

  // 意向：引用存在、当前组合唯一、数量上限
  if (trip.intents.length > MAX_INTENT_COUNT) {
    push('intent-limit', 'intents', `意向历史最多 ${MAX_INTENT_COUNT} 条`);
  }
  const seenBindings = new Set<string>();
  trip.intents.forEach((intent, index) => {
    const base = `intents[${index}]`;
    if (!memberIds.has(intent.memberId)) {
      push('intent-member-ref-invalid', `${base}.memberId`, '意向引用了不存在的成员');
    }
    if (!planIds.has(intent.planId)) {
      push('intent-plan-ref-invalid', `${base}.planId`, '意向引用了不存在的方案');
    }
    if (!['approve', 'acceptable', 'decline'].includes(intent.value)) {
      push('intent-value-invalid', `${base}.value`, '意向值不合法');
    }
    if (!['organizer', 'feedback', 'demo'].includes(intent.source)) {
      push('intent-source-invalid', `${base}.source`, '意向来源不合法');
    }
    const key = `${intent.memberId}|${intent.planId}|${intent.planVersion}|${intent.constraintRevision}`;
    if (seenBindings.has(key)) {
      push('intent-duplicate-binding', base, '同一成员/方案/版本组合存在重复意向记录');
    }
    seenBindings.add(key);
  });

  // 确认记录引用
  if (trip.confirmation) {
    if (!planIds.has(trip.confirmation.planId)) {
      push('confirmation-plan-ref-invalid', 'confirmation.planId', '确认引用了不存在的方案');
    }
    if (!Number.isSafeInteger(trip.confirmation.constraintRevision) || trip.confirmation.constraintRevision < 0) {
      push('confirmation-revision-invalid', 'confirmation.constraintRevision', '确认的约束版本不合法');
    }
  }

  return issues;
}
