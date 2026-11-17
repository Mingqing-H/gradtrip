/**
 * 四类传递载荷的运行时白名单 schema（BR-13）。
 *
 * envelope 结构为 T04 自维护的白名单；核心实体结构以 MVP_DEVELOPMENT §4
 * 的 Trip 契约为准。所有对象使用 strictObject：未知字段一律拒绝，
 * 不执行载荷文本（BR-13），语义校验（引用/不变量/版本）在领域函数中进行。
 */
import { z } from 'zod';
import { isCalendarDate } from './calendar';
import { SHARING_LIMITS, SHARING_SCHEMA_VERSION, sharingError } from './types';
import type { BackupBody, InvitationBody, ResponseBody, SharingResult, SnapshotBody } from './types';

// ---------------------------------------------------------------------------
// 基础标量
// ---------------------------------------------------------------------------

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须为 YYYY-MM-DD')
  .refine(isCalendarDate, { message: '日期不存在' });

const isoTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/, '时间必须为 ISO 8601');

const idText = z.string().min(1).max(64);

const centsNonNegative = z.number().int().min(0).max(SHARING_LIMITS.maxAmountCents);
const centsPositive = z.number().int().min(1).max(SHARING_LIMITS.maxAmountCents);

const daysValue = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const range = z
  .strictObject({
    start: dateOnly,
    end: dateOnly,
  })
  .refine((value) => value.start <= value.end, { message: '起日不得晚于止日' });

const intentValue = z.enum(['approve', 'acceptable', 'decline']);

const preferences = z
  .array(z.string().trim().min(1).max(12))
  .max(8, '偏好标签最多 8 个')
  .refine((items) => new Set(items).size === items.length, { message: '偏好标签不得重复' });

// ---------------------------------------------------------------------------
// snapshot 白名单：只含公开计划内容；成员资料、备注、账目、反馈历史全部排除。
// ---------------------------------------------------------------------------

const publicActivity = z.strictObject({
  id: idText,
  date: dateOnly,
  startTime: z.union([z.null(), z.string().regex(/^\d{2}:\d{2}$/, '时间必须为 HH:mm')]),
  endTime: z.union([z.null(), z.string().regex(/^\d{2}:\d{2}$/, '时间必须为 HH:mm')]),
  title: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(30),
  budgetBucket: z.enum(['activities', 'included']),
  perPersonEstimate: z.union([z.null(), centsNonNegative]),
  order: z.number().int().min(0),
});

const estimateParams = z.strictObject({
  lodgingPerNight: centsNonNegative,
  foodPerDay: centsNonNegative,
  activities: centsNonNegative,
  reserve: centsNonNegative,
});

export const snapshotBodySchema = z.strictObject({
  tripName: z.string().trim().min(1).max(40),
  plan: z.strictObject({
    id: idText,
    version: z.number().int().min(1),
    templateVersion: z.number().int().min(1),
    destinationId: idText,
    destinationName: z.string().trim().min(1).max(40),
    destinationTags: z.array(z.string().trim().min(1).max(12)).max(8),
    startDate: dateOnly,
    days: daysValue,
    estimateParams,
  }),
  confirmation: z.strictObject({
    status: z.enum(['confirmed', 'draft']),
    planId: idText,
    planVersion: z.number().int().min(1),
    constraintRevision: z.number().int().min(0),
    confirmedAt: z.union([z.null(), isoTimestamp]),
  }),
  estimateSummary: z.strictObject({
    basePerPersonCents: centsNonNegative,
    itineraryActivitiesCents: centsNonNegative,
    itineraryUnknownCount: z.number().int().min(0),
    deltaCents: z.number().int(),
  }),
  itinerary: z.union([
    z.null(),
    z.strictObject({
      startDate: dateOnly,
      endDate: dateOnly,
      activities: z.array(publicActivity).max(SHARING_LIMITS.activities),
    }),
  ]),
});

// ---------------------------------------------------------------------------
// invitation 白名单：目标成员填写上下文；不含其他成员资料、账本、私密备注，
// 不预填目标成员预算与可用日期，交通只允许目标成员自己的手工值。
// ---------------------------------------------------------------------------

export const invitationBodySchema = z.strictObject({
  tripId: idText,
  tripName: z.string().trim().min(1).max(40),
  member: z.strictObject({
    id: idText,
    name: z.string().trim().min(1).max(20),
  }),
  constraintRevision: z.number().int().min(0),
  templateVersion: z.number().int().min(1),
  searchWindow: range,
  duration: daysValue,
  plans: z
    .array(
      z.strictObject({
        id: idText,
        version: z.number().int().min(1),
        templateVersion: z.number().int().min(1),
        destinationId: idText,
        destinationName: z.string().trim().min(1).max(40),
        destinationTags: z.array(z.string().trim().min(1).max(12)).max(8),
        startDate: dateOnly,
        days: daysValue,
        estimate: estimateParams.extend({
          manualTransport: z.union([
            z.null(),
            z.strictObject({
              originCity: z.string().trim().min(1).max(40),
              amountCents: centsPositive,
            }),
          ]),
        }),
      }),
    )
    .min(1, '邀请必须包含至少一个候选方案')
    .max(SHARING_LIMITS.plans),
  instructions: z.string().max(200),
});

// ---------------------------------------------------------------------------
// response 白名单：成员资料与意向；不含账本、其他成员资料或任意修改指令。
// ---------------------------------------------------------------------------

export const memberProfileSchema = z.strictObject({
  name: z.string().trim().min(1, '昵称为必填').max(20, '昵称最多 20 字'),
  originCity: z.union([z.null(), z.string().trim().min(1, '城市不能为空白').max(40)]),
  budgetCap: z.union([z.null(), centsNonNegative.max(SHARING_LIMITS.maxAmountCents)]),
  availability: z.array(range).max(5, '最多 5 段可用日期'),
  preferences,
});

export const responseBodySchema = z.strictObject({
  invitationId: idText,
  tripId: idText,
  memberId: idText,
  memberName: z.string().trim().min(1).max(20),
  baseConstraintRevision: z.number().int().min(0),
  profile: memberProfileSchema,
  intents: z
    .array(
      z.strictObject({
        planId: idText,
        planVersion: z.number().int().min(1),
        value: intentValue,
      }),
    )
    .max(SHARING_LIMITS.plans)
    .refine((items) => new Set(items.map((item) => item.planId)).size === items.length, {
      message: '同一方案只能有一条意向',
    }),
});

// ---------------------------------------------------------------------------
// backup 白名单：完整单个 Trip；不含应用缓存、其他旅行或 UI 状态。
// ---------------------------------------------------------------------------

const memberSchema = z.strictObject({
  id: idText,
  name: z.string().trim().min(1).max(20),
  originCity: z.union([z.null(), z.string().trim().min(1).max(40)]),
  budgetCap: z.union([z.null(), centsNonNegative]),
  availability: z.array(range).max(5),
  preferences,
});

const planSchema = z.strictObject({
  id: idText,
  version: z.number().int().min(1),
  destinationId: idText,
  templateVersion: z.number().int().min(1),
  startDate: dateOnly,
  days: daysValue,
  estimate: z.strictObject({
    transportByMember: z.record(
      z.string(),
      z.union([
        z.null(),
        z.strictObject({
          originCity: z.string().trim().min(1).max(40),
          amount: centsPositive,
        }),
      ]),
    ),
    lodgingPerNight: centsNonNegative,
    foodPerDay: centsNonNegative,
    activities: centsNonNegative,
    reserve: centsNonNegative,
  }),
});

const intentSchema = z.strictObject({
  memberId: idText,
  planId: idText,
  planVersion: z.number().int().min(1),
  constraintRevision: z.number().int().min(0),
  value: intentValue,
  source: z.enum(['organizer', 'feedback', 'demo']),
  recordedAt: isoTimestamp,
});

const confirmationSchema = z.strictObject({
  planId: idText,
  planVersion: z.number().int().min(1),
  constraintRevision: z.number().int().min(0),
  confirmedAt: isoTimestamp,
});

const activitySchema = z.strictObject({
  id: idText,
  date: dateOnly,
  startTime: z.union([z.null(), z.string().regex(/^\d{2}:\d{2}$/, '时间必须为 HH:mm')]),
  endTime: z.union([z.null(), z.string().regex(/^\d{2}:\d{2}$/, '时间必须为 HH:mm')]),
  title: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(30),
  budgetBucket: z.enum(['activities', 'included']),
  perPersonEstimate: z.union([z.null(), centsNonNegative]),
  note: z.string().max(300),
  order: z.number().int().min(0),
});

const expenseSchema = z.strictObject({
  id: idText,
  title: z.string().trim().min(1).max(60),
  date: dateOnly,
  category: z.string().trim().min(1).max(30),
  amount: centsPositive,
  payerId: idText,
  splitMode: z.enum(['equal', 'custom']),
  allocations: z
    .array(
      z.strictObject({
        memberId: idText,
        amount: centsNonNegative,
      }),
    )
    .min(1),
  createdAt: isoTimestamp,
});

const settlementSchema = z.strictObject({
  id: idText,
  commandId: idText,
  fromId: idText,
  toId: idText,
  amount: centsPositive,
  recordedAt: isoTimestamp,
  voidedAt: z.union([z.null(), isoTimestamp]),
});

const invitationRecordSchema = z.strictObject({
  id: idText,
  memberId: idText,
  constraintRevision: z.number().int().min(0),
  planVersions: z.record(z.string(), z.number().int().min(1)),
  createdAt: isoTimestamp,
});

export const tripBackupSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: idText,
  name: z.string().trim().min(1).max(40),
  revision: z.number().int().min(0),
  constraintRevision: z.number().int().min(0),
  searchWindow: range,
  duration: daysValue,
  members: z.array(memberSchema).max(SHARING_LIMITS.members),
  plans: z.array(planSchema).max(SHARING_LIMITS.plans),
  intents: z.array(intentSchema).max(SHARING_LIMITS.intents),
  confirmation: z.union([z.null(), confirmationSchema]),
  itinerary: z.strictObject({
    sourcePlanId: z.union([z.null(), idText]),
    sourcePlanVersion: z.union([z.null(), z.number().int().min(1)]),
    dateRange: z.union([z.null(), range]),
    activities: z.array(activitySchema).max(SHARING_LIMITS.activities),
  }),
  expenses: z.array(expenseSchema).max(SHARING_LIMITS.expenses),
  settlements: z.array(settlementSchema).max(SHARING_LIMITS.settlements),
  invitations: z.array(invitationRecordSchema).max(SHARING_LIMITS.invitations),
  appliedResponses: z
    .array(
      z.strictObject({
        id: idText,
        invitationId: idText,
        appliedAt: isoTimestamp,
      }),
    )
    .max(SHARING_LIMITS.appliedResponses),
  appliedCommandIds: z.array(idText).max(SHARING_LIMITS.appliedCommandIds),
  isDemo: z.boolean(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const backupBodySchema = z.strictObject({
  trip: tripBackupSchema,
});

// ---------------------------------------------------------------------------
// envelope
// ---------------------------------------------------------------------------

function envelopeOf<B extends z.ZodTypeAny>(type: string, body: B) {
  return z.strictObject({
    schemaVersion: z.literal(SHARING_SCHEMA_VERSION),
    type: z.literal(type),
    payloadId: idText,
    createdAt: isoTimestamp,
    body,
  });
}

export const snapshotEnvelopeSchema = envelopeOf('snapshot', snapshotBodySchema);
export const invitationEnvelopeSchema = envelopeOf('invitation', invitationBodySchema);
export const responseEnvelopeSchema = envelopeOf('response', responseBodySchema);
export const backupEnvelopeSchema = envelopeOf('backup', backupBodySchema);

export const sharingEnvelopeSchema = z.discriminatedUnion('type', [
  snapshotEnvelopeSchema,
  invitationEnvelopeSchema,
  responseEnvelopeSchema,
  backupEnvelopeSchema,
]);

export type ParsedSharingEnvelope = z.infer<typeof sharingEnvelopeSchema>;

export const KNOWN_ENVELOPE_TYPES = ['snapshot', 'invitation', 'response', 'backup'] as const;

// 编译期一致性：schema 推断结构与 types.ts 声明必须互相兼容，防止两处漂移。
const _snapshotCheck1: z.infer<typeof snapshotBodySchema> = null as unknown as SnapshotBody;
const _snapshotCheck2: SnapshotBody = null as unknown as z.infer<typeof snapshotBodySchema>;
const _invitationCheck1: z.infer<typeof invitationBodySchema> = null as unknown as InvitationBody;
const _invitationCheck2: InvitationBody = null as unknown as z.infer<typeof invitationBodySchema>;
const _responseCheck1: z.infer<typeof responseBodySchema> = null as unknown as ResponseBody;
const _responseCheck2: ResponseBody = null as unknown as z.infer<typeof responseBodySchema>;
const _backupCheck1: z.infer<typeof backupBodySchema> = null as unknown as BackupBody;
const _backupCheck2: BackupBody = null as unknown as z.infer<typeof backupBodySchema>;
void [
  _snapshotCheck1,
  _snapshotCheck2,
  _invitationCheck1,
  _invitationCheck2,
  _responseCheck1,
  _responseCheck2,
  _backupCheck1,
  _backupCheck2,
];

// ---------------------------------------------------------------------------
// JSON 解码入口
// ---------------------------------------------------------------------------

/**
 * 从 JSON 文本解析并校验 envelope：损坏 JSON、未知 schemaVersion、未知类型、
 * 白名单外字段都返回结构化错误，不猜测字段意义（BR-13/BR-15）。
 */
export function decodeEnvelopeFromJson(text: string): SharingResult<ParsedSharingEnvelope> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: sharingError('JSON_INVALID', '内容不是有效的 JSON') };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: sharingError('SCHEMA_INVALID', '载荷必须是 JSON 对象') };
  }
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== SHARING_SCHEMA_VERSION) {
    if (typeof record.schemaVersion === 'number' && record.schemaVersion > SHARING_SCHEMA_VERSION) {
      return {
        ok: false,
        error: sharingError(
          'UNSUPPORTED_SCHEMA_VERSION',
          `暂不支持 schemaVersion ${record.schemaVersion}，请更新应用后重试`,
          { meta: { schemaVersion: record.schemaVersion } },
        ),
      };
    }
    return {
      ok: false,
      error: sharingError('SCHEMA_INVALID', '载荷缺少有效的 schemaVersion', {
        fields: [{ field: 'schemaVersion', message: '必须为 1' }],
      }),
    };
  }
  if (typeof record.type !== 'string' || !KNOWN_ENVELOPE_TYPES.includes(record.type as never)) {
    return { ok: false, error: sharingError('UNKNOWN_ENVELOPE_TYPE', '未知的载荷类型') };
  }
  const result = sharingEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: sharingError('SCHEMA_INVALID', '载荷结构不符合白名单', {
        fields: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      }),
    };
  }
  return { ok: true, value: result.data };
}

export function isKnownEnvelopeType(value: unknown): value is (typeof KNOWN_ENVELOPE_TYPES)[number] {
  return typeof value === 'string' && KNOWN_ENVELOPE_TYPES.includes(value as never);
}
