// 成员可用日期与共同出发日（BR-01 / BR-03）：
// - 区间先合并（重叠或相邻），再参与共同日期计算；
// - 成员匹配方案 ⇔ [出发日, 出发日 + D - 1] 完整包含在其某个合并区间内；
// - 资料不完整成员不参与交集，但使结果标记“待补全后确认”。

import {
  addDays,
  compareDateOnly,
  diffInDays,
  isValidDateOnly,
  isValidRange,
  mergeRanges,
  rangeContains,
  toDayNumber,
  fromDayNumber,
} from './calendar';
import type { DateOnly, Id, Member, Range } from './contract';
import type { CommonDepartures, DepartureConflictRow, MemberProfileStatus } from './types';
import { getMemberProfileStatus } from './profile';

/** 候选共同出发日最多展示前 10 个（BR-03）。 */
export const MAX_COMMON_DEPARTURES = 10;

/** 成员的合并后可用区间（输入区间不合法时被过滤）。 */
export function getMergedAvailability(member: Member): Range[] {
  return mergeRanges(member.availability ?? []);
}

/** 资料完整成员的可用区间是否完整覆盖 [date, date + days - 1]。 */
export function coversStay(ranges: readonly Range[], startDate: DateOnly, days: number): boolean {
  const end = addDays(startDate, days - 1);
  return ranges.some((range) => rangeContains(range, { start: startDate, end }));
}

/**
 * 共同出发日搜索：在搜索窗口内寻找所有资料完整成员都能覆盖的出发日。
 * 只使用资料完整成员的日期；任何资料不完整成员都会置 needsMoreInfo，
 * 但不改变已算出的交集（BR-03：待补全后确认，不自动排除成员）。
 */
export function findCommonDepartures(
  members: readonly Member[],
  searchWindow: Range,
  days: number,
): CommonDepartures {
  const complete = members.filter((m) => getMemberProfileStatus(m) === 'complete');
  const needsMoreInfo = complete.length < members.length;

  let candidateDays: number[] = [];
  if (complete.length > 0) {
    // 每位成员可行出发日的并集（按合并区间），再跨成员取交集。
    candidateDays = windowDayNumbers(searchWindow, days);
    for (const member of complete) {
      if (candidateDays.length === 0) break;
      const departures = new Set<number>();
      for (const range of getMergedAvailability(member)) {
        const lastStart = toDayNumber(range.end) - (days - 1);
        for (let n = toDayNumber(range.start); n <= lastStart; n += 1) departures.add(n);
      }
      candidateDays = candidateDays.filter((n) => departures.has(n));
    }
  }

  return {
    dates: candidateDays.sort((a, b) => a - b).slice(0, MAX_COMMON_DEPARTURES).map(fromDayNumber),
    needsMoreInfo,
    completeMemberIds: complete.map((m) => m.id),
  };
}

/** 搜索窗口内可作为出发日的日期编号（保证 [d, d+D-1] 仍在窗口内）。 */
function windowDayNumbers(searchWindow: Range, days: number): number[] {
  if (!isValidRange(searchWindow)) return [];
  const first = toDayNumber(searchWindow.start);
  const last = toDayNumber(searchWindow.end) - (days - 1);
  const numbers: number[] = [];
  for (let n = first; n <= last; n += 1) numbers.push(n);
  return numbers;
}

/**
 * 查看某个指定出发日的逐人冲突详情（BR-03：无共同日期或另选日期时使用）。
 * 不修改任何成员，不自动排除成员。
 */
export function getDepartureConflicts(
  members: readonly Member[],
  startDate: DateOnly,
  days: number,
): DepartureConflictRow[] {
  return members.map((member) => {
    const profile = getMemberProfileStatus(member);
    const mergedRanges = getMergedAvailability(member);
    const row: DepartureConflictRow = {
      memberId: member.id,
      profile,
      time: 'unknown',
      reason: null,
      mergedRanges,
    };
    if (!isValidDateOnly(startDate)) {
      row.reason = '出发日期无效';
      return row;
    }
    if (mergedRanges.length === 0) {
      row.reason = '未填写可用日期';
      return row;
    }
    if (coversStay(mergedRanges, startDate, days)) {
      row.time = 'pass';
      return row;
    }
    row.time = 'conflict';
    const end = addDays(startDate, days - 1);
    if (
      compareDateOnly(end, mergedRanges[0].start) < 0 ||
      compareDateOnly(startDate, mergedRanges[mergedRanges.length - 1].end) > 0
    ) {
      row.reason = '出行日期不在可用范围内';
    } else {
      row.reason = '出行日期跨越了成员可用日期之间的空白';
    }
    return row;
  });
}

/**
 * 成员在某个出发方案下的时间状态：只取决于可用日期本身（BR-05）。
 * 日期缺失或全部非法时为 unknown；日期已知即判定 pass/conflict，
 * 不因预算等其他资料缺失而隐藏已知的时间冲突。
 */
export function getTimeState(
  member: Pick<Member, 'availability'>,
  startDate: DateOnly,
  days: number,
): 'pass' | 'conflict' | 'unknown' {
  const merged = getMergedAvailability(member);
  if (merged.length === 0) return 'unknown';
  return coversStay(merged, startDate, days) ? 'pass' : 'conflict';
}

/** 可用日期跨度（自然日数，含端点）；无有效区间为 0。仅用于展示摘要。 */
export function availabilitySpanDays(member: Member): number {
  return getMergedAvailability(member).reduce(
    (sum, range) => sum + (diffInDays(range.end, range.start) + 1),
    0,
  );
}

/** 收集资料不完整成员 ID。 */
export function findIncompleteMemberIds(members: readonly Member[]): Id[] {
  return members.filter((m) => getMemberProfileStatus(m) === 'incomplete').map((m) => m.id);
}
