import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const DEFAULT_IMAGE = 'hummer-office-sandbox:m5g';
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 256;
const EXECUTION_UNAVAILABLE = '执行能力不可用：本机网络隔离未生效';

export interface WorkspaceExecFileInput {
  path: string;
  content: string;
}

export interface WorkspaceExecRequest {
  orderId: string;
  argv: string[];
  files: WorkspaceExecFileInput[];
  timeoutMs?: number;
}

export interface WorkspaceExecArtifact {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface WorkspaceExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  artifacts: WorkspaceExecArtifact[];
  evidenceRefs: string[];
}

export interface WorkspaceExecHealth {
  available: boolean;
  checkedAt: string;
  runtime: 'podman' | 'docker' | 'unavailable';
  passed: number;
  total: 5;
  issue: string | null;
  diagnostic?: string;
  probes: IsolationProbe[];
}

interface IsolationProbe {
  name: 'inside-write' | 'path-escape' | 'network-egress' | 'dns-resolution' | 'raw-socket';
  succeeded: boolean;
  error?: string;
}

export interface ContainerRunRequest {
  purpose: 'self-check' | 'execution';
  workspaceDirectory: string;
  argv: string[];
  timeoutMs: number;
}

export interface ContainerRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type ContainerRunner = (request: ContainerRunRequest) => Promise<ContainerRunResult>;

export class WorkspaceExecService {
  private readonly runContainer: ContainerRunner;
  private status: WorkspaceExecHealth | null = null;

  constructor(private readonly options: {
    workspaceRoot: string;
    runContainer?: ContainerRunner;
    runtime?: 'podman' | 'docker' | 'unavailable';
    image?: string;
    now?: () => Date;
  }) {
    mkdirSync(options.workspaceRoot, { recursive: true });
    this.runContainer = options.runContainer ?? createContainerRunner({
      runtime: options.runtime ?? detectContainerRuntime(),
      image: options.image ?? process.env.HUMMER_SANDBOX_IMAGE ?? DEFAULT_IMAGE,
    });
  }

  currentHealth(): WorkspaceExecHealth | null {
    return this.status ? { ...this.status, probes: this.status.probes.map((probe) => ({ ...probe })) } : null;
  }

  workspaceDirectory(orderId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(orderId)) throw new Error('Invalid workspace order id');
    const directory = resolve(this.options.workspaceRoot, orderId);
    assertInside(this.options.workspaceRoot, directory);
    return directory;
  }

  async selfCheck(): Promise<WorkspaceExecHealth> {
    const directory = resolve(this.options.workspaceRoot, `.self-check-${randomUUID()}`);
    mkdirSync(directory, { recursive: false });
    writeFileSync(resolve(directory, 'probe.py'), SELF_CHECK_SCRIPT, 'utf8');
    let probes: IsolationProbe[] = [];
    let runtime: WorkspaceExecHealth['runtime'] = this.options.runtime ?? detectContainerRuntime();
    let issue: string | null = null;
    let diagnostic: string | undefined;
    try {
      if (runtime === 'unavailable' && !this.options.runContainer) throw new Error('Podman/Docker runtime is unavailable');
      const result = await this.runContainer({
        purpose: 'self-check',
        workspaceDirectory: directory,
        argv: ['python', '/workspace/probe.py'],
        timeoutMs: 90_000,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || `Self-check exited with ${result.exitCode}`);
      probes = parseProbeOutput(result.stdout);
      const passed = countPassingProbes(probes);
      if (passed !== 5) issue = EXECUTION_UNAVAILABLE;
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
      issue = error instanceof Error && /runtime is unavailable/i.test(error.message)
        ? '执行能力不可用：未找到 Podman 或 Docker 容器运行时'
        : EXECUTION_UNAVAILABLE;
      if (runtime === 'unavailable') probes = [];
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    const passed = countPassingProbes(probes);
    this.status = {
      available: passed === 5,
      checkedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      runtime,
      passed,
      total: 5,
      issue,
      ...(diagnostic ? { diagnostic } : {}),
      probes,
    };
    return this.currentHealth()!;
  }

  async execute(request: WorkspaceExecRequest): Promise<WorkspaceExecResult> {
    if (!this.status?.available) throw new Error(this.status?.issue ?? EXECUTION_UNAVAILABLE);
    validateRequest(request);
    const workspaceDirectory = this.workspaceDirectory(request.orderId);
    mkdirSync(workspaceDirectory, { recursive: true });
    stageFiles(workspaceDirectory, request.files);
    const result = await this.runContainer({
      purpose: 'execution',
      workspaceDirectory,
      argv: request.argv,
      timeoutMs: boundedTimeout(request.timeoutMs),
    });
    const artifacts = collectArtifacts(workspaceDirectory);
    return {
      ...result,
      artifacts,
      evidenceRefs: artifacts.map((artifact) => `evidence://sha256/${artifact.sha256}`),
    };
  }
}

export function detectContainerRuntime(): 'podman' | 'docker' | 'unavailable' {
  for (const runtime of ['podman', 'docker'] as const) {
    const result = spawnSync(runtime, ['version'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    if (!result.error && result.status === 0) return runtime;
  }
  return 'unavailable';
}

function createContainerRunner(input: { runtime: 'podman' | 'docker' | 'unavailable'; image: string }): ContainerRunner {
  return async (request) => {
    if (input.runtime === 'unavailable') throw new Error('Podman/Docker runtime is unavailable');
    const volume = `hummer-order-${randomUUID()}`;
    const mount = `type=volume,source=${volume},target=/workspace`;
    await spawnContainer(input.runtime, ['volume', 'create', volume], 30_000);
    try {
      const snapshot = snapshotDirectory(request.workspaceDirectory);
      const staged = await spawnContainer(input.runtime, [
        'run', '--rm', '-i', '--network=none', '--read-only', '--user', '0', '--mount', mount,
        input.image, 'python', '-c', STAGE_SNAPSHOT_SCRIPT,
      ], 60_000, JSON.stringify(snapshot));
      if (staged.exitCode !== 0) throw new Error(staged.stderr || 'Unable to stage the order workspace');
      const executed = await spawnContainer(input.runtime, [
        'run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
        '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=1024m', '--cpus=1',
        '--mount', mount, input.image, ...request.argv,
      ], request.timeoutMs);
      const exported = await spawnContainer(input.runtime, [
        'run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
        '--security-opt=no-new-privileges', '--mount', mount,
        input.image, 'python', '-c', EXPORT_SNAPSHOT_SCRIPT,
      ], 60_000, undefined, 150 * 1024 * 1024);
      if (exported.exitCode !== 0) throw new Error(exported.stderr || 'Unable to export the order workspace');
      restoreSnapshot(request.workspaceDirectory, JSON.parse(exported.stdout) as SnapshotFile[]);
      return executed;
    } finally {
      await spawnContainer(input.runtime, ['volume', 'rm', '--force', volume], 30_000).catch(() => undefined);
    }
  };
}

function spawnContainer(
  executable: string,
  args: string[],
  timeoutMs: number,
  stdin?: string,
  maxOutputBytes = 1_000_000,
): Promise<ContainerRunResult> {
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!child.killed) child.kill();
      reject(error);
    };
    const timeout = setTimeout(() => {
      fail(new Error(`Container execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      try { stdout = appendBounded(stdout, chunk, maxOutputBytes); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      try { stderr = appendBounded(stderr, chunk, maxOutputBytes); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    child.on('error', (error) => { fail(error); });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise({ exitCode: code ?? -1, stdout, stderr, durationMs: Date.now() - startedAt });
    });
    child.stdin.end(stdin);
  });
}

interface SnapshotFile { path: string; contentBase64: string }

function snapshotDirectory(directory: string): SnapshotFile[] {
  const files: SnapshotFile[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = resolve(current, entry.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`Workspace contains a forbidden symbolic link: ${entry.name}`);
      if (stat.isDirectory()) visit(absolutePath);
      else if (stat.isFile()) files.push({
        path: relative(directory, absolutePath).replaceAll('\\', '/'),
        contentBase64: readFileSync(absolutePath).toString('base64'),
      });
    }
  };
  visit(directory);
  return files;
}

function restoreSnapshot(directory: string, snapshot: SnapshotFile[]): void {
  if (!Array.isArray(snapshot)) throw new Error('Container returned an invalid workspace snapshot');
  if (snapshot.length > MAX_ARTIFACT_FILES) throw new Error('workspace.exec produced too many artifacts');
  let total = 0;
  for (const file of snapshot) {
    if (typeof file.path !== 'string' || typeof file.contentBase64 !== 'string') throw new Error('Container returned an invalid workspace file');
    const absolutePath = resolve(directory, file.path);
    assertInside(directory, absolutePath);
    assertNoSymlinkPath(directory, absolutePath);
    const bytes = Buffer.from(file.contentBase64, 'base64');
    total += bytes.length;
    if (total > MAX_ARTIFACT_BYTES) throw new Error('workspace.exec artifacts exceed the size limit');
    mkdirSync(resolve(absolutePath, '..'), { recursive: true });
    writeFileSync(absolutePath, bytes);
  }
}

function validateRequest(request: WorkspaceExecRequest): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request.orderId)) throw new Error('Invalid workspace order id');
  if (!Array.isArray(request.argv) || request.argv.length === 0 || request.argv.length > 128) throw new Error('workspace.exec requires argv');
  if (request.argv.some((value) => typeof value !== 'string' || !value || value.includes('\0'))) throw new Error('workspace.exec argv is invalid');
  if (!Array.isArray(request.files) || request.files.length > 64) throw new Error('workspace.exec files are invalid');
  const bytes = request.files.reduce((total, file) => total + Buffer.byteLength(file.content ?? '', 'utf8'), 0);
  if (bytes > MAX_INPUT_BYTES) throw new Error('workspace.exec staged input exceeds the size limit');
}

function stageFiles(workspaceDirectory: string, files: WorkspaceExecFileInput[]): void {
  for (const file of files) {
    if (typeof file.path !== 'string' || typeof file.content !== 'string') throw new Error('workspace.exec file is invalid');
    const absolutePath = resolve(workspaceDirectory, file.path);
    assertInside(workspaceDirectory, absolutePath);
    assertNoSymlinkPath(workspaceDirectory, absolutePath);
    mkdirSync(resolve(absolutePath, '..'), { recursive: true });
    writeFileSync(absolutePath, file.content, { encoding: 'utf8', flag: 'w' });
  }
}

function collectArtifacts(workspaceDirectory: string): WorkspaceExecArtifact[] {
  const artifacts: WorkspaceExecArtifact[] = [];
  let total = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`workspace.exec produced a forbidden symbolic link: ${entry.name}`);
      if (stat.isDirectory()) visit(absolutePath);
      else if (stat.isFile()) {
        if (artifacts.length >= MAX_ARTIFACT_FILES) throw new Error('workspace.exec produced too many artifacts');
        total += stat.size;
        if (total > MAX_ARTIFACT_BYTES) throw new Error('workspace.exec artifacts exceed the size limit');
        const bytes = readFileSync(absolutePath);
        artifacts.push({
          path: relative(workspaceDirectory, absolutePath).replaceAll('\\', '/'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sizeBytes: bytes.length,
        });
      }
    }
  };
  visit(workspaceDirectory);
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

function assertInside(root: string, target: string): void {
  const relativePath = relative(resolve(root), resolve(target));
  if (!relativePath || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) return;
  throw new Error('Path must stay inside the HUMMER workspace');
}

function assertNoSymlinkPath(root: string, target: string): void {
  let cursor = resolve(target, '..');
  const rootPath = resolve(root);
  while (cursor !== rootPath) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error('Symbolic links are not allowed in workspace.exec paths');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        cursor = resolve(cursor, '..');
        continue;
      }
      throw error;
    }
    cursor = resolve(cursor, '..');
  }
}

function parseProbeOutput(stdout: string): IsolationProbe[] {
  const line = stdout.trim().split(/\r?\n/).at(-1);
  if (!line) throw new Error('Isolation self-check returned no output');
  const value = JSON.parse(line) as { probes?: IsolationProbe[] };
  if (!Array.isArray(value.probes)) throw new Error('Isolation self-check returned invalid output');
  return value.probes;
}

function countPassingProbes(probes: IsolationProbe[]): number {
  const expectations = new Map<string, boolean>([
    ['inside-write', true], ['path-escape', false], ['network-egress', false],
    ['dns-resolution', false], ['raw-socket', false],
  ]);
  if (probes.length !== expectations.size || new Set(probes.map((probe) => probe.name)).size !== expectations.size) return 0;
  if (probes.some((probe) => !expectations.has(probe.name))) return 0;
  return probes.filter((probe) => expectations.get(probe.name) === probe.succeeded).length;
}

function boundedTimeout(value?: number): number {
  if (value === undefined) return 120_000;
  if (!Number.isFinite(value) || value < 1_000 || value > 300_000) throw new Error('workspace.exec timeout must be between 1000 and 300000ms');
  return value;
}

function appendBounded(current: string, chunk: Buffer, maxBytes: number): string {
  const next = `${current}${chunk.toString('utf8')}`;
  if (Buffer.byteLength(next, 'utf8') > maxBytes) throw new Error(`Container output exceeded ${maxBytes} bytes`);
  return next;
}

const STAGE_SNAPSHOT_SCRIPT = String.raw`import base64, json, os, sys
from pathlib import Path
root = Path('/workspace')
for item in json.load(sys.stdin):
    target = root / item['path']
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(base64.b64decode(item['contentBase64']))
for current, directories, files in os.walk(root):
    os.chown(current, 65532, 65532)
    for name in directories + files:
        os.chown(os.path.join(current, name), 65532, 65532)`;

const EXPORT_SNAPSHOT_SCRIPT = String.raw`import base64, json, os
from pathlib import Path
root = Path('/workspace')
result = []
for current, directories, files in os.walk(root, followlinks=False):
    for name in directories + files:
        path = Path(current) / name
        if path.is_symlink():
            raise RuntimeError('symbolic links are forbidden')
    for name in files:
        path = Path(current) / name
        result.append({'path': path.relative_to(root).as_posix(), 'contentBase64': base64.b64encode(path.read_bytes()).decode('ascii')})
print(json.dumps(result))`;

const SELF_CHECK_SCRIPT = String.raw`import json
from pathlib import Path
import socket
import urllib.request

def capture(name, operation):
    try:
        operation()
        return {"name": name, "succeeded": True}
    except Exception as error:
        return {"name": name, "succeeded": False, "error": str(error)}

def inside_write(): Path("inside.txt").write_text("M5G_SANDBOX_OK", encoding="utf-8")
def path_escape(): Path("../../escaped.md").write_text("ESCAPE_MUST_FAIL", encoding="utf-8")
def network_egress(): urllib.request.urlopen("https://example.com", timeout=5).read(1)
def dns_resolution(): socket.getaddrinfo("example.com", 443)
def raw_socket(): socket.create_connection(("1.1.1.1", 443), timeout=5).close()

print(json.dumps({"probes": [
    capture("inside-write", inside_write),
    capture("path-escape", path_escape),
    capture("network-egress", network_egress),
    capture("dns-resolution", dns_resolution),
    capture("raw-socket", raw_socket),
]}))`;
