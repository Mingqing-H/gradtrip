export interface AssetEntry { id: string; src: string; alt: string; width: number; height: number; source: string }
export const assetManifest: Readonly<Record<string, AssetEntry>> = {};
// Planning-owned images will be composed here when T02 delivers assetsPlanning.ts.
