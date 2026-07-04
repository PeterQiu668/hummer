# MCP 连接（connect）
> 源码：`src/components/pages/MCPAppsPage.tsx` · `src/store/useAppStore.ts`（mcpApps / toggleMCP / upsertMCP / defaultMCPApps）· 状态：**部分闭环**（连接/断开真实写 store + 审计并持久化；配置、日志、刷新、新增均为纯展示）

## 1. 定位与对应闭环

MCP 连接页承载「企业系统接入」叙事：数字员工不直接持有凭证，而是通过 MCP Server 调用企业系统工具（CRM / ERP / IM / 数据库…），平台统一托管凭证。对应 PRD 中「Agent 通过 MCP 使用企业工具，权限与凭证集中治理」的基础设施层。

原型内跑通的闭环：查看 12 个应用目录 → 点「连接 / 断开」→ `mcpApps[id].connected` 翻转 → store 内部写一条审计（tags `mcp:{id}`）→ 页面 toast → 状态持久化到 localStorage。断开某应用后，其工具清单仍然展示，但没有任何下游模块真正消费 `connected` 状态。

## 2. 入口与角色可见性

| 角色 | 左侧导航 | 说明 |
|------|---------|------|
| boss | ✅「员工」分组 →「MCP 连接」（badge 12） | 唯一常规入口 |
| exec | ❌ | 无导航入口 |
| staff | ❌ | 无导航入口 |
| expert | ❌ | 无导航入口 |
| auditor | ❌ | 无导航入口 |

补充入口：命令面板（Cmd+K）`p-connect`「MCP 应用」，不做角色过滤，任何角色可打开。导航 badge「12」与目录数量一致（这是少数 badge 与数据吻合的页面）。

页面本身无任何按角色分支的渲染逻辑——非 boss 角色经 Cmd+K 进入后看到与老板完全相同的页面，且可执行连接/断开（审计 actor 仍硬编码 `昆仑（您）`）。

## 3. 界面结构

`WorkspacePage` 布局：

1. **标题区**：`MCP 应用` · 副标题动态拼接 `{connected} / {apps.length} 个企业系统已连接 · Agent 通过 MCP 调用工具，凭证统一托管`；actions：「全部刷新」「添加 MCP Server」（均无 onClick）。
2. **sticky 工具条**：搜索框（按 `name` / `kind` 匹配）+ `{N} 已连接`（绿色 chip）+ `{M} 未连接`（灰色 chip）。
3. **应用卡片网格**（1/2/3 列）：每张卡包含
   - emoji 图标（`APP_ICONS`，兜底 🔌）+ 名称 + kind + 连接状态 chip（已连接时圆点带 `hum-pulse` 动画）；
   - 状态行：已连接显示 `最近同步：{syncedAt}`；未连接显示「点击 「连接」 完成 OAuth 授权」（纯文案，无真实 OAuth）；
   - 工具清单：`APP_TOOLS[a.id]` 前 4 个 code chip + `+N`；
   - 操作条：「配置」（打开详情抽屉）、「日志」（无 onClick）、「连接 / 断开」（右对齐，断开为 is-danger 红色样式）。
4. **配置详情抽屉**（`MCPDetail`，右侧 440px 绝对定位面板）：
   - 权限范围：读取数据 / 写入数据 / 触发自动化 三个 checkbox（`defaultChecked`，非受控，勾选不写任何 state）；
   - 「暴露给 Agent 的工具（N）」列表：每个工具一行，右侧恒为「启用」chip（静态）。

### 12 个应用目录与工具清单（`defaultMCPApps` + `APP_TOOLS`）

| id | 名称 | kind | 默认状态 | 工具 |
|----|------|------|---------|------|
| feishu | 飞书 | IM 协同 | ✅ 已连接（2 分钟前） | feishu.docs.read / feishu.docs.write / feishu.approval.create / feishu.calendar.read |
| wework | 企业微信 | IM 协同 | ✅（7 分钟前） | wework.message.send / wework.contact.read |
| wechat | 个人微信 | IM 协同 | ❌ | wechat.message.send / wechat.contact.read |
| notion | Notion | 知识协同 | ✅（1 小时前） | notion.page.read / notion.page.write / notion.search |
| github | GitHub | 研发协同 | ✅（12 分钟前） | gitlab.repo.read / gitlab.repo.write / gitlab.pr.create（注意：GitHub 应用挂的是 gitlab.* 工具名，数据不一致） |
| gdrive | Google Drive | 文件存储 | ❌ | drive.file.read / drive.file.write |
| slack | Slack | IM 协同 | ❌ | slack.message.send / slack.channel.list |
| postgres | PostgreSQL | 数据库 | ✅（3 分钟前） | db.query / db.write |
| salesforce | Salesforce | CRM | ✅（24 分钟前） | crm.contact.search / crm.opportunity.update |
| mail | 企业邮箱 | 通讯 | ✅（5 分钟前） | mail.send / mail.read |
| chrome | Chrome 浏览器 | 执行 | ❌ | browser.navigate / browser.click / browser.read |
| kingdee | 金蝶 ERP | 企业系统 | ✅（38 分钟前） | erp.kingdee.queryBalance / erp.kingdee.transfer |

默认 8 已连接 / 4 未连接。

## 4. 操作步骤与逻辑

### 4.1 搜索
- **前置条件**：无。
- **操作**：输入关键字。
- **状态变化**：本地 `q: string`；`apps = Object.values(mcpApps).filter(name/kind includes q)`（每次渲染即时过滤，非 memo）。
- **副作用**：无。

### 4.2 连接应用
- **前置条件**：`a.connected === false`（按钮显示「🔌 连接」，is-primary 蓝色）。
- **操作**：点击「连接」。
- **状态变化**（store `toggleMCP(id)`，单次 set 内完成）：
  - `mcpApps[id].connected = true`，`syncedAt = '刚刚'`；
  - 同一 set 内构造 `AuditEntry` 插入 `auditLog` 队首（截断 500）。
- **副作用**：
  - 审计：`{ actor: '昆仑（您）', action: '连接 MCP 应用', target: a.name, result: 'ok', tags: ['mcp:{id}'] }`（写在 store 内部，非页面调用 pushAudit）；
  - 页面层 `pushToast({ kind: 'success', title: '{name} 已连接', detail: '{N} 个工具可被 Agent 调用' })`。
- **分支**：无 OAuth 流程、无失败态；`toggleMCP` 对未知 id 返回原 state。

### 4.3 断开应用
- **前置条件**：`a.connected === true`（按钮显示「断开」，is-danger 红色）。
- **操作**：点击「断开」。
- **状态变化**：`mcpApps[id].connected = false`；`syncedAt` 保留旧值（store 逻辑 `syncedAt: !cur.connected ? '刚刚' : cur.syncedAt`，断开分支保持不变）。
- **副作用**：
  - 审计：action `'断开 MCP 应用'`，result `'ok'`，tags `['mcp:{id}']`；
  - `pushToast({ kind: 'info', title: '{name} 已断开' })`（无 detail）。
- **分支**：无确认弹窗；断开后工具清单照常显示。

### 4.4 打开 / 关闭配置抽屉
- **前置条件**：无（连接与否均可打开）。
- **操作**：点「配置」；点抽屉 `×` 关闭。
- **状态变化**：本地 `detail: string | null`（存 app id）。
- **副作用**：无。抽屉内 checkbox 为非受控 `defaultChecked`（「触发自动化」默认不勾），勾选不写 store、不写审计、关闭即丢弃。

### 4.5 纯展示按钮
「全部刷新」「添加 MCP Server」「日志」均无 onClick。`upsertMCP` action 在 store 中定义但**无任何 UI 调用方**（预留的新增接口）。

### 4.6 store action 语义细节（toggleMCP 单事务）

```
toggleMCP(id):
  cur = state.mcpApps[id]；不存在 → 返回原 state（no-op）
  next = { ...cur, connected: !cur.connected,
           syncedAt: 连接时 → '刚刚'；断开时 → 保留原值 }
  auditEntry = { id: au-{now}, ts: HH:MM:SS, actor: '昆仑（您）',
                 action: '连接/断开 MCP 应用', target: cur.name,
                 result: 'ok', hash: makeHash(), tags: ['mcp:{id}'] }
  返回 { mcpApps 更新, auditLog: [auditEntry, ...旧].slice(0, 500) }
```

要点：状态翻转与审计写入在**同一次 set** 内完成（不可能出现改了状态没留痕）；页面的 toast 在 store 更新之后同步触发，toast 文案读取的是**点击前的** `a.connected`（闭包捕获），因此文案与新状态恰好互补（点「连接」→ toast「已连接」）。

### 4.7 边界行为
- 搜索过滤后计数 chip（已连接/未连接）基于**过滤后的** `apps`，非全量——搜索「飞书」时显示「1 已连接 / 0 未连接」。
- 详情抽屉打开期间点击卡片「连接/断开」，抽屉内容（读同一 `mcpApps[detail]`）会同步刷新连接状态文案。
- 快速连点「连接」按钮：两次 `toggleMCP` 顺序执行，最终回到原状态，但审计链会留下「连接 + 断开」两条记录（append-only 语义正确）。

## 5. 数据与状态

- **store 字段与 action**：

| 字段 / action | 说明 |
|--------------|------|
| `mcpApps: Record<string, MCPApp>` | `MCPApp = { id, name, kind, connected, syncedAt? }`；初始 `defaultMCPApps`（12 项，定义在 useAppStore.ts） |
| `toggleMCP(id)` | 翻转 connected + 写审计（见 §4.6），单事务 |
| `upsertMCP(app)` | 整对象覆盖插入，**无 UI 调用方**，不写审计 |
- **工具清单与图标不在 store**：`APP_ICONS` / `APP_TOOLS` 是 MCPAppsPage 内的模块级常量，按 id 关联；意味着新 upsert 的应用不会有工具清单（兜底空数组）。
- **持久化**：`mcpApps` 在 `partialize` 白名单内（key `hummer-v6`），连接状态跨刷新保留。注意：由于持久化会覆盖内存初始值，**修改 `defaultMCPApps` 后老用户看不到变化**（persist 版本仍为 1，无 migrate）。
- **本地 state**：`q / detail`。
- **派生值**：`connected` 计数、副标题、chip 计数均由 `apps` 即时派生。

## 6. 模块联动

- **审计链（audit）**：连接/断开写审计（tags `mcp:{id}`）。此外 mock runtime 与静态数据大量使用 `mcp:*` 风格 tag（如 `mcp:crm.salesforce`、`mcp:bi.warehouse`），在审计页可按 tag 筛选，但这些 tag 与本页应用 id 命名并不完全对齐（`mcp:salesforce` vs `mcp:crm.salesforce`）。
- **治理舱（governance）**：GovernanceCabin「MCP Servers · 企业接入」卡片展示 9 个 MCP server（`crm.salesforce`、`erp.kingdee` 等），为**独立静态数组**，与本页 `mcpApps` 及其连接状态无关。
- **技能库（skills）**：技能详情的 `permissionScope`（如 `crm.salesforce:read`）在叙事上指向 MCP 工具，但无代码级关联。
- **命令面板**：`p-connect` 直达。

## 7. Mock 边界与已知限制

1. **连接是布尔开关**：无 OAuth、无凭证录入、无健康检查；「点击连接完成 OAuth 授权」仅是文案。
2. **connected 状态无消费方**：断开金蝶 ERP 后，mock runtime 依旧推送 `erp.kingdee` 相关审计，员工工作不受影响。
3. **配置抽屉是假的**：权限 checkbox 非受控、工具启用状态硬编码「启用」。
4. **数据不一致**：github 应用挂 gitlab.* 工具；治理舱 MCP 列表与本页目录是两套数据；审计 tag 命名不统一。
5. **「全部刷新 / 添加 MCP Server / 日志」为空壳**；`upsertMCP` 无调用方。
6. **审计 actor 硬编码** `昆仑（您）`，不随 `currentRole` 变化。
7. `syncedAt` 只有「刚刚」和种子文案两种值，无真实时间推进。
