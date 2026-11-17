export type Id = string;
export type Cents = number;
export type DateOnly = string;
export type Duration = 2 | 3 | 4 | 5;
export interface Range { start: DateOnly; end: DateOnly }
export type IntentValue = 'approve' | 'acceptable' | 'decline';
export interface Member {
  id: Id; name: string; originCity: string | null; budgetCap: Cents | null;
  availability: Range[]; preferences: string[];
}
export interface Plan {
  id: Id; version: number; destinationId: Id; templateVersion: number; startDate: DateOnly; days: Duration;
  estimate: {
    transportByMember: Record<Id, { originCity: string; amount: Cents } | null>;
    lodgingPerNight: Cents; foodPerDay: Cents; activities: Cents; reserve: Cents;
  };
}
export interface Intent {
  memberId: Id; planId: Id; planVersion: number; constraintRevision: number;
  value: IntentValue; source: 'organizer' | 'feedback' | 'demo'; recordedAt: string;
}
export interface Confirmation { planId: Id; planVersion: number; constraintRevision: number; confirmedAt: string }
export interface Activity {
  id: Id; date: DateOnly; startTime: string | null; endTime: string | null; title: string;
  category: string; budgetBucket: 'activities' | 'included'; perPersonEstimate: Cents | null; note: string; order: number;
}
export interface Expense {
  id: Id; title: string; date: DateOnly; category: string; amount: Cents; payerId: Id;
  splitMode: 'equal' | 'custom'; allocations: { memberId: Id; amount: Cents }[]; createdAt: string;
}
export interface Settlement {
  id: Id; commandId: Id; fromId: Id; toId: Id; amount: Cents; recordedAt: string; voidedAt: string | null;
}
export interface InvitationRecord {
  id: Id; memberId: Id; constraintRevision: number; planVersions: Record<Id, number>; createdAt: string;
}
export interface Trip {
  schemaVersion: 1; id: Id; name: string; revision: number; constraintRevision: number;
  searchWindow: Range; duration: Duration; members: Member[]; plans: Plan[]; intents: Intent[];
  confirmation: Confirmation | null;
  itinerary: { sourcePlanId: Id | null; sourcePlanVersion: number | null; dateRange: Range | null; activities: Activity[] };
  expenses: Expense[]; settlements: Settlement[]; invitations: InvitationRecord[];
  appliedResponses: { id: Id; invitationId: Id; appliedAt: string }[];
  appliedCommandIds: Id[]; isDemo: boolean; createdAt: string; updatedAt: string;
}
