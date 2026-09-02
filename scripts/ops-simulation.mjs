// HUMMER 10-30 人公司经营管理日常工作流模拟（只读审计脚本，不写业务数据）
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4179';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4179', '--strictPort'], { cwd: process.cwd(), stdio: 'pipe', windowsHide: true });

const report = [];
let clicks = 0;

function log(scenario, step, verdict, note) { report.push({ scenario, step, verdict, note }); }

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('vite did not start');
}

let browserServer;
try {
  await waitForServer(baseUrl);
  browserServer = await chromium.launchServer({ headless: true });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const click = async (locator, label) => { clicks += 1; await locator.click(); return label; };

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台' }).waitFor({ timeout: 15_000 });

  // ---- 场景 A：早上开工，老板看今天要做什么 ----
  const hasToday = await page.getByText('公司本季重点').count();
  const hasSuggest = await page.getByText('分身建议').count();
  log('A 早上开工', '工作台首屏是否给出今日议程', hasToday && hasSuggest ? 'PASS' : 'FAIL', `本季重点=${hasToday} 分身建议=${hasSuggest}；0 次点击可见`);

  // ---- 场景 B：下达一项工作 -> 计划 -> 执行 -> 补充 -> 审批 -> 交付 ----
  const t0 = Date.now();
  const composer = page.getByRole('textbox', { name: '任务描述' });
  await composer.fill('整理华东 12 家重点客户，标注下一步动作，并把结论同步到 CRM');
  await composer.press('Enter');
  clicks += 1;
  await page.getByText('我理解你要做的是：').waitFor({ timeout: 8_000 });
  await click(page.getByRole('button', { name: '开始干' }), '开始干');
  await page.getByText(/目标下达：/).waitFor({ timeout: 8_000 });
  const follow = page.getByRole('textbox', { name: '在当前会话补充要求' });
  await follow.fill('等一下，先只做华东的');
  await follow.press('Enter');
  clicks += 1;
  await page.getByRole('button', { name: '确认更新' }).waitFor({ timeout: 8_000 });
  const approvalText = await page.locator('body').innerText();
  const showsApprover = /审批人|负责人|指定真人/.test(approvalText);
  await click(page.getByRole('button', { name: '确认更新' }), '确认更新');
  await page.getByText(/已交付：任务结果/).first().waitFor({ timeout: 8_000 });
  log('B 交办一项工作', '从空白到交付所需交互次数', clicks <= 6 ? 'PASS' : 'WARN', `${clicks} 次交互，${Math.round((Date.now() - t0) / 1000)}s`);
  log('B 交办一项工作', '高危审批是否显示责任人身份', showsApprover ? 'PASS' : 'FAIL', showsApprover ? '审批卡含责任人字样' : '审批卡未显示具体审批人');

  // ---- 场景 B2：审批是否可拒绝 ----
  const rejectBtns = await page.getByRole('button', { name: /拒绝|驳回|不同意/ }).count();
  log('B 交办一项工作', '审批是否提供拒绝路径', rejectBtns > 0 ? 'PASS' : 'FAIL', `拒绝类按钮数=${rejectBtns}`);

  // ---- 场景 C：刷新后工作是否还在（持久化验收）----
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台' }).waitFor({ timeout: 10_000 });
  const afterReload = await page.locator('body').innerText();
  const sessionSurvived = /华东 12 家重点客户|已交付/.test(afterReload);
  log('C 跨会话持久化', '刷新后昨日/刚才的工作是否还在', sessionSurvived ? 'PASS' : 'FAIL', sessionSurvived ? '会话可见' : '会话消失，浏览器端无事实源');

  // ---- 场景 D：组建项目小队（跨部门项目）----
  await click(page.getByRole('button', { name: /团队协作/ }).first(), '团队协作');
  await page.getByRole('heading', { name: '团队协作' }).waitFor({ timeout: 8_000 });
  await click(page.getByRole('button', { name: '项目小队' }).first(), '项目小队');
  await click(page.getByRole('button', { name: /组建项目小队/ }), '组建项目小队');
  await page.getByRole('heading', { name: '组建项目小队' }).waitFor({ timeout: 8_000 });
  const beforeProjects = await page.getByText('正在推进的项目').count();
  await click(page.getByRole('button', { name: '邀请吴帆' }), '邀请吴帆');
  const twinAutoJoined = await page.getByText('吴帆 + 吴帆分身').count();
  log('D 组建项目小队', '邀请真人时其分身是否自动入队', twinAutoJoined > 0 ? 'PASS' : 'FAIL', `匹配 ${twinAutoJoined} 处`);
  const projectNameInput = await page.getByRole('textbox').count();
  log('D 组建项目小队', '是否可以输入项目名称/目标/截止时间', projectNameInput > 0 ? 'PASS' : 'FAIL', `抽屉内输入框数=${projectNameInput}`);
  await click(page.getByRole('button', { name: '创建小队并进入项目' }), '创建小队');
  await page.waitForTimeout(600);
  const bodyAfterCreate = await page.locator('body').innerText();
  const newProjectVisible = /吴帆/.test(bodyAfterCreate) && !/组建项目小队/.test(bodyAfterCreate.slice(0, 200));
  const projectCount = (bodyAfterCreate.match(/结果责任/g) || []).length;
  log('D 组建项目小队', '创建后是否真的多出一个项目', projectCount > 2 ? 'PASS' : 'FAIL', `项目卡数量=${projectCount}（创建前=2），前置=${beforeProjects}，可见=${newProjectVisible}`);

  // ---- 场景 E：新同事入职 / 公司入驻 ----
  const bodyTeam = await page.locator('body').innerText();
  const hasInviteHuman = (await page.getByRole('button', { name: /邀请同事|添加成员|邀请真人加入|新成员入职|添加真人/ }).count()) > 0;
  log('E 组织管理', '是否有真人同事入职/邀请入口', hasInviteHuman ? 'PASS' : 'FAIL', hasInviteHuman ? '存在' : '团队页只有“添加数字同事”，没有真人入职入口');
  const hasTenantSwitch = await page.getByText(/切换公司|切换租户|工作空间/).count();
  log('E 组织管理', '是否有公司/租户切换（多公司入驻）', hasTenantSwitch > 0 ? 'PASS' : 'FAIL', `匹配=${hasTenantSwitch}`);

  // ---- 场景 F：试用一个数字员工（真实写入组织事实源）----
  await click(page.getByRole('button', { name: '我的团队' }).first(), '我的团队');
  await click(page.getByRole('button', { name: '添加数字同事' }), '添加数字同事');
  await page.getByRole('heading', { name: '添加数字同事' }).waitFor({ timeout: 8_000 });
  await click(page.getByRole('button', { name: '开始 7 天试用' }).first(), '开始试用');
  await page.waitForTimeout(800);
  const hireBody = await page.locator('body').innerText();
  const refused = /没有可写的组织事实源/.test(hireBody);
  log('F 数字员工入职', '浏览器环境是否诚实拒绝伪造组织写入', refused ? 'PASS' : 'WARN', refused ? '明确拒绝，未伪造数据' : '未见拒绝提示');

  // ---- 场景 G：周复盘与训练进化 ----
  await click(page.getByRole('button', { name: /成长与复盘/ }).first(), '成长与复盘');
  await page.getByRole('heading', { name: '成长与复盘' }).waitFor({ timeout: 8_000 });
  await click(page.getByRole('button', { name: '成长', exact: true }).first(), '成长');
  await page.getByText('谁在成长').waitFor({ timeout: 8_000 });
  const growthBody = await page.locator('body').innerText();
  const hasThreeLoops = /我的分身/.test(growthBody) && /数字员工/.test(growthBody) && /团队方法/.test(growthBody);
  log('G 迭代进化', '三条训练闭环是否在界面上分开', hasThreeLoops ? 'PASS' : 'FAIL', '分身/数字员工/团队方法');
  await click(page.getByRole('button', { name: /确认升版与推广范围/ }), '确认升版');
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const afterPromote = await page.locator('body').innerText();
  const promotionPersisted = /已按范围推广/.test(afterPromote);
  log('G 迭代进化', '“升版推广”刷新后是否留下事实', promotionPersisted ? 'PASS' : 'FAIL', promotionPersisted ? '持久化' : '仅 useState，刷新即丢失');

  // ---- 场景 H：连接飞书/企微/微信 ----
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台' }).waitFor({ timeout: 10_000 });
  await click(page.getByRole('button', { name: /能力与连接/ }).first(), '能力与连接');
  await page.waitForTimeout(800);
  const connBody = await page.locator('body').innerText();
  const hasFeishu = /飞书/.test(connBody);
  const hasWework = /企业微信|企微/.test(connBody);
  const hasWechat = /微信/.test(connBody);
  const pending = (connBody.match(/待接入/g) || []).length;
  const verified = (connBody.match(/已验证连接/g) || []).length;
  log('H 渠道接入', '飞书/企微/微信是否出现在连接目录', hasFeishu && hasWework ? 'PASS' : 'FAIL', `飞书=${hasFeishu} 企微=${hasWework} 微信=${hasWechat}`);
  log('H 渠道接入', '目录项是否真的可以配置连接', /配置|授权|连接设置/.test(connBody) ? 'PASS' : 'FAIL', `待接入=${pending} 已验证=${verified}；无配置入口即为纯展示`);

  // ---- 场景 I：引擎选择（客户可选档位）----
  const engineSel = page.getByLabel('选择模型');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台' }).waitFor({ timeout: 10_000 });
  const engineOptions = await page.getByLabel('选择模型').innerText().catch(() => '');
  log('I 引擎档位', '工作台档位选择是否来自引擎配置', /标准|增强|旗舰/.test(engineOptions) ? 'WARN' : 'FAIL', `可见="${engineOptions.replace(/\s+/g, ' ')}"；需核对是否硬编码`);
  void engineSel;

  log('X 控制台', '整场模拟的浏览器控制台错误', errors.length === 0 ? 'PASS' : 'FAIL', errors.slice(0, 3).join(' | ') || '无');
  await browser.close();
} catch (error) {
  log('!! 中断', '模拟脚本异常终止', 'ERROR', String(error).split('\n')[0]);
} finally {
  browserServer?.process()?.kill();
  vite.kill();
}

console.log('\n=== HUMMER 经营管理工作流模拟结果 ===\n');
for (const row of report) console.log(`[${row.verdict}] ${row.scenario} / ${row.step}\n        ${row.note}`);
console.log(`\n总交互次数（场景 B 主流程）: ${clicks}`);
