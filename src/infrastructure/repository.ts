import { z } from 'zod';
import type { IDBPDatabase } from 'idb';
import type { Trip } from '../domain/types';
import type { Command, CommandContext } from '../domain/commands';
import { idSchema, parseTrip, MAX_STORAGE_BYTES } from '../domain/schema';
import { failure, success, type Result } from '../contracts/result';
import type { DomainDependencies, DomainModule, RecoveryRecord, Repository, RepositorySettings, TripRecord } from '../contracts/services';
import { applyCommand } from '../app/application/commands';
import { openTripDatabase, type StoredTrip, type TripDatabase } from './migrations';
import type { Notifications } from './notifications';
export interface RepositoryOptions {
  dependencies: DomainDependencies;
  modules: Partial<Record<'planning' | 'itineraryLedger' | 'sharing', DomainModule>>;
  notifications?: Pick<Notifications, 'publish'>;
  maxStorageBytes?: number;
  // Fault injection only used by integration tests, always synchronous inside the transaction.
  beforeCommit?: () => void;
}
const settingsSchema = z.strictObject({
  lastTripId: idSchema.optional(), workspace: z.enum(['squad', 'plans', 'itinerary', 'ledger']).optional(), initialized: z.boolean(),
});
function decode(record: StoredTrip | undefined): Result<Trip> {
  if (!record) return failure('NOT_FOUND', '找不到此旅行，请选择其他旅行或导入备份');
  try {
    const parsed = parseTrip(JSON.parse(record.raw));
    if (!parsed.ok) return failure('CORRUPT', '本地旅行数据损坏，原始内容已保留，可先导出再恢复', parsed.error.fields);
    if (parsed.value.id !== record.id || parsed.value.revision !== record.revision) return failure('CORRUPT', '旅行索引与内容不一致，原始内容已保留');
    return parsed;
  } catch { return failure('CORRUPT', '本地旅行无法解析，原始内容已保留'); }
}
function validate(trip: Trip, options: RepositoryOptions): Result<Trip> {
  const parsed = parseTrip(trip); if (!parsed.ok) return parsed;
  for (const module of Object.values(options.modules)) {
    const errors = module.validate(parsed.value); if (errors.length) return { ok: false, error: errors[0] };
  }
  return parsed;
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const stored = (trip: Trip): StoredTrip => ({ id: trip.id, revision: trip.revision, raw: JSON.stringify(trip) });
function storageFailure(error: unknown): Result<never> {
  return failure('STORAGE', error instanceof Error && error.name === 'QuotaExceededError' ? '此设备存储空间不足，请导出内容并管理备份' : '保存未完成，请重试或导出当前内容');
}
function recordSummary(record: StoredTrip): TripRecord {
  const parsed = decode(record);
  return parsed.ok
    ? { id: record.id, name: parsed.value.name, revision: record.revision, updatedAt: parsed.value.updatedAt, isDemo: parsed.value.isDemo }
    : { id: record.id, name: '需要恢复的旅行', revision: record.revision, updatedAt: '', isDemo: false, error: parsed.error };
}
export function createIndexedDBRepository(db: IDBPDatabase<TripDatabase>, options: RepositoryOptions): Repository {
  const withinCapacity = (trips: StoredTrip[], recovery: RecoveryRecord[]) => bytes(trips) + bytes(recovery) <= (options.maxStorageBytes ?? MAX_STORAGE_BYTES);
  const notify = (tripId: string, revision: number | null) => options.notifications?.publish({ tripId, revision });
  const startTransaction = () => {
    try { return success(db.transaction(['trips', 'recovery'], 'readwrite')); }
    catch (error) { return storageFailure(error); }
  };
  return {
    mode: 'persistent',
    async list() {
      try { return success((await db.getAll('trips')).map(recordSummary)); } catch (error) { return storageFailure(error); }
    },
    async get(id) {
      try {
        const parsed = decode(await db.get('trips', id));
        if (!parsed.ok) return parsed;
        const checked = validate(parsed.value, options);
        return checked.ok ? checked : failure('CORRUPT', checked.error.message, checked.error.fields);
      } catch (error) { return storageFailure(error); }
    },
    async getRaw(id) {
      try { const record = await db.get('trips', id); return record ? success(record.raw) : failure('NOT_FOUND', '找不到原始内容'); } catch (error) { return storageFailure(error); }
    },
    async create(trip) {
      const parsed = validate(trip, options); if (!parsed.ok) return parsed;
      const started = startTransaction(); if (!started.ok) return started; const tx = started.value;
      try {
        const trips = await tx.objectStore('trips').getAll();
        if (trips.some(t => t.id === trip.id)) { await tx.done; return failure('CONFLICT', '旅行已存在'); }
        if (trips.length >= 10) { await tx.done; return failure('CAPACITY', '此设备最多保存 10 个旅行'); }
        const record = stored(parsed.value);
        if (!withinCapacity([...trips, record], await tx.objectStore('recovery').getAll())) { await tx.done; return failure('CAPACITY', '本地内容超过 20 MiB，请先导出并管理备份'); }
        await tx.objectStore('trips').add(record);
        options.beforeCommit?.(); await tx.done;
        notify(trip.id, trip.revision); return parsed;
      } catch (error) { try { tx.abort(); } catch { /* Already aborted. */ } await tx.done.catch(() => {}); return storageFailure(error); }
    },
    async execute(command: Command, context: CommandContext) {
      if (!idSchema.safeParse(command.commandId).success || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) return failure('VALIDATION', '命令 ID 或版本无效');
      const started = startTransaction(); if (!started.ok) return started; const tx = started.value;
      try {
        const old = decode(await tx.objectStore('trips').get(command.tripId));
        if (!old.ok) { await tx.done; return old; }
        const current = validate(old.value, options); if (!current.ok) { await tx.done; return current; }
        const result = applyCommand(current.value, command, context, options.modules, options.dependencies);
        if (!result.ok || result.value === current.value) { await tx.done; return result; }
        const trips = (await tx.objectStore('trips').getAll()).filter(t => t.id !== command.tripId);
        const record = stored(result.value);
        if (!withinCapacity([...trips, record], await tx.objectStore('recovery').getAll())) { await tx.done; return failure('CAPACITY', '本地内容超过存储上限，请导出并管理备份'); }
        await tx.objectStore('trips').put(record);
        options.beforeCommit?.(); await tx.done;
        notify(command.tripId, result.value.revision); return result;
      } catch (error) { try { tx.abort(); } catch { /* Already aborted. */ } await tx.done.catch(() => {}); return storageFailure(error); }
    },
    async delete(id, expectedRevision) {
      const started = startTransaction(); if (!started.ok) return started; const tx = started.value;
      try {
        const record = await tx.objectStore('trips').get(id);
        if (!record) { await tx.done; return failure('NOT_FOUND', '找不到旅行'); }
        if (record.revision !== expectedRevision) { await tx.done; return failure('CONFLICT', '其他标签页已更新，请重新载入'); }
        await tx.objectStore('trips').delete(id);
        const recoveries = await tx.objectStore('recovery').index('by-trip').getAll(id);
        for (const recovery of recoveries) await tx.objectStore('recovery').delete(recovery.id);
        options.beforeCommit?.(); await tx.done; notify(id, null); return success(undefined);
      } catch (error) { try { tx.abort(); } catch { /* Already aborted. */ } await tx.done.catch(() => {}); return storageFailure(error); }
    },
    async replace({ trip, expectedRevision, recoveryId, now }) {
      if (!idSchema.safeParse(recoveryId).success || !z.iso.datetime().safeParse(now).success) return failure('VALIDATION', '恢复副本标识或时间无效');
      const started = startTransaction(); if (!started.ok) return started; const tx = started.value;
      try {
        const oldRecord = await tx.objectStore('trips').get(trip.id);
        if (!oldRecord) { await tx.done; return failure('NOT_FOUND', '找不到要覆盖的旅行'); }
        if (oldRecord.revision !== expectedRevision) { await tx.done; return failure('CONFLICT', '预览后旅行已更新，请重新预览'); }
        if (await tx.objectStore('recovery').get(recoveryId)) { await tx.done; return failure('CONFLICT', '恢复副本 ID 已存在'); }
        const next = validate({ ...trip, revision: expectedRevision + 1, updatedAt: now }, options);
        if (!next.ok) { await tx.done; return next; }
        // Preserve command IDs already applied locally, so an old command cannot replay after overwrite.
        const old = decode(oldRecord);
        if (old.ok) {
          next.value.appliedCommandIds = [...new Set([...old.value.appliedCommandIds, ...next.value.appliedCommandIds])];
          const checked = validate(next.value, options); if (!checked.ok) { await tx.done; return checked; }
        }
        const allRecovery = await tx.objectStore('recovery').getAll();
        const recovery: RecoveryRecord = { id: recoveryId, tripId: trip.id, raw: oldRecord.raw, createdAt: now };
        const sameTrip = [...allRecovery.filter(r => r.tripId === trip.id), recovery].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        const keep = new Set(sameTrip.slice(0, 3).map(r => r.id));
        const remove = sameTrip.filter(r => !keep.has(r.id));
        const remaining = [...allRecovery.filter(r => r.tripId !== trip.id), ...sameTrip.filter(r => keep.has(r.id))];
        const record = stored(next.value);
        const trips = (await tx.objectStore('trips').getAll()).filter(t => t.id !== trip.id);
        if (!withinCapacity([...trips, record], remaining)) { await tx.done; return failure('CAPACITY', '保存恢复副本后将超过本地存储上限'); }
        await tx.objectStore('recovery').add(recovery);
        for (const item of remove) await tx.objectStore('recovery').delete(item.id);
        await tx.objectStore('trips').put(record);
        options.beforeCommit?.(); await tx.done; notify(trip.id, next.value.revision); return next;
      } catch (error) { try { tx.abort(); } catch { /* Already aborted. */ } await tx.done.catch(() => {}); return storageFailure(error); }
    },
    async listRecovery(tripId) { try { return success((await db.getAllFromIndex('recovery', 'by-trip', tripId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))); } catch (error) { return storageFailure(error); } },
    async deleteRecovery(id) { try { await db.delete('recovery', id); return success(undefined); } catch (error) { return storageFailure(error); } },
    async getSettings() {
      try {
        const value = await db.get('settings', 'preferences');
        if (value === undefined) return success({ initialized: false });
        const parsed = settingsSchema.safeParse(value);
        return parsed.success ? success(parsed.data) : failure('CORRUPT', '本地偏好已损坏，旅行内容仍保留');
      } catch (error) { return storageFailure(error); }
    },
    async setSettings(settings) {
      const parsed = settingsSchema.safeParse(settings); if (!parsed.success) return failure('VALIDATION', '工作区设置无效');
      try { await db.put('settings', parsed.data, 'preferences'); return success(undefined); } catch (error) { return storageFailure(error); }
    },
    close() { db.close(); },
  };
}
export function createTemporaryRepository(options: RepositoryOptions): Repository {
  // A separate in-memory IndexedDB implementation is deliberately not bundled. This bounded
  // volatile port implements the same application contract and always advertises memory mode.
  const trips = new Map<string, Trip>(); const recoveries = new Map<string, RecoveryRecord>();
  let settings: RepositorySettings = { initialized: false };
  const validateMemory = (trip: Trip) => validate(structuredClone(trip), options);
  return {
    mode: 'memory',
    list: async () => success([...trips.values()].map(trip => recordSummary(stored(trip)))),
    get: async id => trips.has(id) ? validateMemory(trips.get(id)!) : failure('NOT_FOUND', '找不到旅行'),
    getRaw: async id => trips.has(id) ? success(JSON.stringify(trips.get(id))) : failure('NOT_FOUND', '找不到旅行'),
    create: async trip => {
      const checked = validateMemory(trip); if (!checked.ok) return checked;
      if (trips.has(trip.id)) return failure('CONFLICT', '旅行已存在');
      if (trips.size >= 10) return failure('CAPACITY', '最多保存 10 个旅行');
      trips.set(trip.id, structuredClone(checked.value)); return checked;
    },
    execute: async (command, context) => {
      const trip = trips.get(command.tripId); if (!trip) return failure('NOT_FOUND', '找不到旅行');
      const result = applyCommand(trip, command, context, options.modules, options.dependencies);
      if (result.ok) trips.set(trip.id, structuredClone(result.value)); return result;
    },
    delete: async (id, revision) => {
      const trip = trips.get(id); if (!trip) return failure('NOT_FOUND', '找不到旅行');
      if (trip.revision !== revision) return failure('CONFLICT', '旅行已更新');
      trips.delete(id); for (const r of recoveries.values()) if (r.tripId === id) recoveries.delete(r.id); return success(undefined);
    },
    replace: async ({ trip, expectedRevision, recoveryId, now }) => {
      const old = trips.get(trip.id); if (!old) return failure('NOT_FOUND', '找不到旅行');
      if (old.revision !== expectedRevision) return failure('CONFLICT', '旅行已更新');
      if (recoveries.has(recoveryId)) return failure('CONFLICT', '恢复副本 ID 已存在');
      const next = validateMemory({ ...trip, revision: old.revision + 1, updatedAt: now, appliedCommandIds: [...new Set([...old.appliedCommandIds, ...trip.appliedCommandIds])] }); if (!next.ok) return next;
      recoveries.set(recoveryId, { id: recoveryId, tripId: trip.id, raw: JSON.stringify(old), createdAt: now });
      const sameTrip = [...recoveries.values()].filter(r => r.tripId === trip.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      sameTrip.slice(3).forEach(r => recoveries.delete(r.id));
      trips.set(trip.id, structuredClone(next.value)); return next;
    },
    listRecovery: async tripId => success(structuredClone([...recoveries.values()].filter(r => r.tripId === tripId))),
    deleteRecovery: async id => { recoveries.delete(id); return success(undefined); },
    getSettings: async () => success(structuredClone(settings)),
    setSettings: async value => { const parsed = settingsSchema.safeParse(value); if (!parsed.success) return failure('VALIDATION', '工作区设置无效'); settings = parsed.data; return success(undefined); },
    close() { trips.clear(); recoveries.clear(); },
  };
}
export async function openRepository(base: string, options: RepositoryOptions, onUnavailable?: (message: string) => void): Promise<Repository> {
  try {
    const db = await openTripDatabase(base, { blocked: () => onUnavailable?.('另一个旧页面阻止升级，请关闭旧页面后重试'), terminated: () => onUnavailable?.('存储连接已关闭，请导出当前内容后重新载入') });
    return createIndexedDBRepository(db, options);
  } catch {
    onUnavailable?.('此浏览器无法使用本地存储。临时体验内容刷新后会丢失，请及时导出。');
    return createTemporaryRepository(options);
  }
}
