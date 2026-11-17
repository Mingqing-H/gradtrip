/** T03 领域测试共用夹具：最小合法 Trip 及实体构造器（按开发文档数据结构）。 */
import type {
  Activity,
  Expense,
  Member,
  Plan,
  Settlement,
  Trip,
} from '../../../src/domain/types';
import type { CommandContext } from '../../../src/domain/ledger/errors';

export const FIXED_NOW = '2026-07-01T10:00:00.000Z';

export function makeContext(now: string = FIXED_NOW): CommandContext {
  let counter = 0;
  return {
    now,
    allocateId: (prefix: string) => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}

export function makeMember(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    name: `成员${id}`,
    originCity: '北京',
    budgetCap: 200_000,
    availability: [{ start: '2026-07-10', end: '2026-07-20' }],
    preferences: [],
    ...overrides,
  };
}

export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    schemaVersion: 1,
    id: 'trip-1',
    name: '示例旅行',
    revision: 1,
    constraintRevision: 0,
    searchWindow: { start: '2026-07-01', end: '2026-09-30' },
    duration: 3,
    members: [makeMember('m-a'), makeMember('m-b'), makeMember('m-c')],
    plans: [],
    intents: [],
    confirmation: null,
    itinerary: {
      sourcePlanId: null,
      sourcePlanVersion: null,
      dateRange: null,
      activities: [],
    },
    expenses: [],
    settlements: [],
    invitations: [],
    appliedResponses: [],
    appliedCommandIds: [],
    isDemo: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeActivity(id: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id,
    date: '2026-07-10',
    startTime: null,
    endTime: null,
    title: `活动${id}`,
    category: '活动',
    budgetBucket: 'activities',
    perPersonEstimate: null,
    note: '',
    order: 0,
    ...overrides,
  };
}

export function makeExpense(id: string, overrides: Partial<Expense> = {}): Expense {
  return {
    id,
    title: `费用${id}`,
    date: '2026-07-10',
    category: '餐饮',
    amount: 10_000,
    payerId: 'm-a',
    splitMode: 'equal',
    allocations: [
      { memberId: 'm-a', amount: 3400 },
      { memberId: 'm-b', amount: 3300 },
      { memberId: 'm-c', amount: 3300 },
    ],
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeSettlement(id: string, overrides: Partial<Settlement> = {}): Settlement {
  return {
    id,
    commandId: `cmd-${id}`,
    fromId: 'm-c',
    toId: 'm-a',
    amount: 10_000,
    recordedAt: FIXED_NOW,
    voidedAt: null,
    ...overrides,
  };
}

export function makePlan(id: string, overrides: Partial<Plan> = {}): Plan {
  return {
    id,
    version: 1,
    destinationId: 'dest-1',
    templateVersion: 1,
    startDate: '2026-07-10',
    days: 3,
    estimate: {
      transportByMember: { 'm-a': null, 'm-b': null, 'm-c': null },
      lodgingPerNight: 20_000,
      foodPerDay: 10_000,
      activities: 30_000,
      reserve: 10_000,
    },
    ...overrides,
  };
}

/**
 * 业务规则 BR-12 验算用例：A 垫付 ¥300 三人均摊，
 * B 垫付 ¥90 且仅 A、B 参与 → 余额 A +155 / B -55 / C -100（单位：分 ×100）。
 */
export function makeCanonicalLedgerTrip(overrides: Partial<Trip> = {}): Trip {
  return makeTrip({
    expenses: [
      makeExpense('e-1', {
        title: '住宿',
        amount: 30_000,
        payerId: 'm-a',
        splitMode: 'equal',
        allocations: [
          { memberId: 'm-a', amount: 10_000 },
          { memberId: 'm-b', amount: 10_000 },
          { memberId: 'm-c', amount: 10_000 },
        ],
      }),
      makeExpense('e-2', {
        title: '餐费',
        amount: 9_000,
        payerId: 'm-b',
        splitMode: 'equal',
        allocations: [
          { memberId: 'm-a', amount: 4_500 },
          { memberId: 'm-b', amount: 4_500 },
        ],
      }),
    ],
    ...overrides,
  });
}
