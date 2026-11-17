import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RecoveryRecord, RepositorySettings } from '../contracts/services';
export interface StoredTrip { id: string; raw: string; revision: number }
export interface TripDatabase extends DBSchema {
  trips: { key: string; value: StoredTrip };
  recovery: { key: string; value: RecoveryRecord; indexes: { 'by-trip': string } };
  settings: { key: string; value: RepositorySettings };
}
export const DB_VERSION = 1;
export function storageNamespace(base: string): string {
  const normalized = '/' + base.split('/').filter(Boolean).join('/') + '/';
  return 'tonglu-gradtrip:' + encodeURIComponent(normalized === '//' ? '/' : normalized);
}
export async function openTripDatabase(base: string, options: { blocked?: () => void; terminated?: () => void; factoryName?: string } = {}): Promise<IDBPDatabase<TripDatabase>> {
  const db = await openDB<TripDatabase>(options.factoryName ?? storageNamespace(base), DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('trips', { keyPath: 'id' });
        const recovery = db.createObjectStore('recovery', { keyPath: 'id' });
        recovery.createIndex('by-trip', 'tripId');
        db.createObjectStore('settings');
      }
    },
    blocked: options.blocked,
    blocking() { db.close(); },
    terminated: options.terminated,
  });
  return db;
}
