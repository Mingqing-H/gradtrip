import type { Command, CommandContext } from '../../src/domain/commands';
import type { Trip } from '../../src/domain/types';
import type { DomainDependencies, DomainModule, RecoveryRecord, Repository, RepositorySettings } from '../../src/contracts/services';
import { failure, success } from '../../src/contracts/result';
import { parseTrip } from '../../src/domain/schema';
import { applyCommand } from '../../src/app/application/commands';
// Test double only. Production memory mode is implemented in infrastructure/repository.ts.
export function createMemoryRepository(dependencies: DomainDependencies, modules: Partial<Record<'planning' | 'itineraryLedger' | 'sharing', DomainModule>> = {}): Repository {
  const trips = new Map<string, Trip>();
  const recovery = new Map<string, RecoveryRecord>();
  let settings: RepositorySettings = { initialized: false };
  return {
    mode: 'memory',
    list: async () => success([...trips.values()].map(({ id, name, revision, updatedAt, isDemo }) => ({ id, name, revision, updatedAt, isDemo }))),
    get: async id => trips.has(id) ? success(structuredClone(trips.get(id)!)) : failure('NOT_FOUND', '找不到旅行'),
    getRaw: async id => trips.has(id) ? success(JSON.stringify(trips.get(id))) : failure('NOT_FOUND', '找不到旅行'),
    create: async trip => {
      const parsed = parseTrip(trip); if (!parsed.ok) return parsed;
      if (trips.has(trip.id)) return failure('CONFLICT', '旅行已存在');
      if (trips.size >= 10) return failure('CAPACITY', '最多保存 10 个旅行');
      trips.set(trip.id, structuredClone(parsed.value)); return parsed;
    },
    execute: async (command: Command, context: CommandContext) => {
      const trip = trips.get(command.tripId); if (!trip) return failure('NOT_FOUND', '找不到旅行');
      const result = applyCommand(trip, command, context, modules, dependencies);
      if (result.ok) trips.set(trip.id, structuredClone(result.value)); return result;
    },
    delete: async (id, expectedRevision) => {
      const trip = trips.get(id); if (!trip) return failure('NOT_FOUND', '找不到旅行');
      if (trip.revision !== expectedRevision) return failure('CONFLICT', '旅行已更新');
      trips.delete(id); return success(undefined);
    },
    replace: async ({ trip, expectedRevision, recoveryId, now }) => {
      const old = trips.get(trip.id); if (!old) return failure('NOT_FOUND', '找不到旅行');
      if (old.revision !== expectedRevision) return failure('CONFLICT', '旅行已更新');
      const result = parseTrip({ ...trip, revision: old.revision + 1, updatedAt: now }); if (!result.ok) return result;
      recovery.set(recoveryId, { id: recoveryId, tripId: trip.id, raw: JSON.stringify(old), createdAt: now });
      trips.set(trip.id, structuredClone(result.value)); return result;
    },
    listRecovery: async id => success([...recovery.values()].filter(r => r.tripId === id)),
    deleteRecovery: async id => { recovery.delete(id); return success(undefined); },
    getSettings: async () => success(structuredClone(settings)),
    setSettings: async value => { settings = structuredClone(value); return success(undefined); },
    close: () => {},
  };
}
