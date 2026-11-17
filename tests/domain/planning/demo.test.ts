import { describe, expect, it } from 'vitest';
import { createPlanningDemo } from '../../../src/data/demoPlanning';
import { TEMPLATE_V1, TRANSPORT_CITIES_V1 } from '../../../src/data/templates/v1';
import { planningDataDeps } from '../../../src/data/destinations';
import { DESTINATION_TAG_VOCABULARY } from '../../../src/data/destinations';
import { findCommonDepartures } from '../../../src/domain/planning/availability';
import { applyPlanningCommand, toPlanningContext, updateMemberConstraints } from '../../../src/domain/planning/commands';
import { canConfirmPlan } from '../../../src/domain/planning/consensus';
import { getPlanEvaluations } from '../../../src/domain/planning/evaluation';
import { validatePlanningTrip } from '../../../src/domain/planning/validation';
import type { Trip } from '../../../src/domain/planning/contract';
import { makeTrip } from './fixtures';

const TODAY = '2026-11-18';
const NOW = '2026-11-18T08:00:00.000Z';

function demoTrip(): Trip {
  const seed = createPlanningDemo({ today: TODAY, now: NOW });
  return makeTrip({
    id: 'demo-trip',
    name: '示例 · 毕业旅行',
    isDemo: true,
    constraintRevision: seed.constraintRevision,
    searchWindow: seed.searchWindow,
    duration: seed.duration,
    members: seed.members,
    plans: seed.plans,
    intents: seed.intents,
    confirmation: seed.confirmation,
  });
}

describe('内置模板 v1（数据完整性）', () => {
  it('至少 6 个目的地，覆盖海边/城市/人文/自然偏好', () => {
    expect(TEMPLATE_V1.destinations.length).toBeGreaterThanOrEqual(6);
    const tags = new Set(TEMPLATE_V1.destinations.flatMap((d) => d.tags));
    for (const tag of DESTINATION_TAG_VOCABULARY) expect(tags.has(tag)).toBe(true);
  });

  it('3 个出发城市 × 全部目的地均有往返交通', () => {
    for (const city of TRANSPORT_CITIES_V1) {
      for (const destination of TEMPLATE_V1.destinations) {
        expect(planningDataDeps.resolveTransport(1, city, destination.id)).toBeDefined();
      }
    }
    expect(planningDataDeps.resolveTransport(1, '拉萨', 'dest-qingdao')).toBeUndefined(); // 未知城市
    expect(planningDataDeps.resolveTransport(99, '上海', 'dest-qingdao')).toBeUndefined(); // 未知版本
  });

  it('3 天核心活动种子金额合计等于模板活动分项 A', () => {
    for (const destination of TEMPLATE_V1.destinations) {
      const sum = destination.activitySeeds
        .filter((seed) => seed.day <= 3 && seed.budgetBucket === 'activities')
        .reduce((total, seed) => total + (seed.perPersonEstimate ?? 0), 0);
      expect(sum, destination.id).toBe(destination.estimate.activities);
    }
  });

  it('支持时长合法且不超过种子覆盖天数', () => {
    for (const destination of TEMPLATE_V1.destinations) {
      const maxDay = Math.max(...destination.activitySeeds.map((seed) => seed.day));
      for (const days of destination.supportedDurations) {
        expect(days).toBeGreaterThanOrEqual(2);
        expect(days).toBeLessThanOrEqual(5);
        expect(days, destination.id).toBeLessThanOrEqual(maxDay);
      }
    }
  });
});

describe('规划示例种子（F06）', () => {
  it('成员与日期全部相对 today 生成且落在未来', () => {
    const seed = createPlanningDemo({ today: TODAY, now: NOW });
    expect(seed.members).toHaveLength(6);
    expect(seed.plans).toHaveLength(7);
    for (const member of seed.members) {
      for (const range of member.availability) {
        expect(range.start >= TODAY).toBe(true);
      }
    }
    for (const plan of seed.plans) {
      expect(plan.startDate >= TODAY).toBe(true);
    }
    expect(seed.searchWindow.start >= TODAY).toBe(true);
  });

  it('待操作成员资料完整、仅意向未反馈', () => {
    const seed = createPlanningDemo({ today: TODAY, now: NOW });
    const pending = seed.members.find((m) => m.id === seed.scenario.pendingMemberId)!;
    expect(pending.budgetCap).not.toBeNull();
    const pendingIntents = seed.intents.filter(
      (i) => i.memberId === pending.id && i.constraintRevision === seed.constraintRevision,
    );
    expect(pendingIntents).toHaveLength(0);
  });

  it('出发日 T+30 确为全体成员的共同出发日（由规则算出）', () => {
    const seed = createPlanningDemo({ today: TODAY, now: NOW });
    const result = findCommonDepartures(seed.members, seed.searchWindow, 3);
    expect(result.needsMoreInfo).toBe(false);
    expect(result.dates[0]).toBe(seed.plans.find((p) => p.id === seed.scenario.targetPlanId)!.startDate);
  });

  it('目标方案全员硬约束通过；代录待操作成员意向后可全员确认', () => {
    const seed = createPlanningDemo({ today: TODAY, now: NOW });
    const trip = makeTrip({
      constraintRevision: seed.constraintRevision,
      searchWindow: seed.searchWindow,
      duration: seed.duration,
      members: seed.members,
      plans: seed.plans,
      intents: seed.intents,
    });
    const before = getPlanEvaluations(toPlanningContext(trip), planningDataDeps);
    const target = before.find((e) => e.planId === seed.scenario.targetPlanId)!;
    expect(target.allHardPass).toBe(true);
    expect(target.counts.conflictMembers).toEqual([]);
    expect(target.counts.unknownMembers).toEqual([]);
    expect(target.intents.pending).toBe(1); // 仅周予安待反馈
    expect(canConfirmPlan(toPlanningContext(trip), target.planId, TODAY, planningDataDeps)).toBe(false);

    // 代录周予安意向（不改约束 → 不触发意向失效）后即可全员确认。
    const withIntent = applyPlanningCommand(
      trip,
      { type: 'plan.recordIntent', payload: { planId: target.planId, memberId: seed.scenario.pendingMemberId, value: 'approve', source: 'demo' } },
      { now: NOW, today: TODAY, newId: () => 'x', currentTemplateVersion: 1, deps: planningDataDeps },
    );
    expect(withIntent.ok).toBe(true);
    const confirmed = applyPlanningCommand(
      withIntent.ok ? withIntent.trip : trip,
      { type: 'plan.confirm', payload: { planId: target.planId } },
      {
        now: NOW,
        today: TODAY,
        newId: () => 'x',
        currentTemplateVersion: 1,
        deps: planningDataDeps,
        buildTemplateItinerary: ({ plan }) => ({
          sourcePlanId: plan.id,
          sourcePlanVersion: plan.version,
          dateRange: { start: plan.startDate, end: '2099-01-01' },
          activities: [],
        }),
      },
    );
    expect(confirmed.ok).toBe(true);
    expect(confirmed.ok && confirmed.trip.confirmation?.planId).toBe(target.planId);
  });

  it('预算 ¥1,500→¥1,100 后目标方案出现冲突与差额（验收脚本步骤 2）', () => {
    const seed = createPlanningDemo({ today: TODAY, now: NOW });
    const trip = makeTrip({
      constraintRevision: seed.constraintRevision,
      searchWindow: seed.searchWindow,
      duration: seed.duration,
      members: seed.members,
      plans: seed.plans,
      intents: seed.intents,
    });
    const m1 = seed.members[0]; // 林知夏，预算 ¥1,500
    expect(m1.budgetCap).toBe(150000);
    const updated = updateMemberConstraints(trip, m1.id, {
      name: m1.name,
      originCity: m1.originCity,
      budgetCap: 110000,
      availability: m1.availability,
      preferences: m1.preferences,
    });
    expect(updated.ok).toBe(true);
    const evaluations = getPlanEvaluations(toPlanningContext(updated.ok ? updated.trip : trip), planningDataDeps);
    const target = evaluations.find((e) => e.planId === seed.scenario.targetPlanId)!;
    const row = target.members.find((m) => m.memberId === m1.id)!;
    expect(row.budget).toBe('conflict');
    expect(row.overBudgetBy).toBe(34000); // E 144000 - 110000
    expect(target.counts.conflictMembers).toContain(m1.id);
  });

  it('时间冲突方案按日期规则呈现冲突成员', () => {
    const seed = createPlanningDemo({ today: TODAY, now: NOW });
    const trip = makeTrip({
      constraintRevision: seed.constraintRevision,
      searchWindow: seed.searchWindow,
      duration: seed.duration,
      members: seed.members,
      plans: seed.plans,
      intents: seed.intents,
    });
    const evaluations = getPlanEvaluations(toPlanningContext(trip), planningDataDeps);
    const timeConflict = evaluations.find((e) => e.planId === seed.scenario.timeConflictPlanId)!;
    const expected = [...seed.members]
      .filter((m) => m.id === 'demo-m2' || m.id === 'demo-m3' || m.id === 'demo-m5')
      .map((m) => m.id);
    expect(timeConflict.counts.conflictMembers).toEqual(expected);
  });

  it('旧意向为失效历史：当前统计不计入', () => {
    const seed = createPlanningDemo({ today: TODAY, now: NOW });
    const trip = makeTrip({
      constraintRevision: seed.constraintRevision,
      searchWindow: seed.searchWindow,
      duration: seed.duration,
      members: seed.members,
      plans: seed.plans,
      intents: seed.intents,
    });
    const evaluations = getPlanEvaluations(toPlanningContext(trip), planningDataDeps);
    const target = evaluations.find((e) => e.planId === seed.scenario.targetPlanId)!;
    // 陈亦舟当前为 acceptable（organizer），constraintRevision=1 的 decline 是历史。
    expect(target.intents.byMember['demo-m2']?.value).toBe('acceptable');
    expect(target.intents.approve).toBe(3);
    expect(target.intents.acceptable).toBe(2);
    expect(target.intents.decline).toBe(0);
    expect(target.intents.pending).toBe(1); // 周予安待反馈
  });

  it('种子通过规划域校验；相同输入产出完全一致', () => {
    expect(validatePlanningTrip(demoTrip(), planningDataDeps)).toEqual([]);
    const a = createPlanningDemo({ today: TODAY, now: NOW });
    const b = createPlanningDemo({ today: TODAY, now: NOW });
    expect(a).toEqual(b);
  });
});
