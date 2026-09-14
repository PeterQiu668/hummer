import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { preReadInboxFile } from './inbox-pre-reader.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('inbox pre-reader', () => {
  it('extracts an XLSX locally into a useful work-order summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hummer-inbox-pre-read-'));
    roots.push(root);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('订单明细');
    sheet.addRows([['客户', '交付物'], ['华东系统集成', '月度经营报告']]);
    await workbook.xlsx.writeFile(join(root, '订单.xlsx'));

    const result = await preReadInboxFile(root, '订单.xlsx');

    expect(result).toMatchObject({ executable: true, capabilityId: 'doc.extract', format: 'xlsx' });
    expect(result.summary).toContain('订单明细');
    expect(result.summary).toContain('华东系统集成');
    expect(result.summary).toContain('月度经营报告');
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails explicitly for corrupt office content instead of returning an empty summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hummer-inbox-corrupt-'));
    roots.push(root);
    writeFileSync(join(root, '损坏.xlsx'), 'not an xlsx', 'utf8');

    const result = await preReadInboxFile(root, '损坏.xlsx');

    expect(result.executable).toBe(false);
    expect(result.capabilityId).toBe('doc.extract');
    expect(result.summary).toBe('');
    expect(result.error).toMatch(/无法预读/);
  });
});
