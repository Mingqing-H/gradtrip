import { describe, expect, it } from 'vitest';
import {
  buildShareUrl,
  copyTextToClipboard,
  downloadJsonFile,
  parseShareLink,
  readJsonTextFromFile,
  utf8ByteLength,
} from '../../../src/infrastructure/transfer';
import { base64UrlToBytes, buildInvitationEnvelope } from '../../../src/domain/sharing';
import { fixturePlanning, makeTrip } from '../../domain/sharing/fixtures';

const SITE = { origin: 'https://example.github.io', basePath: '/gradtrip/' };

describe('transfer link building', () => {
  it('builds same-origin base64url link with UTF-8 payload', () => {
    const invitation = buildInvitationEnvelope(makeTrip(), {
      memberId: 'm_lin',
      includeManualTransport: false,
      payloadId: 'inv_link',
      now: '2026-11-18T10:00:00.000Z',
      planning: fixturePlanning,
    });
    expect(invitation.ok).toBe(true);
    if (!invitation.ok) return;
    const result = buildShareUrl({ ...SITE, type: 'invitation', json: JSON.stringify(invitation.value) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.startsWith('https://example.github.io/gradtrip/#/join?data=')).toBe(true);
    const parsed = parseShareLink(result.value, SITE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.envelopeType).toBe('invitation');
    expect(JSON.parse(parsed.value.json).payloadId).toBe('inv_link');
  });

  it('rejects cross-origin links', () => {
    const parsed = parseShareLink('https://attacker.example/gradtrip/#/join?data=AA', SITE);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('CROSS_ORIGIN');
  });

  it('rejects wrong base paths and unsupported routes', () => {
    expect(parseShareLink('https://example.github.io/other/#/join?data=AA', SITE).ok).toBe(false);
    expect(parseShareLink('https://example.github.io/gradtrip/#/unknown?data=AA', SITE).ok).toBe(false);
  });

  it('falls back when URL exceeds 8000 UTF-8 bytes', () => {
    const bigJson = JSON.stringify({ schemaVersion: 1, type: 'invitation', payloadId: 'big', createdAt: '2026-11-18T10:00:00.000Z', body: { text: '毕业旅行'.repeat(2000) } });
    const result = buildShareUrl({ ...SITE, type: 'invitation', json: bigJson });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('URL_TOO_LONG');
  });

  it('rejects backup link creation (file only)', () => {
    const result = buildShareUrl({ ...SITE, type: 'backup', json: '{}' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_ROUTE');
  });

  it('rejects tampered Base64URL payload', () => {
    const parsed = parseShareLink('https://example.github.io/gradtrip/#/join?data=AB', SITE);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('ENCODE_INVALID');
  });

  it('utf8ByteLength counts Chinese characters correctly', () => {
    expect(utf8ByteLength('同路')).toBe(6);
    expect(base64UrlToBytes('AAA')).not.toBeNull();
  });
});

describe('file and clipboard fallbacks', () => {
  it('downloads JSON as Blob and revokes object URL', async () => {
    let created: string | null = null;
    let revoked: string | null = null;
    let triggered: { url: string; filename: string } | null = null;
    const result = downloadJsonFile('backup.json', '{"ok":true}', {
      createObjectURL: () => {
        created = 'blob:test';
        return 'blob:test';
      },
      revokeObjectURL: (url) => {
        revoked = url;
      },
      triggerDownload: (url, filename) => {
        triggered = { url, filename };
      },
    });
    expect(result.ok).toBe(true);
    expect(created).toBe('blob:test');
    expect(revoked).toBe('blob:test');
    expect(triggered).toEqual({ url: 'blob:test', filename: 'backup.json' });
  });

  it('reads JSON file and rejects non-UTF-8 content', async () => {
    const chinese = '同路·毕业旅行';
    const file = new Blob([new TextEncoder().encode(chinese)]) as Blob & { size: number };
    const result = await readJsonTextFromFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(chinese);
    const invalid = new Blob([new Uint8Array([0xff, 0xfe, 0x00])]);
    const bad = await readJsonTextFromFile(invalid);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('ENCODE_INVALID');
  });

  it('rejects files exceeding size limit', async () => {
    const big = { size: 2 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
    const result = await readJsonTextFromFile(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns failure when clipboard is unavailable', async () => {
    const result = await copyTextToClipboard('https://example.github.io/gradtrip/#/share?data=AA', null);
    expect(result.ok).toBe(false);
  });
});
