import { describe, expect, it } from 'vitest';
import {
  applyItineraryLedgerCommand,
  validateItineraryLedgerTrip,
} from '../../../src/domain/ledger/unifiedEntry';
import {
  makeActivity,
  makeCanonicalLedgerTrip,
  makeContext,
  makeExpense,
  makePlan,
  makeSettlement,
  makeTrip,
} from './fixtures';
import type { Trip } from '../../../src/domain/types';

describe('applyItineraryLedgerCommand 统一分发', () => {
  it('按 type 前缀分发到日程与账本域', () => {
    const trip = makeTrip({
      itinerary: {
        sourcePlanId: null,
        sourcePlanVersion: null,
        dateRange: { start: '2026-07-10', end: '2026-07-12' },
        activities: [],
      },
    });
    const added = applyItineraryLedgerCommand(
      trip,
      {
        type: 'itinerary.add',
        commandId: 'c-1',
        activity: {
          date: '2026-07-10',
          startTime: null,
          endTime: null,
          title: '测试活动',
          category: '活动',
          budgetBucket: 'activities',
          perPersonEstimate: null,
          note: '',
        },
      },
      makeContext(),
    );
    expect(added.ok && added.trip.itinerary.activities).toHaveLength(1);

    const expensed = applyItineraryLedgerCommand(
      trip,
      {
        type: 'ledger.addExpense',
        commandId: 'c-2',
        draft: {
          title: '打车',
          date: '2026-07-10',
          category: '交通',
          amount: 9_000,
          payerId: 'm-b',
          splitMode: 'equal',
          participantIds: ['m-a', 'm-b', 'm-c'],
        },
      },
      makeContext(),
    );
    expect(expensed.ok && expensed.trip.expenses).toHaveLength(1);
  });

  it('未知命令前缀返回 INVALID_COMMAND，不静默成功', () => {
    const result = applyItineraryLedgerCommand(
      makeTrip(),
      { type: 'squad.add', commandId: 'c-x' } as never,
      makeContext(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_COMMAND');
  });
});

describe('validateItineraryLedgerTrip 旅行级语义校验', () => {
  it('规范数据（含有效结算与被撤销结算）通过', () => {
    const trip = makeCanonicalLedgerTrip({
      itinerary: {
        sourcePlanId: 'p-1',
        sourcePlanVersion: 1,
        dateRange: { start: '2026-07-10', end: '2026-07-12' },
        activities: [makeActivity('a-1')],
      },
      plans: [makePlan('p-1')],
      settlements: [
        makeSettlement('s-1', { fromId: 'm-c', toId: 'm-a', amount: 10_000 }),
        makeSettlement('s-2', {
          fromId: 'm-b',
          toId: 'm-a',
          amount: 5_500,
          voidedAt: '2026-07-02T08:00:00.000Z',
        }),
      ],
    });
    expect(validateItineraryLedgerTrip(trip)).toEqual([]);
  });

  it('超出日程范围的活动不是错误（需保留并标记，不阻止数据合法）', () => {
    const trip = makeTrip({
      itinerary: {
        sourcePlanId: null,
        sourcePlanVersion: null,
        dateRange: { start: '2026-07-10', end: '2026-07-12' },
        activities: [makeActivity('a-1', { date: '2026-07-20' })],
      },
    });
    expect(validateItineraryLedgerTrip(trip)).toEqual([]);
  });

  it.each([
    ['活动 ID 重复', (t: Trip) => t.itinerary.activities.push(makeActivity('a-base')), 'INVARIANT_BROKEN'],
    ['活动时间非法', (t: Trip) => t.itinerary.activities.push(makeActivity('a-1', { startTime: '10:00', endTime: '09:00' })), 'TIME_ORDER'],
    ['included 条目带金额', (t: Trip) => t.itinerary.activities.push(makeActivity('a-1', { budgetBucket: 'included', perPersonEstimate: 100 })), 'INVALID_ESTIMATE'],
    ['日程引用不存在的方案', (t: Trip) => { t.itinerary.sourcePlanId = 'nope'; }, 'PLAN_NOT_FOUND'],
    ['费用引用不存在成员（R11 整体拒绝依据）', (t: Trip) => t.expenses.push(makeExpense('e-1', { payerId: 'm-z' })), 'UNKNOWN_MEMBER'],
    ['费用分摊合计不一致', (t: Trip) => t.expenses.push(makeExpense('e-1', { amount: 10_000, allocations: [{ memberId: 'm-a', amount: 9_999 }] })), 'ALLOCATION_SUM_MISMATCH'],
    ['均摊明细违反确定性规则', (t: Trip) => t.expenses.push(makeExpense('e-1', { splitMode: 'equal', amount: 10_000, allocations: [{ memberId: 'm-a', amount: 5_001 }, { memberId: 'm-b', amount: 4_999 }] })), 'INVARIANT_BROKEN'],
    ['结算转给自己', (t: Trip) => t.settlements.push(makeSettlement('s-1', { fromId: 'm-a', toId: 'm-a' })), 'SETTLEMENT_SELF'],
    ['结算 commandId 重复', (t: Trip) => { t.settlements.push(makeSettlement('s-1', { commandId: 'dup' })); t.settlements.push(makeSettlement('s-2', { commandId: 'dup' })); }, 'DUPLICATE_COMMAND'],
  ])('检测：%s', (_name, corrupt, code) => {
    const trip = makeTrip({
      itinerary: {
        sourcePlanId: null,
        sourcePlanVersion: null,
        dateRange: { start: '2026-07-10', end: '2026-07-12' },
        activities: [makeActivity('a-base')],
      },
    });
    corrupt(trip);
    const errors = validateItineraryLedgerTrip(trip);
    expect(errors.some((error) => error.code === code), `应包含 ${code}，实际：${errors.map((e) => e.code).join(',')}`).toBe(true);
  });

  it('费用金额与分摊不一致同时触发余额守恒错误', () => {
    const trip = makeTrip({
      expenses: [
        makeExpense('e-1', {
          splitMode: 'custom',
          amount: 10_000,
          allocations: [{ memberId: 'm-a', amount: 8_000 }],
        }),
      ],
    });
    const errors = validateItineraryLedgerTrip(trip);
    expect(errors.map((error) => error.code)).toContain('ALLOCATION_SUM_MISMATCH');
    expect(errors.map((error) => error.code)).toContain('INVARIANT_BROKEN');
  });
});
