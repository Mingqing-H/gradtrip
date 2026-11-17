/**
 * 成员余额与账本汇总（BR-11 余额与不变量）。
 *
 * B_i = P_i - O_i + 已转出结算总额 - 已转入结算总额；
 * 已撤销（voidedAt 非空）的结算记录保留历史但不参与计算。
 */
import type { Expense, Settlement } from '../types';
import { compareIds } from './split';

export interface MemberBalanceRow {
  memberId: string;
  /** 已付：其垫付的实际费用总额 */
  paid: number;
  /** 应承担：其承担的实际费用总额 */
  owed: number;
  /** 已转出：有效结算中从该成员转出的总额 */
  sent: number;
  /** 已转入：有效结算中转入该成员的总额 */
  received: number;
  /** B_i > 0 应收；< 0 应付；= 0 结清 */
  balance: number;
}

export interface LedgerSummary {
  expenseCount: number;
  /** 实际总支出（分） */
  totalExpense: number;
  /** 有效结算笔数 */
  activeSettlementCount: number;
  /** 已撤销结算笔数（保留历史） */
  voidedSettlementCount: number;
  /** 存在有效结算时费用修改被锁定（BR-12） */
  hasActiveSettlement: boolean;
  balances: MemberBalanceRow[];
  /** 全员余额之和，业务上恒为 0；导入校验用 */
  totalBalance: number;
}

/** 结算记录是否有效（未被撤销）。 */
export function isActiveSettlement(settlement: Settlement): boolean {
  return settlement.voidedAt === null;
}

/**
 * 逐人计算已付/应承担/已转出/已转入与当前余额。
 * memberIds 去重后按 ID 升序返回，保证同一输入同一输出。
 */
export function computeMemberBalances(
  memberIds: readonly string[],
  expenses: readonly Expense[],
  settlements: readonly Settlement[] = [],
): MemberBalanceRow[] {
  const rows = new Map<string, MemberBalanceRow>();
  for (const id of new Set(memberIds)) {
    rows.set(id, { memberId: id, paid: 0, owed: 0, sent: 0, received: 0, balance: 0 });
  }
  for (const expense of expenses) {
    const payerRow = rows.get(expense.payerId);
    if (payerRow !== undefined) payerRow.paid += expense.amount;
    for (const allocation of expense.allocations) {
      const row = rows.get(allocation.memberId);
      if (row !== undefined) row.owed += allocation.amount;
    }
  }
  for (const settlement of settlements) {
    if (!isActiveSettlement(settlement)) continue;
    const fromRow = rows.get(settlement.fromId);
    if (fromRow !== undefined) fromRow.sent += settlement.amount;
    const toRow = rows.get(settlement.toId);
    if (toRow !== undefined) toRow.received += settlement.amount;
  }
  const result = [...rows.values()].sort((a, b) => compareIds(a.memberId, b.memberId));
  for (const row of result) {
    row.balance = row.paid - row.owed + row.sent - row.received;
  }
  return result;
}

/** 账本汇总：摘要只统计实际支出与笔数，余额供结算视图展开来源。 */
export function getLedgerSummary(
  memberIds: readonly string[],
  expenses: readonly Expense[],
  settlements: readonly Settlement[] = [],
): LedgerSummary {
  const balances = computeMemberBalances(memberIds, expenses, settlements);
  let totalExpense = 0;
  for (const expense of expenses) totalExpense += expense.amount;
  let activeSettlementCount = 0;
  let voidedSettlementCount = 0;
  for (const settlement of settlements) {
    if (isActiveSettlement(settlement)) activeSettlementCount += 1;
    else voidedSettlementCount += 1;
  }
  let totalBalance = 0;
  for (const row of balances) totalBalance += row.balance;
  return {
    expenseCount: expenses.length,
    totalExpense,
    activeSettlementCount,
    voidedSettlementCount,
    hasActiveSettlement: activeSettlementCount > 0,
    balances,
    totalBalance,
  };
}

/** 按 memberId 取余额行；不存在（未知成员）返回 undefined。 */
export function findBalanceRow(
  balances: readonly MemberBalanceRow[],
  memberId: string,
): MemberBalanceRow | undefined {
  return balances.find((row) => row.memberId === memberId);
}
