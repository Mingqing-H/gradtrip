/**
 * 转账建议与结算记录校验（BR-12）。
 *
 * 建议算法是确定性的贪心配对：同一输入同一建议；
 * 只减少操作笔数，不承诺全局最少笔数。
 */
import { domainError, type DomainError } from './errors';
import type { MemberBalanceRow } from './balances';
import { compareIds } from './split';

export interface SettlementSuggestion {
  fromId: string;
  toId: string;
  /** 建议转账金额（分） */
  amount: number;
}

/** 剩余额快照：balance < 0 为欠款方，> 0 为应收方。 */
interface RemainingBalance {
  memberId: string;
  remaining: number;
}

/**
 * 生成确定性转账建议：
 * 1. 负余额按欠款绝对值降序、ID 升序；正余额按应收降序、ID 升序。
 * 2. 双方首位配对转账 min(欠款, 应收)，归零一方推进。
 * 全部结清或空账本时返回空数组，不生成虚构建议。
 */
export function buildSettlementSuggestions(
  balances: readonly MemberBalanceRow[],
): SettlementSuggestion[] {
  const debtors: RemainingBalance[] = [];
  const creditors: RemainingBalance[] = [];
  for (const row of balances) {
    if (row.balance < 0) debtors.push({ memberId: row.memberId, remaining: -row.balance });
    else if (row.balance > 0) creditors.push({ memberId: row.memberId, remaining: row.balance });
  }
  debtors.sort((a, b) => b.remaining - a.remaining || compareIds(a.memberId, b.memberId));
  creditors.sort((a, b) => b.remaining - a.remaining || compareIds(a.memberId, b.memberId));

  const suggestions: SettlementSuggestion[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex] as RemainingBalance;
    const creditor = creditors[creditorIndex] as RemainingBalance;
    const amount = Math.min(debtor.remaining, creditor.remaining);
    if (amount > 0) {
      suggestions.push({ fromId: debtor.memberId, toId: creditor.memberId, amount });
    }
    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }
  return suggestions;
}

export interface SettlementRecordingInput {
  fromId: string;
  toId: string;
  /** 本次记录的金额（分），允许不超双方剩余额的部分金额 */
  amount: number;
}

/**
 * 校验一笔“记录已转账”：
 * - 只能从当前负余额成员转给正余额成员，方向不可反转；
 * - 金额为正的安全整数且不超过双方当前剩余额；
 * - 同一人不能转给自己。
 * 结算仅记录线下确认，不代表真实到账。
 */
export function validateSettlementRecording(
  balances: readonly MemberBalanceRow[],
  input: SettlementRecordingInput,
): DomainError | null {
  if (input.fromId === input.toId) {
    return domainError('SETTLEMENT_SELF', '同一成员不能转给自己', 'fromId');
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    return domainError('SETTLEMENT_AMOUNT', '转账金额必须大于 0', 'amount');
  }
  const fromRow = balances.find((row) => row.memberId === input.fromId);
  const toRow = balances.find((row) => row.memberId === input.toId);
  if (fromRow === undefined || toRow === undefined) {
    return domainError('UNKNOWN_MEMBER', '转出人或转入人不存在', fromRow === undefined ? 'fromId' : 'toId');
  }
  if (fromRow.balance >= 0 || toRow.balance <= 0) {
    return domainError(
      'SETTLEMENT_DIRECTION',
      '只能从当前应付（余额为负）的成员转给当前应收（余额为正）的成员',
      'fromId',
    );
  }
  if (input.amount > -fromRow.balance || input.amount > toRow.balance) {
    return domainError(
      'SETTLEMENT_AMOUNT',
      '转账金额不能超过双方的当前剩余余额',
      'amount',
    );
  }
  return null;
}
