import { createHash } from 'node:crypto';
import { createSharedFleetValidators } from './contract-adapter.js';
import { FastifyFleetTransport } from './fastify-transport.js';
import { FleetService } from './fleet-service.js';
import { createConfiguredBadgeAuthenticator, loadRelayConfig, type RelayConfigV1 } from './relay-config.js';
import { SqliteFleetStore } from './sqlite-store.js';

interface RelayCliArguments {
  command: 'start';
  configPath: string;
}

function parseArguments(args: readonly string[]): RelayCliArguments {
  if (args.length !== 3 || args[0] !== 'start' || args[1] !== '--config' || !args[2]) {
    throw new Error('usage: hummer-relay start --config <absolute-json>');
  }
  return { command: 'start', configPath: args[2] };
}

function databaseRef(config: RelayConfigV1): string {
  return `sha256:${createHash('sha256').update(config.databasePath, 'utf8').digest('hex')}`;
}

async function waitForShutdown(transport: FastifyFleetTransport, store: SqliteFleetStore): Promise<void> {
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
  const authenticator = createConfiguredBadgeAuthenticator(config.badges);
  const store = new SqliteFleetStore(config.databasePath);
  const transport = new FastifyFleetTransport({
    authenticator,
    host: config.host,
    port: config.port,
  });
  try {
    const service = new FleetService(store, createSharedFleetValidators());
    await transport.start(service);
    const address = transport.address;
    if (!address) throw new Error('relay did not publish a listening address');
    const shutdown = waitForShutdown(transport, store);
    process.stdout.write(`${JSON.stringify({
      schema: 'hummer.relay-ready',
      version: 1,
      address,
      databaseRef: databaseRef(config),
    })}\n`);
    await shutdown;
  } catch (error) {
    await transport.close().catch(() => undefined);
    store.close();
    throw error;
  }
}
