/**
 * 单成员邀请（BR-13 / D03 / P06）：
 * - 只携带目标成员填写所需上下文；不泄露其他成员资料、账本或完整交通映射。
 * - 手工专属交通值只在明确确认分享范围后附带，且城市必须与成员当前城市一致
 *   （成员改城市后旧值不适用，BR-04）。
 * - invitationId 在组织者本地登记（InvitationRecord），反馈必须对应登记的邀请。
 */
import type { InvitationRecord } from '../types';
import { SHARING_LIMITS, sharingError } from './types';
import type {
  InvitationBody,
  SharingEnvelope,
  SharingError,
  SharingPlanning,
  SharingResult,
  Trip,
} from './types';

export interface BuildInvitationOptions {
  memberId: string;
  /** 是否附带目标成员自己的手工交通估算（需用户在分享范围中显式确认）。 */
  includeManualTransport: boolean;
  payloadId: string;
  now: string;
  planning: SharingPlanning;
}

export const DEFAULT_INVITATION_INSTRUCTIONS =
  '请填写你的出发城市、预算上限和可用日期，再对候选方案表达意向。生成反馈后把链接或文件发回给组织者。';

export function buildInvitationEnvelope(
  trip: Trip,
  options: BuildInvitationOptions,
): SharingResult<SharingEnvelope<InvitationBody>> {
  const { planning, now, payloadId, memberId, includeManualTransport } = options;
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
    templateVersion: trip.plans[0].templateVersion,
    searchWindow: trip.searchWindow,
    duration: trip.duration,
    plans: trip.plans.map((plan) => {
      const manual = plan.estimate.transportByMember[member.id] ?? null;
      const applicable =
        includeManualTransport &&
        manual !== null &&
        member.originCity !== null &&
        manual.originCity === member.originCity;
      const template = planning.getTemplate(plan.destinationId, plan.templateVersion);
      const destinationName = template.ok ? template.value.name : `目的地 ${plan.destinationId}`;
      const destinationTags = template.ok ? template.value.tags : [];
      return {
        id: plan.id,
        version: plan.version,
        templateVersion: plan.templateVersion,
        destinationId: plan.destinationId,
        destinationName,
        destinationTags,
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

/**
 * 登记 InvitationRecord：payload 由应用层按当前方案构建（B0 命令契约），
 * 此处校验成员存在、ID 唯一与上限，返回新 Trip（revision 由仓库事务递增）。
 */
export function registerInvitationToTrip(
  trip: Trip,
  invitation: InvitationRecord,
): { ok: true; value: Trip } | { ok: false; error: SharingError } {
  if (!trip.members.some((item) => item.id === invitation.memberId)) {
    return { ok: false, error: sharingError('MEMBER_NOT_FOUND', '目标成员不存在') };
  }
  if (trip.invitations.some((record) => record.id === invitation.id)) {
    return {
      ok: false,
      error: sharingError('ID_CONFLICT', '该邀请标识已登记，请重新生成邀请'),
    };
  }
  if (trip.invitations.length >= SHARING_LIMITS.invitations) {
    return {
      ok: false,
      error: sharingError('LIMIT_EXCEEDED', `邀请登记已达上限（${SHARING_LIMITS.invitations} 条）`),
    };
  }
  return {
    ok: true,
    value: { ...trip, invitations: [...trip.invitations, { ...invitation, planVersions: { ...invitation.planVersions } }] },
  };
}
