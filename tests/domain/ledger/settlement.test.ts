import { describe, expect, it } from 'vitest';
import {
  buildSettlementSuggestions,
  validateSettlementRecording,
} from '../../../src/domain/ledger/settlement';
import { computeMemberBalances } from '../../../src/domain/ledger/balances';
import { makeCanonicalLedgerTrip } from './fixtures';

function canonicalBalances() {
  const trip = makeCanonicalLedgerTrip();
  return computeMemberBalances(trip.members.map((m) => m.id), trip.expenses, trip.settlements);
}

describe('buildSettlementSuggestions 转账建议（BR-12）', () => {
  it('验算：先建议 C→A ¥100，再 B→A ¥55（欠款大者在前，ID 升序稳定）', () => {
    expect(buildSettlementSuggestions(canonicalBalances())).toEqual([
      { fromId: 'm-c', toId: 'm-a', amount: 10_000 },
      { fromId: 'm-b', toId: 'm-a', amount: 5_500 },
    ]);
  });

  it('全部建议按序记为结算后余额全为 0，不再产生建议', () => {
    const trip = makeCanonicalLedgerTrip();
    const expenses = trip.expenses;
    let settlements = trip.settlements;
    for (const suggestion of buildSettlementSuggestions(
      computeMemberBalances(trip.members.map((m) => m.id), expenses, settlements),
    )) {
      settlements = [
        ...settlements,
        {
          id: `s-${suggestion.fromId}-${suggestion.toId}`,
          commandId: `cmd-${suggestion.fromId}-${suggestion.toId}`,
          fromId: suggestion.fromId,
          toId: suggestion.toId,
          amount: suggestion.amount,
          recordedAt: '2026-07-02T08:00:00.000Z',
          voidedAt: null,
        },
      ];
    }
    const balances = computeMemberBalances(trip.members.map((m) => m.id), expenses, settlements);
    expect(balances.every((row) => row.balance === 0)).toBe(true);
    expect(buildSettlementSuggestions(balances)).toEqual([]);
    expect(expenses).toHaveLength(2); // 结算不改费用
  });

  it('相同欠款/应收按 ID 升序配对，同一输入建议确定', () => {
    const balances = [
      { memberId: 'm-y', paid: 0, owed: 5_000, sent: 0, received: 0, balance: -5_000 },
      { memberId: 'm-x', paid: 0, owed: 5_000, sent: 0, received: 0, balance: -5_000 },
      { memberId: 'm-n', paid: 10_000, owed: 5_000, sent: 0, received: 0, balance: 5_000 },
      { memberId: 'm-m', paid: 10_000, owed: 5_000, sent: 0, received: 0, balance: 5_000 },
    ];
    const suggestions = buildSettlementSuggestions(balances);
    expect(suggestions).toEqual([
      { fromId: 'm-x', toId: 'm-m', amount: 5_000 },
      { fromId: 'm-y', toId: 'm-n', amount: 5_000 },
    ]);
    expect(buildSettlementSuggestions([...balances].reverse())).toEqual(suggestions);
  });

  it('空账本与全部结清时不生成虚构建议', () => {
    expect(buildSettlementSuggestions([])).toEqual([]);
    expect(
      buildSettlementSuggestions([
        { memberId: 'm-a', paid: 1, owed: 1, sent: 0, received: 0, balance: 0 },
      ]),
    ).toEqual([]);
  });

  it('部分记录后建议基于剩余额继续给出', () => {
    const trip = makeCanonicalLedgerTrip();
    const settlements = [
      {
        id: 's-1',
        commandId: 'cmd-1',
        fromId: 'm-c',
        toId: 'm-a',
        amount: 4_000,
        recordedAt: '2026-07-02T08:00:00.000Z',
        voidedAt: null,
      },
    ];
    const balances = computeMemberBalances(trip.members.map((m) => m.id), trip.expenses, settlements);
    expect(buildSettlementSuggestions(balances)).toEqual([
      { fromId: 'm-c', toId: 'm-a', amount: 6_000 },
      { fromId: 'm-b', toId: 'm-a', amount: 5_500 },
    ]);
  });
});

describe('validateSettlementRecording 记录校验（BR-12）', () => {
  it('只能从负余额转给正余额成员，方向不可反转', () => {
    const balances = canonicalBalances();
    // m-c（负）→ m-a（正）合法
    expect(validateSettlementRecording(balances, { fromId: 'm-c', toId: 'm-a', amount: 100 })).toBeNull();
    // 正 → 负 非法
    expect(
      validateSettlementRecording(balances, { fromId: 'm-a', toId: 'm-c', amount: 100 })?.code,
    ).toBe('SETTLEMENT_DIRECTION');
    // 负 → 负 非法
    expect(
      validateSettlementRecording(balances, { fromId: 'm-b', toId: 'm-c', amount: 100 })?.code,
    ).toBe('SETTLEMENT_DIRECTION');
  });

  it('金额不得超过双方当前剩余额', () => {
    const balances = canonicalBalances();
    // m-c 欠 10000，转 10001 给 m-a（应收 15500）超其欠款
    expect(
      validateSettlementRecording(balances, { fromId: 'm-c', toId: 'm-a', amount: 10_001 })?.code,
    ).toBe('SETTLEMENT_AMOUNT');
    // m-a 应收 15500，B 欠 5500：转 5501 超出欠款
    expect(
      validateSettlementRecording(balances, { fromId: 'm-b', toId: 'm-a', amount: 5_501 })?.code,
    ).toBe('SETTLEMENT_AMOUNT');
    // 部分金额（不超双方剩余额）允许
    expect(validateSettlementRecording(balances, { fromId: 'm-c', toId: 'm-a', amount: 1 })).toBeNull();
  });

  it('同一人不能转给自己；金额必须为正', () => {
    const balances = canonicalBalances();
    expect(
      validateSettlementRecording(balances, { fromId: 'm-c', toId: 'm-c', amount: 100 })?.code,
    ).toBe('SETTLEMENT_SELF');
    expect(
      validateSettlementRecording(balances, { fromId: 'm-c', toId: 'm-a', amount: 0 })?.code,
    ).toBe('SETTLEMENT_AMOUNT');
    expect(
      validateSettlementRecording(balances, { fromId: 'm-c', toId: 'm-a', amount: -5 })?.code,
    ).toBe('SETTLEMENT_AMOUNT');
  });

  it('余额为零或正的成员不能作为转出方', () => {
    const balances = [
      { memberId: 'm-a', paid: 0, owed: 0, sent: 0, received: 0, balance: 0 },
      { memberId: 'm-b', paid: 5_000, owed: 0, sent: 0, received: 0, balance: 5_000 },
    ];
    expect(
      validateSettlementRecording(balances, { fromId: 'm-a', toId: 'm-b', amount: 1 })?.code,
    ).toBe('SETTLEMENT_DIRECTION');
  });
});
