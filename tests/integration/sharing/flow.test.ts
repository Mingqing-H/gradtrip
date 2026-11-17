/**
 * 集成：注册邀请 → 生成反馈 → 组织者预览 → 通过 B0 命令管线应用，
 * 完整备份在内存仓库中恢复；期望反馈版本校验、重复无操作与 ID 重映射。
 */
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../../src/app/application/commands';
import { applySharingCommand, validateSharingTrip, buildInvitationEnvelope, buildResponseEnvelope, previewResponseImport, buildBackupEnvelope, planBackupImport, validateBackupForImport } from '../../../src/domain/sharing';
import type { DomainDependencies } from '../../../src/contracts/services';
import { fixturePlanning, makeTrip, makeInvitation } from '../../domain/sharing/fixtures';

const dependencies: DomainDependencies = {
  planning: fixturePlanning,
  buildTemplateItinerary: () => ({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'not used' } }),
};

const modules = { sharing: { apply: applySharingCommand, validate: validateSharingTrip } };
const NOW = '2026-11-18T10:00:00.000Z';

describe('invitation → response → apply through B0 command pipeline', () => {
  it('applies a fresh response once and rejects duplicates', () => {
    const base = makeTrip();
    const invitationEnvelope = buildInvitationEnvelope(base, {
      memberId: 'm_zhou',
      includeManualTransport: false,
      payloadId: 'inv_payload',
      now: NOW,
      planning: fixturePlanning,
    });
    expect(invitationEnvelope.ok).toBe(true);
    if (!invitationEnvelope.ok) return;

    // 组织者登记邀请
    const registered = applySharingCommand(
      base,
      {
        type: 'sharing.registerInvitation',
        invitation: {
          id: 'inv_payload',
          memberId: 'm_zhou',
          constraintRevision: invitationEnvelope.value.body.constraintRevision,
          planVersions: Object.fromEntries(invitationEnvelope.value.body.plans.map((p) => [p.id, p.version])),
          createdAt: NOW,
        },
      },
      { now: NOW, today: '2026-11-18', ids: [], commandId: 'cmd_reg' },
      dependencies,
    );
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const withInvite = registered.value;

    // 成员生成反馈
    const response = buildResponseEnvelope(
      invitationEnvelope.value,
      { name: '周予安', originCity: '南京', budgetCap: 180_000, availability: [{ start: '2027-07-02', end: '2027-07-12' }], preferences: ['海边'] },
      [{ planId: 'p_qingdao', value: 'acceptable' }],
      { payloadId: 'resp_1', now: NOW },
    );
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    // 组织者预览
    const preview = previewResponseImport(withInvite, response.value, fixturePlanning);
    expect(preview.state).toBe('applicable');

    // 通过 B0 applyCommand 管线应用（含 revision+1、validateSharingTrip 聚合）
    const applied = applyCommand(
      withInvite,
      { commandId: 'cmd_apply', tripId: withInvite.id, expectedRevision: withInvite.revision, payload: { type: 'sharing.applyResponse', response: {
        id: 'resp_1', invitationId: 'inv_payload', tripId: withInvite.id, memberId: 'm_zhou',
        constraintRevision: invitationEnvelope.value.body.constraintRevision,
        planVersions: { p_qingdao: 1 },
        member: { name: '周予安', originCity: '南京', budgetCap: 180_000, availability: [{ start: '2027-07-02', end: '2027-07-12' }], preferences: ['海边'] },
        intents: [{ planId: 'p_qingdao', planVersion: 1, value: 'acceptable' }],
      } } },
      { now: NOW, today: '2026-11-18', ids: [], commandId: 'cmd_apply' },
      modules,
      dependencies,
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.revision).toBe(withInvite.revision + 1);
    expect(applied.value.constraintRevision).toBe(3);
    expect(applied.value.appliedResponses).toHaveLength(1);
    expect(applied.value.intents.find((i) => i.memberId === 'm_zhou' && i.constraintRevision === 3)?.value).toBe('acceptable');

    // 同 payloadId 重复导入：预览标为 duplicate
    const dupPreview = previewResponseImport(applied.value, response.value, fixturePlanning);
    expect(dupPreview.state).toBe('duplicate');
  });

  it('rejects stale responses after another member update', () => {
    const base = makeTrip({ constraintRevision: 5 });
    const invitation = makeInvitation({ constraintRevision: 2 });
    const tripWithOldInvite = { ...base, invitations: [invitation] };
    const response = buildResponseEnvelope(
      buildInvitationEnvelope(base, { memberId: 'm_zhou', includeManualTransport: false, payloadId: 'inv_1', now: NOW, planning: fixturePlanning }).ok
        ? (buildInvitationEnvelope(base, { memberId: 'm_zhou', includeManualTransport: false, payloadId: 'inv_1', now: NOW, planning: fixturePlanning }) as { ok: true; value: never }).value
        : (() => { throw new Error('unreachable'); })(),
      { name: '周予安', originCity: '南京', budgetCap: null, availability: [], preferences: [] },
      [],
      { payloadId: 'resp_stale', now: NOW },
    );
    // 邀请基于 constraintRevision=5，但登记的邀请记录版本为 2 -> 版本不一致应拒绝
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const preview = previewResponseImport(tripWithOldInvite, response.value, fixturePlanning);
    expect(preview.state).toBe('invalid');
  });
});

describe('backup restore flow', () => {
  it('round-trips a full backup and remaps a copy with cleared consensus', () => {
    const source = makeTrip();
    const backup = buildBackupEnvelope(source, { payloadId: 'b_1', now: NOW });
    const validated = validateBackupForImport(backup);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    // 本地不存在同 ID：直接导入为新旅行（保留意向与确认）
    const asNew = planBackupImport(null, { ...backup, body: { trip: validated.value } }, {
      mode: 'copy', newTripId: 'unused', now: NOW, nextId: (k, o) => `${k}_${o}`,
    });
    expect(asNew.ok).toBe(true);
    if (!asNew.ok) return;
    expect(asNew.value.action).toBe('create');
    expect(asNew.value.trip.id).toBe('trip_1');
    expect(asNew.value.trip.invitations).toHaveLength(1);

    // 本地存在同 ID：另存副本（清除意向/确认/邀请）
    const asCopy = planBackupImport(source, { ...backup, body: { trip: validated.value } }, {
      mode: 'copy', newTripId: 'trip_copy', now: NOW, nextId: (k, o) => `copy_${k}_${o}`,
    });
    expect(asCopy.ok).toBe(true);
    if (!asCopy.ok) return;
    expect(asCopy.value.action).toBe('copy');
    expect(asCopy.value.trip.id).toBe('trip_copy');
    expect(asCopy.value.trip.intents).toHaveLength(0);
    expect(asCopy.value.trip.confirmation).toBeNull();
    expect(asCopy.value.trip.invitations).toHaveLength(0);

    // 覆盖同 ID
    const overwrite = planBackupImport(source, { ...backup, body: { trip: validated.value } }, {
      mode: 'overwrite', newTripId: 'unused', now: NOW, nextId: (k, o) => `${k}_${o}`,
    });
    expect(overwrite.ok).toBe(true);
    if (!overwrite.ok) return;
    expect(overwrite.value.action).toBe('overwrite');
    expect(overwrite.value.trip.id).toBe('trip_1');
  });
});
