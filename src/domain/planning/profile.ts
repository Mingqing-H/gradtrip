// 成员资料完整度与约束资料校验（BR-01 / BR-02）。

import { isValidDateOnly, isValidRange } from './calendar';
import type { Cents, Member } from './contract';
import type { MemberProfileInput, MemberProfileStatus } from './types';

/** 每位成员最多 5 个日期区间（BR-01）。 */
export const MAX_AVAILABILITY_RANGES = 5;
export const MAX_MEMBER_COUNT = 20;
export const MEMBER_NAME_MAX = 20;
/** 预算合法范围 ¥0～¥100,000（分）。 */
export const BUDGET_CAP_MIN = 0;
export const BUDGET_CAP_MAX = 10_000_000;

/**
 * 必填信息：昵称、出发城市、预算上限、至少一段可用日期（BR-01）。
 * 偏好可为空；预算为 null 表示未知，明确零预算是有效值。
 */
export function getMemberProfileStatus(member: Pick<Member, 'name' | 'originCity' | 'budgetCap' | 'availability'>): MemberProfileStatus {
  const complete =
    normalizeText(member.name).length >= 1 &&
    normalizeText(member.name).length <= MEMBER_NAME_MAX &&
    member.originCity !== null &&
    normalizeText(member.originCity).length > 0 &&
    member.budgetCap !== null &&
    hasValidAvailability(member.availability ?? []);
  return complete ? 'complete' : 'incomplete';
}

/** 缺失的必填字段列表（供 UI 定位第一个缺失输入）。 */
export function getMissingProfileFields(member: Pick<Member, 'name' | 'originCity' | 'budgetCap' | 'availability'>): string[] {
  const missing: string[] = [];
  const name = normalizeText(member.name);
  if (name.length < 1 || name.length > MEMBER_NAME_MAX) missing.push('name');
  if (member.originCity === null || normalizeText(member.originCity).length < 1) missing.push('originCity');
  if (member.budgetCap === null) missing.push('budgetCap');
  if (!hasValidAvailability(member.availability ?? [])) missing.push('availability');
  return missing;
}

export function hasValidAvailability(availability: unknown): boolean {
  if (!Array.isArray(availability) || availability.length < 1) return false;
  if (availability.length > MAX_AVAILABILITY_RANGES) return false;
  return availability.every((range) => {
    if (typeof range !== 'object' || range === null) return false;
    const { start, end } = range as { start?: unknown; end?: unknown };
    if (!isValidDateOnly(start) || !isValidDateOnly(end)) return false;
    return start <= end;
  });
}

/** 校验表单输入的约束资料；返回逐字段错误（空数组表示通过）。 */
export function validateMemberProfileInput(profile: MemberProfileInput): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  const name = normalizeText(profile.name);
  if (name.length < 1 || name.length > MEMBER_NAME_MAX) {
    errors.push({ field: 'name', message: `昵称需 1～${MEMBER_NAME_MAX} 字` });
  }
  if (profile.originCity !== null) {
    const city = normalizeText(profile.originCity);
    if (city.length < 1) errors.push({ field: 'originCity', message: '出发城市不能为空白' });
    else if (city.length > 20) errors.push({ field: 'originCity', message: '城市名过长' });
  }
  if (profile.budgetCap !== null) {
    if (!isSafeNonNegativeInteger(profile.budgetCap)) {
      errors.push({ field: 'budgetCap', message: '预算必须是合法金额' });
    } else if (profile.budgetCap < BUDGET_CAP_MIN || profile.budgetCap > BUDGET_CAP_MAX) {
      errors.push({ field: 'budgetCap', message: '预算需在 ¥0～¥100,000 之间' });
    }
  }
  const availability = profile.availability ?? [];
  if (availability.length < 1) {
    errors.push({ field: 'availability', message: '至少填写一段可用日期' });
  } else if (availability.length > MAX_AVAILABILITY_RANGES) {
    errors.push({ field: 'availability', message: `最多 ${MAX_AVAILABILITY_RANGES} 段可用日期` });
  } else {
    availability.forEach((range, index) => {
      if (!isValidDateOnly(range?.start) || !isValidDateOnly(range?.end)) {
        errors.push({ field: `availability.${index}`, message: '日期格式需为 YYYY-MM-DD' });
      } else if (!isValidRange(range)) {
        errors.push({ field: `availability.${index}`, message: '起日不得晚于止日' });
      }
    });
  }
  const preferences = profile.preferences ?? [];
  if (preferences.length > 8) {
    errors.push({ field: 'preferences', message: '偏好标签过多' });
  }
  return errors;
}

/** 归一化后的约束资料是否与成员当前值完全一致（相同值不增加版本，BR-02）。 */
export function isSameProfile(member: Member, profile: MemberProfileInput): boolean {
  return (
    normalizeText(member.name) === normalizeText(profile.name) &&
    (member.originCity ?? null) === normalizeNullableText(profile.originCity) &&
    member.budgetCap === profile.budgetCap &&
    sameRanges(member.availability ?? [], profile.availability ?? []) &&
    sameStringSet(member.preferences ?? [], profile.preferences ?? [])
  );
}

/** 应用输入到成员字段（不改 ID）；写入前须已通过 validateMemberProfileInput。 */
export function applyProfileToMember(member: Member, profile: MemberProfileInput): Member {
  return {
    ...member,
    name: normalizeText(profile.name),
    originCity: normalizeNullableText(profile.originCity),
    budgetCap: profile.budgetCap,
    availability: (profile.availability ?? []).map((range) => ({ start: range.start, end: range.end })),
    preferences: dedupePreserveOrder(profile.preferences ?? []).map(normalizeText),
  };
}

/** 以给定 ID 新建成员；写入前须已通过 validateMemberProfileInput。 */
export function memberFromProfile(id: Member['id'], profile: MemberProfileInput): Member {
  return {
    id,
    name: normalizeText(profile.name),
    originCity: normalizeNullableText(profile.originCity),
    budgetCap: profile.budgetCap,
    availability: (profile.availability ?? []).map((range) => ({ start: range.start, end: range.end })),
    preferences: dedupePreserveOrder(profile.preferences ?? []).map(normalizeText),
  };
}

export function normalizeText(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value: string | null): string | null {
  if (value === null) return null;
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

function sameRanges(a: readonly { start: string; end: string }[], b: readonly { start: string; end: string }[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((range, index) => range.start === b[index].start && range.end === b[index].end);
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((item) => setB.has(item));
}

function dedupePreserveOrder(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

export function isSafeNonNegativeInteger(value: Cents): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
