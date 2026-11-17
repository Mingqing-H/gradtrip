/**
 * 分享域公共入口（任务书 §5 + B0 模块发现契约 src/app/modules.ts）：
 * - applySharingCommand：CommandHandler，处理 sharing.registerInvitation /
 *   sharing.applyResponse；输入输出服从 B0 类型（Result<Trip>）。
 * - validateSharingTrip：TripValidator，由 T01 在每次命令提交后聚合执行。
 * - 其余为分享域构建/预览纯函数：显式传入时间与 ID，不访问存储、网络或系统时钟；
 *   幂等、expectedRevision、事务与 revision 递增由 T01 仓库执行。
 */
import type { CommandContext, CommandPayload } from '../commands';
import type { Result } from '../../contracts/result';
import { failure } from '../../contracts/result';
import type { DomainDependencies } from '../../contracts/services';
import type { Trip } from '../types';
import type { SharingError } from './types';
import { toBusinessError } from './types';
import { registerInvitationToTrip } from './invitation';
import { applyResponseToTrip } from './response';

export { buildPublicSnapshot, snapshotToNewTripDraft } from './snapshot';
export type { BuildSnapshotOptions, OutOfRangeActivityRef, SnapshotToTripOptions, NewIdFactory } from './snapshot';
export { buildInvitationEnvelope, registerInvitationToTrip, DEFAULT_INVITATION_INSTRUCTIONS } from './invitation';
export type { BuildInvitationOptions } from './invitation';
export { buildResponseEnvelope, previewResponseImport, applyResponseToTrip } from './response';
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
  validateImportedTrip,
  validateBackupForImport,
  summarizeBackup,
  remapTripIds,
  planBackupImport,
} from './backup';
export type {
  BuildBackupOptions,
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
  isKnownEnvelopeType,
  KNOWN_ENVELOPE_TYPES,
} from './schema';
export type { ParsedSharingEnvelope } from './schema';
export { bytesToBase64Url, base64UrlToBytes, isBase64UrlText } from './codec';
export { SHARING_LIMITS, SHARING_SCHEMA_VERSION, sharingError, toBusinessError, responseBodyToInput } from './types';
export type {
  SharingEnvelope,
  SharingEnvelopeType,
  SharingResult,
  SharingError,
  SharingErrorCode,
  SharingFieldIssue,
  SharingContext,
  SharingPlanning,
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
  BackupImportAction,
} from './types';

/**
 * B0 CommandHandler：sharing.registerInvitation / sharing.applyResponse。
 * revision 递增、commandId 幂等与 expectedRevision 检查由 T01 applyCommand/仓库负责。
 */
export function applySharingCommand(
  trip: Trip,
  payload: CommandPayload,
  context: CommandContext,
  dependencies: DomainDependencies,
): Result<Trip> {
  if (payload.type === 'sharing.registerInvitation') {
    const result = registerInvitationToTrip(trip, payload.invitation);
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: toBusinessError(result.error as SharingError) };
  }
  if (payload.type === 'sharing.applyResponse') {
    return applyResponseToTrip(trip, payload.response, {
      now: context.now,
      planning: dependencies.planning,
    });
  }
  return failure('NOT_IMPLEMENTED', `分享域不支持命令 ${payload.type}`);
}
