import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { inflateSync } from 'node:zlib';
import { _electron as electron, chromium } from 'playwright';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { configureInternalValidationDisplay } from './configure-e2e-engine.mjs';

const DEFINITIONS = {
  website: {
    port: 4201,
    task: 'Use HUMMER workspace.exec now to create a polished responsive Chinese project delivery status website. Generate build.py, run it with python /workspace/build.py, and produce index.html plus styles.css. Use only local HTML and CSS, no network resources. Do not merely describe the work.',
    actions: ['file.write.export'],
  },
  deck: {
    port: 4202,
    task: 'Use HUMMER workspace.exec now with python-pptx. Generate build.py, run python /workspace/build.py, and create delivery-review.pptx with exactly 5 slides: title, progress, risks, financials, next actions. Include real Chinese slide text. Do not merely describe the work.',
    actions: ['file.write.export'],
  },
  report: {
    port: 4203,
    task: 'First use HUMMER doc.extract to read source.xlsx. Then use HUMMER workspace.exec now with python-docx and matplotlib: stage build.py, run python /workspace/build.py, and create analysis-report.docx containing the extracted project facts and at least one embedded chart. Do not merely describe the work.',
    actions: ['file.write.export'],
    input: 'source.xlsx',
  },
  image: {
    port: 4204,
    task: 'Use HUMMER workspace.exec now with Pillow. Generate build.py, run python /workspace/build.py, and create campaign-visual.png at 1200x630 with a non-uniform background, Chinese title, metric blocks, and footer. Load /usr/share/fonts/truetype/wqy/wqy-zenhei.ttc for every Chinese text element. Do not merely describe the work.',
    actions: ['file.write.export'],
  },
  sales: {
    port: 4205,
    task: 'First use HUMMER doc.extract to read leads.xlsx. Then use HUMMER workspace.exec now with openpyxl: stage build.py, run python /workspace/build.py, and create follow-up-plan.xlsx plus customer-message-draft.md. This is draft preparation only. The requested CRM write and external send must remain controlled actions and must not happen inside the sandbox. Do not merely describe the work.',
    actions: ['crm.write.records', 'external.send.message'],
    input: 'leads.xlsx',
  },
  content: {
    port: 4206,
    task: 'Use HUMMER workspace.exec now with Pillow. Generate build.py, run python /workspace/build.py, and create Chinese social-copy.md plus social-visual.png at 1080x1080. Load /usr/share/fonts/truetype/wqy/wqy-zenhei.ttc for every Chinese text element. This is a draft only; publishing is a controlled external action. Do not merely describe the work.',
    actions: ['external.send.publish'],
  },
};

export async function runM5gWorkflow(kind) {
  const definition = DEFINITIONS[kind];
  if (!definition) throw new Error(`Unknown M5-G workflow: ${kind}`);
  const root = process.cwd();
  const spikeRoot = resolve(root, `spikes/m5g-workflows/${kind}`);
  const inputWorkspace = resolve(spikeRoot, 'inputs');
  const dataDirectory = resolve(spikeRoot, 'facts');
  const profileDirectory = resolve(spikeRoot, 'profile');
  const executionRoot = resolve(spikeRoot, 'order-workspaces');
  const receiptsDirectory = resolve(spikeRoot, 'receipts');
  const artifactsDirectory = resolve(spikeRoot, 'artifacts');
  const wireLogPath = resolve(spikeRoot, `${kind}-wire.jsonl`);
  const evidencePath = resolve(spikeRoot, `${kind}-evidence.json`);
  const screenshotPath = resolve(spikeRoot, `${kind}-ui.png`);
  const codexPath = resolve(process.env.LOCALAPPDATA ?? '', 'hermes/node/codex.cmd');
  const baseUrl = `http://127.0.0.1:${definition.port}`;

  if (!existsSync(codexPath)) throw new Error(`Real Codex CLI is unavailable at ${codexPath}`);
  for (const target of [inputWorkspace, dataDirectory, profileDirectory, executionRoot, receiptsDirectory, artifactsDirectory]) {
    if (!target.startsWith(spikeRoot)) throw new Error('Refusing to clean outside the M5-G workflow spike');
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
  }
  for (const target of [wireLogPath, evidencePath, screenshotPath]) if (existsSync(target)) rmSync(target, { force: true });
  await createInputFixture(kind, inputWorkspace);

  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(definition.port), '--strictPort'], {
    cwd: root, stdio: 'pipe', windowsHide: true,
    env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'codex', VITE_HUMMER_CODEX_PROTOCOL: 'app-server-jsonrpc' },
  });
  let app;
  try {
    await waitForServer(baseUrl);
    app = await electron.launch({
      args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        HUMMER_RENDERER_URL: baseUrl,
        HUMMER_CODEX_CWD: inputWorkspace,
        HUMMER_CODEX_PATH: codexPath,
        HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath,
        HUMMER_DATA_DIR: dataDirectory,
        HUMMER_EXEC_WORKSPACE_ROOT: executionRoot,
        HUMMER_SANDBOX_IMAGE: 'hummer-office-sandbox:m5g',
        HUMMER_ENGINE_PROFILE: 'openai-codex-validation',
        HUMMER_CODEX_REASONING_EFFORT: 'low',
      },
    });
    const page = await app.firstWindow({ timeout: 120_000 });
    const token = await ensureIdentity(page, kind);
    await configureInternalValidationDisplay(page);
    await page.evaluate(async ({ token }) => {
      if (!window.hummerToolRegistry) throw new Error('Tool registry bridge is unavailable');
      await window.hummerToolRegistry.verifyLocalMcp(token);
    }, { token });
    const intakeTitle = `M5-G ${kind} 真实办公订单`;
    const intake = await page.evaluate(async ({ token, input }) => {
      if (!window.hummerWorkOrderIntake) throw new Error('Work order intake bridge is unavailable');
      return window.hummerWorkOrderIntake.submitForm({ token, input });
    }, { token, input: {
      title: intakeTitle,
      target: definition.task,
      expectedDeliverable: `${kind} 可解析产物与可独立验证回执`,
      assignee: '数字交付同事',
      dueAt: null,
      attachmentNames: definition.input ? [definition.input] : [],
      prompt: definition.task,
      executable: true,
      suggestedCapabilities: definition.input ? ['doc.extract', 'workspace.exec'] : ['workspace.exec'],
    } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ensureIdentity(page, kind);
    await configureInternalValidationDisplay(page);
    await page.getByRole('button', { name: '工作台', exact: true }).click();
    await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByLabel('选择模型').selectOption({ label: '旗舰' });
    await page.getByRole('button', { name: `确认工单：${intakeTitle}` }).click();
    const planBadge = page.getByText('模型生成计划', { exact: true });
    await planBadge.waitFor({ state: 'visible', timeout: 150_000 });
    const planText = (await planBadge.locator('xpath=ancestor::form').innerText()).replace(/\s+/g, ' ');
    if (!planText.includes('workspace.exec')) throw new Error(`Real plan omitted workspace.exec: ${planText}`);
    await page.getByRole('button', { name: '开始干' }).click();
    await page.locator('[data-runtime-event-kind="tool"][data-runtime-tool="workspace.exec"]').last().waitFor({ state: 'visible', timeout: 240_000 });
    await page.getByText('任务运行完成', { exact: true }).waitFor({ state: 'visible', timeout: 180_000 });

    const product = await page.evaluate(async ({ token, task, actions, kind, intakeId }) => {
      if (!window.hummerPersistence || !window.hummerOutcomes || !window.hummerToolRegistry || !window.hummerApprovalPolicy || !window.hummerEnvironmentDoctor || !window.hummerWorkOrderIntake) throw new Error('Required HUMMER desktop bridge is unavailable');
      const sessions = await window.hummerPersistence.listSessions(token);
      const session = sessions.find((candidate) => candidate.plan?.prompt === task && candidate.plan?.intakeId === intakeId);
      if (!session) throw new Error('Real workflow session was not persisted');
      const tool = session.events.findLast((event) => event.type === 'tool' && event.tool === 'workspace.exec' && event.status === 'completed');
      if (!tool) throw new Error('Completed workspace.exec event was not persisted');
      let sequence = Math.max(...session.events.map((event) => event.sequence), 0);
      const branches = [];
      for (const action of actions) {
        const definition = await window.hummerOutcomes.define({ token, input: {
          actionPattern: action, title: `${kind} ${action} 验收`, acceptanceCriteria: '真实产物已生成，出境决策由具名负责人审批',
          riskLevel: 'high', idempotencyKey: `m5g-${kind}-${action}-definition`,
        } });
        for (const approved of [false, true]) {
          const branch = approved ? 'approved' : 'rejected';
          const approvalId = `approval_m5g_${kind}_${action.replaceAll('.', '_')}_${branch}`;
          await window.hummerPersistence.appendEvent({ token, plan: session.plan, handle: session.handle, event: {
            sessionId: session.handle.sessionId, sequence: ++sequence, occurredAt: new Date().toISOString(), actorRef: 'employee:codex',
            type: 'approval_required', approvalId, title: `请求 ${action}`, message: '沙箱产物已完成，出境动作等待具名审批',
            tool: action, args: { artifactEvidenceRefs: tool.evidenceRefs }, result: '待审批', durationMs: null, costCny: null, evidenceRefs: tool.evidenceRefs,
          } });
          const authorization = await window.hummerApprovalPolicy.authorize({ token, input: {
            sessionId: session.handle.sessionId, approvalId, action, requestedBy: 'employee:codex', estimatedCostCny: null, approved, occurredAt: new Date().toISOString(),
          } });
          const outcome = await window.hummerOutcomes.record({ token, input: {
            outcomeDefinitionId: definition.id, workOrderId: session.plan.workOrderId, sessionId: session.handle.sessionId, approvalId,
            verdict: approved ? 'accepted' : 'rejected', evidenceRef: tool.evidenceRefs.find((ref) => ref.startsWith('evidence://sha256/')),
            occurredAt: new Date().toISOString(), idempotencyKey: `m5g-${kind}-${action}-${branch}-outcome`,
          } });
          const receipt = await window.hummerOutcomes.exportReceipt({ token, input: { outcomeEventId: outcome.id } });
          branches.push({ action, branch, authorization, outcome, receipt });
        }
      }
      return {
        session, tool, branches, intake: (await window.hummerWorkOrderIntake.listAll(token)).find((candidate) => candidate.id === intakeId),
        integrity: await window.hummerPersistence.verifyIntegrity(token),
        environment: await window.hummerEnvironmentDoctor.check(false),
      };
    }, { token, task: definition.task, actions: definition.actions, kind, intakeId: intake.id });

    const orderDirectory = resolve(executionRoot, product.session.plan.workOrderId);
    const artifactEvidence = await validateArtifacts(kind, orderDirectory, spikeRoot);
    for (const artifact of artifactEvidence.files) {
      copyFileSync(resolve(orderDirectory, artifact), resolve(artifactsDirectory, artifact));
    }
    if (!product.environment.workspaceExec?.available || product.environment.workspaceExec.passed !== 5) throw new Error('Startup isolation self-check was not 5/5');
    if (product.session.events.some((event) => event.type === 'tool' && event.tool === 'shell.command')) throw new Error('Forbidden Codex shell execution occurred');
    if (!product.tool.evidenceRefs.some((ref) => ref.startsWith('evidence://sha256/'))) throw new Error('workspace.exec lacks content-addressed evidence');
    if (!product.integrity.valid) throw new Error(`Hash chain is invalid: ${JSON.stringify(product.integrity)}`);
    if (!product.intake || product.intake.status !== 'confirmed' || product.session.plan.workOrderId !== product.intake.workOrderId) {
      throw new Error(`Confirmed intake and execution diverged: ${product.intake?.workOrderId ?? 'missing'} != ${product.session.plan.workOrderId}`);
    }
    for (const branch of product.branches) {
      if ((branch.branch === 'approved') !== branch.authorization.approved) throw new Error(`Approval branch mismatch: ${branch.action}/${branch.branch}`);
      const receiptPath = resolve(receiptsDirectory, `${branch.action.replaceAll('.', '-')}-${branch.branch}.json`);
      writeFileSync(receiptPath, `${branch.receipt}\n`, 'utf8');
      const verification = verifyReceipt(root, receiptPath);
      if (!verification.valid) throw new Error(`Independent receipt verification failed: ${receiptPath}`);
    }
    const wire = readWireMessages(wireLogPath);
    const workspaceExecCall = wire.some(({ raw }) => raw?.method === 'item/started' && raw.params?.item?.type === 'mcpToolCall' && raw.params.item.tool === 'workspace_exec');
    const shellCall = wire.some(({ raw }) => raw?.method === 'item/started' && raw.params?.item?.type === 'commandExecution');
    const inheritedMcpServers = [...new Set(wire
      .filter(({ raw }) => raw?.method === 'mcpServer/startupStatus/updated')
      .map(({ raw }) => raw.params?.name)
      .filter((name) => typeof name === 'string' && name !== 'hummer_local'))];
    if (!workspaceExecCall || shellCall || inheritedMcpServers.length) throw new Error(`Wire boundary proof failed: ${JSON.stringify({ workspaceExecCall, shellCall, inheritedMcpServers })}`);
    const evidence = {
      generatedAt: new Date().toISOString(), evidenceClass: 'real-codex-runtime-plus-local-product-approval-chain',
      kind, task: definition.task, planText, intakeId: intake.id, sessionId: product.session.handle.sessionId, workOrderId: product.session.plan.workOrderId,
      orderDirectory,
      artifactArchive: { directory: 'artifacts', files: artifactEvidence.files },
      artifactEvidence,
      uiScreenshot: basename(screenshotPath),
      tool: product.tool,
      startupIsolation: product.environment.workspaceExec,
      branches: product.branches.map(({ receipt, ...branch }) => branch), wireProof: { workspaceExecCall, shellCall, inheritedMcpServers }, chainIntegrity: product.integrity,
      disclosure: '本工作流证明隔离沙箱产物与出境审批决策。M5-H 的受控本地目录导出由独立 egress E2E 验证；本工作流不宣称 SMTP、IM、CRM 或其他网络渠道投递。',
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify({ kind, evidencePath, screenshotPath, orderDirectory, artifactEvidence, branches: evidence.branches.map(({ action, branch, authorization }) => ({ action, branch, approved: authorization.approved })), chainIntegrity: product.integrity }, null, 2));
  } finally {
    if (app) {
      const child = app.process();
      await Promise.race([app.close(), delay(5_000)]);
      if (!child.killed) child.kill();
    }
    vite.kill();
  }
}

async function createInputFixture(kind, directory) {
  if (kind === 'report') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('项目数据');
    sheet.addRows([['项目', '进度', '成本'], ['东方集成', 0.72, 680000], ['南方交付', 0.48, 420000], ['北方设备', 0.91, 870000]]);
    await workbook.xlsx.writeFile(resolve(directory, 'source.xlsx'));
  }
  if (kind === 'sales') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('线索');
    sheet.addRows([['客户', '阶段', '金额', '下一步'], ['甲公司', '方案', 320000, '安排演示'], ['乙公司', '商务', 560000, '确认合同'], ['丙公司', '线索', 180000, '首次访谈']]);
    await workbook.xlsx.writeFile(resolve(directory, 'leads.xlsx'));
  }
}

async function validateArtifacts(kind, directory, spikeRoot) {
  if (!existsSync(directory)) throw new Error(`Order sandbox is missing: ${directory}`);
  if (kind === 'website') {
    const html = readRequired(resolve(directory, 'index.html'));
    readRequired(resolve(directory, 'styles.css'));
    if (!/<html|<!doctype/i.test(html)) throw new Error('Website artifact is not valid HTML');
    const screenshot = resolve(spikeRoot, 'website-browser.png');
    await screenshotWebsite(directory, screenshot);
    return { files: ['index.html', 'styles.css'], browserScreenshot: screenshot };
  }
  if (kind === 'deck') {
    const path = resolve(directory, 'delivery-review.pptx');
    const zip = await JSZip.loadAsync(readFileSync(path));
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    if (slides.length !== 5) throw new Error(`PPTX slide count is ${slides.length}, expected 5`);
    return { files: [basename(path)], slideCount: slides.length };
  }
  if (kind === 'report') {
    const path = resolve(directory, 'analysis-report.docx');
    const zip = await JSZip.loadAsync(readFileSync(path));
    if (!zip.file('word/document.xml')) throw new Error('DOCX has no document.xml');
    const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !zip.files[name].dir);
    if (!media.length) throw new Error('DOCX report has no embedded chart');
    return { files: [basename(path)], embeddedMediaCount: media.length };
  }
  if (kind === 'image') {
    return { files: ['campaign-visual.png'], ...validatePng(resolve(directory, 'campaign-visual.png'), 1200, 630) };
  }
  if (kind === 'sales') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(resolve(directory, 'follow-up-plan.xlsx'));
    const rows = workbook.worksheets[0]?.actualRowCount ?? 0;
    if (rows < 4) throw new Error(`Sales workbook has only ${rows} rows`);
    readRequired(resolve(directory, 'customer-message-draft.md'));
    return { files: ['follow-up-plan.xlsx', 'customer-message-draft.md'], rows };
  }
  readRequired(resolve(directory, 'social-copy.md'));
  return { files: ['social-copy.md', 'social-visual.png'], ...validatePng(resolve(directory, 'social-visual.png'), 1080, 1080) };
}

function validatePng(path, width, height) {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${path} is not a PNG`);
  const actualWidth = bytes.readUInt32BE(16);
  const actualHeight = bytes.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) throw new Error(`PNG dimensions are ${actualWidth}x${actualHeight}, expected ${width}x${height}`);
  const pixelEvidence = inspectPngPixels(bytes, actualWidth, actualHeight);
  if (pixelEvidence.distinctColors < 2 || pixelEvidence.visiblePixels === 0) {
    throw new Error('PNG contains no visible pixel variation');
  }
  return { width: actualWidth, height: actualHeight, sizeBytes: bytes.length, ...pixelEvidence };
}

function inspectPngPixels(bytes, width, height) {
  const idat = [];
  let offset = 8;
  let bitDepth;
  let colorType;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) throw new Error(`Unsupported PNG format: depth=${bitDepth}, colorType=${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  const colors = new Set();
  let visiblePixels = 0;
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor++];
    for (let x = 0; x < stride; x += 1) {
      const encoded = raw[cursor++];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      current[x] = (encoded + pngFilterPredictor(filter, left, up, upperLeft)) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const index = x * channels;
      const alpha = channels === 4 ? current[index + 3] : 255;
      if (alpha > 0) visiblePixels += 1;
      if (colors.size < 256) colors.add(current.subarray(index, index + channels).toString('hex'));
    }
    current.copy(previous);
  }
  return { visiblePixels, distinctColors: colors.size };
}

function pngFilterPredictor(filter, left, up, upperLeft) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) {
    const estimate = left + up - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const diagonalDistance = Math.abs(estimate - upperLeft);
    return leftDistance <= upDistance && leftDistance <= diagonalDistance ? left : upDistance <= diagonalDistance ? up : upperLeft;
  }
  throw new Error(`Unsupported PNG filter: ${filter}`);
}

async function screenshotWebsite(directory, screenshot) {
  const server = createServer((request, response) => {
    const name = request.url === '/styles.css' ? 'styles.css' : 'index.html';
    response.setHeader('content-type', name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    response.end(readFileSync(resolve(directory, name)));
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: screenshot, fullPage: true });
  } finally {
    await browser.close();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

function verifyReceipt(root, path) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/verify-receipt.mjs'), path], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Receipt verifier exited ${result.status}`);
  return JSON.parse(result.stdout);
}

function readRequired(path) {
  if (!existsSync(path)) throw new Error(`Required artifact is missing: ${path}`);
  const content = readFileSync(path, 'utf8');
  if (!content.trim()) throw new Error(`Required artifact is empty: ${path}`);
  return content;
}

function readWireMessages(path) {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const envelope = JSON.parse(line);
    return { ...envelope, raw: typeof envelope.raw === 'string' ? JSON.parse(envelope.raw) : envelope.raw };
  });
}

async function ensureIdentity(page, kind) {
  const gate = page.getByRole('heading', { name: '进入 HUMMER' });
  const workbench = page.getByRole('heading', { name: '工作台' });
  await Promise.race([gate.waitFor({ state: 'visible', timeout: 120_000 }), workbench.waitFor({ state: 'visible', timeout: 120_000 })]);
  if (await gate.isVisible()) {
    await page.getByLabel('公司名称').fill(`HUMMER M5-G ${kind}`);
    await page.getByLabel('你的姓名').fill('工作流验收人');
    await page.getByLabel('邮箱或手机').fill(`m5g-${kind}@example.test`);
    await page.getByRole('button', { name: '创建并进入' }).click();
    await gate.waitFor({ state: 'hidden', timeout: 15_000 });
  }
  const token = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (!token) throw new Error('Authentication token was not created');
  return token;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Vite is starting. */ }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}
