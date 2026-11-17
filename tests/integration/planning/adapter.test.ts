// 验证 B0 契约适配：CommandHandler/PlanningService 走扁平 payload 与 Result。
import { describe, expect, it } from 'vitest';
import { applyPlanningCommand, planningService, validatePlanningTripB0 } from '../../../src/domain/planning/adapter';
import { makeMember, makePlan, makeTrip, SEA_FROM_SHANGHAI_E } from '../../domain/planning/fixtures';
import type { CommandContext } from '../../../src/domain/commands';

const deps = { planning: planningService, buildTemplateItinerary: () => ({ ok: false as const, error: { code: 'NOT_IMPLEMENTED' as const, message: 'test' } }) };

const ctx: CommandContext = {
  now: '2026-07-01T08:00:00.000Z',
  today: '2026-07-01',
  ids: ['id-1', 'id-2'],
  commandId: 'cmd-1',
};

describe('B0 CommandHandler 适配', () => {
  it('member.add：扁平 payload → Result<Trip>，成员 ID 来自上层', () => {
    const trip = makeTrip();
    const result = applyPlanningCommand(trip, {
      type: 'member.add',
      member: { id: 'm2', name: '新成员', originCity: '上海', budgetCap: 150000, availability: [{ start: '2026-07-10', end: '2026-07-20' }], preferences: [] },
    }, ctx, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.members.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.value.constraintRevision).toBe(2);
  });

  it('member.update：仅传变更字段，其余沿用当前成员', () => {
    const trip = makeTrip({ members: [makeMember({ id: 'm1', name: '原名', budgetCap: 150000 })] });
    const result = applyPlanningCommand(trip, {
      type: 'member.update',
      memberId: 'm1',
      changes: { budgetCap: 110000 },
    }, ctx, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.members[0]).toMatchObject({ name: '原名', budgetCap: 110000 });
  });

  it('member.update：budgetCap 显式设为 null（未知）不被忽略', () => {
    const trip = makeTrip({ members: [makeMember({ id: 'm1', budgetCap: 150000 })] });
    const result = applyPlanningCommand(trip, {
      type: 'member.update',
      memberId: 'm1',
      changes: { budgetCap: null },
    }, ctx, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.members[0].budgetCap).toBeNull();
  });

  it('plan.recordIntent：返回结构化错误时不伪造成功', () => {
    const trip = makeTrip({ members: [], plans: [makePlan({ id: 'p1', destinationId: 'dest-qingdao' })] });
    const result = applyPlanningCommand(trip, {
      type: 'plan.recordIntent', memberId: 'ghost', planId: 'p1', value: 'approve', source: 'organizer',
    }, ctx, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('非规划命令明确拒绝', () => {
    const result = applyPlanningCommand(makeTrip(), { type: 'trip.rename', name: 'x' }, ctx, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('校验器返回 BusinessError[]', () => {
    const trip = makeTrip({
      members: [makeMember({ id: 'dup' }), makeMember({ id: 'dup' })],
      plans: [makePlan({ id: 'p1', destinationId: 'dest-moon' })],
    });
    const errors = validatePlanningTripB0(trip);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe('VALIDATION');
  });
});

describe('B0 PlanningService', () => {
  it('getPlanEvaluations：按 B0 形状返回逐成员评估', () => {
    const trip = makeTrip({
      members: [makeMember({ id: 'm1', budgetCap: 200000 })],
      plans: [makePlan({ id: 'p1', destinationId: 'dest-qingdao' })],
    });
    const result = planningService.getPlanEvaluations(trip);
    expect(result).toHaveLength(1);
    expect(result[0].feasible).toBe(true);
    expect(result[0].members[0]).toMatchObject({ memberId: 'm1', total: SEA_FROM_SHANGHAI_E, timeFits: true, budgetFits: true });
  });

  it('findCommonDepartures：返回日期数组', () => {
    const result = planningService.findCommonDepartures(
      [makeMember({ id: 'a', availability: [{ start: '2026-07-01', end: '2026-07-05' }] })],
      { start: '2026-07-01', end: '2026-07-10' },
      3,
    );
    expect(result[0]).toBe('2026-07-01');
  });

  it('updateMemberConstraints：仅变更预算时不丢失其他资料', () => {
    const trip = makeTrip({ members: [makeMember({ id: 'm1', name: '小林', budgetCap: 150000 })] });
    const result = planningService.updateMemberConstraints(trip, 'm1', { budgetCap: 110000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.members[0]).toMatchObject({ name: '小林', budgetCap: 110000 });
  });

  it('getTemplate：返回 B0 DestinationTemplate（含活动种子）', () => {
    const result = planningService.getTemplate('dest-qingdao', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('青岛');
    expect(result.value.activities.length).toBeGreaterThan(0);
    expect(planningService.getTemplate('dest-qingdao', 99).ok).toBe(false);
  });

  it('getConsensusStatus：条件齐全可确认，未反馈给出原因', () => {
    const trip = makeTrip({
      members: [makeMember({ id: 'm1', budgetCap: 200000 }), makeMember({ id: 'm2', budgetCap: 200000 })],
      plans: [makePlan({ id: 'p1', startDate: '2026-07-15', destinationId: 'dest-qingdao' })],
      intents: [
        { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'approve', source: 'organizer', recordedAt: 't' },
        { memberId: 'm2', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'acceptable', source: 'organizer', recordedAt: 't' },
      ],
    });
    expect(planningService.getConsensusStatus(trip, 'p1', '2026-07-01').canConfirm).toBe(true);
    const noIntents = { ...trip, intents: [] };
    expect(planningService.getConsensusStatus(noIntents, 'p1', '2026-07-01').reasons.length).toBeGreaterThan(0);
  });
});
