/**
 * 成员反馈（BR-14 / P06 / P07 / D10）：
 * - response 携带一个成员的资料与候选意向；组织者端必须先预览差异再应用。
 * - 相同 payloadId 重复导入为无操作；同一邀请的新 payloadId 是重新提交，
 *   需要用户显式选择替换；过期（constraintRevision 不一致）反馈只读，不强制覆盖。
 * - 资料变化通过 T02 的 updateMemberConstraints 原子完成：资料更新 →
 *   constraintRevision+1 → 旧意向按版本失效 → 新意向写入新约束版本；
 *   任何校验失败都不产生部分写入。
 * - 命令输入使用 B0 的 ResponseInput（扁平结构）；wire 格式见 types.ResponseBody。
 */
import type { ResponseInput } from '../commands';
import type { Intent, InvitationRecord, Member } from '../types';
import { SHARING_LIMITS, responseBodyToInput, sharingError, toBusinessError } from './types';
import type {
  InvitationBody,
  MemberProfileInput,
  ResponseBody,
  ResponseIntentEntry,
  SharingContext,
  SharingEnvelope,
  SharingError,
  SharingPlanning,
  SharingResult,
  Trip,
} from './types';
import { memberProfileSchema } from './schema';
import { failure, success } from '../../contracts/result';
import type { Result } from '../../contracts/result';

export interface BuildResponseOptions {
  payloadId: string;
  now: string;
}

/** 成员填写页生成反馈：回填邀请标识与基准版本，意向版本取自邀请内方案版本。 */
export function buildResponseEnvelope(
  invitationEnvelope: SharingEnvelope<InvitationBody>,
  profile: MemberProfileInput,
  intents: Array<{ planId: string; value: ResponseIntentEntry['value'] }>,
  options: BuildResponseOptions,
): SharingResult<SharingEnvelope<ResponseBody>> {
  const invitation = invitationEnvelope.body;
  const seen = new Set<string>();
  for (const entry of intents) {
    const plan = invitation.plans.find((item) => item.id === entry.planId);
    if (!plan) {
      return {
        ok: false,
        error: sharingError('PLAN_NOT_FOUND', '反馈包含邀请之外的方案', {
          fields: [{ field: 'intents', message: `方案 ${entry.planId} 不在邀请中` }],
        }),
      };
    }
    if (seen.has(entry.planId)) {
      return {
        ok: false,
        error: sharingError('SCHEMA_INVALID', '同一方案只能提交一条意向', {
          fields: [{ field: 'intents', message: `方案 ${entry.planId} 重复` }],
        }),
      };
    }
    seen.add(entry.planId);
  }
  const body: ResponseBody = {
    invitationId: invitationEnvelope.payloadId,
    tripId: invitation.tripId,
    memberId: invitation.member.id,
    memberName: profile.name,
    baseConstraintRevision: invitation.constraintRevision,
    profile,
    intents: intents.map((entry) => {
      const plan = invitation.plans.find((item) => item.id === entry.planId);
      return { planId: entry.planId, planVersion: plan ? plan.version : 1, value: entry.value };
    }),
  };
  return {
    ok: true,
    value: { schemaVersion: 1, type: 'response', payloadId: options.payloadId, createdAt: options.now, body },
  };
}

// ---------------------------------------------------------------------------
// 校验链（预览与应用共用；updateMemberConstraints 是纯函数，预览也可安全调用）
// ---------------------------------------------------------------------------

interface ResponseFacts {
  member: Member;
  invitation: InvitationRecord;
  /** 资料更新后的旅行（constraintRevision 可能已 +1）。 */
  tripAfterProfile: Trip;
  /** 资料是否发生变化（相同值不增加版本，BR-02/BR-14）。 */
  profileChanged: boolean;
}

function evaluateResponse(
  trip: Trip,
  input: ResponseInput,
  planning: SharingPlanning,
): { ok: true; value: ResponseFacts } | { ok: false; error: SharingError } {
  if (input.tripId !== trip.id) {
    return {
      ok: false,
      error: sharingError('TRIP_MISMATCH', `反馈属于另一个旅行（${input.tripId}），当前旅行是 ${trip.id}`),
    };
  }
  const member = trip.members.find((item) => item.id === input.memberId);
  if (!member) {
    return { ok: false, error: sharingError('MEMBER_NOT_FOUND', '反馈对应的成员不存在于当前旅行') };
  }
  const invitation = trip.invitations.find((record) => record.id === input.invitationId);
  if (!invitation) {
    return { ok: false, error: sharingError('INVITATION_NOT_REGISTERED', '反馈对应的邀请未在本设备登记，无法应用') };
  }
  if (invitation.memberId !== input.memberId) {
    return { ok: false, error: sharingError('MEMBER_MISMATCH', '反馈成员与邀请登记的目标成员不一致') };
  }
  if (invitation.constraintRevision !== input.constraintRevision) {
    return {
      ok: false,
      error: sharingError('CONSTRAINT_STALE', '邀请基准与登记版本不一致，需要重新生成邀请', {
        meta: { base: input.constraintRevision, registered: invitation.constraintRevision },
      }),
    };
  }
  if (trip.constraintRevision !== input.constraintRevision) {
    return {
      ok: false,
      error: sharingError('CONSTRAINT_STALE', '反馈基于旧版本邀请，已过期；只能查看或重新发邀请', {
        meta: { base: input.constraintRevision, current: trip.constraintRevision },
      }),
    };
  }
  // 方案 id/version：必须同时匹配当前旅行方案、邀请登记与反馈自报版本。
  for (const entry of input.intents) {
    const plan = trip.plans.find((item) => item.id === entry.planId);
    if (!plan) {
      return {
        ok: false,
        error: sharingError('PLAN_NOT_FOUND', `方案 ${entry.planId} 不存在于当前旅行`, {
          fields: [{ field: 'intents', message: `方案 ${entry.planId} 不存在` }],
        }),
      };
    }
    const invitedVersion = invitation.planVersions[entry.planId];
    if (invitedVersion === undefined) {
      return {
        ok: false,
        error: sharingError('PLAN_NOT_FOUND', `方案 ${entry.planId} 不在邀请范围内`, {
          fields: [{ field: 'intents', message: `方案 ${entry.planId} 不在邀请中` }],
        }),
      };
    }
    const echoVersion = input.planVersions[entry.planId];
    if (
      entry.planVersion !== plan.version ||
      entry.planVersion !== invitedVersion ||
      (echoVersion !== undefined && echoVersion !== entry.planVersion)
    ) {
      return {
        ok: false,
        error: sharingError('PLAN_VERSION_MISMATCH', `方案 ${entry.planId} 已更新，反馈已过期，请重新生成邀请`, {
          meta: { responseVersion: entry.planVersion, tripVersion: plan.version, invitedVersion },
        }),
      };
    }
  }
  // 资料语义校验与变化检测统一交给 T02（相同值不增加 constraintRevision）。
  const updated = planning.updateMemberConstraints(trip, input.memberId, {
    name: input.member.name,
    originCity: input.member.originCity,
    budgetCap: input.member.budgetCap,
    availability: input.member.availability.map((range) => ({ ...range })),
    preferences: [...input.member.preferences],
  });
  if (!updated.ok) {
    return {
      ok: false,
      error: sharingError('PROFILE_INVALID', updated.error.message, {
        fields: Object.entries(updated.error.fields ?? {}).map(([field, message]) => ({ field: `member.${field}`, message })),
      }),
    };
  }
  const profileChanged = updated.value.constraintRevision !== trip.constraintRevision;
  return {
    ok: true,
    value: { member, invitation, tripAfterProfile: updated.value, profileChanged },
  };
}

// ---------------------------------------------------------------------------
// 预览（不写任何数据）
// ---------------------------------------------------------------------------

export type ResponsePreviewState = 'applicable' | 'duplicate' | 'stale' | 'resubmission' | 'invalid';

/** 预览中的“旧值”意向：missing=true 表示该成员此前未反馈。 */
export interface ResponseIntentBefore {
  planId: string;
  planVersion: number;
  value: ResponseIntentEntry['value'] | null;
  missing: boolean;
}

export interface ResponsePreview {
  state: ResponsePreviewState;
  tripId: string;
  memberId: string;
  memberName: string;
  baseConstraintRevision: number;
  currentConstraintRevision: number;
  /** 组织者端当前资料（成员不存在时为 null）。 */
  profileBefore: MemberProfileInput | null;
  /** 反馈提交的资料（校验失败时保留原始输入供查看）。 */
  profileAfter: MemberProfileInput | null;
  /** 资料是否发生变化；无法可靠判断时为 null。 */
  profileChanged: boolean | null;
  /** 该成员在各反馈方案上的当前意向（旧值）。 */
  intentsBefore: ResponseIntentBefore[];
  /** 反馈中的新意向。 */
  intentsAfter: ResponseIntentEntry[];
  /** 已应用记录（duplicate/resubmission 时给出）。 */
  priorResponse: { payloadId: string; invitationId: string; appliedAt: string } | null;
  error: SharingError | null;
}

function memberAsProfile(member: Member): MemberProfileInput {
  return {
    name: member.name,
    originCity: member.originCity,
    budgetCap: member.budgetCap,
    availability: member.availability.map((range) => ({ ...range })),
    preferences: [...member.preferences],
  };
}

function currentIntentsBefore(trip: Trip, memberId: string, planIds: string[]): ResponseIntentBefore[] {
  const result: ResponseIntentBefore[] = [];
  for (const planId of planIds) {
    const plan = trip.plans.find((item) => item.id === planId);
    if (!plan) continue;
    const existing = trip.intents.find(
      (intent) =>
        intent.memberId === memberId &&
        intent.planId === planId &&
        intent.planVersion === plan.version &&
        intent.constraintRevision === trip.constraintRevision,
    );
    result.push({ planId, planVersion: plan.version, value: existing?.value ?? null, missing: !existing });
  }
  return result;
}

export function previewResponseImport(
  trip: Trip,
  envelope: SharingEnvelope<ResponseBody>,
  planning: SharingPlanning,
): ResponsePreview {
  const body = envelope.body;
  const member = trip.members.find((item) => item.id === body.memberId);
  const base: ResponsePreview = {
    state: 'invalid',
    tripId: body.tripId,
    memberId: body.memberId,
    memberName: body.memberName,
    baseConstraintRevision: body.baseConstraintRevision,
    currentConstraintRevision: trip.constraintRevision,
    profileBefore: member ? memberAsProfile(member) : null,
    profileAfter: body.profile,
    profileChanged: null,
    intentsBefore: member ? currentIntentsBefore(trip, member.id, body.intents.map((e) => e.planId)) : [],
    intentsAfter: body.intents,
    priorResponse: null,
    error: null,
  };

  // 状态优先级：重复 > 过期 > 重新提交 > 其他校验失败（BR-14）。
  const duplicate = trip.appliedResponses.find((record) => record.id === envelope.payloadId);
  if (duplicate) {
    return {
      ...base,
      state: 'duplicate',
      priorResponse: { payloadId: duplicate.id, invitationId: duplicate.invitationId, appliedAt: duplicate.appliedAt },
      error: sharingError('DUPLICATE_PAYLOAD', '该反馈已应用过，不会再次写入'),
    };
  }
  const staleError =
    body.tripId !== trip.id
      ? sharingError('TRIP_MISMATCH', `反馈属于另一个旅行（${body.tripId}），当前旅行是 ${trip.id}`)
      : trip.constraintRevision !== body.baseConstraintRevision
        ? sharingError('CONSTRAINT_STALE', '反馈基于旧版本邀请，已过期；只能查看或重新发邀请', {
            meta: { base: body.baseConstraintRevision, current: trip.constraintRevision },
          })
        : null;
  if (staleError) {
    return { ...base, state: 'stale', error: staleError };
  }
  const resubmission = trip.appliedResponses.find(
    (record) => record.invitationId === body.invitationId && record.id !== envelope.payloadId,
  );
  if (resubmission) {
    return {
      ...base,
      state: 'resubmission',
      priorResponse: {
        payloadId: resubmission.id,
        invitationId: resubmission.invitationId,
        appliedAt: resubmission.appliedAt,
      },
      error: sharingError('RESUBMISSION_REQUIRES_CHOICE', '同一邀请已有应用记录；需确认用新反馈替换后才能应用'),
    };
  }

  const checks = evaluateResponse(trip, responseBodyToInput(envelope), planning);
  if (!checks.ok) {
    return { ...base, error: checks.error };
  }
  return {
    ...base,
    state: 'applicable',
    profileAfter: body.profile,
    profileChanged: checks.value.profileChanged,
  };
}

// ---------------------------------------------------------------------------
// 应用（B0 命令边界：输入 ResponseInput，输出 Result<Trip>）
// ---------------------------------------------------------------------------

export interface ApplyResponseOptions extends SharingContext {
  planning: SharingPlanning;
}

/**
 * 应用反馈。注意：同一邀请的“重新提交需显式选择替换”（BR-14）无法通过 B0 命令
 * payload 表达，由应用层在预览中取得用户确认后再调用本函数；域层仍执行全部
 * 版本与合法性校验，任何失败都不产生部分写入。
 */
export function applyResponseToTrip(
  trip: Trip,
  input: ResponseInput,
  options: ApplyResponseOptions,
): Result<Trip> {
  const { planning, now } = options;

  const bodyResult = memberProfileLike(input.member);
  if (bodyResult) {
    return failure('VALIDATION', '反馈中的成员资料结构无效', bodyResult);
  }
  // 重复 payloadId：事务内返回原值，不增加任何版本或历史（BR-14）。
  if (trip.appliedResponses.some((record) => record.id === input.id)) {
    return { ok: true, value: trip };
  }

  const checks = evaluateResponse(trip, input, planning);
  if (!checks.ok) {
    return { ok: false, error: toBusinessError(checks.error) };
  }

  // 原子应用：evaluateResponse 已通过 T02 纯函数得到资料更新后的旅行；
  // 意向写入当前（或新）约束版本，任何失败都不产生部分写入。
  const base = checks.value.tripAfterProfile;
  const intentRevision = base.constraintRevision;
  const upserted = upsertIntents(base.intents, input.memberId, intentRevision, input.intents, now);
  if (upserted.length > SHARING_LIMITS.intents) {
    return failure('CAPACITY', `意向历史已达上限（${SHARING_LIMITS.intents} 条），无法应用此反馈`);
  }
  if (base.appliedResponses.length + 1 > SHARING_LIMITS.appliedResponses) {
    return failure('CAPACITY', `已应用反馈登记已达上限（${SHARING_LIMITS.appliedResponses} 条）`);
  }

  return success({
    ...base,
    intents: upserted,
    appliedResponses: [
      ...base.appliedResponses,
      { id: input.id, invitationId: input.invitationId, appliedAt: now },
    ],
  });
}

/** 入口处对 ResponseInput.member 做一次白名单结构校验（防御未走 envelope 解码的调用方）。 */
function memberProfileLike(member: ResponseInput['member']): Record<string, string> | undefined {
  const parsed = memberProfileSchema.safeParse(member);
  if (parsed.success) return undefined;
  return Object.fromEntries(
    parsed.error.issues.map((issue) => [`member.${issue.path.join('.')}`, issue.message]),
  );
}

/** 同组合只保留一条当前记录（BR-06）：替换 value/source/recordedAt 或追加。 */
function upsertIntents(
  intents: Intent[],
  memberId: string,
  constraintRevision: number,
  entries: Array<{ planId: string; planVersion: number; value: Intent['value'] }>,
  now: string,
): Intent[] {
  const result = intents.map((intent) => ({ ...intent }));
  for (const entry of entries) {
    const record: Intent = {
      memberId,
      planId: entry.planId,
      planVersion: entry.planVersion,
      constraintRevision,
      value: entry.value,
      source: 'feedback',
      recordedAt: now,
    };
    const index = result.findIndex(
      (intent) =>
        intent.memberId === memberId &&
        intent.planId === entry.planId &&
        intent.planVersion === entry.planVersion &&
        intent.constraintRevision === constraintRevision,
    );
    if (index >= 0) {
      result[index] = record;
    } else {
      result.push(record);
    }
  }
  return result;
}
