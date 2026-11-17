/**
 * 分享域类型：传递 envelope、四类载荷白名单结构、结构化错误与依赖端口。
 *
 * 业务规则依据 docs/BUSINESS_RULES.md BR-13～BR-15。
 * 核心实体（Trip/Member/Plan 等）唯一来源是 src/domain/types.ts（B0 冻结契约），
 * 此处只引用，不重复定义实体。
 */
import type {
  Activity,
  Cents,
  Confirmation,
  DateOnly,
  Expense,
  Id,
  IntentValue,
  Member,
  Range,
  Settlement,
  Trip,
} from '../types';

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
  /** 日程替换方案活动分项产生的差额 S-A；未知条目存在时该值不代表完整预算。 */
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

/** 经 T02 语义校验与归一化（区间合并等）后的成员资料。 */
export interface NormalizedMemberProfile {
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
  trip: Trip;
}

export type TypedEnvelope<T extends SharingEnvelopeType> = SharingEnvelope<
  T extends 'snapshot' ? SnapshotBody : T extends 'invitation' ? InvitationBody : T extends 'response' ? ResponseBody : BackupBody
>;

// ---------------------------------------------------------------------------
// 结构化错误与结果（页面需要 code/message/字段问题，不能只有 boolean）
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

// ---------------------------------------------------------------------------
// 命令与应用结果
// ---------------------------------------------------------------------------

export interface RegisterInvitationPayload {
  kind: 'sharing.registerInvitation';
  invitationId: string;
  memberId: Id;
}

export interface ApplyResponsePayload {
  kind: 'sharing.applyResponse';
  response: SharingEnvelope<ResponseBody>;
  /** 同一邀请的重新提交需要用户显式选择替换后才允许应用（BR-14）。 */
  replacePrevious?: boolean;
}

export type SharingCommand = RegisterInvitationPayload | ApplyResponsePayload;

export type SharingApplyResult =
  | { status: 'updated'; trip: Trip }
  | { status: 'noop'; reason: 'duplicate-payload' }
  | { status: 'rejected'; error: SharingError };

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

// ---------------------------------------------------------------------------
// 依赖端口：日期/估算/共识/成员约束语义归 T01 dates 与 T02 规划服务所有，
// 集成时由 application/sharing.ts 注入真实实现；测试注入替身。
// ---------------------------------------------------------------------------

export type ConfirmationStatus = 'preparing' | 'confirmed' | 'stale';

export interface SharingDeps {
  /** 内置目的地模板信息（名称/标签），供邀请与快照展示。 */
  destinationInfo(destinationId: Id): { name: string; tags: string[] } | null;
  /** 派生确认状态（T02 共识查询，按数据重新求值）。 */
  confirmationStatus(trip: Trip): ConfirmationStatus;
  /** 成员资料语义校验与归一化（昵称/预算/日期区间/偏好，T02 规则）。 */
  validateProfile(profile: MemberProfileInput): SharingResult<NormalizedMemberProfile>;
  /** 相同值不算变化（BR-02），由此决定是否递增 constraintRevision。 */
  profileChanged(member: Member, profile: NormalizedMemberProfile): boolean;
  /**
   * 应用资料变化并使旧意向失效、constraintRevision 加一（T02 辅助函数）。
   * T04 不得复制失效逻辑，只能通过本端口调用。
   */
  applyProfileChange(trip: Trip, memberId: Id, profile: NormalizedMemberProfile): Trip;
}

/** 命令执行上下文：显式时间与 ID，不隐式读取时钟。 */
export interface SharingContext {
  now: string;
}

/** 各集合上限（BR-01/开发文档）；B0 若导出统一常量则在集成时替换来源。 */
export const SHARING_LIMITS = {
  urlBytes: 8000,
  jsonBytes: 1_048_576,
  /** 解码前对编码文本的保守上限（1 MiB JSON 的 Base64URL 展开上限附近）。 */
  encodedFragmentBytes: 1_400_000,
  maxAmountCents: 10_000_000, // ¥100,000
  members: 20,
  plans: 20,
  activities: 100,
  expenses: 200,
  settlements: 200,
  intents: 2000,
  invitations: 1000,
  appliedResponses: 1000,
  appliedCommandIds: 5000,
} as const;

/** 白名单字段名（用于测试断言隐私范围）。 */
export const SNAPSHOT_EXCLUDED_KEYS = [
  'members',
  'intents',
  'expenses',
  'settlements',
  'invitations',
  'appliedResponses',
] as const;

export type { Activity, Cents, Confirmation, DateOnly, Expense, Id, Member, Range, Settlement, Trip };
