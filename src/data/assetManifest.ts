import { destinationAssets } from './assetsPlanning';

export interface AssetEntry { id: string; src: string; alt: string; width: number; height: number; source: string }
export const assetManifest: Readonly<Record<string, AssetEntry>> = { ...Object.fromEntries(
  Object.values(destinationAssets).flatMap(asset => [
    [asset.assetId, { id: asset.assetId, src: asset.card, alt: asset.alt, width: 480, height: 270, source: 'docs/assets/SOURCES-planning.md' }],
    [asset.assetId + '-detail', { id: asset.assetId + '-detail', src: asset.detail, alt: asset.alt, width: 960, height: 540, source: 'docs/assets/SOURCES-planning.md' }],
  ]),
), 'asset-squad-suzhou-240': {
  id: 'asset-squad-suzhou-240', src: new URL('../assets/destinations/suzhou-240.webp', import.meta.url).href,
  alt: '苏州园林示意插画', width: 240, height: 135, source: 'docs/assets/SOURCES-planning.md',
} };
