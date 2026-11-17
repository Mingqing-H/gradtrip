import { describe, expect, it } from 'vitest';
import {
  applyPlanningCommand,
  toPlanningContext,
  updateMemberConstraints,
} from '../../../src/domain/planning/commands';
import { getConsensusStatus } from '../../../src/domain/planning/consensus';
import type { Trip } from '../../../src/domain/planning/contract';
import { fixtureDeps, makeCtx, makeMember, makePlan, makeTrip } from './fixtures';

const window = { start: '2026-07-01', end: '2026-07-30' };

function baseTrip(overrides: Partial<Trip> = {}): Trip {
  return makeTrip({
    members: [makeMember({ id: 'm1', originCity: '上海' })],
    searchWindow: window,
    constraintRevision: 1,
    ...overrides,
  });
}

describe('member.add', () => {
  it('添加成员并递增约束版本；文本去除首尾空白', () => {
    const trip = baseTrip();
    const result = applyPlanningCommand(
      trip,
      {
        type: 'member.add',
        payload: {
          profile: {
            name: '  林知夏  ',
            originCity: ' 上海 ',
            budgetCap: 150000,
            availability: [{ start: '2026-07-10', end: '2026-07-20' }],
            preferences: ['海边', '海边'],
          },
        },
      },
      makeCtx({ newId: () => 'm-new' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.constraintRevision).toBe(2);
    const member = result.trip.members.find((m) => m.id === 'm-new');
    expect(member).toMatchObject({ name: '林知夏', originCity: '上海', budgetCap: 150000 });
    expect(member?.preferences).toEqual(['海边']); // 去重
  });

  it('达到 20 人上限后拒绝添加', () => {
    const members = Array.from({ length: 20 }, (_, i) => makeMember({ id: `m${i}` }));
    const result = applyPlanningCommand(
      baseTrip({ members }),
      { type: 'member.add', payload: { profile: { name: '超员', originCity: '上海', budgetCap: 1000, availability: [], preferences: [] } } },
      makeCtx(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'member.limit-reached' } });
  });

  it('资料不合法时返回逐字段错误', () => {
    const result = applyPlanningCommand(
      baseTrip(),
      { type: 'member.add', payload: { profile: { name: '', originCity: null, budgetCap: -5, availability: [], preferences: [] } } },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('member.invalid-profile');
    const fields = (result.error.details as { field: string }[]).map((d) => d.field);
    expect(fields).toContain('name');
    expect(fields).toContain('originCity');
    expect(fields).toContain('budgetCap');
    expect(fields).toContain('availability');
  });
});

describe('updateMemberConstraints / member.update', () => {
  const profile = (over: Partial<Parameters<typeof updateMemberConstraints>[2]> = {}) => ({
    name: '测试成员',
    originCity: '上海',
    budgetCap: 150000,
    availability: [{ start: '2026-07-10', end: '2026-07-31' }],
    preferences: [],
    ...over,
  });

  it('相同值保存不增加版本（BR-02 / R10）', () => {
    const trip = baseTrip();
    const result = updateMemberConstraints(trip, 'm1', profile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.trip).toBe(trip); // 原对象原样返回
  });

  it('修改预算使共识失效：constraintRevision 递增、旧意向成为历史', () => {
    const trip = baseTrip({
      constraintRevision: 3,
      plans: [makePlan({ id: 'p1' })],
      intents: [
        { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 3, value: 'approve', source: 'organizer', recordedAt: '2026-06-20T00:00:00.000Z' },
      ],
      confirmation: { planId: 'p1', planVersion: 1, constraintRevision: 3, confirmedAt: '2026-06-21T00:00:00.000Z' },
    });
    const result = updateMemberConstraints(trip, 'm1', profile({ budgetCap: 110000 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.trip.constraintRevision).toBe(4);
    expect(result.trip.intents).toHaveLength(1); // 旧意向保留为历史
    // 旧意向不再绑定当前版本（未反馈），确认快照因约束版本变化失效。
    const status = getConsensusStatus(toPlanningContext(result.trip), fixtureDeps);
    expect(status.status).toBe('needsReconfirm');
    expect(status.reason?.kind).toBe('constraints-changed');
  });

  it('成员不存在时报错', () => {
    expect(updateMemberConstraints(baseTrip(), 'ghost', profile())).toMatchObject({ ok: false });
  });
});

describe('member.remove', () => {
  it('移除成员并级联清理意向与手工交通', () => {
    const trip = baseTrip({
      members: [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })],
      plans: [makePlan({ id: 'p1', estimate: { transportByMember: { m1: { originCity: '上海', amount: 1 } } } })],
      intents: [
        { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'approve', source: 'organizer', recordedAt: 't' },
        { memberId: 'm2', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'approve', source: 'organizer', recordedAt: 't' },
      ],
    });
    const result = applyPlanningCommand(trip, { type: 'member.remove', payload: { memberId: 'm1' } }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.members.map((m) => m.id)).toEqual(['m2']);
    expect(result.trip.constraintRevision).toBe(2);
    expect(result.trip.intents.every((i) => i.memberId !== 'm1')).toBe(true);
    expect(result.trip.plans[0].estimate.transportByMember).toEqual({});
  });

  it('被费用引用（垫付或参与）不可删除并给出记录定位', () => {
    const trip = baseTrip({
      expenses: [
        {
          id: 'e1',
          title: '住宿',
          date: '2026-07-16',
          category: 'lodging',
          amount: 30000,
          payerId: 'm1',
          splitMode: 'equal',
          allocations: [{ memberId: 'm2', amount: 30000 }],
          createdAt: 't',
        },
      ],
    });
    const result = applyPlanningCommand(trip, { type: 'member.remove', payload: { memberId: 'm1' } }, makeCtx());
    expect(result).toMatchObject({ ok: false, error: { code: 'member.referenced-by-ledger' } });
    if (result.ok) return;
    expect(result.error.details).toEqual({ expenseIds: ['e1'], settlementIds: [] });
  });

  it('被已撤销结算引用同样不可删除', () => {
    const trip = baseTrip({
      settlements: [
        { id: 's1', commandId: 'c1', fromId: 'm1', toId: 'm2', amount: 100, recordedAt: 't', voidedAt: 't2' },
      ],
    });
    const result = applyPlanningCommand(trip, { type: 'member.remove', payload: { memberId: 'm1' } }, makeCtx());
    expect(result).toMatchObject({ ok: false, error: { code: 'member.referenced-by-ledger' } });
  });
});

describe('plan.generate', () => {
  it('按模板生成候选：参数取模板默认、交通按查表、替换旧集合并递增版本', () => {
    const trip = baseTrip({
      members: [makeMember({ id: 'm1', originCity: '上海' })],
      plans: [makePlan({ id: 'p-old' })],
      intents: [
        { memberId: 'm1', planId: 'p-old', planVersion: 1, constraintRevision: 1, value: 'approve', source: 'organizer', recordedAt: 't' },
      ],
    });
    let seq = 0;
    const result = applyPlanningCommand(
      trip,
      {
        type: 'plan.generate',
        payload: {
          searchWindow: window,
          duration: 3,
          startDate: '2026-07-15',
          destinationIds: ['dest-sea', 'dest-culture'],
        },
      },
      makeCtx({ newId: () => `p-${(seq += 1)}` }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.plans.map((p) => p.id)).toEqual(['p-1', 'p-2']);
    expect(result.trip.plans[0]).toMatchObject({
      destinationId: 'dest-sea',
      version: 1,
      templateVersion: 1,
      startDate: '2026-07-15',
      days: 3,
    });
    expect(result.trip.plans[0].estimate).toMatchObject({
      lodgingPerNight: 22000,
      foodPerDay: 9000,
      activities: 18000,
      reserve: 6000,
      transportByMember: {},
    });
    expect(result.trip.plans[1].destinationId).toBe('dest-culture');
    expect(result.trip.duration).toBe(3);
    expect(result.trip.constraintRevision).toBe(2);
    expect(result.trip.intents).toEqual([]); // 被替换方案的意向不再保留
  });

  it('校验窗口长度、时长与出发日期', () => {
    const tooLong = applyPlanningCommand(
      baseTrip(),
      { type: 'plan.generate', payload: { searchWindow: { start: '2026-07-01', end: '2026-12-31' }, duration: 3, startDate: '2026-07-15', destinationIds: ['dest-sea'] } },
      makeCtx(),
    );
    expect(tooLong).toMatchObject({ ok: false, error: { code: 'plan.invalid-window' } });

    const badDuration = applyPlanningCommand(
      baseTrip(),
      { type: 'plan.generate', payload: { searchWindow: window, duration: 6 as never, startDate: '2026-07-15', destinationIds: ['dest-sea'] } },
      makeCtx(),
    );
    expect(badDuration).toMatchObject({ ok: false, error: { code: 'plan.invalid-duration' } });

    const badDate = applyPlanningCommand(
      baseTrip(),
      { type: 'plan.generate', payload: { searchWindow: window, duration: 3, startDate: '2026-08-15', destinationIds: ['dest-sea'] } },
      makeCtx(),
    );
    expect(badDate).toMatchObject({ ok: false, error: { code: 'plan.invalid-date' } });
  });

  it('未知目的地模板被拒绝', () => {
    const result = applyPlanningCommand(
      baseTrip(),
      { type: 'plan.generate', payload: { searchWindow: window, duration: 3, startDate: '2026-07-15', destinationIds: ['dest-moon'] } },
      makeCtx(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'plan.unknown-destination' } });
  });
});

describe('plan.update', () => {
  it('修改估算参数：方案版本与约束版本同时递增（R14）', () => {
    const trip = baseTrip({ plans: [makePlan({ id: 'p1' })], constraintRevision: 5 });
    const result = applyPlanningCommand(
      trip,
      { type: 'plan.update', payload: { planId: 'p1', estimate: { lodgingPerNight: 18000 } } },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.plans[0].version).toBe(2);
    expect(result.trip.plans[0].estimate.lodgingPerNight).toBe(18000);
    expect(result.trip.constraintRevision).toBe(6);
  });

  it('相同值更新不改变任何版本', () => {
    const trip = baseTrip({ plans: [makePlan({ id: 'p1' })] });
    const result = applyPlanningCommand(
      trip,
      { type: 'plan.update', payload: { planId: 'p1', estimate: { lodgingPerNight: 22000 } } },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.plans[0].version).toBe(1);
    expect(result.trip.constraintRevision).toBe(1);
  });

  it('修改出发日期须在搜索窗口内并递增版本', () => {
    const trip = baseTrip({ plans: [makePlan({ id: 'p1' })] });
    const ok = applyPlanningCommand(trip, { type: 'plan.update', payload: { planId: 'p1', startDate: '2026-07-20' } }, makeCtx());
    expect(ok.ok && ok.trip.plans[0].startDate === '2026-07-20' && ok.trip.plans[0].version === 2).toBe(true);

    const bad = applyPlanningCommand(trip, { type: 'plan.update', payload: { planId: 'p1', startDate: '2026-08-01' } }, makeCtx());
    expect(bad).toMatchObject({ ok: false, error: { code: 'plan.invalid-date' } });
  });

  it('更换目的地重置为模板默认参数并清空手工交通', () => {
    const trip = baseTrip({
      members: [makeMember({ id: 'm1' })],
      plans: [
        makePlan({
          id: 'p1',
          estimate: {
            lodgingPerNight: 99000,
            transportByMember: { m1: { originCity: '上海', amount: 123 } },
          },
        }),
      ],
    });
    const result = applyPlanningCommand(trip, { type: 'plan.update', payload: { planId: 'p1', destinationId: 'dest-culture' } }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.plans[0].destinationId).toBe('dest-culture');
    expect(result.trip.plans[0].estimate.lodgingPerNight).toBe(20000);
    expect(result.trip.plans[0].estimate.transportByMember).toEqual({});
  });

  it('手工交通按成员当前城市绑定；可清除', () => {
    const trip = baseTrip({ plans: [makePlan({ id: 'p1' })] });
    const set = applyPlanningCommand(
      trip,
      { type: 'plan.update', payload: { planId: 'p1', estimate: { transportOverride: { memberId: 'm1', amount: 33000 } } } },
      makeCtx(),
    );
    expect(set.ok && set.trip.plans[0].estimate.transportByMember.m1).toEqual({ originCity: '上海', amount: 33000 }).toBe(true);

    const cleared = applyPlanningCommand(
      set.ok ? set.trip : trip,
      { type: 'plan.update', payload: { planId: 'p1', estimate: { removeTransportOverride: 'm1' } } },
      makeCtx(),
    );
    expect(cleared.ok && cleared.trip.plans[0].estimate.transportByMember.m1 === undefined).toBe(true);
  });

  it('成员无城市时不能设置手工交通', () => {
    const trip = baseTrip({
      members: [makeMember({ id: 'm1', originCity: null, budgetCap: 1000, availability: [{ start: '2026-07-10', end: '2026-07-20' }] })],
      plans: [makePlan({ id: 'p1' })],
    });
    const result = applyPlanningCommand(
      trip,
      { type: 'plan.update', payload: { planId: 'p1', estimate: { transportOverride: { memberId: 'm1', amount: 1000 } } } },
      makeCtx(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'plan.invalid-estimate' } });
  });

  it('调整后个人估算超过 ¥100,000 被拒绝并定位成员', () => {
    const trip = baseTrip({ plans: [makePlan({ id: 'p1' })] });
    const result = applyPlanningCommand(
      trip,
      { type: 'plan.update', payload: { planId: 'p1', estimate: { lodgingPerNight: 2_500_000 } } },
      makeCtx(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'plan.estimate-over-cap' } });
    if (result.ok) return;
    expect(result.error.details).toMatchObject({ memberIds: ['m1'] });
  });
});

describe('plan.recordIntent', () => {
  const trip = baseTrip({
    members: [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })],
    plans: [makePlan({ id: 'p1' })],
    constraintRevision: 4,
  });

  it('记录当前版本意向；同组合重复记录为更新而非新增', () => {
    const first = applyPlanningCommand(trip, { type: 'plan.recordIntent', payload: { planId: 'p1', memberId: 'm1', value: 'approve', source: 'organizer' } }, makeCtx());
    expect(first.ok && first.trip.intents).toHaveLength(1);
    const again = applyPlanningCommand(
      first.ok ? first.trip : trip,
      { type: 'plan.recordIntent', payload: { planId: 'p1', memberId: 'm1', value: 'acceptable', source: 'feedback' } },
      makeCtx(),
    );
    expect(again.ok && again.trip.intents).toHaveLength(1);
    expect(again.ok && again.trip.intents[0]).toMatchObject({ value: 'acceptable', source: 'feedback', constraintRevision: 4 });
  });

  it('相同值重复提交不产生变化（R10）', () => {
    const first = applyPlanningCommand(trip, { type: 'plan.recordIntent', payload: { planId: 'p1', memberId: 'm1', value: 'approve', source: 'organizer' } }, makeCtx());
    const again = applyPlanningCommand(
      first.ok ? first.trip : trip,
      { type: 'plan.recordIntent', payload: { planId: 'p1', memberId: 'm1', value: 'approve', source: 'organizer' } },
      makeCtx(),
    );
    expect(again.ok && (again.trip === (first.ok ? first.trip : trip))).toBe(true);
  });

  it('意向不改变约束版本', () => {
    const result = applyPlanningCommand(trip, { type: 'plan.recordIntent', payload: { planId: 'p1', memberId: 'm1', value: 'approve', source: 'organizer' } }, makeCtx());
    expect(result.ok && result.trip.constraintRevision).toBe(4);
  });
});

describe('plan.confirm', () => {
  function confirmableTrip(): Trip {
    return baseTrip({
      members: [makeMember({ id: 'm1', budgetCap: 200000 }), makeMember({ id: 'm2', budgetCap: 200000 })],
      plans: [makePlan({ id: 'p1', startDate: '2026-07-15' })],
      intents: [
        { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'approve', source: 'organizer', recordedAt: 't' },
        { memberId: 'm2', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'acceptable', source: 'demo', recordedAt: 't' },
      ],
    });
  }

  it('首次确认写入确认快照，并调用注入的模板日程构建器', () => {
    const builderCalls: string[] = [];
    const trip = confirmableTrip();
    const result = applyPlanningCommand(
      trip,
      { type: 'plan.confirm', payload: { planId: 'p1' } },
      makeCtx({
        now: '2026-07-01T10:00:00.000Z',
        buildTemplateItinerary: ({ plan }) => {
          builderCalls.push(plan.id);
          return { sourcePlanId: plan.id, sourcePlanVersion: plan.version, dateRange: { start: plan.startDate, end: '2026-07-17' }, activities: [] };
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(builderCalls).toEqual(['p1']);
    expect(result.trip.confirmation).toEqual({
      planId: 'p1',
      planVersion: 1,
      constraintRevision: 1,
      confirmedAt: '2026-07-01T10:00:00.000Z',
    });
    expect(result.trip.itinerary.sourcePlanId).toBe('p1');
  });

  it('已有日程时确认默认保留，不调用构建器', () => {
    const trip = confirmableTrip({
      itinerary: { sourcePlanId: null, sourcePlanVersion: null, dateRange: { start: '2026-07-15', end: '2026-07-17' }, activities: [] },
    });
    let built = false;
    const result = applyPlanningCommand(
      trip,
      { type: 'plan.confirm', payload: { planId: 'p1' } },
      makeCtx({ buildTemplateItinerary: () => { built = true; return null as never; } }),
    );
    expect(result.ok && built).toBe(false);
    expect(result.ok && result.trip.itinerary.activities).toEqual([]);
  });

  it('未注入构建器时确认成功但不生成日程（集成缺口如实暴露）', () => {
    const result = applyPlanningCommand(confirmableTrip(), { type: 'plan.confirm', payload: { planId: 'p1' } }, makeCtx());
    expect(result.ok && result.trip.confirmation?.planId).toBe('p1');
    expect(result.ok && result.trip.itinerary.dateRange).toBeNull();
  });

  it('条件不满足时返回全部阻止项，不写入确认', () => {
    const trip = confirmableTrip({ intents: [] }); // 无人反馈
    const result = applyPlanningCommand(trip, { type: 'plan.confirm', payload: { planId: 'p1' } }, makeCtx());
    expect(result).toMatchObject({ ok: false, error: { code: 'consensus.blocked' } });
    if (result.ok) return;
    const kinds = (result.error.details as { kind: string }[]).map((b) => b.kind);
    expect(kinds).toContain('intent-missing');
  });
});

describe('命令通用约定', () => {
  it('不修改 trip.revision / updatedAt（由 T01 事务层负责）', () => {
    const trip = baseTrip({ revision: 42, updatedAt: '2026-06-01T00:00:00.000Z' });
    const result = applyPlanningCommand(
      trip,
      { type: 'member.update', payload: { memberId: 'm1', profile: { name: '测试成员', originCity: '上海', budgetCap: 160000, availability: [{ start: '2026-07-10', end: '2026-07-31' }], preferences: [] } } },
      makeCtx(),
    );
    expect(result.ok && result.trip.revision).toBe(42);
    expect(result.ok && result.trip.updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('未知命令返回结构化错误', () => {
    const result = applyPlanningCommand(baseTrip(), { type: 'plan.teleport' } as never, makeCtx());
    expect(result).toMatchObject({ ok: false, error: { code: 'command.invalid' } });
  });
});
