/**
 * 日程域公共出口（T03）。
 *
 * 对外导出 B0 注入式 buildTemplateItinerary（签名见 contracts/services）；
 * 纯领域构建、排序、预算、handler 等从各源文件导出，供测试与组合使用。
 */
export * from './activity';
export * from './budget';
export * from './commands';
export * from './template';

import type { Plan } from '../types';
import type { DestinationTemplate } from '../../contracts/services';
import { failure, success, type Result } from '../../contracts/result';
import { buildTemplateItinerary as buildPure, type BuildTemplateResult } from './template';
import { addDays } from '../dates';

/**
 * B0 模板日程构建器：把已确认方案与模板种子转换为完整 itinerary。
 * 纯构建逻辑仍在 ./template，本函数只做形状适配与错误映射。
 */
export function buildTemplateItineraryForB0(input: {
  plan: Plan;
  template: DestinationTemplate;
  ids: readonly string[];
}): Result<{
  sourcePlanId: string | null;
  sourcePlanVersion: number | null;
  dateRange: { start: string; end: string } | null;
  activities: import('../types').Activity[];
}> {
  const { plan, template, ids } = input;
  const seeds = template.activities.map((activity) => ({
    dayOffset: activity.dayOffset,
    startTime: activity.startTime,
    endTime: activity.endTime,
    title: activity.title,
    category: activity.category,
    budgetBucket: activity.budgetBucket,
    perPersonEstimate: activity.perPersonEstimate,
    note: activity.note,
  }));
  let counter = 0;
  let built: BuildTemplateResult;
  try {
    built = buildPure({
      template: { destinationId: template.id, templateVersion: template.version, seeds },
      startDate: plan.startDate,
      days: plan.days,
      allocateId: (prefix: string) => {
        const id = ids[counter];
        if (id === undefined) throw new RangeError(`预分配 ID 不足（${prefix}）`);
        counter += 1;
        return id;
      },
    });
  } catch (error) {
    return failure('VALIDATION', error instanceof Error ? error.message : '构建模板日程失败');
  }
  if (!built.ok) {
    const first = built.errors[0];
    return failure('VALIDATION', first?.message ?? '模板日程无效', first?.field ? { [first.field]: first.message } : undefined);
  }
  return success({
    sourcePlanId: plan.id,
    sourcePlanVersion: plan.version,
    dateRange: { start: plan.startDate, end: addDays(plan.startDate, plan.days - 1) },
    activities: built.activities,
  });
}

/** B0 依赖注入名：modules.ts 读取 `exports.buildTemplateItinerary`。 */
export const buildTemplateItinerary = buildTemplateItineraryForB0;
