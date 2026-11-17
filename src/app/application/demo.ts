import type { Trip, Range } from '../../domain/types';
import { addDays } from '../../domain/dates';
import { createEmptyTrip } from '../../data/demo';
import { parseTrip } from '../../domain/schema';
import { failure, type Result } from '../../contracts/result';
export interface DemoInput { id: string; today: string; now: string }
export type PlanningDemoSeed = Pick<Trip, 'members' | 'plans' | 'intents' | 'searchWindow' | 'duration' | 'constraintRevision'> & { scenario?: { targetPlanId: string } };
export type LedgerDemoSeed = Pick<Trip, 'expenses' | 'settlements'> & { activities: Trip['itinerary']['activities'] };
interface DemoFactories {
  createPlanningDemo?: (input: DemoInput) => PlanningDemoSeed;
  createDemoLedger?: (input: { members: Trip['members']; dateRange: Range; now: string }) => LedgerDemoSeed;
}
const seeds = import.meta.glob('../../data/{demoPlanning,demoLedger}.ts', { eager: true }) as Record<string, DemoFactories>;
const factories: DemoFactories = Object.assign({}, ...Object.values(seeds));
export function createDemoTrip(input: DemoInput): Result<Trip> {
  if (!factories.createPlanningDemo || !factories.createDemoLedger) return failure('NOT_IMPLEMENTED', '示例的规划与账目模块尚未交付，请先创建旅行');
  try {
    const planning = factories.createPlanningDemo(input);
    const plan = planning.plans.find(p => p.id === planning.scenario?.targetPlanId) ?? planning.plans[0];
    if (!plan) return failure('VALIDATION', '示例缺少候选方案');
    const dateRange = { start: plan.startDate, end: addDays(plan.startDate, plan.days - 1) };
    const ledger = factories.createDemoLedger({ members: planning.members, dateRange, now: input.now });
    return parseTrip({
      ...createEmptyTrip({ ...input, name: '一起去毕业旅行', isDemo: true }),
      members: planning.members, plans: planning.plans, intents: planning.intents,
      searchWindow: planning.searchWindow, duration: planning.duration, constraintRevision: planning.constraintRevision,
      itinerary: { sourcePlanId: null, sourcePlanVersion: null, dateRange, activities: ledger.activities },
      expenses: ledger.expenses, settlements: [],
    });
  } catch { return failure('VALIDATION', '示例种子无法生成，请检查规划与账目工厂接口'); }
}
