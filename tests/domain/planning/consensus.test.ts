import { describe, expect, it } from 'vitest';
import {
  canConfirmPlan,
  getConfirmationBlockers,
  getConsensusStatus,
} from '../../../src/domain/planning/consensus';
import { toPlanningContext } from '../../../src/domain/planning/commands';
import type { Trip, Intent } from '../../../src/domain/planning/contract';
import { fixtureDeps, makeMember, makePlan, makeTrip } from './fixtures';

const window = { start: '2026-07-01', end: '2026-07-30' };
const TODAY = '2026-07-01';

/** 两位资料完整、可 7/15 出发且预算充足的成员。 */
function fullHouseMembers() {
  return [
    makeMember({ id: 'm1', budgetCap: 200000 }),
    makeMember({ id: 'm2', budgetCap: 200000 }),
  ];
}

function intentOf(memberId: string, value: Intent['value'], opts?: { planId?: string; planVersion?: number; constraintRevision?: number }): Intent {
  return {
    memberId,
    planId: opts?.planId ?? 'p1',
    planVersion: opts?.planVersion ?? 1,
    constraintRevision: opts?.constraintRevision ?? 1,
    value,
    source: 'organizer',
    recordedAt: '2026-06-20T00:00:00.000Z',
  };
}

function tripWith(overrides: Partial<Trip> = {}): Trip {
  return makeTrip({
    members: fullHouseMembers(),
    plans: [makePlan({ id: 'p1', startDate: '2026-07-15' })],
    constraintRevision: 1,
    intents: [intentOf('m1', 'approve'), intentOf('m2', 'acceptable')],
    searchWindow: window,
    ...overrides,
  });
}

describe('确认阻止项（BR-07）', () => {
  it('条件齐全时无阻止项', () => {
    expect(canConfirmPlan(toPlanningContext(tripWith()), 'p1', TODAY, fixtureDeps)).toBe(true);
  });

  it('不足 2 位成员不可确认', () => {
    const trip = tripWith({ members: [makeMember({ id: 'm1', budgetCap: 200000 })], intents: [intentOf('m1', 'approve')] });
    const blockers = getConfirmationBlockers(toPlanningContext(trip), 'p1', TODAY, fixtureDeps);
    expect(blockers).toEqual([{ kind: 'too-few-members', message: expect.any(String) }]);
  });

  it('资料缺失的成员阻止确认（R01）', () => {
    const trip = tripWith({ members: [...fullHouseMembers(), makeMember({ id: 'm3', budgetCap: null })] });
    const blockers = getConfirmationBlockers(toPlanningContext(trip), 'p1', TODAY, fixtureDeps);
    expect(blockers).toContainEqual(expect.objectContaining({ kind: 'member-incomplete', memberId: 'm3' }));
  });

  it('未反馈的成员阻止确认', () => {
    const trip = tripWith({ intents: [intentOf('m1', 'approve')] });
    const blockers = getConfirmationBlockers(toPlanningContext(trip), 'p1', TODAY, fixtureDeps);
    expect(blockers).toEqual([expect.objectContaining({ kind: 'intent-missing', memberId: 'm2' })]);
  });

  it('明确拒绝的成员阻止确认，不能以多数票绕过', () => {
    const trip = tripWith({ intents: [intentOf('m1', 'approve'), intentOf('m2', 'decline')] });
    const blockers = getConfirmationBlockers(toPlanningContext(trip), 'p1', TODAY, fixtureDeps);
    expect(blockers).toEqual([expect.objectContaining({ kind: 'intent-declined', memberId: 'm2' })]);
  });

  it('过期（旧版本）意向视为未反馈', () => {
    const trip = tripWith({ intents: [intentOf('m1', 'approve', { constraintRevision: 0 }), intentOf('m2', 'acceptable', { planVersion: 1 })] });
    const blockers = getConfirmationBlockers(toPlanningContext(trip), 'p1', TODAY, fixtureDeps);
    expect(blockers).toEqual([expect.objectContaining({ kind: 'intent-missing', memberId: 'm1' })]);
  });

  it('未知交通阻止确认，不按 0 元放行', () => {
    const trip = tripWith({
      members: [makeMember({ id: 'm1', originCity: '拉萨' }), makeMember({ id: 'm2' })],
      intents: [intentOf('m1', 'approve'), intentOf('m2', 'acceptable')],
    });
    const blockers = getConfirmationBlockers(toPlanningContext(trip), 'p1', TODAY, fixtureDeps);
    expect(blockers).toContainEqual(expect.objectContaining({ kind: 'estimate-unknown', memberId: 'm1' }));
    expect(blockers.some((b) => b.kind === 'intent-missing')).toBe(false);
  });

  it('出发日期早于操作当天阻止确认', () => {
    const trip = tripWith({ plans: [makePlan({ id: 'p1', startDate: '2026-06-30' })], searchWindow: { start: '2026-06-01', end: '2026-07-30' } });
    const blockers = getConfirmationBlockers(toPlanningContext(trip), 'p1', '2026-07-01', fixtureDeps);
    expect(blockers).toContainEqual(expect.objectContaining({ kind: 'date-invalid' }));
  });

  it('预算冲突的成员阻止确认并给出差额', () => {
    const trip = tripWith({
      members: [makeMember({ id: 'm1', budgetCap: 100000 }), makeMember({ id: 'm2' })],
      intents: [intentOf('m1', 'approve'), intentOf('m2', 'acceptable')],
    });
    const blockers = getConfirmationBlockers(toPlanningContext(trip), 'p1', TODAY, fixtureDeps);
    const budget = blockers.find((b) => b.kind === 'budget-conflict');
    expect(budget).toEqual(expect.objectContaining({ memberId: 'm1', overBy: 44000 }));
  });
});

describe('派生共识状态（BR-07）', () => {
  it('从未确认 → 筹备中', () => {
    expect(getConsensusStatus(toPlanningContext(tripWith()), fixtureDeps).status).toBe('preparing');
  });

  it('确认快照与当前输入一致且条件仍满足 → 已确认', () => {
    const trip = tripWith({
      confirmation: { planId: 'p1', planVersion: 1, constraintRevision: 1, confirmedAt: '2026-06-21T00:00:00.000Z' },
    });
    expect(getConsensusStatus(toPlanningContext(trip), fixtureDeps).status).toBe('confirmed');
  });

  it('约束版本变化 → 待重新确认（R14）', () => {
    const trip = tripWith({
      constraintRevision: 2,
      confirmation: { planId: 'p1', planVersion: 1, constraintRevision: 1, confirmedAt: '2026-06-21T00:00:00.000Z' },
    });
    const status = getConsensusStatus(toPlanningContext(trip), fixtureDeps);
    expect(status.status).toBe('needsReconfirm');
    expect(status.reason?.kind).toBe('constraints-changed');
  });

  it('方案版本变化 → 待重新确认', () => {
    const trip = tripWith({
      plans: [makePlan({ id: 'p1', version: 2, startDate: '2026-07-15' })],
      confirmation: { planId: 'p1', planVersion: 1, constraintRevision: 1, confirmedAt: '2026-06-21T00:00:00.000Z' },
    });
    const status = getConsensusStatus(toPlanningContext(trip), fixtureDeps);
    expect(status.status).toBe('needsReconfirm');
    expect(status.reason?.kind).toBe('plan-changed');
  });

  it('确认后成员改投不参加 → 立即失效，不增加约束版本', () => {
    const confirmation = { planId: 'p1', planVersion: 1, constraintRevision: 1, confirmedAt: '2026-06-21T00:00:00.000Z' };
    const trip = tripWith({
      confirmation,
      intents: [intentOf('m1', 'decline'), intentOf('m2', 'acceptable')],
    });
    const status = getConsensusStatus(toPlanningContext(trip), fixtureDeps);
    expect(status.status).toBe('needsReconfirm');
    expect(status.reason?.kind).toBe('intents-changed');
    expect(trip.constraintRevision).toBe(confirmation.constraintRevision); // 意向变化不加版本
  });

  it('确认后清空意向（无当前记录）→ 失效', () => {
    const trip = tripWith({
      confirmation: { planId: 'p1', planVersion: 1, constraintRevision: 1, confirmedAt: '2026-06-21T00:00:00.000Z' },
      intents: [intentOf('m1', 'approve', { constraintRevision: 1 })],
    });
    expect(getConsensusStatus(toPlanningContext(trip), fixtureDeps).reason?.kind).toBe('intents-changed');
  });
});
