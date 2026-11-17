// 城市交通表访问层：出发城市 → 目的地往返估算（分），按模板版本不可变。
// 表中没有的城市返回 undefined（未知，需组织者手工补入估算，不能当 0 元）。

import type { Cents, Id } from '../domain/planning/contract';
import { getTemplateBundle } from './destinations';

/** 查询往返交通估算；未知路线返回 undefined。 */
export function lookupTransport(version: number, originCity: string, destinationId: Id): Cents | undefined {
  return getTemplateBundle(version)?.transport.routes[`${originCity}|${destinationId}`];
}

/** 某版本交通表覆盖的出发城市（用于表单建议与提示）。 */
export function getTransportCities(version: number): readonly string[] {
  const bundle = getTemplateBundle(version);
  if (!bundle) return [];
  const cities = new Set<string>();
  for (const key of Object.keys(bundle.transport.routes)) {
    const [city] = key.split('|');
    if (city) cities.add(city);
  }
  return [...cities].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}
