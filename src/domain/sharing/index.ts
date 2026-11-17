/**
 * 分享域公共入口（任务书 §5）：
 * - 领域入口：applySharingCommand、validateSharingTrip、buildPublicSnapshot 等。
 * - 所有函数都是纯函数：显式传入时间与 ID，不访问存储、网络或系统时钟；
 *   幂等、expectedRevision、事务与 revision 递增由 T01 仓库执行。
 */
import type {
  ApplyResponsePayload,
  RegisterInvitationPayload,
  SharingApplyResult,
  SharingCommand,
  SharingContext,
  SharingDeps,
  Trip,
} from './types';
import { registerInvitationToTrip } from './invitation';
import { applyResponseToTrip } from './response';

export { buildPublicSnapshot, snapshotToNewTripDraft } from './snapshot';
export type { BuildSnapshotOptions, OutOfRangeActivityRef, SnapshotToTripOptions, NewIdFactory } from './snapshot';
export { buildInvitationEnvelope, registerInvitationToTrip, DEFAULT_INVITATION_INSTRUCTIONS } from './invitation';
export type { BuildInvitationOptions, RegisterInvitationCommand } from './invitation';
export {
  buildResponseEnvelope,
  previewResponseImport,
  applyResponseToTrip,
} from './response';
export type {
  BuildResponseOptions,
  ResponsePreview,
  ResponsePreviewState,
  ResponseIntentBefore,
  ApplyResponseOptions,
} from './response';
export {
  buildBackupEnvelope,
  validateSharingTrip,
  validateBackupForImport,
  summarizeBackup,
  remapTripIds,
  planBackupImport,
  DEFAULT_VALIDATE_LIMITS,
} from './backup';
export type {
  BuildBackupOptions,
  SharingValidateLimits,
  BackupImportOptions,
  BackupImportPlan,
  BackupSummary,
  RemapKind,
  RemapOptions,
} from './backup';
export {
  decodeEnvelopeFromJson,
  sharingEnvelopeSchema,
  snapshotEnvelopeSchema,
  invitationEnvelopeSchema,
  responseEnvelopeSchema,
  backupEnvelopeSchema,
  snapshotBodySchema,
  invitationBodySchema,
  responseBodySchema,
  backupBodySchema,
  memberProfileSchema,
  tripBackupSchema,
  isKnownEnvelopeType,
  KNOWN_ENVELOPE_TYPES,
} from './schema';
export type { ParsedSharingEnvelope } from './schema';
export { bytesToBase64Url, base64UrlToBytes, isBase64UrlText } from './codec';
export { addDays, isCalendarDate, planDateRange, isWithinRange, daysInMonth } from './calendar';
export { SHARING_LIMITS, SHARING_SCHEMA_VERSION, sharingError } from './types';
export type {
  SharingEnvelope,
  SharingEnvelopeType,
  SharingResult,
  SharingError,
  SharingErrorCode,
  SharingFieldIssue,
  SharingDeps,
  SharingContext,
  SharingCommand,
  SharingApplyResult,
  SnapshotBody,
  SnapshotEstimateParams,
  SnapshotEstimateSummary,
  PublicActivity,
  InvitationBody,
  InvitationPlanEntry,
  ResponseBody,
  ResponseIntentEntry,
  BackupBody,
  MemberProfileInput,
  NormalizedMemberProfile,
  BackupImportAction,
  ConfirmationStatus,
} from './types';

export interface ApplySharingCommandOptions extends SharingContext {
  deps: SharingDeps;
}

/**
 * 统一命令入口：sharing.registerInvitation / sharing.applyResponse。
 * 返回新 Trip 或结构化业务错误；不直接持久化（BR-13/BR-14）。
 */
export function applySharingCommand(
  trip: Trip,
  command: SharingCommand,
  options: ApplySharingCommandOptions,
): SharingApplyResult {
  if (command.kind === 'sharing.registerInvitation') {
    return registerInvitationToTrip(trip, command satisfies RegisterInvitationPayload, options);
  }
  const responseCommand = command satisfies ApplyResponsePayload;
  return applyResponseToTrip(trip, responseCommand.response, {
    now: options.now,
    deps: options.deps,
    replacePrevious: responseCommand.replacePrevious,
  });
}
