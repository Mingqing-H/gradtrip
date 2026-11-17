import { describe, expect, it } from 'vitest';
import {
  coversStay,
  findCommonDepartures,
  getDepartureConflicts,
  getMergedAvailability,
} from '../../../src/domain/planning/availability';
import { makeMember } from './fixtures';

const memberA = makeMember({ id: 'a', availability: [{ start: '2026-07-01', end: '2026-07-05' }] });
const memberB = makeMember({ id: 'b', availability: [{ start: '2026-07-03', end: '2026-07-06' }] });
const window = { start: '2026-07-01', end: '2026-07-31' };

describe('区间覆盖（BR-03）', () => {
  it('出行区间必须完整包含在单一合并区间内', () => {
    const ranges = getMergedAvailability(memberA);
    expect(coversStay(ranges, '2026-07-01', 3)).toBe(true); // [1,3] ⊆ [1,5]
    expect(coversStay(ranges, '2026-07-03', 3)).toBe(true); // [3,5] ⊆ [1,5]
    expect(coversStay(ranges, '2026-07-04', 3)).toBe(false); // [4,6] ⊄ [1,5]
  });

  it('两段中间有空白的区间不能拼成连续出行（R03）', () => {
    const member = makeMember({
      id: 'gap',
      availability: [
        { start: '2026-07-01', end: '2026-07-03' },
        { start: '2026-07-05', end: '2026-07-08' },
      ],
    });
    const ranges = getMergedAvailability(member);
    expect(coversStay(ranges, '2026-07-02', 4)).toBe(false); // 跨 7/4 空白
    expect(coversStay(ranges, '2026-07-05', 4)).toBe(true);
  });
});

describe('共同出发日（BR-03）', () => {
  it('规则样例：A 7/1～5、B 7/3～6、D=3 时仅 7/3 可行', () => {
    const result = findCommonDepartures([memberA, memberB], window, 3);
    expect(result.dates).toEqual(['2026-07-03']);
    expect(result.needsMoreInfo).toBe(false);
  });

  it('D=2 时交集内存在多个升序候选', () => {
    const result = findCommonDepartures([memberA, memberB], window, 2);
    // A 可出发 7/1～7/4，B 可出发 7/3～7/5；D=2 的交集为 7/3、7/4。
    expect(result.dates).toEqual(['2026-07-03', '2026-07-04']);
  });

  it('无交集返回空集合，不伪造可行方案', () => {
    const far = makeMember({ id: 'c', availability: [{ start: '2026-08-01', end: '2026-08-05' }] });
    expect(findCommonDepartures([memberA, far], window, 3).dates).toEqual([]);
  });

  it('候选升序且最多返回前 10 个', () => {
    const wide = makeMember({ id: 'w', availability: [{ start: '2026-07-01', end: '2026-07-31' }] });
    const result = findCommonDepartures([wide], window, 2);
    expect(result.dates).toHaveLength(10);
    expect(result.dates[0]).toBe('2026-07-01');
    expect(result.dates).toEqual([...result.dates].sort());
  });

  it('搜索窗口截断可行出发日（行程尾日须在窗口内）', () => {
    const wide = makeMember({ id: 'w', availability: [{ start: '2026-06-20', end: '2026-08-10' }] });
    const narrow = { start: '2026-07-01', end: '2026-07-04' };
    const result = findCommonDepartures([wide], narrow, 3);
    expect(result.dates).toEqual(['2026-07-01', '2026-07-02']);
  });

  it('资料不完整成员不参与交集，但标记待补全（BR-03）', () => {
    const incomplete = makeMember({ id: 'inc', budgetCap: null });
    const result = findCommonDepartures([memberA, memberB, incomplete], window, 3);
    expect(result.dates).toEqual(['2026-07-03']);
    expect(result.needsMoreInfo).toBe(true);
    expect(result.completeMemberIds).toEqual(['a', 'b']);
  });

  it('全员资料不完整时无候选', () => {
    const incomplete = makeMember({ id: 'inc', budgetCap: null });
    expect(findCommonDepartures([incomplete], window, 3).dates).toEqual([]);
  });
});

describe('指定出发日冲突详情（BR-03）', () => {
  it('逐人给出 覆盖/冲突/未知 与原因；无日期者为未知', () => {
    const noDates = makeMember({ id: 'nodate', availability: [] });
    const rows = getDepartureConflicts([memberA, memberB, noDates], '2026-07-01', 3);
    const byId = Object.fromEntries(rows.map((row) => [row.memberId, row]));
    expect(byId.a.time).toBe('pass');
    expect(byId.b.time).toBe('conflict');
    expect(byId.b.reason).toContain('不在可用范围');
    expect(byId.nodate.time).toBe('unknown');
    expect(byId.nodate.reason).toContain('未填写可用日期');
  });

  it('跨空白出发日说明原因', () => {
    const gap = makeMember({
      id: 'gap',
      availability: [
        { start: '2026-07-01', end: '2026-07-03' },
        { start: '2026-07-05', end: '2026-07-08' },
      ],
    });
    const rows = getDepartureConflicts([gap], '2026-07-02', 4);
    expect(rows[0].time).toBe('conflict');
    expect(rows[0].reason).toContain('空白');
  });
});
