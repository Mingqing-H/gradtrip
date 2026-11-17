import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isDateOnly, mergeRanges } from '../../../src/domain/dates';
import { formatMoney, parseMoney, sumCents } from '../../../src/domain/money';
import { createEmptyTrip } from '../../../src/data/demo';
import { parseTrip } from '../../../src/domain/schema';
import { createMemoryRepository } from '../../helpers/memoryRepository';
import type { DomainDependencies } from '../../../src/contracts/services';
import { failure } from '../../../src/contracts/result';
const now = '2026-11-18T00:00:00.000Z';
const unavailable = () => failure('NOT_IMPLEMENTED', '测试依赖未实现');
const dependencies: DomainDependencies = {
  planning: { getPlanEvaluations: () => [], getConsensusStatus: () => ({ canConfirm: false, confirmed: false, reasons: [] }), findCommonDepartures: () => [], updateMemberConstraints: unavailable, evaluatePersonalPlan: () => { throw new Error('unused'); }, getTemplate: unavailable },
  buildTemplateItinerary: unavailable,
};
export { dependencies };
describe('money', () => {
  it('parses exact decimal cents including safe integer boundary', () => {
    expect(parseMoney('33.34')).toBe(3334); expect(parseMoney('0')).toBe(0);
    expect(parseMoney('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(formatMoney(-3334)).toBe('-¥33.34');
  });
  it.each(['1.001', '-1', '1e3', 'Infinity', '', '.01', '90071992547409.92'])('rejects %s', input => expect(() => parseMoney(input)).toThrow());
  it('rejects unsafe sums', () => expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow());
});
describe('natural dates', () => {
  it('handles leap days, year and month boundaries', () => {
    expect(isDateOnly('2024-02-29')).toBe(true); expect(isDateOnly('2026-02-29')).toBe(false);
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01'); expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
  });
  it('merges consecutive ranges without crossing gaps or mutating input', () => {
    const ranges = [{ start: '2026-12-01', end: '2026-12-02' }, { start: '2026-12-03', end: '2026-12-04' }, { start: '2026-12-06', end: '2026-12-07' }];
    expect(mergeRanges(ranges)).toHaveLength(2); expect(ranges[0].end).toBe('2026-12-02');
  });
});
describe('trip boundary and command contract', () => {
  const trip = () => createEmptyTrip({ id: 'trip-1', name: '毕业旅行', today: '2026-11-18', now });
  it('validates empty trips and rejects invalid references', () => {
    expect(parseTrip(trip()).ok).toBe(true);
    const invalid = trip(); invalid.expenses = [{ id: 'e1', title: '餐费', amount: 100, payerId: 'missing', date: '2026-11-18', category: 'food', splitMode: 'equal', allocations: [{ memberId: 'missing', amount: 100 }], createdAt: now }];
    expect(parseTrip(invalid).ok).toBe(false);
  });
  it('deduplicates commands before revision check and rejects stale writes', async () => {
    const repo = createMemoryRepository(dependencies); await repo.create(trip());
    const cmd = { commandId: 'cmd-1', tripId: 'trip-1', expectedRevision: 0, payload: { type: 'trip.rename' as const, name: '海边毕业旅行' } };
    const context = { now, today: '2026-11-18', ids: [], commandId: cmd.commandId };
    const first = await repo.execute(cmd, context); expect(first.ok && first.value.revision).toBe(1);
    expect(await repo.execute(cmd, context)).toEqual(first);
    const stale = await repo.execute({ ...cmd, commandId: 'cmd-2' }, { ...context, commandId: 'cmd-2' });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT');
    expect((await repo.get('trip-1')).ok).toBe(true);
  });
  it('unregistered commands explicitly fail', async () => {
    const repo = createMemoryRepository(dependencies); await repo.create(trip());
    const result = await repo.execute({ commandId: 'cmd-1', tripId: 'trip-1', expectedRevision: 0, payload: { type: 'member.remove', memberId: 'a' } }, { now, today: '2026-11-18', ids: [], commandId: 'cmd-1' });
    expect(!result.ok && result.error.code).toBe('NOT_IMPLEMENTED');
  });
});
