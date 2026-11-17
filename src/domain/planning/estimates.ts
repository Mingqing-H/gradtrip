// 个人基准估算 E_i 的计算与交通解析（BR-04）。
//
//   E_i = T_i + H × (D - 1) + F × D + A + R
//
// - T_i：成员出发城市 → 目的地往返交通；优先方案内的手工覆盖值，
//   覆盖值绑定保存时的出发城市，成员换城市后不再适用（回落查表，而非沿用旧值）；
// - 查表无记录（未知城市）时该成员估算未知，不允许按 0 元处理；
// - 参数均为非负整数分；E_i 上限 ¥100,000。

import type { Cents, Id, Member, Plan } from './contract';
import type { PlanningDeps } from './types';

/** 个人基准估算上限（¥100,000，分）。 */
export const ESTIMATE_CAP_CENTS = 10_000_000;

export interface EstimateBreakdown {
  /** 往返交通；未知为 null。 */
  transport: Cents | null;
  /** 交通来源：手工覆盖 / 交通表 / 未知。 */
  transportSource: 'override' | 'table' | 'unknown';
  lodging: Cents;
  food: Cents;
  activities: Cents;
  reserve: Cents;
  /** 合计 E_i；交通未知时为 null。 */
  total: Cents | null;
}

/** 解析某成员在某方案下的往返交通（分）。 */
export function resolveTransportCents(
  plan: Plan,
  member: Pick<Member, 'id' | 'originCity'>,
  deps: Pick<PlanningDeps, 'resolveTransport'>,
): { amount: Cents | null; source: 'override' | 'table' | 'unknown' } {
  const override = plan.estimate.transportByMember?.[member.id];
  if (
    override &&
    override !== null &&
    member.originCity !== null &&
    override.originCity === member.originCity
  ) {
    return { amount: override.amount, source: 'override' };
  }
  if (member.originCity === null) return { amount: null, source: 'unknown' };
  const fromTable = deps.resolveTransport(plan.templateVersion, member.originCity, plan.destinationId);
  if (fromTable === undefined) return { amount: null, source: 'unknown' };
  return { amount: fromTable, source: 'table' };
}

/** 计算成员 i 在方案下的完整估算分解；交通未知时 total 为 null。 */
export function computeEstimateBreakdown(
  plan: Plan,
  member: Pick<Member, 'id' | 'originCity'>,
  deps: PlanningDeps,
): EstimateBreakdown {
  const { amount: transport, source: transportSource } = resolveTransportCents(plan, member, deps);
  const nights = plan.days - 1;
  const lodging = plan.estimate.lodgingPerNight * nights;
  const food = plan.estimate.foodPerDay * plan.days;
  const { activities, reserve } = plan.estimate;
  const total = transport === null ? null : transport + lodging + food + activities + reserve;
  return { transport, transportSource, lodging, food, activities, reserve, total };
}

/** 已知个人估算的最低～最高；全部未知返回 null（BR-04 卡片区间）。 */
export function estimateRangeOf(totals: readonly (Cents | null)[]): { min: Cents; max: Cents } | null {
  const known = totals.filter((t): t is Cents => t !== null);
  if (known.length === 0) return null;
  let min = known[0];
  let max = known[0];
  for (const value of known) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/** 方案费用参数是否非负安全整数（不含交通覆盖值）。 */
export function areEstimateParamsValid(estimate: {
  lodgingPerNight: number;
  foodPerDay: number;
  activities: number;
  reserve: number;
}): boolean {
  return [estimate.lodgingPerNight, estimate.foodPerDay, estimate.activities, estimate.reserve].every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  );
}

/**
 * 在调整估算参数后，估算是否会超过 ¥100,000 上限（按成员逐一检查）。
 * 返回超限的成员 ID 列表（用于给出具体定位）。
 */
export function findMembersOverEstimateCap(
  plan: Plan,
  members: readonly Member[],
  deps: PlanningDeps,
): Id[] {
  const over: Id[] = [];
  for (const member of members) {
    const { total } = computeEstimateBreakdown(plan, member, deps);
    if (total !== null && total > ESTIMATE_CAP_CENTS) over.push(member.id);
  }
  return over;
}
