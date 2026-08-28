import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type WireLogChannel = 'inbound' | 'outbound' | 'stderr';

export class TextLineDecoder {
  private pending = '';

  push(chunk: string | Uint8Array): string[] {
    this.pending += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk, { stream: true });
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? '';
    return lines.filter((line) => line.length > 0);
  }

  finish(): string[] {
    const line = this.pending;
    this.pending = '';
    return line ? [line] : [];
  }
}

export class WireLog {
  constructor(private readonly path?: string) {
    if (path) mkdirSync(dirname(path), { recursive: true });
  }

  append(channel: WireLogChannel, raw: string): void {
    if (!this.path) return;
    appendFileSync(this.path, `${JSON.stringify({ occurredAt: new Date().toISOString(), channel, raw })}\n`, 'utf8');
  }
}
