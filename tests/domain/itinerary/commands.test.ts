import { describe, expect, it } from 'vitest';
import { applyItineraryCommand } from '../../../src/domain/itinerary/commands';
import { buildTemplateItinerary } from '../../../src/domain/itinerary/template';
import type { TemplateActivitySeed } from '../../../src/domain/itinerary/template';
import {
  makeActivity,
  makeContext,
  makePlan,
  makeTrip,
} from '../ledger/fixtures';

function tripWithRange(start = '2026-07-10', end = '2026-07-12') {
  return makeTrip({
    itinerary: {
      sourcePlanId: null,
      sourcePlanVersion: null,
      dateRange: { start, end },
      activities: [],
    },
  });
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-07-10',
    startTime: null as string | null,
    endTime: null as string | null,
    title: '沿海散步',
    category: '活动',
    budgetBucket: 'activities' as const,
    perPersonEstimate: null as number | null,
    note: '',
    ...overrides,
  };
}

describe('itinerary.add 新增活动（BR-08）', () => {
  it('未绑定范围时要求先选择日程范围（不能保存无法解释的日期）', () => {
    const result = applyItineraryCommand(
      makeTrip(),
      { type: 'itinerary.add', commandId: 'c-1', activity: draft() },
      makeContext(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NEED_DATE_RANGE');
  });

  it('草稿范围须在搜索窗口内，绑定后可添加并落位', () => {
    const outside = applyItineraryCommand(
      makeTrip(),
      {
        type: 'itinerary.add',
        commandId: 'c-1',
        activity: draft(),
        draftDateRange: { start: '2026-06-01', end: '2026-06-03' },
      },
      makeContext(),
    );
    expect(outside.ok).toBe(false);
    if (outside.ok) return;
    expect(outside.error.code).toBe('DATE_OUT_OF_RANGE');

    const inside = applyItineraryCommand(
      makeTrip(),
      {
        type: 'itinerary.add',
        commandId: 'c-2',
        activity: draft({ date: '2026-07-15' }),
        draftDateRange: { start: '2026-07-15', end: '2026-07-17' },
      },
      makeContext(),
    );
    expect(inside.ok).toBe(true);
    if (!inside.ok) return;
    expect(inside.trip.itinerary.dateRange).toEqual({ start: '2026-07-15', end: '2026-07-17' });
    expect(inside.trip.itinerary.activities).toHaveLength(1);
  });

  it('日期超出已绑定范围阻止保存；范围内通过', () => {
    const trip = tripWithRange();
    const out = applyItineraryCommand(
      trip,
      { type: 'itinerary.add', commandId: 'c-1', activity: draft({ date: '2026-07-13' }) },
      makeContext(),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe('DATE_OUT_OF_RANGE');

    const inRange = applyItineraryCommand(
      trip,
      { type: 'itinerary.add', commandId: 'c-2', activity: draft({ date: '2026-07-12' }) },
      makeContext(),
    );
    expect(inRange.ok).toBe(true);
  });

  it('非法起止时间阻止保存（同填同空、结束晚于开始）', () => {
    const trip = tripWithRange();
    const incomplete = applyItineraryCommand(
      trip,
      { type: 'itinerary.add', commandId: 'c-1', activity: draft({ startTime: '09:00' }) },
      makeContext(),
    );
    expect(incomplete.ok).toBe(false);
    if (incomplete.ok) return;
    expect(incomplete.error.code).toBe('TIME_INCOMPLETE');

    const reversed = applyItineraryCommand(
      trip,
      { type: 'itinerary.add', commandId: 'c-2', activity: draft({ startTime: '10:00', endTime: '09:00' }) },
      makeContext(),
    );
    expect(reversed.ok).toBe(false);
    if (reversed.ok) return;
    expect(reversed.error.code).toBe('TIME_ORDER');
  });

  it('included 条目不能填金额；activities 允许明确 0 与待估算，负数被拒', () => {
    const trip = tripWithRange();
    const included = applyItineraryCommand(
      trip,
      {
        type: 'itinerary.add',
        commandId: 'c-1',
        activity: draft({ budgetBucket: 'included', perPersonEstimate: 100 }),
      },
      makeContext(),
    );
    expect(included.ok).toBe(false);
    if (included.ok) return;
    expect(included.error.code).toBe('INVALID_ESTIMATE');

    const zero = applyItineraryCommand(
      trip,
      { type: 'itinerary.add', commandId: 'c-2', activity: draft({ perPersonEstimate: 0 }) },
      makeContext(),
    );
    expect(zero.ok).toBe(true);

    const negative = applyItineraryCommand(
      trip,
      { type: 'itinerary.add', commandId: 'c-3', activity: draft({ perPersonEstimate: -1 }) },
      makeContext(),
    );
    expect(negative.ok).toBe(false);
  });

  it('名称、类别、备注校验与 100 条上限', () => {
    const trip = tripWithRange();
    const badTitle = applyItineraryCommand(
      trip,
      { type: 'itinerary.add', commandId: 'c-1', activity: draft({ title: '' }) },
      makeContext(),
    );
    expect(badTitle.ok).toBe(false);

    const badNote = applyItineraryCommand(
      trip,
      { type: 'itinerary.add', commandId: 'c-2', activity: draft({ note: '长'.repeat(301) }) },
      makeContext(),
    );
    expect(badNote.ok).toBe(false);

    const activities = Array.from({ length: 100 }, (_, index) =>
      makeActivity(`a-${index}`, { date: '2026-07-10', order: index }),
    );
    const limited = applyItineraryCommand(
      makeTrip({
        itinerary: {
          sourcePlanId: null,
          sourcePlanVersion: null,
          dateRange: { start: '2026-07-10', end: '2026-07-12' },
          activities,
        },
      }),
      { type: 'itinerary.add', commandId: 'c-3', activity: draft() },
      makeContext(),
    );
    expect(limited.ok).toBe(false);
    if (limited.ok) return;
    expect(limited.error.code).toBe('LIMIT_ACTIVITIES');
  });
});

describe('itinerary.update / remove / move', () => {
  it('修改保留 id 与 order；日期越界与不存在活动被拒', () => {
    const trip = tripWithRange('2026-07-10', '2026-07-12');
    const withActivity = {
      ...trip,
      itinerary: { ...trip.itinerary, activities: [makeActivity('a-1', { order: 3 })] },
    };
    const updated = applyItineraryCommand(
      withActivity,
      {
        type: 'itinerary.update',
        commandId: 'c-1',
        activityId: 'a-1',
        activity: draft({ title: '改名', perPersonEstimate: 500 }),
      },
      makeContext(),
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.trip.itinerary.activities[0]).toMatchObject({ id: 'a-1', order: 3, title: '改名' });
    expect(updated.trip.itinerary.activities[0]!.perPersonEstimate).toBe(500);

    const outOfRange = applyItineraryCommand(
      withActivity,
      {
        type: 'itinerary.update',
        commandId: 'c-2',
        activityId: 'a-1',
        activity: draft({ date: '2026-07-20' }),
      },
      makeContext(),
    );
    expect(outOfRange.ok).toBe(false);

    const missing = applyItineraryCommand(
      withActivity,
      {
        type: 'itinerary.update',
        commandId: 'c-3',
        activityId: 'nope',
        activity: draft(),
      },
      makeContext(),
    );
    expect(missing.ok).toBe(false);
  });

  it('删除活动；移动通过命令层生效', () => {
    const base = tripWithRange('2026-07-10', '2026-07-10');
    const trip = {
      ...base,
      itinerary: {
        ...base.itinerary,
        activities: [
          makeActivity('u-1', { date: '2026-07-10', order: 1 }),
          makeActivity('u-2', { date: '2026-07-10', order: 2 }),
        ],
      },
    };
    const moved = applyItineraryCommand(
      trip,
      { type: 'itinerary.move', commandId: 'c-1', activityId: 'u-2', direction: 'up' },
      makeContext(),
    );
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      const orders = new Map(moved.trip.itinerary.activities.map((a) => [a.id, a.order]));
      expect(orders.get('u-1')).toBe(2);
      expect(orders.get('u-2')).toBe(1);
    }
    const removed = applyItineraryCommand(
      trip,
      { type: 'itinerary.remove', commandId: 'c-2', activityId: 'u-1' },
      makeContext(),
    );
    expect(removed.ok && removed.trip.itinerary.activities).toHaveLength(1);
  });
});

describe('itinerary.replaceFromTemplate（BR-08）', () => {
  const seeds: TemplateActivitySeed[] = [
    {
      dayOffset: 0,
      startTime: '09:30',
      endTime: '11:00',
      title: '抵达与集合',
      category: '交通',
      budgetBucket: 'included',
      perPersonEstimate: null,
      note: '',
    },
    {
      dayOffset: 1,
      startTime: null,
      endTime: null,
      title: '沿海散步',
      category: '活动',
      budgetBucket: 'activities',
      perPersonEstimate: 0,
      note: '',
    },
  ];

  it('方案不存在或版本不一致时拒绝', () => {
    const trip = tripWithRange();
    const noPlan = applyItineraryCommand(
      trip,
      {
        type: 'itinerary.replaceFromTemplate',
        commandId: 'c-1',
        planId: 'nope',
        planVersion: 1,
        template: { destinationId: 'd1', templateVersion: 1, seeds },
        startDate: '2026-07-10',
        days: 3,
      },
      makeContext(),
    );
    expect(noPlan.ok).toBe(false);
    if (noPlan.ok) return;
    expect(noPlan.error.code).toBe('PLAN_NOT_FOUND');

    const withPlan = makeTrip({
      plans: [makePlan('p-1', { version: 3 })],
      itinerary: trip.itinerary,
    });
    const versionMismatch = applyItineraryCommand(
      withPlan,
      {
        type: 'itinerary.replaceFromTemplate',
        commandId: 'c-2',
        planId: 'p-1',
        planVersion: 1,
        template: { destinationId: 'd1', templateVersion: 1, seeds },
        startDate: '2026-07-10',
        days: 3,
      },
      makeContext(),
    );
    expect(versionMismatch.ok).toBe(false);
    if (versionMismatch.ok) return;
    expect(versionMismatch.error.code).toBe('PLAN_NOT_FOUND');
  });

  it('整体替换日程并绑定来源与范围；再次替换不重复追加', () => {
    const trip = makeTrip({
      plans: [makePlan('p-1')],
      itinerary: {
        sourcePlanId: null,
        sourcePlanVersion: null,
        dateRange: null,
        activities: [makeActivity('old-1', { date: '2026-07-10', order: 0 })],
      },
    });
    const ctx = makeContext();
    const command = {
      type: 'itinerary.replaceFromTemplate' as const,
      commandId: 'c-1',
      planId: 'p-1',
      planVersion: 1,
      template: { destinationId: 'd1', templateVersion: 1, seeds },
      startDate: '2026-07-10',
      days: 3 as const,
    };
    const first = applyItineraryCommand(trip, command, ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.trip.itinerary.activities.map((a) => a.title)).toEqual(['抵达与集合', '沿海散步']);
    expect(first.trip.itinerary).toMatchObject({
      sourcePlanId: 'p-1',
      sourcePlanVersion: 1,
      dateRange: { start: '2026-07-10', end: '2026-07-12' },
    });

    const again = applyItineraryCommand(first.trip, command, ctx);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.trip.itinerary.activities).toHaveLength(2); // 不重复追加
  });

  it('模板非法时拒绝且不改变原日程', () => {
    const trip = makeTrip({
      plans: [makePlan('p-1')],
      itinerary: {
        sourcePlanId: null,
        sourcePlanVersion: null,
        dateRange: null,
        activities: [makeActivity('old-1', { date: '2026-07-10', order: 0 })],
      },
    });
    const result = applyItineraryCommand(
      trip,
      {
        type: 'itinerary.replaceFromTemplate',
        commandId: 'c-1',
        planId: 'p-1',
        planVersion: 1,
        template: {
          destinationId: 'd1',
          templateVersion: 1,
          seeds: [{ ...seeds[0]!, dayOffset: 5 }],
        },
        startDate: '2026-07-10',
        days: 3,
      },
      makeContext(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TEMPLATE_INVALID');
    expect(trip.itinerary.activities).toHaveLength(1);
  });

  it('与纯构建器结果一致（供 T02 确认流程注入复用）', () => {
    const built = buildTemplateItinerary({
      template: { destinationId: 'd1', templateVersion: 1, seeds },
      startDate: '2026-07-10',
      days: 3,
      allocateId: makeContext().allocateId,
    });
    expect(built.ok && built.activities).toHaveLength(2);
    expect(built.ok && built.activities[0]).toMatchObject({
      date: '2026-07-10',
      startTime: '09:30',
      budgetBucket: 'included',
      perPersonEstimate: null,
    });
  });
});
