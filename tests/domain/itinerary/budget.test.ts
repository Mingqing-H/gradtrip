import { describe, expect, it } from 'vitest';
import { getItineraryBudget } from '../../../src/domain/itinerary/budget';
import { makeActivity, makeMember } from '../ledger/fixtures';

const RANGE = { start: '2026-07-10', end: '2026-07-12' };

describe('getItineraryBudget 日程预算修订（BR-08）', () => {
  it('修订估算 = E_i - A + S：用日程活动替换方案活动分项，不叠加', () => {
    const summary = getItineraryBudget({
      activities: [
        makeActivity('a-1', { date: RANGE.start, perPersonEstimate: 3_000 }),
        makeActivity('a-2', { date: RANGE.start, perPersonEstimate: 5_000 }),
      ],
      planActivitiesEstimate: 20_000, // A = ¥200
      members: [makeMember('m-a', { budgetCap: 150_000 })],
      baseEstimates: { 'm-a': 150_000 }, // E = ¥1500
    });
    // E' = 150000 - 20000 + 8000 = 138000（若是叠加将得到 158000）
    expect(summary.perMember[0]?.revisedEstimate).toBe(138_000);
    expect(summary.complete).toBe(true);
  });

  it('included 条目不计入 S，也不算待估算', () => {
    const summary = getItineraryBudget({
      activities: [
        makeActivity('a-1', { budgetBucket: 'included', perPersonEstimate: null }),
        makeActivity('a-2', { perPersonEstimate: 1_000 }),
      ],
      planActivitiesEstimate: 10_000,
      members: [makeMember('m-a')],
      baseEstimates: { 'm-a': 50_000 },
    });
    expect(summary.knownActivitiesTotal).toBe(1_000);
    expect(summary.unknownActivityCount).toBe(0);
    expect(summary.includedCount).toBe(1);
    expect(summary.perMember[0]?.revisedEstimate).toBe(41_000);
  });

  it('R12：存在未知 activities 金额时修订估算标记未完成，未知不当零费用', () => {
    const summary = getItineraryBudget({
      activities: [
        makeActivity('a-1', { perPersonEstimate: 1_000 }),
        makeActivity('a-2', { perPersonEstimate: null }),
        makeActivity('a-3', { perPersonEstimate: null }),
      ],
      planActivitiesEstimate: 10_000,
      members: [makeMember('m-a')],
      baseEstimates: { 'm-a': 50_000 },
    });
    expect(summary.unknownActivityCount).toBe(2);
    expect(summary.complete).toBe(false);
    // 已知部分单独给出，不把未知当零
    expect(summary.knownActivitiesTotal).toBe(1_000);
    expect(summary.perMember[0]?.revisedEstimate).toBe(41_000);
  });

  it('成员基准估算未知（E_i 为 null）时修订估算为 null，不判断超预算', () => {
    const summary = getItineraryBudget({
      activities: [makeActivity('a-1', { perPersonEstimate: 1_000 })],
      planActivitiesEstimate: 10_000,
      members: [makeMember('m-a', { budgetCap: 10_000 }), makeMember('m-b', { budgetCap: 20_000 })],
      baseEstimates: { 'm-a': null, 'm-b': 30_000 },
    });
    const byId = new Map(summary.perMember.map((row) => [row.memberId, row]));
    expect(byId.get('m-a')).toMatchObject({ baseEstimate: null, revisedEstimate: null, overBudget: null });
    expect(summary.complete).toBe(false);
    // m-b：E' = 30000 - 10000 + 1000 = 21000 > 20000 超预算
    expect(byId.get('m-b')).toMatchObject({ revisedEstimate: 21_000, overBudget: true });
  });

  it('修订估算恰好等于预算上限不算超预算（边界含等）', () => {
    const summary = getItineraryBudget({
      activities: [],
      planActivitiesEstimate: 10_000,
      members: [makeMember('m-a', { budgetCap: 40_000 })],
      baseEstimates: { 'm-a': 50_000 },
    });
    expect(summary.perMember[0]?.revisedEstimate).toBe(40_000);
    expect(summary.perMember[0]?.overBudget).toBe(false);
  });

  it('空日程与空成员可用', () => {
    const summary = getItineraryBudget({
      activities: [],
      planActivitiesEstimate: 0,
      members: [],
      baseEstimates: {},
    });
    expect(summary).toMatchObject({ knownActivitiesTotal: 0, unknownActivityCount: 0, perMember: [] });
  });
});
