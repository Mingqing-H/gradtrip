/**
 * T04 测试夹具：Trip 构造工厂与 PlanningService 替身。
 *
 * 替身按已发布文档规则实现（BR-01/BR-02/BR-07）：资料校验与归一化、
 * 相同值不增加 constraintRevision、约束变化使旧意向失效——
 * 生产实现由 T02 通过 B0 公共接口注入，此处仅为测试替身（gitworktree §4.3）。
 */
import type { Command } from '../../../src/domain/commands';
import type { PlanningService, DestinationTemplate } from '../../../src/contracts/services';
import { failure, success } from '../../../src/contracts/result';
import type {
  Activity,
  Confirmation,
  Expense,
  Intent,
  InvitationRecord,
  Member,
  Plan,
  Range,
  Settlement,
  Trip,
} from '../../../src/domain/types';
import { addDays, mergeRanges } from '../../../src/domain/dates';

const NOW = '2026-11-18T10:00:00.000Z';
const TODAY = '2026-11-18';

export function fixtureNow(): string {
  return NOW;
}

export function fixtureToday(): string {
  return TODAY;
}

export function nextIdFactory(prefix: string, start = 0) {
  let counter = start;
  return (kind: string) => `${prefix}_${kind}_${(counter += 1)}`;
}

// ---------------------------------------------------------------------------
// PlanningService 替身
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, DestinationTemplate> = {
  dest_qingdao: {
    id: 'dest_qingdao',
    version: 1,
    name: '青岛',
    tags: ['海边', '城市'],
    supportedDays: [2, 3, 4, 5],
    estimate: { lodgingPerNight: 200_00, foodPerDay: 120_00, activities: 90_00, reserve: 50_00 },
    activities: [],
    assetId: 'asset_qingdao',
  },
  dest_suzhou: {
    id: 'dest_suzhou',
    version: 1,
    name: '苏州',
    tags: ['人文', '自然'],
    supportedDays: [2, 3],
    estimate: { lodgingPerNight: 180_00, foodPerDay: 100_00, activities: 60_00, reserve: 40_00 },
    activities: [],
    assetId: 'asset_suzhou',
  },
};

function memberEquals(current: Member, next: Pick<Member, 'name' | 'originCity' | 'budgetCap' | 'availability' | 'preferences'>): boolean {
  const merged = mergeRanges(next.availability.map((range) => ({ ...range })));
  const currentMerged = mergeRanges(current.availability.map((range) => ({ ...range })));
  const sameRanges =
    currentMerged.length === merged.length &&
    currentMerged.every((range, index) => range.start === merged[index]?.start && range.end === merged[index]?.end);
  return (
    current.name.trim() === next.name.trim() &&
    current.originCity === (next.originCity ?? null) &&
    current.budgetCap === next.budgetCap &&
    sameRanges &&
    [...new Set(current.preferences.map((t) => t.trim()))].join('\u0000') ===
      [...new Set(next.preferences.map((t) => t.trim()))].join('\u0000')
  );
}

/** T02 辅助函数替身：校验资料；相同值不增加版本（BR-02），变化则 constraintRevision+1。 */
export const fixturePlanning: PlanningService = {
  getPlanEvaluations: () => [],
  getConsensusStatus: (trip: Trip, planId: string) => {
    const confirmation = trip.confirmation;
    if (!confirmation || confirmation.planId !== planId) {
      return { canConfirm: false, confirmed: false, reasons: ['尚未确认该方案'] };
    }
    const plan = trip.plans.find((item) => item.id === planId);
    if (!plan || plan.version !== confirmation.planVersion || confirmation.constraintRevision !== trip.constraintRevision) {
      return { canConfirm: false, confirmed: false, reasons: ['确认已失效，需重新确认'] };
    }
    const missing = trip.members
      .map((member) =>
        trip.intents.find(
          (intent) =>
            intent.memberId === member.id &&
            intent.planId === planId &&
            intent.planVersion === plan.version &&
            intent.constraintRevision === trip.constraintRevision,
        )?.value,
      )
      .filter((value) => value !== 'approve' && value !== 'acceptable');
    if (missing.length > 0) {
      return { canConfirm: false, confirmed: false, reasons: ['存在未赞成或未反馈的成员'] };
    }
    return { canConfirm: true, confirmed: true, reasons: [] };
  },
  findCommonDepartures: () => [],
  updateMemberConstraints: (trip: Trip, memberId: string, changes: Partial<Omit<Member, 'id'>>) => {
    const member = trip.members.find((item) => item.id === memberId);
    if (!member) return failure('NOT_FOUND', '成员不存在');
    const name = (changes.name ?? member.name).trim();
    if (name.length < 1 || name.length > 20) {
      return failure('VALIDATION', '成员资料不合法', { 'member.name': '昵称需为 1～20 字' });
    }
    if (changes.budgetCap !== undefined && changes.budgetCap !== null && (changes.budgetCap < 0 || changes.budgetCap > 10_000_000)) {
      return failure('VALIDATION', '成员资料不合法', { 'member.budgetCap': '预算需为 0～¥100,000' });
    }
    if (changes.availability !== undefined && changes.availability.length > 5) {
      return failure('VALIDATION', '成员资料不合法', { 'member.availability': '最多 5 段可用日期' });
    }
    const nextMember: Member = {
      ...member,
      ...(changes.name !== undefined ? { name } : {}),
      ...(changes.originCity !== undefined ? { originCity: changes.originCity } : {}),
      ...(changes.budgetCap !== undefined ? { budgetCap: changes.budgetCap } : {}),
      ...(changes.availability !== undefined
        ? { availability: mergeRanges(changes.availability.map((range) => ({ ...range }))) }
        : {}),
      ...(changes.preferences !== undefined ? { preferences: [...changes.preferences] } : {}),
    };
    if (memberEquals(member, nextMember)) return success(trip);
    return success({
      ...trip,
      constraintRevision: trip.constraintRevision + 1,
      members: trip.members.map((item) => (item.id === memberId ? nextMember : item)),
      // 旧意向保留为历史（版本绑定使其自动失效），不复制为当前版本。
    });
  },
  evaluatePersonalPlan: () => ({ memberId: 'fixture', total: null, timeFits: null, budgetFits: null, reasons: [] }),
  getTemplate: (destinationId: string, version: number) => {
    const template = TEMPLATES[destinationId];
    if (!template || template.version !== version) return failure('NOT_FOUND', '未知模板版本');
    return success(template);
  },
};

export { TEMPLATES as FIXTURE_TEMPLATES };

// ---------------------------------------------------------------------------
// Trip 工厂
// ---------------------------------------------------------------------------

export function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm_lin',
    name: '林知夏',
    originCity: '上海',
    budgetCap: 150_000,
    availability: [{ start: '2027-07-01', end: '2027-07-10' }],
    preferences: ['海边'],
    ...overrides,
  };
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'p_qingdao',
    version: 1,
    destinationId: 'dest_qingdao',
    templateVersion: 1,
    startDate: '2027-07-03',
    days: 3,
    estimate: {
      transportByMember: { m_lin: { originCity: '上海', amount: 56_000 } },
      lodgingPerNight: 200_00,
      foodPerDay: 120_00,
      activities: 90_00,
      reserve: 50_00,
    },
    ...overrides,
  };
}

export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'a_1',
    date: '2027-07-03',
    startTime: '09:30',
    endTime: '11:00',
    title: '抵达与集合',
    category: '交通',
    budgetBucket: 'included',
    perPersonEstimate: null,
    note: '私人备注不应分享',
    order: 0,
    ...overrides,
  };
}

export function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e_1',
    title: '住宿',
    date: '2027-07-03',
    category: '住宿',
    amount: 30_000,
    payerId: 'm_lin',
    splitMode: 'equal',
    allocations: [
      { memberId: 'm_lin', amount: 10_000 },
      { memberId: 'm_chen', amount: 10_000 },
      { memberId: 'm_zhou', amount: 10_000 },
    ],
    createdAt: NOW,
    ...overrides,
  };
}

export function makeSettlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 's_1',
    commandId: 'cmd_1',
    fromId: 'm_chen',
    toId: 'm_lin',
    amount: 5_500,
    recordedAt: NOW,
    voidedAt: null,
    ...overrides,
  };
}

export function makeIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    memberId: 'm_lin',
    planId: 'p_qingdao',
    planVersion: 1,
    constraintRevision: 2,
    value: 'approve',
    source: 'organizer',
    recordedAt: NOW,
    ...overrides,
  };
}

export function makeInvitation(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: 'inv_1',
    memberId: 'm_zhou',
    constraintRevision: 2,
    planVersions: { p_qingdao: 1, p_suzhou: 1 },
    createdAt: NOW,
    ...overrides,
  };
}

export interface TripOverrides {
  confirmation?: Confirmation | null;
  intents?: Intent[];
  invitations?: InvitationRecord[];
  appliedResponses?: Trip['appliedResponses'];
  activities?: Activity[];
  expenses?: Expense[];
  settlements?: Settlement[];
  members?: Member[];
  plans?: Plan[];
  constraintRevision?: number;
}

/** 基准旅行：3 名成员、青岛/苏州两个候选、目标成员 m_zhou 已登记邀请 inv_1。 */
export function makeTrip(overrides: TripOverrides = {}): Trip {
  const plan = makePlan();
  const plan2 = makePlan({
    id: 'p_suzhou',
    destinationId: 'dest_suzhou',
    startDate: '2027-07-03',
    days: 2,
    estimate: {
      transportByMember: {},
      lodgingPerNight: 180_00,
      foodPerDay: 100_00,
      activities: 60_00,
      reserve: 40_00,
    },
  });
  return {
    schemaVersion: 1,
    id: 'trip_1',
    name: '毕业旅行',
    revision: 7,
    constraintRevision: overrides.constraintRevision ?? 2,
    searchWindow: { start: '2027-06-01', end: '2027-08-31' },
    duration: 3,
    members:
      overrides.members ??
      [
        makeMember(),
        makeMember({ id: 'm_chen', name: '陈亦舟', originCity: '杭州', budgetCap: 180_000, preferences: ['人文'] }),
        makeMember({ id: 'm_zhou', name: '周予安', originCity: '南京', budgetCap: null, preferences: [] }),
      ],
    plans: overrides.plans ?? [plan, plan2],
    intents: overrides.intents ?? [],
    confirmation: overrides.confirmation ?? null,
    itinerary: {
      sourcePlanId: plan.id,
      sourcePlanVersion: 1,
      dateRange: { start: '2027-07-03', end: '2027-07-05' },
      activities:
        overrides.activities ??
        [
          makeActivity(),
          makeActivity({
            id: 'a_2',
            date: '2027-07-04',
            startTime: null,
            endTime: null,
            title: '沿海散步',
            category: '活动',
            budgetBucket: 'activities',
            perPersonEstimate: 4_500,
            order: 1,
          }),
        ],
    },
    expenses: overrides.expenses ?? [],
    settlements: overrides.settlements ?? [],
    invitations: overrides.invitations ?? [makeInvitation()],
    appliedResponses: overrides.appliedResponses ?? [],
    appliedCommandIds: [],
    isDemo: false,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: NOW,
  };
}

/** 已确认旅行的常见形态：全员赞成当前方案并确认。 */
export function makeConfirmedTrip(): Trip {
  const base = makeTrip({
    intents: [
      makeIntent({ memberId: 'm_lin', value: 'approve' }),
      makeIntent({ memberId: 'm_chen', value: 'acceptable' }),
      makeIntent({ memberId: 'm_zhou', value: 'approve' }),
    ],
  });
  return {
    ...base,
    confirmation: {
      planId: 'p_qingdao',
      planVersion: 1,
      constraintRevision: base.constraintRevision,
      confirmedAt: NOW,
    },
  };
}

export function makeCommand(commandId: string, payload: Command['payload'], trip: Trip): Command {
  return { commandId, tripId: trip.id, expectedRevision: trip.revision, payload };
}

export { addDays };
export type { Range };
