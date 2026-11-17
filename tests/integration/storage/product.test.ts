import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { createDemoTrip } from '../../../src/app/application/demo';
import { dependencies, domainModules } from '../../../src/app/modules';
import { openTripDatabase } from '../../../src/infrastructure/migrations';
import { createIndexedDBRepository } from '../../../src/infrastructure/repository';
import { createSharingApplication } from '../../../src/app/application/sharing';
import { getItineraryBudget } from '../../../src/domain/itinerary/budget';
import type { CommandPayload } from '../../../src/domain/commands';
import type { Repository, SharingApplicationDependencies, Trip } from '../../../src/contracts/services';
import { success } from '../../../src/contracts/result';
const now = '2026-11-18T00:00:00.000Z'; const today = '2026-11-18';
let id = 0; const repositories: Repository[] = [];
afterEach(() => repositories.splice(0).forEach(repo => repo.close()));
function demo(): Trip {
  const result = createDemoTrip({ id: 'demo-trip', now, today });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
async function setup(trip = demo()) {
  const db = await openTripDatabase('/integration/', { factoryName: 'product-' + id++ });
  const repo = createIndexedDBRepository(db, { dependencies, modules: domainModules }); repositories.push(repo);
  const created = await repo.create(trip); expect(created.ok, JSON.stringify(created)).toBe(true);
  const execute = async (payload: CommandPayload) => {
    const current = await repo.get(trip.id); if (!current.ok) throw new Error(current.error.message);
    const commandId = 'command-' + id++;
    return repo.execute({ commandId, tripId: trip.id, expectedRevision: current.value.revision, payload }, { now, today, commandId, ids: Array.from({ length: 128 }, () => 'entity-' + id++) });
  };
  return { repo, execute };
}
it('real demo confirms, generates a template once, and keeps manual activities through constraint changes', async () => {
  const trip = demo(); trip.itinerary = { sourcePlanId: null, sourcePlanVersion: null, dateRange: null, activities: [] };
  const { repo, execute } = await setup(trip);
  expect((await execute({ type: 'plan.recordIntent', planId: 'demo-p1', memberId: 'demo-m3', value: 'approve', source: 'demo' })).ok).toBe(true);
  const confirmed = await execute({ type: 'plan.confirm', planId: 'demo-p1', itineraryMode: 'replace' });
  expect(confirmed.ok, JSON.stringify(confirmed)).toBe(true);
  if (!confirmed.ok) return;
  expect(confirmed.value.itinerary.activities.length).toBeGreaterThan(0);
  const first = confirmed.value.itinerary.activities[0];
  const edited = await execute({ type: 'itinerary.update', activityId: first.id, changes: { title: '保留的手工安排' } }); expect(edited.ok).toBe(true);
  const again = await execute({ type: 'plan.confirm', planId: 'demo-p1', itineraryMode: 'preserve' });
  expect(again.ok && again.value.itinerary.activities[0].title).toBe('保留的手工安排');
  await execute({ type: 'member.update', memberId: 'demo-m1', changes: { budgetCap: 110000 } });
  const current = await repo.get(trip.id); if (!current.ok) throw new Error('missing');
  expect(dependencies.planning.getConsensusStatus(current.value, 'demo-p1', today).confirmed).toBe(false);
  expect(current.value.itinerary.activities[0].title).toBe('保留的手工安排');
  expect((await execute({ type: 'plan.confirm', planId: 'demo-p1', itineraryMode: 'preserve' })).ok).toBe(false);
});
it('reconfirmation is allowed after new valid intents and transport changes target the correct member', async () => {
  const { execute } = await setup();
  await execute({ type: 'plan.recordIntent', planId: 'demo-p1', memberId: 'demo-m3', value: 'approve', source: 'demo' });
  await execute({ type: 'plan.confirm', planId: 'demo-p1', itineraryMode: 'preserve' });
  const initial = demo().plans[0];
  const transportByMember = { 'demo-m1': { originCity: '上海', amount: 10000 }, 'demo-m2': { originCity: '杭州', amount: 20000 } };
  const changed = await execute({ type: 'plan.update', planId: initial.id, changes: { estimate: { ...initial.estimate, transportByMember } } });
  expect(changed.ok && changed.value.plans[0].estimate.transportByMember).toEqual(transportByMember);
  const next = await execute({ type: 'plan.update', planId: initial.id, changes: { estimate: { ...initial.estimate, transportByMember: { ...transportByMember, 'demo-m2': { originCity: '杭州', amount: 21000 } } } } });
  expect(next.ok && next.value.plans[0].estimate.transportByMember['demo-m2']?.amount).toBe(21000);
  if (!next.ok) return;
  for (const member of next.value.members) await execute({ type: 'plan.recordIntent', planId: initial.id, memberId: member.id, value: 'approve', source: 'demo' });
  const state = await execute({ type: 'trip.rename', name: '可以重新确认' }); if (!state.ok) throw new Error('rename');
  expect(dependencies.planning.getConsensusStatus(state.value, initial.id, today).canConfirm).toBe(true);
  expect((await execute({ type: 'plan.confirm', planId: initial.id, itineraryMode: 'preserve' })).ok).toBe(true);
});
it('itinerary budget uses planning estimates and replaces the activity bucket', () => {
  const trip = demo(); const plan = trip.plans[0];
  const totals = Object.fromEntries(trip.members.map(member => [member.id, dependencies.planning.evaluatePersonalPlan({ member, plan }).total]));
  const budget = getItineraryBudget({ activities: trip.itinerary.activities.filter(activity => activity.perPersonEstimate !== null || activity.budgetBucket === 'included'), members: trip.members, baseEstimates: totals, planActivitiesEstimate: plan.estimate.activities });
  expect(budget.complete).toBe(true);
  expect(budget.perMember[0].revisedEstimate).toBe(totals[budget.perMember[0].memberId]! - plan.estimate.activities + budget.knownActivitiesTotal);
});
it('a failed injected template builder does not persist confirmation', async () => {
  const trip = demo(); trip.itinerary = { sourcePlanId: null, sourcePlanVersion: null, dateRange: null, activities: [] };
  const { execute } = await setup(trip);
  await execute({ type: 'plan.recordIntent', planId: 'demo-p1', memberId: 'demo-m3', value: 'approve', source: 'demo' });
  const result = domainModules.planning!.apply({ ...trip, intents: [...trip.intents, { memberId: 'demo-m3', planId: 'demo-p1', planVersion: 1, constraintRevision: trip.constraintRevision, value: 'approve', source: 'demo', recordedAt: now }] }, { type: 'plan.confirm', planId: 'demo-p1', itineraryMode: 'replace' }, { now, today, commandId: 'c', ids: [] }, { ...dependencies, buildTemplateItinerary: () => ({ ok: false, error: { code: 'VALIDATION', message: '无法构建模板' } }) });
  expect(result.ok).toBe(false); expect(trip.confirmation).toBeNull();
});
it('application feedback dispatch writes its target trip even when another workspace is open', async () => {
  const { repo, execute } = await setup();
  let seq = 0;
  const services: SharingApplicationDependencies = { repository: repo, planning: dependencies.planning, execute, createId: () => 'share-' + seq++, now: () => now, today: () => today, baseUrl: 'https://example.com/gradtrip/' };
  const app = createSharingApplication(services);
  const trip = demo(); const invitation = app.buildInvitation(trip, 'demo-m3'); expect(invitation.ok).toBe(true); if (!invitation.ok) return;
  const env = invitation.value;
  await execute({ type: 'sharing.registerInvitation', invitation: { id: env.payloadId, memberId: 'demo-m3', constraintRevision: trip.constraintRevision, planVersions: Object.fromEntries(trip.plans.map(plan => [plan.id, plan.version])), createdAt: now } });
  const member = trip.members[2];
  const response = app.buildResponse(env, { name: member.name, originCity: member.originCity, budgetCap: member.budgetCap, availability: member.availability, preferences: member.preferences }, [{ planId: 'demo-p1', value: 'approve' }]);
  if (!response.ok) throw new Error(response.error.message);
  const body = response.value.body;
  const otherWorkspace = createSharingApplication({ ...services, execute: async () => success({ ...trip, id: 'wrong-workspace' }) });
  const input = { id: response.value.payloadId, invitationId: body.invitationId, tripId: body.tripId, memberId: body.memberId, constraintRevision: body.baseConstraintRevision, planVersions: Object.fromEntries(body.intents.map(intent => [intent.planId, intent.planVersion])), member: body.profile, intents: body.intents };
  const applied = await otherWorkspace.service.applyResponse(input);
  expect(applied.ok && applied.value.id).toBe(trip.id);
  const current = await repo.get(trip.id); expect(current.ok && current.value.appliedResponses.some(item => item.id === response.value.payloadId)).toBe(true);
  const duplicate = await otherWorkspace.service.applyResponse(input);
  expect(duplicate).toEqual(current);
});

it('blank transport overrides are a no-op and do not invalidate demo intent bindings', async () => {
  const trip = demo(); const { execute } = await setup(trip);
  const plan = trip.plans[0];
  const result = await execute({ type: 'plan.update', planId: plan.id, changes: { estimate: { ...plan.estimate, transportByMember: { ...plan.estimate.transportByMember, 'demo-m1': null } } } });
  expect(result.ok && result.value.revision).toBe(trip.revision);
  expect(result.ok && result.value.constraintRevision).toBe(trip.constraintRevision);
  expect(result.ok && result.value.intents).toEqual(trip.intents);
});