import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4181';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4181', '--strictPort'], { cwd: process.cwd(), stdio: 'pipe', windowsHide: true });
const report = [];
const log = (s, k, v, n) => report.push(`[${v}] ${s} / ${k}\n        ${n}`);
async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 300)); }
  throw new Error('vite did not start');
}
let bs;
try {
  await waitForServer(baseUrl);
  bs = await chromium.launchServer({ headless: true });
  const browser = await chromium.connect(bs.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.removeItem('hummer-v6'));

  // H 渠道与连接
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台' }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: /能力与连接/ }).first().click();
  await page.waitForTimeout(1000);
  const conn = await page.locator('body').innerText();
  const pending = (conn.match(/待接入/g) || []).length;
  const verified = (conn.match(/已验证连接/g) || []).length;
  log('H 渠道接入', '飞书/企微/微信是否在连接目录', /飞书/.test(conn) && /企业微信|企微/.test(conn) ? 'PASS' : 'FAIL', `飞书=${/飞书/.test(conn)} 企微=${/企业微信|企微/.test(conn)} 微信=${/微信/.test(conn)}；待接入=${pending} 已验证=${verified}`);
  const cfgBtns = await page.getByRole('button', { name: /配置|授权|连接|添加连接|新建连接/ }).count();
  log('H 渠道接入', '是否能自行添加/配置一个连接（MCP/渠道）', cfgBtns > 0 ? 'CHECK' : 'FAIL', `配置类按钮=${cfgBtns}`);
  const inboundKeywords = /消息触发|群消息|机器人|收到消息|入站|webhook|回调/i;
  log('H 渠道接入', '是否有“从飞书/企微消息触发工作”的入站概念', inboundKeywords.test(conn) ? 'PASS' : 'FAIL', '入站触发关键词未出现即表示只有出站/展示');

  // I 引擎档位
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台' }).waitFor({ timeout: 15_000 });
  const sel = page.getByLabel('选择模型');
  const opts = await sel.locator('option').allInnerTexts().catch(() => []);
  log('I 引擎档位', '客户可见档位列表', 'INFO', `选项=${JSON.stringify(opts)}`);
  const body = await page.locator('body').innerText();
  log('I 引擎档位', '是否展示数据出境域/可用性', /境内|数据域|不可用|中国大陆|海外/.test(body) ? 'PASS' : 'FAIL', '未展示 dataDomain / available 即无法支撑合规采购');
  log('I 引擎档位', '是否暴露引擎真实身份（审计可见）', /DeepSeek|智谱|Codex|Claude/.test(body) ? 'PASS' : 'FAIL', '工作台正文匹配');

  // J 桌面操作与工具调用
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '工作台' }).waitFor({ timeout: 15_000 });
  await page.getByRole('textbox', { name: '任务描述' }).fill('打开本机 Excel，把上月销售明细汇总成部门月报并发到销售群');
  await page.getByRole('textbox', { name: '任务描述' }).press('Enter');
  await page.waitForTimeout(1500);
  const plan = await page.locator('body').innerText();
  log('J 桌面/工具能力', '是否能识别“打开本机应用”的桌面任务', /桌面|本机|应用|Excel/.test(plan) ? 'CHECK' : 'FAIL', plan.slice(plan.indexOf('我理解你要做的是'), plan.indexOf('我理解你要做的是') + 220).replace(/\s+/g, ' '));

  log('X 控制台', '浏览器控制台错误', errors.length === 0 ? 'PASS' : 'FAIL', errors.slice(0, 3).join(' | ') || '无');
  await browser.close();
} catch (e) {
  log('!!', '中断', 'ERROR', String(e).split('\n')[0]);
} finally { bs?.process()?.kill(); vite.kill(); }
console.log('\n=== 第二轮模拟 ===\n' + report.join('\n'));
