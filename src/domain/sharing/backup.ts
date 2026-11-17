/**
 * 完整备份（BR-15 / D11）：
 * - backup 是单旅行完整备份（含成员资料与账本），不含图片二进制、缓存或密钥。
 * - 导入使用 B0 的 parseTrip 做结构与语义两层校验（ID 唯一、引用存在、
 *   分摊不变量、900 KiB 上限），保证导入边界与存储恢复一致，不另建第二份 Trip schema。
 * - 同 ID 默认另存副本（重映射 ID、清除意向/确认/邀请登记）；覆盖必须显式确认，
 *   由仓库在同一事务内原子保留旧版恢复副本。
 */
import type { BusinessError } from '../../contracts/result';
import type { Trip } from '../types';
import { parseTrip } from '../schema';
import { sharingError } from './types';
import type {
  BackupImportPlan,
  BackupSummary,
  SharingContext,
  SharingEnvelope,
  SharingResult,
} from './types';

export type { BackupImportPlan, BackupSummary };

// ---------------------------------------------------------------------------
// 导出备份
// ---------------------------------------------------------------------------

export interface BuildBackupOptions {
  payloadId: string;
  now: string;
}

export function buildBackupEnvelope(
  trip: Trip,
  options: BuildBackupOptions,
): SharingEnvelope<{ trip: unknown }> {
  // JSON 克隆：备份是纯数据快照，剥离任何运行时引用。
  const snapshot = JSON.parse(JSON.stringify(trip)) as unknown;
  return {
    schemaVersion: 1,
    type: 'backup',
    payloadId: options.payloadId,
    createdAt: options.now,
    body: { trip: snapshot },
  };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/**
 * B0 TripValidator：分享域命令写入后的旅行校验。
 * 邀请/反馈登记的引用与唯一性已由 validateCoreTrip 覆盖（B0 聚合执行），
 * 此处不重复跨域检查；分享域没有额外旅行级不变量。
 */
export function validateSharingTrip(trip: Trip): BusinessError[] {
  void trip;
  return [];
}

/** 校验外部备份中的 Trip（结构 + 语义 + 大小），失败时整体拒绝（不部分导入）。 */
export function validateImportedTrip(input: unknown): SharingResult<Trip> {
  const parsed = parseTrip(input);
  if (!parsed.ok) {
    return {
      ok: false,
      error: sharingError('BACKUP_INVALID', parsed.error.message, {
        fields: Object.entries(parsed.error.fields ?? {}).map(([field, message]) => ({ field: `trip.${field}`, message })),
      }),
    };
  }
  return { ok: true, value: parsed.value };
}

/** 校验 backup envelope 并返回其中的 Trip。 */
export function validateBackupForImport(
  envelope: SharingEnvelope<{ trip: unknown }>,
): SharingResult<Trip> {
  if (envelope.type !== 'backup') {
    return { ok: false, error: sharingError('SCHEMA_INVALID', '载荷不是完整备份') };
  }
  return validateImportedTrip(envelope.body?.trip ?? null);
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
// ID 重映射（另存副本）
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

  const member = (oldId: string): string => memberMap.get(oldId) ?? oldId;

  return {
    ...trip,
    id: newTripId,
    revision: 0,
    members: trip.members.map((item) => ({
      ...item,
      id: memberMap.get(item.id) ?? item.id,
      availability: item.availability.map((range) => ({ ...range })),
      preferences: [...item.preferences],
    })),
    plans: trip.plans.map((plan) => {
      const transportByMember: Trip['plans'][number]['estimate']['transportByMember'] = {};
      for (const [oldMemberId, override] of Object.entries(plan.estimate.transportByMember)) {
        transportByMember[member(oldMemberId)] = override === null ? null : { ...override };
      }
      return { ...plan, id: planMap.get(plan.id) ?? plan.id, estimate: { ...plan.estimate, transportByMember } };
    }),
    intents: [],
    confirmation: null,
    itinerary: {
      sourcePlanId:
        trip.itinerary.sourcePlanId === null ? null : planMap.get(trip.itinerary.sourcePlanId) ?? null,
      sourcePlanVersion: trip.itinerary.sourcePlanVersion,
      dateRange: trip.itinerary.dateRange ? { ...trip.itinerary.dateRange } : null,
      activities: trip.itinerary.activities.map((activity) => ({
        ...activity,
        id: activityMap.get(activity.id) ?? activity.id,
      })),
    },
    expenses: trip.expenses.map((expense) => ({
      ...expense,
      id: expenseMap.get(expense.id) ?? expense.id,
      payerId: member(expense.payerId),
      allocations: expense.allocations.map((allocation) => ({
        memberId: member(allocation.memberId),
        amount: allocation.amount,
      })),
    })),
    settlements: trip.settlements.map((settlement) => ({
      ...settlement,
      id: settlementMap.get(settlement.id) ?? settlement.id,
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
