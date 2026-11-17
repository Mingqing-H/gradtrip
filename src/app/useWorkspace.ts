import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, CommandContext, CommandPayload } from '../domain/commands';
import type { Trip } from '../domain/types';
import type { RepositorySettings, SaveStatus, TripRecord, Workspace } from '../contracts/services';
import { failure, type BusinessError, type Result } from '../contracts/result';
import { applyCommand } from './application/commands';
import { dependencies, domainModules } from './modules';
import { createDemoTrip } from './application/demo';
import { createEmptyTrip } from '../data/demo';
import { dateToday, type Runtime } from './runtime';
export function useWorkspace(runtime: Runtime, tripId: string | undefined, workspace: Workspace) {
  const { repository, notifications } = runtime;
  const [records, setRecords] = useState<TripRecord[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true); const [bootLoading, setBootLoading] = useState(true);
  const [error, setError] = useState<BusinessError | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(repository.mode === 'memory' ? 'memoryOnly' : 'saved');
  const [settings, setSettings] = useState<RepositorySettings>({ initialized: false });
  const [settingsWarning, setSettingsWarning] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const pending = useRef<{ command: Command; context: CommandContext } | null>(null);
  const busy = useRef(false);
  const tripRef = useRef(trip); tripRef.current = trip;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const refreshList = useCallback(async () => {
    const result = await repository.list();
    if (result.ok) setRecords(result.value); else setError(result.error);
    return result;
  }, [repository]);
  useEffect(() => {
    let active = true;
    async function initialize() {
      const [listed, prefs] = await Promise.all([repository.list(), repository.getSettings()]);
      if (!active) return;
      if (!listed.ok) { setError(listed.error); setBootLoading(false); setLoading(false); return; }
      if (prefs.ok) setSettings(prefs.value); else setSettingsWarning(prefs.error.message);
      if (listed.value.length === 0 && prefs.ok && !prefs.value.initialized) {
        const now = new Date(); const demo = createDemoTrip({ id: 'demo-trip', today: dateToday(now), now: now.toISOString() });
        if (demo.ok) {
          const created = await repository.create(demo.value);
          if (!active) return;
          if (created.ok) {
            const preferences: RepositorySettings = { initialized: true, lastTripId: demo.value.id, workspace: 'squad' };
            const saved = await repository.setSettings(preferences);
            if (active) { setSettings(preferences); if (!saved.ok) setSettingsWarning(saved.error.message); }
          }
        }
      }
      if (active) { await refreshList(); setBootLoading(false); if (!tripId) setLoading(false); }
    }
    void initialize();
    return () => { active = false; };
  // Initial list/settings are loaded once per mounted route session.
  }, [repository, refreshList]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true; pending.current = null;
    if (!tripId) { setTrip(null); setLoading(false); return; }
    setLoading(true); setError(null); setTrip(null);
    void repository.get(tripId).then(result => {
      if (!active) return;
      if (result.ok) {
        setTrip(result.value); setSaveStatus(repository.mode === 'memory' ? 'memoryOnly' : 'saved');
        const preferences: RepositorySettings = { ...settingsRef.current, initialized: true, lastTripId: tripId, workspace };
        setSettings(preferences);
        void repository.setSettings(preferences).then(saved => { if (active && !saved.ok) setSettingsWarning(saved.error.message); });
      } else setError(result.error);
      setLoading(false);
    });
    return () => { active = false; };
    // Changing workspaces must not discard a failed command or a page draft.
  }, [repository, tripId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tripId) return;
    const prefs = { ...settingsRef.current, initialized: true, lastTripId: tripId, workspace };
    setSettings(prefs);
    void repository.setSettings(prefs).then(result => { if (!result.ok) setSettingsWarning(result.error.message); });
  }, [repository, tripId, workspace]);
  useEffect(() => {
    const check = async () => {
      const current = tripRef.current; if (!current) return;
      const latest = await repository.get(current.id);
      const expected = pending.current?.command.expectedRevision ?? current.revision;
      if ((latest.ok && latest.value.revision !== expected) || (!latest.ok && latest.error.code === 'NOT_FOUND')) setSaveStatus('conflict');
      await refreshList();
    };
    const unsubscribe = notifications.subscribe(update => {
      const current = tripRef.current;
      if (current && update.tripId === current.id && update.revision !== current.revision) setSaveStatus('conflict');
      void refreshList();
    });
    window.addEventListener('focus', check);
    return () => { unsubscribe(); window.removeEventListener('focus', check); };
  }, [notifications, repository, refreshList]);
  const persist = async (command: Command, context: CommandContext): Promise<Result<Trip>> => {
    busy.current = true; setSaveStatus('saving');
    const result = await repository.execute(command, context);
    busy.current = false;
    if (result.ok) {
      pending.current = null; setTrip(result.value); setError(null);
      setSaveStatus(repository.mode === 'memory' ? 'memoryOnly' : 'saved'); await refreshList();
    } else {
      setError(result.error); setSaveStatus(result.error.code === 'CONFLICT' ? 'conflict' : 'unsaved');
    }
    return result;
  };
  const execute = async (payload: CommandPayload): Promise<Result<Trip>> => {
    const current = tripRef.current;
    if (!current) return failure('NOT_FOUND', '请先打开旅行');
    if (busy.current || pending.current) return failure('LOCKED', '请先重试保存或导出尚未保存的内容');
    if (saveStatus === 'conflict') return failure('CONFLICT', '请先导出当前内容或重新载入');
    const now = new Date(); const commandId = crypto.randomUUID();
    const context: CommandContext = { now: now.toISOString(), today: dateToday(now), commandId, ids: Array.from({ length: 128 }, () => crypto.randomUUID()) };
    const command: Command = { commandId, tripId: current.id, expectedRevision: current.revision, payload };
    const preview = applyCommand(current, command, context, domainModules, dependencies);
    if (!preview.ok) { setError(preview.error); return preview; }
    pending.current = { command, context }; setTrip(preview.value);
    return persist(command, context);
  };
  const create = async (name: string, demo = false): Promise<Result<Trip>> => {
    const now = new Date();
    const input = { id: demo ? 'demo-trip' : crypto.randomUUID(), name, today: dateToday(now), now: now.toISOString() };
    const candidate = demo ? createDemoTrip(input) : { ok: true as const, value: createEmptyTrip(input) };
    if (!candidate.ok) { setError(candidate.error); return candidate; }
    const result = await repository.create(candidate.value);
    if (!result.ok) setError(result.error); else { setError(null); await refreshList(); }
    return result;
  };
  const remove = async (id: string, revision: number): Promise<Result<void>> => {
    const result = await repository.delete(id, revision);
    if (!result.ok) setError(result.error);
    else {
      pending.current = null; setTrip(null); setError(null); await refreshList();
      const prefs: RepositorySettings = { initialized: true, workspace };
      setSettings(prefs); const saved = await repository.setSettings(prefs);
      if (!saved.ok) setSettingsWarning(saved.error.message);
    }
    return result;
  };
  return {
    records, trip, loading: loading || bootLoading, error, setError, saveStatus, settings, settingsWarning, reloadKey,
    execute, create, remove, refreshList,
    retry: () => pending.current ? persist(pending.current.command, pending.current.context) : Promise.resolve(failure('NOT_FOUND', '没有待保存的内容')),
    reload: async () => {
      if (tripRef.current && repository.mode === 'persistent') {
        const result = await repository.get(tripRef.current.id);
        if (!result.ok && result.error.code === 'STORAGE') { location.reload(); return; }
      }
      pending.current = null; setReloadKey(n => n + 1);
    },
  };
}
