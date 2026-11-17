import { storageNamespace } from './migrations';
export interface TripNotification { tripId: string; revision: number | null }
export interface Notifications { publish(value: TripNotification): void; subscribe(listener: (value: TripNotification) => void): () => void; close(): void }
export function createNotifications(base: string): Notifications {
  let channel: BroadcastChannel | undefined;
  try { channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(storageNamespace(base) + ':updates'); } catch { /* Focus checks and transaction revisions remain authoritative. */ }
  const listeners = new Set<(value: TripNotification) => void>();
  if (channel) channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (!data || typeof data !== 'object' || !('tripId' in data) || !('revision' in data)) return;
    if (typeof data.tripId !== 'string' || (data.revision !== null && (!Number.isSafeInteger(data.revision) || (data.revision as number) < 0))) return;
    const event: TripNotification = { tripId: data.tripId, revision: data.revision as number | null };
    listeners.forEach(listener => listener(event));
  };
  return {
    publish(value) { try { channel?.postMessage(value); } catch { /* Notification loss never bypasses transaction checks. */ } },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { channel?.close(); listeners.clear(); },
  };
}
