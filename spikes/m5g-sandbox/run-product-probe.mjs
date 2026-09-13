import { WorkspaceExecService } from '../../apps/desktop/dist/workspace-exec-service.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const service = new WorkspaceExecService({ workspaceRoot: 'C:/HUMMER-sandbox-spike/product-execute' });
const health = await service.selfCheck();
if (!health.available) throw new Error(health.diagnostic ?? health.issue ?? 'self-check failed');
const orderId = `order-real-${Date.now()}`;
const result = await service.execute({
  orderId,
  argv: ['python', '/workspace/build.py'],
  files: [{
    path: 'build.py',
    content: [
      'from pathlib import Path',
      "Path('result.txt').write_text('real office output', encoding='utf-8')",
      "print('built')",
      '',
    ].join('\n'),
  }],
});
const evidence = {
  schemaVersion: 1,
  milestone: 'M5-G',
  generatedAt: new Date().toISOString(),
  evidenceClass: 'local-product-container-boundary',
  orderId,
  health,
  result,
};
writeFileSync(resolve('spikes/m5g-sandbox/product-service-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence));
