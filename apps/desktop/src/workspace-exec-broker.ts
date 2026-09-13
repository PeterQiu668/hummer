import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection, createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceExecRequest, WorkspaceExecResult, WorkspaceExecService } from './workspace-exec-service.js';
import { TextLineDecoder } from './wire-log.js';

export interface WorkspaceExecLeaseContext {
  authToken: string;
  sessionId: string;
  workOrderId: string;
}

export interface WorkspaceExecLease {
  pipe: string;
  token: string;
}

type WorkspaceExecToolInput = Omit<WorkspaceExecRequest, 'orderId'>;
interface BrokerRequest { token: string; input: WorkspaceExecToolInput }
interface LeaseRecord extends WorkspaceExecLeaseContext { token: string }

export class WorkspaceExecBroker {
  private readonly leases = new Map<string, LeaseRecord>();
  private server: Server | null = null;
  private pipe = '';

  constructor(private readonly options: {
    service: WorkspaceExecService;
    onExecuted?: (context: WorkspaceExecLeaseContext, result: WorkspaceExecResult, request: WorkspaceExecToolInput, workspaceDirectory: string) => Promise<WorkspaceExecResult> | WorkspaceExecResult;
  }) {}

  async start(): Promise<void> {
    if (this.server) return;
    this.pipe = process.platform === 'win32'
      ? `\\\\.\\pipe\\hummer-workspace-exec-${randomUUID()}`
      : join(tmpdir(), `hummer-workspace-exec-${randomUUID()}.sock`);
    this.server = createServer((socket) => {
      const decoder = new TextLineDecoder();
      socket.on('data', (chunk: Buffer) => decoder.push(chunk).forEach((line) => { void this.respond(socket, line); }));
      socket.on('end', () => decoder.finish().forEach((line) => { void this.respond(socket, line); }));
    });
    await new Promise<void>((resolvePromise, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.pipe, () => {
        this.server!.off('error', reject);
        resolvePromise();
      });
    });
  }

  createLease(context: WorkspaceExecLeaseContext): WorkspaceExecLease {
    if (!this.server || !this.pipe) throw new Error('Workspace execution broker is not started');
    const token = randomBytes(32).toString('hex');
    this.leases.set(token, { ...context, token });
    return { pipe: this.pipe, token };
  }

  revoke(token: string): void {
    this.leases.delete(token);
  }

  async close(): Promise<void> {
    this.leases.clear();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }

  private async respond(socket: NodeJS.WritableStream, line: string): Promise<void> {
    try {
      const request = JSON.parse(line) as BrokerRequest;
      const lease = typeof request.token === 'string' ? this.leases.get(request.token) : undefined;
      if (!lease) throw new Error('workspace.exec lease is invalid or expired');
      const result = await this.options.service.execute({ ...request.input, orderId: lease.workOrderId });
      const published = await this.options.onExecuted?.(
        lease,
        result,
        request.input,
        this.options.service.workspaceDirectory(lease.workOrderId),
      ) ?? result;
      socket.write(`${JSON.stringify({ ok: true, result: published })}\n`);
    } catch (error) {
      socket.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    } finally {
      socket.end();
    }
  }
}

export function requestWorkspaceExecFromBroker(
  input: WorkspaceExecToolInput,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceExecResult> {
  const pipe = environment.HUMMER_EXEC_BROKER_PIPE;
  const token = environment.HUMMER_EXEC_BROKER_TOKEN;
  if (!pipe || !token) return Promise.reject(new Error('HUMMER workspace execution broker is unavailable'));
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(pipe);
    const decoder = new TextLineDecoder();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('HUMMER workspace execution broker timed out'));
    }, 330_000);
    socket.on('connect', () => socket.write(`${JSON.stringify({ token, input })}\n`));
    socket.on('data', (chunk: Buffer) => {
      for (const line of decoder.push(chunk)) {
        clearTimeout(timeout);
        const response = JSON.parse(line) as { ok: boolean; result?: WorkspaceExecResult; error?: string };
        if (!response.ok || !response.result) reject(new Error(response.error ?? 'workspace.exec failed'));
        else resolvePromise(response.result);
      }
    });
    socket.on('error', (error) => { clearTimeout(timeout); reject(error); });
    socket.on('close', () => clearTimeout(timeout));
  });
}
