/**
 * 分享传输适配器：UTF-8/Base64URL 编解码、分享链接构建与解析、
 * JSON 文件下载/读取、剪贴板复制（MVP_DEVELOPMENT §6）。
 *
 * - 链接放在 URL fragment（#/<route>?data=<base64url>），不随请求发送。
 * - 完整 URL UTF-8 长度上限 8000 字节，超过只回退文件，不截断（BR-13）。
 * - 导入只接受相同 origin 与部署 base 的受支持路由，不 fetch 链接目标。
 * - 解码前限制编码长度，解码后校验 1 MiB 上限；非法编码可解释地报错。
 */
import { base64UrlToBytes, bytesToBase64Url } from '../domain/sharing/codec';
import { SHARING_LIMITS, sharingError } from '../domain/sharing/types';
import type { SharingEnvelopeType, SharingError } from '../domain/sharing/types';

export const URL_BYTE_LIMIT = SHARING_LIMITS.urlBytes;
export const JSON_BYTE_LIMIT = SHARING_LIMITS.jsonBytes;
const ENCODED_FRAGMENT_LIMIT = SHARING_LIMITS.encodedFragmentBytes;

/** 链接可承载的载荷类型；backup 仅通过文件传递。 */
export const LINKABLE_TYPES: ReadonlyMap<SharingEnvelopeType, string> = new Map([
  ['snapshot', '/share'],
  ['invitation', '/join'],
  ['response', '/response'],
]);

export type TransferResult<T> = { ok: true; value: T } | { ok: false; error: SharingError };

// ---------------------------------------------------------------------------
// UTF-8 与字节测量
// ---------------------------------------------------------------------------

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8ByteLength(text: string): number {
  return utf8Bytes(text).length;
}

/** 严格 UTF-8 解码：非法字节序列返回 null，不产生替换字符。 */
export function utf8FromBytes(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function encodeJsonToFragment(json: string): string {
  return bytesToBase64Url(utf8Bytes(json));
}

// ---------------------------------------------------------------------------
// 链接构建
// ---------------------------------------------------------------------------

export interface ShareSiteBase {
  /** 例如 https://user.github.io */
  origin: string;
  /** 以 / 开头并以 / 结尾的部署 base，例如 /gradtrip/；根部署为 /。 */
  basePath: string;
}

export function normalizeBasePath(basePath: string): string {
  const withLeading = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export interface BuildShareUrlOptions extends ShareSiteBase {
  type: SharingEnvelopeType;
  json: string;
}

/** 生成分享链接；超长返回 URL_TOO_LONG（调用方降级为文件导出，不截断）。 */
export function buildShareUrl(options: BuildShareUrlOptions): TransferResult<string> {
  const route = LINKABLE_TYPES.get(options.type);
  if (!route) {
    return {
      ok: false,
      error: sharingError('UNSUPPORTED_ROUTE', '该类型只能通过文件传递，不支持生成链接'),
    };
  }
  const jsonBytes = utf8ByteLength(options.json);
  if (jsonBytes > JSON_BYTE_LIMIT) {
    return {
      ok: false,
      error: sharingError('PAYLOAD_TOO_LARGE', '内容超过 1 MiB，链接与文件均无法承载'),
    };
  }
  const url = `${options.origin}${normalizeBasePath(options.basePath)}#${route}?data=${encodeJsonToFragment(options.json)}`;
  const byteLength = utf8ByteLength(url);
  if (byteLength > URL_BYTE_LIMIT) {
    return {
      ok: false,
      error: sharingError('URL_TOO_LONG', '链接超过 8000 字节，请改用文件传递', {
        meta: { byteLength },
      }),
    };
  }
  return { ok: true, value: url };
}

// ---------------------------------------------------------------------------
// 链接解析（导入侧）
// ---------------------------------------------------------------------------

export interface ParsedShareLink {
  route: string;
  envelopeType: SharingEnvelopeType;
  json: string;
}

const ROUTE_TO_TYPE: ReadonlyMap<string, SharingEnvelopeType> = new Map([
  ['/share', 'snapshot'],
  ['/join', 'invitation'],
  ['/response', 'response'],
]);

/**
 * 解析粘贴的分享链接。只接受本应用相同 origin 与 base 的 fragment 路由；
 * 编码长度、UTF-8 严格性与解码后大小逐层校验，任何失败都不产生本地变更。
 */
export function parseShareLink(input: string, site: ShareSiteBase): TransferResult<ParsedShareLink> {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: sharingError('LINK_INVALID', '这不是有效的链接地址') };
  }
  if (url.origin !== site.origin.replace(/\/$/, '')) {
    return {
      ok: false,
      error: sharingError('CROSS_ORIGIN', '链接不属于当前应用站点，已拒绝打开', {
        meta: { linkOrigin: url.origin, expectedOrigin: site.origin },
      }),
    };
  }
  const expectedPath = normalizeBasePath(site.basePath);
  if (url.pathname !== expectedPath) {
    return {
      ok: false,
      error: sharingError('BASE_MISMATCH', '链接路径与当前部署地址不一致，已拒绝打开', {
        meta: { linkPath: url.pathname, expectedPath },
      }),
    };
  }
  if (!url.hash.startsWith('#/')) {
    return { ok: false, error: sharingError('UNSUPPORTED_ROUTE', '链接不是受支持的分享路由') };
  }
  const hashBody = url.hash.slice(1); // 去掉 #
  const queryIndex = hashBody.indexOf('?');
  const route = queryIndex >= 0 ? hashBody.slice(0, queryIndex) : hashBody;
  const envelopeType = ROUTE_TO_TYPE.get(route);
  if (!envelopeType) {
    return { ok: false, error: sharingError('UNSUPPORTED_ROUTE', `不支持的路由 ${route}`) };
  }
  if (queryIndex < 0) {
    return { ok: false, error: sharingError('LINK_INVALID', '链接缺少分享数据') };
  }
  const params = new URLSearchParams(hashBody.slice(queryIndex + 1));
  const data = params.get('data');
  if (data === null || data.length === 0) {
    return { ok: false, error: sharingError('LINK_INVALID', '链接缺少分享数据') };
  }
  if (data.length > ENCODED_FRAGMENT_LIMIT) {
    return { ok: false, error: sharingError('PAYLOAD_TOO_LARGE', '链接数据超过大小上限') };
  }
  const bytes = base64UrlToBytes(data);
  if (bytes === null) {
    return { ok: false, error: sharingError('ENCODE_INVALID', '链接数据编码损坏，无法读取') };
  }
  const json = utf8FromBytes(bytes);
  if (json === null) {
    return { ok: false, error: sharingError('ENCODE_INVALID', '链接数据不是有效的 UTF-8 文本') };
  }
  if (utf8ByteLength(json) > JSON_BYTE_LIMIT) {
    return { ok: false, error: sharingError('PAYLOAD_TOO_LARGE', '链接数据超过 1 MiB 上限') };
  }
  return { ok: true, value: { route, envelopeType, json } };
}

// ---------------------------------------------------------------------------
// 文件下载 / 读取 / 剪贴板
// ---------------------------------------------------------------------------

export interface DownloadDeps {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  triggerDownload(url: string, filename: string): void;
}

const defaultDownloadDeps = (): DownloadDeps | null => {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null;
  }
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    triggerDownload(url, filename) {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
  };
};

/** 将 JSON 文本作为文件下载；失败返回可解释错误（调用方可提示重试或手动保存）。 */
export function downloadJsonFile(
  filename: string,
  json: string,
  deps: DownloadDeps | null = defaultDownloadDeps(),
): TransferResult<{ filename: string; byteLength: number }> {
  const byteLength = utf8ByteLength(json);
  if (byteLength > JSON_BYTE_LIMIT) {
    return {
      ok: false,
      error: sharingError('PAYLOAD_TOO_LARGE', '导出内容超过 1 MiB 文件上限', { meta: { byteLength } }),
    };
  }
  if (!deps) {
    return { ok: false, error: sharingError('LINK_INVALID', '当前环境不支持文件下载，请手动复制内容') };
  }
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const objectUrl = deps.createObjectURL(blob);
  try {
    deps.triggerDownload(objectUrl, filename);
  } finally {
    deps.revokeObjectURL(objectUrl);
  }
  return { ok: true, value: { filename, byteLength } };
}

export interface ReadFileDeps {
  /** 读取文件原始字节；默认走 File.arrayBuffer()。 */
  readBytes(file: Blob): Promise<ArrayBuffer>;
}

const defaultReadFileDeps: ReadFileDeps = {
  readBytes: (file) => file.arrayBuffer(),
};

/** 读取用户选择的 JSON 文件；先检查大小，再严格 UTF-8 解码。 */
export async function readJsonTextFromFile(
  file: Blob & { name?: string },
  limitBytes: number = JSON_BYTE_LIMIT,
  deps: ReadFileDeps = defaultReadFileDeps,
): Promise<TransferResult<string>> {
  if (file.size > limitBytes) {
    return {
      ok: false,
      error: sharingError('PAYLOAD_TOO_LARGE', '文件超过 1 MiB 上限，未读取内容', {
        meta: { size: file.size, limit: limitBytes },
      }),
    };
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await deps.readBytes(file);
  } catch {
    return { ok: false, error: sharingError('LINK_INVALID', '文件读取失败，请重试或更换文件') };
  }
  const json = utf8FromBytes(new Uint8Array(bytes));
  if (json === null) {
    return { ok: false, error: sharingError('ENCODE_INVALID', '文件不是有效的 UTF-8 文本') };
  }
  if (utf8ByteLength(json) > limitBytes) {
    return { ok: false, error: sharingError('PAYLOAD_TOO_LARGE', '文件内容超过 1 MiB 上限') };
  }
  return { ok: true, value: json };
}

export interface ClipboardDeps {
  writeText(text: string): Promise<void>;
}

const defaultClipboardDeps = (): ClipboardDeps | null => {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    return null;
  }
  return { writeText: (text) => navigator.clipboard.writeText(text) };
}

/**
 * 复制文本到剪贴板；不可用或失败时返回失败结果，
 * 页面保留可选中文本供手动复制（PRD F05），不要求用户重填。
 */
export async function copyTextToClipboard(
  text: string,
  deps: ClipboardDeps | null = defaultClipboardDeps(),
): Promise<TransferResult<true>> {
  if (!deps) {
    return { ok: false, error: sharingError('LINK_INVALID', '剪贴板不可用，请手动复制文本') };
  }
  try {
    await deps.writeText(text);
    return { ok: true, value: true };
  } catch {
    return { ok: false, error: sharingError('LINK_INVALID', '复制失败，请手动选中文本复制') };
  }
}
