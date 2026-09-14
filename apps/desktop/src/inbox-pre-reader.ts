import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { extractDocument } from './document-extractor.js';
import { requireWorkspaceFile } from './workspace-file-guard.js';

const MAX_TEXT_PREVIEW_BYTES = 1_048_576;
const MAX_SUMMARY_CHARS = 1_600;

export interface InboxPreReadResult {
  executable: boolean;
  capabilityId: 'doc.extract' | 'fs.read' | null;
  format: 'xlsx' | 'docx' | 'pdf' | 'text' | null;
  sourceSha256: string;
  summary: string;
  error?: string;
}

export async function preReadInboxFile(workspaceDirectory: string, requestedPath: string): Promise<InboxPreReadResult> {
  const extension = extname(requestedPath).toLowerCase();
  if (['.xlsx', '.docx', '.pdf'].includes(extension)) {
    try {
      const extracted = await extractDocument(workspaceDirectory, requestedPath);
      return {
        executable: true,
        capabilityId: 'doc.extract',
        format: extracted.format,
        sourceSha256: extracted.source.sha256,
        summary: truncate(documentSummary(extracted), MAX_SUMMARY_CHARS),
      };
    } catch (error) {
      return {
        executable: false,
        capabilityId: 'doc.extract',
        format: null,
        sourceSha256: sourceHash(workspaceDirectory, requestedPath),
        summary: '',
        error: `无法预读附件：${humanizeError(error)}`,
      };
    }
  }

  if (['.txt', '.md', '.json', '.csv'].includes(extension)) {
    try {
      const file = requireWorkspaceFile({ workspaceDirectory, requestedPath, capability: 'inbox_pre_read', maxBytes: MAX_TEXT_PREVIEW_BYTES });
      const bytes = readFileSync(file.absolutePath);
      const content = bytes.toString('utf8').replace(/\s+/g, ' ').trim();
      return {
        executable: true,
        capabilityId: 'fs.read',
        format: 'text',
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        summary: truncate(content, MAX_SUMMARY_CHARS),
      };
    } catch (error) {
      return {
        executable: false,
        capabilityId: 'fs.read',
        format: null,
        sourceSha256: sourceHash(workspaceDirectory, requestedPath),
        summary: '',
        error: `无法预读附件：${humanizeError(error)}`,
      };
    }
  }

  return {
    executable: false,
    capabilityId: null,
    format: null,
    sourceSha256: sourceHash(workspaceDirectory, requestedPath),
    summary: '',
    error: '当前文件类型暂不支持自动预读，请转换为 XLSX、DOCX、PDF、TXT、MD、JSON 或 CSV。',
  };
}

function documentSummary(value: Awaited<ReturnType<typeof extractDocument>>): string {
  if (value.sheets) {
    return value.sheets.map((sheet) => {
      const cells = sheet.cells.slice(0, 24).map((cell) => `${cell.address}=${cellValueText(cell.value)}`);
      return `工作表 ${sheet.name}：${cells.join('；')}`;
    }).join('\n');
  }
  if (value.paragraphs) return value.paragraphs.slice(0, 12).join(' ');
  if (value.pages) return value.pages.slice(0, 3).map((page) => page.text).join(' ');
  return '';
}

function cellValueText(value: unknown): string {
  if (value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function sourceHash(workspaceDirectory: string, requestedPath: string): string {
  try {
    const file = requireWorkspaceFile({ workspaceDirectory, requestedPath, capability: 'inbox_pre_read', maxBytes: 25 * 1024 * 1024 });
    return createHash('sha256').update(readFileSync(file.absolutePath)).digest('hex');
  } catch {
    return '';
  }
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function humanizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/encrypted/i.test(message)) return '附件已加密，需先解密后再处理。';
  if (/size limit|too large/i.test(message)) return '附件超过当前本地预读大小限制。';
  return '附件格式损坏或无法解析。';
}
