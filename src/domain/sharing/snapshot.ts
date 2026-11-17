/**
 * 计划快照（BR-13 / P05）：
 * - 只公开所选方案的公开内容：名称、日期、公共估算、无备注日程、生成时确认状态。
 * - 日程超出该方案日期范围时阻止生成，并返回越界条目定位（BR-08/BR-13）。
 * - 另存为我的旅行：生成全新 tripId 与实体 ID，不继承确认、意向、邀请或账本（BR-15）。
 */
import { addDays } from '../dates';
import { sharingError } from './types';
import type {
  PublicActivity,
  SharingEnvelope,
  SharingPlanning,
  SharingResult,
  SnapshotBody,
  Trip,
} from './types';
import { snapshotBodySchema } from './schema';

export interface BuildSnapshotOptions {
  /** 指定分享的方案；缺省为当前确认方案，无确认时报错。 */
  planId?: string;
  payloadId: string;
  now: string;
  /** 共识状态按数据重新求值（BR-07），由 T02 服务计算。 */
  today: string;
  planning: SharingPlanning;
}

export interface OutOfRangeActivityRef {
  id: string;
  title: string;
  date: string;
}

function toPublicActivity(activity: Trip['itinerary']['activities'][number]): PublicActivity {
  // 白名单转换：刻意丢掉 note（BR-13 排除备注）。
  return {
    id: activity.id,
    date: activity.date,
    startTime: activity.startTime,
    endTime: activity.endTime,
    title: activity.title,
    category: activity.category,
    budgetBucket: activity.budgetBucket,
    perPersonEstimate: activity.perPersonEstimate,
    order: activity.order,
  };
}

function destinationDisplay(
  planning: SharingPlanning,
  destinationId: string,
  templateVersion: number,
): { name: string; tags: string[] } {
  const template = planning.getTemplate(destinationId, templateVersion);
  if (template.ok) return { name: template.value.name, tags: template.value.tags };
  return { name: `目的地 ${destinationId}`, tags: [] };
}

export function buildPublicSnapshot(
  trip: Trip,
  options: BuildSnapshotOptions,
): SharingResult<SharingEnvelope<SnapshotBody>> {
  const { planning, now, payloadId, today } = options;
  const wantedPlanId = options.planId ?? trip.confirmation?.planId ?? null;
  if (wantedPlanId === null) {
    return { ok: false, error: sharingError('PLAN_NOT_FOUND', '旅行还没有可选方案，无法生成快照') };
  }
  const plan = trip.plans.find((item) => item.id === wantedPlanId);
  if (!plan) {
    return { ok: false, error: sharingError('PLAN_NOT_FOUND', '所选方案不存在，请重新选择') };
  }

  // 日程范围外条目阻止生成（BR-13：要求调整后才可导出，提供定位）。
  const planRange = { start: plan.startDate, end: addDays(plan.startDate, plan.days - 1) };
  const outOfRange: OutOfRangeActivityRef[] = trip.itinerary.activities
    .filter((activity) => activity.date < planRange.start || activity.date > planRange.end)
    .map((activity) => ({ id: activity.id, title: activity.title, date: activity.date }));
  if (outOfRange.length > 0) {
    return {
      ok: false,
      error: sharingError('ITINERARY_OUT_OF_RANGE', '日程超出所选方案日期，需先调整后再生成快照', {
        meta: { outOfRange, planRange },
      }),
    };
  }

  // 生成时刻的确认状态：仅当派生状态为已确认且确认记录指向当前方案版本时标记 confirmed。
  const consensus = planning.getConsensusStatus(trip, plan.id, today);
  const confirmed =
    consensus.confirmed &&
    trip.confirmation !== null &&
    trip.confirmation.planId === plan.id &&
    trip.confirmation.planVersion === plan.version;
  const confirmation: SnapshotBody['confirmation'] = {
    status: confirmed ? 'confirmed' : 'draft',
    planId: plan.id,
    planVersion: plan.version,
    constraintRevision: trip.constraintRevision,
    confirmedAt: confirmed && trip.confirmation ? trip.confirmation.confirmedAt : null,
  };

  // 公开估算总览：不含任何成员个人交通；日程差额按 BR-08 的 E'=E-A+S 逻辑展示 S 与 S-A。
  const basePerPerson =
    plan.estimate.lodgingPerNight * (plan.days - 1) +
    plan.estimate.foodPerDay * plan.days +
    plan.estimate.activities +
    plan.estimate.reserve;
  const budgetActivities = trip.itinerary.activities.filter(
    (activity) => activity.budgetBucket === 'activities',
  );
  const itineraryActivitiesCents = budgetActivities.reduce(
    (sum, activity) => sum + (activity.perPersonEstimate ?? 0),
    0,
  );
  const itineraryUnknownCount = budgetActivities.filter(
    (activity) => activity.perPersonEstimate === null,
  ).length;

  const destination = destinationDisplay(planning, plan.destinationId, plan.templateVersion);
  const body: SnapshotBody = {
    tripName: trip.name,
    plan: {
      id: plan.id,
      version: plan.version,
      templateVersion: plan.templateVersion,
      destinationId: plan.destinationId,
      destinationName: destination.name,
      destinationTags: destination.tags,
      startDate: plan.startDate,
      days: plan.days,
      estimateParams: {
        lodgingPerNight: plan.estimate.lodgingPerNight,
        foodPerDay: plan.estimate.foodPerDay,
        activities: plan.estimate.activities,
        reserve: plan.estimate.reserve,
      },
    },
    confirmation,
    estimateSummary: {
      basePerPersonCents: basePerPerson,
      itineraryActivitiesCents,
      itineraryUnknownCount,
      deltaCents: itineraryActivitiesCents - plan.estimate.activities,
    },
    itinerary:
      trip.itinerary.activities.length > 0
        ? {
            startDate: planRange.start,
            endDate: planRange.end,
            activities: trip.itinerary.activities.map(toPublicActivity),
          }
        : null,
  };

  return {
    ok: true,
    value: { schemaVersion: 1, type: 'snapshot', payloadId, createdAt: now, body },
  };
}

// ---------------------------------------------------------------------------
// 另存为我的旅行（BR-15：新 tripId、重映射实体 ID、不继承共识/邀请/账本）
// ---------------------------------------------------------------------------

export interface NewIdFactory {
  /** 为旧实体生成新 ID；kind 标注实体类别。 */
  nextId(kind: 'activity' | 'plan', oldId: string): string;
}

export interface SnapshotToTripOptions {
  newTripId: string;
  idFactory: NewIdFactory;
  now: string;
}

export function snapshotToNewTripDraft(
  envelope: SharingEnvelope<SnapshotBody>,
  options: SnapshotToTripOptions,
): SharingResult<Trip> {
  const parsed = snapshotBodySchema.safeParse(envelope.body);
  if (!parsed.success) {
    return {
      ok: false,
      error: sharingError('SCHEMA_INVALID', '快照内容不符合白名单', {
        fields: parsed.error.issues.map((issue) => ({
          field: `body.${issue.path.join('.')}`,
          message: issue.message,
        })),
      }),
    };
  }
  const body = parsed.data;
  const { newTripId, idFactory, now } = options;
  const newPlanId = idFactory.nextId('plan', body.plan.id);
  const endDate = addDays(body.plan.startDate, body.plan.days - 1);

  const trip: Trip = {
    schemaVersion: 1,
    id: newTripId,
    name: body.tripName,
    revision: 0,
    constraintRevision: 0,
    searchWindow: { start: body.plan.startDate, end: endDate },
    duration: body.plan.days,
    members: [],
    plans: [
      {
        id: newPlanId,
        version: 1,
        destinationId: body.plan.destinationId,
        templateVersion: body.plan.templateVersion,
        startDate: body.plan.startDate,
        days: body.plan.days,
        estimate: {
          transportByMember: {},
          lodgingPerNight: body.plan.estimateParams.lodgingPerNight,
          foodPerDay: body.plan.estimateParams.foodPerDay,
          activities: body.plan.estimateParams.activities,
          reserve: body.plan.estimateParams.reserve,
        },
      },
    ],
    intents: [],
    confirmation: null,
    itinerary: {
      sourcePlanId: newPlanId,
      sourcePlanVersion: 1,
      dateRange: { start: body.plan.startDate, end: endDate },
      activities: (body.itinerary?.activities ?? []).map((activity) => ({
        ...activity,
        note: '',
      })),
    },
    expenses: [],
    settlements: [],
    invitations: [],
    appliedResponses: [],
    appliedCommandIds: [],
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, value: trip };
}
