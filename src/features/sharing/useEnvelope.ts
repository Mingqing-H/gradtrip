import { useMemo } from 'react';
import { createSharingApplication } from '../../app/application/sharing';
import type { SharingApplicationDependencies } from '../../contracts/services';
import { base64UrlToBytes, decodeEnvelopeFromJson } from '../../domain/sharing';
import type { ParsedSharingEnvelope } from '../../domain/sharing/schema';

export type DecodedEnvelope =
  | { ok: true; envelope: ParsedSharingEnvelope }
  | { ok: false; error: string };

/** 从 URL fragment data 参数解码 envelope。 */
export function useDecodedEnvelope(data: string | null): DecodedEnvelope {
  return useMemo((): DecodedEnvelope => {
    if (!data) return { ok: false, error: '缺少分享数据' };
    try {
      let json: string;
      if (data.startsWith('{')) {
        json = data;
      } else {
        const bytes = base64UrlToBytes(data);
        if (!bytes) return { ok: false, error: '链接数据编码无效' };
        json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
      const parsed = decodeEnvelopeFromJson(json);
      if (parsed.ok) return { ok: true, envelope: parsed.value };
      return { ok: false, error: parsed.error.message };
    } catch {
      return { ok: false, error: '无法解析分享数据' };
    }
  }, [data]);
}

export function useSharingApp(services: SharingApplicationDependencies, tripId?: string) {
  return useMemo(() => createSharingApplication(services, tripId), [services, tripId]);
}
