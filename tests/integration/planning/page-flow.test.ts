// T02 UI 集成：用 B0 的内存仓库 + 全部可达模块，走完整的
// “小队成员 → 生成候选 → 逐人评估 → 代录意向 → 确认”业务链，
// 证明页面调用的扁平命令载荷能被真实 handler 接受（不是静态展示）。
import { describe, expect, it } from 'vitest';
import { parseTrip } from '../../../src/domain/schema';
import { createEmptyTrip } from '../../../src/data/demo';
import { applyCommand } from '../../../src/app/application/commands';
import { planningService, applyPlanningCommand, validatePlanningTrip } from '../../../src/domain/planning';
import { createPlanningDemo } from '../../../src/data/demoPlanning';
import type { CommandContext } from '../../../src/domain/commands';
import type { CommandPayload } from '../../../src/domain/commands';
import type { DomainDependencies, DomainModule } from '../../../src/contracts/services';
import type { Trip } from '../../../src/domain/types';

const deps: DomainDependencies = {
  planning: planningService,
  buildTemplateItinerary: ({ plan }) => ({
    ok: true,
    value: {
      sourcePlanId: plan.id,
      sourcePlanVersion: plan.version,
      dateRange: { start: plan.startDate, end: '2026-12-31' },
      activities: [],
    },
  }),
};
const modules = { planning: { apply: applyPlanningCommand, validate: validatePlanningTrip } as DomainModule };
let seq = 0;

function run(trip: Trip, payload: CommandPayload) {
  const commandId = `cmd-${++seq}`;
  const commandCtx: CommandContext = { now: '2026-11-18T08:00:00.000Z', today: '2026-11-18', ids: [`id-${++seq}`], commandId };
  return applyCommand(trip, { commandId, tripId: trip.id, expectedRevision: trip.revision, payload }, commandCtx, modules, deps);
}

describe('T02 页面命令链（B0 真实 handler）', () => {
  it('小队添加成员 → 方案生成 → 意向 → 确认 全链路通过', () => {
    const empty = createEmptyTrip({ id: 'ui-trip', name: 'UI 测试', today: '2026-11-18', now: '2026-11-18T08:00:00.000Z' });
    const base = parseTrip(empty);
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    let trip = base.value;

    // 1) 小队：添加两位成员（与 SquadPage 的 member.add 载荷形状一致）
    for (const member of [
      { id: 'm-ui-1', name: '小林', originCity: '上海', budgetCap: 200000, availability: [{ start: '2026-12-01', end: '2026-12-20' }], preferences: ['海边'] },
      { id: 'm-ui-2', name: '小陈', originCity: '杭州', budgetCap: 200000, availability: [{ start: '2026-12-05', end: '2026-12-25' }], preferences: ['人文'] },
    ]) {
      const result = run(trip, { type: 'member.add', member });
      expect(result.ok).toBe(true);
      if (result.ok) trip = result.value;
    }
    expect(trip.members).toHaveLength(2);

    // 2) 方案：生成候选（与 PlansPage 的 plan.generate 载荷形状一致）
    const templateResult = planningService.getTemplate('dest-qingdao', 1);
    expect(templateResult.ok).toBe(true);
    if (!templateResult.ok) return;
    const generated = run(trip, {
      type: 'plan.generate',
      searchWindow: { start: '2026-11-20', end: '2026-12-31' },
      duration: 3,
      plans: [{
        id: 'plan-ui-1', version: 1, destinationId: 'dest-qingdao', templateVersion: 1,
        startDate: '2026-12-10', days: 3,
        estimate: { transportByMember: {}, ...templateResult.value.estimate },
      }],
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    trip = generated.value;

    // 3) 逐人评估（PlansPage 通过 services.planning 读取）
    const evaluations = planningService.getPlanEvaluations(trip);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0].feasible).toBe(true);

    // 4) 意向代录（PlansPage 的 plan.recordIntent 载荷形状）
    for (const memberId of ['m-ui-1', 'm-ui-2']) {
      const result = run(trip, { type: 'plan.recordIntent', memberId, planId: 'plan-ui-1', value: 'approve', source: 'organizer' });
      expect(result.ok).toBe(true);
      if (result.ok) trip = result.value;
    }

    // 5) 确认（PlansPage 的 plan.confirm 载荷；构建器生成日程）
    const confirmed = run(trip, { type: 'plan.confirm', planId: 'plan-ui-1', itineraryMode: 'replace' });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.value.confirmation?.planId).toBe('plan-ui-1');
    expect(confirmed.value.itinerary.sourcePlanId).toBe('plan-ui-1');
    expect(planningService.getConsensusStatus(confirmed.value, 'plan-ui-1', '2026-11-18').confirmed).toBe(true);
  });

  it('示例种子经小队/方案页的查询与写入路径可用', () => {
    const seed = createPlanningDemo({ today: '2026-11-18', now: '2026-11-18T08:00:00.000Z' });
    const base = createEmptyTrip({ id: 'demo-ui', name: '示例', today: '2026-11-18', now: '2026-11-18T08:00:00.000Z', isDemo: true });
    const built = parseTrip({
      ...base,
      constraintRevision: seed.constraintRevision,
      searchWindow: seed.searchWindow,
      duration: seed.duration,
      members: seed.members,
      plans: seed.plans,
      intents: seed.intents,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const trip = built.value;
    const evaluations = planningService.getPlanEvaluations(trip);
    const target = evaluations.find((e) => e.planId === seed.scenario.targetPlanId);
    expect(target?.feasible).toBe(true);
    expect(target?.members.every((m) => m.timeFits === true && m.budgetFits === true)).toBe(true);

    const pending = seed.scenario.pendingMemberId;
    const intentResult = run(trip, { type: 'plan.recordIntent', memberId: pending, planId: target!.planId, value: 'approve', source: 'demo' });
    expect(intentResult.ok).toBe(true);
  });
});
