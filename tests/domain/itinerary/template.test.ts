import { describe, expect, it } from 'vitest';
import {
  buildTemplateItinerary,
  previewTemplateReplacement,
  rebindItineraryToPlan,
  type ItineraryTemplate,
  type TemplateActivitySeed,
} from '../../../src/domain/itinerary/template';
import { makeActivity, makeContext, makeTrip } from '../ledger/fixtures';

function seed(overrides: Partial<TemplateActivitySeed> = {}): TemplateActivitySeed {
  return {
    dayOffset: 0,
    startTime: null,
    endTime: null,
    title: '示例活动',
    category: '活动',
    budgetBucket: 'activities',
    perPersonEstimate: 2_000,
    note: '',
    ...overrides,
  };
}

function template(seeds: TemplateActivitySeed[]): ItineraryTemplate {
  return { destinationId: 'dest-qingdao', templateVersion: 1, seeds };
}

describe('buildTemplateItinerary 模板构建（PRD F03）', () => {
  it('按 dayOffset 映射日期（跨月正确），order 按天次与种子顺序递增', () => {
    const result = buildTemplateItinerary({
      template: template([
        seed({ dayOffset: 1, title: '第二天活动', startTime: '09:00', endTime: '10:00' }),
        seed({ dayOffset: 0, title: '抵达', budgetBucket: 'included', perPersonEstimate: null }),
        seed({ dayOffset: 1, title: '第二天晚间', perPersonEstimate: 0 }),
      ]),
      startDate: '2026-07-31',
      days: 2,
      allocateId: makeContext().allocateId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activities.map((activity) => activity.date)).toEqual([
      '2026-07-31',
      '2026-08-01',
      '2026-08-01',
    ]);
    expect(result.activities.map((activity) => activity.title)).toEqual(['抵达', '第二天活动', '第二天晚间']);
    expect(result.activities.map((activity) => activity.order)).toEqual([0, 1, 2]);
    // included 强制金额为空；activities 保留 0（明确零费用）
    expect(result.activities[0]).toMatchObject({ budgetBucket: 'included', perPersonEstimate: null });
    expect(result.activities[2]).toMatchObject({ budgetBucket: 'activities', perPersonEstimate: 0 });
  });

  it('同一输入重复构建产出相同结构（新 ID），首次生成不重复追加由命令层保证', () => {
    const args = {
      template: template([seed(), seed({ dayOffset: 1 })]),
      startDate: '2026-07-10',
      days: 2,
      allocateId: makeContext().allocateId,
    } as const;
    const first = buildTemplateItinerary(args);
    const second = buildTemplateItinerary(args);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(
      first.activities.map((activity) => ({
        date: activity.date,
        startTime: activity.startTime,
        endTime: activity.endTime,
        title: activity.title,
        category: activity.category,
        budgetBucket: activity.budgetBucket,
        perPersonEstimate: activity.perPersonEstimate,
        note: activity.note,
        order: activity.order,
      })),
    ).toEqual(
      second.activities.map((activity) => ({
        date: activity.date,
        startTime: activity.startTime,
        endTime: activity.endTime,
        title: activity.title,
        category: activity.category,
        budgetBucket: activity.budgetBucket,
        perPersonEstimate: activity.perPersonEstimate,
        note: activity.note,
        order: activity.order,
      })),
    );
  });

  it.each([
    ['天次偏移越界', seed({ dayOffset: 2 }), 'TEMPLATE_INVALID'],
    ['included 带金额', seed({ budgetBucket: 'included', perPersonEstimate: 100 }), 'TEMPLATE_INVALID'],
    ['负金额', seed({ perPersonEstimate: -1 }), 'TEMPLATE_INVALID'],
    ['时间只填一个', seed({ startTime: '09:00', endTime: null }), 'TIME_INCOMPLETE'],
    ['名称为空', seed({ title: '  ' }), 'TEMPLATE_INVALID'],
  ])('校验失败：%s', (_name, badSeed, code) => {
    const result = buildTemplateItinerary({
      template: template([badSeed]),
      startDate: '2026-07-10',
      days: 2,
      allocateId: makeContext().allocateId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === code)).toBe(true);
  });

  it('出发日期非法时报错（如 2 月 30 日）', () => {
    const result = buildTemplateItinerary({
      template: template([seed()]),
      startDate: '2026-02-30',
      days: 2,
      allocateId: makeContext().allocateId,
    });
    expect(result.ok).toBe(false);
  });
});

describe('previewTemplateReplacement 替换影响预览（BR-08）', () => {
  it('展示将覆盖的条目数量与生成数量', () => {
    const current = [makeActivity('a-1'), makeActivity('a-2')];
    const next = [makeActivity('b-1'), makeActivity('b-2'), makeActivity('b-3')];
    expect(previewTemplateReplacement(current, next)).toEqual({ removedCount: 2, nextCount: 3 });
  });
});

describe('rebindItineraryToPlan 重新绑定（T02 保留日程路径）', () => {
  it('更新方案引用与日期范围，保留活动不动', () => {
    const trip = makeTrip({
      itinerary: {
        sourcePlanId: 'p-old',
        sourcePlanVersion: 1,
        dateRange: { start: '2026-07-10', end: '2026-07-12' },
        activities: [
          {
            id: 'a-1',
            date: '2026-07-10',
            startTime: null,
            endTime: null,
            title: '手工活动',
            category: '活动',
            budgetBucket: 'activities',
            perPersonEstimate: 1_000,
            note: '',
            order: 0,
          },
        ],
      },
    });
    const rebound = rebindItineraryToPlan(trip, {
      id: 'p-new',
      version: 2,
      startDate: '2026-08-01',
      days: 3,
    });
    expect(rebound.itinerary).toMatchObject({
      sourcePlanId: 'p-new',
      sourcePlanVersion: 2,
      dateRange: { start: '2026-08-01', end: '2026-08-03' },
    });
    // 旧活动保留（超范围由查询层标记），原 Trip 不被修改
    expect(rebound.itinerary.activities).toEqual(trip.itinerary.activities);
    expect(trip.itinerary.sourcePlanId).toBe('p-old');
  });
});
