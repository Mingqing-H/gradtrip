// 规划示例种子工厂（F06）：6 位虚构成员、相对未来的日期、
// 一个“补全预算即可全员确认”的目标方案与多个可解释冲突方案。
//
// 由 T01 在合成统一示例旅行时调用（trip.create + 本种子 + T03 费用种子），
// 本模块不构造完整 Trip、不写真实用户数据、不读取系统时钟（today/now 显式传入）。
//
// 场景设计（相对 today，记 T）：
// - 搜索窗口 [T+14, T+103]，时长 3 天；
// - 共同出发日交集为 [T+30, T+40]，生成 6 个目的地候选（demo-p1..p6，出发 T+30）；
// - demo-p1（青岛）为全员硬约束可行的目标方案，意向 5 人已反馈，
//   仅周予安待操作（资料完整、意向未反馈）→ 代录其意向即可全员确认；
// - demo-p7（青岛，出发 T+22）演示时间冲突：3 人日期不覆盖；
// - 厦门/成都/西安/大理按预算差异产生可解释冲突（BR-05 排序可验证）；
// - constraintRevision=1 的旧意向为失效历史示例；
// - 演示“修改预算 → 冲突与待重新确认”由操作者对林知夏（¥1,500→¥1,100）执行。

import { addDays } from '../domain/planning/calendar';
import type { Confirmation, DateOnly, Intent, Member, Plan, Range } from '../domain/planning/contract';
import { TEMPLATE_V1 } from './templates/v1';

export interface PlanningDemoOptions {
  /** 初始化当天（YYYY-MM-DD），所有日期相对它生成。 */
  today: DateOnly;
  /** ISO 8601 时间戳，用于意向记录时间。 */
  now: string;
  /** ID 前缀，避免与真实数据冲突；默认 demo。 */
  idPrefix?: string;
}

export interface PlanningDemoSeed {
  searchWindow: Range;
  duration: 3;
  members: Member[];
  plans: Plan[];
  intents: Intent[];
  constraintRevision: number;
  confirmation: null;
  /** 演示场景说明，供统一示例与 UI 提示使用。 */
  scenario: {
    /** 全员可行目标方案（补全待操作成员预算后可确认）。 */
    targetPlanId: string;
    /** 待操作成员（资料完整，仅意向未反馈）。 */
    pendingMemberId: string;
    /** 时间冲突示例方案。 */
    timeConflictPlanId: string;
    /** 含失效旧意向的成员（constraintRevision=1 历史）。 */
    staleIntentMemberId: string;
    note: string;
  };
}

export const DEMO_MEMBER_NAMES = ['林知夏', '陈亦舟', '周予安', '沈乐瑶', '顾北辰', '苏晚晴'] as const;

export function createPlanningDemo(options: PlanningDemoOptions): PlanningDemoSeed {
  const { today, now } = options;
  const p = options.idPrefix ?? 'demo';
  const S = addDays(today, 30); // 主出发日（共同日期交集内）
  const S2 = addDays(today, 22); // 冲突出发日（早于三位成员可用区间）

  const members: Member[] = [
    {
      id: `${p}-m1`,
      name: '林知夏',
      originCity: '上海',
      budgetCap: 150000,
      availability: [{ start: addDays(today, 21), end: addDays(today, 49) }],
      preferences: ['海边'],
    },
    {
      id: `${p}-m2`,
      name: '陈亦舟',
      originCity: '杭州',
      budgetCap: 180000,
      availability: [{ start: addDays(today, 28), end: addDays(today, 56) }],
      preferences: ['人文'],
    },
    {
      id: `${p}-m3`,
      name: '周予安',
      originCity: '南京',
      budgetCap: 160000, // 资料完整；仅意向待反馈（示例的“待操作成员”）
      availability: [{ start: addDays(today, 25), end: addDays(today, 40) }],
      preferences: ['城市'],
    },
    {
      id: `${p}-m4`,
      name: '沈乐瑶',
      originCity: '上海',
      budgetCap: 200000,
      availability: [{ start: addDays(today, 21), end: addDays(today, 60) }],
      preferences: ['海边', '自然'],
    },
    {
      id: `${p}-m5`,
      name: '顾北辰',
      originCity: '杭州',
      budgetCap: 260000,
      availability: [{ start: addDays(today, 30), end: addDays(today, 60) }],
      preferences: ['自然'],
    },
    {
      id: `${p}-m6`,
      name: '苏晚晴',
      originCity: '南京',
      budgetCap: 300000,
      availability: [{ start: addDays(today, 18), end: addDays(today, 45) }],
      preferences: ['人文', '自然'],
    },
  ];

  const estimateOf = (destinationId: string): Plan['estimate'] => {
    const template = TEMPLATE_V1.destinations.find((d) => d.id === destinationId)!;
    return {
      transportByMember: {},
      lodgingPerNight: template.estimate.lodgingPerNight,
      foodPerDay: template.estimate.foodPerDay,
      activities: template.estimate.activities,
      reserve: template.estimate.reserve,
    };
  };

  const planOf = (id: string, destinationId: string, startDate: DateOnly): Plan => ({
    id,
    version: 1,
    destinationId,
    templateVersion: TEMPLATE_V1.version,
    startDate,
    days: 3,
    estimate: estimateOf(destinationId),
  });

  // 主候选：6 个目的地同日出发；demo-p1（青岛）为目标方案。
  const plans: Plan[] = [
    planOf(`${p}-p1`, 'dest-qingdao', S),
    planOf(`${p}-p2`, 'dest-suzhou', S),
    planOf(`${p}-p3`, 'dest-xiamen', S),
    planOf(`${p}-p4`, 'dest-chengdu', S),
    planOf(`${p}-p5`, 'dest-xian', S),
    planOf(`${p}-p6`, 'dest-dali', S),
    planOf(`${p}-p7`, 'dest-qingdao', S2), // 时间冲突示例
  ];

  const intent = (
    memberId: string,
    planId: string,
    value: Intent['value'],
    source: Intent['source'],
    constraintRevision: number,
  ): Intent => ({
    memberId,
    planId,
    planVersion: 1,
    constraintRevision,
    value,
    source,
    recordedAt: now,
  });

  const intents: Intent[] = [
    // 当前版本（constraintRevision=2）：目标方案 5 人已反馈，周予安待操作。
    intent(`${p}-m1`, `${p}-p1`, 'approve', 'organizer', 2),
    intent(`${p}-m2`, `${p}-p1`, 'acceptable', 'organizer', 2),
    intent(`${p}-m4`, `${p}-p1`, 'approve', 'demo', 2),
    intent(`${p}-m5`, `${p}-p1`, 'approve', 'organizer', 2),
    intent(`${p}-m6`, `${p}-p1`, 'acceptable', 'demo', 2),
    intent(`${p}-m1`, `${p}-p2`, 'approve', 'organizer', 2),
    intent(`${p}-m4`, `${p}-p2`, 'approve', 'organizer', 2),
    // 失效历史（constraintRevision=1）：陈亦舟曾在旧候选上下文拒绝。
    intent(`${p}-m2`, `${p}-p1`, 'decline', 'organizer', 1),
  ];

  return {
    searchWindow: { start: addDays(today, 14), end: addDays(today, 103) },
    duration: 3,
    members,
    plans,
    intents,
    constraintRevision: 2,
    confirmation: null satisfies Confirmation | null,
    scenario: {
      targetPlanId: `${p}-p1`,
      pendingMemberId: `${p}-m3`,
      timeConflictPlanId: `${p}-p7`,
      staleIntentMemberId: `${p}-m2`,
      note: '示例为筹备状态：仅周予安意向待反馈，代录（赞成或可接受）后即可全员确认青岛方案（demo-p1）。将林知夏预算改为 ¥1,100 可演示冲突与待重新确认。',
    },
  };
}
