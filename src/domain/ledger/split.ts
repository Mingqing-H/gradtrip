/**
 * 费用分摊纯函数（BR-09 输入和均摊、BR-10 自定义金额）。
 *
 * 全部使用安全整数分；排序按 ID 的代码单元字典序，不依赖昵称或区域排序。
 */
import { MAX_EXPENSE_CENTS, domainError, type DomainError } from './errors';

/** ID 比较：代码单元字典序（与默认字符串比较一致，显式命名便于阅读）。 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 均摊金额 A 分、N 位参与人：每人先 floor(A/N)，
 * 余数按参与人 ID 升序依次每人加 1 分。
 * 例：10000 分给 ID 升序 a、b、c → 3334、3333、3333。
 */
export function splitEqualCents(
  amountCents: number,
  participantIds: readonly string[],
): Array<{ memberId: string; amount: number }> {
  if (participantIds.length === 0) {
    throw new Error('splitEqualCents 需要至少一名参与人');
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error('splitEqualCents 需要正的安全整数金额');
  }
  const ids = [...participantIds].sort(compareIds);
  const base = Math.floor(amountCents / ids.length);
  const remainder = amountCents - base * ids.length;
  return ids.map((memberId, index) => ({
    memberId,
    amount: base + (index < remainder ? 1 : 0),
  }));
}

/** 自定义分摊草稿：amount 为 null 表示尚未填写，不能自动补 0（BR-10）。 */
export interface CustomAllocationDraft {
  memberId: string;
  amount: number | null;
}

export interface CustomAllocationSummary {
  /** 已填写人数 */
  filledCount: number;
  /** 未填写人数（显示“待分配”的来源） */
  unfilledCount: number;
  /** 已填写合计（分） */
  filledTotal: number;
  /** 总额 - 已填写合计；>0 待分配，<0 超出 */
  difference: number;
  /** 无未填写且差额为 0，才允许保存 */
  complete: boolean;
}

/** 汇总自定义分摊草稿，用于保存前的分配预览；不做任何自动修正。 */
export function summarizeCustomAllocations(
  amountCents: number,
  drafts: readonly CustomAllocationDraft[],
): CustomAllocationSummary {
  let filledCount = 0;
  let filledTotal = 0;
  for (const draft of drafts) {
    if (draft.amount === null) continue;
    filledCount += 1;
    filledTotal += draft.amount;
  }
  const difference = amountCents - filledTotal;
  return {
    filledCount,
    unfilledCount: drafts.length - filledCount,
    filledTotal,
    difference,
    complete: filledCount === drafts.length && difference === 0,
  };
}

/** 单笔费用金额校验：> 0 且不超过 ¥100,000 的安全整数分。 */
export function validateExpenseAmountCents(amountCents: number): DomainError | null {
  if (!Number.isSafeInteger(amountCents)) {
    return domainError('INVALID_AMOUNT', '金额必须是精确到分的整数', 'amount');
  }
  if (amountCents <= 0) {
    return domainError('INVALID_AMOUNT', '金额必须大于 0', 'amount');
  }
  if (amountCents > MAX_EXPENSE_CENTS) {
    return domainError('INVALID_AMOUNT', '单笔金额不能超过 ¥100,000', 'amount');
  }
  return null;
}
