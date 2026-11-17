/**
 * 账本域公共出口（T03）。
 *
 * 统一入口 applyItineraryLedgerCommand / validateItineraryLedgerTrip 同时覆盖
 * 日程域（src/domain/itinerary），实际接线路径以 B0 记录为准。
 */
export * from './errors';
export * from './split';
export * from './balances';
export * from './settlement';
export * from './commands';
export {
  applyItineraryLedgerCommand,
  validateItineraryLedgerTrip,
  type ItineraryLedgerCommand,
} from './unifiedEntry';
