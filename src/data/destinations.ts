// 目的地模板访问层：按 templateVersion 解析不可变模板包。
// 版本只增不改（BR-04 / 架构文档 §5.2）；未知版本返回 undefined，
// 调用方须按“待补充/不支持”处理，不能默默按新价格重算。

import type { DestinationInfo, PlanningDeps } from '../domain/planning/types';
import type { Id } from '../domain/planning/contract';
import type { DestinationTemplate, TemplateBundle } from './templates/v1';
import { TEMPLATE_V1 } from './templates/v1';

export type { DestinationTemplate, ActivitySeed, TemplateBundle } from './templates/v1';

/** 当前（最新）内置估算模板版本；新旅行生成候选时使用。 */
export const CURRENT_TEMPLATE_VERSION = TEMPLATE_V1.version;

const BUNDLES: Record<number, TemplateBundle> = { [TEMPLATE_V1.version]: TEMPLATE_V1 };

export function getTemplateBundle(version: number): TemplateBundle | undefined {
  return BUNDLES[version];
}

export function getDestinations(version: number): readonly DestinationTemplate[] | undefined {
  return BUNDLES[version]?.destinations;
}

export function getDestination(version: number, destinationId: Id): DestinationTemplate | undefined {
  return BUNDLES[version]?.destinations.find((destination) => destination.id === destinationId);
}

/** 偏好标签固定词表（成员偏好与模板标签共用）。 */
export const DESTINATION_TAG_VOCABULARY = ['海边', '城市', '人文', '自然'] as const;

/** 规划域默认依赖：目的地与交通均解析内置模板包。 */
export const planningDataDeps: PlanningDeps = {
  resolveDestination: (version, destinationId): DestinationInfo | undefined => {
    const template = getDestination(version, destinationId);
    if (!template) return undefined;
    return {
      id: template.id,
      name: template.name,
      tags: template.tags,
      supportedDurations: template.supportedDurations,
      estimate: template.estimate,
    };
  },
  resolveTransport: (version, originCity, destinationId) =>
    BUNDLES[version]?.transport.routes[`${originCity}|${destinationId}`],
};
