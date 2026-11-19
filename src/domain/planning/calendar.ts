// 自然日历纯函数：仅处理 YYYY-MM-DD 字符串，不经过 Date 对象或时区转换。
// 依据业务规则 BR-01/BR-03：日期按公历自然日运算。
// 说明：通用日期工具的最终归属是 T01 的 src/domain/dates.ts；本文件是 B0
// 合并前规划域自洽运行所需的最小实现，合并后如与 T01 工具重复，由 T01 决定收敛方式。

import type { DateOnly, Range } from './contract';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface Ymd {
  year: number;
  month: number; // 1～12
  day: number; // 1～31
}

/** 是否为格式合法且真实存在的公历日期。 */
export function isValidDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string') return false;
  if (!DATE_PATTERN.test(value)) return false;
  // Validation needs no capture array; this runs for every availability endpoint.
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * 公历日期 → 天数编号（基于 Howard Hinnant 的 civil 算法，纯整数运算）。
 * 同一日期编号恒定，可安全用于加减与比较。
 */
export function toDayNumber(date: DateOnly): number {
  const { year, month, day } = parseYmd(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  // 减去 719468 使 1970-01-01 = 0，与 fromDayNumber 的 +719468 配对。
  return era * 146097 + doe - 719468;
}

/** 天数编号 → 公历日期（toDayNumber 的逆运算）。 */
export function fromDayNumber(dayNumber: number): DateOnly {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  const year = month <= 2 ? y + 1 : y;
  return formatYmd({ year, month, day });
}

function parseYmd(date: DateOnly): Ymd {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`非法日期字符串: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatYmd({ year, month, day }: Ymd): DateOnly {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 加 n 个自然日（n 可为负）。 */
export function addDays(date: DateOnly, n: number): DateOnly {
  return fromDayNumber(toDayNumber(date) + n);
}

/** a - b 的自然日数；a 晚于 b 为正。 */
export function diffInDays(a: DateOnly, b: DateOnly): number {
  return toDayNumber(a) - toDayNumber(b);
}

/** 比较两个日期：a 早于 b 返回 -1，相等 0，晚于 1。 */
export function compareDateOnly(a: DateOnly, b: DateOnly): -1 | 0 | 1 {
  const na = toDayNumber(a);
  const nb = toDayNumber(b);
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/** 是否为有效日期区间（起日均不晚于止日）。 */
export function isValidRange(range: Range): boolean {
  return isValidDateOnly(range.start) && isValidDateOnly(range.end) && range.start <= range.end;
}

/**
 * 合并重叠或自然相邻（前一段止日 +1 = 后一段起日）的区间（BR-01）。
 * 输入不做修改，返回按起日升序的新数组；起止颠倒的区间被过滤。
 */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  const valid = ranges.filter(isValidRange).map((r) => ({ ...r }));
  valid.sort((a, b) => compareDateOnly(a.start, b.start));
  const merged: Range[] = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && diffInDays(range.start, last.end) <= 1) {
      if (compareDateOnly(range.end, last.end) > 0) last.end = range.end;
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** 外层区间是否完整包含内层区间（含端点）。 */
export function rangeContains(outer: Range, inner: Range): boolean {
  return compareDateOnly(inner.start, outer.start) >= 0 && compareDateOnly(inner.end, outer.end) <= 0;
}

/** 多个区间的交集；无交集返回 null。输入需已合法。 */
export function intersectRanges(ranges: readonly Range[]): Range | null {
  if (ranges.length === 0) return null;
  let start = ranges[0].start;
  let end = ranges[0].end;
  for (const range of ranges.slice(1)) {
    if (compareDateOnly(range.start, start) > 0) start = range.start;
    if (compareDateOnly(range.end, end) < 0) end = range.end;
    if (compareDateOnly(start, end) > 0) return null;
  }
  return compareDateOnly(start, end) <= 0 ? { start, end } : null;
}

/** 区间内的日期列表（区间过长时调用方需自行限制规模）。 */
export function rangeToDates(range: Range): DateOnly[] {
  const dates: DateOnly[] = [];
  for (let n = toDayNumber(range.start); n <= toDayNumber(range.end); n += 1) {
    dates.push(fromDayNumber(n));
  }
  return dates;
}

/** today 是否在 [start, end] 内（含端点）。 */
export function isDateInRange(date: DateOnly, range: Range): boolean {
  return compareDateOnly(date, range.start) >= 0 && compareDateOnly(date, range.end) <= 0;
}
