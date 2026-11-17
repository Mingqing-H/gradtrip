/**
 * 日程活动纯函数：排序、时间校验、重叠提示、上下移动与范围外标识（BR-08）。
 *
 * 时间采用 HH:mm，按旅行当地自然日理解；起止同时为空合法，
 * 填写其一非法，结束必须晚于开始（因此不存在跨午夜条目，跨午夜需拆两条）。
 */
import type { Activity } from '../types';
import { compareIds } from '../ledger/split';
import { domainError, type DomainError } from '../ledger/errors';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type MoveDirection = 'up' | 'down';

/** 该活动是否已填写起止时间。 */
export function hasTime(activity: Pick<Activity, 'startTime' | 'endTime'>): boolean {
  return activity.startTime !== null && activity.endTime !== null;
}

/**
 * 起止时间合法性：同填同空；结束严格晚于开始。
 * 时间重叠仅提示不阻止保存（见 findTimeOverlaps）。
 */
export function validateActivityTime(
  startTime: string | null,
  endTime: string | null,
): DomainError | null {
  const hasStart = startTime !== null;
  const hasEnd = endTime !== null;
  if (!hasStart && !hasEnd) return null;
  if (hasStart !== hasEnd) {
    return domainError('TIME_INCOMPLETE', '起止时间需同时填写或同时留空', hasStart ? 'endTime' : 'startTime');
  }
  const start = startTime as string;
  const end = endTime as string;
  if (!TIME_PATTERN.test(start)) {
    return domainError('INVALID_TIME_FORMAT', '开始时间需为 HH:mm', 'startTime');
  }
  if (!TIME_PATTERN.test(end)) {
    return domainError('INVALID_TIME_FORMAT', '结束时间需为 HH:mm', 'endTime');
  }
  if (end <= start) {
    return domainError('TIME_ORDER', '结束时间必须晚于开始时间；跨午夜的活动请拆成两条', 'endTime');
  }
  return null;
}

/**
 * 同一天内的展示顺序：有时间活动在前，按（开始时间, 手动顺序, ID）；
 * 无时间活动排在其后，按（手动顺序, ID）。
 * 手动顺序只作同时间并列时的次级排序，不覆盖时间排序规则。
 */
export function compareActivitiesSameDay(a: Activity, b: Activity): number {
  const aTimed = hasTime(a);
  const bTimed = hasTime(b);
  if (aTimed !== bTimed) return aTimed ? -1 : 1;
  if (aTimed && bTimed) {
    const startDiff = (a.startTime as string).localeCompare(b.startTime as string);
    if (startDiff !== 0) return startDiff;
  }
  if (a.order !== b.order) return a.order - b.order;
  return compareIds(a.id, b.id);
}

/** 全量排序：日期升序（ISO 字典序即时间序），天内按 compareActivitiesSameDay。 */
export function sortActivities(activities: readonly Activity[]): Activity[] {
  return [...activities].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return compareActivitiesSameDay(a, b);
  });
}

/** 按天分组（供页面时间线渲染），天按日期升序。 */
export function groupActivitiesByDate(
  activities: readonly Activity[],
): Array<{ date: string; activities: Activity[] }> {
  const groups = new Map<string, Activity[]>();
  for (const activity of sortActivities(activities)) {
    const bucket = groups.get(activity.date);
    if (bucket === undefined) groups.set(activity.date, [activity]);
    else bucket.push(activity);
  }
  return [...groups.entries()].map(([date, dayActivities]) => ({ date, activities: dayActivities }));
}

/** 两天内活动时间是否按半开区间 [start, end) 重叠。 */
function timeOverlaps(a: Activity, b: Activity): boolean {
  if (!hasTime(a) || !hasTime(b)) return false;
  const aStart = a.startTime as string;
  const aEnd = a.endTime as string;
  const bStart = b.startTime as string;
  const bEnd = b.endTime as string;
  return aStart < bEnd && bStart < aEnd;
}

export interface ActivityOverlap {
  date: string;
  firstId: string;
  secondId: string;
}

/**
 * 找出同日内时间重叠的活动对（仅提示，不阻止保存）。
 * 半开区间判断：10:00 结束与 10:00 开始不算重叠。
 */
export function findTimeOverlaps(activities: readonly Activity[]): ActivityOverlap[] {
  const overlaps: ActivityOverlap[] = [];
  const byDate = new Map<string, Activity[]>();
  for (const activity of activities) {
    if (!hasTime(activity)) continue;
    const bucket = byDate.get(activity.date);
    if (bucket === undefined) byDate.set(activity.date, [activity]);
    else bucket.push(activity);
  }
  for (const [date, dayActivities] of byDate) {
    const sorted = [...dayActivities].sort(compareActivitiesSameDay);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const first = sorted[i] as Activity;
        const second = sorted[j] as Activity;
        if (timeOverlaps(first, second)) {
          overlaps.push({ date, firstId: first.id, secondId: second.id });
        }
      }
    }
  }
  return overlaps;
}

export type MoveResult =
  | { ok: true; activities: Activity[] }
  | { ok: false; error: DomainError };

/**
 * 上移/下移：只在同一天且同为“有时间/无时间”的组内交换手动顺序；
 * 到达组边界时返回带原因的错误。返回新数组，不修改入参。
 */
export function moveActivity(
  activities: readonly Activity[],
  activityId: string,
  direction: MoveDirection,
): MoveResult {
  const target = activities.find((activity) => activity.id === activityId);
  if (target === undefined) {
    return { ok: false, error: domainError('ACTIVITY_NOT_FOUND', '要移动的活动不存在', 'activityId') };
  }
  const group = sortActivities(
    activities.filter(
      (activity) =>
        activity.date === target.date && hasTime(activity) === hasTime(target),
    ),
  );
  const index = group.findIndex((activity) => activity.id === activityId);
  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= group.length) {
    const position = hasTime(target) ? '该时间段' : '未定时间';
    const edge = direction === 'up' ? '第一项' : '最后一项';
    return {
      ok: false,
      error: domainError(
        'MOVE_BOUNDARY',
        `已是当天${position}安排的${edge}，无法继续${direction === 'up' ? '上移' : '下移'}`,
      ),
    };
  }
  const neighbor = group[neighborIndex] as Activity;
  return {
    ok: true,
    activities: activities.map((activity) => {
      if (activity.id === target.id) return { ...activity, order: neighbor.order };
      if (activity.id === neighbor.id) return { ...activity, order: target.order };
      return activity;
    }),
  };
}

export interface DateRange {
  start: string;
  end: string;
}

/** 范围判断使用 ISO 字典序（合法 YYYY-MM-DD 下与自然日顺序一致），含首尾。 */
export function isDateInRange(date: string, range: DateRange): boolean {
  return range.start <= date && date <= range.end;
}

/**
 * 找出超出日程绑定日期范围的活动（更改方案日期后保留旧日程时标记，
 * 不自动搬移；导出正式快照前要求调整，BR-08）。
 */
export function findOutOfRangeActivities(
  activities: readonly Activity[],
  range: DateRange,
): Activity[] {
  return activities.filter((activity) => !isDateInRange(activity.date, range));
}
