/**
 * 完整备份（BR-15 / D11）：
 * - backup 是单旅行完整备份（含成员资料与账本），不含图片二进制、缓存或密钥。
 * - 导入先做结构与语义两层校验（ID 唯一、引用存在、金额不变量、上限），
 *   再预览摘要；同 ID 默认另存副本（重映射 ID、清除意向/确认/邀请登记），
 *   覆盖必须显式确认且由仓库原子保留旧版恢复副本。
 */
import { SHARING_LIMITS, sharingError } from './types';
import type {
  BackupImportPlan,
  BackupSummary,
  SharingContext,
  SharingEnvelope,
  SharingResult,
  Trip,
} from './types';
import { backupBodySchema } from './schema';

// ---------------------------------------------------------------------------
// 导出备份
// ---------------------------------------------------------------------------

export interface BuildBackupOptions {
  payloadId: string;
  now: string;
}

export function buildBackupEnvelope(trip: Trip, options: BuildBackupOptions): SharingEnvelope<{ trip: Trip }> {
  // JSON 克隆：备份是纯数据快照，剥离任何运行时引用。
  const snapshot = JSON.parse(JSON.stringify(trip)) as Trip;
  return {
    schemaVersion: 1,
    type: 'backup',
    payloadId: options.payloadId,
    createdAt: options.now,
    body: { trip: snapshot },
  };
}

// ---------------------------------------------------------------------------
// 校验（validateSharingTrip：领域入口之一）
// ---------------------------------------------------------------------------

export interface SharingValidateLimits {
  members: number;
  plans: number;
  activities: number;
  expenses: number;
  settlements: number;
  intents: number;
  invitations: number;
  appliedResponses: number;
  appliedCommandIds: number;
}

export const DEFAULT_VALIDATE_LIMITS: SharingValidateLimits = {
  members: SHARING_LIMITS.members,
  plans: SHARING_LIMITS.plans,
  activities: SHARING_LIMITS.activities,
  expenses: SHARING_LIMITS.expenses,
  settlements: SHARING_LIMITS.settlements,
  intents: SHARING_LIMITS.intents,
  invitations: SHARING_LIMITS.invitations,
  appliedResponses: SHARING_LIMITS.appliedResponses,
  appliedCommandIds: SHARING_LIMITS.appliedCommandIds,
};

/**
 * 对外部 Trip 做结构与语义两层校验；任何一条失败即整体拒绝（不部分导入）。
 * 返回通过校验的 Trip 副本。
 */
export function validateSharingTrip(
  input: unknown,
  limits: SharingValidateLimits = DEFAULT_VALIDATE_LIMITS,
): SharingResult<Trip> {
  const parsed = backupBodySchema.safeParse({ trip: input });
  if (!parsed.success) {
    return {
      ok: false,
      error: sharingError('BACKUP_INVALID', '备份结构不符合白名单', {
        fields: parsed.error.issues.map((issue) => ({
          field: `trip.${issue.path.join('.')}`,
          message: issue.message,
        })),
      }),
    };
  }
  const trip = parsed.data.trip as Trip;
  const issues: string[] = [];
  const memberIds = new Set<string>();
  const planIds = new Set<string>();

  const requireUnique = (collection: Array<{ id: string }>, label: string, seen: Set<string>) => {
    for (const item of collection) {
      if (seen.has(item.id)) {
        issues.push(`${label} ID 重复：${item.id}`);
      }
      seen.add(item.id);
    }
  };
  requireUnique(trip.members, '成员', memberIds);
  requireUnique(trip.plans, '方案', planIds);
  const activityIds = new Set<string>();
  requireUnique(trip.itinerary.activities, '日程条目', activityIds);
  const expenseIds = new Set<string>();
  requireUnique(trip.expenses, '费用', expenseIds);
  const settlementIds = new Set<string>();
  requireUnique(trip.settlements, '结算记录', settlementIds);
  const invitationIds = new Set<string>();
  requireUnique(trip.invitations, '邀请登记', invitationIds);

  // 引用完整性
  for (const plan of trip.plans) {
    for (const [memberId, override] of Object.entries(plan.estimate.transportByMember)) {
      if (!memberIds.has(memberId)) {
        issues.push(`方案 ${plan.id} 的手工交通引用了不存在的成员 ${memberId}`);
      }
      // 城市不匹配的手工值按规则失效（BR-04），不视为损坏数据。
      void override;
    }
  }
  if (trip.itinerary.sourcePlanId !== null && !planIds.has(trip.itinerary.sourcePlanId)) {
    issues.push(`日程来源方案 ${trip.itinerary.sourcePlanId} 不存在`);
  }
  for (const intent of trip.intents) {
    if (!memberIds.has(intent.memberId)) issues.push(`意向引用了不存在的成员 ${intent.memberId}`);
    if (!planIds.has(intent.planId)) issues.push(`意向引用了不存在的方案 ${intent.planId}`);
  }
  if (trip.confirmation !== null && !planIds.has(trip.confirmation.planId)) {
    issues.push(`确认记录引用了不存在的方案 ${trip.confirmation.planId}`);
  }
  for (const expense of trip.expenses) {
    if (!memberIds.has(expense.payerId)) {
      issues.push(`费用「${expense.title}」的垫付人不存在`);
    }
    const participants = new Set<string>();
    let allocationSum = 0;
    for (const allocation of expense.allocations) {
      if (!memberIds.has(allocation.memberId)) {
        issues.push(`费用「${expense.title}」引用了不存在的成员 ${allocation.memberId}`);
      }
      if (participants.has(allocation.memberId)) {
        issues.push(`费用「${expense.title}」的参与人重复：${allocation.memberId}`);
      }
      participants.add(allocation.memberId);
      allocationSum += allocation.amount;
    }
    if (allocationSum !== expense.amount) {
      issues.push(`费用「${expense.title}」的分摊合计与金额不一致`);
    }
  }
  for (const settlement of trip.settlements) {
    if (!memberIds.has(settlement.fromId) || !memberIds.has(settlement.toId)) {
      issues.push(`结算记录 ${settlement.id} 引用了不存在的成员`);
    } else if (settlement.fromId === settlement.toId) {
      issues.push(`结算记录 ${settlement.id} 的转出与转入为同一人`);
    }
  }
  for (const invitation of trip.invitations) {
    if (!memberIds.has(invitation.memberId)) {
      issues.push(`邀请登记 ${invitation.id} 引用了不存在的成员`);
    }
  }
  for (const applied of trip.appliedResponses) {
    if (!invitationIds.has(applied.invitationId)) {
      issues.push(`已应用反馈 ${applied.id} 对应的邀请未登记`);
    }
  }

  // 集合上限
  const limitChecks: Array<[string, number, number]> = [
    ['成员', trip.members.length, limits.members],
    ['方案', trip.plans.length, limits.plans],
    ['日程条目', trip.itinerary.activities.length, limits.activities],
    ['费用', trip.expenses.length, limits.expenses],
    ['结算记录', trip.settlements.length, limits.settlements],
    ['意向历史', trip.intents.length, limits.intents],
    ['邀请登记', trip.invitations.length, limits.invitations],
    ['已应用反馈', trip.appliedResponses.length, limits.appliedResponses],
    ['命令去重记录', trip.appliedCommandIds.length, limits.appliedCommandIds],
  ];
  for (const [label, count, max] of limitChecks) {
    if (count > max) issues.push(`${label}数量 ${count} 超过上限 ${max}`);
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: sharingError('BACKUP_INVALID', '备份包含无法导入的数据', {
        fields: issues.slice(0, 20).map((message) => ({ field: '(trip)', message })),
      }),
    };
  }
  return { ok: true, value: trip };
}

/** 校验 backup envelope 并返回其中的 Trip。 */
export function validateBackupForImport(
  envelope: SharingEnvelope<{ trip: unknown }>,
  limits?: SharingValidateLimits,
): SharingResult<Trip> {
  if (envelope.type !== 'backup') {
    return { ok: false, error: sharingError('SCHEMA_INVALID', '载荷不是完整备份') };
  }
  return validateSharingTrip(envelope.body?.trip ?? null, limits);
}

// ---------------------------------------------------------------------------
// 预览摘要
// ---------------------------------------------------------------------------

export function summarizeBackup(
  envelope: SharingEnvelope<{ trip: Trip }>,
  localTrip: Trip | null,
): BackupSummary {
  const trip = envelope.body.trip;
  return {
    name: trip.name,
    memberCount: trip.members.length,
    searchWindow: trip.searchWindow ? { ...trip.searchWindow } : null,
    itineraryRange: trip.itinerary.dateRange ? { ...trip.itinerary.dateRange } : null,
    expenseCount: trip.expenses.length,
    settlementCount: trip.settlements.length,
    revision: trip.revision,
    exportedAt: envelope.createdAt,
    localSameId: localTrip !== null && localTrip.id === trip.id,
    localRevision: localTrip ? localTrip.revision : null,
    olderThanLocal: localTrip !== null && localTrip.id === trip.id && trip.revision < localTrip.revision,
  };
}

// ---------------------------------------------------------------------------
// ID 重映射（另存副本 / 快照另存共用策略）
// ---------------------------------------------------------------------------

export type RemapKind = 'member' | 'plan' | 'activity' | 'expense' | 'settlement';

export interface RemapOptions extends SharingContext {
  newTripId: string;
  nextId: (kind: RemapKind, oldId: string) => string;
}

/**
 * 另存副本：重新映射所有实体 ID，保留财务数据与内部引用，
 * 清除意向、确认、邀请与反馈登记（BR-15：不冒充原共识）。
 */
export function remapTripIds(trip: Trip, options: RemapOptions): Trip {
  const { newTripId, nextId, now } = options;
  const memberMap = new Map<string, string>();
  for (const member of trip.members) memberMap.set(member.id, nextId('member', member.id));
  const planMap = new Map<string, string>();
  for (const plan of trip.plans) planMap.set(plan.id, nextId('plan', plan.id));
  const activityMap = new Map<string, string>();
  for (const activity of trip.itinerary.activities) {
    activityMap.set(activity.id, nextId('activity', activity.id));
  }
  const expenseMap = new Map<string, string>();
  for (const expense of trip.expenses) expenseMap.set(expense.id, nextId('expense', expense.id));
  const settlementMap = new Map<string, string>();
  for (const settlement of trip.settlements) {
    settlementMap.set(settlement.id, nextId('settlement', settlement.id));
  }

  const member = (oldId: string) => memberMap.get(oldId) ?? oldId;

  return {
    ...trip,
    id: newTripId,
    name: trip.name,
    revision: 0,
    members: trip.members.map((item) => ({
      ...item,
      id: memberMap.get(item.id)!,
      availability: item.availability.map((range) => ({ ...range })),
      preferences: [...item.preferences],
    })),
    plans: trip.plans.map((plan) => {
      const transportByMember: Trip['plans'][number]['estimate']['transportByMember'] = {};
      for (const [oldMemberId, override] of Object.entries(plan.estimate.transportByMember)) {
        transportByMember[member(oldMemberId)] = override === null ? null : { ...override };
      }
      return {
        ...plan,
        id: planMap.get(plan.id)!,
        estimate: { ...plan.estimate, transportByMember },
      };
    }),
    intents: [],
    confirmation: null,
    itinerary: {
      sourcePlanId: trip.itinerary.sourcePlanId === null ? null : planMap.get(trip.itinerary.sourcePlanId) ?? null,
      sourcePlanVersion: trip.itinerary.sourcePlanVersion,
      dateRange: trip.itinerary.dateRange ? { ...trip.itinerary.dateRange } : null,
      activities: trip.itinerary.activities.map((activity) => ({
        ...activity,
        id: activityMap.get(activity.id)!,
      })),
    },
    expenses: trip.expenses.map((expense) => ({
      ...expense,
      id: expenseMap.get(expense.id)!,
      payerId: member(expense.payerId),
      allocations: expense.allocations.map((allocation) => ({
        memberId: member(allocation.memberId),
        amount: allocation.amount,
      })),
    })),
    settlements: trip.settlements.map((settlement) => ({
      ...settlement,
      id: settlementMap.get(settlement.id)!,
      fromId: member(settlement.fromId),
      toId: member(settlement.toId),
    })),
    invitations: [],
    appliedResponses: [],
    appliedCommandIds: [],
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// 导入规划（实际持久化由 T01 仓库事务执行；覆盖时恢复副本也由仓库原子保留）
// ---------------------------------------------------------------------------

export interface BackupImportOptions extends RemapOptions {
  /** copy=另存副本（默认），overwrite=覆盖同 ID 本地旅行。 */
  mode: 'copy' | 'overwrite';
}

export function planBackupImport(
  existingTrip: Trip | null,
  envelope: SharingEnvelope<{ trip: Trip }>,
  options: BackupImportOptions,
): SharingResult<BackupImportPlan> {
  if (envelope.type !== 'backup') {
    return { ok: false, error: sharingError('SCHEMA_INVALID', '载荷不是完整备份') };
  }
  const backupTrip = envelope.body.trip;
  if (existingTrip === null) {
    // 本地不存在同 ID：导入为新本地旅行，作为该旅行恢复时保留账本、意向与确认。
    return { ok: true, value: { action: 'create', trip: backupTrip } };
  }
  if (existingTrip.id !== backupTrip.id) {
    return {
      ok: false,
      error: sharingError('TRIP_MISMATCH', '传入的本地旅行与备份 ID 不一致，无法规划导入'),
    };
  }
  if (options.mode === 'overwrite') {
    // 覆盖：仓库在同一事务内先保留旧版恢复副本，再写入备份内容。
    return { ok: true, value: { action: 'overwrite', trip: backupTrip } };
  }
  return { ok: true, value: { action: 'copy', trip: remapTripIds(backupTrip, options) } };
}
