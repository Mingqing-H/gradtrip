import type { ComponentType } from 'react';
import type { Command, CommandContext, CommandPayload, ResponseInput } from '../domain/commands';
import type { Activity, Cents, DateOnly, Id, Member, Plan, Range, Trip } from '../domain/types';
import type { BusinessError, Result } from './result';
export type { Trip, Member, Plan, Activity, Expense, Settlement, Range, Id, Cents, DateOnly } from '../domain/types';
export type { Command, CommandPayload, CommandContext, PlanningCommand, ItineraryLedgerCommand, SharingCommand } from '../domain/commands';
export type { Result, BusinessError } from './result';
export type Workspace = 'squad' | 'plans' | 'itinerary' | 'ledger';
export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'conflict' | 'memoryOnly';
export interface WorkspaceProps {
  trip: Trip; execute: (payload: CommandPayload) => Promise<Result<Trip>>; saveStatus: SaveStatus;
  openInvite: (memberId: Id) => void; openImport: () => void; openShare: (planId?: Id) => void;
  services: DomainDependencies;
}
export interface TemplateActivity {
  key: string; dayOffset: number; title: string; category: string; startTime: string | null;
  endTime: string | null; budgetBucket: Activity['budgetBucket']; perPersonEstimate: Cents | null; note: string;
}
export interface DestinationTemplate {
  id: Id; version: number; name: string; tags: string[]; supportedDays: (2 | 3 | 4 | 5)[];
  estimate: Omit<Plan['estimate'], 'transportByMember'>; activities: TemplateActivity[]; assetId: string;
}
export interface MemberPlanEvaluation {
  memberId: Id; total: Cents | null; timeFits: boolean | null; budgetFits: boolean | null; reasons: string[];
}
export interface PlanEvaluation {
  planId: Id; members: MemberPlanEvaluation[]; feasible: boolean; timeMatchCount: number;
  budgetMatchCount: number; incompleteCount: number; minEstimate: Cents | null; maxEstimate: Cents | null;
}
export interface ConsensusStatus { canConfirm: boolean; reasons: string[]; confirmed: boolean }
export interface PersonalPlanInput { member: Member; plan: Plan }
export interface PlanningService {
  getPlanEvaluations(trip: Trip): PlanEvaluation[];
  getConsensusStatus(trip: Trip, planId: Id, today: DateOnly): ConsensusStatus;
  findCommonDepartures(members: Member[], window: Range, days: number): DateOnly[];
  updateMemberConstraints(trip: Trip, memberId: Id, changes: Partial<Omit<Member, 'id'>>): Result<Trip>;
  evaluatePersonalPlan(input: PersonalPlanInput): MemberPlanEvaluation;
  getTemplate(destinationId: Id, version: number): Result<DestinationTemplate>;
}
export type TemplateItineraryBuilder = (input: {
  plan: Plan; template: DestinationTemplate; ids: readonly Id[];
}) => Result<Trip['itinerary']>;
export interface DomainDependencies { planning: PlanningService; buildTemplateItinerary: TemplateItineraryBuilder; createDemo?: (input: { id: Id; today: DateOnly; now: string }) => Result<Trip> }
export type CommandHandler = (trip: Trip, payload: CommandPayload, context: CommandContext, dependencies: DomainDependencies) => Result<Trip>;
export type TripValidator = (trip: Trip) => BusinessError[];
export interface DomainModule { apply: CommandHandler; validate: TripValidator }
export interface RecoveryRecord { id: Id; tripId: Id; raw: string; createdAt: string }
export interface TripRecord { id: Id; name: string; revision: number; updatedAt: string; isDemo: boolean; error?: BusinessError }
export interface RepositorySettings { lastTripId?: Id; workspace?: Workspace; initialized: boolean }
export interface Repository {
  readonly mode: 'persistent' | 'memory';
  list(): Promise<Result<TripRecord[]>>;
  get(id: Id): Promise<Result<Trip>>;
  getRaw(id: Id): Promise<Result<string>>;
  create(trip: Trip): Promise<Result<Trip>>;
  execute(command: Command, context: CommandContext): Promise<Result<Trip>>;
  delete(id: Id, expectedRevision: number): Promise<Result<void>>;
  replace(input: { trip: Trip; expectedRevision: number; recoveryId: Id; now: string }): Promise<Result<Trip>>;
  listRecovery(tripId: Id): Promise<Result<RecoveryRecord[]>>;
  deleteRecovery(id: Id): Promise<Result<void>>;
  getSettings(): Promise<Result<RepositorySettings>>;
  setSettings(settings: RepositorySettings): Promise<Result<void>>;
  close(): void;
}
export type SharingPanel = { type: 'invite'; memberId: Id } | { type: 'share'; planId?: Id } | { type: 'import'; data?: string } | { type: 'backup' } | { type: 'recovery' };
export interface SharingApplicationDependencies {
  repository: Repository; planning: PlanningService;
  execute: (payload: CommandPayload) => Promise<Result<Trip>>;
  now: () => string; today: () => DateOnly; createId: () => Id; baseUrl: string;
}
export interface SharingPanelProps {
  trip: Trip | null; panel: SharingPanel; onClose: () => void; repository: Repository;
  services: SharingApplicationDependencies; onApplied: (trip: Trip) => void;
}
export interface ExternalPageProps {
  data: string | null; repository: Repository; services: SharingApplicationDependencies;
  openImport: (data?: string) => void;
}
export interface SharingService {
  registerInvitation(memberId: Id): Promise<Result<string>>;
  applyResponse(response: ResponseInput): Promise<Result<Trip>>;
}
export interface FeatureExports {
  SquadPage?: ComponentType<WorkspaceProps>; PlansPage?: ComponentType<WorkspaceProps>;
  ItineraryPage?: ComponentType<WorkspaceProps>; LedgerPage?: ComponentType<WorkspaceProps>;
  SnapshotPage?: ComponentType<ExternalPageProps>; JoinPage?: ComponentType<ExternalPageProps>;
  ResponsePage?: ComponentType<ExternalPageProps>; SharingPanels?: ComponentType<SharingPanelProps>;
}
