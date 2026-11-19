import { describe, expect, it } from 'vitest';
import { getPlanEvaluations, getCurrentIntent, computePreferenceScore, evaluateMemberAgainstPlan, evaluateMembersAgainstPlan, createIntentLookup } from '../../../src/domain/planning/evaluation';
import { toPlanningContext } from '../../../src/domain/planning/commands';
import { fixtureDeps, makeMember, makePlan, makeTrip } from './fixtures';

const window = { start: '2026-07-01', end: '2026-07-30' };

function contextOf(members: ReturnType<typeof makeMember>[], plans: ReturnType<typeof makePlan>[], opts?: { constraintRevision?: number; intents?: never[] }) {
  return toPlanningContext(
    makeTrip({
      members,
      plans,
      searchWindow: window,
      constraintRevision: opts?.constraintRevision ?? 1,
      intents: opts?.intents ?? [],
    }),
  );
}

describe('逐成员适配状态（BR-05）', () => {
  it('单方案索引隔离方案和版本，并按最新时间及稳定尾序选择意向', () => {
    const base = { memberId: 'm1', planId: 'p1', planVersion: 2, constraintRevision: 3, value: 'approve' as const, source: 'demo' as const, recordedAt: '2026-07-01T00:00:00Z' };
    const intents = [base,
      { ...base, planId: 'other', recordedAt: '2026-07-03T00:00:00Z' },
      { ...base, planVersion: 1, recordedAt: '2026-07-03T00:00:00Z' },
      { ...base, constraintRevision: 2, recordedAt: '2026-07-03T00:00:00Z' },
      { ...base, value: 'decline' as const, recordedAt: '2026-07-02T00:00:00Z' },
      { ...base, value: 'acceptable' as const, recordedAt: '2026-07-02T00:00:00Z' }];
    const lookup = createIntentLookup(intents, { planId: 'p1', planVersion: 2, constraintRevision: 3 });
    expect(lookup('m1', 'p1', 2, 3)).toEqual(getCurrentIntent(intents, 'm1', 'p1', 2, 3));
    expect(lookup('m1', 'p1', 2, 3)?.value).toBe('acceptable');
    expect(lookup('m1', 'other', 2, 3)).toBeUndefined();
    expect(lookup('m1', 'p1', 1, 3)).toBeUndefined();
    expect(lookup('m1', 'p1', 2, 2)).toBeUndefined();
    expect(lookup('missing', 'p1', 2, 3)).toBeUndefined();
  });

  it('批量确认保留日期合并、缺失资料、未知交通和预算边界的逐人结果', () => {
    const members = [
      makeMember({ id: 'equal', budgetCap: 144000 }),
      makeMember({ id: 'over', budgetCap: 143999 }),
      makeMember({ id: 'unknown', originCity: '拉萨', budgetCap: null }),
      makeMember({ id: 'missing', availability: [] }),
      makeMember({ id: 'invalid', availability: [{ start: '2026-02-30', end: '2026-07-31' }] }),
      makeMember({ id: 'adjacent', availability: [{ start: '2026-07-15', end: '2026-07-15' }, { start: '2026-07-16', end: '2026-07-17' }] }),
      makeMember({ id: 'gap', availability: [{ start: '2026-07-15', end: '2026-07-15' }, { start: '2026-07-17', end: '2026-07-17' }] }),
    ];
    const plan = makePlan();
    expect(evaluateMembersAgainstPlan(members, plan, fixtureDeps))
      .toEqual(members.map(member => evaluateMemberAgainstPlan(member, plan, fixtureDeps)));
    expect(evaluateMembersAgainstPlan([], plan, fixtureDeps)).toEqual([]);
  });

  it('资料缺失为待补充，不算匹配也不抬高适配（R01）', () => {
    const members = [makeMember({ id: 'm1' }), makeMember({ id: 'm2', budgetCap: null })];
    const result = getPlanEvaluations(contextOf(members, [makePlan()]), fixtureDeps);
    const byId = Object.fromEntries(result[0].members.map((s) => [s.memberId, s]));
    expect(byId.m1.overall).toBe('pass');
    // m2 缺预算：日期已知故时间可判定，但预算未知、整体只能待补充。
    expect(byId.m2.overall).toBe('unknown');
    expect(byId.m2.time).toBe('pass');
    expect(byId.m2.budget).toBe('unknown');
    expect(result[0].counts.unknownMembers).toEqual(['m2']);
    expect(result[0].allHardPass).toBe(false);
  });

  it('缺预算但日期已知时，已知的时间冲突仍如实显示（BR-05）', () => {
    const members = [
      makeMember({ id: 'm1' }),
      makeMember({ id: 'm2', budgetCap: null, availability: [{ start: '2026-08-01', end: '2026-08-05' }] }),
    ];
    const result = getPlanEvaluations(contextOf(members, [makePlan()]), fixtureDeps);
    const byId = Object.fromEntries(result[0].members.map((s) => [s.memberId, s]));
    expect(byId.m2.time).toBe('conflict');
    expect(byId.m2.overall).toBe('conflict');
    expect(result[0].counts.conflictMembers).toEqual(['m2']);
  });

  it('预算恰好等于个人估算时通过（R02）', () => {
    const members = [makeMember({ id: 'm1', budgetCap: 144000 })]; // E = 144000
    const result = getPlanEvaluations(contextOf(members, [makePlan()]), fixtureDeps);
    expect(result[0].members[0].budget).toBe('pass');
    expect(result[0].members[0].overall).toBe('pass');
  });

  it('超预算给出具体差额', () => {
    const members = [makeMember({ id: 'm1', budgetCap: 143000 })];
    const result = getPlanEvaluations(contextOf(members, [makePlan()]), fixtureDeps);
    expect(result[0].members[0].budget).toBe('conflict');
    expect(result[0].members[0].overBudgetBy).toBe(1000);
  });

  it('时间与预算双重冲突的成员只计一次（R04）', () => {
    const members = [
      makeMember({ id: 'm1' }),
      makeMember({
        id: 'm2',
        budgetCap: 10000, // ¥100，必然超预算
        availability: [{ start: '2026-08-01', end: '2026-08-05' }], // 必然时间冲突
      }),
    ];
    const result = getPlanEvaluations(contextOf(members, [makePlan()]), fixtureDeps);
    expect(result[0].counts.conflictMembers).toEqual(['m2']); // 去重后 1 人
    expect(result[0].counts.timePass).toBe(1);
    expect(result[0].counts.budgetPass).toBe(1);
    expect(result[0].allHardPass).toBe(false);
  });

  it('未知交通使估算不完整，但不是明确冲突', () => {
    const members = [makeMember({ id: 'm1', originCity: '拉萨' })];
    const result = getPlanEvaluations(contextOf(members, [makePlan()]), fixtureDeps);
    expect(result[0].members[0].estimate).toBeNull();
    expect(result[0].members[0].overall).toBe('unknown');
    expect(result[0].estimateComplete).toBe(false);
    expect(result[0].estimateRange).toBeNull();
    expect(result[0].totalEstimate).toBeNull();
  });

  it('估算区间反映出发地差异，全员相同为单一值', () => {
    const members = [makeMember({ id: 'm1', originCity: '上海' }), makeMember({ id: 'm2', originCity: '杭州' })];
    const result = getPlanEvaluations(contextOf(members, [makePlan()]), fixtureDeps);
    expect(result[0].estimateRange).toEqual({ min: 144000, max: 151000 }); // 上海 144000、杭州 151000
    const sameCity = [makeMember({ id: 'm1', originCity: '上海' }), makeMember({ id: 'm2', originCity: '上海' })];
    const r2 = getPlanEvaluations(contextOf(sameCity, [makePlan()]), fixtureDeps);
    expect(r2[0].estimateRange).toEqual({ min: 144000, max: 144000 });
  });
});

describe('偏好分（BR-05）', () => {
  it('无偏好成员不参与平均；全部无偏好为 0', () => {
    const none = [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })];
    expect(computePreferenceScore(none, ['海边'])).toBe(0);
    const mixed = [makeMember({ id: 'm1', preferences: ['海边'] }), makeMember({ id: 'm2' })];
    expect(computePreferenceScore(mixed, ['海边'])).toBe(1); // 仅 m1 参与
  });

  it('按交集标签数占自身偏好数计分', () => {
    const member = makeMember({ id: 'm1', preferences: ['海边', '人文'] });
    expect(computePreferenceScore([member], ['海边'])).toBeCloseTo(0.5);
    expect(computePreferenceScore([member], ['海边', '人文'])).toBe(1);
    expect(computePreferenceScore([member], ['自然'])).toBe(0);
  });
});

describe('确定性排序（BR-05 元组）', () => {
  it('全员通过 > 冲突更少 > 待补充更少 > 偏好更高 > 合计更低 > 日期更早 > ID', () => {
    // m1/m2 全程可用；m3 只能 7/15 出发（对 7/20 方案时间冲突）。
    const members = [
      makeMember({ id: 'm1', budgetCap: 200000 }),
      makeMember({ id: 'm2', budgetCap: 200000 }),
      makeMember({ id: 'm3', budgetCap: 200000, availability: [{ start: '2026-07-15', end: '2026-07-17' }] }),
    ];
    const plans = [
      makePlan({ id: 'pz-late-culture', destinationId: 'dest-culture', startDate: '2026-07-20' }),
      makePlan({ id: 'pa-sea-15', startDate: '2026-07-15' }),
    ];
    const result = getPlanEvaluations(contextOf(members, plans), fixtureDeps);
    // pa-sea-15 全员通过排前；pz-late-culture 有 1 位时间冲突。
    expect(result.map((e) => e.planId)).toEqual(['pa-sea-15', 'pz-late-culture']);
    expect(result[1].counts.conflictMembers).toEqual(['m3']);
  });

  it('同等条件下偏好分更高者在前', () => {
    const members = [
      makeMember({ id: 'm1', budgetCap: 90000, preferences: ['海边'] }), // 两方案均预算冲突
    ];
    const plans = [
      makePlan({ id: 'pl-culture', destinationId: 'dest-culture' }),
      makePlan({ id: 'pl-sea' }),
    ];
    const result = getPlanEvaluations(contextOf(members, plans), fixtureDeps);
    expect(result.map((e) => e.planId)).toEqual(['pl-sea', 'pl-culture']);
  });

  it('偏好一致时合计更低在前；再按日期、ID', () => {
    const members = [makeMember({ id: 'm1', budgetCap: 200000 })];
    const plans = [
      makePlan({ id: 'pb-sea-20', startDate: '2026-07-20' }),
      makePlan({ id: 'pa-sea-15', startDate: '2026-07-15' }),
      makePlan({ id: 'pc-sea-15b', startDate: '2026-07-15' }),
      makePlan({ id: 'pd-culture', destinationId: 'dest-culture' }),
    ];
    const result = getPlanEvaluations(contextOf(members, plans), fixtureDeps);
    // pd-culture 合计 96000 最低；pa/pc 日期 7/15 相同按 ID；pb 最晚。
    expect(result.map((e) => e.planId)).toEqual(['pd-culture', 'pa-sea-15', 'pc-sea-15b', 'pb-sea-20']);
  });

  it('相同输入排序稳定（重复调用结果一致）', () => {
    const members = [makeMember({ id: 'm1' }), makeMember({ id: 'm2', originCity: '杭州' })];
    const plans = [
      makePlan({ id: 'p-1' }),
      makePlan({ id: 'p-2', startDate: '2026-07-16' }),
      makePlan({ id: 'p-3', destinationId: 'dest-culture' }),
    ];
    const first = getPlanEvaluations(contextOf(members, plans), fixtureDeps).map((e) => e.planId);
    const second = getPlanEvaluations(contextOf(members, plans), fixtureDeps).map((e) => e.planId);
    expect(first).toEqual(second);
  });
});

describe('当前意向（BR-06）', () => {
  it('仅绑定当前方案版本与约束版本的意向有效', () => {
    const intents = [
      { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'approve' as const, source: 'organizer' as const, recordedAt: '2026-06-01T00:00:00.000Z' },
      { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 2, value: 'decline' as const, source: 'organizer' as const, recordedAt: '2026-06-02T00:00:00.000Z' },
    ];
    expect(getCurrentIntent(intents, 'm1', 'p1', 1, 1)?.value).toBe('approve');
    expect(getCurrentIntent(intents, 'm1', 'p1', 1, 2)?.value).toBe('decline');
    expect(getCurrentIntent(intents, 'm1', 'p1', 1, 3)).toBeUndefined();
    expect(getCurrentIntent(intents, 'm1', 'p1', 2, 1)).toBeUndefined();
  });

  it('意向统计区分当前与过期：过期意向计为待反馈', () => {
    const members = [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })];
    const intents = [
      // m1 当前意向 approve；m2 的 approve 属于旧约束版本 → 待反馈。
      { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 2, value: 'approve' as const, source: 'organizer' as const, recordedAt: '2026-06-01T00:00:00.000Z' },
      { memberId: 'm2', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'approve' as const, source: 'organizer' as const, recordedAt: '2026-06-01T00:00:00.000Z' },
    ];
    const context = toPlanningContext(makeTrip({ members, plans: [makePlan({ id: 'p1' })], constraintRevision: 2, intents, searchWindow: window }));
    const result = getPlanEvaluations(context, fixtureDeps);
    expect(result[0].intents.approve).toBe(1);
    expect(result[0].intents.pending).toBe(1);
  });
});
