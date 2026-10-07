import { createHash } from 'node:crypto';
import { createSharedFleetValidators } from './contract-adapter.js';
import { FastifyFleetTransport } from './fastify-transport.js';
import { FleetService } from './fleet-service.js';
import {
  consumeTaskGrantIssuerSecret,
  createConfiguredBadgeAuthenticator,
  loadRelayConfig,
} from './relay-config.js';
import { SqliteFleetStore } from './sqlite-store.js';
import { loadTaskGrantSnapshot, SqliteTaskGrantAuthority } from './sqlite-task-grant-authority.js';
import { DeterministicTaskGrantIssuer } from './task-grant-issuer.js';

type RelayCliArguments =
  | { command: 'start'; configPath: string }
  | { command: 'grant-import'; configPath: string; snapshotPath: string };

function parseArguments(args: readonly string[]): RelayCliArguments {
  if (args.length === 3 && args[0] === 'start' && args[1] === '--config' && args[2]) {
    return { command: 'start', configPath: args[2] };
  }
  if (args.length === 5 && args[0] === 'grant-import' && args[1] === '--config' && args[2]
    && args[3] === '--snapshot' && args[4]) {
    return { command: 'grant-import', configPath: args[2], snapshotPath: args[4] };
  }
  throw new Error('usage: hummer-relay start --config <absolute-json> | grant-import --config <absolute-json> --snapshot <absolute-json>');
}

function pathRef(path: string): string {
  return `sha256:${createHash('sha256').update(path, 'utf8').digest('hex')}`;
}

async function waitForShutdown(closeDaemon: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      process.off('SIGINT', close);
      process.off('SIGTERM', close);
      try {
        await closeDaemon();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
}

export interface RunningRelayDaemon {
  readonly address: string;
  readonly databaseRef: string;
  readonly taskGrantDatabaseRef: string;
  close(): Promise<void>;
}

export async function startRelayDaemon(configPath: string): Promise<RunningRelayDaemon> {
  const config = await loadRelayConfig(configPath);
  const authenticator = createConfiguredBadgeAuthenticator(config.badges);
  const taskGrantIssuerSecret = consumeTaskGrantIssuerSecret(config);
  const store = new SqliteFleetStore(config.databasePath);
  const taskGrants = new SqliteTaskGrantAuthority(config.taskGrantDatabasePath);
  const taskGrantIssuer = new DeterministicTaskGrantIssuer(taskGrantIssuerSecret, taskGrants);
  const transport = new FastifyFleetTransport({
    authenticator,
    taskGrantAuthenticator: taskGrants,
    taskGrantIssuer,
    host: config.host,
    port: config.port,
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await transport.close();
    store.close();
    taskGrants.close();
  };
  try {
    const service = new FleetService(store, createSharedFleetValidators());
    await transport.start(service);
    const address = transport.address;
    if (!address) throw new Error('relay did not publish a listening address');
    return {
      address,
      databaseRef: pathRef(config.databasePath),
      taskGrantDatabaseRef: pathRef(config.taskGrantDatabasePath),
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

export async function runRelayCli(args: readonly string[]): Promise<void> {
  const parsed = parseArguments(args);
  if (parsed.command === 'grant-import') {
    const config = await loadRelayConfig(parsed.configPath);
    const taskGrants = new SqliteTaskGrantAuthority(config.taskGrantDatabasePath);
    try {
      const snapshot = await loadTaskGrantSnapshot(parsed.snapshotPath);
      const result = taskGrants.importSnapshot(snapshot);
      process.stdout.write(`${JSON.stringify({
        schema: 'hummer.task-grant-import-result',
        version: 1,
        tenantId: result.tenantId,
        inserted: result.inserted,
        unchanged: result.unchanged,
        taskGrantDatabaseRef: pathRef(config.taskGrantDatabasePath),
      })}\n`);
      return;
    } finally {
      taskGrants.close();
    }
  }
  const daemon = await startRelayDaemon(parsed.configPath);
  process.stdout.write(`${JSON.stringify({
    schema: 'hummer.relay-ready',
    version: 1,
    address: daemon.address,
    databaseRef: daemon.databaseRef,
    taskGrantDatabaseRef: daemon.taskGrantDatabaseRef,
  })}\n`);
  await waitForShutdown(daemon.close);
}
