import { expect, it } from 'vitest';
import { dependencies, domainModules, loadFeatureExports } from '../../../src/app/modules';
import { createDemoTrip } from '../../../src/app/application/demo';
import { parseTrip } from '../../../src/domain/schema';
it.skipIf(process.env.REQUIRE_ALL_MODULES !== '1')('all production modules, validators and demo factories are registered', async () => {
  const featureExports = await loadFeatureExports();
  for (const name of ['SquadPage', 'PlansPage', 'ItineraryPage', 'LedgerPage', 'SnapshotPage', 'JoinPage', 'ResponsePage', 'SharingPanels'] as const) expect(featureExports[name], name).toBeTruthy();
  for (const key of ['planning', 'itineraryLedger', 'sharing'] as const) {
    expect(domainModules[key], key).toBeTruthy();
    expect(typeof domainModules[key]?.apply).toBe('function');
    expect(typeof domainModules[key]?.validate).toBe('function');
  }
  const demo = createDemoTrip({ id: 'demo-trip', today: '2026-11-18', now: '2026-11-18T00:00:00.000Z' });
  expect(demo.ok, JSON.stringify(demo)).toBe(true);
  if (!demo.ok) return;
  expect(parseTrip(demo.value).ok).toBe(true);
  expect(demo.value.members).toHaveLength(6);
  expect(demo.value.plans.length).toBeGreaterThanOrEqual(3);
  expect(demo.value.settlements).toHaveLength(0);
  for (const module of Object.values(domainModules)) expect(module.validate(demo.value)).toEqual([]);
  expect(dependencies.planning.getPlanEvaluations(demo.value).length).toBe(demo.value.plans.length);
});
