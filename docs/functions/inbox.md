# 老板收件箱（inbox）

> 源码：`src/components/pages/InboxPage.tsx`（唯一页面文件，约 300 行）、`src/data/douyin.ts`（`inboxItems` 静态 5 条 + `INBOX_KINDS` 分类元数据）、`src/store/useAppStore.ts`（`inboxDone` / `resolveInbox` / `riskAlerts` / `approveAlert` / `exitActions` / `decideExit`）、`src/data/tasks.ts`（`initialRiskAlerts` 3 条种子）· 状态：**有交互闭环**（每条事件可处理、写审计、跨模块状态同步，但静态事件不会再生）

## 1. 定位与对应闭环

- Phase 0 PRD 的「老板统一待办面」：把五类需要老板出手的事件——**待我审批（approval）/ 已阻断（block）/ 卡住（stuck）/ 待验收（accept）/ 异常（anomaly）**——收敛到一个列表，对应「Agent 干活 → 出事 → 老板一处决断 → 写审计 → 各处同步」的 human-in-the-loop 闭环。
- 核心设计是**三路数据合并**（文件头注释自述）：静态收件箱事件 + 实时风险审批 + 交付出口审批，统一渲染成一种可展开处理的行。

## 2. 入口与角色可见性

- **boss**：LeftNav「工作」组第二项「收件箱」，badge **写死 '9'**（error 红色调，不随实际待办数变化）；TopBar 页面标题「收件箱 · 审批 · 阻断 · 卡住 · 待验收 · 异常 — 统一待办」。
- **exec / staff / expert / auditor**：`ROLE_SECTIONS` 均不含 inbox，无入口。页面组件本身不校验角色，理论上其他角色经 CommandPalette 或残留的持久化 `activePage` 也能进入。
**五角色可见性总表**：

| 角色 | 导航入口 | 角色 home | 备注 |
|---|---|---|---|
| boss | 有（工作组第 2 项，badge '9'） | office | 唯一目标用户 |
| exec | 无 | execws | 高管的「部门验收」在 ExecWorkspacePage 内自成一套 |
| staff | 无 | myagents | 一线催办/验收走 StaffWorkspacePage |
| expert | 无 | expertportal | 专家介入走工单（expertTickets），不进收件箱 |
| auditor | 无 | audit | 只读审计链，看得到收件箱产生的审计条目 |

- 审批身份的角色差异（重要且不一致）：
  - risk 来源的批准/拒绝走 `approveAlert`，actor 取 `ROLE_ACTORS[currentRole]`——**切到别的角色处理，审计与频道消息署名会跟着变**；
  - exit 来源走 `decideExit(id, approve, '昆仑（您）')`，static 来源的 `pushAudit` actor 也写死 `'昆仑（您）'`——**不随角色**。

## 3. 界面结构

```
WorkspacePage 框架
├─ 标题区 actions：今日待办 N · 紧急 N（红）· 已处理 N（绿）  ← 全量统计
├─ sticky 分类 tab：全部 N + 5 类 TabBtn（各自 pending 计数，带分类色图标）
└─ 内容区（max-w-4xl）
    ├─ pending 列表：InboxRow（分类色图标 + urgent 红点脉冲 + 标题 + agent·频道 + 分类 chip + ts + 展开箭头）
    │   └─ 展开态：detail 段落 + 操作按钮组 + 「处理后自动写入审计链」提示
    │       ├─ kind==='approval' → [批准] [拒绝]
    │       └─ 其余 4 类       → [去处理] [标记已阅]
    ├─ EmptyState（当前分类无待办）
    └─ 「已处理（N）」折叠组：灰色划线行 + doneLabel chip + ts
```

分类元数据 `KIND_META`（页面内）与 `INBOX_KINDS`（douyin.ts）颜色一致：approval 蓝 #3B82F6 / block 红 #EF4444 / stuck 琥珀 #F59E0B / accept 紫 #A855F7 / anomaly 青 #14B8A6。

## 4. 操作步骤与逻辑

### 4.0 数据合并（渲染前 useMemo，依赖 riskAlerts / exitActions / inboxDone）

统一为 `UnifiedItem { id, kind, title, agent, channel, ts, detail, urgent, source, done, doneLabel }`：

| 来源 source | 原始数据 | id 规则 | kind | done 判定 | doneLabel |
|---|---|---|---|---|---|
| `static` | `inboxItems`（douyin.ts 5 条：block×1、approval×1、stuck×1、accept×1、anomaly×1） | 原 id（in-1…in-5） | 原 kind | `id in store.inboxDone` | `inboxDone[id]` 的决定字符串 |
| `risk` | `store.riskAlerts`（初始 3 条 pending：138w 调拨 critical / 合同外发 high / 群发邮件 medium） | `risk-` + alert.id | 固定 `approval` | `status !== 'pending'` | 已批准 / 已拒绝 / 已转安全方式 |
| `exit` | `store.exitActions`（初始空，由证据库「交付出口」动作产生） | `exit-` + action.id | 固定 `approval` | `status !== 'pending_approval'` | 已批准执行 / 已拒绝 |

排序为 `[...fromExit, ...fromRisk, ...fromStatic]`（出口审批置顶，无时间排序）。urgent：static 取自数据；risk 为 `level ∈ {high, critical}`；exit 恒 true。detail：risk 拼 `reason + ' 建议：' + suggestion`；exit 拼 `evidenceName → target，动作生效前需要您审批。`

**静态 5 条（`inboxItems`，覆盖全部 5 类各一条）**：

| id | kind | urgent | 标题 | agent | 频道 | detail 要点 |
|---|---|---|---|---|---|---|
| in-1 | block | 是 | 财务 138w 调拨已阻断 | 砚·财务官 | ch-q3 | Guardian 拦截，四眼原则；SOP v3 下线、v4 沙箱评测 |
| in-2 | approval | 是 | 合同外发待签字 | 律·法务官 | ch-q3 | 鲲鹏主合同 v4 含 3 条高危条款 |
| in-3 | stuck | 否 | 运营复盘数据缺失 | 岚·运营官 | ch-618 | BI 归因数据未更新，等数据工程修复 |
| in-4 | accept | 否 | 产品 PRD v0.3 待验收 | 衍·产品经理 | ch-q3 | 过目后进研发评审 |
| in-5 | anomaly | 是 | 客服情绪分类异常 | 苓·客服官 | ch-hermes | 准确率 91%→76%，已进 Hermes 队列 |

**初始 3 条 risk（`initialRiskAlerts`，tasks.ts）**：ra-fin-138w（资金调拨 138w，critical，ch-risk）/ ra-legal-export（主合同 v4 全文外发，high，ch-q3）/ ra-cs-template（群发外部模板邮件，medium，ch-q3）——medium 一条在收件箱里 urgent 为 false。

### 4.1 切换分类 tab
- 操作：点「全部」或 5 类 TabBtn。
- 状态变化：本地 `tab: InboxKind | 'all'`。tab 计数 = 该类 pending 数（`countOf`），「全部」= 全量 pending 数。
- 副作用：无 store 写入。注意 risk/exit 都归入 approval 类，所以「待我审批」tab 是三路来源混合。

### 4.2 展开 / 收起一条事件
- 操作：点击行。
- 状态变化：本地 `expanded: string | null`（单开互斥）。
- 副作用：无；展开态卡片加 `hum-elev-2` 阴影。

### 4.3 批准 / 拒绝（approval 类，`handleApprove(item, approve)`）
按 source 分三条分支：

**a) source === 'risk'**
- 前置：对应 riskAlert 仍 pending。
- 调用：`approveAlert(item.id.replace(/^risk-/, ''), 'approve' | 'reject')`（无 note）。
- store 变化（approveAlert 内一次事务）：
  - `riskAlerts[i].status → 'approved' | 'rejected'`，`pendingApprovals` 重算；
  - `collabFeed` 追加 approval 消息到源频道（署名 `ROLE_ACTORS[currentRole]`，文案 `[OK] X批准了 · {action}` / `[X] X拒绝了 · {action} · 改为更安全方式`）；源频道≠ch-risk 时再双投一条【决策记录】到 `ch-risk`；
  - `auditLog` 头插：`{actor: 角色名, action: '审批通过' | '拒绝', target: alert.action, result: 'ok' | 'blocked', tags: ['human-in-loop']}`。
- 本条 done 由 riskAlert.status 派生，自动落入「已处理」折叠组。

**b) source === 'exit'**
- 调用：`decideExit(rawId, approve, '昆仑（您）')`。
- store 变化：`exitActions[i].status → 'executed' | 'rejected'`，`approvedBy = '昆仑（您）'`；`auditLog` 头插 `{actor: '昆仑（您）', action: '批准交付出口' | '拒绝交付出口', target: evidenceName, result: 'ok' | 'blocked', tags: ['exit', 'human-in-loop']}`。
- 注意：批准即视为「已执行」（status 直接 executed），没有真实的发送/回写动作。

**c) source === 'static'**
- 调用：`resolveInbox(item.id, '已批准' | '已拒绝')` → `inboxDone[id] = 决定`；
- 页面自行 `pushAudit({actor: '昆仑（您）', action: '收件箱审批通过' | '收件箱审批拒绝', target: item.title, result: 'ok' | 'blocked', tags: ['inbox', 'human-in-loop']})`。

三分支公共尾巴：`pushToast({kind: approve ? 'success' : 'warning', title: '已批准' | '已拒绝', detail: '{title} · 已写入审计链'})`；`setExpanded(null)`。

### 4.4 去处理 / 标记已阅（非 approval 4 类，`handleResolve(item, mode)`）
- 仅 static 来源会出现这 4 类（risk/exit 恒为 approval）。
- **去处理**：`resolveInbox(id, '已处理')` + `pushAudit({actor: '昆仑（您）', action: '收件箱处理', target: title, result: 'ok', tags: ['inbox']})` + success toast「已去处理」。**并不真正跳转**到任务/Hermes/验收页——只是标记完成。
- **标记已阅**：`resolveInbox(id, '已阅')`，**不写审计**，info toast「已标记已阅」。
- 公共：`setExpanded(null)`，条目移入「已处理」折叠组（划线 + doneLabel chip）。

### 4.5 已处理折叠组
- 操作：点「已处理（N）」→ 本地 `showDone` toggle。只读展示，无恢复/撤销操作。

### 4.6 空态
- 当前 tab 无 pending 时渲染 `EmptyState`（Inbox 图标 +「当前分类没有待办」+「所有事件都已处理，或切换其他分类查看」），已处理折叠组仍照常显示。

## 5. 数据与状态

**涉及的 store 动作与审计 tags 速查**：

| 用户动作 | store 调用 | 状态字段变化 | 审计（actor / action / tags） | toast |
|---|---|---|---|---|
| 批准/拒绝（risk） | `approveAlert(id, decision)` | `riskAlerts[i].status`、`pendingApprovals`、`collabFeed`(+1~2 条) | ROLE_ACTORS[currentRole] / 审批通过·拒绝 / `['human-in-loop']` | 已批准/已拒绝 |
| 批准/拒绝（exit） | `decideExit(id, approve, '昆仑（您）')` | `exitActions[i].status/approvedBy` | 昆仑（您）/ 批准·拒绝交付出口 / `['exit','human-in-loop']` | 同上 |
| 批准/拒绝（static） | `resolveInbox(id, 决定)` + `pushAudit` | `inboxDone[id]` | 昆仑（您）/ 收件箱审批通过·拒绝 / `['inbox','human-in-loop']` | 同上 |
| 去处理 | `resolveInbox(id, '已处理')` + `pushAudit` | `inboxDone[id]` | 昆仑（您）/ 收件箱处理 / `['inbox']` | 已去处理 |
| 标记已阅 | `resolveInbox(id, '已阅')` | `inboxDone[id]` | **不写审计** | 已标记已阅 |

- **store 字段**：
  - `inboxDone: Record<string, string>`（itemId → 决定文案），`resolveInbox` 为纯覆盖写入；**未列入 persist partialize，刷新即清空**——静态 5 条待办每次刷新复活；
  - `riskAlerts` / `exitActions` 同样不持久化：刷新后 risk 回到初始 3 条 pending、exit 队列清空；
  - `auditLog` persist 前 60 条，处理记录可跨刷新留存（造成「审计里有记录、收件箱里事件又回来了」的轻微矛盾）。
- **本地 state**：`tab`、`expanded`、`showDone`。
- **统计口径**：标题区「今日待办/紧急/已处理」用全量 items（不受 tab 影响）；tab 内列表用 filtered。

## 6. 模块联动

- **← BottomFlow / RiskAlertModal（office 页）**：同一份 `riskAlerts`。在办公室底部弹窗审批过的告警，收件箱侧同步变已处理（反向亦然）；`pendingApprovals` 同时驱动 TopBar 红色 chip 与 BottomFlow 横幅——但该计数**只含 riskAlerts**，不含 exit/static 待办，与 LeftNav 写死的 '9' 三者互不一致。
- **← 证据库（EvidencePage / ExitActionModal）**：`requestExit` 产生 `pending_approval` 出口动作（同时写一条 result: 'pending'、tags: ['exit','evidence'] 的审计），立即出现在收件箱顶部；收件箱批准后证据库侧出口状态同步为 executed。
- **→ 审计链（AuditPage）**：所有处理动作的 pushAudit 条目按 tags（human-in-loop / inbox / exit）可检索。
- **→ 对话流（ChatPage / BottomFlow）**：risk 审批产生的频道消息与 ch-risk 决策记录在消息流可见。
- **数据同源**：`inboxItems` 的 5 条事件与 douyin.ts 其余数据（SOP 版本、淘汰流）共享「抖音三视频」叙事，如 in-1 的 138w 阻断与 `initialRiskAlerts` 的 `ra-fin-138w` 讲同一件事，但**两条互相独立**——分别处理、互不联动。

## 7. Mock 边界与已知限制

1. **事件不再生**：静态 5 条 + 初始 3 条 risk 处理完后，除非去证据库发起出口动作，收件箱会清空；5s 心跳 mock 只产生消息/审计，不产生新收件箱事件。
2. **inboxDone 不持久化**：刷新后静态事件全部复活（见 §5），demo 可重复演示，但与「审计已留痕」矛盾。
3. **「去处理」无跳转**：stuck/accept/anomaly 事件没有链接到任务页、验收面板或 Hermes 队列，处理仅是打标。
4. **计数三处不一致**：LeftNav badge 写死 9 ≠ 页面实时统计 ≠ TopBar/横幅的 pendingApprovals（仅 risk）。
5. **审批身份割裂**：risk 分支署名随 `currentRole`，exit/static 分支写死昆仑；非 boss 角色理论上进入本页可用他人身份审批，无权限校验。
6. **同一事实双写**：138w 阻断同时存在于 static（block 类，只能「去处理/已阅」）与 risk（approval 类，可批准/拒绝），处理其一另一条仍在。
7. ts 均为写死的 `HH:MM` 字符串，无真实时间序；列表排序是「exit → risk → static」的拼接序而非时间序。
8. 「标记已阅」不写审计，与页脚「处理后自动写入审计链」的文案不完全相符。
