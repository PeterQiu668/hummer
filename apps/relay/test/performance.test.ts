import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryFleetStore,
  SqliteFleetStore,
  type FleetStore,
  type RunEventClaims,
  type TaskClaims,
} from '../src/index.js';

const TENANT = 'tenant-perf';
const NOW = '2026-10-07T00:00:00.000Z';
const EXPIRES = '2026-10-07T02:00:00.000Z';
const NODE_COUNT = 10;
const TASK_COUNT = 100;
const EVENTS_PER_TASK = 100;
const EVENT_COUNT = TASK_COUNT * EVENTS_PER_TASK;
const directories: string[] = [];

interface PerfResult {
  store: 'memory' | 'sqlite';
  nodeCount: number;
  taskCount: number;
  eventCount: number;
  persistedEventCount: number;
  heartbeatP95Ms: number;
  dispatchP95Ms: number;
  eventWriteP95Ms: number;
  rejectedOverLimit: boolean;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe.each([
  ['memory', () => new MemoryFleetStore()],
  ['sqlite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-relay-perf-'));
    directories.push(directory);
    return new SqliteFleetStore(join(directory, 'relay.sqlite3'));
  }],
] as const)('%s FleetStore local capacity gate', (storeName, factory) => {
  it('runs 10 nodes, 100 tasks, and 10000 persisted events within the local p95 thresholds', async () => {
    const store = factory();
    const heartbeatSamples: number[] = [];
    const dispatchSamples: number[] = [];
    const eventSamples: number[] = [];
    try {
      for (let index = 0; index < NODE_COUNT; index += 1) {
        const nodeId = `node-${index}`;
        await store.registerNode(
          TENANT,
          { schema: 'test.node', nodeId, tenantIds: [TENANT], agentVersion: '1.0.0' },
          { nodeId, tenantIds: [TENANT], agentVersion: '1.0.0' },
          [TENANT],
          undefined,
          NOW,
          60_000,
        );
      }

      for (let index = 0; index < 100; index += 1) {
        const nodeId = `node-${index % NODE_COUNT}`;
        heartbeatSamples.push(await timed(() => store.heartbeat(
          TENANT,
          { nodeId, sentAt: NOW, running: 0 },
          NOW,
        )));
      }

      for (let index = 0; index < TASK_COUNT; index += 1) {
        const nodeId = `node-${index % NODE_COUNT}`;
        const claims = task(index, nodeId);
        dispatchSamples.push(await timed(async () => {
          const inserted = await store.enqueueTask(TENANT, { schema: 'test.task', ...claims }, claims, null, NOW);
          expect(inserted.inserted).toBe(true);
          const claimed = await store.claimTask(TENANT, nodeId, NOW);
          expect(claimed).toMatchObject({ taskId: claims.taskId, status: 'leased' });
        }));
      }

      for (let taskIndex = 0; taskIndex < TASK_COUNT; taskIndex += 1) {
        const nodeId = `node-${taskIndex % NODE_COUNT}`;
        for (let seq = 1; seq <= EVENTS_PER_TASK; seq += 1) {
          const claims = event(taskIndex, nodeId, seq);
          eventSamples.push(await timed(async () => {
            const result = await store.putEvent(TENANT, { schema: 'test.event', ...claims }, claims, NOW);
            expect(result.inserted).toBe(true);
          }));
        }
      }

      const invalid = event(0, 'node-0', EVENTS_PER_TASK + 2);
      await expect(store.putEvent(TENANT, { schema: 'test.event', ...invalid }, invalid, NOW))
        .rejects.toMatchObject({ code: 'sequence_gap' });

      const persistedEventCount = (await Promise.all(
        Array.from({ length: TASK_COUNT }, (_, index) => store.listEvents(TENANT, `work-${index}`)),
      )).reduce((sum, events) => sum + events.length, 0);
      const result: PerfResult = {
        store: storeName,
        nodeCount: NODE_COUNT,
        taskCount: TASK_COUNT,
        eventCount: EVENT_COUNT,
        persistedEventCount,
        heartbeatP95Ms: p95(heartbeatSamples),
        dispatchP95Ms: p95(dispatchSamples),
        eventWriteP95Ms: p95(eventSamples),
        rejectedOverLimit: true,
      };

      expect(persistedEventCount).toBe(EVENT_COUNT);
      expect(result.heartbeatP95Ms).toBeLessThan(2_000);
      expect(result.dispatchP95Ms).toBeLessThan(5_000);
      expect(result.eventWriteP95Ms).toBeLessThan(50);
      process.stdout.write(`HUMMER_PERF_RESULT ${JSON.stringify(result)}\n`);
    } finally {
      store.close();
    }
  }, 120_000);
});

function task(index: number, nodeId: string): TaskClaims {
  return {
    taskId: `task-${index}`,
    workOrderId: `work-${index}`,
    tenantId: TENANT,
    targetNodeId: nodeId,
    targetRuntime: 'codex',
    idempotencyKey: `task-delivery-${index}`,
    leaseMs: 3_600_000,
    expiresAt: EXPIRES,
    originRef: `origin-${index}`,
  };
}

function event(taskIndex: number, nodeId: string, seq: number): RunEventClaims {
  return {
    eventId: `event-${taskIndex}-${seq}`,
    tenantId: TENANT,
    workOrderId: `work-${taskIndex}`,
    nodeId,
    seq,
    occurredAt: NOW,
    type: 'progress',
    idempotencyKey: `event-delivery-${taskIndex}-${seq}`,
  };
}

async function timed(action: () => Promise<unknown>): Promise<number> {
  const startedAt = performance.now();
  await action();
  return performance.now() - startedAt;
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3));
}
