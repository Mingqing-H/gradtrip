/**
 * 纯 Base64URL（RFC 4648 §5，无填充）字节编解码。
 *
 * 只做 bytes <-> ASCII 字符串转换，不依赖 TextEncoder/btoa，可在任何
 * 环境测试；UTF-8 转换与浏览器 API 在 src/infrastructure/transfer.ts。
 * 编码不是加密：链接持有者可读全部内容（BR-13）。
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const CHAR_TO_SEXTET = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i += 1) {
  CHAR_TO_SEXTET.set(ALPHABET[i]!, i);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET[(triple >> 18) & 0x3f]!;
    out += ALPHABET[(triple >> 12) & 0x3f]!;
    if (i + 1 < bytes.length) out += ALPHABET[(triple >> 6) & 0x3f]!;
    if (i + 2 < bytes.length) out += ALPHABET[triple & 0x3f]!;
  }
  return out;
}

/**
 * 解码 Base64URL 文本；非法字符、非法长度（%4==1）或存在不可能的尾组
 * 空位时返回 null，由调用方转为可解释错误，不抛异常。
 */
export function base64UrlToBytes(text: string): Uint8Array | null {
  if (text.length === 0) return new Uint8Array(0);
  if (text.length % 4 === 1) return null;
  const byteLength = Math.floor((text.length * 3) / 4);
  const out = new Uint8Array(byteLength);
  let outIndex = 0;
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    const sextets: number[] = [];
    for (const ch of chunk) {
      const value = CHAR_TO_SEXTET.get(ch);
      if (value === undefined) return null;
      sextets.push(value);
    }
    const hasSecond = sextets.length >= 2;
    const hasThird = sextets.length >= 3;
    const hasFourth = sextets.length >= 4;
    // 尾组不足 4 字符时，空位对应的低位必须为 0，否则不是规范编码。
    if (!hasFourth && sextets.length === 2 && (sextets[1]! & 0x0f) !== 0) return null;
    if (!hasFourth && sextets.length === 3 && (sextets[2]! & 0x03) !== 0) return null;
    const b0 = (sextets[0]! << 2) | (sextets[1]! >> 4);
    const b1 = ((sextets[1]! & 0x0f) << 4) | (hasThird ? sextets[2]! >> 2 : 0);
    const b2 = ((sextets[2]! & 0x03) << 6) | (hasFourth ? sextets[3]! : 0);
    if (outIndex < byteLength) out[outIndex++] = b0 & 0xff;
    if (hasSecond && outIndex < byteLength) out[outIndex++] = b1 & 0xff;
    if (hasThird && outIndex < byteLength) out[outIndex++] = b2 & 0xff;
  }
  if (outIndex !== byteLength) return null;
  return out;
}

export function isBase64UrlText(text: string): boolean {
  return base64UrlToBytes(text) !== null;
}
