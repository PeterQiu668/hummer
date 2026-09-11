import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { requireWorkspaceFile } from './workspace-file-guard.js';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ['.xlsx', '.docx', '.pdf'] as const;

type CellScalar = string | number | boolean | null | { formula: string; result: string | number | boolean | null };

export interface DocumentExtraction {
  format: 'xlsx' | 'docx' | 'pdf';
  source: { path: string; sha256: string; sizeBytes: number };
  sheets?: Array<{ name: string; cells: Array<{ address: string; row: number; column: number; value: CellScalar }> }>;
  paragraphs?: string[];
  pages?: Array<{ page: number; text: string }>;
  warnings: string[];
}

export async function extractDocument(
  workspaceDirectory: string,
  requestedPath: string,
  options: { maxBytes?: number } = {},
): Promise<DocumentExtraction> {
  const file = requireWorkspaceFile({
    workspaceDirectory,
    requestedPath,
    capability: 'doc_extract',
    maxBytes: options.maxBytes ?? MAX_DOCUMENT_BYTES,
    extensions: SUPPORTED_EXTENSIONS,
  });
  const bytes = readFileSync(file.absolutePath);
  const source = {
    path: requestedPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };

  try {
    if (isEncryptedContainer(bytes)) throw new Error('encrypted document');
    if (file.extension === '.xlsx') return { format: 'xlsx', source, sheets: await extractXlsx(bytes), warnings: [] };
    if (file.extension === '.docx') {
      const result = await mammoth.extractRawText({ buffer: bytes });
      const paragraphs = result.value.split(/\r?\n(?:\r?\n)+/).map((part) => part.trim()).filter(Boolean);
      if (paragraphs.length === 0) throw new Error('document contains no extractable text');
      return { format: 'docx', source, paragraphs, warnings: result.messages.map((message) => message.message) };
    }
    return { format: 'pdf', source, pages: await extractPdf(bytes), warnings: [] };
  } catch (error) {
    throw normalizeExtractionError(file.extension, error);
  }
}

async function extractXlsx(bytes: Buffer): Promise<DocumentExtraction['sheets']> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  return workbook.worksheets.map((sheet) => {
    const cells: Array<{ address: string; row: number; column: number; value: CellScalar }> = [];
    sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      cells.push({ address: cell.address, row: Number(cell.row), column: Number(cell.col), value: cellValue(cell.value) });
    }));
    return { name: sheet.name, cells };
  });
}

async function extractPdf(bytes: Buffer): Promise<Array<{ page: number; text: string }>> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false });
  const document = await loadingTask.promise;
  try {
    const pages: Array<{ page: number; text: string }> = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' ').trim();
      pages.push({ page: pageNumber, text });
    }
    if (!pages.some((page) => page.text)) throw new Error('document contains no extractable text');
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

function cellValue(value: ExcelJS.CellValue): CellScalar {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if ('formula' in value && typeof value.formula === 'string') return { formula: value.formula, result: scalarResult(value.result) };
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  if ('text' in value) return value.text;
  if ('error' in value) return value.error;
  return JSON.stringify(value);
}

function scalarResult(value: ExcelJS.CellFormulaValue['result']): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

function isEncryptedContainer(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
}

function normalizeExtractionError(extension: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypted/i.test(message) || (error instanceof Error && error.name === 'PasswordException')) {
    return new Error(`doc_extract cannot read encrypted ${extension.slice(1).toUpperCase()} files`);
  }
  return new Error(`doc_extract could not parse corrupt or unsupported ${extension.slice(1).toUpperCase()} content: ${message}`);
}
