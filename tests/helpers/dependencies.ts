import type { DomainDependencies } from '../../src/contracts/services';
import { failure } from '../../src/contracts/result';
const unavailable = () => failure('NOT_IMPLEMENTED', '测试依赖未实现');
export const dependencies: DomainDependencies = {
  planning: { getPlanEvaluations: () => [], getConsensusStatus: () => ({ canConfirm: false, confirmed: false, reasons: [] }), findCommonDepartures: () => [], updateMemberConstraints: unavailable, evaluatePersonalPlan: () => { throw new Error('unused'); }, getTemplate: unavailable },
  buildTemplateItinerary: unavailable,
};
