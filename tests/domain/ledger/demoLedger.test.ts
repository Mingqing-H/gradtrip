import { describe, expect, it } from 'vitest';
import {
  createDemoLedger,
  createSequentialIdAllocator,
} from '../../../src/data/demoLedger';
import { validateItineraryLedgerTrip } from '../../../src/domain/ledger/unifiedEntry';
import { applyLedgerCommand } from '../../../src/domain/ledger/commands';
import { computeMemberBalances, getLedgerSummary } from '../../../src/domain/ledger/balances';
import { buildSettlementSuggestions } from '../../../src/domain/ledger/settlement';
import { makeContext, makeMember, makeTrip } from './fixtures';

const MEMBERS = [
  { id: 'demo-a', name: '阿澈' },
  { id: 'demo-b', name: '小满' },
  { id: 'demo-c', name: '知遥' },
  { id: 'demo-d', name: '望舒' },
  { id: 'demo-e', name: '星回' },
  { id: 'demo-f', name: '枕流' },
];

const RANGE = { start: '2026-07-10', end: '2026-07-12' };

describe('createDemoLedger 示例种子工厂（PRD F06）', () => {
  it('确定性：相同输入生成完全相同的种子，不用系统时钟与随机数', () => {
    const first = createDemoLedger({ members: MEMBERS, dateRange: RANGE });
    const second = createDemoLedger({ members: MEMBERS, dateRange: RANGE });
    expect(first).toEqual(second);
  });

  it('覆盖均摊、部分参与、自定义三种费用模式；引用全部有效', () => {
    const seed = createDemoLedger({ members: MEMBERS, dateRange: RANGE });
    expect(seed.expenses.map((expense) => expense.splitMode)).toEqual(['equal', 'equal', 'custom']);
    expect(seed.expenses.every((expense) => expense.allocations.length > 0)).toBe(true);

    const memberIds = new Set(MEMBERS.map((member) => member.id));
    for (const expense of seed.expenses) {
      expect(memberIds.has(expense.payerId), `垫付人 ${expense.payerId}`).toBe(true);
      for (const allocation of expense.allocations) {
        expect(memberIds.has(allocation.memberId)).toBe(true);
      }
    }
  });

  it('组合进 Trip 后通过本域语义校验且余额守恒', () => {
    const seed = createDemoLedger({ members: MEMBERS, dateRange: RANGE });
    const trip = makeTrip({
      members: MEMBERS.map((member) => makeMember(member.id, { name: member.name })),
      itinerary: {
        sourcePlanId: null,
        sourcePlanVersion: null,
        dateRange: RANGE,
        activities: seed.activities,
      },
      expenses: seed.expenses,
      settlements: seed.settlements,
    });
    expect(validateItineraryLedgerTrip(trip)).toEqual([]);
    const balances = computeMemberBalances(
      trip.members.map((member) => member.id),
      trip.expenses,
      trip.settlements,
    );
    expect(balances.reduce((sum, row) => sum + row.balance, 0)).toBe(0);
  });

  it('示例结算来自真实余额建议（剩余建议仍可演示），并锁定费用修改', () => {
    const seed = createDemoLedger({ members: MEMBERS, dateRange: RANGE });
    expect(seed.settlements).toHaveLength(1);
    const preBalances = computeMemberBalances(
      MEMBERS.map((member) => member.id),
      seed.expenses,
      [],
    );
    const [expected] = buildSettlementSuggestions(preBalances);
    expect(expected).toBeDefined();
    expect(seed.settlements[0]).toMatchObject({
      fromId: expected!.fromId,
      toId: expected!.toId,
      amount: expected!.amount,
      voidedAt: null,
    });

    const trip = makeTrip({ expenses: seed.expenses, settlements: seed.settlements });
    const locked = applyLedgerCommand(
      trip,
      {
        type: 'ledger.addExpense',
        commandId: 'demo-cmd-1',
        draft: {
          title: '再记一笔',
          date: '2026-07-11',
          category: '餐饮',
          amount: 1_000,
          payerId: MEMBERS[0]!.id,
          splitMode: 'equal',
          participantIds: MEMBERS.map((member) => member.id),
        },
      },
      makeContext(),
    );
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(locked.error.code).toBe('EXPENSE_LOCKED');
  });

  it('日程种子：含 included/明确 ¥0/待估算 三类，日期在范围内', () => {
    const seed = createDemoLedger({ members: MEMBERS, dateRange: RANGE });
    expect(seed.activities.some((a) => a.budgetBucket === 'included')).toBe(true);
    expect(seed.activities.some((a) => a.budgetBucket === 'activities' && a.perPersonEstimate === 0)).toBe(true);
    expect(seed.activities.some((a) => a.budgetBucket === 'activities' && a.perPersonEstimate === null)).toBe(true);
    for (const activity of seed.activities) {
      expect(activity.date >= RANGE.start && activity.date <= RANGE.end).toBe(true);
    }
  });

  it('成员不足时降级：1 位成员只有均摊且无部分参与/自定义；2 位无自定义', () => {
    const one = createDemoLedger({ members: MEMBERS.slice(0, 1), dateRange: RANGE });
    expect(one.expenses).toHaveLength(1);
    expect(one.expenses[0]!.splitMode).toBe('equal');
    expect(one.settlements).toHaveLength(0); // 单人余额为 0，无建议

    const two = createDemoLedger({ members: MEMBERS.slice(0, 2), dateRange: RANGE });
    expect(two.expenses.map((expense) => expense.splitMode)).toEqual(['equal', 'equal']);
  });

  it('日期范围只有一天时只生成第一天活动', () => {
    const seed = createDemoLedger({ members: MEMBERS, dateRange: { start: '2026-07-10', end: '2026-07-10' } });
    expect(seed.activities.every((activity) => activity.date === '2026-07-10')).toBe(true);
    expect(seed.activities).toHaveLength(2);
  });

  it('注入自定义 allocateId/now 被采用；默认分配器为确定性计数器', () => {
    const custom = createDemoLedger({
      members: MEMBERS.slice(0, 3),
      dateRange: RANGE,
      allocateId: () => 'fixed-id',
      now: '2026-08-01T00:00:00.000Z',
    });
    expect(custom.expenses[0]!.id).toBe('fixed-id');
    expect(custom.expenses[0]!.createdAt).toBe('2026-08-01T00:00:00.000Z');

    const allocator = createSequentialIdAllocator();
    expect(allocator('expense')).toBe('expense-1');
    expect(allocator('expense')).toBe('expense-2');
  });

  it('成员 ID 改变（示例重置）不遗留失效引用', () => {
    const renamed = MEMBERS.map((member, index) => ({ ...member, id: `new-${index}` }));
    const seed = createDemoLedger({ members: renamed, dateRange: RANGE });
    const validIds = new Set(renamed.map((member) => member.id));
    for (const expense of seed.expenses) {
      expect(validIds.has(expense.payerId)).toBe(true);
      for (const allocation of expense.allocations) {
        expect(validIds.has(allocation.memberId)).toBe(true);
      }
    }
    for (const settlement of seed.settlements) {
      expect(validIds.has(settlement.fromId)).toBe(true);
      expect(validIds.has(settlement.toId)).toBe(true);
    }
  });

  it('空成员或倒置日期范围直接抛错', () => {
    expect(() => createDemoLedger({ members: [], dateRange: RANGE })).toThrow();
    expect(() =>
      createDemoLedger({ members: MEMBERS, dateRange: { start: '2026-07-12', end: '2026-07-10' } }),
    ).toThrow();
  });

  it('全部建议补记后示例余额可完全结清（可演示完整结算流程）', () => {
    const seed = createDemoLedger({ members: MEMBERS, dateRange: RANGE });
    const trip = makeTrip({ expenses: seed.expenses, settlements: seed.settlements });
    const ctx = makeContext();
    let current = trip;
    let guard = 0;
    for (;;) {
      guard += 1;
      if (guard > 50) throw new Error('示例账本建议应用循环异常');
      const balances = computeMemberBalances(
        current.members.map((member) => member.id),
        current.expenses,
        current.settlements,
      );
      const [next] = buildSettlementSuggestions(balances);
      if (next === undefined) break;
      const result = applyLedgerCommand(
        current,
        {
          type: 'ledger.recordSettlement',
          commandId: `demo-extra-${guard}`,
          fromId: next.fromId,
          toId: next.toId,
          amount: next.amount,
        },
        ctx,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      current = result.trip;
    }
    const summary = getLedgerSummary(
      current.members.map((member) => member.id),
      current.expenses,
      current.settlements,
    );
    expect(summary.balances.every((row) => row.balance === 0)).toBe(true);
  });
});
