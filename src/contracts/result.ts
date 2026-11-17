export type ErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'CAPACITY' | 'CORRUPT' | 'STORAGE' | 'NOT_IMPLEMENTED' | 'LOCKED' | 'EXPIRED';
export interface BusinessError { code: ErrorCode; message: string; fields?: Record<string, string> }
export type Result<T> = { ok: true; value: T } | { ok: false; error: BusinessError };
export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = (code: ErrorCode, message: string, fields?: Record<string, string>): Result<never> => ({ ok: false, error: { code, message, ...(fields ? { fields } : {}) } });
