// T02 规划域对公共类型契约的唯一引用点。
// 核心实体以 src/domain/types.ts（T01 在 B0 中交付）为唯一来源，
// 本文件只做引用/转发；若 B0 实际导出名称有出入，仅在此处适配，
// 不在规划域内平行定义第二份实体模型。
//
// 以下细分别名均从已约定的实体结构派生，不假设 B0 单独导出这些名字：
// - Days / IntentSource / PlanEstimate / TransportOverride 来自 Plan、Intent 结构本身；
// - MemberProfileInput 是规划域自己的表单输入类型，定义在 ./types.ts。

export type {
  Id,
  Cents,
  DateOnly,
  Range,
  IntentValue,
  Member,
  Plan,
  Intent,
  Confirmation,
  Trip,
} from '../types';

export type Days = Plan['days'];
export type IntentSource = Intent['source'];
export type PlanEstimate = Plan['estimate'];
/** 交通表项：手工覆盖值（null 表示回落查表，不代表零费用）。 */
export type TransportOverride = Plan['estimate']['transportByMember'][Id];
