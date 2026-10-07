import { createHash } from 'node:crypto';
import { createSharedFleetValidators } from './contract-adapter.js';
import { FastifyFleetTransport } from './fastify-transport.js';
import { FleetService } from './fleet-service.js';
import { createConfiguredBadgeAuthenticator, loadRelayConfig, type RelayConfigV2 } from './relay-config.js';
import { SqliteFleetStore } from './sqlite-store.js';
import { loadTaskGrantSnapshot, SqliteTaskGrantAuthority } from './sqlite-task-grant-authority.js';

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

async function waitForShutdown(
  transport: FastifyFleetTransport,
  store: SqliteFleetStore,
  taskGrants: SqliteTaskGrantAuthority,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      process.off('SIGINT', close);
      process.off('SIGTERM', close);
      try {
        await transport.close();
        store.close();
        taskGrants.close();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
}

export async function runRelayCli(args: readonly string[]): Promise<void> {
  const parsed = parseArguments(args);
  const config = await loadRelayConfig(parsed.configPath);
  if (parsed.command === 'grant-import') {
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
  const authenticator = createConfiguredBadgeAuthenticator(config.badges);
  const store = new SqliteFleetStore(config.databasePath);
  const taskGrants = new SqliteTaskGrantAuthority(config.taskGrantDatabasePath);
  const transport = new FastifyFleetTransport({
    authenticator,
    taskGrantAuthenticator: taskGrants,
    host: config.host,
    port: config.port,
  });
  try {
    const service = new FleetService(store, createSharedFleetValidators());
    await transport.start(service);
    const address = transport.address;
    if (!address) throw new Error('relay did not publish a listening address');
    const shutdown = waitForShutdown(transport, store, taskGrants);
    process.stdout.write(`${JSON.stringify({
      schema: 'hummer.relay-ready',
      version: 1,
      address,
      databaseRef: pathRef(config.databasePath),
      taskGrantDatabaseRef: pathRef(config.taskGrantDatabasePath),
    })}\n`);
    await shutdown;
  } catch (error) {
    await transport.close().catch(() => undefined);
    store.close();
    taskGrants.close();
    throw error;
  }
}
