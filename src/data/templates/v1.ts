// 内置估算模板 v1（不可变）：按总约定随版本整体保留，不覆盖旧表。
// - 金额单位为分；参数为内置估算，非实时报价（BR-04）；
// - 活动种子供 T03 模板日程构建器消费：3 天核心行程的活动金额合计与
//   模板活动分项 A 一致，避免首次生成日程时无依据地改变个人估算；
// - 全部目的地与城市为真实地理名称，估算数值为项目自定演示参数。

export interface ActivitySeed {
  /** 第几天（1 起）。 */
  day: number;
  title: string;
  category: 'transport' | 'lodging' | 'food' | 'sight' | 'activity';
  /** included = 费用已含于方案分项；activities = 计入人均活动支出。 */
  budgetBucket: 'activities' | 'included';
  perPersonEstimate: number | null;
}

export interface DestinationTemplate {
  id: string;
  name: string;
  tags: string[];
  supportedDurations: (2 | 3 | 4 | 5)[];
  estimate: {
    lodgingPerNight: number;
    foodPerDay: number;
    activities: number;
    reserve: number;
  };
  /** 关联素材 ID（见 assetsPlanning / SOURCES-planning）。 */
  assetId: string | null;
  activitySeeds: ActivitySeed[];
}

export interface TransportTemplate {
  /** 路线键 `${出发城市}|${目的地ID}` → 往返交通估算（分）。 */
  routes: Record<string, number>;
}

export interface TemplateBundle {
  version: number;
  destinations: DestinationTemplate[];
  transport: TransportTemplate;
}

export const TEMPLATE_V1: TemplateBundle = {
  version: 1,
  destinations: [
    {
      id: 'dest-qingdao',
      name: '青岛',
      tags: ['海边', '城市'],
      supportedDurations: [2, 3, 4, 5],
      estimate: { lodgingPerNight: 22000, foodPerDay: 9000, activities: 18000, reserve: 6000 },
      assetId: 'asset-dest-qingdao',
      activitySeeds: [
        { day: 1, title: '高铁抵达与民宿集合', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 1, title: '海滨木栈道散步', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 4000 },
        { day: 2, title: '崂山海岸线一日', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 9000 },
        { day: 2, title: '台东海鲜晚餐', category: 'food', budgetBucket: 'included', perPersonEstimate: null },
        { day: 3, title: '老城区与博物馆', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 5000 },
        { day: 3, title: '返程高铁', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 4, title: '啤酒博物馆与街区', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 6000 },
        { day: 5, title: '自由活动与返程', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 3000 },
      ],
    },
    {
      id: 'dest-suzhou',
      name: '苏州',
      tags: ['人文', '城市'],
      supportedDurations: [2, 3, 4],
      estimate: { lodgingPerNight: 20000, foodPerDay: 8000, activities: 15000, reserve: 5000 },
      assetId: 'asset-dest-suzhou',
      activitySeeds: [
        { day: 1, title: '抵达与古城入住', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 1, title: '平江路夜游', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 5000 },
        { day: 2, title: '园林联票游览', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 7000 },
        { day: 2, title: '苏帮菜晚餐', category: 'food', budgetBucket: 'included', perPersonEstimate: null },
        { day: 3, title: '博物馆与手作街区', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 3000 },
        { day: 3, title: '返程', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 4, title: '太湖边骑行', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 5000 },
      ],
    },
    {
      id: 'dest-xiamen',
      name: '厦门',
      tags: ['海边', '自然'],
      supportedDurations: [3, 4, 5],
      estimate: { lodgingPerNight: 26000, foodPerDay: 9500, activities: 20000, reserve: 7000 },
      assetId: 'asset-dest-xiamen',
      activitySeeds: [
        { day: 1, title: '抵达与环岛路集合', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 1, title: '环岛路骑行', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 5000 },
        { day: 2, title: '鼓浪屿一日', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 9000 },
        { day: 2, title: '闽南小吃晚餐', category: 'food', budgetBucket: 'included', perPersonEstimate: null },
        { day: 3, title: '山海健康步道', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 6000 },
        { day: 3, title: '返程', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 4, title: '曾厝垵与帆船出海', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 8000 },
        { day: 5, title: '自由活动与返程', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 3000 },
      ],
    },
    {
      id: 'dest-chengdu',
      name: '成都',
      tags: ['城市', '自然'],
      supportedDurations: [2, 3, 4, 5],
      estimate: { lodgingPerNight: 24000, foodPerDay: 9000, activities: 22000, reserve: 6000 },
      assetId: 'asset-dest-chengdu',
      activitySeeds: [
        { day: 1, title: '抵达与春熙路集合', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 1, title: '老街区漫步', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 4000 },
        { day: 2, title: '熊猫基地半日', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 10000 },
        { day: 2, title: '火锅晚餐', category: 'food', budgetBucket: 'included', perPersonEstimate: null },
        { day: 3, title: '川西小镇一日', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 8000 },
        { day: 3, title: '返程', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 4, title: '都江堰半日', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 9000 },
        { day: 5, title: '自由活动与返程', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 3000 },
      ],
    },
    {
      id: 'dest-xian',
      name: '西安',
      tags: ['人文'],
      supportedDurations: [3, 4, 5],
      estimate: { lodgingPerNight: 23000, foodPerDay: 8500, activities: 20000, reserve: 6000 },
      assetId: 'asset-dest-xian',
      activitySeeds: [
        { day: 1, title: '抵达与城墙南门集合', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 1, title: '城墙骑行', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 5000 },
        { day: 2, title: '兵马俑一日', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 10000 },
        { day: 2, title: '回民街晚餐', category: 'food', budgetBucket: 'included', perPersonEstimate: null },
        { day: 3, title: '博物馆群与大小雁塔', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 5000 },
        { day: 3, title: '返程', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 4, title: '华清池与骊山', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 8000 },
        { day: 5, title: '自由活动与返程', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 3000 },
      ],
    },
    {
      id: 'dest-dali',
      name: '大理',
      tags: ['自然'],
      supportedDurations: [3, 4, 5],
      estimate: { lodgingPerNight: 30000, foodPerDay: 10000, activities: 25000, reserve: 8000 },
      assetId: 'asset-dest-dali',
      activitySeeds: [
        { day: 1, title: '抵达与古城客栈入住', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 1, title: '洱海西线骑行', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 6000 },
        { day: 2, title: '苍山索道与步道', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 11000 },
        { day: 2, title: '白族风味晚餐', category: 'food', budgetBucket: 'included', perPersonEstimate: null },
        { day: 3, title: '古城与周边村落漫游', category: 'sight', budgetBucket: 'activities', perPersonEstimate: 8000 },
        { day: 3, title: '返程', category: 'transport', budgetBucket: 'included', perPersonEstimate: null },
        { day: 4, title: '环洱海包车一日', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 12000 },
        { day: 5, title: '自由活动与返程', category: 'activity', budgetBucket: 'activities', perPersonEstimate: 3000 },
      ],
    },
  ],
  transport: {
    routes: {
      // 上海出发（往返，分）
      '上海|dest-qingdao': 49000,
      '上海|dest-suzhou': 12000,
      '上海|dest-xiamen': 78000,
      '上海|dest-chengdu': 118000,
      '上海|dest-xian': 96000,
      '上海|dest-dali': 138000,
      // 杭州出发
      '杭州|dest-qingdao': 56000,
      '杭州|dest-suzhou': 15000,
      '杭州|dest-xiamen': 82000,
      '杭州|dest-chengdu': 122000,
      '杭州|dest-xian': 99000,
      '杭州|dest-dali': 142000,
      // 南京出发
      '南京|dest-qingdao': 52000,
      '南京|dest-suzhou': 18000,
      '南京|dest-xiamen': 86000,
      '南京|dest-chengdu': 115000,
      '南京|dest-xian': 88000,
      '南京|dest-dali': 135000,
    },
  },
};

/** 交通表覆盖的出发城市（示例 3 城 × 全部目的地）。 */
export const TRANSPORT_CITIES_V1 = ['上海', '杭州', '南京'] as const;
