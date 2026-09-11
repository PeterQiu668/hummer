import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { extractDocument, MAX_DOCUMENT_BYTES } from './document-extractor.js';

const directories: string[] = [];

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('local document extraction', () => {
  it('preserves XLSX sheet names and cell coordinates', async () => {
    const workspace = temporaryDirectory();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('本月订单');
    sheet.getCell('A1').value = '客户';
    sheet.getCell('B2').value = 128000;
    await workbook.xlsx.writeFile(join(workspace, 'orders.xlsx'));

    const extraction = await extractDocument(workspace, 'orders.xlsx');

    expect(extraction).toMatchObject({
      format: 'xlsx',
      sheets: [{ name: '本月订单', cells: [{ address: 'A1', row: 1, column: 1, value: '客户' }, { address: 'B2', row: 2, column: 2, value: 128000 }] }],
    });
    expect(extraction.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('extracts DOCX paragraphs without uploading the source', async () => {
    const workspace = temporaryDirectory();
    writeFileSync(join(workspace, 'brief.docx'), await minimalDocx(['订单目标', '交付一份客户摘要']));

    const extraction = await extractDocument(workspace, 'brief.docx');

    expect(extraction).toMatchObject({ format: 'docx', paragraphs: ['订单目标', '交付一份客户摘要'] });
  });

  it('extracts PDF text page by page', async () => {
    const workspace = temporaryDirectory();
    writeFileSync(join(workspace, 'quote.pdf'), minimalPdf('Order total 128000'));

    const extraction = await extractDocument(workspace, 'quote.pdf');

    expect(extraction).toMatchObject({ format: 'pdf' });
    expect(extraction.pages?.[0]?.text).toContain('Order total 128000');
  });

  it('fails explicitly for encrypted, corrupt, oversized, outside and linked files', async () => {
    const workspace = temporaryDirectory();
    const outside = temporaryDirectory();
    writeFileSync(join(workspace, 'encrypted.xlsx'), Buffer.from('d0cf11e0a1b11ae1', 'hex'));
    writeFileSync(join(workspace, 'corrupt.xlsx'), 'not an xlsx');
    writeFileSync(join(workspace, 'large.xlsx'), Buffer.alloc(33));
    writeFileSync(join(outside, 'outside.xlsx'), 'outside');
    symlinkSync(outside, join(workspace, 'linked'), 'junction');

    await expect(extractDocument(workspace, 'encrypted.xlsx')).rejects.toThrow(/encrypted/i);
    await expect(extractDocument(workspace, 'corrupt.xlsx')).rejects.toThrow(/corrupt/i);
    await expect(extractDocument(workspace, 'large.xlsx', { maxBytes: 32 })).rejects.toThrow(/larger than 32 bytes/i);
    await expect(extractDocument(workspace, '../outside.xlsx')).rejects.toThrow(/outside the workspace/i);
    await expect(extractDocument(workspace, 'linked/outside.xlsx')).rejects.toThrow(/symbolic link/i);
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(1_048_576);
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-doc-extract-'));
  directories.push(directory);
  return directory;
}

async function minimalDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'ascii');
}
