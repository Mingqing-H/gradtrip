/**
 * 单成员邀请（BR-13 / D03 / P06）：
 * - 只携带目标成员填写所需上下文；不泄露其他成员资料、账本或完整交通映射。
 * - 手工专属交通值只在明确确认分享范围后附带，且城市必须与成员当前城市一致
 *   （成员改城市后旧值不适用，BR-04）。
 * - invitationId 在组织者本地登记（InvitationRecord），反馈必须对应登记的邀请。
 */
import { SHARING_LIMITS, sharingError } from './types';
import type {
  InvitationBody,
  SharingApplyResult,
  SharingContext,
  SharingDeps,
  SharingEnvelope,
  SharingResult,
  Trip,
} from './types';

export interface BuildInvitationOptions {
  memberId: string;
  /** 是否附带目标成员自己的手工交通估算（需用户在分享范围中显式确认）。 */
  includeManualTransport: boolean;
  payloadId: string;
  now: string;
  deps: SharingDeps;
}

export const DEFAULT_INVITATION_INSTRUCTIONS =
  '请填写你的出发城市、预算上限和可用日期，再对候选方案表达意向。生成反馈后把链接或文件发回给组织者。';

export function buildInvitationEnvelope(
  trip: Trip,
  options: BuildInvitationOptions,
): SharingResult<SharingEnvelope<InvitationBody>> {
  const { deps, now, payloadId, memberId, includeManualTransport } = options;
  const member = trip.members.find((item) => item.id === memberId);
  if (!member) {
    return { ok: false, error: sharingError('MEMBER_NOT_FOUND', '目标成员不存在，无法生成邀请') };
  }
  if (trip.plans.length === 0) {
    return { ok: false, error: sharingError('PLAN_NOT_FOUND', '还没有候选方案，无法生成邀请') };
  }

  const templateVersions = new Set(trip.plans.map((plan) => plan.templateVersion));
  if (templateVersions.size !== 1) {
    return {
      ok: false,
      error: sharingError('PLAN_VERSION_MISMATCH', '候选方案模板版本不一致，请重新生成方案后再邀请'),
    };
  }

  const body: InvitationBody = {
    tripId: trip.id,
    tripName: trip.name,
    member: { id: member.id, name: member.name },
    constraintRevision: trip.constraintRevision,
    templateVersion: trip.plans[0]!.templateVersion,
    searchWindow: trip.searchWindow,
    duration: trip.duration,
    plans: trip.plans.map((plan) => {
      const manual = plan.estimate.transportByMember[member.id] ?? null;
      const applicable =
        includeManualTransport &&
        manual !== null &&
        member.originCity !== null &&
        manual.originCity === member.originCity;
      const destination = deps.destinationInfo(plan.destinationId);
      return {
        id: plan.id,
        version: plan.version,
        templateVersion: plan.templateVersion,
        destinationId: plan.destinationId,
        destinationName: destination?.name ?? `目的地 ${plan.destinationId}`,
        destinationTags: destination?.tags ?? [],
        startDate: plan.startDate,
        days: plan.days,
        estimate: {
          lodgingPerNight: plan.estimate.lodgingPerNight,
          foodPerDay: plan.estimate.foodPerDay,
          activities: plan.estimate.activities,
          reserve: plan.estimate.reserve,
          manualTransport: applicable
            ? { originCity: manual.originCity, amountCents: manual.amount }
            : null,
        },
      };
    }),
    instructions: DEFAULT_INVITATION_INSTRUCTIONS,
  };

  return { ok: true, value: { schemaVersion: 1, type: 'invitation', payloadId, createdAt: now, body } };
}

// ---------------------------------------------------------------------------
// 邀请登记命令（BR-13：invitationId 在组织者本地登记后才生成）
// ---------------------------------------------------------------------------

export interface RegisterInvitationCommand {
  kind: 'sharing.registerInvitation';
  invitationId: string;
  memberId: string;
}

export function registerInvitationToTrip(
  trip: Trip,
  command: RegisterInvitationCommand,
  context: SharingContext,
  limits: { invitations: number } = { invitations: SHARING_LIMITS.invitations },
): SharingApplyResult {
  const member = trip.members.find((item) => item.id === command.memberId);
  if (!member) {
    return { status: 'rejected', error: sharingError('MEMBER_NOT_FOUND', '目标成员不存在') };
  }
  if (trip.invitations.some((record) => record.id === command.invitationId)) {
    return {
      status: 'rejected',
      error: sharingError('ID_CONFLICT', '该邀请标识已登记，请重新生成邀请'),
    };
  }
  if (trip.invitations.length >= limits.invitations) {
    return {
      status: 'rejected',
      error: sharingError('LIMIT_EXCEEDED', `邀请登记已达上限（${limits.invitations} 条），请先清理或导出`),
    };
  }
  const planVersions: Record<string, number> = {};
  for (const plan of trip.plans) {
    planVersions[plan.id] = plan.version;
  }
  const nextTrip: Trip = {
    ...trip,
    invitations: [
      ...trip.invitations,
      {
        id: command.invitationId,
        memberId: command.memberId,
        constraintRevision: trip.constraintRevision,
        planVersions,
        createdAt: context.now,
      },
    ],
  };
  return { status: 'updated', trip: nextTrip };
}
