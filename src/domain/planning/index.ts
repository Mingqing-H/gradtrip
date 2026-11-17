// T02 规划域公共出口（任务书 §5 + B0 模块发现约定）。
//
// B0 的 src/app/modules.ts 通过 import.meta.glob 发现本文件并按固定名取用：
// - applyPlanningCommand: CommandHandler（B0 签名，来自 ./adapter）
// - validatePlanningTrip: (trip) => BusinessError[]（B0 签名，来自 ./adapter）
// - planningService: PlanningService（完整实现）
// 任务书要求的内部纯函数以原名导出（参数语义见各文件注释），供测试与 T03/T04 使用。

export {
  applyPlanningCommand,
  validatePlanningTripB0 as validatePlanningTrip,
  planningService,
} from './adapter';

// 内部纯函数（测试与跨模块使用，参数与 B0 签名不同）
export { applyPlanningCommand as applyPlanningCommandCore, updateMemberConstraints, toPlanningContext } from './commands';
export type { PlanningCommandContext } from './commands';
export { MAX_PLAN_COUNT, MAX_INTENT_COUNT, MAX_SEARCH_WINDOW_DAYS } from './commands';
export { validatePlanningTrip as validatePlanningTripCore } from './validation';
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
export { getDepartureConflicts as getDepartureConflictsCore } from './availability';

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
