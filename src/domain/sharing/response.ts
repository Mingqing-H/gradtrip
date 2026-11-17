/**
 * 成员反馈（BR-14 / P06 / P07 / D10）：
 * - response 携带一个成员的资料与候选意向；组织者端必须先预览差异再应用。
 * - 相同 payloadId 重复导入为无操作；同一邀请的新 payloadId 是重新提交，
 *   需要用户显式选择替换；过期（constraintRevision 不一致）反馈只读，不强制覆盖。
 * - 资料变化时通过 T02 端口原子完成：资料更新 → constraintRevision+1 →
 *   旧意向失效 → 新意向写入新约束版本；任何校验失败都不产生部分写入。
 */
import { SHARING_LIMITS, sharingError } from './types';
import type {
  Intent,
  InvitationBody,
  InvitationRecord,
  Member,
  MemberProfileInput,
  NormalizedMemberProfile,
  ResponseBody,
  ResponseIntentEntry,
  SharingApplyResult,
  SharingContext,
  SharingDeps,
  SharingEnvelope,
  SharingError,
  SharingResult,
  Trip,
} from './types';
import { responseBodySchema } from './schema';

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
  const planById = new Map(invitation.plans.map((plan) => [plan.id, plan]));
  for (const entry of intents) {
    if (!planById.has(entry.planId)) {
      return {
        ok: false,
        error: sharingError('PLAN_NOT_FOUND', '反馈包含邀请之外的方案', {
          fields: [{ field: 'intents', message: `方案 ${entry.planId} 不在邀请中` }],
        }),
      };
    }
  }
  const seen = new Set<string>();
  for (const entry of intents) {
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
    intents: intents.map((entry) => ({
      planId: entry.planId,
      planVersion: planById.get(entry.planId)!.version,
      value: entry.value,
    })),
  };
  return {
    ok: true,
    value: { schemaVersion: 1, type: 'response', payloadId: options.payloadId, createdAt: options.now, body },
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
  profileBefore: NormalizedMemberProfile | null;
  /** 反馈提交的资料；校验失败时保留原始输入供查看。 */
  profileAfter: MemberProfileInput | null;
  /** 资料是否发生变化（无法可靠归一化时为 null）。 */
  profileChanged: boolean | null;
  /** 该成员在各反馈方案上的当前意向（旧值）。 */
  intentsBefore: ResponseIntentBefore[];
  /** 反馈中的新意向。 */
  intentsAfter: ResponseIntentEntry[];
  /** 已应用记录（duplicate/resubmission 时给出）。 */
  priorResponse: { payloadId: string; invitationId: string; appliedAt: string } | null;
  error: SharingError | null;
}

function findRegisteredInvitation(trip: Trip, invitationId: string): InvitationRecord | null {
  return trip.invitations.find((record) => record.id === invitationId) ?? null;
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
    result.push({
      planId,
      planVersion: plan.version,
      value: existing?.value ?? null,
      missing: !existing,
    });
  }
  return result;
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

interface ResponseCheckOk {
  member: Member;
  invitation: InvitationRecord;
  profile: NormalizedMemberProfile;
  profileChanged: boolean;
}

/** 通用校验：任何失败都返回结构化错误，不产生部分写入。 */
function runResponseChecks(
  trip: Trip,
  body: ResponseBody,
  deps: SharingDeps,
): { ok: true; value: ResponseCheckOk } | { ok: false; error: SharingError } {
  if (body.tripId !== trip.id) {
    return {
      ok: false,
      error: sharingError('TRIP_MISMATCH', `反馈属于另一个旅行（${body.tripId}），当前旅行是 ${trip.id}`),
    };
  }
  const member = trip.members.find((item) => item.id === body.memberId);
  if (!member) {
    return { ok: false, error: sharingError('MEMBER_NOT_FOUND', '反馈对应的成员不存在于当前旅行') };
  }
  const invitation = findRegisteredInvitation(trip, body.invitationId);
  if (!invitation) {
    return { ok: false, error: sharingError('INVITATION_NOT_REGISTERED', '反馈对应的邀请未在本设备登记，无法应用') };
  }
  if (invitation.memberId !== body.memberId) {
    return { ok: false, error: sharingError('MEMBER_MISMATCH', '反馈成员与邀请登记的目标成员不一致') };
  }
  if (invitation.constraintRevision !== body.baseConstraintRevision) {
    return {
      ok: false,
      error: sharingError('CONSTRAINT_STALE', '邀请基准与登记版本不一致，需要重新生成邀请', {
        meta: { base: body.baseConstraintRevision, registered: invitation.constraintRevision },
      }),
    };
  }
  if (trip.constraintRevision !== body.baseConstraintRevision) {
    return {
      ok: false,
      error: sharingError('CONSTRAINT_STALE', '反馈基于旧版本邀请，已过期；只能查看或重新发邀请', {
        meta: { base: body.baseConstraintRevision, current: trip.constraintRevision },
      }),
    };
  }
  // 方案 id/version：必须同时匹配当前旅行方案与邀请登记的方案版本。
  for (const entry of body.intents) {
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
    if (entry.planVersion !== plan.version || entry.planVersion !== invitedVersion) {
      return {
        ok: false,
        error: sharingError('PLAN_VERSION_MISMATCH', `方案 ${entry.planId} 已更新，反馈已过期，请重新生成邀请`, {
          meta: { responseVersion: entry.planVersion, tripVersion: plan.version, invitedVersion },
        }),
      };
    }
  }
  const profileResult = deps.validateProfile(body.profile);
  if (!profileResult.ok) {
    return { ok: false, error: profileResult.error };
  }
  return {
    ok: true,
    value: {
      member,
      invitation,
      profile: profileResult.value,
      profileChanged: deps.profileChanged(member, profileResult.value),
    },
  };
}

export function previewResponseImport(
  trip: Trip,
  envelope: SharingEnvelope<ResponseBody>,
  deps: SharingDeps,
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
      priorResponse: {
        payloadId: duplicate.id,
        invitationId: duplicate.invitationId,
        appliedAt: duplicate.appliedAt,
      },
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

  const checks = runResponseChecks(trip, body, deps);
  if (!checks.ok) {
    return { ...base, error: checks.error };
  }
  return {
    ...base,
    state: 'applicable',
    profileAfter: checks.profile,
    profileChanged: checks.profileChanged,
  };
}

// ---------------------------------------------------------------------------
// 应用（预览通过后、事务内重新校验）
// ---------------------------------------------------------------------------

export interface ApplyResponseOptions extends SharingContext {
  deps: SharingDeps;
  /** 重新提交替换旧反馈需要显式确认。 */
  replacePrevious?: boolean;
  limits?: { intents: number; appliedResponses: number };
}

export function applyResponseToTrip(
  trip: Trip,
  envelope: SharingEnvelope<ResponseBody>,
  options: ApplyResponseOptions,
): SharingApplyResult {
  const { deps, now, replacePrevious } = options;
  const limits = options.limits ?? {
    intents: SHARING_LIMITS.intents,
    appliedResponses: SHARING_LIMITS.appliedResponses,
  };

  const bodyResult = responseBodySchema.safeParse(envelope.body);
  if (!bodyResult.success) {
    return {
      status: 'rejected',
      error: sharingError('SCHEMA_INVALID', '反馈结构不符合白名单', {
        fields: bodyResult.error.issues.map((issue) => ({
          field: `body.${issue.path.join('.')}`,
          message: issue.message,
        })),
      }),
    };
  }
  const body = bodyResult.data as ResponseBody;

  // 重复 payloadId：无操作，不增加任何版本（BR-14）。
  if (trip.appliedResponses.some((record) => record.id === envelope.payloadId)) {
    return { status: 'noop', reason: 'duplicate-payload' };
  }

  const checks = runResponseChecks(trip, body, deps);
  if (!checks.ok) {
    return { status: 'rejected', error: checks.error };
  }

  const resubmission = trip.appliedResponses.find(
    (record) => record.invitationId === body.invitationId && record.id !== envelope.payloadId,
  );
  if (resubmission && !replacePrevious) {
    return {
      status: 'rejected',
      error: sharingError('RESUBMISSION_REQUIRES_CHOICE', '同一邀请已有应用记录；请先在预览中确认替换旧反馈'),
    };
  }

  // 原子应用：资料变化经 T02 端口（constraintRevision+1 并失效旧意向），
  // 意向写入当前（或新）约束版本；预览与校验通过前不产生任何写入。
  const nextTrip = checks.profileChanged
    ? deps.applyProfileChange(trip, body.memberId, checks.profile)
    : trip;
  const intentRevision = checks.profileChanged ? nextTrip.constraintRevision : trip.constraintRevision;

  const upserted = upsertIntents(nextTrip.intents, body.memberId, intentRevision, body.intents, now);
  if (upserted.length > limits.intents) {
    return {
      status: 'rejected',
      error: sharingError('LIMIT_EXCEEDED', `意向历史已达上限（${limits.intents} 条），无法应用此反馈`),
    };
  }
  if (nextTrip.appliedResponses.length + 1 > limits.appliedResponses) {
    return {
      status: 'rejected',
      error: sharingError('LIMIT_EXCEEDED', `已应用反馈登记已达上限（${limits.appliedResponses} 条）`),
    };
  }

  return {
    status: 'updated',
    trip: {
      ...nextTrip,
      intents: upserted,
      appliedResponses: [
        ...nextTrip.appliedResponses,
        { id: envelope.payloadId, invitationId: body.invitationId, appliedAt: now },
      ],
    },
  };
}

/** 同组合只保留一条当前记录（BR-06）：替换 value/source/recordedAt 或追加。 */
function upsertIntents(
  intents: Intent[],
  memberId: string,
  constraintRevision: number,
  entries: ResponseIntentEntry[],
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
