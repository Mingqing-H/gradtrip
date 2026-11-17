/**
 * 模板日程构建与日程绑定（BR-08、PRD F03）。
 *
 * buildTemplateItinerary 是提供给 T02 确认流程注入的纯构建器：
 * 输入目的地模板种子与确认方案的日期/天数，输出全新 Activity 列表；
 * 不读取旅行现状、不生成随机数，首次生成与替换均由调用方决定如何落库。
 */
import type { Activity, Trip } from '../types';
import { addDays, isDateOnly as isValidDateOnly } from '../dates';
import { domainError, type DomainError } from '../ledger/errors';
import { validateActivityTime } from './activity';

export type BudgetBucket = 'activities' | 'included';

/** 模板活动种子：模板版本内的不可变描述，dayOffset 以出发日为 0。 */
export interface TemplateActivitySeed {
  dayOffset: number;
  startTime: string | null;
  endTime: string | null;
  title: string;
  category: string;
  budgetBucket: BudgetBucket;
  /** 人均预计活动支出（分）；null 表示待估算。included 条目必须为 null。 */
  perPersonEstimate: number | null;
  note: string;
}

/** 目的地模板（T02 提供 `src/data/templates/**` 的数据实例，本域只依赖此结构）。 */
export interface ItineraryTemplate {
  destinationId: string;
  templateVersion: number;
  seeds: readonly TemplateActivitySeed[];
}

export type ItineraryDays = 2 | 3 | 4 | 5;

export interface BuildTemplateItineraryArgs {
  template: ItineraryTemplate;
  startDate: string;
  days: ItineraryDays;
  /** 确定性 ID 分配器（由应用层注入） */
  allocateId: (prefix: string) => string;
}

export type BuildTemplateResult =
  | { ok: true; activities: Activity[] }
  | { ok: false; errors: DomainError[] };

function validateSeed(seed: TemplateActivitySeed, days: ItineraryDays): DomainError[] {
  const errors: DomainError[] = [];
  const label = `模板活动「${seed.title}」`;
  if (!Number.isSafeInteger(seed.dayOffset) || seed.dayOffset < 0 || seed.dayOffset >= days) {
    errors.push(domainError('TEMPLATE_INVALID', `${label}的天次偏移需在 0～${days - 1} 内`, 'dayOffset'));
  }
  const title = seed.title.trim();
  if (title.length < 1 || title.length > 60) {
    errors.push(domainError('TEMPLATE_INVALID', `${label}的名称需为 1～60 字`, 'title'));
  }
  const timeError = validateActivityTime(seed.startTime, seed.endTime);
  if (timeError !== null) errors.push({ ...timeError, message: `${label}：${timeError.message}` });
  if (seed.budgetBucket === 'included') {
    if (seed.perPersonEstimate !== null) {
      errors.push(domainError('TEMPLATE_INVALID', `${label}为已含费用条目，金额必须为空`, 'perPersonEstimate'));
    }
  } else if (seed.perPersonEstimate !== null) {
    if (!Number.isSafeInteger(seed.perPersonEstimate) || seed.perPersonEstimate < 0) {
      errors.push(domainError('TEMPLATE_INVALID', `${label}的人均支出需为非负整数分`, 'perPersonEstimate'));
    } else if (seed.perPersonEstimate > 10_000_000) {
      errors.push(domainError('TEMPLATE_INVALID', `${label}的人均支出不能超过 ¥100,000`, 'perPersonEstimate'));
    }
  }
  if (seed.note.length > 300) {
    errors.push(domainError('TEMPLATE_INVALID', `${label}的备注最多 300 字`, 'note'));
  }
  return errors;
}

/**
 * 由模板种子构建按天日程。活动的 date = startDate + dayOffset；
 * order 按（天次、种子顺序）赋全局递增整数值，保证同天内手动顺序与生成顺序一致。
 */
export function buildTemplateItinerary(args: BuildTemplateItineraryArgs): BuildTemplateResult {
  const errors: DomainError[] = [];
  if (!isValidDateOnly(args.startDate)) {
    errors.push(domainError('INVALID_DATE', '出发日期需为合法的 YYYY-MM-DD', 'startDate'));
  }
  for (const seed of args.template.seeds) {
    errors.push(...validateSeed(seed, args.days));
  }
  if (errors.length > 0) return { ok: false, errors };

  // 稳定排序仅按天次归组；同一天内保持种子给定的先后顺序
  const sortedSeeds = [...args.template.seeds].sort((a, b) => a.dayOffset - b.dayOffset);
  const activities: Activity[] = [];
  let order = 0;
  for (const seed of sortedSeeds) {
    activities.push({
      id: args.allocateId('activity'),
      date: addDays(args.startDate, seed.dayOffset),
      startTime: seed.startTime,
      endTime: seed.endTime,
      title: seed.title.trim(),
      category: seed.category.trim().length > 0 ? seed.category.trim() : '其他',
      budgetBucket: seed.budgetBucket,
      perPersonEstimate: seed.budgetBucket === 'included' ? null : seed.perPersonEstimate,
      note: seed.note,
      order,
    });
    order += 1;
  }
  return { ok: true, activities };
}

export interface ReplacementPreview {
  /** 替换将移除的现有条目数 */
  removedCount: number;
  /** 替换后将生成的条目数 */
  nextCount: number;
}

/** 替换前影响预览：展示将覆盖的条目数量，由用户确认后才真正替换。 */
export function previewTemplateReplacement(
  currentActivities: readonly Activity[],
  nextActivities: readonly Activity[],
): ReplacementPreview {
  return { removedCount: currentActivities.length, nextCount: nextActivities.length };
}

/**
 * 将日程绑定重新指向某方案（供 T02 确认流程“保留日程”路径复用）：
 * 更新 sourcePlanId/Version 与日期范围，保留现有活动不动。
 * 超出范围的活动由 findOutOfRangeActivities 标记，不在此搬移。
 */
export function rebindItineraryToPlan(
  trip: Trip,
  plan: { id: string; version: number; startDate: string; days: number },
): Trip {
  return {
    ...trip,
    itinerary: {
      ...trip.itinerary,
      sourcePlanId: plan.id,
      sourcePlanVersion: plan.version,
      dateRange: { start: plan.startDate, end: addDays(plan.startDate, plan.days - 1) },
    },
  };
}
