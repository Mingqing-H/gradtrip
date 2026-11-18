import { lazy, type ComponentType } from 'react';
import { createDemoTrip } from './application/demo';
import type { DomainDependencies, DomainModule, FeatureExports, PlanningService } from '../contracts/services';
import { failure } from '../contracts/result';
const featureLoaders = import.meta.glob('../features/*/index.ts') as Record<string, () => Promise<FeatureExports>>;
// Start the initial workspace and its LCP image while IndexedDB is opening.
// Explicit links to other workspaces or shared pages keep their current request set.
const initialRoute = typeof location === 'undefined' ? null : location.hash.split('?')[0];
if (initialRoute !== null && (!initialRoute || initialRoute === '#/' || /^#\/trip\/[^/]+\/squad$/.test(initialRoute))) {
  const image = document.createElement('link');
  image.rel = 'preload'; image.as = 'image'; image.fetchPriority = 'high';
  image.href = matchMedia('(max-width: 767px)').matches
    ? new URL('../assets/destinations/suzhou-240.webp', import.meta.url).href
    : new URL('../assets/destinations/suzhou-480.webp', import.meta.url).href;
  document.head.append(image);
  void featureLoaders['../features/squad/index.ts']?.().catch(() => undefined);
}
function feature<K extends keyof FeatureExports>(path: string, name: K): FeatureExports[K] {
  const load = featureLoaders['../features/' + path + '/index.ts'];
  if (!load) return undefined;
  return lazy(async () => {
    const module = await load(); const Page = module[name];
    if (!Page) throw new Error('功能入口缺失：' + name);
    return { default: Page as ComponentType<object> };
  }) as FeatureExports[K];
}
export const featureExports: FeatureExports = {
  SquadPage: feature('squad', 'SquadPage'), PlansPage: feature('plans', 'PlansPage'),
  ItineraryPage: feature('itinerary', 'ItineraryPage'), LedgerPage: feature('ledger', 'LedgerPage'),
  SnapshotPage: feature('sharing', 'SnapshotPage'), JoinPage: feature('sharing', 'JoinPage'),
  ResponsePage: feature('sharing', 'ResponsePage'), SharingPanels: feature('sharing', 'SharingPanels'),
};
export async function loadFeatureExports(): Promise<FeatureExports> {
  return Object.assign({}, ...await Promise.all(Object.values(featureLoaders).map(load => load())));
}
interface DomainExports {
  applyPlanningCommand?: DomainModule['apply']; validatePlanningTrip?: DomainModule['validate'];
  applyItineraryLedgerCommand?: DomainModule['apply']; validateItineraryLedgerTrip?: DomainModule['validate'];
  applySharingCommand?: DomainModule['apply']; validateSharingTrip?: DomainModule['validate'];
  buildTemplateItinerary?: DomainDependencies['buildTemplateItinerary'];
  planningService?: PlanningService;
}
const domains = import.meta.glob('../domain/{planning,itinerary,ledger,sharing}/index.ts', { eager: true }) as Record<string, DomainExports>;
const exports: DomainExports = Object.assign({}, ...Object.values(domains));
export const domainModules: Partial<Record<'planning' | 'itineraryLedger' | 'sharing', DomainModule>> = {};
if (exports.applyPlanningCommand && exports.validatePlanningTrip) domainModules.planning = { apply: exports.applyPlanningCommand, validate: exports.validatePlanningTrip };
if (exports.applyItineraryLedgerCommand && exports.validateItineraryLedgerTrip) domainModules.itineraryLedger = { apply: exports.applyItineraryLedgerCommand, validate: exports.validateItineraryLedgerTrip };
if (exports.applySharingCommand && exports.validateSharingTrip) domainModules.sharing = { apply: exports.applySharingCommand, validate: exports.validateSharingTrip };
const unavailable = () => failure('NOT_IMPLEMENTED', '规划模块尚未接入');
const planning: PlanningService = {
  getPlanEvaluations: () => { throw new Error('规划模块尚未接入'); },
  getConsensusStatus: () => ({ canConfirm: false, confirmed: false, reasons: ['规划模块尚未接入'] }),
  findCommonDepartures: () => { throw new Error('规划模块尚未接入'); },
  updateMemberConstraints: unavailable, evaluatePersonalPlan: () => { throw new Error('规划模块尚未接入'); }, getTemplate: unavailable,
};
export const dependencies: DomainDependencies = { createDemo: createDemoTrip, planning: exports.planningService ?? planning, buildTemplateItinerary: exports.buildTemplateItinerary ?? (() => failure('NOT_IMPLEMENTED', '日程构建器尚未接入')) };
