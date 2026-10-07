import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createNodeAgentDaemonFromFile } from '../apps/node-agent/src/daemon.mjs';

const CONFIG_SCHEMA = 'hummer.local-stack-config';
const CONFIG_VERSION = 1;
const STATE_SCHEMA = 'hummer.local-stack-state';
const STATE_VERSION = 1;
const CONTROL_ENV = 'HUMMER_LOCAL_CONTROL_BADGE';
const NODE_ENV = 'HUMMER_LOCAL_NODE_BADGE';
const ISSUER_ENV = 'HUMMER_LOCAL_TASK_GRANT_ISSUER';
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ACCOUNT_ACTOR = /^account:[A-Za-z0-9_-]+$/u;

const [command, ...arguments_] = process.argv.slice(2);

try {
  const configPath = parseArguments(command, arguments_);
  const config = await loadConfig(configPath);
  if (command === 'run') await run(config, configPath);
  else if (command === 'status') await requestStatus(config);
  else if (command === 'stop') await requestStop(config);
} catch (error) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code) : 'local_stack_failed';
  const message = error instanceof Error ? error.message : 'Local stack failed';
  process.stderr.write(`${JSON.stringify({ schema: 'hummer.local-stack-error', version: 1, error: { code, message } })}\n`);
  process.exitCode = 1;
}

function parseArguments(commandName, values) {
  if (!['run', 'status', 'stop'].includes(commandName)
    || values.length !== 2 || values[0] !== '--config' || !values[1]) {
    throw failure('invalid_arguments', 'usage: hummer-local-stack <run|status|stop> --config <absolute-json>');
  }
  if (!isAbsolute(values[1])) throw failure('invalid_config_path', '--config must be an absolute path');
  return resolve(values[1]);
}

async function loadConfig(path) {
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch {
    throw failure('invalid_local_stack_config', 'local stack config could not be read as JSON');
  }
  exactRecord(value, [
    'schema', 'version', 'stateRoot', 'workspaceRoot', 'tenantId', 'actorRef', 'nodeId',
    'runtime', 'launchDesktop',
  ], 'local stack config');
  if (value.schema !== CONFIG_SCHEMA || value.version !== CONFIG_VERSION) {
    throw failure('invalid_local_stack_config', `config must use ${CONFIG_SCHEMA} version ${CONFIG_VERSION}`);
  }
  const stateRoot = absolutePath(value.stateRoot, 'stateRoot');
  const workspaceRoot = absolutePath(value.workspaceRoot, 'workspaceRoot');
  if (normalize(stateRoot) === normalize(workspaceRoot)) {
    throw failure('invalid_local_stack_config', 'stateRoot and workspaceRoot must be separate');
  }
  const tenantId = identifier(value.tenantId, 'tenantId');
  if (typeof value.actorRef !== 'string' || !ACCOUNT_ACTOR.test(value.actorRef)) {
    throw failure('invalid_local_stack_config', 'actorRef must be an account actor from the existing Desktop identity');
  }
  const actorRef = value.actorRef;
  const nodeId = identifier(value.nodeId, 'nodeId');
  const runtime = exactRecord(value.runtime, ['provider', 'executable'], 'runtime');
  if (!['codex', 'claude', 'deepseek', 'cli-other'].includes(runtime.provider)) {
    throw failure('invalid_local_stack_config', 'runtime.provider is unsupported');
  }
  if (runtime.executable !== undefined && (typeof runtime.executable !== 'string' || !runtime.executable.trim())) {
    throw failure('invalid_local_stack_config', 'runtime.executable must be a non-empty string');
  }
  if (runtime.provider === 'cli-other' && typeof runtime.executable !== 'string') {
    throw failure('invalid_local_stack_config', 'runtime.executable is required for cli-other');
  }
  if (runtime.provider !== 'cli-other' && runtime.executable !== undefined) {
    throw failure('invalid_local_stack_config', 'runtime.executable is allowed only for cli-other');
  }
  if (typeof value.launchDesktop !== 'boolean') {
    throw failure('invalid_local_stack_config', 'launchDesktop must be a boolean');
  }
  return {
    schema: CONFIG_SCHEMA, version: CONFIG_VERSION, stateRoot, workspaceRoot,
    tenantId, actorRef, nodeId,
    runtime: { provider: runtime.provider, ...(runtime.executable ? { executable: runtime.executable } : {}) },
    launchDesktop: value.launchDesktop,
  };
}

async function run(config, configPath) {
  const repository = resolve(import.meta.dirname, '..');
  const activeRoot = join(config.stateRoot, 'active');
  const historyRoot = join(config.stateRoot, 'runs');
  await prepareOwnedRoot(config.stateRoot);
  await mkdir(config.workspaceRoot, { recursive: true });
  await mkdir(historyRoot, { recursive: true });
  await archiveStaleActive(activeRoot, historyRoot);
  try {
    await mkdir(activeRoot);
  } catch (error) {
    if (error?.code === 'EEXIST') throw failure('local_stack_already_running', 'an active local stack already owns this state root');
    throw error;
  }

  const sessionId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${randomUUID().slice(0, 8)}`;
  const pipeName = process.platform === 'win32'
    ? `\\\\.\\pipe\\hummer-local-${createHash('sha256').update(`${config.stateRoot}:${sessionId}`).digest('hex').slice(0, 24)}`
    : join(config.stateRoot, `control-${sessionId}.sock`);
  const relayConfigPath = join(activeRoot, 'relay.json');
  const nodeConfigPath = join(activeRoot, 'node.json');
  const statePath = join(activeRoot, 'status.json');
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const controlToken = opaque('control');
  const nodeToken = opaque('node');
  const issuerSecret = opaque('issuer');
  const relayConfig = {
    schema: 'hummer.relay-config', version: 3, host: '127.0.0.1', port: 0,
    databasePath: join(config.stateRoot, 'fleet.sqlite'),
    taskGrantDatabasePath: join(config.stateRoot, 'task-grants.sqlite'),
    taskGrantIssuerSecretEnv: ISSUER_ENV,
    badges: [
      {
        tokenEnv: CONTROL_ENV, tokenId: `control-${sessionId}`, tenantId: config.tenantId,
        actorRef: config.actorRef,
        scopes: ['node.read', 'task.read', 'task.enqueue', 'task.stop', 'approval.read', 'approval.decide'],
        expiresAt,
      },
      {
        tokenEnv: NODE_ENV, tokenId: `node-${sessionId}`, tenantId: config.tenantId,
        actorRef: `system:${config.nodeId}`, nodeId: config.nodeId,
        scopes: ['node.register', 'node.heartbeat', 'task.claim', 'task.event', 'stream.connect', 'approval.request', 'approval.consume'],
        expiresAt,
      },
    ],
  };
  await writeJsonExclusive(relayConfigPath, relayConfig);

  let relay;
  let node;
  let desktop;
  let controlServer;
  let closing;
  let currentState = baseState('starting');
  await publishState(currentState);

  const shutdown = async (reason, finalStatus = 'stopped') => {
    if (closing) return closing;
    closing = (async () => {
      if (desktop && desktop.exitCode === null && desktop.signalCode === null) {
        desktop.stdin.end();
        await waitForExit(desktop, 10_000);
      }
      await node?.close(reason).catch(() => undefined);
      await relay?.close().catch(() => undefined);
      if (controlServer) await closeServer(controlServer);
      currentState = { ...currentState, status: finalStatus, stoppedAt: new Date().toISOString(), stopReason: reason };
      await publishState(currentState);
      const archived = join(historyRoot, `${sessionId}-${finalStatus}`);
      await rename(activeRoot, archived);
      process.stdout.write(`${JSON.stringify({ schema: STATE_SCHEMA, version: STATE_VERSION, status: finalStatus, sessionId, reason })}\n`);
    })();
    return closing;
  };

  function baseState(status) {
    return {
      schema: STATE_SCHEMA, version: STATE_VERSION, status, sessionId,
      supervisorPid: process.pid, pipeName, tenantId: config.tenantId,
      actorRef: config.actorRef, nodeId: config.nodeId, configRef: digest(configPath),
      stateRootRef: digest(config.stateRoot), workspaceRootRef: digest(config.workspaceRoot),
      startedAt: new Date().toISOString(), launchDesktop: config.launchDesktop,
    };
  }

  async function publishState(value) {
    await writeFile(statePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' });
  }

  try {
    process.env[CONTROL_ENV] = controlToken;
    process.env[NODE_ENV] = nodeToken;
    process.env[ISSUER_ENV] = issuerSecret;
    const relayModulePath = join(repository, 'apps', 'relay', 'dist', 'apps', 'relay', 'src', 'cli.js');
    if (!existsSync(relayModulePath)) {
      throw failure('relay_not_built', 'Relay CLI output is missing; run npm run build:cli -w @hummer/relay');
    }
    const { startRelayDaemon } = await import(pathToFileURL(relayModulePath).href);
    relay = await startRelayDaemon(relayConfigPath);

    const nodeConfig = {
      schema: 'hummer.node-agent-config', version: 4,
      nodeId: config.nodeId, tenantId: config.tenantId, relayBaseUrl: `${relay.address}/`,
      badgeTokenEnv: NODE_ENV, grantExpiresAt: expiresAt,
      grantScopes: ['node.heartbeat', 'task.claim', 'approval.request', 'task.execute'],
      journalPath: join(config.stateRoot, 'node-execution.jsonl'),
      receiptRoot: join(config.stateRoot, 'receipts'), workspaceRoot: config.workspaceRoot,
      heartbeatIntervalMs: 15_000, pollIntervalMs: 500, approvalTtlMs: 300_000,
      runtime: config.runtime, capabilities: ['fs.read'],
      mcp: { endpoint: 'stdio://hummer-local', tools: ['fs_read'] },
      approval: { riskClass: 'unknown' },
    };
    await writeJsonExclusive(nodeConfigPath, nodeConfig);
    process.env[NODE_ENV] = nodeToken;
    node = await createNodeAgentDaemonFromFile({
      configPath: nodeConfigPath,
      logger: (entry) => process.stdout.write(`${JSON.stringify({ source: 'node', ...entry })}\n`),
    });
    await node.start();

    controlServer = createControlServer(() => currentState, shutdown);
    await listen(controlServer, pipeName);

    if (config.launchDesktop) {
      const electronPath = (await import('electron')).default;
      const desktopMain = join(repository, 'apps', 'desktop', 'dist', 'main.js');
      if (!existsSync(desktopMain)) {
        throw failure('desktop_not_built', 'Desktop output is missing; run npm run desktop:build');
      }
      desktop = spawn(electronPath, [desktopMain], {
        cwd: repository,
        windowsHide: false,
        stdio: ['pipe', 'inherit', 'inherit'],
        env: {
          ...process.env,
          HUMMER_RELAY_BASE_URL: `${relay.address}/`,
          HUMMER_RELAY_BADGE_TOKEN: controlToken,
          HUMMER_RELAY_TENANT_ID: config.tenantId,
          HUMMER_RELAY_ACTOR_REF: config.actorRef,
          HUMMER_EXEC_WORKSPACE_ROOT: config.workspaceRoot,
          HUMMER_CODEX_CWD: config.workspaceRoot,
          HUMMER_EXIT_ON_STDIN_END: '1',
        },
      });
      desktop.once('exit', () => { if (!closing) void shutdown('desktop_exit'); });
    }

    currentState = {
      ...currentState, status: 'running', relayAddress: relay.address,
      relayDatabaseRef: relay.databaseRef, taskGrantDatabaseRef: relay.taskGrantDatabaseRef,
      ...(desktop?.pid ? { desktopPid: desktop.pid } : {}),
    };
    await publishState(currentState);
    process.stdout.write(`${JSON.stringify(currentState)}\n`);
    process.once('SIGINT', () => { void shutdown('SIGINT'); });
    process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
    await new Promise((resolveRun) => {
      const interval = setInterval(() => { if (closing) { clearInterval(interval); void closing.then(resolveRun); } }, 50);
    });
  } catch (error) {
    await shutdown('startup_failed', 'failed').catch(() => undefined);
    throw error;
  } finally {
    Reflect.deleteProperty(process.env, CONTROL_ENV);
    Reflect.deleteProperty(process.env, NODE_ENV);
    Reflect.deleteProperty(process.env, ISSUER_ENV);
  }
}

function createControlServer(getState, shutdown) {
  return createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 4096) return socket.destroy();
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      let input;
      try { input = JSON.parse(buffer.slice(0, newline)); } catch { return socket.end(`${JSON.stringify({ error: 'invalid_request' })}\n`); }
      if (input?.command === 'status') return socket.end(`${JSON.stringify(getState())}\n`);
      if (input?.command === 'stop') {
        socket.end(`${JSON.stringify({ accepted: true, sessionId: getState().sessionId })}\n`);
        setImmediate(() => { void shutdown('control_stop'); });
        return;
      }
      socket.end(`${JSON.stringify({ error: 'unsupported_command' })}\n`);
    });
  });
}

async function requestStatus(config) {
  const state = await readActiveState(config.stateRoot);
  if (!state) {
    process.stdout.write(`${JSON.stringify({ schema: STATE_SCHEMA, version: STATE_VERSION, status: 'stopped' })}\n`);
    return;
  }
  const response = await pipeRequest(state.pipeName, { command: 'status' });
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function requestStop(config) {
  const activeRoot = join(config.stateRoot, 'active');
  const state = await readActiveState(config.stateRoot);
  if (!state) {
    process.stdout.write(`${JSON.stringify({ schema: STATE_SCHEMA, version: STATE_VERSION, status: 'stopped', changed: false })}\n`);
    return;
  }
  await pipeRequest(state.pipeName, { command: 'stop' });
  const deadline = Date.now() + 15_000;
  while (existsSync(activeRoot) && Date.now() < deadline) await delay(50);
  if (existsSync(activeRoot)) throw failure('stop_timeout', 'local stack did not stop within 15 seconds');
  process.stdout.write(`${JSON.stringify({ schema: STATE_SCHEMA, version: STATE_VERSION, status: 'stopped', changed: true, sessionId: state.sessionId })}\n`);
}

async function readActiveState(stateRoot) {
  const path = join(stateRoot, 'active', 'status.json');
  if (!existsSync(path)) return null;
  const state = JSON.parse(await readFile(path, 'utf8'));
  if (state?.schema !== STATE_SCHEMA || state?.version !== STATE_VERSION || typeof state.pipeName !== 'string') {
    throw failure('invalid_local_stack_state', 'active local stack state is invalid');
  }
  return state;
}

async function pipeRequest(pipeName, request) {
  return new Promise((resolveRequest, reject) => {
    const socket = connect(pipeName);
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(failure('local_stack_unresponsive', 'local stack control pipe timed out')); }, 5000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      try { resolveRequest(JSON.parse(buffer.slice(0, newline))); }
      catch { reject(failure('invalid_local_stack_response', 'local stack returned invalid JSON')); }
    });
    socket.once('error', () => { clearTimeout(timer); reject(failure('local_stack_unresponsive', 'local stack control pipe is unavailable')); });
  });
}

async function prepareOwnedRoot(stateRoot) {
  await mkdir(stateRoot, { recursive: true });
  const marker = join(stateRoot, '.hummer-local-stack-root.json');
  if (existsSync(marker)) {
    const value = JSON.parse(await readFile(marker, 'utf8'));
    if (value?.schema !== 'hummer.local-stack-root' || value?.version !== 1) {
      throw failure('state_root_not_owned', 'stateRoot marker is invalid');
    }
    return;
  }
  const entries = await readdir(stateRoot);
  if (entries.length > 0) throw failure('state_root_not_owned', 'stateRoot must be empty before HUMMER claims it');
  await writeJsonExclusive(marker, { schema: 'hummer.local-stack-root', version: 1, createdAt: new Date().toISOString() });
}

async function archiveStaleActive(activeRoot, historyRoot) {
  if (!existsSync(activeRoot)) return;
  const statePath = join(activeRoot, 'status.json');
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch {
    throw failure('invalid_local_stack_state', 'existing active state cannot be verified');
  }
  try {
    await pipeRequest(state.pipeName, { command: 'status' });
    throw failure('local_stack_already_running', 'an active local stack already owns this state root');
  } catch (error) {
    if (error?.code === 'local_stack_already_running') throw error;
    const session = typeof state.sessionId === 'string' ? state.sessionId : randomUUID();
    await rename(activeRoot, join(historyRoot, `${session}-stale`));
  }
}

async function writeJsonExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function exactRecord(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('invalid_local_stack_config', `${label} must be an object`);
  const unknown = Object.keys(value).find((key) => !fields.includes(key));
  if (unknown) throw failure('invalid_local_stack_config', `${label} contains unknown field ${unknown}`);
  return value;
}

function absolutePath(value, field) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw failure('invalid_local_stack_config', `${field} must be an absolute path`);
  return resolve(value);
}

function identifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw failure('invalid_local_stack_config', `${field} is invalid`);
  return value;
}

function normalize(path) {
  const value = resolve(path).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function opaque(prefix) { return `${prefix}_${randomBytes(32).toString('base64url')}`; }
function digest(value) { return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`; }

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function listen(server, pipeName) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(pipeName, () => { server.off('error', reject); resolveListen(); });
  });
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(timeoutMs).then(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); }),
  ]);
}
