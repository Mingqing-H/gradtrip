import { z } from 'zod';
import { isDateOnly } from './dates';
import type { Trip } from './types';
import type { BusinessError, Result } from '../contracts/result';
import { failure, success } from '../contracts/result';
export const idSchema = z.string().min(1).max(120).regex(/^[\w-]+$/);
export const centsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const dateSchema = z.string().refine(isDateOnly, '日期必须为真实的 YYYY-MM-DD');
const timestamp = z.iso.datetime();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveVersion = revision.min(1);
export const rangeSchema = z.strictObject({ start: dateSchema, end: dateSchema }).refine(r => r.start <= r.end, '结束日期不能早于开始日期');
export const memberSchema = z.strictObject({
  id: idSchema, name: z.string().trim().min(1).max(40), originCity: z.string().trim().min(1).max(80).nullable(),
  budgetCap: centsSchema.nullable(), availability: z.array(rangeSchema).max(5), preferences: z.array(z.string().max(40)).max(20),
});
const duration = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export const planSchema = z.strictObject({
  id: idSchema, version: positiveVersion, destinationId: idSchema, templateVersion: positiveVersion,
  startDate: dateSchema, days: duration,
  estimate: z.strictObject({
    transportByMember: z.record(idSchema, z.strictObject({ originCity: z.string().min(1).max(80), amount: centsSchema }).nullable()),
    lodgingPerNight: centsSchema, foodPerDay: centsSchema, activities: centsSchema, reserve: centsSchema,
  }),
});
export const intentSchema = z.strictObject({
  memberId: idSchema, planId: idSchema, planVersion: positiveVersion, constraintRevision: revision,
  value: z.enum(['approve', 'acceptable', 'decline']), source: z.enum(['organizer', 'feedback', 'demo']), recordedAt: timestamp,
});
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable();
export const activitySchema = z.strictObject({
  id: idSchema, date: dateSchema, startTime: clock, endTime: clock, title: z.string().trim().min(1).max(120),
  category: z.string().min(1).max(40), budgetBucket: z.enum(['activities', 'included']),
  perPersonEstimate: centsSchema.nullable(), note: z.string().max(2000), order: revision,
}).refine(a => (a.startTime === null && a.endTime === null) || (a.startTime !== null && a.endTime !== null && a.startTime < a.endTime), '请填写有效的起止时间');
export const expenseSchema = z.strictObject({
  id: idSchema, title: z.string().trim().min(1).max(120), date: dateSchema, category: z.string().min(1).max(40),
  amount: centsSchema.min(1).max(10_000_000), payerId: idSchema, splitMode: z.enum(['equal', 'custom']),
  allocations: z.array(z.strictObject({ memberId: idSchema, amount: centsSchema })).min(1).max(20), createdAt: timestamp,
});
export const settlementSchema = z.strictObject({
  id: idSchema, commandId: idSchema, fromId: idSchema, toId: idSchema, amount: centsSchema.min(1),
  recordedAt: timestamp, voidedAt: timestamp.nullable(),
});
export const invitationSchema = z.strictObject({
  id: idSchema, memberId: idSchema, constraintRevision: revision,
  planVersions: z.record(idSchema, positiveVersion), createdAt: timestamp,
});
export const tripSchema: z.ZodType<Trip> = z.strictObject({
  schemaVersion: z.literal(1), id: idSchema, name: z.string().trim().min(1).max(80), revision, constraintRevision: revision,
  searchWindow: rangeSchema, duration, members: z.array(memberSchema).max(20), plans: z.array(planSchema).max(20),
  intents: z.array(intentSchema).max(2000), confirmation: z.strictObject({
    planId: idSchema, planVersion: positiveVersion, constraintRevision: revision, confirmedAt: timestamp,
  }).nullable(),
  itinerary: z.strictObject({ sourcePlanId: idSchema.nullable(), sourcePlanVersion: positiveVersion.nullable(), dateRange: rangeSchema.nullable(), activities: z.array(activitySchema).max(1000) }),
  expenses: z.array(expenseSchema).max(2000), settlements: z.array(settlementSchema).max(2000),
  invitations: z.array(invitationSchema).max(1000),
  appliedResponses: z.array(z.strictObject({ id: idSchema, invitationId: idSchema, appliedAt: timestamp })).max(1000),
  appliedCommandIds: z.array(idSchema).max(5000), isDemo: z.boolean(), createdAt: timestamp, updatedAt: timestamp,
});
export const MAX_TRIP_BYTES = 900 * 1024;
export const MAX_STORAGE_BYTES = 20 * 1024 * 1024;
export function validateCoreTrip(trip: Trip): BusinessError[] {
  const messages: string[] = [];
  const unique = (ids: string[], label: string) => { if (new Set(ids).size !== ids.length) messages.push(`${label}含重复 ID`); };
  const members = new Set(trip.members.map(m => m.id));
  const plans = new Map(trip.plans.map(p => [p.id, p]));
  for (const [label, items] of [['成员', trip.members], ['方案', trip.plans], ['活动', trip.itinerary.activities], ['费用', trip.expenses], ['结算', trip.settlements], ['邀请', trip.invitations], ['反馈', trip.appliedResponses]] as const) unique(items.map(i => i.id), label);
  unique(trip.appliedCommandIds, '命令历史');
  const memberRef = (id: string) => { if (!members.has(id)) messages.push('数据引用了不存在的成员'); };
  const planRef = (id: string) => { if (!plans.has(id)) messages.push('数据引用了不存在的方案'); };
  for (const plan of trip.plans) Object.keys(plan.estimate.transportByMember).forEach(memberRef);
  for (const intent of trip.intents) { memberRef(intent.memberId); planRef(intent.planId); }
  if (trip.confirmation) planRef(trip.confirmation.planId);
  if (trip.itinerary.sourcePlanId) planRef(trip.itinerary.sourcePlanId);
  if ((trip.itinerary.sourcePlanId === null) !== (trip.itinerary.sourcePlanVersion === null)) messages.push('日程来源不完整');
  if (trip.itinerary.activities.length && !trip.itinerary.dateRange) messages.push('日程缺少绑定日期');
  let total = 0n;
  for (const expense of trip.expenses) {
    memberRef(expense.payerId);
    unique(expense.allocations.map(a => a.memberId), '费用参与人');
    expense.allocations.forEach(a => memberRef(a.memberId));
    const allocated = expense.allocations.reduce((sum, a) => sum + BigInt(a.amount), 0n);
    if (allocated !== BigInt(expense.amount)) messages.push('费用分摊合计不等于账单金额');
    total += BigInt(expense.amount);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) messages.push('费用合计超出安全整数范围');
  for (const settlement of trip.settlements) { memberRef(settlement.fromId); memberRef(settlement.toId); if (settlement.fromId === settlement.toId) messages.push('结算双方不能相同'); }
  for (const invitation of trip.invitations) { memberRef(invitation.memberId); Object.keys(invitation.planVersions).forEach(planRef); }
  const invitations = new Set(trip.invitations.map(i => i.id));
  if (trip.appliedResponses.some(r => !invitations.has(r.invitationId))) messages.push('反馈引用了不存在的邀请');
  return [...new Set(messages)].map(message => ({ code: 'VALIDATION', message }));
}
export function parseTrip(value: unknown): Result<Trip> {
  const parsed = tripSchema.safeParse(value);
  if (!parsed.success) return failure('VALIDATION', '旅行数据格式无效', Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message])));
  const issues = validateCoreTrip(parsed.data);
  if (issues.length) return { ok: false, error: issues[0] };
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > MAX_TRIP_BYTES) return failure('CAPACITY', '旅行超过 900 KiB，请先导出并精简内容');
  return success(parsed.data);
}
