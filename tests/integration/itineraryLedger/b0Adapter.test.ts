/** B0 适配层测试：验证 CommandHandler 签名、Result.value、预分配 ids 与 Builder 注入路径。 */
import { describe, expect, it } from 'vitest';
import type { CommandContext, CommandPayload } from '../../../src/domain/commands';
import { applyItineraryLedgerCommand, validateItineraryLedgerTrip } from '../../../src/domain/ledger';
import { applyDomainCommand, validateDomainTrip } from '../../../src/domain/ledger';
import { buildTemplateItinerary as buildBuilder, buildTemplateItineraryForB0 } from '../../../src/domain/itinerary';
import type { DomainDependencies, DestinationTemplate } from '../../../src/contracts/services';
import {
  makeActivity,
  makeCanonicalLedgerTrip,
  makeContext,
  makePlan,
  makeTrip,
} from '../../domain/ledger/fixtures';

const NOW = '2026-07-01T10:00:00.000Z';
function b0Context(ids: string[]): CommandContext {
  return { now: NOW, today: '2026-07-01', ids, commandId: 'cmd-b0-1' };
}
const noDeps: DomainDependencies = {
  planning: {
    getPlanEvaluations: () => [],
    getConsensusStatus: () => ({ canConfirm: false, confirmed: false, reasons: [] }),
    findCommonDepartures: () => [],
    updateMemberConstraints: () => ({ ok: false, error: { code: 'VALIDATION', message: 'test' } }),
    evaluatePersonalPlan: () => ({ memberId: '', total: null, timeFits: null, budgetFits: null, reasons: [] }),
    getTemplate: () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'no template' } }),
  },
  buildTemplateItinerary: () => ({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'test' } }),
};

describe('B0 CommandHandler 适配', () => {
  it('ledger.addExpense：B0 扁平 payload → Result.value，费用落库', () => {
    const trip = makeTrip();
    const expense = {
      id: 'e-b0-1',
      title: '打车',
      date: '2026-07-10',
      category: '交通',
      amount: 9_000,
      payerId: 'm-a',
      splitMode: 'equal' as const,
      allocations: [
        { memberId: 'm-a', amount: 3_000 },
        { memberId: 'm-b', amount: 3_000 },
        { memberId: 'm-c', amount: 3_000 },
      ],
      createdAt: NOW,
    };
    const payload: CommandPayload = { type: 'ledger.addExpense', expense };
    const result = applyItineraryLedgerCommand(trip, payload, b0Context(['expense-b0-1']), noDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.expenses).toHaveLength(1);
      expect(result.value.expenses[0]!.allocations.reduce((s, a) => s + a.amount, 0)).toBe(9_000);
    }
  });

  it('itinerary.add：从 B0 context.ids 预分配 ID', () => {
    const trip = makeTrip({
      itinerary: {
        sourcePlanId: null,
        sourcePlanVersion: null,
        dateRange: { start: '2026-07-10', end: '2026-07-12' },
        activities: [],
      },
    });
    const payload: CommandPayload = {
      type: 'itinerary.add',
      activity: {
        ...makeActivity('ignored'),
        title: '新增活动',
      },
    };
    const result = applyItineraryLedgerCommand(trip, payload, b0Context(['allocated-1']), noDeps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.itinerary.activities[0]!.id).toBe('allocated-1');
  });

  it('预分配 ID 不足时返回 VALIDATION，不抛异常', () => {
    const trip = makeTrip({
      itinerary: {
        sourcePlanId: null,
        sourcePlanVersion: null,
        dateRange: { start: '2026-07-10', end: '2026-07-12' },
        activities: [],
      },
    });
    const result = applyItineraryLedgerCommand(
      trip,
      { type: 'itinerary.add', activity: makeActivity('x') },
      b0Context([]),
      noDeps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION');
    expect(result.error.message).toContain('ID 不足');
  });

  it('itinerary.update：局部补丁与现有活动合并后校验', () => {
    const base = makeActivity('a-1', { title: '原名', perPersonEstimate: 1_000 });
    const trip = makeTrip({
      itinerary: {
        sourcePlanId: null,
        sourcePlanVersion: null,
        dateRange: { start: '2026-07-10', end: '2026-07-12' },
        activities: [base],
      },
    });
    const result = applyItineraryLedgerCommand(
      trip,
      { type: 'itinerary.update', activityId: 'a-1', changes: { title: '改名' } },
      b0Context([]),
      noDeps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.itinerary.activities[0]).toMatchObject({ title: '改名', perPersonEstimate: 1_000 });
  });

  it('费用被结算锁定时映射为 LOCKED；语义校验返回 BusinessError[]', () => {
    const trip = makeCanonicalLedgerTrip();
    const locked = applyItineraryLedgerCommand(
      {
        ...trip,
        settlements: [
          {
            id: 's-1', commandId: 'c-1', fromId: 'm-c', toId: 'm-a',
            amount: 10_000, recordedAt: NOW, voidedAt: null,
          },
        ],
      },
      {
        type: 'ledger.addExpense',
        expense: {
          id: 'e-2', title: '新增', date: '2026-07-10', category: '餐饮', amount: 1_000,
          payerId: 'm-a', splitMode: 'equal',
          allocations: [{ memberId: 'm-a', amount: 1_000 }], createdAt: NOW,
        },
      },
      b0Context([]),
      noDeps,
    );
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(locked.error.code).toBe('LOCKED');

    const corrupt: typeof trip = {
      ...makeTrip(),
      expenses: [
        {
          id: 'e-x', title: '错误', date: '2026-07-10', category: '餐饮', amount: 1_000,
          payerId: 'm-z', splitMode: 'custom',
          allocations: [{ memberId: 'm-a', amount: 999 }], createdAt: NOW,
        },
      ],
    };
    const issues = validateItineraryLedgerTrip(corrupt);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => typeof issue.message === 'string')).toBe(true);
  });

  it('纯领域入口 applyDomainCommand / validateDomainTrip 仍可直接调用', () => {
    const trip = makeTrip();
    const result = applyDomainCommand(
      trip,
      {
        type: 'ledger.addExpense',
        commandId: 'c-1',
        draft: {
          title: '门票', date: '2026-07-10', category: '活动', amount: 1_000,
          payerId: 'm-a', splitMode: 'custom',
          allocations: [{ memberId: 'm-a', amount: 1_000 }],
        },
      },
      makeContext(),
    );
    expect(result.ok).toBe(true);
    expect(validateDomainTrip(result.ok ? result.trip : trip)).toEqual([]);
  });
});

describe('B0 模板日程 Builder 注入', () => {
  const template: DestinationTemplate = {
    id: 'dest-qd', version: 1, name: '青岛', tags: [], supportedDays: [3], assetId: 'qd',
    estimate: { lodgingPerNight: 100, foodPerDay: 50, activities: 200, reserve: 100 },
    activities: [
      {
        key: 'day1-arrive', dayOffset: 0, title: '抵达', category: '交通',
        startTime: '09:30', endTime: '11:00', budgetBucket: 'included',
        perPersonEstimate: null, note: '',
      },
      {
        key: 'day2-walk', dayOffset: 1, title: '沿海散步', category: '活动',
        startTime: null, endTime: null, budgetBucket: 'activities',
        perPersonEstimate: 0, note: '',
      },
    ],
  };

  it('buildTemplateItineraryForB0 返回完整 itinerary，使用预分配 IDs', () => {
    const plan = makePlan('p-1', { destinationId: 'dest-qd', templateVersion: 1, startDate: '2026-07-10', days: 3 });
    const result = buildBuilder({ plan, template, ids: ['act-1', 'act-2'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourcePlanId).toBe('p-1');
    expect(result.value.sourcePlanVersion).toBe(1);
    expect(result.value.dateRange).toEqual({ start: '2026-07-10', end: '2026-07-12' });
    expect(result.value.activities.map((a) => a.id)).toEqual(['act-1', 'act-2']);
    expect(result.value.activities[0]).toMatchObject({ budgetBucket: 'included', perPersonEstimate: null });
  });

  it('ids 不足时返回 VALIDATION；重导出 buildTemplateItinerary 与 B0 适配函数一致', () => {
    const plan = makePlan('p-1', { destinationId: 'dest-qd', templateVersion: 1 });
    const result = buildTemplateItineraryForB0({ plan, template, ids: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION');
    expect(buildBuilder).toBe(buildTemplateItineraryForB0);
  });
});
