import { createDemoTrip } from './application/demo';
import type { DomainDependencies, DomainModule, FeatureExports, PlanningService } from '../contracts/services';
import { failure } from '../contracts/result';
const features = import.meta.glob('../features/*/index.ts', { eager: true }) as Record<string, FeatureExports>;
export const featureExports: FeatureExports = Object.assign({}, ...Object.values(features));
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
