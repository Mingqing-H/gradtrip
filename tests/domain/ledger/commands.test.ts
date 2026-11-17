import { describe, expect, it } from 'vitest';
import { applyLedgerCommand } from '../../../src/domain/ledger/commands';
import { getLedgerSummary } from '../../../src/domain/ledger/balances';
import {
  makeCanonicalLedgerTrip,
  makeContext,
  makeExpense,
  makeSettlement,
  makeTrip,
} from './fixtures';

function equalDraft(overrides: Record<string, unknown> = {}) {
  return {
    title: '打车',
    date: '2026-07-10',
    category: '交通',
    amount: 9_000,
    payerId: 'm-b',
    splitMode: 'equal' as const,
    participantIds: ['m-a', 'm-b', 'm-c'],
    ...overrides,
  };
}

describe('ledger.addExpense（BR-09）', () => {
  it('均摊保存最终分配明细（¥90 三人 = 30/30/30），不修改原 Trip', () => {
    const trip = makeTrip();
    const before = JSON.parse(JSON.stringify(trip)) as typeof trip;
    const result = applyLedgerCommand(
      trip,
      { type: 'ledger.addExpense', commandId: 'cmd-1', draft: equalDraft() },
      makeContext(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.expenses).toHaveLength(1);
    const expense = result.trip.expenses[0]!;
    expect(expense.allocations).toEqual([
      { memberId: 'm-a', amount: 3_000 },
      { memberId: 'm-b', amount: 3_000 },
      { memberId: 'm-c', amount: 3_000 },
    ]);
    expect(expense.createdAt).toBe('2026-07-01T10:00:00.000Z');
    expect(trip).toEqual(before);
  });

  it.each([
    ['金额为 0', { amount: 0 }, 'INVALID_AMOUNT'],
    ['金额超上限', { amount: 10_000_001 }, 'INVALID_AMOUNT'],
    ['名称为空', { title: '  ' }, 'INVALID_TITLE'],
    ['日期非法', { date: '2026-02-30' }, 'INVALID_DATE'],
    ['垫付人不存在', { payerId: 'm-z' }, 'UNKNOWN_MEMBER'],
    ['无参与人', { participantIds: [] }, 'EMPTY_PARTICIPANTS'],
    ['参与人不存在', { participantIds: ['m-a', 'm-z'] }, 'UNKNOWN_MEMBER'],
    ['参与人重复', { participantIds: ['m-a', 'm-a'] }, 'DUPLICATE_PARTICIPANT'],
  ])('校验失败：%s → %s', (_name, overrides, code) => {
    const result = applyLedgerCommand(
      makeTrip(),
      { type: 'ledger.addExpense', commandId: 'cmd-1', draft: equalDraft(overrides) },
      makeContext(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
  });

  it('自定义分摊合计等于账单时通过；相差 1 分被阻止（R06）', () => {
    const custom = (allocations: Array<{ memberId: string; amount: number }>) => ({
      title: '门票',
      date: '2026-07-11',
      category: '活动',
      amount: 10_000,
      payerId: 'm-c',
      splitMode: 'custom' as const,
      allocations,
    });
    const okResult = applyLedgerCommand(
      makeTrip(),
      {
        type: 'ledger.addExpense',
        commandId: 'cmd-1',
        draft: custom([
          { memberId: 'm-a', amount: 4_000 },
          { memberId: 'm-b', amount: 3_000 },
          { memberId: 'm-c', amount: 3_000 },
        ]),
      },
      makeContext(),
    );
    expect(okResult.ok).toBe(true);

    const badResult = applyLedgerCommand(
      makeTrip(),
      {
        type: 'ledger.addExpense',
        commandId: 'cmd-2',
        draft: custom([
          { memberId: 'm-a', amount: 4_000 },
          { memberId: 'm-b', amount: 3_000 },
          { memberId: 'm-c', amount: 2_999 },
        ]),
      },
      makeContext(),
    );
    expect(badResult.ok).toBe(false);
    if (badResult.ok) return;
    expect(badResult.error.code).toBe('ALLOCATION_SUM_MISMATCH');
    expect(badResult.error.message).toContain('0.01');
  });

  it('自定义允许某人为 0；负数或空明细被拒绝', () => {
    const base = { title: '门票', date: '2026-07-11', category: '活动', amount: 10_000, payerId: 'm-c' };
    const zeroOk = applyLedgerCommand(
      makeTrip(),
      {
        type: 'ledger.addExpense',
        commandId: 'cmd-1',
        draft: {
          ...base,
          splitMode: 'custom',
          allocations: [
            { memberId: 'm-a', amount: 0 },
            { memberId: 'm-b', amount: 10_000 },
          ],
        },
      },
      makeContext(),
    );
    expect(zeroOk.ok).toBe(true);

    const negative = applyLedgerCommand(
      makeTrip(),
      {
        type: 'ledger.addExpense',
        commandId: 'cmd-2',
        draft: {
          ...base,
          splitMode: 'custom',
          allocations: [
            { memberId: 'm-a', amount: -1 },
            { memberId: 'm-b', amount: 10_001 },
          ],
        },
      },
      makeContext(),
    );
    expect(negative.ok).toBe(false);
    if (negative.ok) return;
    expect(negative.error.code).toBe('ALLOCATION_INVALID');

    const empty = applyLedgerCommand(
      makeTrip(),
      {
        type: 'ledger.addExpense',
        commandId: 'cmd-3',
        draft: { ...base, splitMode: 'custom', allocations: [] },
      },
      makeContext(),
    );
    expect(empty.ok).toBe(false);
  });

  it('达到 200 笔上限后拒绝新增（LIMIT_EXPENSES）', () => {
    const expenses = Array.from({ length: 200 }, (_, index) =>
      makeExpense(`e-${index}`, { amount: 300, payerId: 'm-a', splitMode: 'equal', allocations: [{ memberId: 'm-a', amount: 300 }] }),
    );
    const result = applyLedgerCommand(
      makeTrip({ expenses }),
      { type: 'ledger.addExpense', commandId: 'cmd-1', draft: equalDraft() },
      makeContext(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIMIT_EXPENSES');
  });
});

describe('ledger.updateExpense / removeExpense', () => {
  it('修改费用重算分摊并保留 id/createdAt', () => {
    const trip = makeTrip({
      expenses: [makeExpense('e-1', { createdAt: '2026-07-01T00:00:00.000Z' })],
    });
    const result = applyLedgerCommand(
      trip,
      {
        type: 'ledger.updateExpense',
        commandId: 'cmd-1',
        expenseId: 'e-1',
        draft: { ...equalDraft(), amount: 30_000, title: '住宿改记' },
      },
      makeContext(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.expenses[0]).toMatchObject({
      id: 'e-1',
      title: '住宿改记',
      amount: 30_000,
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    expect(result.trip.expenses[0]!.allocations.reduce((s, a) => s + a.amount, 0)).toBe(30_000);
  });

  it('修改不存在的费用返回 EXPENSE_NOT_FOUND', () => {
    const result = applyLedgerCommand(
      makeTrip(),
      { type: 'ledger.updateExpense', commandId: 'cmd-1', expenseId: 'nope', draft: equalDraft() },
      makeContext(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXPENSE_NOT_FOUND');
  });

  it('删除费用成功；不存在时返回错误', () => {
    const trip = makeTrip({ expenses: [makeExpense('e-1')] });
    const removed = applyLedgerCommand(
      trip,
      { type: 'ledger.removeExpense', commandId: 'cmd-1', expenseId: 'e-1' },
      makeContext(),
    );
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.trip.expenses).toHaveLength(0);
    const missing = applyLedgerCommand(
      makeTrip(),
      { type: 'ledger.removeExpense', commandId: 'cmd-2', expenseId: 'nope' },
      makeContext(),
    );
    expect(missing.ok).toBe(false);
  });
});

describe('ledger.recordSettlement / voidAllSettlements（BR-12）', () => {
  it('记录合法转账后余额与建议重算；重复 commandId 被拒绝', () => {
    const trip = makeCanonicalLedgerTrip();
    const ctx = makeContext();
    const result = applyLedgerCommand(
      trip,
      { type: 'ledger.recordSettlement', commandId: 'cmd-s1', fromId: 'm-c', toId: 'm-a', amount: 10_000 },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = getLedgerSummary(
      result.trip.members.map((m) => m.id),
      result.trip.expenses,
      result.trip.settlements,
    );
    expect(summary.hasActiveSettlement).toBe(true);
    const byId = new Map(summary.balances.map((row) => [row.memberId, row]));
    expect(byId.get('m-c')?.balance).toBe(0);

    const duplicate = applyLedgerCommand(
      result.trip,
      { type: 'ledger.recordSettlement', commandId: 'cmd-s1', fromId: 'm-c', toId: 'm-a', amount: 10_000 },
      ctx,
    );
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.error.code).toBe('DUPLICATE_COMMAND');
  });

  it('方向、金额、自身转账校验在 handler 层生效', () => {
    const trip = makeCanonicalLedgerTrip();
    const cases: Array<[string, { fromId: string; toId: string; amount: number }, string]> = [
      ['正余额转出', { fromId: 'm-a', toId: 'm-c', amount: 100 }, 'SETTLEMENT_DIRECTION'],
      ['超剩余额', { fromId: 'm-c', toId: 'm-a', amount: 10_001 }, 'SETTLEMENT_AMOUNT'],
      ['转给自己', { fromId: 'm-c', toId: 'm-c', amount: 100 }, 'SETTLEMENT_SELF'],
    ];
    for (const [name, payload, code] of cases) {
      const result = applyLedgerCommand(
        trip,
        { type: 'ledger.recordSettlement', commandId: `cmd-${name}`, ...payload },
        makeContext(),
      );
      expect(result.ok, `用例 ${name} 应失败`).toBe(false);
      if (result.ok) return;
      expect(result.error.code, `用例 ${name}`).toBe(code);
    }
  });

  it('R08：存在有效结算时新增/修改/删除费用均被锁定，错误指向撤销路径', () => {
    const trip = makeCanonicalLedgerTrip({
      settlements: [makeSettlement('s-1', { fromId: 'm-c', toId: 'm-a', amount: 10_000 })],
    });
    const ctx = makeContext();
    const attempts = [
      applyLedgerCommand(trip, { type: 'ledger.addExpense', commandId: 'c1', draft: equalDraft() }, ctx),
      applyLedgerCommand(
        trip,
        { type: 'ledger.updateExpense', commandId: 'c2', expenseId: 'e-1', draft: equalDraft() },
        ctx,
      ),
      applyLedgerCommand(trip, { type: 'ledger.removeExpense', commandId: 'c3', expenseId: 'e-1' }, ctx),
    ];
    for (const result of attempts) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('EXPENSE_LOCKED');
      expect(result.error.message).toContain('撤销');
    }
  });

  it('完整更正流程：撤销全部结算 → 修改费用 → 重新登记（撤销记录保留且不参与计算）', () => {
    const trip = makeCanonicalLedgerTrip({
      settlements: [makeSettlement('s-1', { fromId: 'm-c', toId: 'm-a', amount: 10_000 })],
    });
    const ctx = makeContext('2026-07-03T09:00:00.000Z');
    const voided = applyLedgerCommand(trip, { type: 'ledger.voidAllSettlements', commandId: 'c-void' }, ctx);
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;
    expect(voided.trip.settlements[0]!.voidedAt).toBe('2026-07-03T09:00:00.000Z');

    // 撤销后费用解锁，可修改
    const edited = applyLedgerCommand(
      voided.trip,
      {
        type: 'ledger.updateExpense',
        commandId: 'c-edit',
        expenseId: 'e-1',
        draft: { ...equalDraft(), amount: 30_000, title: '住宿更正' },
      },
      ctx,
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    // 按真实情况重新登记：先结清更正后的余额（此时 B、C 各欠更正后金额）
    const balances = getLedgerSummary(
      edited.trip.members.map((m) => m.id),
      edited.trip.expenses,
      edited.trip.settlements,
    );
    const debtor = balances.balances.find((row) => row.balance < 0);
    const creditor = balances.balances.find((row) => row.balance > 0);
    expect(debitPair(debtor, creditor)).toBe(true);
    if (debtor === undefined || creditor === undefined) return;
    const recorded = applyLedgerCommand(
      edited.trip,
      {
        type: 'ledger.recordSettlement',
        commandId: 'c-new-transfer',
        fromId: debtor.memberId,
        toId: creditor.memberId,
        amount: Math.min(-debtor.balance, creditor.balance),
      },
      ctx,
    );
    expect(recorded.ok).toBe(true);
    // 撤销记录保留在历史中，不计入余额
    if (recorded.ok) expect(recorded.trip.settlements.some((s) => s.voidedAt !== null)).toBe(true);
  });

  it('无有效结算时撤销返回错误；不允许对已撤销记录再撤销', () => {
    const clean = applyLedgerCommand(
      makeTrip(),
      { type: 'ledger.voidAllSettlements', commandId: 'c-1' },
      makeContext(),
    );
    expect(clean.ok).toBe(false);
    if (clean.ok) return;
    expect(clean.error.code).toBe('NO_ACTIVE_SETTLEMENTS');

    const allVoided = makeCanonicalLedgerTrip({
      settlements: [makeSettlement('s-1', { voidedAt: '2026-07-02T00:00:00.000Z' })],
    });
    const again = applyLedgerCommand(
      allVoided,
      { type: 'ledger.voidAllSettlements', commandId: 'c-2' },
      makeContext(),
    );
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('NO_ACTIVE_SETTLEMENTS');
  });
});

function debitPair(debtor: { balance: number } | undefined, creditor: { balance: number } | undefined): boolean {
  return debtor !== undefined && creditor !== undefined && debtor.balance < 0 && creditor.balance > 0;
}
