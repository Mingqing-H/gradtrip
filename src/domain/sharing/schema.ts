/**
 * 四类传递载荷的运行时白名单 schema（BR-13）。
 *
 * envelope 结构为 T04 自维护的白名单；基础标量（ID/金额/日期/成员/活动）
 * 直接复用 B0 的 src/domain/schema.ts，保证导入边界与存储校验一致。
 * 所有对象使用 strictObject：未知字段一律拒绝，不执行载荷文本（BR-13）；
 * 跨字段语义校验（引用/不变量/版本）在领域函数中进行。
 */
import { z } from 'zod';
import {
  centsSchema,
  dateSchema,
  idSchema,
  memberSchema,
  rangeSchema,
} from '../schema';
import { SHARING_SCHEMA_VERSION, sharingError } from './types';
import type { BackupBody, InvitationBody, ResponseBody, SharingResult, SnapshotBody } from './types';

// ---------------------------------------------------------------------------
// 基础标量（与 B0 schema 对齐）
// ---------------------------------------------------------------------------

const isoTimestamp = z.iso.datetime();
const daysValue = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const revisionValue = z.number().int().min(0);
const positiveVersion = z.number().int().min(1);
const centsPositive = centsSchema.min(1);
const nameText = z.string().trim().min(1).max(40);
const cityText = z.string().trim().min(1).max(80);

// ---------------------------------------------------------------------------
// snapshot 白名单：只含公开计划内容；成员资料、备注、账目、反馈历史全部排除。
// ---------------------------------------------------------------------------

const publicActivity = z.strictObject({
  id: idSchema,
  date: dateSchema,
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
  title: z.string().trim().min(1).max(120),
  category: z.string().min(1).max(40),
  budgetBucket: z.enum(['activities', 'included']),
  perPersonEstimate: centsSchema.nullable(),
  order: revisionValue,
}).refine(
  (activity) =>
    (activity.startTime === null && activity.endTime === null) ||
    (activity.startTime !== null && activity.endTime !== null && activity.startTime < activity.endTime),
  '请填写有效的起止时间',
);

const estimateParams = z.strictObject({
  lodgingPerNight: centsSchema,
  foodPerDay: centsSchema,
  activities: centsSchema,
  reserve: centsSchema,
});

const destinationInfo = {
  destinationId: idSchema,
  destinationName: z.string().trim().min(1).max(80),
  destinationTags: z.array(z.string().trim().min(1).max(40)).max(20),
};

export const snapshotBodySchema = z.strictObject({
  tripName: z.string().trim().min(1).max(80),
  plan: z.strictObject({
    id: idSchema,
    version: positiveVersion,
    templateVersion: positiveVersion,
    ...destinationInfo,
    startDate: dateSchema,
    days: daysValue,
    estimateParams,
  }),
  confirmation: z.strictObject({
    status: z.enum(['confirmed', 'draft']),
    planId: idSchema,
    planVersion: positiveVersion,
    constraintRevision: revisionValue,
    confirmedAt: isoTimestamp.nullable(),
  }),
  estimateSummary: z.strictObject({
    basePerPersonCents: centsSchema,
    itineraryActivitiesCents: centsSchema,
    itineraryUnknownCount: z.number().int().min(0),
    deltaCents: z.number().int(),
  }),
  itinerary: z
    .strictObject({
      startDate: dateSchema,
      endDate: dateSchema,
      activities: z.array(publicActivity),
    })
    .nullable(),
});

// ---------------------------------------------------------------------------
// invitation 白名单：目标成员填写上下文；不含其他成员资料、账本、私密备注，
// 不预填目标成员预算与可用日期，交通只允许目标成员自己的手工值。
// ---------------------------------------------------------------------------

export const invitationBodySchema = z.strictObject({
  tripId: idSchema,
  tripName: z.string().trim().min(1).max(80),
  member: z.strictObject({ id: idSchema, name: nameText }),
  constraintRevision: revisionValue,
  templateVersion: positiveVersion,
  searchWindow: rangeSchema,
  duration: daysValue,
  plans: z
    .array(
      z.strictObject({
        id: idSchema,
        version: positiveVersion,
        templateVersion: positiveVersion,
        ...destinationInfo,
        startDate: dateSchema,
        days: daysValue,
        estimate: estimateParams.extend({
          manualTransport: z
            .strictObject({ originCity: cityText, amountCents: centsPositive })
            .nullable(),
        }),
      }),
    )
    .min(1, '邀请必须包含至少一个候选方案'),
  instructions: z.string().max(500),
});

// ---------------------------------------------------------------------------
// response 白名单：成员资料与意向；不含账本、其他成员资料或任意修改指令。
// ---------------------------------------------------------------------------

export const memberProfileSchema = memberSchema.omit({ id: true });

export const responseBodySchema = z.strictObject({
  invitationId: idSchema,
  tripId: idSchema,
  memberId: idSchema,
  memberName: nameText,
  baseConstraintRevision: revisionValue,
  profile: memberProfileSchema,
  intents: z
    .array(
      z.strictObject({
        planId: idSchema,
        planVersion: positiveVersion,
        value: z.enum(['approve', 'acceptable', 'decline']),
      }),
    )
    .refine((items) => new Set(items.map((item) => item.planId)).size === items.length, {
      message: '同一方案只能有一条意向',
    }),
});

// ---------------------------------------------------------------------------
// backup：envelope 层只确认形状，Trip 结构与不变量交给 B0 parseTrip 严查，
// 避免 T04 维护第二份旅行 schema（错误信息也统一来自 parseTrip）。
// ---------------------------------------------------------------------------

export const backupBodySchema = z.strictObject({ trip: z.unknown() });

// ---------------------------------------------------------------------------
// envelope
// ---------------------------------------------------------------------------

function envelopeOf<T extends string, B extends z.ZodType>(type: T, body: B) {
  return z.strictObject({
    schemaVersion: z.literal(SHARING_SCHEMA_VERSION),
    type: z.literal(type),
    payloadId: idSchema,
    createdAt: isoTimestamp,
    body,
  });
}

export const snapshotEnvelopeSchema = envelopeOf('snapshot' as const, snapshotBodySchema);
export const invitationEnvelopeSchema = envelopeOf('invitation' as const, invitationBodySchema);
export const responseEnvelopeSchema = envelopeOf('response' as const, responseBodySchema);
export const backupEnvelopeSchema = envelopeOf('backup' as const, backupBodySchema);

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
void [_snapshotCheck1, _snapshotCheck2, _invitationCheck1, _invitationCheck2, _responseCheck1, _responseCheck2, _backupCheck1, _backupCheck2];

/**
 * 从 JSON 文本解析并校验 envelope：损坏 JSON、未知 schemaVersion、未知类型、
 * 白名单外字段都返回结构化错误，不猜测字段意义（BR-13/BR-15）。
 * backup 的 trip 字段此处保持 unknown，由 validateImportedTrip/parseTrip 严查。
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
          `暂不支持 schemaVersion ${String(record.schemaVersion)}，请更新应用后重试`,
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
