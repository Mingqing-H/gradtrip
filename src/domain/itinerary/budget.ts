/**
 * 日程预算修订查询（BR-08 日程与估算关系）。
 *
 * 设 activities 条目的已知金额之和为 S，逐人修订估算 E'_i = E_i - A + S：
 * 用日程活动“替换”方案的活动分项，不重复叠加。
 * 个人基准估算 E_i 由 T02 规划服务经应用层注入（baseEstimates），本域不重新实现交通/住宿估算。
 */
import type { Activity, Member } from '../types';
import { compareIds } from '../ledger/split';

export interface ItineraryBudgetMember {
  memberId: string;
  /** 个人预算上限；null 表示待补充 */
  budgetCap: number | null;
  /** 方案基准估算 E_i；null 表示未知（不能当作零值） */
  baseEstimate: number | null;
  /** 修订估算 E'_i = E_i - A + S；E_i 未知时为 null */
  revisedEstimate: number | null;
  /** 修订估算是否超出该成员预算；任一侧未知时为 null（无法判断） */
  overBudget: boolean | null;
}

export interface ItineraryBudgetSummary {
  /** 方案原活动分项 A（分） */
  planActivitiesEstimate: number;
  /** 当前 activities 条目已知金额之和 S（分）；included 条目不参与 */
  knownActivitiesTotal: number;
  /** 金额未知（待估算）的 activities 条目数；未知不能计为已知零费用 */
  unknownActivityCount: number;
  /** included（已含于方案）条目数，仅记录安排、不计入预算 */
  includedCount: number;
  /** 全部 activities 金额已知且所有成员 E_i 已知时为 true */
  complete: boolean;
  perMember: ItineraryBudgetMember[];
}

export interface GetItineraryBudgetArgs {
  activities: readonly Activity[];
  /** 当前方案（或确认快照）的人均活动分项 A（分） */
  planActivitiesEstimate: number;
  members: readonly Member[];
  /** 逐人基准估算 E_i（分），由 T02 规划服务注入；缺成员视为未知 */
  baseEstimates: Readonly<Record<string, number | null>>;
}

/**
 * 计算日程预算摘要。返回派生数据，不持久化；
 * 日程估算与实际支出互不自动改写，实际费用统计见账本域。
 */
export function getItineraryBudget(args: GetItineraryBudgetArgs): ItineraryBudgetSummary {
  let knownActivitiesTotal = 0;
  let unknownActivityCount = 0;
  let includedCount = 0;
  for (const activity of args.activities) {
    if (activity.budgetBucket === 'included') {
      includedCount += 1;
      continue;
    }
    if (activity.perPersonEstimate === null) {
      unknownActivityCount += 1;
    } else {
      knownActivitiesTotal += activity.perPersonEstimate;
    }
  }

  const perMember = args.members
    .map((member): ItineraryBudgetMember => {
      const baseEstimate = args.baseEstimates[member.id] ?? null;
      const revisedEstimate =
        baseEstimate === null ? null : baseEstimate - args.planActivitiesEstimate + knownActivitiesTotal;
      const overBudget =
        revisedEstimate === null || member.budgetCap === null
          ? null
          : revisedEstimate > member.budgetCap;
      return { memberId: member.id, budgetCap: member.budgetCap, baseEstimate, revisedEstimate, overBudget };
    })
    .sort((a, b) => compareIds(a.memberId, b.memberId));

  const allBaseKnown = perMember.every((row) => row.baseEstimate !== null);
  return {
    planActivitiesEstimate: args.planActivitiesEstimate,
    knownActivitiesTotal,
    unknownActivityCount,
    includedCount,
    complete: unknownActivityCount === 0 && allBaseKnown,
    perMember,
  };
}
