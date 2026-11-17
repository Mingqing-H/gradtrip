import { createPlanningDemo } from '../../src/data/demoPlanning';
import { createEmptyTrip } from '../../src/data/demo';
import { planningService } from '../../src/domain/planning/adapter';
import { getLedgerSummary } from '../../src/domain/ledger/balances';
import { buildSettlementSuggestions } from '../../src/domain/ledger/settlement';
import { splitEqualCents } from '../../src/domain/ledger/split';
import { getItineraryBudget } from '../../src/domain/itinerary/budget';
import type { Trip } from '../../src/domain/types';
export function createBenchmarkTrip(): Trip {
  const today = '2026-11-18'; const now = '2026-11-18T00:00:00.000Z';
  const seed = createPlanningDemo({ today, now });
  const members = Array.from({ length: 20 }, (_, i) => ({ ...seed.members[i % 6], id: 'member-' + i, budgetCap: 500000, originCity: i === 19 ? '未知城市' : seed.members[i % 6].originCity }));
  const plans = Array.from({ length: 20 }, (_, i) => ({ ...seed.plans[i % 6], id: 'plan-' + i, estimate: { ...seed.plans[i % 6].estimate, transportByMember: {} } }));
  const memberIds = members.map(member => member.id);
  const expenses = Array.from({ length: 200 }, (_, i) => ({ id: 'expense-' + i, title: '固定种子费用 ' + i, amount: 10000 + i, payerId: memberIds[i % 20], date: plans[0].startDate, category: '活动', splitMode: 'equal' as const, allocations: splitEqualCents(10000 + i, memberIds), createdAt: now }));
  return { ...createEmptyTrip({ id: 'benchmark', name: '固定种子性能验收', today, now }), searchWindow: seed.searchWindow, constraintRevision: seed.constraintRevision, members, plans, expenses,
    intents: plans.flatMap(plan => members.map(member => ({ memberId: member.id, planId: plan.id, planVersion: plan.version, constraintRevision: seed.constraintRevision, value: 'approve' as const, source: 'demo' as const, recordedAt: now }))) };
}
export function runMeasurements() {
  const trip = createBenchmarkTrip(); const ids = trip.members.map(member => member.id);
  const durations: number[] = [];
  for (let run = 0; run < 20; run++) {
    const start = performance.now();
    const evaluations = planningService.getPlanEvaluations(trip);
    for (const plan of trip.plans) planningService.getConsensusStatus(trip, plan.id, '2026-11-18');
    const summary = getLedgerSummary(ids, trip.expenses, trip.settlements);
    buildSettlementSuggestions(summary.balances);
    getItineraryBudget({ activities: trip.itinerary.activities, members: trip.members, planActivitiesEstimate: trip.plans[0].estimate.activities, baseEstimates: Object.fromEntries(evaluations[0].members.map(member => [member.memberId, member.total])) });
    if (summary.balances.reduce((sum, row) => sum + row.balance, 0) !== 0 || evaluations.length !== 20) throw new Error('Benchmark invariant failed');
    durations.push(performance.now() - start);
  }
  const sorted = [...durations].sort((a, b) => a - b);
  return { members: 20, plans: 20, expenses: 200, runs: 20, durationsMs: durations, medianMs: (sorted[9] + sorted[10]) / 2, maxMs: Math.max(...durations) };
}
