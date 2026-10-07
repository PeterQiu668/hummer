import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { DemoSessionUiaCaptureService } = await import('../apps/desktop/dist/demo-session-uia-capture.js');
const { openPersistence } = await import('../apps/desktop/dist/persistence/index.js');
const { WindowsUiaCaptureAdapter } = await import('../apps/desktop/dist/windows-uia-capture.js');

if (process.platform !== 'win32') {
  process.stdout.write(`${JSON.stringify({ schema: 'hummer.windows-uia-e2e', version: 1, status: 'failed', reason: 'Windows is required' })}\n`);
  process.exit(1);
}

const directories = [];
const children = [];
let assertions = 0;
let negativeCases = 0;

try {
  const title = `HUMMER UIA Fixture ${Date.now()}`;
  const fixture = await startFixture(title);
  assert(fixture.snapshot.nodes.every((node) => !Object.hasOwn(node, 'name')), 'real adapter must not read accessibility names that may mirror typed text');

  const positive = setupPersistence(title, 'powershell');
  const positiveService = new DemoSessionUiaCaptureService(positive.persistence, new WindowsUiaCaptureAdapter());
  const captured = await positiveService.capture({
    tenantId: positive.tenantId, sessionId: positive.sessionId,
    processId: fixture.processId, windowTitle: title,
  });
  assert(captured.accepted, 'real fixture snapshot must be accepted');
  assert(captured.app === 'powershell' && captured.window === title, 'OS result must bind PID application and exact title');
  assert(captured.capturedRecords >= 3, 'real fixture must expose at least three accessibility nodes');
  const acceptedCount = positive.persistence.demoSessions.captureRecordCount(positive.tenantId, positive.sessionId);
  assert(acceptedCount === captured.capturedRecords, 'every accepted UIAutomation node must persist through DemoSessionStore');

  const wrongWindow = setupPersistence(title, 'powershell', [title, `${title} wrong`]);
  await expectRejected(
    () => new DemoSessionUiaCaptureService(wrongWindow.persistence).capture({
      tenantId: wrongWindow.tenantId, sessionId: wrongWindow.sessionId,
      processId: fixture.processId, windowTitle: `${title} wrong`,
    }),
    'wrong exact OS window',
  );
  assert(wrongWindow.persistence.demoSessions.captureRecordCount(wrongWindow.tenantId, wrongWindow.sessionId) === 0, 'wrong window must write zero records');

  const outsideApp = setupPersistence(title, 'NotPowerShell');
  await expectRejected(
    () => new DemoSessionUiaCaptureService(outsideApp.persistence).capture({
      tenantId: outsideApp.tenantId, sessionId: outsideApp.sessionId,
      processId: fixture.processId, windowTitle: title,
    }),
    'application outside DemoSession boundary',
  );
  assert(outsideApp.persistence.demoSessions.captureRecordCount(outsideApp.tenantId, outsideApp.sessionId) === 0, 'outside application must write zero records');

  const paused = setupPersistence(title, 'powershell');
  paused.persistence.demoSessions.pause(paused.tenantId, paused.sessionId, paused.actorRef);
  const pausedResult = await new DemoSessionUiaCaptureService(paused.persistence).capture({
    tenantId: paused.tenantId, sessionId: paused.sessionId,
    processId: fixture.processId, windowTitle: title,
  });
  assert(!pausedResult.accepted && pausedResult.reason === 'paused', 'paused capture must fail closed');
  assert(paused.persistence.demoSessions.captureRecordCount(paused.tenantId, paused.sessionId) === 0, 'paused capture must write zero records');
  negativeCases += 1;

  await stopFixture(fixture.child);
  children.splice(children.indexOf(fixture.child), 1);
  await expectRejected(
    () => positiveService.capture({
      tenantId: positive.tenantId, sessionId: positive.sessionId,
      processId: fixture.processId, windowTitle: title,
    }),
    'window disappeared',
  );
  assert(positive.persistence.demoSessions.captureRecordCount(positive.tenantId, positive.sessionId) === acceptedCount, 'disappeared window must write zero additional records');

  [positive, wrongWindow, outsideApp, paused].forEach((state) => state.persistence.close());
  process.stdout.write(`${JSON.stringify({
    schema: 'hummer.windows-uia-e2e', version: 1, status: 'passed',
    assertions, negativeCases,
    fixture: { kind: 'self-built-winforms', processId: fixture.processId, exactWindowTitle: title },
    capture: { app: captured.app, nodeCount: captured.capturedRecords, localOnly: true },
    exclusions: ['screenshots', 'video', 'raw keyboard text', 'upload', 'customer data'],
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schema: 'hummer.windows-uia-e2e', version: 1, status: 'failed', assertions, negativeCases,
    reason: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exitCode = 1;
} finally {
  await Promise.all(children.map(stopFixture));
  directories.forEach((directory) => rmSync(directory, { recursive: true, force: true }));
}

function setupPersistence(title, app, windows = [title]) {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-uia-real-'));
  directories.push(directory);
  const persistence = openPersistence({ dataDirectory: directory });
  const owner = persistence.identity.createCompany({
    companyName: 'Real UIA fixture tenant', displayName: 'Real UIA fixture owner',
    email: `uia-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
  });
  const tenantId = owner.tenant.id;
  const actorRef = `human:${owner.membership.humanUserId}`;
  const sessionId = `demo_uia_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  persistence.demoSessions.start({
    tenantId, sessionId, expertActorRef: actorRef, nodeId: 'node_local_windows_uia', captureMode: 'events-only',
    sourceBoundary: { apps: [app], windows, excluded: ['Password', 'Credential'] },
  });
  return { persistence, tenantId, actorRef, sessionId };
}

async function startFixture(title) {
  const script = resolve(root, 'tests/fixtures/windows-uia/HummerUiaFixture.ps1');
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, [
    '-STA', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Title', title,
  ], { windowsHide: true, stdio: 'ignore' });
  children.push(child);
  if (!child.pid) throw new Error('WinForms fixture did not receive a process id');
  const adapter = new WindowsUiaCaptureAdapter();
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`WinForms fixture exited before ready (${child.exitCode})`);
    try {
      const snapshot = await adapter.capture({
        processId: child.pid, windowTitle: title,
        sourceBoundary: { apps: ['powershell'], windows: [title], excluded: [] },
      });
      return { child, processId: child.pid, snapshot };
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
  }
  throw new Error(`WinForms fixture did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function stopFixture(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolveStop) => {
    const timeout = setTimeout(resolveStop, 3_000);
    child.once('exit', () => { clearTimeout(timeout); resolveStop(); });
    child.kill();
  });
}

async function expectRejected(action, label) {
  try {
    await action();
  } catch {
    negativeCases += 1;
    return;
  }
  throw new Error(`${label} was unexpectedly accepted`);
}

function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}
