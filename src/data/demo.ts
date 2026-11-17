import { addDays } from '../domain/dates';
import type { Trip } from '../domain/types';
export function createEmptyTrip(input: { id: string; name: string; today: string; now: string; isDemo?: boolean }): Trip {
  return {
    schemaVersion: 1, id: input.id, name: input.name.trim(), revision: 0, constraintRevision: 0,
    searchWindow: { start: addDays(input.today, 30), end: addDays(input.today, 60) }, duration: 3,
    members: [], plans: [], intents: [], confirmation: null,
    itinerary: { sourcePlanId: null, sourcePlanVersion: null, dateRange: null, activities: [] },
    expenses: [], settlements: [], invitations: [], appliedResponses: [], appliedCommandIds: [],
    isDemo: input.isDemo ?? false, createdAt: input.now, updatedAt: input.now,
  };
}
