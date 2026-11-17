/**
 * 日程命令 handler（BR-08、PRD F03）。
 *
 * 输入 Trip、领域命令与显式上下文，返回新 Trip 或结构化错误；
 * 不修改入参、不访问存储。首次生成与替换由 T02 确认流程通过
 * buildTemplateItinerary + itinerary.replaceFromTemplate 完成；
 * 重新确认默认保留日程，替换必须经 previewTemplateReplacement 展示影响后显式执行。
 */
import type { Activity, Trip } from '../types';
import { addDays, isValidDateOnly } from '../dates';
import {
  MAX_ACTIVITIES,
  NOTE_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  commandFail,
  commandOk,
  domainError,
  type CommandContext,
  type CommandResult,
  type DomainError,
} from '../ledger/errors';
import { isDateInRange, moveActivity, validateActivityTime, type MoveDirection } from './activity';
import {
  buildTemplateItinerary,
  type BudgetBucket,
  type ItineraryTemplate,
  type ItineraryDays,
} from './template';

/** 活动草稿：perPersonEstimate 为 null 表示待估算，与明确 0 区分。 */
export interface ActivityDraft {
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  category: string;
  budgetBucket: BudgetBucket;
  perPersonEstimate: number | null;
  note: string;
}

/** 首次草稿可同时绑定日程日期范围（仅当日程尚未绑定时生效，须在搜索窗口内）。 */
export interface DateRangeInput {
  start: string;
  end: string;
}

export type ItineraryCommand =
  | { type: 'itinerary.add'; commandId: string; activity: ActivityDraft; draftDateRange?: DateRangeInput }
  | { type: 'itinerary.update'; commandId: string; activityId: string; activity: ActivityDraft }
  | { type: 'itinerary.remove'; commandId: string; activityId: string }
  | { type: 'itinerary.move'; commandId: string; activityId: string; direction: MoveDirection }
  | {
      type: 'itinerary.replaceFromTemplate';
      commandId: string;
      planId: string;
      planVersion: number;
      template: ItineraryTemplate;
      startDate: string;
      days: ItineraryDays;
    };

function validateRange(range: DateRangeInput): DomainError | null {
  if (!isValidDateOnly(range.start) || !isValidDateOnly(range.end)) {
    return domainError('INVALID_DATE_RANGE', '日程范围的日期需为合法的 YYYY-MM-DD', 'draftDateRange');
  }
  if (range.start > range.end) {
    return domainError('INVALID_DATE_RANGE', '日程范围的开始日期不能晚于结束日期', 'draftDateRange');
  }
  return null;
}

/** 活动草稿校验：范围、时间、归属与金额规则；返回清洗后的草稿。 */
function validateActivityDraft(
  draft: ActivityDraft,
  range: DateRangeInput,
): { ok: true; cleaned: ActivityDraft } | { ok: false; error: DomainError } {
  const title = draft.title.trim();
  if (title.length < 1 || title.length > TITLE_MAX_LENGTH) {
    return { ok: false, error: domainError('INVALID_TITLE', `名称需为 1～${TITLE_MAX_LENGTH} 字`, 'title') };
  }
  const category = draft.category.trim();
  if (category.length < 1 || category.length > TITLE_MAX_LENGTH) {
    return { ok: false, error: domainError('INVALID_CATEGORY', `类别需为 1～${TITLE_MAX_LENGTH} 字`, 'category') };
  }
  if (!isValidDateOnly(draft.date) || !isDateInRange(draft.date, range)) {
    return {
      ok: false,
      error: domainError('DATE_OUT_OF_RANGE', '活动日期需在日程绑定的日期范围内', 'date'),
    };
  }
  const timeError = validateActivityTime(draft.startTime, draft.endTime);
  if (timeError !== null) return { ok: false, error: timeError };
  if (draft.note.length > NOTE_MAX_LENGTH) {
    return { ok: false, error: domainError('INVALID_NOTE', `备注最多 ${NOTE_MAX_LENGTH} 字`, 'note') };
  }
  if (draft.budgetBucket === 'included') {
    if (draft.perPersonEstimate !== null) {
      return {
        ok: false,
        error: domainError('INVALID_ESTIMATE', '已含于方案费用的条目不能填写人均支出', 'perPersonEstimate'),
      };
    }
  } else if (draft.perPersonEstimate !== null) {
    if (!Number.isSafeInteger(draft.perPersonEstimate) || draft.perPersonEstimate < 0) {
      return {
        ok: false,
        error: domainError('INVALID_ESTIMATE', '人均预计支出需为非负整数分；待估算请留空', 'perPersonEstimate'),
      };
    }
    if (draft.perPersonEstimate > 10_000_000) {
      return { ok: false, error: domainError('INVALID_ESTIMATE', '人均预计支出不能超过 ¥100,000', 'perPersonEstimate') };
    }
  }
  return {
    ok: true,
    cleaned: { ...draft, title, category, note: draft.note.trim() },
  };
}

function nextOrder(trip: Trip): number {
  let max = -1;
  for (const activity of trip.itinerary.activities) {
    if (activity.order > max) max = activity.order;
  }
  return max + 1;
}

/**
 * 应用日程命令，返回新 Trip。失败时入参 Trip 不被修改。
 * itinerary.* 之外的命令类型返回 INVALID_COMMAND。
 */
export function applyItineraryCommand(
  trip: Trip,
  command: ItineraryCommand,
  ctx: CommandContext,
): CommandResult<Trip> {
  switch (command.type) {
    case 'itinerary.add':
      return addActivity(trip, command, ctx);
    case 'itinerary.update':
      return updateActivity(trip, command);
    case 'itinerary.remove':
      return removeActivity(trip, command);
    case 'itinerary.move':
      return moveActivityCommand(trip, command);
    case 'itinerary.replaceFromTemplate':
      return replaceFromTemplate(trip, command, ctx);
    default:
      return commandFail('INVALID_COMMAND', `未知的日程命令：${String((command as { type: string }).type)}`);
  }
}

function addActivity(
  trip: Trip,
  command: { activity: ActivityDraft; draftDateRange?: DateRangeInput },
  ctx: CommandContext,
): CommandResult<Trip> {
  if (trip.itinerary.activities.length >= MAX_ACTIVITIES) {
    return commandFail('LIMIT_ACTIVITIES', `每旅行最多 ${MAX_ACTIVITIES} 条日程安排，请先整理`);
  }
  let itinerary = trip.itinerary;
  let range = itinerary.dateRange;
  if (range === null) {
    // 未确认也无草稿范围：先绑定允许范围，不能保存无法解释的活动日期（BR-08）。
    if (command.draftDateRange === undefined) {
      return commandFail(
        'NEED_DATE_RANGE',
        '日程尚未绑定日期范围，请先选择搜索窗口内的日程日期范围',
        'draftDateRange',
      );
    }
    const rangeError = validateRange(command.draftDateRange);
    if (rangeError !== null) return { ok: false, error: rangeError };
    if (
      command.draftDateRange.start < trip.searchWindow.start ||
      command.draftDateRange.end > trip.searchWindow.end
    ) {
      return commandFail(
        'DATE_OUT_OF_RANGE',
        '日程日期范围需在旅行搜索窗口内',
        'draftDateRange',
      );
    }
    range = command.draftDateRange;
    itinerary = { ...itinerary, dateRange: range };
  }
  const validated = validateActivityDraft(command.activity, range);
  if (!validated.ok) return { ok: false, error: validated.error };
  const activity: Activity = {
    id: ctx.allocateId('activity'),
    ...validated.cleaned,
    order: nextOrder(trip),
  };
  return commandOk({
    ...trip,
    itinerary: { ...itinerary, activities: [...itinerary.activities, activity] },
  });
}

function updateActivity(
  trip: Trip,
  command: { activityId: string; activity: ActivityDraft },
): CommandResult<Trip> {
  const index = trip.itinerary.activities.findIndex((item) => item.id === command.activityId);
  if (index === -1) {
    return commandFail('ACTIVITY_NOT_FOUND', '要修改的日程安排不存在', 'activityId');
  }
  const range = trip.itinerary.dateRange;
  if (range === null) {
    return commandFail('NEED_DATE_RANGE', '日程日期范围缺失，无法修改活动', 'date');
  }
  const validated = validateActivityDraft(command.activity, range);
  if (!validated.ok) return { ok: false, error: validated.error };
  const previous = trip.itinerary.activities[index] as Activity;
  const next: Activity = { ...previous, ...validated.cleaned };
  const activities = [...trip.itinerary.activities];
  activities.splice(index, 1, next);
  return commandOk({ ...trip, itinerary: { ...trip.itinerary, activities } });
}

function removeActivity(
  trip: Trip,
  command: { activityId: string },
): CommandResult<Trip> {
  const index = trip.itinerary.activities.findIndex((item) => item.id === command.activityId);
  if (index === -1) {
    return commandFail('ACTIVITY_NOT_FOUND', '要删除的日程安排不存在', 'activityId');
  }
  const activities = [...trip.itinerary.activities];
  activities.splice(index, 1);
  return commandOk({ ...trip, itinerary: { ...trip.itinerary, activities } });
}

function moveActivityCommand(
  trip: Trip,
  command: { activityId: string; direction: MoveDirection },
): CommandResult<Trip> {
  const result = moveActivity(trip.itinerary.activities, command.activityId, command.direction);
  if (!result.ok) return { ok: false, error: result.error };
  return commandOk({ ...trip, itinerary: { ...trip.itinerary, activities: result.activities } });
}

function replaceFromTemplate(
  trip: Trip,
  command: {
    planId: string;
    planVersion: number;
    template: ItineraryTemplate;
    startDate: string;
    days: ItineraryDays;
  },
  ctx: CommandContext,
): CommandResult<Trip> {
  const plan = trip.plans.find((candidate) => candidate.id === command.planId);
  if (plan === undefined) {
    return commandFail('PLAN_NOT_FOUND', '要应用的方案不存在', 'planId');
  }
  if (plan.version !== command.planVersion) {
    return commandFail('PLAN_NOT_FOUND', '方案版本不一致，请刷新后重试', 'planVersion');
  }
  const built = buildTemplateItinerary({
    template: command.template,
    startDate: command.startDate,
    days: command.days,
    allocateId: ctx.allocateId,
  });
  if (!built.ok) {
    return commandFail('TEMPLATE_INVALID', built.errors[0]?.message ?? '模板日程无效');
  }
  // 范围以方案日期为准（出发日 + days - 1），与 rebindItineraryToPlan 一致
  const dateRange = { start: command.startDate, end: addDays(command.startDate, command.days - 1) };
  return commandOk({
    ...trip,
    itinerary: {
      sourcePlanId: command.planId,
      sourcePlanVersion: command.planVersion,
      dateRange,
      activities: built.activities,
    },
  });
}
