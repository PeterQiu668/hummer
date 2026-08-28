import type { SessionPlan } from '../model/session';
import type { RuntimeAdapter, RuntimeEvent, RuntimeHandle, Unsubscribe } from './adapter';

export class FailoverRuntimeAdapter implements RuntimeAdapter {
  fallbackReason?: string;
  private active: RuntimeAdapter;

  constructor(
    private readonly primary: RuntimeAdapter,
    private readonly fallback: RuntimeAdapter,
  ) {
    this.active = primary;
  }

  get id(): string {
    return this.active.id;
  }

  async startSession(plan: SessionPlan): Promise<RuntimeHandle> {
    if (this.active === this.fallback) return this.fallback.startSession(plan);
    try {
      return await this.primary.startSession(plan);
    } catch (error) {
      this.fallbackReason = error instanceof Error ? error.message : String(error);
      this.active = this.fallback;
      return this.fallback.startSession(plan);
    }
  }

  subscribe(handle: RuntimeHandle, callback: (event: RuntimeEvent) => void): Unsubscribe {
    return this.adapterFor(handle).subscribe(handle, callback);
  }

  respondToApproval(handle: RuntimeHandle, id: string, approved: boolean): Promise<void> {
    return this.adapterFor(handle).respondToApproval(handle, id, approved);
  }

  sendHumanMessage(handle: RuntimeHandle, text: string): Promise<void> {
    return this.adapterFor(handle).sendHumanMessage(handle, text);
  }

  pause(handle: RuntimeHandle): Promise<void> {
    return this.adapterFor(handle).pause(handle);
  }

  resume(handle: RuntimeHandle): Promise<void> {
    return this.adapterFor(handle).resume(handle);
  }

  stop(handle: RuntimeHandle): Promise<void> {
    return this.adapterFor(handle).stop(handle);
  }

  forkFromCheckpoint(handle: RuntimeHandle, sequence: number, sop?: string): Promise<RuntimeHandle> {
    return this.adapterFor(handle).forkFromCheckpoint(handle, sequence, sop);
  }

  private adapterFor(handle: RuntimeHandle): RuntimeAdapter {
    if (handle.runtimeId === this.primary.id) return this.primary;
    if (handle.runtimeId === this.fallback.id) return this.fallback;
    throw new Error(`Unknown runtime handle ${handle.sessionId}`);
  }
}
