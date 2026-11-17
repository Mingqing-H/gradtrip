import { describe, expect, it } from 'vitest';
import {
  splitEqualCents,
  summarizeCustomAllocations,
  validateExpenseAmountCents,
} from '../../../src/domain/ledger/split';

describe('splitEqualCents 均摊（BR-09）', () => {
  it('R05：¥100 三人均摊为 33.34 / 33.33 / 33.33，按 ID 升序分配尾差', () => {
    const result = splitEqualCents(10_000, ['m-a', 'm-b', 'm-c']);
    expect(result).toEqual([
      { memberId: 'm-a', amount: 3_334 },
      { memberId: 'm-b', amount: 3_333 },
      { memberId: 'm-c', amount: 3_333 },
    ]);
    expect(result.reduce((sum, row) => sum + row.amount, 0)).toBe(10_000);
  });

  it('余数按 ID 升序而非输入顺序分配', () => {
    const result = splitEqualCents(10_001, ['m-c', 'm-a', 'm-b']);
    expect(result).toEqual([
      { memberId: 'm-a', amount: 3_334 },
      { memberId: 'm-b', amount: 3_334 },
      { memberId: 'm-c', amount: 3_333 },
    ]);
  });

  it('单人参与时全额归该成员', () => {
    expect(splitEqualCents(1_234, ['only'])).toEqual([{ memberId: 'only', amount: 1_234 }]);
  });

  it('整除时无尾差', () => {
    const result = splitEqualCents(9_999, ['m-a', 'm-b', 'm-c']);
    expect(result.map((row) => row.amount)).toEqual([3_333, 3_333, 3_333]);
  });

  it('空参与人或非法金额直接抛错（调用方应先校验）', () => {
    expect(() => splitEqualCents(1_000, [])).toThrow();
    expect(() => splitEqualCents(0, ['m-a'])).toThrow();
    expect(() => splitEqualCents(-1, ['m-a'])).toThrow();
    expect(() => splitEqualCents(1.5, ['m-a'])).toThrow();
  });
});

describe('summarizeCustomAllocations 自定义分摊预览（BR-10）', () => {
  it('R06：合计差 ¥0.01 时 incomplete，差额显示为待分配', () => {
    const summary = summarizeCustomAllocations(10_000, [
      { memberId: 'm-a', amount: 3_400 },
      { memberId: 'm-b', amount: 3_300 },
      { memberId: 'm-c', amount: 3_299 },
    ]);
    expect(summary.complete).toBe(false);
    expect(summary.difference).toBe(1);
    expect(summary.unfilledCount).toBe(0);
  });

  it('未填写不能自动补 0，计入待填数', () => {
    const summary = summarizeCustomAllocations(10_000, [
      { memberId: 'm-a', amount: 5_000 },
      { memberId: 'm-b', amount: null },
    ]);
    expect(summary.unfilledCount).toBe(1);
    expect(summary.filledTotal).toBe(5_000);
    expect(summary.difference).toBe(5_000);
    expect(summary.complete).toBe(false);
  });

  it('允许某人为 0；全部填满且合计相等才算 complete', () => {
    const summary = summarizeCustomAllocations(10_000, [
      { memberId: 'm-a', amount: 0 },
      { memberId: 'm-b', amount: 10_000 },
    ]);
    expect(summary.complete).toBe(true);
    expect(summary.difference).toBe(0);
  });

  it('超出总额时差额为负', () => {
    const summary = summarizeCustomAllocations(10_000, [
      { memberId: 'm-a', amount: 6_000 },
      { memberId: 'm-b', amount: 5_000 },
    ]);
    expect(summary.difference).toBe(-1_000);
    expect(summary.complete).toBe(false);
  });
});

describe('validateExpenseAmountCents 金额边界（BR-09）', () => {
  it.each([0, -1, 10_000_001, 1.5, Number.MAX_SAFE_INTEGER + 1])('非法金额 %s 被拒绝', (amount) => {
    expect(validateExpenseAmountCents(amount)).not.toBeNull();
  });

  it.each([1, 10_000, 10_000_000])('合法金额 %s 通过', (amount) => {
    expect(validateExpenseAmountCents(amount)).toBeNull();
  });
});
