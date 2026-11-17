import { describe, expect, it } from 'vitest';
import { splitEqualCents } from '../../../src/domain/ledger/split';
import { computeMemberBalances, getLedgerSummary } from '../../../src/domain/ledger/balances';
import { buildSettlementSuggestions } from '../../../src/domain/ledger/settlement';
import { applyLedgerCommand } from '../../../src/domain/ledger/commands';
import type { Expense, Settlement, Trip } from '../../../src/domain/types';
import { FIXED_NOW, makeContext, makeMember, makeTrip } from './fixtures';

/** 固定种子确定性 PRNG（mulberry32），失败信息中输出种子便于复现。 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SeededScenario {
  seed: number;
  memberIds: string[];
  expenses: Expense[];
}

function randomInt(random: () => number, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(random() * (maxInclusive - minInclusive + 1));
}

function generateScenario(seed: number): SeededScenario {
  const random = mulberry32(seed);
  const memberCount = randomInt(random, 2, 8);
  const memberIds = Array.from({ length: memberCount }, (_, index) => `m-${index}`);
  const expenseCount = randomInt(random, 1, 12);
  const expenses: Expense[] = [];
  for (let index = 0; index < expenseCount; index += 1) {
    const amount = randomInt(random, 1, 2_000_000);
    const payerId = memberIds[randomInt(random, 0, memberCount - 1)] as string;
    const participantCount = randomInt(random, 1, memberCount);
    // 参与人按 PRNG 顺序抽出（模拟任意勾选顺序），分配结果仍按 ID 排序
    const pool = [...memberIds];
    const participants: string[] = [];
    for (let pick = 0; pick < participantCount; pick += 1) {
      const position = randomInt(random, 0, pool.length - 1);
      participants.push(pool.splice(position, 1)[0] as string);
    }
    const useEqual = random() < 0.5;
    if (useEqual) {
      expenses.push({
        id: `e-${index}`,
        title: `费用${index}`,
        date: '2026-07-10',
        category: '餐饮',
        amount,
        payerId,
        splitMode: 'equal',
        allocations: splitEqualCents(amount, participants),
        createdAt: FIXED_NOW,
      });
    } else {
      // 随机切点生成自定义分配：非负、合计严格等于账单
      const cuts = [0, amount];
      for (let extra = 1; extra < participants.length; extra += 1) {
        cuts.push(randomInt(random, 0, amount));
      }
      cuts.sort((a, b) => a - b);
      const sortedParticipants = [...participants].sort();
      const allocations = sortedParticipants.map((memberId, position) => ({
        memberId,
        amount: (cuts[position + 1] as number) - (cuts[position] as number),
      }));
      expenses.push({
        id: `e-${index}`,
        title: `费用${index}`,
        date: '2026-07-10',
        category: '活动',
        amount,
        payerId,
        splitMode: 'custom',
        allocations,
        createdAt: FIXED_NOW,
      });
    }
  }
  return { seed, memberIds, expenses };
}

describe('固定种子不变量用例（开发文档 10.1）', () => {
  const seeds = Array.from({ length: 25 }, (_, index) => index + 1);

  it.each(seeds)('种子 %i：分摊和恒等于账单金额、余额和为零', (seed) => {
    const scenario = generateScenario(seed);
    for (const expense of scenario.expenses) {
      const total = expense.allocations.reduce((sum, row) => sum + row.amount, 0);
      expect(total, `seed=${seed} expense=${expense.id}`).toBe(expense.amount);
      expect(expense.allocations.every((row) => row.amount >= 0), `seed=${seed}`).toBe(true);
    }
    const balances = computeMemberBalances(scenario.memberIds, scenario.expenses);
    const totalBalance = balances.reduce((sum, row) => sum + row.balance, 0);
    expect(totalBalance, `seed=${seed} 余额总和应为 0`).toBe(0);
  });

  it.each(seeds)('种子 %i：建议全部记为结算后余额全为零', (seed) => {
    const scenario = generateScenario(seed);
    const members = scenario.memberIds.map((id) => makeMember(id));
    let trip: Trip = makeTrip({ members, expenses: scenario.expenses });
    const ctx = makeContext();
    let guard = 0;
    for (;;) {
      guard += 1;
      if (guard > 50) throw new Error(`seed=${seed} 建议应用循环次数异常`);
      const suggestions = buildSettlementSuggestions(
        computeMemberBalances(trip.members.map((m) => m.id), trip.expenses, trip.settlements),
      );
      if (suggestions.length === 0) break;
      const [first] = suggestions;
      if (first === undefined) break;
      const result = applyLedgerCommand(
        trip,
        {
          type: 'ledger.recordSettlement',
          commandId: `seed-${seed}-transfer-${guard}`,
          fromId: first.fromId,
          toId: first.toId,
          amount: first.amount,
        },
        ctx,
      );
      expect(result.ok, `seed=${seed} 第 ${guard} 笔建议应能记录`).toBe(true);
      if (!result.ok) return;
      trip = result.trip;
    }
    const summary = getLedgerSummary(
      trip.members.map((m) => m.id),
      trip.expenses,
      trip.settlements,
    );
    expect(
      summary.balances.every((row) => row.balance === 0),
      `seed=${seed} 全部建议应用后应结清`,
    ).toBe(true);
    expect(summary.totalBalance).toBe(0);
    // 记录全程费用不被修改
    expect(trip.expenses).toEqual(scenario.expenses);
  });

  it('同一输入重复生成完全一致（PRNG 确定性）', () => {
    expect(generateScenario(7)).toEqual(generateScenario(7));
    expect(generateScenario(7)).not.toEqual(generateScenario(8));
  });

  it('部分转账不破坏守恒：只记录部分建议后余额和仍为 0', () => {
    for (const seed of seeds.slice(0, 10)) {
      const scenario = generateScenario(seed);
      const members = scenario.memberIds.map((id) => makeMember(id));
      const trip: Trip = makeTrip({ members, expenses: scenario.expenses });
      const suggestions = buildSettlementSuggestions(
        computeMemberBalances(trip.members.map((m) => m.id), trip.expenses, []),
      );
      const partial = suggestions.slice(0, 1);
      const settlements: Settlement[] = partial.map((suggestion, index) => ({
        id: `s-${index}`,
        commandId: `c-${index}`,
        fromId: suggestion.fromId,
        toId: suggestion.toId,
        amount: suggestion.amount,
        recordedAt: FIXED_NOW,
        voidedAt: null,
      }));
      const balances = computeMemberBalances(trip.members.map((m) => m.id), trip.expenses, settlements);
      expect(balances.reduce((sum, row) => sum + row.balance, 0), `seed=${seed}`).toBe(0);
    }
  });
});
