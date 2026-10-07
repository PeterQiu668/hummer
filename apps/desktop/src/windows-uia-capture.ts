import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { DemoSourceBoundary } from './persistence/index.js';

const MAX_NODES = 128;
const MAX_TEXT = 512;
const PROBE_TIMEOUT_MS = 8_000;

export interface WindowsUiaCaptureRequest {
  processId: number;
  windowTitle: string;
  sourceBoundary: DemoSourceBoundary;
}

export interface WindowsUiaProbeRequest {
  processId: number;
  windowTitle: string;
}

export interface WindowsUiaNode {
  role: string;
  automationId?: string;
}

export interface WindowsUiaProbeResult {
  processId: number;
  app: string;
  window: string;
  nodes: WindowsUiaNode[];
}

export type WindowsUiaProbe = (request: WindowsUiaProbeRequest) => Promise<WindowsUiaProbeResult>;

export interface WindowsUiaCaptureAdapterOptions {
  platform?: NodeJS.Platform | string;
  probe?: WindowsUiaProbe;
}

/**
 * One-shot, local-only Windows UIAutomation metadata reader.
 *
 * It never requests a screenshot, video, input hook, keyboard text or network
 * access. The caller must supply a PID, exact top-level title and the already
 * authenticated DemoSession boundary for every capture.
 */
export class WindowsUiaCaptureAdapter {
  private readonly platform: string;
  private readonly probe: WindowsUiaProbe;

  constructor(options: WindowsUiaCaptureAdapterOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.probe = options.probe ?? createPowerShellUiaProbe();
  }

  async capture(request: WindowsUiaCaptureRequest): Promise<WindowsUiaProbeResult> {
    if (this.platform !== 'win32') throw new Error('Windows UIAutomation capture is available only on Windows');
    validateProcessId(request.processId);
    const title = exactText(request.windowTitle, 'Exact window title');
    validateBoundary(request.sourceBoundary);
    if (!request.sourceBoundary.windows.includes(title) || request.sourceBoundary.excluded.includes(title)) {
      throw new Error('Exact window title is outside the DemoSession source boundary');
    }

    const result = sanitizeProbeResult(await this.probe({ processId: request.processId, windowTitle: title }));
    if (result.processId !== request.processId) throw new Error('UIAutomation probe returned a different process');
    if (result.window !== title) throw new Error('UIAutomation probe returned a different window title');
    if (!sourceAllowed(request.sourceBoundary, result.app, result.window)) {
      throw new Error('UIAutomation source is outside the DemoSession source boundary');
    }
    if (result.nodes.length === 0) throw new Error('UIAutomation window exposed no accessibility metadata');
    return result;
  }
}

export function createPowerShellUiaProbe(options: { executable?: string; timeoutMs?: number } = {}): WindowsUiaProbe {
  const executable = options.executable ?? join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  );
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const encodedScript = Buffer.from(POWERSHELL_UIA_PROBE, 'utf16le').toString('base64');
  return (request) => new Promise((resolve, reject) => {
    const child = spawn(executable, [
      '-NoLogo', '-NoProfile', '-NonInteractive',
      '-EncodedCommand', encodedScript,
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...minimalPowerShellEnvironment(process.env),
        HUMMER_UIA_PROCESS_ID: String(request.processId),
        HUMMER_UIA_WINDOW_TITLE: request.windowTitle,
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('Windows UIAutomation probe timed out')));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) {
        child.kill();
        finish(() => reject(new Error('Windows UIAutomation probe exceeded its output limit')));
      } else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.reduce((total, item) => total + item.length, 0) < 64 * 1024) stderr.push(chunk);
    });
    child.once('error', (error) => finish(() => reject(new Error(`Windows UIAutomation probe could not start: ${error.message}`))));
    child.once('close', (code) => finish(() => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim().split(/\r?\n/).pop()?.slice(0, 300);
        reject(new Error(`Windows UIAutomation probe failed${detail ? `: ${detail}` : ''}`));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as WindowsUiaProbeResult);
      } catch {
        reject(new Error('Windows UIAutomation probe returned invalid JSON'));
      }
    }));
    child.stdin.end();
  });
}

function minimalPowerShellEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'ComSpec',
    'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
    'USERNAME', 'COMPUTERNAME', 'PSModulePath',
  ]) {
    if (source[key]) environment[key] = source[key];
  }
  return environment;
}

function validateProcessId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffff_ffff) {
    throw new TypeError('Windows UIAutomation capture requires an explicit positive processId');
  }
}

function validateBoundary(boundary: DemoSourceBoundary): void {
  if (!boundary || typeof boundary !== 'object') throw new TypeError('DemoSession source boundary is required');
  for (const [key, list] of Object.entries(boundary)) {
    if (!['apps', 'windows', 'excluded'].includes(key) || !Array.isArray(list)) {
      throw new TypeError('DemoSession source boundary is invalid');
    }
    for (const value of list) exactText(value, 'DemoSession source boundary entry');
  }
  if (!boundary.apps.length || !boundary.windows.length) throw new TypeError('DemoSession source boundary is incomplete');
}

function sourceAllowed(boundary: DemoSourceBoundary, app: string, window: string): boolean {
  if (boundary.excluded.includes(app) || boundary.excluded.includes(window) || boundary.excluded.includes(`${app}::${window}`)) return false;
  return boundary.apps.includes(app) && boundary.windows.includes(window);
}

function sanitizeProbeResult(value: WindowsUiaProbeResult): WindowsUiaProbeResult {
  if (!value || typeof value !== 'object') throw new TypeError('Windows UIAutomation probe result is invalid');
  validateProcessId(value.processId);
  const app = exactText(value.app, 'UIAutomation application');
  const window = exactText(value.window, 'UIAutomation window');
  if (!Array.isArray(value.nodes) || value.nodes.length > MAX_NODES) throw new TypeError('UIAutomation metadata node count is invalid');
  const nodes = value.nodes.map((node) => {
    if (!node || typeof node !== 'object') throw new TypeError('UIAutomation node is invalid');
    const extras = Object.keys(node).filter((key) => !['role', 'automationId'].includes(key));
    if (extras.length) throw new TypeError('UIAutomation node contains unsupported fields');
    return {
      role: exactText(node.role, 'UIAutomation role'),
      ...(node.automationId === undefined ? {} : { automationId: exactText(node.automationId, 'UIAutomation automation id') }),
    };
  });
  return { processId: value.processId, app, window, nodes };
}

function exactText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > MAX_TEXT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new TypeError(`${label} must be non-empty exact text of at most ${MAX_TEXT} characters`);
  }
  return value;
}

const POWERSHELL_UIA_PROBE = String.raw`
$ErrorActionPreference = 'Stop'
$pidValue = [int][Environment]::GetEnvironmentVariable('HUMMER_UIA_PROCESS_ID')
$exactTitle = [Environment]::GetEnvironmentVariable('HUMMER_UIA_WINDOW_TITLE')
[void][System.Reflection.Assembly]::LoadWithPartialName('UIAutomationClient')
[void][System.Reflection.Assembly]::LoadWithPartialName('UIAutomationTypes')
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Web.Extensions')
$process = [System.Diagnostics.Process]::GetProcessById($pidValue)
$processCondition = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  $pidValue
)
$candidates = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  $processCondition
)
$matches = [System.Collections.ArrayList]::new()
for ($candidateIndex = 0; $candidateIndex -lt $candidates.Count; $candidateIndex++) {
  $candidate = $candidates.Item($candidateIndex)
  if ([string]$candidate.Current.Name -ceq $exactTitle) { [void]$matches.Add($candidate) }
}
if ($matches.Count -ne 1) { throw "Exact UIAutomation window unavailable" }
$window = $matches.Item(0)
if ($window.Current.ProcessId -ne $pidValue -or $window.Current.Name -cne $exactTitle) {
  throw "UIAutomation window identity changed"
}
$all = $window.FindAll(
  [System.Windows.Automation.TreeScope]::Subtree,
  [System.Windows.Automation.Condition]::TrueCondition
)
$nodes = [System.Collections.Generic.List[object]]::new()
for ($index = 0; $index -lt $all.Count -and $nodes.Count -lt 128; $index++) {
  $item = $all.Item($index)
  $role = ([string]$item.Current.ControlType.ProgrammaticName) -replace '^ControlType\.', ''
  if ([string]::IsNullOrWhiteSpace($role)) { continue }
  $node = [System.Collections.Generic.Dictionary[string,object]]::new()
  $node.Add('role', [string]$role)
  $automationId = [string]$item.Current.AutomationId
  if (-not [string]::IsNullOrWhiteSpace($automationId)) { $node.Add('automationId', $automationId.Substring(0, [Math]::Min(512, $automationId.Length))) }
  $nodes.Add($node)
}
$result = [System.Collections.Generic.Dictionary[string,object]]::new()
$result.Add('processId', $pidValue)
$result.Add('app', [string]$process.ProcessName)
$result.Add('window', [string]$window.Current.Name)
$result.Add('nodes', $nodes)
$serializer = [System.Web.Script.Serialization.JavaScriptSerializer]::new()
[Console]::Out.WriteLine($serializer.Serialize($result))
[Console]::Out.Flush()
`;
