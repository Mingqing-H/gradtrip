import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { openTripDatabase } from '../../../src/infrastructure/migrations';
import { createIndexedDBRepository, createTemporaryRepository } from '../../../src/infrastructure/repository';
import { createNotifications } from '../../../src/infrastructure/notifications';
import { createEmptyTrip } from '../../../src/data/demo';
import { dependencies } from '../../helpers/dependencies';
const now = '2026-11-18T00:00:00.000Z';
const empty = () => createEmptyTrip({ id: 'trip', name: '测试旅行', today: '2026-11-18', now });
describe('connection and recovery boundaries', () => {
  it('closes an old connection for upgrade and turns later writes into a recoverable storage result', async () => {
    const name = 'upgrade-boundary';
    const db = await openTripDatabase('/', { factoryName: name });
    const repository = createIndexedDBRepository(db, { dependencies, modules: {} });
    await repository.create(empty());
    const newer = await openDB(name, 2);
    try {
      const result = await repository.execute({ commandId: 'rename', tripId: 'trip', expectedRevision: 0, payload: { type: 'trip.rename', name: '不会保存' } }, { commandId: 'rename', now, today: '2026-11-18', ids: [] });
      expect(!result.ok && result.error.code).toBe('STORAGE');
      expect(await newer.get('trips', 'trip')).toMatchObject({ revision: 0 });
    } finally { newer.close(); repository.close(); }
  });
  it('rejects an over-budget recovery replacement before changing either store', async () => {
    const db = await openTripDatabase('/', { factoryName: 'recovery-budget' });
    const size = new TextEncoder().encode(JSON.stringify(empty())).length;
    const repository = createIndexedDBRepository(db, { dependencies, modules: {}, maxStorageBytes: size + 200 });
    try {
      expect((await repository.create(empty())).ok).toBe(true);
      const result = await repository.replace({ trip: empty(), expectedRevision: 0, recoveryId: 'r1', now });
      expect(!result.ok && result.error.code).toBe('CAPACITY');
      expect(await repository.listRecovery('trip')).toEqual({ ok: true, value: [] });
      const current = await repository.get('trip'); expect(current.ok && current.value.revision).toBe(0);
    } finally { repository.close(); }
  });
  it('enforces the same capacity limit in temporary mode', async () => {
    const repository = createTemporaryRepository({ dependencies, modules: {}, maxStorageBytes: 100 });
    try { const result = await repository.create(empty()); expect(!result.ok && result.error.code).toBe('CAPACITY'); }
    finally { repository.close(); }
  });
  it('notifies other tabs while keeping the publishing tab independent', async () => {
    const a = createNotifications('/test-notifications/'); const b = createNotifications('/test-notifications/');
    try {
      const result = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('notification timeout')), 2000);
        b.subscribe(event => { clearTimeout(timer); resolve(event); });
      });
      a.publish({ tripId: 'trip', revision: 1 });
      expect(await result).toEqual({ tripId: 'trip', revision: 1 });
    } finally { a.close(); b.close(); }
  });
});
