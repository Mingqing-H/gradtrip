/**
 * 账本域公共出口（T03）。
 *
 * 对外（B0 modules.ts）导出的 applyItineraryLedgerCommand 与
 * validateItineraryLedgerTrip 符合 CommandHandler / TripValidator 签名；
 * 纯领域函数从 ./unifiedEntry 与 ./b0Adapter 单独导出，供测试与组合使用。
 */
export * from './errors';
export * from './split';
export * from './balances';
export * from './settlement';
export * from './commands';
export * from './b0Adapter';
export * from './errorMapping';

// 纯领域入口（以明确命名再导出，避免与下方 B0 适配函数同名冲突）
export {
  applyItineraryLedgerCommand as applyDomainCommand,
  validateItineraryLedgerTrip as validateDomainTrip,
  type ItineraryLedgerCommand as DomainItineraryLedgerCommand,
} from './unifiedEntry';

import type { Trip } from '../types';
import type { CommandContext, CommandPayload } from '../commands';
import type { DomainDependencies } from '../../contracts/services';
import type { BusinessError, Result } from '../../contracts/result';
import { applyB0ItineraryLedgerCommand, type TemplateReplacementInput } from './b0Adapter';
import { validateItineraryLedgerTrip as validateDomain } from './unifiedEntry';
import { toBusinessError } from './errorMapping';

/** B0 CommandHandler：payload 是扁平命令，模板输入经 dependencies 注入。 */
export function applyItineraryLedgerCommand(
  trip: Trip,
  payload: CommandPayload,
  context: CommandContext,
  dependencies: DomainDependencies,
): Result<Trip> {
  let templateInput: TemplateReplacementInput | undefined;
  if (payload.type === 'itinerary.replaceFromTemplate') {
    templateInput = buildTemplateInputFromDependencies(payload.planId, trip, dependencies);
  }
  return applyB0ItineraryLedgerCommand(trip, payload, context, templateInput);
}

/** B0 TripValidator：把领域错误映射为公共 BusinessError（逐条返回）。 */
export function validateItineraryLedgerTrip(trip: Trip): BusinessError[] {
  return validateDomain(trip).map(toBusinessError);
}

function buildTemplateInputFromDependencies(
  planId: string,
  trip: Trip,
  dependencies: DomainDependencies,
): TemplateReplacementInput | undefined {
  const plan = trip.plans.find((candidate) => candidate.id === planId);
  if (plan === undefined) return undefined;
  const templateResult = dependencies.planning.getTemplate(plan.destinationId, plan.templateVersion);
  if (!templateResult.ok) return undefined;
  const template = templateResult.value;
  return {
    planId: plan.id,
    planVersion: plan.version,
    template: {
      destinationId: template.id,
      templateVersion: template.version,
      seeds: template.activities.map((activity) => ({
        dayOffset: activity.dayOffset,
        startTime: activity.startTime,
        endTime: activity.endTime,
        title: activity.title,
        category: activity.category,
        budgetBucket: activity.budgetBucket,
        perPersonEstimate: activity.perPersonEstimate,
        note: activity.note,
      })),
    },
    startDate: plan.startDate,
    days: plan.days,
  };
}
