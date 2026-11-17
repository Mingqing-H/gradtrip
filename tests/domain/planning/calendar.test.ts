import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareDateOnly,
  diffInDays,
  fromDayNumber,
  intersectRanges,
  isDateInRange,
  isLeapYear,
  isValidDateOnly,
  mergeRanges,
  rangeContains,
  toDayNumber,
} from '../../../src/domain/planning/calendar';

describe('日期合法性', () => {
  it('接受真实存在的公历日期', () => {
    expect(isValidDateOnly('2026-07-01')).toBe(true);
    expect(isValidDateOnly('2028-02-29')).toBe(true); // 闰年
    expect(isValidDateOnly('2026-12-31')).toBe(true);
  });

  it('拒绝不存在的日期与错误格式', () => {
    expect(isValidDateOnly('2027-02-29')).toBe(false); // 平年
    expect(isValidDateOnly('2026-04-31')).toBe(false);
    expect(isValidDateOnly('2026-13-01')).toBe(false);
    expect(isValidDateOnly('2026-7-1')).toBe(false);
    expect(isValidDateOnly('')).toBe(false);
    expect(isValidDateOnly(null)).toBe(false);
    expect(isValidDateOnly(20260701)).toBe(false);
  });

  it('闰年规则', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2026)).toBe(false);
  });
});

describe('日期运算（自然日，不经 UTC/时区）', () => {
  it('跨月、跨年加减天数', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('toDayNumber / fromDayNumber 互逆', () => {
    for (const date of ['1970-01-01', '2026-07-01', '2000-02-29', '1999-12-31']) {
      expect(fromDayNumber(toDayNumber(date))).toBe(date);
    }
    expect(diffInDays('2026-07-04', '2026-07-01')).toBe(3);
    expect(diffInDays('2026-07-01', '2026-07-04')).toBe(-3);
  });

  it('比较与区间包含（含端点）', () => {
    expect(compareDateOnly('2026-07-01', '2026-07-02')).toBe(-1);
    expect(compareDateOnly('2026-07-02', '2026-07-02')).toBe(0);
    expect(compareDateOnly('2026-07-03', '2026-07-02')).toBe(1);
    expect(rangeContains({ start: '2026-07-01', end: '2026-07-05' }, { start: '2026-07-05', end: '2026-07-05' })).toBe(true);
    expect(rangeContains({ start: '2026-07-01', end: '2026-07-05' }, { start: '2026-07-01', end: '2026-07-06' })).toBe(false);
    expect(isDateInRange('2026-07-05', { start: '2026-07-01', end: '2026-07-05' })).toBe(true);
  });
});

describe('区间合并（BR-01）', () => {
  it('合并重叠区间', () => {
    expect(
      mergeRanges([
        { start: '2026-07-01', end: '2026-07-05' },
        { start: '2026-07-04', end: '2026-07-08' },
      ]),
    ).toEqual([{ start: '2026-07-01', end: '2026-07-08' }]);
  });

  it('合并自然相邻区间（前段止日 +1 = 后段起日）', () => {
    expect(
      mergeRanges([
        { start: '2026-07-01', end: '2026-07-03' },
        { start: '2026-07-04', end: '2026-07-06' },
      ]),
    ).toEqual([{ start: '2026-07-01', end: '2026-07-06' }]);
  });

  it('中间隔 1 天空白的区间不合并', () => {
    expect(
      mergeRanges([
        { start: '2026-07-01', end: '2026-07-03' },
        { start: '2026-07-05', end: '2026-07-06' },
      ]),
    ).toEqual([
      { start: '2026-07-01', end: '2026-07-03' },
      { start: '2026-07-05', end: '2026-07-06' },
    ]);
  });

  it('乱序输入按起日排序后合并；非法区间被过滤', () => {
    expect(
      mergeRanges([
        { start: '2026-07-10', end: '2026-07-12' },
        { start: '2026-07-01', end: '2026-07-03' },
        { start: '2026-07-03', end: '2026-07-05' },
        { start: '2026-08-01', end: '2026-07-30' }, // 起止颠倒
      ]),
    ).toEqual([
      { start: '2026-07-01', end: '2026-07-05' },
      { start: '2026-07-10', end: '2026-07-12' },
    ]);
  });

  it('多区间交集', () => {
    expect(
      intersectRanges([
        { start: '2026-07-01', end: '2026-07-10' },
        { start: '2026-07-05', end: '2026-07-20' },
      ]),
    ).toEqual({ start: '2026-07-05', end: '2026-07-10' });
    expect(
      intersectRanges([
        { start: '2026-07-01', end: '2026-07-04' },
        { start: '2026-07-06', end: '2026-07-20' },
      ]),
    ).toBeNull();
    expect(intersectRanges([])).toBeNull();
  });
});
