/**
 * T03 统一入口：日程与账本命令分发 + 旅行级语义校验。
 *
 * B0 契约（gitworktree §4.1）要求本域导出 applyItineraryLedgerCommand 与
 * validateItineraryLedgerTrip；实际接入路径以 B0 记录为准，必要时在 index.ts
 * 保持再导出。幂等、expectedRevision、revision 递增与事务由 T01 仓库执行。
 */
import type { Trip } from '../types';
import { isValidDateOnly } from '../dates';
import {
  MAX_ACTIVITIES,
  MAX_EXPENSES,
  MAX_SETTLEMENTS,
  NOTE_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  domainError,
  type CommandContext,
  type CommandResult,
  type DomainError,
} from './errors';
import { computeMemberBalances } from './balances';
import { splitEqualCents } from './split';
import { applyLedgerCommand, type LedgerCommand } from './commands';
import {
  applyItineraryCommand,
  type ItineraryCommand,
} from '../itinerary/commands';
import { validateActivityTime } from '../itinerary/activity';

/** T03 全部领域命令。 */
export type ItineraryLedgerCommand = ItineraryCommand | LedgerCommand;

/**
 * 应用一条日程或账本命令。命令按 type 前缀分发到对应域；
 * 未知前缀返回 INVALID_COMMAND，不会静默吞掉。
 */
export function applyItineraryLedgerCommand(
  trip: Trip,
  command: ItineraryLedgerCommand,
  ctx: CommandContext,
): CommandResult<Trip> {
  if (command.type.startsWith('itinerary.')) {
    return applyItineraryCommand(trip, command as ItineraryCommand, ctx);
  }
  if (command.type.startsWith('ledger.')) {
    return applyLedgerCommand(trip, command as LedgerCommand, ctx);
  }
  return {
    ok: false,
    error: domainError('INVALID_COMMAND', `未知的日程/账本命令：${String((command as { type: string }).type)}`),
  };
}

/**
 * 旅行级语义校验（供 T01 聚合校验、导入与持久化恢复复用）。
 * 返回全部错误；空数组表示本域数据合法。结构层 schema 校验由 T01 负责。
 *
 * 注意：超出日程日期范围的活动不是错误（BR-08 要求保留并标记，由
 * findOutOfRangeActivities 提示调整），不在此报告。
 */
export function validateItineraryLedgerTrip(trip: Trip): DomainError[] {
  const errors: DomainError[] = [];
  errors.push(...validateItinerary(trip));
  errors.push(...validateExpenses(trip));
  errors.push(...validateSettlements(trip));
  errors.push(...validateBalanceInvariant(trip));
  return errors;
}

function labelOf(prefix: string, id: string): string {
  return `${prefix}（${id}）`;
}

function validateItinerary(trip: Trip): DomainError[] {
  const errors: DomainError[] = [];
  const { dateRange, activities, sourcePlanId } = trip.itinerary;

  if (dateRange !== null) {
    if (!isValidDateOnly(dateRange.start) || !isValidDateOnly(dateRange.end) || dateRange.start > dateRange.end) {
      errors.push(domainError('INVALID_DATE_RANGE', '日程日期范围不合法'));
    }
  }
  if (sourcePlanId !== null && !trip.plans.some((plan) => plan.id === sourcePlanId)) {
    errors.push(domainError('PLAN_NOT_FOUND', `日程引用的方案不存在：${sourcePlanId}`));
  }
  if (activities.length > MAX_ACTIVITIES) {
    errors.push(domainError('LIMIT_ACTIVITIES', `日程安排超过 ${MAX_ACTIVITIES} 条上限`));
  }

  const seenIds = new Set<string>();
  for (const activity of activities) {
    const label = labelOf('日程安排', activity.id);
    if (seenIds.has(activity.id)) {
      errors.push(domainError('INVARIANT_BROKEN', `${label}ID 重复`));
    }
    seenIds.add(activity.id);
    const title = activity.title.trim();
    if (title.length < 1 || title.length > TITLE_MAX_LENGTH) {
      errors.push(domainError('INVALID_TITLE', `${label}名称需为 1～${TITLE_MAX_LENGTH} 字`));
    }
    if (activity.category.trim().length < 1) {
      errors.push(domainError('INVALID_CATEGORY', `${label}类别不能为空`));
    }
    if (!isValidDateOnly(activity.date)) {
      errors.push(domainError('INVALID_DATE', `${label}日期不合法：${activity.date}`));
    }
    const timeError = validateActivityTime(activity.startTime, activity.endTime);
    if (timeError !== null) errors.push({ ...timeError, message: `${label}${timeError.message}` });
    if (activity.budgetBucket === 'included') {
      if (activity.perPersonEstimate !== null) {
        errors.push(domainError('INVALID_ESTIMATE', `${label}为已含费用条目，金额必须为空`));
      }
    } else if (activity.perPersonEstimate !== null) {
      if (!Number.isSafeInteger(activity.perPersonEstimate) || activity.perPersonEstimate < 0) {
        errors.push(domainError('INVALID_ESTIMATE', `${label}人均支出需为非负整数分`));
      }
    }
    if (activity.note.length > NOTE_MAX_LENGTH) {
      errors.push(domainError('INVALID_NOTE', `${label}备注超过 ${NOTE_MAX_LENGTH} 字`));
    }
    if (!Number.isSafeInteger(activity.order) || activity.order < 0) {
      errors.push(domainError('INVARIANT_BROKEN', `${label}手动顺序值不合法`));
    }
  }
  return errors;
}

function validateExpenses(trip: Trip): DomainError[] {
  const errors: DomainError[] = [];
  if (trip.expenses.length > MAX_EXPENSES) {
    errors.push(domainError('LIMIT_EXPENSES', `费用超过 ${MAX_EXPENSES} 笔上限`));
  }
  const memberIds = new Set(trip.members.map((member) => member.id));
  const seenIds = new Set<string>();
  for (const expense of trip.expenses) {
    const label = labelOf('费用', expense.id);
    if (seenIds.has(expense.id)) {
      errors.push(domainError('INVARIANT_BROKEN', `${label}ID 重复`));
    }
    seenIds.add(expense.id);
    if (expense.title.trim().length < 1 || expense.title.trim().length > TITLE_MAX_LENGTH) {
      errors.push(domainError('INVALID_TITLE', `${label}名称需为 1～${TITLE_MAX_LENGTH} 字`));
    }
    if (!isValidDateOnly(expense.date)) {
      errors.push(domainError('INVALID_DATE', `${label}日期不合法：${expense.date}`));
    }
    if (!Number.isSafeInteger(expense.amount) || expense.amount <= 0) {
      errors.push(domainError('INVALID_AMOUNT', `${label}金额需为正的安全整数分`));
    }
    if (!memberIds.has(expense.payerId)) {
      errors.push(domainError('UNKNOWN_MEMBER', `${label}垫付人不存在：${expense.payerId}`));
    }
    if (expense.allocations.length === 0) {
      errors.push(domainError('ALLOCATION_EMPTY', `${label}缺少分摊明细`));
      continue;
    }
    let total = 0;
    const allocationMembers = new Set<string>();
    for (const allocation of expense.allocations) {
      if (!memberIds.has(allocation.memberId)) {
        errors.push(domainError('UNKNOWN_MEMBER', `${label}分摊成员不存在：${allocation.memberId}`));
      }
      if (allocationMembers.has(allocation.memberId)) {
        errors.push(domainError('DUPLICATE_PARTICIPANT', `${label}分摊成员重复：${allocation.memberId}`));
      }
      allocationMembers.add(allocation.memberId);
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount < 0) {
        errors.push(domainError('ALLOCATION_INVALID', `${label}分摊金额需为非负整数分`));
      } else {
        total += allocation.amount;
      }
    }
    if (Number.isSafeInteger(expense.amount) && total !== expense.amount) {
      errors.push(domainError('ALLOCATION_SUM_MISMATCH', `${label}分摊合计与金额不一致`));
    }
    if (
      expense.splitMode === 'equal' &&
      Number.isSafeInteger(expense.amount) &&
      expense.amount > 0 &&
      expense.allocations.every((allocation) => Number.isSafeInteger(allocation.amount) && allocation.amount >= 0)
    ) {
      const expected = splitEqualCents(expense.amount, [...allocationMembers]);
      const actual = new Map(expense.allocations.map((allocation) => [allocation.memberId, allocation.amount]));
      const matches = expected.every((row) => actual.get(row.memberId) === row.amount);
      if (!matches) {
        errors.push(domainError('INVARIANT_BROKEN', `${label}均摊明细与确定性分摊规则不一致`));
      }
    }
  }
  return errors;
}

function validateSettlements(trip: Trip): DomainError[] {
  const errors: DomainError[] = [];
  if (trip.settlements.length > MAX_SETTLEMENTS) {
    errors.push(domainError('LIMIT_SETTLEMENTS', `结算记录超过 ${MAX_SETTLEMENTS} 条上限`));
  }
  const memberIds = new Set(trip.members.map((member) => member.id));
  const seenIds = new Set<string>();
  const seenCommandIds = new Set<string>();
  for (const settlement of trip.settlements) {
    const label = labelOf('结算记录', settlement.id);
    if (seenIds.has(settlement.id)) {
      errors.push(domainError('INVARIANT_BROKEN', `${label}ID 重复`));
    }
    seenIds.add(settlement.id);
    if (seenCommandIds.has(settlement.commandId)) {
      errors.push(domainError('DUPLICATE_COMMAND', `${label}命令 ID 重复：${settlement.commandId}`));
    }
    seenCommandIds.add(settlement.commandId);
    if (!memberIds.has(settlement.fromId) || !memberIds.has(settlement.toId)) {
      errors.push(domainError('UNKNOWN_MEMBER', `${label}转出/转入成员不存在`));
    }
    if (settlement.fromId === settlement.toId) {
      errors.push(domainError('SETTLEMENT_SELF', `${label}转出人与转入人相同`));
    }
    if (!Number.isSafeInteger(settlement.amount) || settlement.amount <= 0) {
      errors.push(domainError('SETTLEMENT_AMOUNT', `${label}金额需为正的安全整数分`));
    }
    if (settlement.voidedAt !== null && typeof settlement.voidedAt !== 'string') {
      errors.push(domainError('INVARIANT_BROKEN', `${label}撤销时间不合法`));
    }
  }
  return errors;
}

function validateBalanceInvariant(trip: Trip): DomainError[] {
  const errors: DomainError[] = [];
  const memberIds = trip.members.map((member) => member.id);
  const balances = computeMemberBalances(memberIds, trip.expenses, trip.settlements);
  const totalBalance = balances.reduce((sum, row) => sum + row.balance, 0);
  if (totalBalance !== 0) {
    errors.push(domainError('INVARIANT_BROKEN', `成员余额总和不为 0（${totalBalance} 分），数据不一致`));
  }
  return errors;
}
