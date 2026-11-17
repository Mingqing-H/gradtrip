// T02 规划域测试夹具：最小可用的成员/方案/旅行构造器与依赖替身。
// 不依赖 T01 的 tests/helpers（该目录属 T01 所有）。

import type { Id, Member, Plan, Trip } from '../../../src/domain/planning/contract';
import type { PlanningCommandContext } from '../../../src/domain/planning/commands';
import type { DestinationInfo, PlanningDeps } from '../../../src/domain/planning/types';

export const T0 = '2026-07-01'; // 固定“今天”，与真实时钟无关

export interface MemberSeed {
  id?: Id;
  name?: string;
  originCity?: string | null;
  budgetCap?: number | null;
  availability?: { start: string; end: string }[];
  preferences?: string[];
}

export function makeMember(seed: MemberSeed = {}): Member {
  return {
    id: seed.id ?? 'm1',
    name: seed.name ?? '测试成员',
    originCity: seed.originCity ?? '上海',
    budgetCap: seed.budgetCap === undefined ? 150000 : seed.budgetCap,
    availability: seed.availability ?? [{ start: '2026-07-10', end: '2026-07-31' }],
    preferences: seed.preferences ?? [],
  };
}

export interface PlanSeed {
  id?: Id;
  version?: number;
  destinationId?: Id;
  templateVersion?: number;
  startDate?: string;
  days?: Plan['days'];
  estimate?: Partial<Plan['estimate']>;
}

export function makePlan(seed: PlanSeed = {}): Plan {
  return {
    id: seed.id ?? 'p1',
    version: seed.version ?? 1,
    destinationId: seed.destinationId ?? 'dest-sea',
    templateVersion: seed.templateVersion ?? 1,
    startDate: seed.startDate ?? '2026-07-15',
    days: seed.days ?? 3,
    estimate: {
      transportByMember: {},
      lodgingPerNight: 22000,
      foodPerDay: 9000,
      activities: 18000,
      reserve: 6000,
      ...seed.estimate,
    },
  };
}

export interface TripSeed {
  id?: Id;
  name?: string;
  revision?: number;
  constraintRevision?: number;
  searchWindow?: Trip['searchWindow'];
  duration?: Trip['duration'];
  members?: Member[];
  plans?: Plan[];
  intents?: Trip['intents'];
  confirmation?: Trip['confirmation'];
  itinerary?: Trip['itinerary'];
  expenses?: Trip['expenses'];
  settlements?: Trip['settlements'];
}

export function makeTrip(seed: TripSeed = {}): Trip {
  return {
    schemaVersion: 1,
    id: seed.id ?? 'trip-1',
    name: seed.name ?? '测试旅行',
    revision: seed.revision ?? 1,
    constraintRevision: seed.constraintRevision ?? 1,
    searchWindow: seed.searchWindow ?? { start: '2026-07-01', end: '2026-07-30' },
    duration: seed.duration ?? 3,
    members: seed.members ?? [makeMember()],
    plans: seed.plans ?? [],
    intents: seed.intents ?? [],
    confirmation: seed.confirmation ?? null,
    itinerary: seed.itinerary ?? {
      sourcePlanId: null,
      sourcePlanVersion: null,
      dateRange: null,
      activities: [],
    },
    expenses: seed.expenses ?? [],
    settlements: seed.settlements ?? [],
    invitations: [],
    appliedResponses: [],
    appliedCommandIds: [],
    isDemo: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...seed,
  } as Trip;
}

export const fixtureDestinations: Record<Id, DestinationInfo> = {
  'dest-sea': {
    id: 'dest-sea',
    name: '海滨城市',
    tags: ['海边'],
    supportedDurations: [2, 3, 4, 5],
    estimate: { lodgingPerNight: 22000, foodPerDay: 9000, activities: 18000, reserve: 6000 },
  },
  'dest-culture': {
    id: 'dest-culture',
    name: '园林城市',
    tags: ['人文'],
    supportedDurations: [2, 3, 4],
    estimate: { lodgingPerNight: 20000, foodPerDay: 8000, activities: 15000, reserve: 5000 },
  },
};

const fixtureTransportTable: Record<string, number> = {
  '1|上海|dest-sea': 49000,
  '1|上海|dest-culture': 12000,
  '1|杭州|dest-sea': 56000,
  '1|杭州|dest-culture': 15000,
  '1|南京|dest-sea': 52000,
};

/** 测试用规划依赖：固定目的地与交通表，未知城市/模板返回 undefined。 */
export const fixtureDeps: PlanningDeps = {
  resolveDestination: (templateVersion, destinationId) =>
    templateVersion === 1 ? fixtureDestinations[destinationId] : undefined,
  resolveTransport: (templateVersion, originCity, destinationId) =>
    fixtureTransportTable[`${templateVersion}|${originCity}|${destinationId}`],
};

/** 上海 → dest-sea、D=3 的基准估算（分）：H×2 + F×3 + A + R + T = 144000。 */
export const SEA_FROM_SHANGHAI_E = 22000 * 2 + 9000 * 3 + 18000 + 6000 + 49000;

/** 顺序 ID 生成器：测试中确定性分配。 */
export function idSeq(prefix: string): () => string {
  let seq = 0;
  return () => `${prefix}-${(seq += 1)}`;
}

/** 默认命令上下文；today 固定为 T0，不读系统时钟。 */
export function makeCtx(overrides: Partial<PlanningCommandContext> = {}): PlanningCommandContext {
  return {
    now: '2026-07-01T08:00:00.000Z',
    today: T0,
    newId: idSeq('id'),
    currentTemplateVersion: 1,
    deps: fixtureDeps,
    ...overrides,
  };
}
