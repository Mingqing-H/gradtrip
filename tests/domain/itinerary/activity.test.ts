import { describe, expect, it } from 'vitest';
import {
  findOutOfRangeActivities,
  findTimeOverlaps,
  groupActivitiesByDate,
  moveActivity,
  sortActivities,
  validateActivityTime,
} from '../../../src/domain/itinerary/activity';
import { makeActivity } from '../ledger/fixtures';

describe('validateActivityTime 时间校验（BR-08）', () => {
  it('同填同空：两者都空合法；只填一个阻止保存', () => {
    expect(validateActivityTime(null, null)).toBeNull();
    expect(validateActivityTime('09:00', null)?.code).toBe('TIME_INCOMPLETE');
    expect(validateActivityTime(null, '09:00')?.code).toBe('TIME_INCOMPLETE');
  });

  it('结束必须严格晚于开始：相等或更早都阻止（跨午夜需拆分）', () => {
    expect(validateActivityTime('09:00', '09:00')?.code).toBe('TIME_ORDER');
    expect(validateActivityTime('14:00', '09:00')?.code).toBe('TIME_ORDER');
    expect(validateActivityTime('23:00', '01:00')?.code).toBe('TIME_ORDER');
    expect(validateActivityTime('09:00', '09:01')).toBeNull();
  });

  it('时间格式非法被拒绝', () => {
    expect(validateActivityTime('9:00', '10:00')?.code).toBe('INVALID_TIME_FORMAT');
    expect(validateActivityTime('24:00', '25:00')?.code).toBe('INVALID_TIME_FORMAT');
    expect(validateActivityTime('09:60', '10:00')?.code).toBe('INVALID_TIME_FORMAT');
  });
});

describe('sortActivities / groupActivitiesByDate 排序规则（BR-08）', () => {
  it('同日：有时间在前按（开始, 手动顺序, ID），无时间在后按（手动顺序, ID）', () => {
    const activities = [
      makeActivity('a-3', { date: '2026-07-10', order: 1, title: '老城区参观' }),
      makeActivity('a-1', { date: '2026-07-10', startTime: '14:00', endTime: '16:30', order: 5 }),
      makeActivity('a-2', { date: '2026-07-10', startTime: '09:30', endTime: '11:00', order: 9 }),
      makeActivity('a-4', { date: '2026-07-10', order: 0, title: '另一个未定' }),
    ];
    expect(sortActivities(activities).map((activity) => activity.id)).toEqual(['a-2', 'a-1', 'a-4', 'a-3']);
  });

  it('同开始时间的手动顺序参与排序；order 相同再按 ID', () => {
    const activities = [
      makeActivity('a-b', { startTime: '09:00', endTime: '10:00', order: 2 }),
      makeActivity('a-a', { startTime: '09:00', endTime: '10:00', order: 1 }),
      makeActivity('a-c', { startTime: '08:00', endTime: '08:30', order: 9 }),
    ];
    expect(sortActivities(activities).map((activity) => activity.id)).toEqual(['a-c', 'a-a', 'a-b']);
  });

  it('跨天按日期升序分组，手机时间线可直接使用分组结果', () => {
    const activities = [
      makeActivity('a-2', { date: '2026-07-11', order: 0 }),
      makeActivity('a-1', { date: '2026-07-10', order: 0 }),
      makeActivity('a-3', { date: '2026-07-11', startTime: '10:00', endTime: '11:00', order: 1 }),
    ];
    const groups = groupActivitiesByDate(activities);
    expect(groups.map((group) => group.date)).toEqual(['2026-07-10', '2026-07-11']);
    expect(groups[1]!.activities.map((activity) => activity.id)).toEqual(['a-3', 'a-2']);
  });
});

describe('findTimeOverlaps 重叠提示（BR-08）', () => {
  it('相邻时间不算重叠：10:00 结束与 10:00 开始', () => {
    const overlaps = findTimeOverlaps([
      makeActivity('a-1', { startTime: '09:00', endTime: '10:00' }),
      makeActivity('a-2', { startTime: '10:00', endTime: '11:00' }),
    ]);
    expect(overlaps).toEqual([]);
  });

  it('真实重叠被提示（仅提示不阻止保存），跨天与无时间不参与', () => {
    const overlaps = findTimeOverlaps([
      makeActivity('a-1', { date: '2026-07-10', startTime: '09:00', endTime: '10:30' }),
      makeActivity('a-2', { date: '2026-07-10', startTime: '10:00', endTime: '11:00' }),
      makeActivity('a-3', { date: '2026-07-11', startTime: '09:00', endTime: '10:30' }),
      makeActivity('a-4', { date: '2026-07-11', startTime: '11:00', endTime: '12:00' }),
      makeActivity('a-5', { date: '2026-07-10' }),
    ]);
    expect(overlaps).toEqual([{ date: '2026-07-10', firstId: 'a-1', secondId: 'a-2' }]);
  });

  it('包含关系也算重叠', () => {
    const overlaps = findTimeOverlaps([
      makeActivity('a-1', { startTime: '09:00', endTime: '17:00' }),
      makeActivity('a-2', { startTime: '10:00', endTime: '11:00' }),
    ]);
    expect(overlaps).toHaveLength(1);
  });
});

describe('moveActivity 上下移动（BR-08）', () => {
  it('未定时间组内交换手动顺序，不影响有时间活动', () => {
    const activities = [
      makeActivity('t-1', { startTime: '09:00', endTime: '10:00', order: 0 }),
      makeActivity('u-1', { order: 1 }),
      makeActivity('u-2', { order: 2 }),
    ];
    const result = moveActivity(activities, 'u-2', 'up');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const orders = new Map(result.activities.map((activity) => [activity.id, activity.order]));
    expect(orders.get('u-1')).toBe(2);
    expect(orders.get('u-2')).toBe(1);
    expect(orders.get('t-1')).toBe(0);
  });

  it('组边界返回带原因的错误（不与时间排序冲突）', () => {
    const activities = [
      makeActivity('u-1', { order: 1 }),
      makeActivity('u-2', { order: 2 }),
    ];
    const top = moveActivity(activities, 'u-1', 'up');
    expect(top.ok).toBe(false);
    if (!top.ok) expect(top.error.message).toContain('第一项');
    const bottom = moveActivity(activities, 'u-2', 'down');
    expect(bottom.ok).toBe(false);
    if (!bottom.ok) expect(bottom.error.message).toContain('最后一项');
  });

  it('移动不存在的活动返回错误；不同日期互不影响', () => {
    const activities = [
      makeActivity('d1-1', { date: '2026-07-10', order: 1 }),
      makeActivity('d2-1', { date: '2026-07-11', order: 2 }),
    ];
    expect(moveActivity(activities, 'nope', 'up').ok).toBe(false);
    // d1-1 是 07-10 的唯一未定时间活动，上移应到边界而非与 07-11 交换
    const result = moveActivity(activities, 'd1-1', 'up');
    expect(result.ok).toBe(false);
  });
});

describe('findOutOfRangeActivities 范围外标识（BR-08）', () => {
  it('找出超出日程绑定范围的活动（含边界）', () => {
    const range = { start: '2026-07-10', end: '2026-07-12' };
    const out = findOutOfRangeActivities(
      [
        makeActivity('a-1', { date: '2026-07-09' }),
        makeActivity('a-2', { date: '2026-07-10' }),
        makeActivity('a-3', { date: '2026-07-12' }),
        makeActivity('a-4', { date: '2026-07-13' }),
      ],
      range,
    );
    expect(out.map((activity) => activity.id)).toEqual(['a-1', 'a-4']);
  });
});
