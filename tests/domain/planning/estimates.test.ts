import { describe, expect, it } from 'vitest';
import {
  areEstimateParamsValid,
  computeEstimateBreakdown,
  estimateRangeOf,
  findMembersOverEstimateCap,
  resolveTransportCents,
} from '../../../src/domain/planning/estimates';
import { SEA_FROM_SHANGHAI_E, fixtureDeps, makeMember, makePlan } from './fixtures';

describe('个人基准估算 E_i（BR-04）', () => {
  it('E_i = T_i + H×(D-1) + F×D + A + R，精确到分', () => {
    const member = makeMember({ originCity: '上海' });
    const plan = makePlan({ days: 3 }); // dest-sea 默认参数
    const breakdown = computeEstimateBreakdown(plan, member, fixtureDeps);
    expect(breakdown.transport).toBe(49000);
    expect(breakdown.transportSource).toBe('table');
    expect(breakdown.lodging).toBe(22000 * 2); // H×(D-1)
    expect(breakdown.food).toBe(9000 * 3); // F×D
    expect(breakdown.activities).toBe(18000);
    expect(breakdown.reserve).toBe(6000);
    expect(breakdown.total).toBe(SEA_FROM_SHANGHAI_E); // 144000
  });

  it('D=5 时按 4 晚 5 天计算', () => {
    const member = makeMember({ originCity: '上海' });
    const plan = makePlan({ days: 5 });
    const breakdown = computeEstimateBreakdown(plan, member, fixtureDeps);
    expect(breakdown.lodging).toBe(22000 * 4);
    expect(breakdown.food).toBe(9000 * 5);
    expect(breakdown.total).toBe(49000 + 22000 * 4 + 9000 * 5 + 18000 + 6000);
  });

  it('未知城市/未知模板交通为未知，不当作 0 元', () => {
    const member = makeMember({ originCity: '拉萨' });
    const breakdown = computeEstimateBreakdown(makePlan(), member, fixtureDeps);
    expect(breakdown.transport).toBeNull();
    expect(breakdown.transportSource).toBe('unknown');
    expect(breakdown.total).toBeNull();
  });

  it('成员未填城市时交通未知', () => {
    const member = makeMember({ originCity: null });
    expect(resolveTransportCents(makePlan(), member, fixtureDeps).source).toBe('unknown');
  });
});

describe('手工交通估算（BR-04）', () => {
  it('覆盖值优先于交通表，且绑定保存时的城市', () => {
    const plan = makePlan({
      estimate: { transportByMember: { m1: { originCity: '上海', amount: 30000 } } },
    });
    const member = makeMember({ id: 'm1', originCity: '上海' });
    const resolved = resolveTransportCents(plan, member, fixtureDeps);
    expect(resolved).toEqual({ amount: 30000, source: 'override' });
  });

  it('成员换城市后旧覆盖值失效，回落查表', () => {
    const plan = makePlan({
      estimate: { transportByMember: { m1: { originCity: '上海', amount: 30000 } } },
    });
    const member = makeMember({ id: 'm1', originCity: '杭州' });
    const resolved = resolveTransportCents(plan, member, fixtureDeps);
    expect(resolved).toEqual({ amount: 56000, source: 'table' });
  });

  it('null 覆盖值表示按城市查表', () => {
    const plan = makePlan({ estimate: { transportByMember: { m1: null } } });
    const member = makeMember({ id: 'm1', originCity: '上海' });
    expect(resolveTransportCents(plan, member, fixtureDeps)).toEqual({ amount: 49000, source: 'table' });
  });
});

describe('估算区间与参数校验', () => {
  it('区间取已知值最低～最高；全部相同为单一值', () => {
    expect(estimateRangeOf([100, 300, 200])).toEqual({ min: 100, max: 300 });
    expect(estimateRangeOf([150, 150])).toEqual({ min: 150, max: 150 });
  });

  it('全部未知返回 null；部分未知只统计已知部分', () => {
    expect(estimateRangeOf([null, null])).toBeNull();
    expect(estimateRangeOf([100, null])).toEqual({ min: 100, max: 100 });
  });

  it('参数必须是非负整数分', () => {
    expect(areEstimateParamsValid({ lodgingPerNight: 0, foodPerDay: 1, activities: 10, reserve: 0 })).toBe(true);
    expect(areEstimateParamsValid({ lodgingPerNight: -1, foodPerDay: 1, activities: 10, reserve: 0 })).toBe(false);
    expect(areEstimateParamsValid({ lodgingPerNight: 1.5, foodPerDay: 1, activities: 10, reserve: 0 })).toBe(false);
  });

  it('超上限 ¥100,000 的成员可被定位', () => {
    // 构造超大参数：H=2000000/晚 × 4 晚已超上限。
    const plan = makePlan({
      days: 5,
      estimate: { lodgingPerNight: 2_600_000, foodPerDay: 0, activities: 0, reserve: 0 },
    });
    const members = [makeMember({ id: 'm1', originCity: '上海' }), makeMember({ id: 'm2', originCity: '上海' })];
    expect(findMembersOverEstimateCap(plan, members, fixtureDeps)).toEqual(['m1', 'm2']);
  });
});
