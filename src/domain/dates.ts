import type { DateOnly, Range } from './types';
const DAY = 86_400_000;
export function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}
export function addDays(date: DateOnly, days: number): DateOnly {
  if (!isDateOnly(date) || !Number.isSafeInteger(days)) throw new RangeError('日期或天数无效');
  const result = new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
  if (!isDateOnly(result)) throw new RangeError('日期超出支持范围');
  return result;
}
export function daysBetween(start: DateOnly, end: DateOnly): number {
  if (!isDateOnly(start) || !isDateOnly(end)) throw new RangeError('日期无效');
  return (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / DAY;
}
export function containsRange(outer: Range, inner: Range): boolean {
  return outer.start <= inner.start && outer.end >= inner.end && inner.start <= inner.end;
}
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.map(range => {
    if (!isDateOnly(range.start) || !isDateOnly(range.end) || range.start > range.end) throw new RangeError('日期区间无效');
    return { ...range };
  }).sort((a, b) => a.start.localeCompare(b.start));
  const result: Range[] = [];
  for (const range of sorted) {
    const last = result.at(-1);
    if (last && daysBetween(last.end, range.start) <= 1) last.end = last.end > range.end ? last.end : range.end;
    else result.push(range);
  }
  return result;
}

// Compatibility names used by the itinerary/ledger public entry points.
export const isValidDateOnly = isDateOnly;
export const diffDays = daysBetween;
