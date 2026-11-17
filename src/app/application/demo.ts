import type { Trip } from '../../domain/types';
import { createEmptyTrip } from '../../data/demo';
import { parseTrip } from '../../domain/schema';
import { failure, type Result } from '../../contracts/result';
export interface DemoInput { id: string; today: string; now: string }
export type PlanningDemoSeed = Pick<Trip, 'members' | 'plans' | 'intents' | 'searchWindow' | 'duration'>;
export type LedgerDemoSeed = Pick<Trip, 'itinerary' | 'expenses' | 'settlements'>;
interface DemoFactories {
  createPlanningDemo?: (input: DemoInput) => PlanningDemoSeed;
  createDemoLedger?: (input: DemoInput & { members: Trip['members']; plans: Trip['plans'] }) => LedgerDemoSeed;
}
const seeds = import.meta.glob('../../data/{demoPlanning,demoLedger}.ts', { eager: true }) as Record<string, DemoFactories>;
const factories: DemoFactories = Object.assign({}, ...Object.values(seeds));
export function createDemoTrip(input: DemoInput): Result<Trip> {
  if (!factories.createPlanningDemo || !factories.createDemoLedger) return failure('NOT_IMPLEMENTED', '示例的规划与账目模块尚未交付，请先创建旅行');
  const planning = factories.createPlanningDemo(input);
  const ledger = factories.createDemoLedger({ ...input, members: planning.members, plans: planning.plans });
  return parseTrip({ ...createEmptyTrip({ ...input, name: '一起去毕业旅行', isDemo: true }), ...planning, ...ledger });
}
