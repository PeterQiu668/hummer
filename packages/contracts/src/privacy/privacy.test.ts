import { describe, expect, it } from 'vitest';
import { DemoSessionV1StandardSchema, validatePrivacyContract, type DemoSessionV1 } from './index.ts';

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

function sample(overrides: Partial<DemoSessionV1> = {}): DemoSessionV1 {
  return {
    schema: 'hummer.demo-session',
    version: 1,
    sessionId: 'demo-1',
    tenantId: 'tenant-a',
    expertActorRef: 'human:alice',
    nodeId: 'node-a',
    sourceBoundary: { apps: ['ResearchApp'], windows: ['Approved workspace'], excluded: ['Password dialog'] },
    startedAt: '2026-10-07T00:00:00.000Z',
    pausedCount: 1,
    segments: [
      { segId: 'seg-1', sequence: 1, from: '2026-10-07T00:00:00.000Z', to: '2026-10-07T00:01:00.000Z', recordCount: 1, previousDigest: null, digest: digestA },
      { segId: 'seg-2', sequence: 2, from: '2026-10-07T00:02:00.000Z', recordCount: 0, previousDigest: digestA, digest: digestB },
    ],
    captureMode: 'ax-tree+keyframes',
    status: 'capturing',
    localOnly: true,
    redactionApplied: false,
    evidenceRefs: [],
    chainHead: digestB,
    deletionAudit: [],
    ...overrides,
  };
}

describe('DemoSession privacy contract', () => {
  it('PRIVACY-CONTRACT accepts strict TypeBox, AJV and Standard Schema input', () => {
    expect(validatePrivacyContract('DemoSessionV1', sample()).issues).toBeUndefined();
    expect(DemoSessionV1StandardSchema['~standard'].validate(sample())).toMatchObject({ value: expect.any(Object) });
  });

  it.each([
    ['non-human expert', { expertActorRef: 'expert:alice' }],
    ['localOnly false', { localOnly: false }],
    ['full-video capture', { captureMode: 'full-video' }],
    ['unknown field', { uploadAllowed: true }],
    ['redaction without policy', { redactionApplied: true }],
    ['empty window allowlist', { sourceBoundary: { apps: ['ResearchApp'], windows: [], excluded: [] } }],
  ])('PRIVACY-CONTRACT rejects %s', (_label, invalid) => {
    expect(validatePrivacyContract('DemoSessionV1', { ...sample(), ...invalid }).issues).toBeTruthy();
  });

  it('PRIVACY-CONTRACT rejects a broken digest chain and unaudited deleted segment', () => {
    const broken = sample({
      segments: [
        { ...sample().segments[0]!, deletedAt: '2026-10-07T00:03:00.000Z', recordCount: 0 },
        { ...sample().segments[1]!, previousDigest: null },
      ],
    });
    expect(validatePrivacyContract('DemoSessionV1', broken).issues).toBeTruthy();
  });
});
