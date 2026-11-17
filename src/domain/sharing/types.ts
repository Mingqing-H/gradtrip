/**
 * 分享域类型：传递 envelope、四类载荷白名单结构、结构化错误。
 *
 * 业务规则依据 docs/BUSINESS_RULES.md BR-13～BR-15。
 * 核心实体（Trip/Member/Plan 等）与命令/规划服务契约唯一来源是 B0：
 * src/domain/types.ts、src/domain/commands.ts、src/contracts/services.ts，
 * 此处只引用，不重复定义实体。
 */
import type { BusinessError } from '../../contracts/result';
import type { PlanningService } from '../../contracts/services';
import type { ResponseInput } from '../commands';
import type {
  Activity,
  Cents,
  DateOnly,
  Id,
  Intent,
  IntentValue,
  Range,
  Trip,
} from '../types';

export type { Activity, Cents, DateOnly, Id, Intent, Range, Trip };

export type SharingEnvelopeType = 'snapshot' | 'invitation' | 'response' | 'backup';

export const SHARING_SCHEMA_VERSION = 1;

/** snapshot/invitation/response/backup 共用 envelope（BR-13）。 */
export interface SharingEnvelope<Body = unknown> {
  schemaVersion: typeof SHARING_SCHEMA_VERSION;
  type: SharingEnvelopeType;
  payloadId: string;
  createdAt: string;
  body: Body;
}

/**
 * 公开日程条目：与领域 Activity 相比刻意去掉 note（BR-13 排除备注）。
 */
export type PublicActivity = Omit<Activity, 'note'>;

export interface SnapshotEstimateParams {
  lodgingPerNight: Cents;
  foodPerDay: Cents;
  activities: Cents;
  reserve: Cents;
}

/** 快照的公开估算总览：不含任何成员个人交通（交通随出发城市而变，属成员相关）。 */
export interface SnapshotEstimateSummary {
  /** 人均公共基准 = H*(D-1)+F*D+A+R，不含往返交通。 */
  basePerPersonCents: number;
  /** 公开日程中已知金额的 activities 条目合计 S。 */
  itineraryActivitiesCents: number;
  /** 公开日程中金额未知的 activities 条目数量。 */
  itineraryUnknownCount: number;
  /** 日程替换方案活动分项产生的差额 S-A；存在未知条目时该值不代表完整预算。 */
  deltaCents: number;
}

export interface SnapshotBody {
  tripName: string;
  plan: {
    id: Id;
    version: number;
    templateVersion: number;
    destinationId: Id;
    destinationName: string;
    destinationTags: string[];
    startDate: DateOnly;
    days: 2 | 3 | 4 | 5;
    estimateParams: SnapshotEstimateParams;
  };
  /** 生成时刻的确认状态：draft 表示未确认或确认已失效，不代表打开时刻仍有效。 */
  confirmation: {
    status: 'confirmed' | 'draft';
    planId: Id;
    planVersion: number;
    constraintRevision: number;
    confirmedAt: string | null;
  };
  estimateSummary: SnapshotEstimateSummary;
  itinerary: {
    startDate: DateOnly;
    endDate: DateOnly;
    activities: PublicActivity[];
  } | null;
}

/** 邀请中单个候选方案的公开条目；estimate 只带共用参数与目标成员自己的手工交通值。 */
export interface InvitationPlanEntry {
  id: Id;
  version: number;
  templateVersion: number;
  destinationId: Id;
  destinationName: string;
  destinationTags: string[];
  startDate: DateOnly;
  days: 2 | 3 | 4 | 5;
  estimate: SnapshotEstimateParams & {
    /** 仅在分享范围确认后附带的目标成员手工交通值；null 表示未附带。 */
    manualTransport: { originCity: string; amountCents: Cents } | null;
  };
}

export interface InvitationBody {
  tripId: Id;
  tripName: string;
  member: { id: Id; name: string };
  constraintRevision: number;
  templateVersion: number;
  searchWindow: Range;
  duration: 2 | 3 | 4 | 5;
  plans: InvitationPlanEntry[];
  instructions: string;
}

/** 成员在填写页提交的资料（未经 T02 语义归一化的原始白名单结构）。 */
export interface MemberProfileInput {
  name: string;
  originCity: string | null;
  budgetCap: Cents | null;
  availability: Range[];
  preferences: string[];
}

export interface ResponseIntentEntry {
  planId: Id;
  planVersion: number;
  value: IntentValue;
}

export interface ResponseBody {
  invitationId: string;
  tripId: Id;
  memberId: Id;
  memberName: string;
  baseConstraintRevision: number;
  profile: MemberProfileInput;
  intents: ResponseIntentEntry[];
}

export interface BackupBody {
  trip: unknown;
}

export type TypedEnvelope<T extends SharingEnvelopeType> = SharingEnvelope<
  T extends 'snapshot' ? SnapshotBody : T extends 'invitation' ? InvitationBody : T extends 'response' ? ResponseBody : BackupBody
>;

// ---------------------------------------------------------------------------
// 结构化错误与结果（页面需要 code/message/字段问题，不能只有 boolean）。
// 命令执行边界统一转换为 B0 的 Result/BusinessError（contracts/result）。
// ---------------------------------------------------------------------------

export type SharingErrorCode =
  | 'SCHEMA_INVALID'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'UNKNOWN_ENVELOPE_TYPE'
  | 'JSON_INVALID'
  | 'ENCODE_INVALID'
  | 'PAYLOAD_TOO_LARGE'
  | 'URL_TOO_LONG'
  | 'LINK_INVALID'
  | 'CROSS_ORIGIN'
  | 'BASE_MISMATCH'
  | 'UNSUPPORTED_ROUTE'
  | 'TRIP_MISMATCH'
  | 'TRIP_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'MEMBER_MISMATCH'
  | 'PLAN_NOT_FOUND'
  | 'PLAN_VERSION_MISMATCH'
  | 'INVITATION_NOT_REGISTERED'
  | 'CONSTRAINT_STALE'
  | 'DUPLICATE_PAYLOAD'
  | 'RESUBMISSION_REQUIRES_CHOICE'
  | 'PROFILE_INVALID'
  | 'ITINERARY_OUT_OF_RANGE'
  | 'LIMIT_EXCEEDED'
  | 'ID_CONFLICT'
  | 'BACKUP_INVALID';

export interface SharingFieldIssue {
  field: string;
  message: string;
}

export interface SharingError {
  code: SharingErrorCode;
  message: string;
  fields?: SharingFieldIssue[];
  /** 附加事实，如过期时的当前 constraintRevision、越界活动定位列表。 */
  meta?: Record<string, unknown>;
}

export type SharingResult<T> = { ok: true; value: T } | { ok: false; error: SharingError };

export function sharingError(
  code: SharingErrorCode,
  message: string,
  extra?: { fields?: SharingFieldIssue[]; meta?: Record<string, unknown> },
): SharingError {
  return extra ? { code, message, ...extra } : { code, message };
}

/** 分享域错误码 -> B0 BusinessError 错误码（命令边界）。 */
function toBusinessCode(code: SharingErrorCode): BusinessError['code'] {
  switch (code) {
    case 'MEMBER_NOT_FOUND':
    case 'TRIP_NOT_FOUND':
    case 'PLAN_NOT_FOUND':
    case 'INVITATION_NOT_REGISTERED':
      return 'NOT_FOUND';
    case 'CONSTRAINT_STALE':
    case 'PLAN_VERSION_MISMATCH':
      return 'EXPIRED';
    case 'DUPLICATE_PAYLOAD':
    case 'RESUBMISSION_REQUIRES_CHOICE':
    case 'ID_CONFLICT':
    case 'TRIP_MISMATCH':
    case 'MEMBER_MISMATCH':
      return 'CONFLICT';
    case 'LIMIT_EXCEEDED':
    case 'PAYLOAD_TOO_LARGE':
    case 'URL_TOO_LONG':
      return 'CAPACITY';
    case 'SCHEMA_INVALID':
    case 'BACKUP_INVALID':
    case 'PROFILE_INVALID':
    case 'ITINERARY_OUT_OF_RANGE':
      return 'VALIDATION';
    default:
      return 'CORRUPT';
  }
}

export function toBusinessError(error: SharingError): BusinessError {
  return {
    code: toBusinessCode(error.code),
    message: error.message,
    ...(error.fields ? { fields: Object.fromEntries(error.fields.map((f) => [f.field, f.message])) } : {}),
  };
}

// ---------------------------------------------------------------------------
// 命令与应用结果
// ---------------------------------------------------------------------------

/** 供应用层把 wire 格式 ResponseBody 转为 B0 命令的 ResponseInput。 */
export function responseBodyToInput(envelope: SharingEnvelope<ResponseBody>): ResponseInput {
  const body = envelope.body;
  const planVersions: Record<Id, number> = {};
  for (const entry of body.intents) planVersions[entry.planId] = entry.planVersion;
  return {
    id: envelope.payloadId,
    invitationId: body.invitationId,
    tripId: body.tripId,
    memberId: body.memberId,
    constraintRevision: body.baseConstraintRevision,
    planVersions,
    member: {
      name: body.profile.name,
      originCity: body.profile.originCity,
      budgetCap: body.profile.budgetCap,
      availability: body.profile.availability.map((range) => ({ ...range })),
      preferences: [...body.profile.preferences],
    },
    intents: body.intents.map((entry) => ({ planId: entry.planId, planVersion: entry.planVersion, value: entry.value })),
  };
}

export type BackupImportAction = 'create' | 'copy' | 'overwrite';

export interface BackupImportPlan {
  action: BackupImportAction;
  trip: Trip;
}

export interface BackupSummary {
  name: string;
  memberCount: number;
  searchWindow: Range | null;
  itineraryRange: Range | null;
  expenseCount: number;
  settlementCount: number;
  revision: number;
  exportedAt: string;
  /** 本地是否存在同 tripId 的旅行。 */
  localSameId: boolean;
  localRevision: number | null;
  /** 导入版本较本地旧（仅同 ID 覆盖预览时有意义）。 */
  olderThanLocal: boolean;
}

/** 领域函数依赖 B0 冻结的规划服务接口（成员约束更新、共识查询、模板信息）。 */
export type SharingPlanning = Pick<
  PlanningService,
  'updateMemberConstraints' | 'getConsensusStatus' | 'getTemplate'
>;

/** 命令执行上下文：显式时间，不隐式读取时钟。 */
export interface SharingContext {
  now: string;
}

/**
 * 各集合上限沿用 B0 schema（src/domain/schema.ts）；url/json 上限为分享域自管。
 */
export const SHARING_LIMITS = {
  urlBytes: 8000,
  jsonBytes: 1_048_576,
  /** 解码前对编码文本的保守上限（1 MiB JSON 的 Base64URL 展开上限附近）。 */
  encodedFragmentBytes: 1_400_000,
  members: 20,
  plans: 20,
  activities: 1000,
  expenses: 2000,
  settlements: 2000,
  intents: 2000,
  invitations: 1000,
  appliedResponses: 1000,
  appliedCommandIds: 5000,
} as const;
