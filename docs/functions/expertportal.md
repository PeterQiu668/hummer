# 专家门户（expertportal）
> 源码：src/components/pages/ExpertPortalPage.tsx · src/components/expert/{TicketBoard,SopStudio,RevenuePanel,ReputationPanel}.tsx · src/data/expertops.ts · 状态：有交互闭环（工单两阶段接单闭环 + SOP 上架闭环可完整走通；收入/声誉为纯展示）

## 1. 定位与对应闭环

专家门户是「外部入驻专家（林知远）」视角的独立工作台，承载 Phase 0 PRD 中的**专家生态闭环**与 grills/02 的**两阶段接单决策（决策②）**：

- **介入闭环**：Agent 出 bad case → 系统按保障协议派单 → 专家先见脱敏摘要 → 签临时保密与责任协议解锁完整上下文 → 处置 → 关单撤销访问权、结论通报协作频道并写审计链。
- **共创闭环**：专家编辑 SOP 草稿 → 沙箱试跑（200 条历史样本 mock）→ 达标 → 提交签名认证 → 平台复核后上架员工市场。
- **激励闭环**：上架数字员工被企业订阅 → 按声誉等级分成（12/15/18%）→ 三项质量指标反算声誉等级 → 反过来影响分成与曝光。

## 2. 入口与角色可见性

- 页面 key：`expertportal`（AppShell 中 `activePage === 'expertportal'` 渲染）。
- **expert 角色**：TopBar 角色切换到「林知远·入驻专家」时自动跳转本页（ROLES 中 expert 的 `home: 'expertportal'`）；LeftNav `ROLE_SECTIONS.expert` 仅两组：「专家 → 专家门户」+「市场 → 员工市场」。
- 其他四个角色（boss/exec/staff/auditor）的导航中**均无本页入口**，也不在 CommandPalette 的 PAGES 列表中。
- 页面头部身份固定取 `experts.find(id === 'ex-lin')`（模块级常量 `me`），不随登录态变化。

## 3. 界面结构

- **头部**（白底贴顶）：专家头像 + 「林知远 · 专家门户」+ 写死的「银牌专家」chip + 简介（共创 N 位数字员工 / 从业年限 / SLA 生效中）。
- **4 个 Tab**（本地 state `tab`，默认 `tickets`）：
  1. 介入工单 TicketBoard —— 「介入工单」tab 标签上追加未解决数角标 `openCount`（`expertTickets.filter(status !== 'resolved').length`，来自 store，跨 tab 实时）。
  2. 共创工作台 SopStudio —— 左侧 SOP 资产列表 + 右侧步骤编辑器 / 沙箱 / 评测结果卡。
  3. 收入与分成 RevenuePanel —— 本月大数字 + 6 个月条形图 + 分成明细表 + 结算说明。
  4. 声誉等级 ReputationPanel —— 等级卡 + 三指标卡 + 等级规则表。

## 4. 操作步骤与逻辑

### 4.1 工单 seed 注入（自动）

- 前置：进入 TicketBoard（tickets tab 挂载）。
- 逻辑：`useEffect` 检查 `useAppStore.getState().expertTickets.length === 0` 才注入（防 StrictMode 重复）；`seedExpertTickets()` **基于当前时间**生成 4 条工单（et-1 高危 1.2h 前 / et-2 中危 2h 前 / et-3 高危 6h 前 / et-4 已解决 20h 前），倒序逐条 `pushExpertTicket`（头插，倒序保持顺序）。
- 状态变化：`store.expertTickets` 从 [] 变为 4 条。注意 `expertTickets` **不在 persist partialize 内**，刷新即重置——保证 SLA 倒计时演示稳定。
- SLA 倒计时靠订阅 `store.tick`（5s 一跳）强制重渲染，`remainingMs = createdAt + slaHours*3600_000 - Date.now()`；et-3 创建于 6h 前而 SLA 4h，天然呈现「SLA 超时」红色态。

### 4.2 两阶段接单（决策②核心链路）

**阶段一 · 脱敏摘要（status = 'open'）**
- 工单卡只展示 `ticketContextExt[t.id]` 的脱敏侧字段：
  - `errorType`（错误类型）、`sopRef`（涉及 SOP）、`impact`（影响面数字）——数据注释明确「接单前即可见」；
  - `clientMasked`（如「客户 K***（华东 A 级）」）、`detailMasked`（如「错误报价金额 **w · 折扣 *%」）；
  - 下方带 Lock 图标提示「脱敏摘要 · 接单后可见完整上下文（客户与业务细节已打码）」。
- 上下文切片区块此阶段完全不渲染（不是隐藏，是不进 DOM）。

**动作：点「开始响应」**
- 状态变化：仅本地 state `setNdaTicket(t)`，弹出「签署临时保密与责任协议」确认层（三条款：仅见工单相关切片、操作全程写审计链、关单自动退群并撤销访问权）。点遮罩或「取消」→ `setNdaTicket(null)`，无任何副作用。

**动作：点「同意并开始响应」→ `signAndStart(t)`**
- 状态变化：`updateExpertTicket(t.id, { status: 'responding', timeline: [...追加「已签署临时保密与责任协议，接单并解锁工单上下文切片」] })`；`setNdaTicket(null)`。
- 副作用：`pushAudit`（actor「林知远（专家）」，action「签署临时保密与责任协议 · 接单开始响应」，tags 含 `expert-nda`）+ `pushToast`（info「已接单」）。

**阶段二 · 完整上下文（status = 'responding'）**
- 解锁条件是渲染层判断 `unlocked = t.status === 'responding'`（无独立授权字段，权限即状态）。
- 脱敏 chip 原位换成 `clientFull`（如「鲲鹏制造（华东 A 级）」）/ `detailFull`（如「错误报价金额 42w（应为 46w）· 折扣 8%」）。
- 新渲染「上下文切片」卡：`ext.contextSlices`（3–4 条 ts/sender/text 结构的频道消息摘录），头部标注来源频道 `ext.sliceChannel` 与「切片范围：工单创建时点起」，尾注「仅可见与本工单相关的消息切片 · 关单后访问权自动撤销」。
- 四条工单的切片内容还原了各自事故链（治理舱检测 → 冻结/兜底 → Hermes 归因），是理解 bad case 上下文的主要载体。

### 4.3 关单与撤销

**动作：点「填写处置结论并关闭」**
- 状态变化：本地 `closingId = t.id`、`note = ''`，展开 textarea。

**动作：点「提交结论并关闭工单」→ `closeTicket(t)`**
- 前置校验：`note.trim()` 为空 → 只 `pushToast`（warning「请先填写处置结论」）并 return，不改任何状态。
- 状态变化：`updateExpertTicket(t.id, { status: 'resolved', timeline 追加「处置结论：…」 })`；本地 `closingId = null`、`note = ''`。
- 副作用（四连）：
  1. `pushCollabMessage` → 频道路由 `ticketChannels[t.id] ?? 'ch-q3'`（et-3 走 ch-risk），sender「林知远（专家）」senderRole `expert`，内容「[专家处置通报] Agent · 标题 — 结论」——跨模块出现在对话流。
  2. `pushAudit`「关闭介入工单」（tags: expert/sla/resolve）。
  3. `pushAudit`（actor「系统」）「关单撤销专家上下文访问权 · 处置记录归档」（tags: access-revoked）——撤销动作单独留痕。
  4. `pushToast`（success「工单已关闭」）。
- 撤销效果：status 变 resolved → `unlocked` 为 false → 完整信息与上下文切片**立即重新脱敏/隐藏**，卡片改显「访问权已撤销 · 处置记录已归档」chip 与「关单后信息已重新脱敏」提示。
- 顶部三张统计卡随动：开放工单数、SLA 达标率 = (resolved 或未超时) / 总数；「平均响应时长 32 分钟」为写死文案。

### 4.4 SOP 共创：草稿 → 沙箱 → 认证 → 上架（SopStudio）

数据源为 `sopAssets`（5 条，覆盖四种状态的完整谱系）：

| 资产 | 版本 | 状态 | 在雇 |
|---|---|---|---|
| 组织健康度诊断 SOP | v2.3 | listed | 286 |
| 季度战略复盘 SOP | v3.1 | listed | 612 |
| 校招面试评估 SOP | v1.4 | review | 0 |
| 干部梯队盘点 SOP | v0.9 | sandbox | 0 |
| 新组织架构落地检查清单 | v0.3 | draft | 0 |

**全部存组件本地 state `assets`**，不进 store、不持久化，切 tab 即重置。左列底部有静态流转说明「草稿 → 沙箱试跑 → 签名认证 → 上架分成」。

- **选择资产**：点左列卡片 → `selectedId`；`editable = status ∈ {draft, sandbox}`。
- **编辑步骤**（仅 editable）：改 input → `updateStep(idx, text)`；「添加步骤」追加模板文案；垃圾桶删除。均为对 `assets` 的不可变 patch。review 态显示「认证复核中，步骤已锁定」，listed 态显示「已上架版本步骤只读 · 修订请创建新版本」。
- **沙箱试跑** `runSandbox()`：
  - 前置：`running === false`。置 `running=true, progress=0`，清掉该资产旧结果；100ms interval 按 2 秒线性推进进度条（文案「回放 200 条历史任务样本」）。
  - 2s 后 `runSandboxMock()` 随机出分：通过率 89–97%、政策遵守 96–100%、单任务成本 ¥0.8–1.7；`qualified = passRate ≥ 90 && policy ≥ 97`（PASS_THRESHOLD/POLICY_THRESHOLD 常量）→ 写入本地 `results[id]`。
  - 状态迁移：若资产是 draft → 自动升为 `sandbox`。
  - 副作用：仅 `pushToast`（达标 success / 未达标 warning，提示优化后重试）。**不写审计链**。随机数意味着可能需多次试跑才达标——这是有意的演示分支。
- **提交认证** `submitCertification()`（评测卡 qualified 时才出现按钮）：
  - 状态变化：资产 status → `review`（步骤锁定）。
  - 副作用：`pushAudit`（actor「林知远（专家）」，action「SOP 提交签名认证」，result `pending`）+ `pushToast`（info「平台认证委员会复核中」）。
  - **mock 2.5s 后自动通过**：status → `listed`，`hires = hires || 1`；`pushAudit`（actor「平台认证委员会」，action「SOP 认证通过并上架」，result ok）+ `pushToast`（success「已进入员工市场，带专家签名徽标」）。定时器统一收进 `timers` ref，组件卸载时清理。
  - 注意：上架仅改本地文案（签名徽标 + N 家在雇），**不会真正写入 Marketplace 数据**。

### 4.5 收入与声誉（纯展示，无可点交互）

- RevenuePanel 无任何按钮；数字全部由 `expertops.ts` 计算得出（见 §5 公式）。
- ReputationPanel 无按钮；等级由 `currentTier()` 依据三指标实时反算，指标卡展示与金牌门槛的差距文案（`gapText`：正向指标差 X pp / 反向指标需再降 X pp）。

## 5. 数据与状态

| 数据 | 位置 | 持久化 |
|---|---|---|
| `expertTickets` / `updateExpertTicket` / `pushExpertTicket` | zustand store | 否（不在 partialize） |
| `ticketContextExt`（脱敏/完整双侧 + 切片）、`ticketChannels` | data/expertops.ts 静态 | — |
| SOP 资产 `assets`、沙箱 `results`/`running`/`progress` | SopStudio 本地 state | 否 |
| NDA 弹层 `ndaTicket`、关单表单 `closingId`/`note`、tab | 各组件本地 state | 否 |

**分成计算公式**（expertops.ts）：
- `SHARE_RATE = 0.15`（银牌费率）；单行分成 `rowRevenue(r) = round(hires × subscription × SHARE_RATE)`；`monthTotal()` = 6 行求和 ≈ ¥234,038（612×899 + 624×499 + 412×599 + 286×799 + 422×399 + 184×299 各 ×15%）。
- `revenueHistory` 前 5 个月写死，7 月取 `monthTotal()` 保证与明细表合计一致；环比 = (本月-上月)/上月。
- RevenuePanel 展示费率用 `SHARE_RATE` 常量，而 ReputationPanel 用 `currentTier().shareRate`——当前指标下反算恰为银牌 15%，两处一致，但机制上是两套来源。

**声誉反算规则**（`currentTier()`）：
- 指标：转正率 82%（金牌需 ≥85）、淘汰率 4.2%（≤5 已达标）、bad case 率 1.6%（≤2 已达标）。
- 金牌：p≥85 且 e≤5 且 b≤2（分成 18%，首页推荐位）；银牌：p≥70 且 e≤8 且 b≤4（15%）；否则铜牌（12%）。当前恰差转正率 3pp → 银牌，与头部写死的「银牌专家」chip 相符。
- 规则表文案额外声明：连续 2 结算周期跌破自动降级；SLA 超时直接计入 bad case 率（仅文案，无实现）。

## 6. 模块联动

- **→ 对话流（chat）**：关单通报按 `ticketChannels` 路由进 ch-q3 / ch-risk，以 expert 身份气泡显示；expert 角色本身对 ch-q3 有「工单期临时入群」写权限（ROLE_CHANNEL_ACCESS）。
- **→ 审计链（audit）**：签协议接单 / 关单 / 撤销访问权 / SOP 提交认证 / 认证上架共 5 类事件 pushAudit，auditor 角色可在审计页看到。
- **← 全局 mock 引擎**：`store.tick` 驱动 SLA 倒计时刷新。
- **专家门户 tab 角标**：ExpertPortalPage 读 store 的 openCount，TicketBoard 内关单后其它 tab 下角标同步减少。
- **概念联动（未打通）**：SOP 上架声称进入员工市场，但 Marketplace 数据独立；`experts.ts` 的 agentCount=6 与 revenueRows 6 行人为对齐。

## 7. Mock 边界与已知限制

- 派单、SLA 计时起点、保障协议均为 seed 数据；无「新工单产生」的运行时来源（mock 引擎不会推新工单）。
- 两阶段脱敏是**渲染层开关**（`unlocked` 由 status 推导），无授权模型；「退群/撤销」只体现在审计文案与 UI 重新脱敏。
- SOP 资产纯本地 state：切出 studio tab 或刷新即回到 seed 状态；认证 2.5s 自动通过，无真实人审分支；上架不影响市场/收入数据。
- 收入、历史月份、平均响应时长、声誉三指标全部写死；分成只有公式演算，无结算流。
- 工单结论 textarea 无长度校验；`closeTicket` 未同步更新 `ticketChannels` 外的关联任务状态（taskId 仅作展示 chip）。
