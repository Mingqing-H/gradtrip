// 规划域（小队与方案）自身的类型：状态、评估结果、命令载荷与错误。
// 核心实体（Member/Plan/Intent/Trip 等）一律来自 ./contract.ts 转发的公共契约。

import type {
  Confirmation,
  Cents,
  DateOnly,
  Days,
  Id,
  Intent,
  IntentSource,
  IntentValue,
  Member,
  Plan,
  Range,
} from './contract';

/** 成员约束资料输入：updateMemberConstraints 与 member.* 命令共用。 */
export interface MemberProfileInput {
  name: string;
  originCity: string | null;
  budgetCap: Cents | null;
  availability: Range[];
  preferences: string[];
}

/** 成员资料完整度（BR-01）：昵称、出发城市、预算上限、至少一段可用日期。 */
export type MemberProfileStatus = 'complete' | 'incomplete';

/** 单个成员针对单个方案的三态约束结果（BR-05）。 */
export type ConstraintState = 'pass' | 'conflict' | 'unknown';

/** 规划域只读视图：可从 Trip 切片，也可由邀请回填数据构造（供 T04 使用）。 */
export interface PlanningContext {
  searchWindow: Range;
  duration: Days;
  members: Member[];
  plans: Plan[];
  constraintRevision: number;
  intents: Intent[];
  confirmation: Confirmation | null;
}

/** 单成员单方案的适配明细。 */
export interface MemberPlanStatus {
  memberId: Id;
  profile: MemberProfileStatus;
  time: ConstraintState;
  budget: ConstraintState;
  /** 个人基准估算 E_i；未知交通或缺资料时为 null。 */
  estimate: Cents | null;
  /** 超出预算的差额；仅预算冲突时有值。 */
  overBudgetBy: Cents | null;
  overall: 'pass' | 'conflict' | 'unknown';
}

/** 估算模板/交通表的只读解析依赖，由应用层注入，测试用 fixture 替代。 */
export interface PlanningDeps {
  /** 查询目的地模板（标签、支持时长与内置估算参数）；未知模板返回 undefined。 */
  resolveDestination: (templateVersion: number, destinationId: Id) => DestinationInfo | undefined;
  /** 查询城市→目的地往返交通；无记录返回 undefined（未知，不是 0）。 */
  resolveTransport: (templateVersion: number, originCity: string, destinationId: Id) => Cents | undefined;
}

/** 目的地模板在领域侧需要的只读信息。 */
export interface DestinationInfo {
  id: Id;
  name: string;
  tags: string[];
  /** 支持的出行时长。 */
  supportedDurations: readonly Days[];
  /** 内置估算参数（整数分）。 */
  estimate: { lodgingPerNight: Cents; foodPerDay: Cents; activities: Cents; reserve: Cents };
}

/** 意向在当前方案版本与约束版本下的当前值。 */
export interface CurrentIntentView {
  value: IntentValue;
  source: IntentSource;
  recordedAt: string;
}

/** 一个候选方案的完整评估结果（读模型）。 */
export interface PlanEvaluation {
  planId: Id;
  planVersion: number;
  destinationId: Id;
  startDate: DateOnly;
  days: Days;
  /** 出行日期区间 [startDate, startDate + days - 1]。 */
  travelRange: Range;
  members: MemberPlanStatus[];
  counts: {
    total: number;
    timePass: number;
    budgetPass: number;
    hardPass: number;
    /** 存在明确冲突的不同成员数（按 ID 去重，BR-05）。 */
    conflictMembers: Id[];
    /** 待补充的不同成员数。 */
    unknownMembers: Id[];
    /** 个人估算未知（多为交通待补充）的成员数。 */
    unknownEstimateMembers: Id[];
  };
  /** 已知个人估算的最低～最高；全部未知为 null。 */
  estimateRange: { min: Cents; max: Cents } | null;
  /** 全员个人估算是否已知。 */
  estimateComplete: boolean;
  /** 已知个人估算合计；任一未知为 null（排序按正无穷处理）。 */
  totalEstimate: Cents | null;
  /** 偏好平均分 0～1；无偏好成员不参与平均（BR-05）。 */
  preferenceScore: number;
  allHardPass: boolean;
  /** 当前意向统计（仅统计当前版本意向）。 */
  intents: {
    approve: number;
    acceptable: number;
    decline: number;
    pending: number;
    byMember: Record<Id, CurrentIntentView | undefined>;
  };
  /** 确定性排序元组（BR-05 顺序）。 */
  sortKey: PlanSortKey;
}

export type PlanSortKey = readonly [
  number, // 0 = 全员硬约束通过，1 = 其他
  number, // 明确冲突成员数
  number, // 待补充成员数
  number, // 偏好平均分（降序，取负值实现）
  number, // 全员估算合计（缺失为 Number.POSITIVE_INFINITY）
  number, // 出发日期序号
  string, // 方案 ID
];

/** 共同出发日查询结果（BR-03）。 */
export interface CommonDepartures {
  /** 升序、最多前 10 个的共同出发日。 */
  dates: DateOnly[];
  /** 存在资料不完整成员时为 true：结果标记“待补全后确认”。 */
  needsMoreInfo: boolean;
  /** 参与交集计算的资料完整成员 ID；为空表示没有任何完整成员。 */
  completeMemberIds: Id[];
}

/** 指定出发日逐人冲突详情。 */
export interface DepartureConflictRow {
  memberId: Id;
  profile: MemberProfileStatus;
  /** pass：区间完整覆盖；conflict：资料已知但不覆盖；unknown：资料缺失。 */
  time: ConstraintState;
  /** 不覆盖时的具体原因描述（供 UI 直接展示）。 */
  reason: string | null;
  mergedRanges: Range[];
}

/** 派生共识状态（BR-07）：筹备中 / 已确认 / 待重新确认。 */
export type ConsensusStatusKind = 'preparing' | 'confirmed' | 'needsReconfirm';

export interface ConsensusStatus {
  status: ConsensusStatusKind;
  /** 待重新确认时的原因分类与说明。 */
  reason:
    | null
    | { kind: 'constraints-changed'; message: string }
    | { kind: 'plan-changed'; message: string }
    | { kind: 'plan-missing'; message: string }
    | { kind: 'intents-changed'; message: string }
    | { kind: 'conditions-failed'; message: string };
}

/** 确认阻止项（BR-07），供 UI 列出具体原因并定位。 */
export type ConfirmationBlocker =
  | { kind: 'too-few-members'; message: string }
  | { kind: 'member-incomplete'; memberId: Id; missingFields: string[]; message: string }
  | { kind: 'estimate-unknown'; memberId: Id; message: string }
  | { kind: 'date-invalid'; message: string }
  | { kind: 'time-conflict'; memberId: Id; message: string }
  | { kind: 'budget-conflict'; memberId: Id; overBy: Cents; message: string }
  | { kind: 'intent-missing'; memberId: Id; message: string }
  | { kind: 'intent-declined'; memberId: Id; message: string };

/** 规划命令（member.* / plan.* 族）的载荷级定义；命令信封由 T01 的 commands.ts 聚合。 */
export type PlanningCommand =
  | { type: 'member.add'; payload: { profile: MemberProfileInput } }
  | { type: 'member.update'; payload: { memberId: Id; profile: MemberProfileInput } }
  | { type: 'member.remove'; payload: { memberId: Id } }
  | {
      type: 'plan.generate';
      payload: {
        searchWindow: Range;
        duration: Days;
        startDate: DateOnly;
        destinationIds: Id[];
      };
    }
  | {
      type: 'plan.update';
      payload: {
        planId: Id;
        startDate?: DateOnly;
        destinationId?: Id;
        estimate?: {
          lodgingPerNight?: Cents;
          foodPerDay?: Cents;
          activities?: Cents;
          reserve?: Cents;
          /** 设置某成员的手工交通估算（按当前城市绑定）。 */
          transportOverride?: { memberId: Id; amount: Cents };
          /** 清除某成员的手工交通估算。 */
          removeTransportOverride?: Id;
        };
      };
    }
  | {
      type: 'plan.recordIntent';
      payload: { planId: Id; memberId: Id; value: IntentValue; source: IntentSource };
    }
  | { type: 'plan.confirm'; payload: { planId: Id } };

/** 结构化业务错误：code 稳定可判别，message 供展示，details 附定位信息。 */
export interface PlanningError {
  code: PlanningErrorCode;
  message: string;
  details?: unknown;
}

export type PlanningErrorCode =
  | 'member.not-found'
  | 'member.limit-reached'
  | 'member.invalid-profile'
  | 'member.referenced-by-ledger'
  | 'plan.not-found'
  | 'plan.limit-reached'
  | 'plan.invalid-window'
  | 'plan.invalid-date'
  | 'plan.invalid-duration'
  | 'plan.unknown-destination'
  | 'plan.invalid-estimate'
  | 'plan.estimate-over-cap'
  | 'intent.not-found'
  | 'intent.limit-reached'
  | 'consensus.blocked'
  | 'command.invalid';

export type PlanningResult = { ok: true; trip: import('./contract').Trip } | { ok: false; error: PlanningError };
