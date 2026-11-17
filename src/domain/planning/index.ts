// T02 规划域公共出口（任务书 §5）。
// 页面 SquadPage / PlansPage 由各 feature 的 index.ts 导出（B0 合并后实现）。

export { applyPlanningCommand, updateMemberConstraints, toPlanningContext } from './commands';
export type { PlanningCommandContext } from './commands';
export { MAX_PLAN_COUNT, MAX_INTENT_COUNT, MAX_SEARCH_WINDOW_DAYS } from './commands';

export { validatePlanningTrip } from './validation';
export type { ValidationIssue } from './validation';

export { getPlanEvaluations, evaluateMemberAgainstPlan, computePreferenceScore, evaluateInviteePlans } from './evaluation';
export type { InviteePlanInput, InviteeEvaluation } from './evaluation';

export {
  getConsensusStatus,
  getConsensusStatusOfTrip,
  getConfirmationBlockers,
  canConfirmPlan,
  isIntentCurrentFor,
  findDecliningConfirmedMembers,
} from './consensus';
export { MIN_MEMBERS_TO_CONFIRM } from './consensus';

export { findCommonDepartures, getDepartureConflicts, getMergedAvailability, coversStay, MAX_COMMON_DEPARTURES } from './availability';

export {
  getMemberProfileStatus,
  getMissingProfileFields,
  validateMemberProfileInput,
  MAX_MEMBER_COUNT,
  MAX_AVAILABILITY_RANGES,
} from './profile';

export { computeEstimateBreakdown, resolveTransportCents, estimateRangeOf, ESTIMATE_CAP_CENTS } from './estimates';

export type {
  PlanningContext,
  PlanningDeps,
  DestinationInfo,
  MemberProfileInput,
  MemberPlanStatus,
  PlanEvaluation,
  PlanSortKey,
  CurrentIntentView,
  CommonDepartures,
  DepartureConflictRow,
  ConsensusStatus,
  ConsensusStatusKind,
  ConfirmationBlocker,
  PlanningCommand,
  PlanningError,
  PlanningErrorCode,
  PlanningResult,
} from './types';
