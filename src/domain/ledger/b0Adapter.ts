/**
 * B0 契约适配层：把公共 CommandPayload（扁平实体）转换为本域命令，
 * 调用纯领域 handler，并把结果转回 B0 Result<Trip>。
 *
 * B0 负责幂等、expectedRevision、revision 递增与事务（app/application/commands.ts）；
 * 本层只做形状转换与错误码映射，不复制业务规则。
 */
import type { CommandContext as B0Context, CommandPayload } from '../commands';
import type { Activity, Expense, Trip } from '../types';
import { failure, success, type Result } from '../../contracts/result';
import { toBusinessError } from './errorMapping';
import type { CommandContext } from './errors';
import { applyItineraryLedgerCommand, type ItineraryLedgerCommand } from './unifiedEntry';

/** B0 context 的 ids 是调用方预分配好的确定性 ID；allocateId 按顺序领取，不足即报错。 */
function toDomainContext(context: B0Context): CommandContext {
  let index = 0;
  return {
    now: context.now,
    allocateId: (prefix: string) => {
      const id = context.ids[index];
      if (id === undefined) {
        throw new RangeError(`预分配 ID 不足（${prefix}）：B0 命令上下文需要提供足够的 ids`);
      }
      index += 1;
      return id;
    },
  };
}

/** 活动草稿：B0 提供完整 Activity（ID 由 ids 预分配覆盖）。 */
function activityDraft(activity: Activity) {
  return {
    date: activity.date,
    startTime: activity.startTime,
    endTime: activity.endTime,
    title: activity.title,
    category: activity.category,
    budgetBucket: activity.budgetBucket,
    perPersonEstimate: activity.perPersonEstimate,
    note: activity.note,
  };
}

/** 费用草稿：B0 提供完整 Expense（ID 由实体自带，allocation 已由 UI 计算）。 */
function expenseDraft(expense: Expense) {
  const base = {
    title: expense.title,
    date: expense.date,
    category: expense.category,
    amount: expense.amount,
    payerId: expense.payerId,
  };
  if (expense.splitMode === 'equal') {
    return {
      ...base,
      splitMode: 'equal' as const,
      participantIds: expense.allocations.map((allocation) => allocation.memberId),
    };
  }
  return {
    ...base,
    splitMode: 'custom' as const,
    allocations: expense.allocations.map((allocation) => ({
      memberId: allocation.memberId,
      amount: allocation.amount,
    })),
  };
}

/**
 * 把 B0 payload 转为领域命令；不支持的 payload 返回 null（由调用方报 NOT_IMPLEMENTED）。
 * itinerary.update 的局部补丁需要结合 trip 中现有活动，故传入 trip。
 */
export function toDomainCommand(payload: CommandPayload, trip?: Trip): ItineraryLedgerCommand | null {
  switch (payload.type) {
    case 'itinerary.add':
      return {
        type: 'itinerary.add',
        commandId: payload.type,
        activity: activityDraft(payload.activity),
        ...(payload.dateRange ? { draftDateRange: payload.dateRange } : {}),
      };
    case 'itinerary.update': {
      const existing = trip?.itinerary.activities.find((item) => item.id === payload.activityId);
      const merged: Activity | undefined =
        existing === undefined ? undefined : { ...existing, ...payload.changes };
      if (merged === undefined) return null;
      return {
        type: 'itinerary.update',
        commandId: payload.type,
        activityId: payload.activityId,
        activity: activityDraft(merged),
      };
    }
    case 'itinerary.remove':
      return { type: 'itinerary.remove', commandId: payload.type, activityId: payload.activityId };
    case 'itinerary.move':
      return {
        type: 'itinerary.move',
        commandId: payload.type,
        activityId: payload.activityId,
        direction: payload.direction,
      };
    case 'itinerary.replaceFromTemplate':
      // 模板替换需要 template/startDate/days；B0 payload 仅给 planId + confirmed。
      // 完整的模板与日期由适配层之外的注入提供（见 applyB0ItineraryLedgerCommand 第四参数）。
      return null;
    case 'ledger.addExpense':
      return {
        type: 'ledger.addExpense',
        commandId: payload.expense.id,
        draft: expenseDraft(payload.expense),
      };
    case 'ledger.updateExpense':
      return {
        type: 'ledger.updateExpense',
        commandId: payload.expense.id,
        expenseId: payload.expenseId,
        draft: expenseDraft(payload.expense),
      };
    case 'ledger.removeExpense':
      return { type: 'ledger.removeExpense', commandId: payload.type, expenseId: payload.expenseId };
    case 'ledger.recordSettlement':
      return {
        type: 'ledger.recordSettlement',
        commandId: payload.settlementId,
        fromId: payload.fromId,
        toId: payload.toId,
        amount: payload.amount,
      };
    case 'ledger.voidAllSettlements':
      return { type: 'ledger.voidAllSettlements', commandId: payload.type };
    default:
      return null;
  }
}

/** 模板替换所需的注入输入（由 T02 模板与确认方案组装）。 */
export interface TemplateReplacementInput {
  planId: string;
  planVersion: number;
  template: {
    destinationId: string;
    templateVersion: number;
    seeds: ReadonlyArray<{
      dayOffset: number;
      startTime: string | null;
      endTime: string | null;
      title: string;
      category: string;
      budgetBucket: 'activities' | 'included';
      perPersonEstimate: number | null;
      note: string;
    }>;
  };
  startDate: string;
  days: 2 | 3 | 4 | 5;
}

/**
 * B0 CommandHandler 兼容签名。
 * templateInput 仅在 payload.type === 'itinerary.replaceFromTemplate' 时必填。
 */
export function applyB0ItineraryLedgerCommand(
  trip: Trip,
  payload: CommandPayload,
  context: B0Context,
  templateInput?: TemplateReplacementInput,
): Result<Trip> {
  let command = toDomainCommand(payload, trip);
  if (command === null && payload.type === 'itinerary.update') {
    return failure('NOT_FOUND', '要修改的日程安排不存在');
  }
  if (command === null) {
    if (payload.type === 'itinerary.replaceFromTemplate') {
      if (templateInput === undefined) {
        return failure('NOT_IMPLEMENTED', '模板替换缺少模板与方案日期输入');
      }
      command = {
        type: 'itinerary.replaceFromTemplate',
        commandId: payload.type,
        planId: templateInput.planId,
        planVersion: templateInput.planVersion,
        template: templateInput.template,
        startDate: templateInput.startDate,
        days: templateInput.days,
      };
    } else {
      return failure('NOT_IMPLEMENTED', `此日程/账本命令尚未实现：${payload.type}`);
    }
  }
  let domainContext: CommandContext;
  try {
    domainContext = toDomainContext(context);
  } catch (error) {
    return failure('VALIDATION', error instanceof Error ? error.message : '命令上下文无效');
  }
  const result = applyItineraryLedgerCommand(trip, command, domainContext);
  return result.ok ? success(result.trip) : { ok: false, error: toBusinessError(result.error) };
}
