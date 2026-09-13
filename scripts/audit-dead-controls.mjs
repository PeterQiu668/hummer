import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const sourceRoot = join(root, 'src');
const failures = [];

for (const file of walk(sourceRoot)) {
  const sourceText = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  visit(source, source);
}

if (failures.length) {
  console.error('Dead control audit failed. Native buttons need onClick or type="submit":');
  failures.forEach((failure) => console.error(`  ${failure}`));
  process.exitCode = 1;
} else {
  console.log('Dead control audit passed: every native button has onClick or type="submit".');
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return extname(entry.name) === '.tsx' ? [path] : [];
  });
}

function visit(node, source) {
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'button') {
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
    const hasClick = attributes.some((attribute) => attribute.name.getText(source) === 'onClick');
    const type = attributes.find((attribute) => attribute.name.getText(source) === 'type');
    const isSubmit = type?.initializer && ts.isStringLiteral(type.initializer) && type.initializer.text === 'submit';
    if (!hasClick && !isSubmit) {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      failures.push(`${relative(root, source.fileName)}:${line + 1}:${character + 1} ${node.getText(source).slice(0, 140).replace(/\s+/g, ' ')}`);
    }
  }
  ts.forEachChild(node, (child) => visit(child, source));
}
