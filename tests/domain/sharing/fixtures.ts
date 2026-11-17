/**
 * T04 测试夹具：Trip 构造工厂与 SharingDeps 替身。
 *
 * 替身按已发布文档规则实现（BR-01/BR-02/BR-07）：
 * 资料校验与归一化、相同值不算变化、约束变化使旧意向失效——
 * 生产实现由 T02 通过 B0 公共接口注入，此处仅为测试替身（gitworktree §4.3）。
 */
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
import { addDays } from '../../../src/domain/sharing/calendar';
import type {
  MemberProfileInput,
  NormalizedMemberProfile,
  SharingDeps,
  SharingResult,
} from '../../../src/domain/sharing/types';
import { sharingError } from '../../../src/domain/sharing/types';

export const DESTINATIONS: Record<string, { name: string; tags: string[] }> = {
  dest_qingdao: { name: '青岛', tags: ['海边', '城市'] },
  dest_suzhou: { name: '苏州', tags: ['人文', '自然'] },
};

const NOW = '2026-11-18T10:00:00.000Z';

export function fixtureNow(): string {
  return NOW;
}

export function nextIdFactory(prefix: string, start = 0) {
  let counter = start;
  return (kind: string, _oldId?: string) => `${prefix}_${kind}_${(counter += 1)}`;
}

// ---------------------------------------------------------------------------
// 日期区间归一（BR-01：重叠或相邻合并）
// ---------------------------------------------------------------------------

export function normalizeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= addDays(last.end, 1)) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// SharingDeps 替身
// ---------------------------------------------------------------------------

export function validateProfileFixture(profile: MemberProfileInput): SharingResult<NormalizedMemberProfile> {
  const fields: Array<{ field: string; message: string }> = [];
  const name = profile.name.trim();
  if (name.length < 1 || name.length > 20) fields.push({ field: 'profile.name', message: '昵称需为 1～20 字' });
  if (profile.originCity !== null && profile.originCity.trim().length < 1) {
    fields.push({ field: 'profile.originCity', message: '城市不能为空白' });
  }
  if (profile.budgetCap !== null && (profile.budgetCap < 0 || profile.budgetCap > 10_000_000 || !Number.isInteger(profile.budgetCap))) {
    fields.push({ field: 'profile.budgetCap', message: '预算需为 0～¥100,000 的整数分' });
  }
  if (profile.availability.length > 5) {
    fields.push({ field: 'profile.availability', message: '最多 5 段可用日期' });
  }
  for (const range of profile.availability) {
    if (range.start > range.end) fields.push({ field: 'profile.availability', message: '起日不得晚于止日' });
  }
  if (fields.length > 0) {
    return { ok: false, error: sharingError('PROFILE_INVALID', '成员资料不合法', { fields }) };
  }
  return {
    ok: true,
    value: {
      name,
      originCity: profile.originCity === null ? null : profile.originCity.trim(),
      budgetCap: profile.budgetCap,
      availability: normalizeRanges(profile.availability),
      preferences: [...new Set(profile.preferences.map((tag) => tag.trim()))],
    },
  };
}

export function profileChangedFixture(member: Member, profile: NormalizedMemberProfile): boolean {
  const sameRanges =
    member.availability.length === profile.availability.length &&
    member.availability.every(
      (range, index) =>
        range.start === profile.availability[index]!.start && range.end === profile.availability[index]!.end,
    );
  return (
    member.name !== profile.name ||
    member.originCity !== profile.originCity ||
    member.budgetCap !== profile.budgetCap ||
    !sameRanges ||
    member.preferences.join('\u0000') !== profile.preferences.join('\u0000')
  );
}

/** T02 辅助函数替身：更新资料、constraintRevision+1；旧意向按版本绑定自动失效。 */
export function applyProfileChangeFixture(trip: Trip, memberId: string, profile: NormalizedMemberProfile): Trip {
  return {
    ...trip,
    constraintRevision: trip.constraintRevision + 1,
    members: trip.members.map((member) =>
      member.id === memberId
        ? {
            ...member,
            name: profile.name,
            originCity: profile.originCity,
            budgetCap: profile.budgetCap,
            availability: profile.availability.map((range) => ({ ...range })),
            preferences: [...profile.preferences],
          }
        : member,
    ),
  };
}

export function confirmationStatusFixture(trip: Trip): 'preparing' | 'confirmed' | 'stale' {
  const confirmation = trip.confirmation;
  if (!confirmation) return 'preparing';
  const plan = trip.plans.find((item) => item.id === confirmation.planId);
  if (!plan || plan.version !== confirmation.planVersion) return 'stale';
  if (confirmation.constraintRevision !== trip.constraintRevision) return 'stale';
  const currentValues = trip.members.map((member) =>
    trip.intents.find(
      (intent) =>
        intent.memberId === member.id &&
        intent.planId === confirmation.planId &&
        intent.planVersion === confirmation.planVersion &&
        intent.constraintRevision === trip.constraintRevision,
    )?.value,
  );
  if (currentValues.some((value) => value !== 'approve' && value !== 'acceptable')) return 'stale';
  return 'confirmed';
}

export const fixtureDeps: SharingDeps = {
  destinationInfo: (destinationId) => DESTINATIONS[destinationId] ?? null,
  confirmationStatus: confirmationStatusFixture,
  validateProfile: validateProfileFixture,
  profileChanged: profileChangedFixture,
  applyProfileChange: applyProfileChangeFixture,
};

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
    planVersions: { p_qingdao: 1 },
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

/** 基准旅行：3 名成员、青岛/苏州两个候选、已登记邀请，默认未确认。 */
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
    invitations: overrides.invitations ?? [],
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

export function makeInvitationEnvelopeFromTrip(trip: Trip, memberId: string, payloadId = 'inv_1') {
  const planVersions: Record<string, number> = {};
  for (const plan of trip.plans) planVersions[plan.id] = plan.version;
  const invitation: InvitationRecord = {
    id: payloadId,
    memberId,
    constraintRevision: trip.constraintRevision,
    planVersions,
    createdAt: NOW,
  };
  return { trip: { ...trip, invitations: [...trip.invitations, invitation] }, invitation };
}
