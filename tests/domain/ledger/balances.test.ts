import { describe, expect, it } from 'vitest';
import {
  computeMemberBalances,
  getLedgerSummary,
  isActiveSettlement,
} from '../../../src/domain/ledger/balances';
import {
  makeCanonicalLedgerTrip,
  makeExpense,
  makeSettlement,
} from './fixtures';

describe('computeMemberBalances 余额计算（BR-11）', () => {
  it('BR-12 验算：A +155 / B -55 / C -100（分：+15500/-5500/-10000）', () => {
    const trip = makeCanonicalLedgerTrip();
    const rows = computeMemberBalances(
      trip.members.map((member) => member.id),
      trip.expenses,
    );
    const byId = new Map(rows.map((row) => [row.memberId, row]));
    expect(byId.get('m-a')?.balance).toBe(15_500);
    expect(byId.get('m-b')?.balance).toBe(-5_500);
    expect(byId.get('m-c')?.balance).toBe(-10_000);
    // 来源拆分：A 已付 300、应承担 145；B 已付 90、应承担 145；C 已付 0、应承担 100
    expect(byId.get('m-a')).toMatchObject({ paid: 30_000, owed: 14_500, sent: 0, received: 0 });
    expect(byId.get('m-b')).toMatchObject({ paid: 9_000, owed: 14_500 });
    expect(byId.get('m-c')).toMatchObject({ paid: 0, owed: 10_000 });
  });

  it('R07：垫付人不参与消费时已付增加、应承担为 0', () => {
    const rows = computeMemberBalances(
      ['m-a', 'm-b'],
      [
        makeExpense('e-1', {
          amount: 10_000,
          payerId: 'm-a',
          allocations: [{ memberId: 'm-b', amount: 10_000 }],
        }),
      ],
    );
    const byId = new Map(rows.map((row) => [row.memberId, row]));
    expect(byId.get('m-a')).toMatchObject({ paid: 10_000, owed: 0, balance: 10_000 });
    expect(byId.get('m-b')).toMatchObject({ paid: 0, owed: 10_000, balance: -10_000 });
  });

  it('不参与人不承担费用（C 不承担仅 A、B 参与的 ¥90）', () => {
    const trip = makeCanonicalLedgerTrip();
    const rows = computeMemberBalances(trip.members.map((m) => m.id), trip.expenses);
    expect(rows.find((row) => row.memberId === 'm-c')?.owed).toBe(10_000);
  });

  it('有效结算改变余额：C→A ¥100 后 A +55、B -55、C 0', () => {
    const trip = makeCanonicalLedgerTrip();
    const settlements = [
      makeSettlement('s-1', { fromId: 'm-c', toId: 'm-a', amount: 10_000 }),
    ];
    const rows = computeMemberBalances(trip.members.map((m) => m.id), trip.expenses, settlements);
    const byId = new Map(rows.map((row) => [row.memberId, row]));
    expect(byId.get('m-a')?.balance).toBe(5_500);
    expect(byId.get('m-b')?.balance).toBe(-5_500);
    expect(byId.get('m-c')?.balance).toBe(0);
  });

  it('已撤销结算保留历史但不计入余额', () => {
    const trip = makeCanonicalLedgerTrip();
    const settlements = [
      makeSettlement('s-1', {
        fromId: 'm-c',
        toId: 'm-a',
        amount: 10_000,
        voidedAt: '2026-07-02T08:00:00.000Z',
      }),
    ];
    const rows = computeMemberBalances(trip.members.map((m) => m.id), trip.expenses, settlements);
    const byId = new Map(rows.map((row) => [row.memberId, row]));
    expect(byId.get('m-a')?.balance).toBe(15_500);
    expect(byId.get('m-c')?.balance).toBe(-10_000);
    expect(isActiveSettlement(settlements[0] as (typeof settlements)[number])).toBe(false);
  });

  it('余额总和恒为 0（守恒不变量）', () => {
    const trip = makeCanonicalLedgerTrip();
    const rows = computeMemberBalances(
      trip.members.map((m) => m.id),
      trip.expenses,
      [makeSettlement('s-1', { fromId: 'm-b', toId: 'm-a', amount: 5_500 })],
    );
    expect(rows.reduce((sum, row) => sum + row.balance, 0)).toBe(0);
  });

  it('同一输入产生同一输出（行按 ID 升序）', () => {
    const trip = makeCanonicalLedgerTrip();
    const ids = ['m-c', 'm-a', 'm-b'];
    const first = computeMemberBalances(ids, trip.expenses);
    const second = computeMemberBalances(ids, trip.expenses);
    expect(first).toEqual(second);
    expect(first.map((row) => row.memberId)).toEqual(['m-a', 'm-b', 'm-c']);
  });
});

describe('getLedgerSummary 汇总（BR-11）', () => {
  it('统计实际总支出、笔数与结算状态', () => {
    const trip = makeCanonicalLedgerTrip();
    const summary = getLedgerSummary(
      trip.members.map((m) => m.id),
      trip.expenses,
      [
        makeSettlement('s-1', { fromId: 'm-c', toId: 'm-a', amount: 10_000 }),
        makeSettlement('s-2', {
          fromId: 'm-b',
          toId: 'm-a',
          amount: 5_500,
          voidedAt: '2026-07-02T08:00:00.000Z',
        }),
      ],
    );
    expect(summary.expenseCount).toBe(2);
    expect(summary.totalExpense).toBe(39_000);
    expect(summary.hasActiveSettlement).toBe(true);
    expect(summary.activeSettlementCount).toBe(1);
    expect(summary.voidedSettlementCount).toBe(1);
    expect(summary.totalBalance).toBe(0);
  });

  it('空账本全部为 0，不虚构数据', () => {
    const summary = getLedgerSummary(['m-a'], [], []);
    expect(summary.expenseCount).toBe(0);
    expect(summary.totalExpense).toBe(0);
    expect(summary.hasActiveSettlement).toBe(false);
    expect(summary.balances).toEqual([
      { memberId: 'm-a', paid: 0, owed: 0, sent: 0, received: 0, balance: 0 },
    ]);
  });
});
