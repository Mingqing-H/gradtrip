import type { Activity, Duration, Expense, Id, IntentValue, InvitationRecord, Member, Plan, Range } from './types';
export interface ResponseInput {
  id: Id; invitationId: Id; tripId: Id; memberId: Id; constraintRevision: number;
  planVersions: Record<Id, number>; member: Omit<Member, 'id'>;
  intents: { planId: Id; planVersion: number; value: IntentValue }[];
}
export type CommandPayload =
  | { type: 'trip.rename'; name: string }
  | { type: 'trip.resetDemo' }
  | { type: 'member.add'; member: Member }
  | { type: 'member.update'; memberId: Id; changes: Partial<Omit<Member, 'id'>> }
  | { type: 'member.remove'; memberId: Id }
  | { type: 'plan.generate'; searchWindow: Range; duration: Duration; plans: Plan[] }
  | { type: 'plan.update'; planId: Id; changes: Partial<Pick<Plan, 'startDate' | 'days' | 'estimate'>> }
  | { type: 'plan.recordIntent'; memberId: Id; planId: Id; value: IntentValue; source: 'organizer' | 'demo' }
  | { type: 'plan.confirm'; planId: Id; itineraryMode: 'preserve' | 'replace' }
  | { type: 'itinerary.add'; activity: Activity; dateRange?: Range }
  | { type: 'itinerary.update'; activityId: Id; changes: Partial<Omit<Activity, 'id'>> }
  | { type: 'itinerary.remove'; activityId: Id }
  | { type: 'itinerary.move'; activityId: Id; direction: 'up' | 'down' }
  | { type: 'itinerary.replaceFromTemplate'; planId: Id; confirmed: boolean }
  | { type: 'ledger.addExpense'; expense: Expense }
  | { type: 'ledger.updateExpense'; expenseId: Id; expense: Expense }
  | { type: 'ledger.removeExpense'; expenseId: Id }
  | { type: 'ledger.recordSettlement'; settlementId: Id; fromId: Id; toId: Id; amount: number }
  | { type: 'ledger.voidAllSettlements' }
  | { type: 'sharing.registerInvitation'; invitation: InvitationRecord }
  | { type: 'sharing.applyResponse'; response: ResponseInput };
export interface Command { commandId: Id; tripId: Id; expectedRevision: number; payload: CommandPayload }
export type PlanningCommand = Extract<CommandPayload, { type: `member.${string}` | `plan.${string}` }>;
export type ItineraryLedgerCommand = Extract<CommandPayload, { type: `itinerary.${string}` | `ledger.${string}` }>;
export type SharingCommand = Extract<CommandPayload, { type: `sharing.${string}` }>;
export interface CommandContext { now: string; today: string; ids: readonly Id[]; commandId: Id }
