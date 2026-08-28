export class ApprovalContinuationWatchdog {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: (approvalId: string) => void,
  ) {}

  arm(approvalId: string): void {
    this.clear(approvalId);
    const timer = setTimeout(() => {
      this.timers.delete(approvalId);
      this.onTimeout(approvalId);
    }, this.timeoutMs);
    this.timers.set(approvalId, timer);
  }

  acknowledgeAll(): void {
    [...this.timers.keys()].forEach((approvalId) => this.clear(approvalId));
  }

  clearAll(): void {
    this.acknowledgeAll();
  }

  private clear(approvalId: string): void {
    const timer = this.timers.get(approvalId);
    if (timer) clearTimeout(timer);
    this.timers.delete(approvalId);
  }
}
