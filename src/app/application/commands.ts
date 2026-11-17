import type { Command, CommandContext } from '../../domain/commands';
import { parseTrip } from '../../domain/schema';
import type { Trip } from '../../domain/types';
import type { DomainDependencies, DomainModule } from '../../contracts/services';
import { failure, success, type Result } from '../../contracts/result';
export function applyCommand(trip: Trip, command: Command, context: CommandContext, modules: Partial<Record<'planning' | 'itineraryLedger' | 'sharing', DomainModule>>, dependencies: DomainDependencies): Result<Trip> {
  if (command.tripId !== trip.id || context.commandId !== command.commandId) return failure('VALIDATION', '命令目标无效');
  if (trip.appliedCommandIds.includes(command.commandId)) return success(trip);
  if (trip.revision !== command.expectedRevision) return failure('CONFLICT', '其他标签页已更新此旅行，请重新载入后再保存');
  if (trip.appliedCommandIds.length >= 5000) return failure('CAPACITY', '命令历史已满，请导出备份');
  let next: Result<Trip>;
  if (command.payload.type === 'trip.rename') next = success({ ...trip, name: command.payload.name });
  else if (command.payload.type === 'trip.resetDemo') {
    if (!trip.isDemo) return failure('VALIDATION', '只能重置示例旅行');
    const demo = dependencies.createDemo?.({ id: trip.id, today: context.today, now: context.now });
    next = demo?.ok ? success({ ...demo.value, constraintRevision: trip.constraintRevision + 1, createdAt: trip.createdAt }) : demo ?? failure('NOT_IMPLEMENTED', '示例种子尚未接入，不能重置');
  }
  else {
    const prefix = command.payload.type.split('.')[0];
    const module = modules[prefix === 'member' || prefix === 'plan' ? 'planning' : prefix === 'sharing' ? 'sharing' : 'itineraryLedger'];
    if (!module) return failure('NOT_IMPLEMENTED', '此功能模块尚未接入');
    next = module.apply(structuredClone(trip), command.payload, context, dependencies);
  }
  if (!next.ok) return next;
  if (next.value.id !== trip.id) return failure('VALIDATION', '业务命令不能修改旅行 ID');
  const candidate = parseTrip({ ...next.value, revision: trip.revision + 1, updatedAt: context.now, appliedCommandIds: [...trip.appliedCommandIds, command.commandId] });
  if (!candidate.ok) return candidate;
  for (const module of Object.values(modules)) {
    const issues = module.validate(candidate.value);
    if (issues.length) return { ok: false, error: issues[0] };
  }
  return candidate;
}
