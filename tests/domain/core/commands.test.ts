import { expect, it } from 'vitest';
import { applyCommand } from '../../../src/app/application/commands';
import { createEmptyTrip } from '../../../src/data/demo';
import { success } from '../../../src/contracts/result';
import { dependencies } from '../../helpers/dependencies';
import type { Trip } from '../../../src/domain/types';
const now = '2026-11-18T00:00:00.000Z';
const today = '2026-11-18';
const context = { now, today, commandId: 'cmd-1', ids: [] };
const empty = () => createEmptyTrip({ id: 'trip', name: '旅行', today, now });
it('a domain no-op, including duplicate response, does not create a revision', () => {
  const trip = empty();
  const result = applyCommand(trip, { commandId: 'cmd-1', tripId: 'trip', expectedRevision: 0, payload: { type: 'member.remove', memberId: 'absent' } }, context, { planning: { apply: t => success(t), validate: () => [] } }, dependencies);
  expect(result).toEqual({ ok: true, value: trip });
});
it('renaming to the existing normalized name does not create a revision', () => {
  const trip = empty();
  const result = applyCommand(trip, { commandId: 'cmd-1', tripId: 'trip', expectedRevision: 0, payload: { type: 'trip.rename', name: ' 旅行 ' } }, context, {}, dependencies);
  expect(result).toEqual({ ok: true, value: trip });
});
it('resetting a demo rebases only current seed intents to the new constraint revision', () => {
  const old = { ...empty(), isDemo: true, constraintRevision: 10 };
  const seed = (): Trip => ({
    ...empty(), isDemo: true, constraintRevision: 2,
    members: [{ id: 'm1', name: '虚构成员', originCity: '上海', budgetCap: 100000, availability: [], preferences: [] }],
    plans: [{ id: 'p1', version: 1, destinationId: 'destination', templateVersion: 1, startDate: '2026-12-18', days: 3, estimate: { transportByMember: {}, lodgingPerNight: 0, foodPerDay: 0, activities: 0, reserve: 0 } }],
    intents: [
      { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 2, value: 'approve', source: 'demo', recordedAt: now },
      { memberId: 'm1', planId: 'p1', planVersion: 1, constraintRevision: 1, value: 'decline', source: 'demo', recordedAt: now },
    ],
  });
  const result = applyCommand(old, { commandId: 'cmd-1', tripId: 'trip', expectedRevision: 0, payload: { type: 'trip.resetDemo' } }, context, {}, { ...dependencies, createDemo: () => success(seed()) });
  expect(result.ok).toBe(true);
  if (result.ok) { expect(result.value.constraintRevision).toBe(11); expect(result.value.intents.map(i => i.constraintRevision)).toEqual([11, 10]); expect(result.value.revision).toBe(1); }
});
it('cannot reset a user trip even if demo factories are available', () => {
  const result = applyCommand(empty(), { commandId: 'cmd-1', tripId: 'trip', expectedRevision: 0, payload: { type: 'trip.resetDemo' } }, context, {}, { ...dependencies, createDemo: () => success(empty()) });
  expect(!result.ok && result.error.code).toBe('VALIDATION');
});
