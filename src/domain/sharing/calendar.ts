/**
 * 分享域内部的自然日小工具，仅服务于本域 schema 与构建函数的白名单校验。
 *
 * 按公历自然日处理，不把日期字符串经本地时区转换（构造 UTC 零点只做
 * 纯日历运算，读取时也只取 UTC 日期部分，结果与任何时区无关）。
 * B0 的通用 dates.ts 到位后如提供等价能力，可改为委托（见 docs/gitworktree.md 4.1）。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** 自然日加法；输入必须已通过 isCalendarDate。 */
export function addDays(date: string, days: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const utc = Date.UTC(year, month - 1, day) + days * 86_400_000;
  const next = new Date(utc);
  const y = next.getUTCFullYear();
  const m = next.getUTCMonth() + 1;
  const d = next.getUTCDate();
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

/** YYYY-MM-DD 的字典序即自然日顺序，可直接字符串比较。 */
export function isWithinRange(date: string, range: { start: string; end: string }): boolean {
  return date >= range.start && date <= range.end;
}

/** 区间端点归一排序：起日不得晚于止日由 schema 保证，这里只做包含判断辅助。 */
export function planDateRange(startDate: string, days: number): { start: string; end: string } {
  return { start: startDate, end: addDays(startDate, days - 1) };
}
