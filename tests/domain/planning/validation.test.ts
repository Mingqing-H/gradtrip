import { describe, expect, it } from 'vitest';
import { validatePlanningTrip } from '../../../src/domain/planning/validation';
import { fixtureDeps, makeMember, makePlan, makeTrip } from './fixtures';

const window = { start: '2026-07-01', end: '2026-07-30' };

describe('validatePlanningTrip（规划域语义校验）', () => {
  it('合法旅行无问题', () => {
    const trip = makeTrip({
      members: [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })],
      plans: [makePlan({ id: 'p1', startDate: '2026-07-15' })],
      intents: [
        { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'approve', source: 'organizer', recordedAt: 't' },
      ],
      searchWindow: window,
    });
    expect(validatePlanningTrip(trip, fixtureDeps)).toEqual([]);
  });

  it('搜索窗口过长与时长非法被指出', () => {
    const issues = validatePlanningTrip(
      makeTrip({ searchWindow: { start: '2026-07-01', end: '2027-01-01' }, duration: 6 as never }),
    );
    expect(issues.map((i) => i.code)).toContain('window-too-long');
    expect(issues.map((i) => i.code)).toContain('duration-invalid');
  });

  it('成员重复 ID、非法预算、超量日期段被指出', () => {
    const trip = makeTrip({
      members: [
        makeMember({ id: 'dup' }),
        makeMember({ id: 'dup', budgetCap: 20_000_001 }),
        makeMember({
          id: 'm3',
          availability: [
            { start: '2026-07-01', end: '2026-07-02' },
            { start: '2026-07-03', end: '2026-07-04' },
            { start: '2026-07-05', end: '2026-07-06' },
            { start: '2026-07-07', end: '2026-07-08' },
            { start: '2026-07-09', end: '2026-07-10' },
            { start: '2026-07-11', end: '2026-07-12' },
          ],
        }),
      ],
      searchWindow: window,
    });
    const codes = validatePlanningTrip(trip).map((i) => i.code);
    expect(codes).toContain('member-duplicate-id');
    expect(codes).toContain('member-budget-invalid');
    expect(codes).toContain('member-availability-limit');
  });

  it('方案日期跨出窗口、估算参数为负、引用不存在成员的交通被指出', () => {
    const trip = makeTrip({
      members: [makeMember({ id: 'm1' })],
      plans: [
        makePlan({
          id: 'p1',
          startDate: '2026-08-15',
          estimate: { activities: -1, transportByMember: { ghost: { originCity: '上海', amount: 100 } } },
        }),
      ],
      searchWindow: window,
    });
    const codes = validatePlanningTrip(trip).map((i) => i.code);
    expect(codes).toContain('plan-start-invalid');
    expect(codes).toContain('plan-estimate-invalid');
    expect(codes).toContain('plan-transport-ref-invalid');
  });

  it('意向引用不存在的成员/方案、同组合重复记录被指出', () => {
    const trip = makeTrip({
      intents: [
        { memberId: 'ghost', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'approve', source: 'organizer', recordedAt: 't' },
        { memberId: 'm1', planId: 'ghost-plan', planVersion: 1, constraintRevision: 1, value: 'approve', source: 'organizer', recordedAt: 't' },
        { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'approve', source: 'organizer', recordedAt: 't' },
        { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'decline', source: 'demo', recordedAt: 't2' },
      ],
      plans: [makePlan({ id: 'p1', startDate: '2026-07-15' })],
      searchWindow: window,
    });
    const codes = validatePlanningTrip(trip).map((i) => i.code);
    expect(codes).toContain('intent-member-ref-invalid');
    expect(codes).toContain('intent-plan-ref-invalid');
    expect(codes).toContain('intent-duplicate-binding');
  });

  it('确认引用不存在的方案被指出', () => {
    const trip = makeTrip({
      confirmation: { planId: 'ghost', planVersion: 1, constraintRevision: 1, confirmedAt: 't' },
      searchWindow: window,
    });
    expect(validatePlanningTrip(trip).map((i) => i.code)).toContain('confirmation-plan-ref-invalid');
  });

  it('提供 deps 时校验目的地模板引用', () => {
    const trip = makeTrip({
      plans: [makePlan({ id: 'p1', destinationId: 'dest-moon', startDate: '2026-07-15' })],
      searchWindow: window,
    });
    expect(validatePlanningTrip(trip, fixtureDeps).map((i) => i.code)).toContain('plan-destination-unknown');
    expect(validatePlanningTrip(trip).map((i) => i.code)).not.toContain('plan-destination-unknown');
  });
});
