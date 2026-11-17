/**
 * 日程与账本示例种子工厂（PRD F06、T03 任务书 §4.3）。
 *
 * 由 T01 组合进统一示例（成员与日期注入，通常来自 T02 规划种子）；
 * 构建过程不调用全局随机数或系统日期，相同输入得到相同种子。
 * 费用覆盖均摊、部分参与与自定义三种模式；结算示例来自真实余额建议，
 * 不伪造“全部付款成功”。若示例成员 ID 改变，引用由注入参数重算，不遗留失效引用。
 */
import type { Activity, Expense, Settlement } from '../domain/types';
import { addDays, daysBetween as diffDays } from '../domain/dates';
import { splitEqualCents } from '../domain/ledger/split';
import { computeMemberBalances } from '../domain/ledger/balances';
import { buildSettlementSuggestions } from '../domain/ledger/settlement';

export interface DemoLedgerMember {
  id: string;
  name: string;
}

export interface DemoLedgerArgs {
  /** 注入的稳定成员（≥1 位；≥3 位可覆盖全部示例模式） */
  members: readonly DemoLedgerMember[];
  /** 示例日程日期范围（含首尾），由 T01 按当前日期生成未来时间 */
  dateRange: { start: string; end: string };
  /** 可选 ID 分配器；默认使用确定性计数器 */
  allocateId?: (prefix: string) => string;
  /** 可选记录时间；默认固定常量，不用系统时钟 */
  now?: string;
}

export interface DemoLedgerSeed {
  activities: Activity[];
  expenses: Expense[];
  settlements: Settlement[];
}

const DEFAULT_NOW = '2026-06-01T09:00:00.000Z';

/** 确定性 ID 分配器：prefix-1、prefix-2…… */
export function createSequentialIdAllocator(): (prefix: string) => string {
  let counter = 0;
  return (prefix: string) => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

/**
 * 生成示例种子。成员数不足时自动降级：
 * 1 位成员只保留均摊费用；结算示例仅在存在非零余额建议时生成。
 */
export function createDemoLedger(args: DemoLedgerArgs): DemoLedgerSeed {
  if (args.members.length === 0) {
    throw new Error('createDemoLedger 需要至少一位成员');
  }
  const allocateId = args.allocateId ?? createSequentialIdAllocator();
  const now = args.now ?? DEFAULT_NOW;
  const memberIds = args.members.map((member) => member.id);
  const [first, second, third] = memberIds;

  const span = diffDays(args.dateRange.start, args.dateRange.end);
  if (span < 0) {
    throw new Error('createDemoLedger 的日期范围开始不能晚于结束');
  }
  const days = Math.min(3, span + 1);
  const activities: Activity[] = [];
  const pushActivity = (activity: Omit<Activity, 'id'>): void => {
    activities.push({ ...activity, id: allocateId('activity') });
  };

  // Day 1：抵达（已含交通）与明确 ¥0 的活动
  const day1 = args.dateRange.start;
  pushActivity({
    date: day1,
    startTime: '09:30',
    endTime: '11:00',
    title: '抵达与集合',
    category: '交通',
    budgetBucket: 'included',
    perPersonEstimate: null,
    note: '车票已计入方案交通估算，不重复计入活动预算',
    order: 0,
  });
  pushActivity({
    date: day1,
    startTime: '14:00',
    endTime: '16:30',
    title: '老城区漫步',
    category: '活动',
    budgetBucket: 'activities',
    perPersonEstimate: 0,
    note: '免费景点，明确按 ¥0 预计',
    order: 1,
  });

  // Day 2：待估算（null）与已含餐饮
  if (days >= 2) {
    const day2 = addDays(args.dateRange.start, 1);
    pushActivity({
      date: day2,
      startTime: null,
      endTime: null,
      title: '海滨浴场半日',
      category: '活动',
      budgetBucket: 'activities',
      perPersonEstimate: 4500,
      note: '人均约 ¥45，含更衣与寄存',
      order: 2,
    });
    pushActivity({
      date: day2,
      startTime: '17:30',
      endTime: '19:00',
      title: '海鲜大餐',
      category: '餐饮',
      budgetBucket: 'included',
      perPersonEstimate: null,
      note: '餐费预算已在方案餐饮分项，另见账本实际记录',
      order: 3,
    });
  }

  // Day 3：自由活动，金额待估算（未知不能当作零费用）
  if (days >= 3) {
    pushActivity({
      date: addDays(args.dateRange.start, 2),
      startTime: null,
      endTime: null,
      title: '返程前自由活动',
      category: '其他',
      budgetBucket: 'activities',
      perPersonEstimate: null,
      note: '金额待估算',
      order: 4,
    });
  }

  const expenses: Expense[] = [];
  const pushExpense = (expense: Omit<Expense, 'id'>): void => {
    expenses.push({ ...expense, id: allocateId('expense') });
  };

  // 1. 全员均摊：¥300 住宿，第一位成员垫付
  pushExpense({
    title: '民宿两晚',
    date: day1,
    category: '住宿',
    amount: 30000,
    payerId: first as string,
    splitMode: 'equal',
    allocations: splitEqualCents(30000, memberIds),
    createdAt: now,
  });

  // 2. 部分参与：¥90 餐费，仅前两位成员参与、第二位垫付（垫付人参与）
  if (second !== undefined) {
    pushExpense({
      title: '海鲜大餐加菜',
      date: days >= 2 ? addDays(args.dateRange.start, 1) : day1,
      category: '餐饮',
      amount: 9000,
      payerId: second,
      splitMode: 'equal',
      allocations: splitEqualCents(9000, [first as string, second]),
      createdAt: now,
    });
  }

  // 3. 自定义金额：¥100 门票与打车，按前三位成员不均等分摊
  if (third !== undefined) {
    pushExpense({
      title: '景区门票与打车',
      date: days >= 2 ? addDays(args.dateRange.start, 1) : day1,
      category: '活动',
      amount: 10000,
      payerId: third,
      splitMode: 'custom',
      allocations: [
        { memberId: first as string, amount: 3400 },
        { memberId: second, amount: 3300 },
        { memberId: third, amount: 3300 },
      ],
      createdAt: now,
    });
  }

  // 结算示例：取真实余额建议的第一笔登记为线下转账，剩余建议保留供演示
  const settlements: Settlement[] = [];
  const balances = computeMemberBalances(memberIds, expenses, settlements);
  const [firstSuggestion] = buildSettlementSuggestions(balances);
  if (firstSuggestion !== undefined) {
    settlements.push({
      id: allocateId('settlement'),
      commandId: allocateId('demo-settlement'),
      fromId: firstSuggestion.fromId,
      toId: firstSuggestion.toId,
      amount: firstSuggestion.amount,
      recordedAt: now,
      voidedAt: null,
    });
  }

  return { activities, expenses, settlements };
}
