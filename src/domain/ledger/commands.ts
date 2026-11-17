/**
 * 账本命令 handler（BR-09～BR-12）。
 *
 * 输入 Trip、领域命令与显式上下文（now / allocateId），返回新 Trip 或结构化错误；
 * 不修改入参、不访问存储、不读时钟。幂等、expectedRevision 与 revision 递增由
 * T01 仓库事务负责；本层额外防御 settlement commandId 重复（BR-12）。
 *
 * 命令类型带判别字段 type；commandId 用于结算记录实体的去重登记。
 */
import type { Expense, Settlement, Trip } from '../types';
import { isDateOnly as isValidDateOnly } from '../dates';
import {
  MAX_EXPENSES,
  MAX_EXPENSE_CENTS,
  MAX_SETTLEMENTS,
  TITLE_MAX_LENGTH,
  commandFail,
  commandOk,
  domainError,
  type CommandContext,
  type CommandResult,
  type DomainError,
} from './errors';
import { compareIds, splitEqualCents, validateExpenseAmountCents } from './split';
import { computeMemberBalances, isActiveSettlement } from './balances';
import { validateSettlementRecording } from './settlement';

/** 活动费用归属/费用类别共用长度上限见 TITLE_MAX_LENGTH；类别同样 1～60 字。 */
const CATEGORY_MAX_LENGTH = TITLE_MAX_LENGTH;

export type SplitMode = 'equal' | 'custom';

/** 费用草稿：均摊给参与人列表；自定义给逐人完整金额（UI 保证无未填项，领域再校验）。 */
export type ExpenseDraft = {
  title: string;
  date: string;
  category: string;
  amount: number;
  payerId: string;
} & (
  | { splitMode: 'equal'; participantIds: readonly string[] }
  | {
      splitMode: 'custom';
      allocations: ReadonlyArray<{ memberId: string; amount: number }>;
    }
);

export type LedgerCommand =
  | { type: 'ledger.addExpense'; commandId: string; draft: ExpenseDraft }
  | { type: 'ledger.updateExpense'; commandId: string; expenseId: string; draft: ExpenseDraft }
  | { type: 'ledger.removeExpense'; commandId: string; expenseId: string }
  | {
      type: 'ledger.recordSettlement';
      commandId: string;
      fromId: string;
      toId: string;
      amount: number;
    }
  | { type: 'ledger.voidAllSettlements'; commandId: string };

function validateTitle(title: string, field = 'title'): DomainError | null {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > TITLE_MAX_LENGTH) {
    return domainError('INVALID_TITLE', `名称需为 1～${TITLE_MAX_LENGTH} 字`, field);
  }
  return null;
}

/** 费用草稿完整校验；返回最终分摊明细（保存其最终分摊，BR-09/BR-10）。 */
export function validateExpenseDraft(
  trip: Trip,
  draft: ExpenseDraft,
): { ok: true; allocations: Array<{ memberId: string; amount: number }> } | { ok: false; error: DomainError } {
  const titleError = validateTitle(draft.title);
  if (titleError !== null) return { ok: false, error: titleError };

  const category = draft.category.trim();
  if (category.length < 1 || category.length > CATEGORY_MAX_LENGTH) {
    return { ok: false, error: domainError('INVALID_CATEGORY', `类别需为 1～${CATEGORY_MAX_LENGTH} 字`, 'category') };
  }
  if (!isValidDateOnly(draft.date)) {
    return { ok: false, error: domainError('INVALID_DATE', '日期需为合法的 YYYY-MM-DD', 'date') };
  }
  const amountError = validateExpenseAmountCents(draft.amount);
  if (amountError !== null) return { ok: false, error: amountError };

  const memberIds = new Set(trip.members.map((member) => member.id));
  if (!memberIds.has(draft.payerId)) {
    return { ok: false, error: domainError('UNKNOWN_MEMBER', '垫付人不在小队中', 'payerId') };
  }

  if (draft.splitMode === 'equal') {
    if (draft.participantIds.length === 0) {
      return { ok: false, error: domainError('EMPTY_PARTICIPANTS', '至少选择一名参与成员', 'participantIds') };
    }
    const seen = new Set<string>();
    for (const participantId of draft.participantIds) {
      if (!memberIds.has(participantId)) {
        return { ok: false, error: domainError('UNKNOWN_MEMBER', '参与成员不在小队中', 'participantIds') };
      }
      if (seen.has(participantId)) {
        return { ok: false, error: domainError('DUPLICATE_PARTICIPANT', '参与成员不能重复', 'participantIds') };
      }
      seen.add(participantId);
    }
    return { ok: true, allocations: splitEqualCents(draft.amount, draft.participantIds) };
  }

  if (draft.allocations.length === 0) {
    return { ok: false, error: domainError('ALLOCATION_EMPTY', '自定义分摊至少填写一名成员', 'allocations') };
  }
  const seen = new Set<string>();
  let total = 0;
  for (const allocation of draft.allocations) {
    if (!memberIds.has(allocation.memberId)) {
      return { ok: false, error: domainError('UNKNOWN_MEMBER', '分摊成员不在小队中', 'allocations') };
    }
    if (seen.has(allocation.memberId)) {
      return { ok: false, error: domainError('DUPLICATE_PARTICIPANT', '分摊成员不能重复', 'allocations') };
    }
    seen.add(allocation.memberId);
    if (!Number.isSafeInteger(allocation.amount) || allocation.amount < 0) {
      return {
        ok: false,
        error: domainError('ALLOCATION_INVALID', '每人分摊金额需为非负整数分（允许 0）', 'allocations'),
      };
    }
    total += allocation.amount;
  }
  if (total !== draft.amount) {
    const diffYuan = Math.abs(total - draft.amount) / 100;
    return {
      ok: false,
      error: domainError(
        'ALLOCATION_SUM_MISMATCH',
        `自定义分摊合计与账单金额相差 ¥${diffYuan.toFixed(2)}`,
        'allocations',
      ),
    };
  }
  return { ok: true, allocations: [...draft.allocations].sort((a, b) => compareIds(a.memberId, b.memberId)) };
}

function requireExpensesUnlocked(trip: Trip): DomainError | null {
  if (trip.settlements.some((settlement) => isActiveSettlement(settlement))) {
    return domainError(
      'EXPENSE_LOCKED',
      '已有有效结算记录，费用已锁定；请先在结算页撤销全部结算记录再更正费用',
    );
  }
  return null;
}

function memberIdsOf(trip: Trip): string[] {
  return trip.members.map((member) => member.id);
}

/**
 * 应用账本命令，返回新 Trip。失败时入参 Trip 不被修改。
 * ledger.* 之外的命令类型返回 INVALID_COMMAND。
 */
export function applyLedgerCommand(
  trip: Trip,
  command: LedgerCommand,
  ctx: CommandContext,
): CommandResult<Trip> {
  switch (command.type) {
    case 'ledger.addExpense':
      return addExpense(trip, command, ctx);
    case 'ledger.updateExpense':
      return updateExpense(trip, command);
    case 'ledger.removeExpense':
      return removeExpense(trip, command);
    case 'ledger.recordSettlement':
      return recordSettlement(trip, command, ctx);
    case 'ledger.voidAllSettlements':
      return voidAllSettlements(trip, command, ctx);
    default:
      return commandFail('INVALID_COMMAND', `未知的账本命令：${String((command as { type: string }).type)}`);
  }
}

function addExpense(
  trip: Trip,
  command: { commandId: string; draft: ExpenseDraft },
  ctx: CommandContext,
): CommandResult<Trip> {
  const lockError = requireExpensesUnlocked(trip);
  if (lockError !== null) return { ok: false, error: lockError };
  if (trip.expenses.length >= MAX_EXPENSES) {
    return commandFail('LIMIT_EXPENSES', `每旅行最多 ${MAX_EXPENSES} 笔费用，请先导出并清理`);
  }
  const validated = validateExpenseDraft(trip, command.draft);
  if (!validated.ok) return { ok: false, error: validated.error };
  const expense: Expense = {
    id: ctx.allocateId('expense'),
    title: command.draft.title.trim(),
    date: command.draft.date,
    category: command.draft.category.trim(),
    amount: command.draft.amount,
    payerId: command.draft.payerId,
    splitMode: command.draft.splitMode,
    allocations: validated.allocations,
    createdAt: ctx.now,
  };
  return commandOk({ ...trip, expenses: [...trip.expenses, expense] });
}

function updateExpense(
  trip: Trip,
  command: { commandId: string; expenseId: string; draft: ExpenseDraft },
): CommandResult<Trip> {
  const lockError = requireExpensesUnlocked(trip);
  if (lockError !== null) return { ok: false, error: lockError };
  const index = trip.expenses.findIndex((expense) => expense.id === command.expenseId);
  if (index === -1) {
    return commandFail('EXPENSE_NOT_FOUND', '要修改的费用不存在', 'expenseId');
  }
  const validated = validateExpenseDraft(trip, command.draft);
  if (!validated.ok) return { ok: false, error: validated.error };
  const previous = trip.expenses[index] as Expense;
  const next: Expense = {
    ...previous,
    title: command.draft.title.trim(),
    date: command.draft.date,
    category: command.draft.category.trim(),
    amount: command.draft.amount,
    payerId: command.draft.payerId,
    splitMode: command.draft.splitMode,
    allocations: validated.allocations,
  };
  const expenses = [...trip.expenses];
  expenses.splice(index, 1, next);
  return commandOk({ ...trip, expenses });
}

function removeExpense(trip: Trip, command: { expenseId: string }): CommandResult<Trip> {
  const lockError = requireExpensesUnlocked(trip);
  if (lockError !== null) return { ok: false, error: lockError };
  const index = trip.expenses.findIndex((expense) => expense.id === command.expenseId);
  if (index === -1) {
    return commandFail('EXPENSE_NOT_FOUND', '要删除的费用不存在', 'expenseId');
  }
  const expenses = [...trip.expenses];
  expenses.splice(index, 1);
  return commandOk({ ...trip, expenses });
}

function recordSettlement(
  trip: Trip,
  command: { commandId: string; fromId: string; toId: string; amount: number },
  ctx: CommandContext,
): CommandResult<Trip> {
  if (trip.settlements.some((settlement) => settlement.commandId === command.commandId)) {
    return commandFail('DUPLICATE_COMMAND', '该命令已记录过结算，不能重复创建', 'commandId');
  }
  if (trip.settlements.length >= MAX_SETTLEMENTS) {
    return commandFail('LIMIT_SETTLEMENTS', `每旅行最多 ${MAX_SETTLEMENTS} 条结算记录，请先导出`);
  }
  const memberIds = memberIdsOf(trip);
  const balances = computeMemberBalances(memberIds, trip.expenses, trip.settlements);
  const validationError = validateSettlementRecording(balances, {
    fromId: command.fromId,
    toId: command.toId,
    amount: command.amount,
  });
  if (validationError !== null) return { ok: false, error: validationError };
  if (command.amount > MAX_EXPENSE_CENTS) {
    return commandFail('SETTLEMENT_OVERFLOW', '单笔转账金额过大', 'amount');
  }
  const settlement: Settlement = {
    id: ctx.allocateId('settlement'),
    commandId: command.commandId,
    fromId: command.fromId,
    toId: command.toId,
    amount: command.amount,
    recordedAt: ctx.now,
    voidedAt: null,
  };
  return commandOk({ ...trip, settlements: [...trip.settlements, settlement] });
}

function voidAllSettlements(
  trip: Trip,
  _command: { commandId: string },
  ctx: CommandContext,
): CommandResult<Trip> {
  if (!trip.settlements.some((settlement) => isActiveSettlement(settlement))) {
    return commandFail('NO_ACTIVE_SETTLEMENTS', '当前没有可撤销的有效结算记录');
  }
  // 撤销仅移除本地记录的效力：保留历史、不计余额、不可重新激活（BR-12）。
  const settlements = trip.settlements.map((settlement) =>
    isActiveSettlement(settlement) ? { ...settlement, voidedAt: ctx.now } : settlement,
  );
  return commandOk({ ...trip, settlements });
}
