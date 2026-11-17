/**
 * T03（日程与账本）领域共用：结构化业务错误、命令结果与数量上限。
 *
 * 实体类型唯一来源为 `src/domain/types.ts`（B0 交付，T01 所有）；
 * 本文件只定义错误与结果形状，不重复实体。
 */

/** 稳定错误码；UI 与测试按 code 定位，message 面向用户。 */
export const ERR = {
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_TITLE: 'INVALID_TITLE',
  INVALID_CATEGORY: 'INVALID_CATEGORY',
  INVALID_NOTE: 'INVALID_NOTE',
  INVALID_DATE: 'INVALID_DATE',
  INVALID_ESTIMATE: 'INVALID_ESTIMATE',
  INVALID_TIME_FORMAT: 'INVALID_TIME_FORMAT',
  TIME_INCOMPLETE: 'TIME_INCOMPLETE',
  TIME_ORDER: 'TIME_ORDER',
  UNKNOWN_MEMBER: 'UNKNOWN_MEMBER',
  EMPTY_PARTICIPANTS: 'EMPTY_PARTICIPANTS',
  DUPLICATE_PARTICIPANT: 'DUPLICATE_PARTICIPANT',
  ALLOCATION_EMPTY: 'ALLOCATION_EMPTY',
  ALLOCATION_INVALID: 'ALLOCATION_INVALID',
  ALLOCATION_SUM_MISMATCH: 'ALLOCATION_SUM_MISMATCH',
  EXPENSE_NOT_FOUND: 'EXPENSE_NOT_FOUND',
  EXPENSE_LOCKED: 'EXPENSE_LOCKED',
  SETTLEMENT_NOT_FOUND: 'SETTLEMENT_NOT_FOUND',
  SETTLEMENT_SELF: 'SETTLEMENT_SELF',
  SETTLEMENT_DIRECTION: 'SETTLEMENT_DIRECTION',
  SETTLEMENT_AMOUNT: 'SETTLEMENT_AMOUNT',
  SETTLEMENT_OVERFLOW: 'SETTLEMENT_OVERFLOW',
  NO_ACTIVE_SETTLEMENTS: 'NO_ACTIVE_SETTLEMENTS',
  DUPLICATE_COMMAND: 'DUPLICATE_COMMAND',
  ACTIVITY_NOT_FOUND: 'ACTIVITY_NOT_FOUND',
  MOVE_BOUNDARY: 'MOVE_BOUNDARY',
  NEED_DATE_RANGE: 'NEED_DATE_RANGE',
  DATE_OUT_OF_RANGE: 'DATE_OUT_OF_RANGE',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  TEMPLATE_INVALID: 'TEMPLATE_INVALID',
  LIMIT_ACTIVITIES: 'LIMIT_ACTIVITIES',
  LIMIT_EXPENSES: 'LIMIT_EXPENSES',
  LIMIT_SETTLEMENTS: 'LIMIT_SETTLEMENTS',
  INVALID_COMMAND: 'INVALID_COMMAND',
  INVARIANT_BROKEN: 'INVARIANT_BROKEN',
} as const;

export type ErrorCode = keyof typeof ERR;

export interface DomainError {
  /** 见 ERR 常量 */
  code: ErrorCode;
  /** 中文说明，可直接展示 */
  message: string;
  /** 可选字段定位（如 amount、payerId、startTime），供表单就近显示 */
  field?: string;
}

export function domainError(code: ErrorCode, message: string, field?: string): DomainError {
  return field === undefined ? { code, message } : { code, message, field };
}

/** 命令结果：成功返回新 Trip（不修改入参），失败返回结构化错误。 */
export type CommandResult<T> = { ok: true; trip: T } | { ok: false; error: DomainError };

export function commandOk<T>(trip: T): CommandResult<T> {
  return { ok: true, trip };
}

export function commandFail(code: ErrorCode, message: string, field?: string): CommandResult<never> {
  return { ok: false, error: domainError(code, message, field) };
}

/** 命令执行上下文：显式注入时间与 ID 分配，不读系统时钟、不生成随机数。 */
export interface CommandContext {
  /** ISO 8601 时间戳，由应用层传入 */
  now: string;
  /** 确定性 ID 分配器（如 `expense-3`），由应用层注入 */
  allocateId: (prefix: string) => string;
}

/** 业务上限（BUSINESS_RULES 名词与基础约定） */
export const MAX_EXPENSE_CENTS = 10_000_000; // ¥100,000
export const MAX_ACTIVITIES = 100;
export const MAX_EXPENSES = 200;
export const MAX_SETTLEMENTS = 200;

export const TITLE_MAX_LENGTH = 60;
export const NOTE_MAX_LENGTH = 300;
export const TRIP_NAME_MAX_LENGTH = 40;
