# HUMMER V4 全面验收报告与实战开发方案

> 日期：2026-08-28
> 验收对象：当前 main（工作台 + RuntimeAdapter 缝）
> 验收方式：源码审查 + `npm run typecheck` + `npm test` 实跑 + 依赖与编译范围核查
> 关联：`2026-08-hummer-v4-rectification-brief.md`、`docs/architecture/runtime-adapter.md`

---

## 0. 一句话结论

> 前端和 RuntimeAdapter 缝做得扎实，**可以定版**。
> 但**底座是 0，桌面 App 是 0**，且有三处「看起来做了、实际没接」会导致进度误判。

当前资产 = 一个很好的可演示原型 + 一份正确的架构契约。
距离实战差的不是打磨，是**一整个运行时工程**。

---

## 1. 实跑结果

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | exit 0 ✅（但见 §2.1，这是假绿） |
| `npm test` | 14 个测试文件 / 48 个用例全过 ✅ |
| 服务端依赖 | **无**。`package.json` 中无 express / fastify / nest / ws |
| 桌面端依赖 | **无**。无 electron / tauri |
| 数据库 | **无**。无迁移、无 ORM、无 SQLite |

---

## 2. 三处「假绿」——必须最先处理

### 2.1 typecheck 从没检查过 apps/api

`tsconfig.app.json` 是 `"include": ["src"]`。而 `apps/api/**`（4 个模块，约 52KB）**不在任何 tsconfig 的编译范围内**。

它只被 `vitest.config.ts` 的 `include: ['apps/api/**/*.test.ts']` 用 esbuild 转译执行过——**esbuild 不做类型检查**。

> 后果：`npm run typecheck` exit 0 是一个**没有覆盖后端代码的绿灯**。任何人看到它都会高估完成度。

### 2.2 `window.hummerCodexCliHost` 是死链

`src/features/sessions/runtime/runtimeFactory.ts`：

```ts
if (requested === 'codex' && typeof window !== 'undefined' && window.hummerCodexCliHost) {
```

**全仓库没有任何一行代码 set 过 `window.hummerCodexCliHost`。**
`CodexCliHost` 是一个接口，**零实现**。

`codexRuntimeAdapter.ts:165` 自己写得很清楚：

> `No desktop CodexCliHost bridge is installed; browser JavaScript cannot spawn codex.exe directly`

> 后果：无论环境变量怎么配，**永远走 Mock**。Codex 接入当前完成度 = 接口 100%，可运行 0%。

### 2.3 约 20 个组件已成孤儿

以下文件 `imported_by = 0`，已从 `AppShell` 卸载但仍留在仓库：

```
TasksPage  ChatPage  ExecWorkspacePage  StaffWorkspacePage  RoiPage
SkillsPage  AuditPage  KnowledgeHubPage  DesktopWorkstationPage
InboxPage  ExpertPortalPage  EvolutionCenterPage
GovernanceCabin  EvolutionFlywheel  MeetingRoom  KnowledgeGraph
LobsterLab  ExecutiveDetail  EmployeeDrawer  SkillSlotIn
```

`packages/contracts`（1.9KB）没有 `package.json`、不是 workspace、无人 import。
`apps/api/**` 同样无人 import。

> 后果：仓库里三块代码是**装饰性资产**。不清理，下一个人无法判断什么是活的。

---

## 3. 四个能力维度逐项验收

### 3.1 AI 原生组织的人机协同团队管理 —— 约 40%

**已具备：**

- 4 项导航（工作台 / 团队协作 / 能力与连接 / 成长与复盘），信息架构收敛到位
- 工作台五拍完整：Composer → PlanCard → trajectory → 产物 → 验收
- `EmployeesPage` 的 `HireDrawer` 实现了三步雇人，符合 V4 §5
- **`adapter.ts:18` 人和 AI 共用同一套事件 schema，只靠 `actorRef` 区分** —— 这条是真差异化，Codex/WorkBuddy 都没做透，务必保留

**缺失：**

- `humanColleagues` / `departments` 是 `EmployeesPage` 里的硬编码常量，不是领域对象
- 无身份、无租户、无权限。`tenants` 是 `LeftNav` 里的 3 个字符串
- 责任链（真人 → 分身 → 数字员工）在 UI 上有表达，**在数据上不存在**
- 雇佣后的员工只存在于 `useState(hiredIds)`，刷新即消失

### 3.2 Hermes 级进化 —— 约 15%

**已具备：**

- `forkFromCheckpoint` 有模型实现和测试
- 「成长与复盘」页 4 个 tab 的 UI 壳（成果 / 质量 / 成长 / 组织知识）

**缺失：**

- **零领域对象**：没有 `BadCase`、`Evaluation`、`MemoryCandidate`、`SkillVersion`、`SopRevision`
- 「打回 → 坏例 → 根因 → 改 SOP → 回归 → 灰度 → 复测」整条链**没有任何一环落数据**
- `EvolutionFlywheel.tsx` 已卸载成孤儿
- 记忆候选（Hermes 的核心机制）完全没有实现

### 3.3 Codex / DeepSeek Harness / WorkBuddy 桌面操控 —— 约 25%，且全在纸上

**已具备（质量很高）：**

- `adapter.ts` 事件设计正确：单调 `sequence`、`approval_required` 作为一等事件而非异常、工具事件带 `tool/args/result/durationMs/costCny/evidenceRefs`
- `codexRuntimeAdapter.ts` 覆盖真实 Codex 事件：`thread.started` / `turn.started` / `item.completed`（`agent_message`、`command_execution`、`mcp_tool_call`、`file_change`）/ `turn.completed` / `turn.failed`
- **诚实标注**了 `exec --json` 无法回传交互式审批、必须走 `app-server` JSON-RPC
- `runtime-adapter.md` §11 如实列出 6 项未完成，包括本机 `codex.exe` 被 WindowsApps `Access is denied` 阻断
- 映射表标注了未覆盖字段（token usage → CNY 未映射，且明确写「不得直接猜价」）

> 这份诚实是可以往下走的基础。没有伪造事件，没有假装连通。

**缺失：**

- **`CodexCliHost` 零实现** → 无宿主进程 → 浏览器里跑不起来
- DeepSeek Harness、WorkBuddy 只在文档里，**无一行代码**
- **一个倒退**：导航里原本的「机器 / 执行节点」被换成了「能力与连接」。**现在整个 UI 没有任何地方代表本地执行节点** —— 桌面能力连入口都消失了，与「桌面操控更强大」的目标相反

### 3.4 后端 + 可下载桌面 App —— 约 5%

**缺失（几乎全部）：**

- `apps/api/**` 有 4 个模块，但**没有 HTTP server、没有入口文件、没有 `package.json`**，且不被编译
- 无数据库、无迁移、无 auth、无 API 层
- 无 Electron / Tauri，**不存在任何可下载的客户端**
- `e2e-smoke.mjs` 是唯一的脚本，不覆盖运行时

---

## 4. 三个架构决策（开工前必须定）

### 决策 1：桌面 App 是主形态，Web 是次形态

**理由：** Codex CLI 必须由本地进程 spawn，浏览器 JS 做不到（`codexRuntimeAdapter.ts:165` 已经写明）。

> **HUMMER Desktop 不是「可选的下载版」，而是唯一能真跑的形态。**
> Web 版退化为只读看板 / 审批入口。

这与 Codex App 和 WorkBuddy 的形态一致，也符合用户「要像它们那样有个 App 下载到本地」的要求。

### 决策 2：Electron，不是 Tauri

| 维度 | Electron | Tauri |
|---|---|---|
| 团队现有技术栈 | React + TS 直接复用 | 需要 Rust |
| EasyClaw 可参考性 | **EasyClaw 就是 Electron + React + TS**，安装器和环境检测可直接借鉴 | 无对应参考 |
| `child_process` 生态 | 成熟，spawn codex / MCP / Playwright 都顺 | 需 Rust 侧封装 |
| 包体积 | 大（~150MB+） | 小 |
| 人力成本 | 低 | 高 |

**结论：选 Electron。** 人力有限时，包体积是可以接受的代价；引入 Rust 不是。

> 重新评估的触发条件：客户明确要求单文件 < 30MB，或需要信创环境深度适配。

### 决策 3：Phase 1 后端跑在 Electron 主进程里，不做云

**理由：** ICP 是 50-1000 人成长型企业、2-4 周试点（见市场分析 §4.2）。这个阶段不需要多租户云，需要的是**能在客户电脑上今天就跑起来**。

```
Electron 主进程
  ├─ SQLite（事实源：事件账本、WorkOrder、员工、坏例）
  ├─ CodexCliHost（spawn codex app-server，JSON-RPC 桥）
  ├─ MCP client
  └─ 本地 HTTP / IPC → renderer（现有 React 前端零改动）
```

省掉 auth / RLS / 部署 / 运维整套工作。**等有第二个客户、或客户要求集中管控时，再把 SQLite 换 PostgreSQL、把主进程逻辑抽成服务。** 因为事实源是事件账本，这个迁移是可控的。

> 这条同时决定了 `apps/api/**` 的命运：**扶正为 Electron 主进程的业务模块，或删除。不能继续当装饰。**

---

## 5. 开发方案

### M0 · 止血与对齐（0.5 周）

| 交付物 |
|---|
| `tsconfig` 增加 `apps` 与 `packages` 的 project reference，让 `typecheck` 真正覆盖 |
| `packages/contracts` 补 `package.json`，配 npm workspaces，成为真 workspace |
| 删除 §2.3 列出的全部孤儿组件（保留 git 历史即可，不要注释掉） |
| 导航恢复第 5 项「执行节点」，或在工作台顶部常驻节点状态条 |

**验收：** `npm run typecheck` 覆盖 `src` + `apps` + `packages` 且为 0；`git grep` 不到孤儿组件。

---

### M1 · 桌面宿主 + Codex 真跑通（2 周）★ 关键路径

**这是整个项目唯一的技术风险点。做不通，产品定位要改。**

先做一个**一周 spike**，不通就停：

1. 解决 `codex.exe` 的 `Access is denied` —— 改用 `npm i -g @openai/codex` 安装，不用 Microsoft Store 版
2. 起最小 Electron 骨架，主进程 `spawn` codex
3. 实现 `CodexCliHost`：把 stdout 的 JSONL 逐行转发到 renderer，`contextBridge` 挂到 `window.hummerCodexCliHost`
4. 接上**现有的** `CodexRuntimeAdapter`（一行不改），跑通「读一个真实文件 → 出一段摘要」

spike 通过后，剩余一周做 `app-server` JSON-RPC 路径：thread/turn 生命周期、交互式审批回传、steer 插话、interrupt 停止。

**验收：**
- 在真实文件夹里执行一次真任务，trajectory 里出现真实的 `command_execution` 和 `file_change`
- 触发一次真实审批中断，在 HUMMER UI 里点「批准」，Codex 继续执行
- 拔掉 Codex，UI 自动回落 Mock 且明确提示

---

### M2 · 本地事实源（2 周）

| 交付物 |
|---|
| SQLite + 迁移：`work_orders` `domain_events` `sessions` `steps` `approvals` `evidence` `result_packages` |
| `domain_events` 为 append-only + hash chain（前一条 hash 参与后一条计算） |
| RuntimeEvent 落库后再投影到 UI，**刷新不丢** |
| 证据内容寻址：文件产物存本地 blob，记 SHA-256 |

**验收：** 关掉 App 再打开，昨天的会话、轨迹、审批记录、成果包全在；篡改任一 event 行，完整性校验能报出来。

---

### M3 · 组织与责任链（3 周）

| 交付物 |
|---|
| 领域对象落库：`HumanUser` `DigitalTwin` `DigitalEmployee` `Department` |
| 雇佣写库，不再是 `useState`；员工在团队页、工作台派活、审计中引用同一 ID |
| 审批策略引擎（先用规则表，不上 OpenFGA）：高危动作清单 + 审批人 + 预算上限 |
| 能力与连接页接真实 MCP client，至少 1 个真连接器跑通 |
| 恢复「执行节点」页：节点健康、当前会话、权限范围、kill switch |

**验收：** 雇一个员工 → 派一张真任务 → 命中策略停下来 → 指定审批人批准 → 成果包落库，全链路同一 ID 可追。

---

### M4 · 进化闭环（2 周）

| 交付物 |
|---|
| 领域对象：`BadCase` `SopRevision` `Evaluation` `MemoryCandidate` |
| 领域对象：`Project` `ProjectMembership` `WorkerAssignment`；真人 + 个人分身是责任搭档 |
| 项目组队：邀请真人时可同步其分身；数字员工只能作为助手/临时专家，权限随项目结束 |
| 验收驳回 → 自动建 `BadCase`，带 trajectory 引用 |
| 改 SOP → `forkFromCheckpoint` 复跑 → 两条分支结果 diff |
| 复跑通过 → SOP 升版 → 真人选择仅当前员工 / 项目 / 部门 / 组织的推广范围 |
| 任务结束一个「记住这个」按钮 → `MemoryCandidate`（Hermes 机制，但只做最简版） |

**验收：** 组建含两组真人-分身责任搭档与一位临时数字助手的项目 → 打回一次 → 改一行 SOP → 从真实检查点复跑 → 结果不同 → 人工选择推广范围 → 版本入库 → 成长页能回溯到坏例、两次运行和责任人。详细规则见 `docs/product/2026-08-human-twin-project-collaboration.md`。

---

### M5 · 打包与分发（1.5 周）

| 交付物 |
|---|
| Electron 打包（Windows 优先，`electron-builder`） |
| 安装器参考 EasyClaw：环境检测（Node / codex CLI）、缺失时引导安装、健康检查 |
| 首次启动 onboarding：选工作目录 → 授权范围 → 跑通一个示例任务 |
| `THIRD_PARTY_NOTICES` 与 LICENSE 补齐（见 `runtime-adapter.md` §10） |

**验收：** 一台干净的 Windows 机器，双击安装包，10 分钟内跑完第一个真任务。

---

### 总工期

**约 11 周**（含 M1 的 1 周 spike）。M1 不通则整体重估。

关键路径：**M0 → M1 spike → M1 → M2 → M3 → M4 → M5**，其中 M1 必须最先做完。

---

## 6. 不做什么（同样重要）

- **不做云端多租户**（等第二个客户）
- **不引 Temporal / OpenFGA / Kubernetes**（M3 的规则表足够）
- **不接 DeepSeek Harness**（developer preview，等 M1 通了、有第二个 runtime 需求再说）
- **不做 3D 公司全景**（已卸载，就让它留在历史里）
- **不补 20 个孤儿页面**（删掉）

人力有限时，**只押 M1 和 M3**：一个证明「真的能在我电脑上干活」，一个证明「企业敢把权限交出去」。其余都可以晚。
