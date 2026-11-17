import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openTripDatabase, storageNamespace } from '../../../src/infrastructure/migrations';
import { createIndexedDBRepository, createTemporaryRepository, type RepositoryOptions } from '../../../src/infrastructure/repository';
import { createEmptyTrip } from '../../../src/data/demo';
import { dependencies } from '../../helpers/dependencies';
import type { Repository } from '../../../src/contracts/services';
const now = '2026-11-18T00:00:00.000Z';
const today = '2026-11-18';
const trip = () => createEmptyTrip({ id: 'trip-1', name: '毕业旅行', today, now });
let counter = 0;
const opened: Repository[] = [];
afterEach(() => { opened.splice(0).forEach(r => r.close()); });
async function setup(extra: Partial<RepositoryOptions> = {}, name = 'test-' + counter++) {
  const db = await openTripDatabase('/gradtrip/', { factoryName: name });
  const repo = createIndexedDBRepository(db, { dependencies, modules: {}, ...extra }); opened.push(repo);
  return { repo, db, name };
}
const command = (id: string, expectedRevision = 0, name = '海边旅行') => ({ commandId: id, tripId: 'trip-1', expectedRevision, payload: { type: 'trip.rename' as const, name } });
const context = (commandId: string) => ({ commandId, now, today, ids: [] });
describe('IndexedDB transaction repository', () => {
  it('deduplicates before revision check and publishes only committed changes', async () => {
    const events: unknown[] = [];
    const { repo } = await setup({ notifications: { publish: event => events.push(event) } });
    expect((await repo.create(trip())).ok).toBe(true);
    const first = await repo.execute(command('cmd-1'), context('cmd-1'));
    expect(first.ok && first.value.revision).toBe(1);
    expect(await repo.execute(command('cmd-1'), context('cmd-1'))).toEqual(first);
    expect(events).toHaveLength(2);
  });
  it('serializes concurrent connections and refuses an old tab overwrite', async () => {
    const { repo, name } = await setup(); await repo.create(trip());
    const second = (await setup({}, name)).repo;
    const results = await Promise.all([repo.execute(command('a'), context('a')), second.execute(command('b'), context('b'))]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.some(r => !r.ok && r.error.code === 'CONFLICT')).toBe(true);
    const current = await repo.get('trip-1'); expect(current.ok && current.value.revision).toBe(1);
  });
  it('aborts both a normal write and notification if a transaction fails', async () => {
    let abort = false; const events: unknown[] = [];
    const { repo } = await setup({ beforeCommit: () => { if (abort) throw new DOMException('quota', 'QuotaExceededError'); }, notifications: { publish: e => events.push(e) } });
    await repo.create(trip()); abort = true;
    const result = await repo.execute(command('a'), context('a')); expect(!result.ok && result.error.code).toBe('STORAGE');
    const current = await repo.get('trip-1'); expect(current.ok && current.value.revision).toBe(0);
    expect(events).toHaveLength(1);
  });
  it('preserves corrupt JSON and lists it as recoverable instead of seeding over it', async () => {
    const { repo, db } = await setup();
    await db.put('trips', { id: 'trip-1', revision: 7, raw: '{"broken":' });
    const result = await repo.get('trip-1'); expect(!result.ok && result.error.code).toBe('CORRUPT');
    expect(await repo.getRaw('trip-1')).toEqual({ ok: true, value: '{"broken":' });
    const listed = await repo.list(); expect(listed.ok && listed.value[0].error?.code).toBe('CORRUPT');
    expect((await repo.create(trip())).ok).toBe(false);
  });
  it('atomically stores the old version before replacement and keeps latest three copies', async () => {
    const { repo } = await setup(); await repo.create(trip());
    for (let n = 0; n < 4; n++) {
      const result = await repo.replace({ trip: { ...trip(), name: '导入 ' + n }, expectedRevision: n, recoveryId: 'r-' + n, now: '2026-11-18T00:00:0' + n + '.000Z' });
      expect(result.ok && result.value.revision).toBe(n + 1);
    }
    const copies = await repo.listRecovery('trip-1'); expect(copies.ok && copies.value.map(r => r.id)).toEqual(['r-3', 'r-2', 'r-1']);
    expect(copies.ok && JSON.parse(copies.value[0].raw).name).toBe('导入 2');
  });
  it('rolls back both the recovery copy and overwritten trip if commit fails', async () => {
    let abort = false;
    const { repo } = await setup({ beforeCommit: () => { if (abort) throw new Error('abort'); } }); await repo.create(trip()); abort = true;
    const result = await repo.replace({ trip: { ...trip(), name: '不能生效' }, expectedRevision: 0, recoveryId: 'r-1', now });
    expect(result.ok).toBe(false);
    expect(await repo.listRecovery('trip-1')).toEqual({ ok: true, value: [] });
    const current = await repo.get('trip-1'); expect(current.ok && current.value.name).toBe('毕业旅行');
  });
  it('rejects stale imports, invalid financial references and duplicate recovery IDs without partial writes', async () => {
    const { repo } = await setup(); await repo.create(trip());
    await repo.execute(command('a'), context('a'));
    const stale = await repo.replace({ trip: trip(), expectedRevision: 0, recoveryId: 'r-1', now });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT');
    const invalid = trip(); invalid.intents.push({ memberId: 'missing', planId: 'missing', planVersion: 1, constraintRevision: 0, value: 'approve', source: 'feedback', recordedAt: now });
    expect((await repo.replace({ trip: invalid, expectedRevision: 1, recoveryId: 'r-1', now })).ok).toBe(false);
    expect(await repo.listRecovery('trip-1')).toEqual({ ok: true, value: [] });
  });
  it('retains local command history across backup overwrite', async () => {
    const { repo } = await setup(); await repo.create(trip()); await repo.execute(command('a'), context('a'));
    const replaced = await repo.replace({ trip: trip(), expectedRevision: 1, recoveryId: 'r-1', now });
    expect(replaced.ok && replaced.value.appliedCommandIds).toContain('a');
    const repeated = await repo.execute(command('a'), context('a')); expect(repeated.ok && repeated.value.revision).toBe(2);
  });
  it('enforces storage and trip count budgets, and separates settings failure', async () => {
    const small = (await setup({ maxStorageBytes: 100 })).repo; expect((await small.create(trip())).ok).toBe(false);
    const { repo } = await setup();
    for (let n = 0; n < 10; n++) expect((await repo.create({ ...trip(), id: 't-' + n })).ok).toBe(true);
    const full = await repo.create(trip()); expect(!full.ok && full.error.code).toBe('CAPACITY');
    expect((await repo.setSettings({ initialized: true, workspace: 'invalid' as 'squad' })).ok).toBe(false);
    expect((await repo.list()).ok).toBe(true);
  });
  it('detects index mismatch and closes old connections during database upgrade', async () => {
    const { repo, db } = await setup(); await db.put('trips', { id: 'trip-1', revision: 5, raw: JSON.stringify(trip()) });
    const result = await repo.get('trip-1'); expect(!result.ok && result.error.code).toBe('CORRUPT');
  });
  it('isolates application storage by normalized base', () => {
    expect(storageNamespace('gradtrip')).toBe(storageNamespace('/gradtrip/'));
    expect(storageNamespace('/other/')).not.toBe(storageNamespace('/gradtrip/'));
    expect(storageNamespace('/')).toBe('tonglu-gradtrip:%2F');
  });
});
describe('explicit temporary memory mode', () => {
  it('uses the same command and version contract without claiming persistence', async () => {
    const repo = createTemporaryRepository({ dependencies, modules: {} }); opened.push(repo);
    expect(repo.mode).toBe('memory'); await repo.create(trip());
    expect((await repo.execute(command('a'), context('a'))).ok).toBe(true);
    expect((await repo.execute(command('b'), context('b'))).ok).toBe(false);
    const current = await repo.get('trip-1'); if (current.ok) current.value.name = 'mutated';
    const reread = await repo.get('trip-1'); expect(reread.ok && reread.value.name).toBe('海边旅行');
  });
});
