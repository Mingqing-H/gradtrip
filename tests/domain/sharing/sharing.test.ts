import { describe, expect, it } from 'vitest';
import {
  base64UrlToBytes,
  buildBackupEnvelope,
  buildInvitationEnvelope,
  buildPublicSnapshot,
  decodeEnvelopeFromJson,
  previewResponseImport,
  remapTripIds,
  snapshotToNewTripDraft,
  validateImportedTrip,
} from '../../../src/domain/sharing';
import { applyResponseToTrip } from '../../../src/domain/sharing/response';
import { registerInvitationToTrip } from '../../../src/domain/sharing/invitation';
import { fixturePlanning, makeConfirmedTrip, makeInvitation, makeTrip } from './fixtures';
import type { ResponseInput } from '../../../src/domain/commands';
import type { SharingEnvelope, ResponseBody } from '../../../src/domain/sharing/types';

describe('sharing codec and envelope schema', () => {
  it('round-trips Chinese JSON and rejects unknown envelope fields', () => {
    const envelope = buildBackupEnvelope(makeTrip(), { payloadId: 'backup_1', now: '2026-11-18T10:00:00.000Z' });
    const parsed = decodeEnvelopeFromJson(JSON.stringify(envelope));
    expect(parsed.ok).toBe(true);
    expect(JSON.stringify((parsed as { ok: true; value: typeof envelope }).value)).toContain('毕业旅行');

    const invalid = decodeEnvelopeFromJson(JSON.stringify({ ...envelope, extra: true }));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('SCHEMA_INVALID');
  });

  it('rejects unsupported schema versions and malformed JSON', () => {
    const future = decodeEnvelopeFromJson(JSON.stringify({ schemaVersion: 2, type: 'snapshot' }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    const malformed = decodeEnvelopeFromJson('{"schemaVersion":1');
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('JSON_INVALID');
    expect(base64UrlToBytes('AB')).toBeNull();
  });
});

describe('snapshot and invitation whitelist', () => {
  it('omits private notes and member/ledger data from a snapshot', () => {
    const trip = makeConfirmedTrip();
    const result = buildPublicSnapshot(trip, {
      planId: 'p_qingdao',
      payloadId: 'snap_1',
      now: '2026-11-18T10:00:00.000Z',
      today: '2026-11-18',
      planning: fixturePlanning,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result.value);
    expect(json).not.toContain('私人备注不应分享');
    expect(json).not.toContain('members');
    expect(json).not.toContain('expenses');
    expect(result.value.body.confirmation.status).toBe('confirmed');
  });

  it('blocks snapshots with out-of-range itinerary activities', () => {
    const result = buildPublicSnapshot(
      makeTrip({ activities: [{ ...makeTrip().itinerary.activities[0]!, date: '2027-08-01' }] }),
      {
        planId: 'p_qingdao', payloadId: 'snap_2', now: '2026-11-18T10:00:00.000Z', today: '2026-11-18', planning: fixturePlanning,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ITINERARY_OUT_OF_RANGE');
  });

  it('creates an independent draft from a snapshot', () => {
    const result = buildPublicSnapshot(makeTrip(), {
      planId: 'p_qingdao', payloadId: 'snap_3', now: '2026-11-18T10:00:00.000Z', today: '2026-11-18', planning: fixturePlanning,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = snapshotToNewTripDraft(result.value, {
      newTripId: 'trip_copy', now: '2026-11-18T10:00:00.000Z', idFactory: { nextId: (kind, oldId) => `copy_${kind}_${oldId}` },
    });
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.value.id).toBe('trip_copy');
    expect(copy.value.members).toHaveLength(0);
    expect(copy.value.confirmation).toBeNull();
    expect(copy.value.expenses).toHaveLength(0);
    expect(copy.value.itinerary.activities[0]?.note).toBe('');
  });

  it('shares only a target member manual transport override', () => {
    const result = buildInvitationEnvelope(makeTrip(), {
      memberId: 'm_lin', includeManualTransport: true, payloadId: 'inv_payload', now: '2026-11-18T10:00:00.000Z', planning: fixturePlanning,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.body.plans[0]?.estimate.manualTransport).toEqual({ originCity: '上海', amountCents: 56_000 });
    expect(JSON.stringify(result.value)).not.toContain('m_chen');
    expect(JSON.stringify(result.value)).not.toContain('budgetCap');
  });

  it('registers invitations once and rejects duplicate IDs', () => {
    const trip = makeTrip({ invitations: [] });
    const invitation = makeInvitation();
    const first = registerInvitationToTrip(trip, invitation);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const duplicate = registerInvitationToTrip(first.value, invitation);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('ID_CONFLICT');
  });
});

describe('response preview and application', () => {
  function responseEnvelope(overrides: Partial<ResponseBody> = {}): SharingEnvelope<ResponseBody> {
    return {
      schemaVersion: 1,
      type: 'response',
      payloadId: 'response_1',
      createdAt: '2026-11-18T10:00:00.000Z',
      body: {
        invitationId: 'inv_1', tripId: 'trip_1', memberId: 'm_zhou', memberName: '周予安', baseConstraintRevision: 2,
        profile: { name: '周予安', originCity: '南京', budgetCap: 160_000, availability: [{ start: '2027-07-02', end: '2027-07-12' }], preferences: ['海边'] },
        intents: [{ planId: 'p_qingdao', planVersion: 1, value: 'acceptable' }],
        ...overrides,
      },
    };
  }

  it('previews profile and intent changes without mutating trip', () => {
    const trip = makeTrip();
    const response = responseEnvelope();
    const preview = previewResponseImport(trip, response, fixturePlanning);
    expect(preview.state).toBe('applicable');
    expect(preview.profileChanged).toBe(true);
    expect(trip.constraintRevision).toBe(2);
    expect(trip.members.find((member) => member.id === 'm_zhou')?.budgetCap).toBeNull();
  });

  it('applies profile change atomically and writes intents at new revision', () => {
    const trip = makeTrip();
    const input: ResponseInput = {
      id: 'response_1', invitationId: 'inv_1', tripId: 'trip_1', memberId: 'm_zhou', constraintRevision: 2,
      planVersions: { p_qingdao: 1 },
      member: { name: '周予安', originCity: '南京', budgetCap: 160_000, availability: [{ start: '2027-07-02', end: '2027-07-12' }], preferences: ['海边'] },
      intents: [{ planId: 'p_qingdao', planVersion: 1, value: 'acceptable' }],
    };
    const applied = applyResponseToTrip(trip, input, { now: '2026-11-18T10:00:00.000Z', planning: fixturePlanning });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.constraintRevision).toBe(3);
    expect(applied.value.members.find((member) => member.id === 'm_zhou')?.budgetCap).toBe(160_000);
    expect(applied.value.intents.find((intent) => intent.memberId === 'm_zhou')?.constraintRevision).toBe(3);
    expect(applied.value.appliedResponses).toHaveLength(1);
  });

  it('rejects stale, duplicate and unregistered responses', () => {
    const stale = previewResponseImport(makeTrip(), responseEnvelope({ baseConstraintRevision: 1 }), fixturePlanning);
    expect(stale.state).toBe('stale');
    const duplicateTrip = makeTrip({ appliedResponses: [{ id: 'response_1', invitationId: 'inv_1', appliedAt: '2026-11-18T10:00:00.000Z' }] });
    const duplicate = previewResponseImport(duplicateTrip, responseEnvelope(), fixturePlanning);
    expect(duplicate.state).toBe('duplicate');
    const unknownInvitation = previewResponseImport(makeTrip(), responseEnvelope({ invitationId: 'missing' }), fixturePlanning);
    expect(unknownInvitation.state).toBe('invalid');
    expect(unknownInvitation.error?.code).toBe('INVITATION_NOT_REGISTERED');
  });
});

describe('backup validation and remapping', () => {
  it('validates a backup and rejects broken expense references atomically', () => {
    const trip = makeTrip({ expenses: [{
      id: 'expense_1', title: '住宿', date: '2027-07-03', category: '住宿', amount: 100, payerId: 'm_lin', splitMode: 'custom', allocations: [{ memberId: 'missing', amount: 100 }], createdAt: '2026-11-18T10:00:00.000Z',
    }] });
    const invalid = validateImportedTrip(trip);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('BACKUP_INVALID');
  });

  it('remaps every referenced ID and clears consensus on a copied backup', () => {
    const source = makeConfirmedTrip();
    const copy = remapTripIds(source, { newTripId: 'copy_trip', now: '2026-11-18T10:00:00.000Z', nextId: (kind, oldId) => `new_${kind}_${oldId}` });
    expect(copy.id).toBe('copy_trip');
    expect(copy.members[0]?.id).toBe('new_member_m_lin');
    expect(copy.plans[0]?.id).toBe('new_plan_p_qingdao');
    expect(copy.confirmation).toBeNull();
    expect(copy.intents).toHaveLength(0);
    expect(copy.invitations).toHaveLength(0);
    expect(copy.appliedResponses).toHaveLength(0);
  });
});
