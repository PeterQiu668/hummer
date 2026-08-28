export class JsonLineDecoder {
  private pending = '';

  push(chunk: string | Uint8Array): unknown[] {
    this.pending += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk, { stream: true });
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? '';
    return lines.flatMap((line) => this.parseLine(line));
  }

  finish(): unknown[] {
    const line = this.pending;
    this.pending = '';
    return this.parseLine(line);
  }

  private parseLine(line: string): unknown[] {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid Codex JSONL: ${message}`);
    }
  }
}
