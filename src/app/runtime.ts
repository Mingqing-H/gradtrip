import { dependencies, domainModules } from './modules';
import { openRepository } from '../infrastructure/repository';
import { createNotifications } from '../infrastructure/notifications';
export function dateToday(now: Date): string {
  return [now.getFullYear().toString().padStart(4, '0'), (now.getMonth() + 1).toString().padStart(2, '0'), now.getDate().toString().padStart(2, '0')].join('-');
}
export async function createRuntime() {
  const notifications = createNotifications(import.meta.env.BASE_URL);
  const warnings: string[] = [];
  const repository = await openRepository(import.meta.env.BASE_URL, { dependencies, modules: domainModules, notifications }, message => { warnings.push(message); });
  return { repository, notifications, warnings };
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
let runtimePromise: Promise<Runtime> | undefined;
export const getRuntime = () => runtimePromise ??= createRuntime();
