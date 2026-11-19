// T02 目的地素材运行时清单。
// - 只保留界面需要的稳定资源 ID、文件与替代文本；长提示词/许可记录在
//   docs/assets/SOURCES-v3.md（不打包进首屏）；旧制作过程见 SOURCES-planning.md。
// - 480px 版本用于候选卡片，960px 用于详情；均为示意图（非实拍）。
// - 图片通过 Vite 的 ?url 导入以获得带内容哈希的本地路径和正确 base。

import qingdao480 from '../assets/destinations/qingdao-480.webp';
import qingdao960 from '../assets/destinations/qingdao-960.webp';
import suzhou480 from '../assets/destinations/suzhou-480.webp';
import suzhou960 from '../assets/destinations/suzhou-960.webp';
import xiamen480 from '../assets/destinations/xiamen-480.webp';
import xiamen960 from '../assets/destinations/xiamen-960.webp';
import chengdu480 from '../assets/destinations/chengdu-480.webp';
import chengdu960 from '../assets/destinations/chengdu-960.webp';
import xian480 from '../assets/destinations/xian-480.webp';
import xian960 from '../assets/destinations/xian-960.webp';
import dali480 from '../assets/destinations/dali-480.webp';
import dali960 from '../assets/destinations/dali-960.webp';

export interface DestinationAsset {
  assetId: string;
  destinationId: string;
  alt: string;
  /** 是否示意图（true = 明确标注为合成示意，不当作实拍）。 */
  illustrative: true;
  card: string;
  detail: string;
}

export const destinationAssets: Record<string, DestinationAsset> = {
  'asset-dest-qingdao': {
    assetId: 'asset-dest-qingdao', destinationId: 'dest-qingdao',
    alt: '青岛生成示意景观：红瓦老城、树冠与海湾', illustrative: true,
    card: qingdao480, detail: qingdao960,
  },
  'asset-dest-suzhou': {
    assetId: 'asset-dest-suzhou', destinationId: 'dest-suzhou',
    alt: '苏州生成示意景观：白墙黛瓦、石拱桥与河道', illustrative: true,
    card: suzhou480, detail: suzhou960,
  },
  'asset-dest-xiamen': {
    assetId: 'asset-dest-xiamen', destinationId: 'dest-xiamen',
    alt: '厦门生成示意景观：鼓浪屿别墅、榕树与花岗岩海岸', illustrative: true,
    card: xiamen480, detail: xiamen960,
  },
  'asset-dest-chengdu': {
    assetId: 'asset-dest-chengdu', destinationId: 'dest-chengdu',
    alt: '成都生成示意景观：川西茶院、竹影与木门', illustrative: true,
    card: chengdu480, detail: chengdu960,
  },
  'asset-dest-xian': {
    assetId: 'asset-dest-xian', destinationId: 'dest-xian',
    alt: '西安生成示意景观：古城墙与传统城楼', illustrative: true,
    card: xian480, detail: xian960,
  },
  'asset-dest-dali': {
    assetId: 'asset-dest-dali', destinationId: 'dest-dali',
    alt: '大理生成示意景观：白族村落、洱海与苍山', illustrative: true,
    card: dali480, detail: dali960,
  },
};

/** 按目的地 ID 取素材；未知返回 undefined（UI 用纯色底降级）。 */
export function getDestinationAsset(destinationId: string): DestinationAsset | undefined {
  return Object.values(destinationAssets).find((asset) => asset.destinationId === destinationId);
}
