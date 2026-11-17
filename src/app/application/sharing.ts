/**
 * 分享应用层编排：把本地仓库/规划服务与分享域纯函数接起来。
 *
 * 页面只调用本文件导出的用例，不直接访问 IndexedDB；保存、revision、事务和
 * expectedRevision 仍由 T01 的 repository/execute 负责。这里负责生成白名单载荷、
 * 预览导入、构造 B0 命令以及链接/文件传输降级。
 */
import type { ResponseInput } from '../../domain/commands';
import type { Trip } from '../../domain/types';
import type {
  Repository,
  SharingApplicationDependencies,
  SharingService,
} from '../../contracts/services';
import type { Result } from '../../contracts/result';
import { failure, success } from '../../contracts/result';
import {
  buildBackupEnvelope,
  buildInvitationEnvelope,
  buildPublicSnapshot,
  buildResponseEnvelope,
  decodeEnvelopeFromJson,
  planBackupImport,
  previewResponseImport,
  validateBackupForImport,
  type ResponsePreview,
} from '../../domain/sharing';
import type {
  BackupBody,
  BackupImportPlan,
  InvitationBody,
  MemberProfileInput,
  ResponseBody,
  SharingEnvelope,
  SharingPlanning,
  SharingResult,
} from '../../domain/sharing/types';
import {
  buildShareUrl,
  copyTextToClipboard,
  downloadJsonFile,
  parseShareLink,
  readJsonTextFromFile,
  type ParsedShareLink,
} from '../../infrastructure/transfer';

export interface SharingApplication {
  service: SharingService;
  getTrip(tripId?: string): Promise<Result<Trip>>;
  buildSnapshot(trip: Trip, planId?: string): SharingResult<SharingEnvelope<import('../../domain/sharing/types').SnapshotBody>>;
  buildInvitation(
    trip: Trip,
    memberId: string,
    includeManualTransport?: boolean,
  ): SharingResult<SharingEnvelope<InvitationBody>>;
  buildResponse(
    invitation: SharingEnvelope<InvitationBody>,
    profile: MemberProfileInput,
    intents: Array<{ planId: string; value: ResponseBody['intents'][number]['value'] }>,
  ): SharingResult<SharingEnvelope<ResponseBody>>;
  buildBackup(trip: Trip): SharingEnvelope<BackupBody>;
  parseIncoming(data: string): SharingResult<SharingEnvelope>;
  previewResponse(trip: Trip, response: SharingEnvelope<ResponseBody>): ResponsePreview;
  validateBackup(data: SharingEnvelope<BackupBody>): SharingResult<Trip>;
  planBackup(
    localTrip: Trip | null,
    data: SharingEnvelope<BackupBody>,
    mode: 'copy' | 'overwrite',
  ): SharingResult<BackupImportPlan>;
  createShareUrl(type: 'snapshot' | 'invitation' | 'response', envelope: SharingEnvelope): SharingResult<string>;
  downloadEnvelope(envelope: SharingEnvelope, filename: string): SharingResult<{ filename: string; byteLength: number }>;
  copyShareUrl(url: string): Promise<SharingResult<true>>;
  readFile(file: Blob & { name?: string }): Promise<SharingResult<string>>;
}

function asPlanning(deps: SharingApplicationDependencies): SharingPlanning {
  return deps.planning;
}

function siteParts(baseUrl: string): { origin: string; basePath: string } {
  try {
    const parsed = new URL(baseUrl, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    return { origin: parsed.origin, basePath: parsed.pathname || '/' };
  } catch {
    return {
      origin: typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
      basePath: baseUrl || '/',
    };
  }
}

function jsonEnvelope(envelope: SharingEnvelope): string {
  return JSON.stringify(envelope);
}

function envelopeFromData(data: string): SharingResult<SharingEnvelope> {
  const parsed = decodeEnvelopeFromJson(data);
  if (parsed.ok) return parsed;
  // 允许面板粘贴纯 JSON；链接由 parseShareLink 单独解析。
  return parsed;
}

async function getTripFromRepository(repository: Repository, tripId?: string): Promise<Result<Trip>> {
  if (tripId) return repository.get(tripId);
  const settings = await repository.getSettings();
  if (settings.ok && settings.value.lastTripId) {
    const current = await repository.get(settings.value.lastTripId);
    if (current.ok) return current;
  }
  const list = await repository.list();
  if (!list.ok) return list;
  const first = list.value[0];
  return first ? repository.get(first.id) : failure('NOT_FOUND', '当前设备还没有旅行');
}

/**
 * 创建分享用例。可传入 tripId 固定当前工作旅行；未传入时按最近访问旅行解析。
 */
export function createSharingApplication(
  services: SharingApplicationDependencies,
  tripId?: string,
): SharingApplication {
  const planning = asPlanning(services);
  const getTrip = (id = tripId) => getTripFromRepository(services.repository, id);

  const buildInvitation = (trip: Trip, memberId: string, includeManualTransport = false) =>
    buildInvitationEnvelope(trip, {
      memberId,
      includeManualTransport,
      payloadId: services.createId(),
      now: services.now(),
      planning,
    });

  const buildSnapshot = (trip: Trip, planId?: string) =>
    buildPublicSnapshot(trip, {
      planId,
      payloadId: services.createId(),
      now: services.now(),
      today: services.today(),
      planning,
    });

  const service: SharingService = {
    registerInvitation: async (memberId) => {
      const current = await getTrip();
      if (!current.ok) return current;
      const invitation = buildInvitation(current.value, memberId, false);
      if (!invitation.ok) return failure('VALIDATION', invitation.error.message);
      const record = {
        id: invitation.value.payloadId,
        memberId,
        constraintRevision: invitation.value.body.constraintRevision,
        planVersions: Object.fromEntries(invitation.value.body.plans.map((plan) => [plan.id, plan.version])),
        createdAt: invitation.value.createdAt,
      };
      const applied = await services.execute({ type: 'sharing.registerInvitation', invitation: record });
      if (!applied.ok) return failure(applied.error.code, applied.error.message, applied.error.fields);
      const link = createShareUrlFor(services.baseUrl, 'invitation', invitation.value);
      if (link.ok) return success(link.value);
      // 注册已成功但链接过长时返回 JSON 文本作为可下载回退；页面会提示使用文件。
      return success(jsonEnvelope(invitation.value));
    },
    applyResponse: async (response: ResponseInput) =>
      services.execute({ type: 'sharing.applyResponse', response }),
  };

  return {
    service,
    getTrip,
    buildSnapshot,
    buildInvitation,
    buildResponse: (invitation, profile, intents) => buildResponseEnvelope(invitation, profile, intents, { payloadId: services.createId(), now: services.now() }),
    buildBackup: (trip) => buildBackupEnvelope(trip, { payloadId: services.createId(), now: services.now() }),
    parseIncoming: envelopeFromData,
    previewResponse: (trip, response) => previewResponseImport(trip, response, planning),
    validateBackup: (data) => validateBackupForImport(data),
    planBackup: (localTrip, data, mode) => {
      const validated = validateBackupForImport(data);
      if (!validated.ok) return validated;
      return planBackupImport(localTrip, { ...data, body: { trip: validated.value } }, {
        mode,
        newTripId: services.createId(),
        now: services.now(),
        nextId: (kind, oldId) => `${services.createId()}_${kind}_${oldId}`,
      });
    },
    createShareUrl: (type, envelope) => createShareUrlFor(services.baseUrl, type, envelope),
    downloadEnvelope: (envelope, filename) => downloadJsonFile(filename, jsonEnvelope(envelope)),
    copyShareUrl: (url) => copyTextToClipboard(url),
    readFile: (file) => readJsonTextFromFile(file),
  };
}

function createShareUrlFor(
  baseUrl: string,
  type: 'snapshot' | 'invitation' | 'response',
  envelope: SharingEnvelope,
): SharingResult<string> {
  const { origin, basePath } = siteParts(baseUrl);
  return buildShareUrl({ origin, basePath, type, json: jsonEnvelope(envelope) });
}

/** 便于面板使用：解析同源链接或 JSON 文件文本为 envelope。 */
export function parseSharingInput(
  input: string,
  baseUrl: string,
): SharingResult<SharingEnvelope> {
  const trimmed = input.trim();
  if (trimmed.startsWith('{')) return envelopeFromData(trimmed);
  const site = siteParts(baseUrl);
  const link = parseShareLink(trimmed, site);
  if (!link.ok) return link;
  return envelopeFromData(link.value.json);
}

export type { ParsedShareLink };
export {
  buildShareUrl,
  copyTextToClipboard,
  downloadJsonFile,
  parseShareLink,
  readJsonTextFromFile,
};
