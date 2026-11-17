/**
 * T03 领域错误 → B0 公共错误码映射（适配层）。
 *
 * 领域内部保留细粒度 ErrorCode（便于测试与表单定位），
 * 向应用层的 CommandHandler / TripValidator 暴露 B0 的 ErrorCode。
 */
import type { BusinessError } from '../../contracts/result';
import type { ErrorCode as DomainErrorCode } from './errors';

export function toBusinessErrorCode(code: DomainErrorCode): BusinessError['code'] {
  switch (code) {
    case 'EXPENSE_LOCKED':
      return 'LOCKED';
    case 'DUPLICATE_COMMAND':
      return 'CONFLICT';
    case 'LIMIT_ACTIVITIES':
    case 'LIMIT_EXPENSES':
    case 'LIMIT_SETTLEMENTS':
      return 'CAPACITY';
    case 'INVARIANT_BROKEN':
      return 'CORRUPT';
    case 'ACTIVITY_NOT_FOUND':
    case 'EXPENSE_NOT_FOUND':
    case 'SETTLEMENT_NOT_FOUND':
    case 'PLAN_NOT_FOUND':
      return 'NOT_FOUND';
    default:
      return 'VALIDATION';
  }
}

export function toBusinessError(error: {
  code: DomainErrorCode;
  message: string;
  field?: string;
}): BusinessError {
  const fields = error.field === undefined ? undefined : { [error.field]: error.message };
  const result: BusinessError = { code: toBusinessErrorCode(error.code), message: error.message };
  return fields === undefined ? result : { ...result, fields };
}
