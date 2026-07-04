# 工作任务（tasks）

> 源码：`src/components/pages/TasksPage.tsx`、`src/components/work/taskFlow.tsx`、`src/components/work/TaskDrawer.tsx`、`src/components/work/AcceptancePanel.tsx`、`src/data/tasks.ts`（`work/ExitActionModal.tsx`、`work/ExitQueue.tsx` 归证据库模块，见 `evidence.md`） · 状态：**有交互闭环**

## 1. 定位与对应闭环

工作任务是原型「①工作闭环」的主承载面：把一个任务从 **目标 → 分派 → 执行 → 提交验收 → 验收判定（通过 / 打回 / 转人工 / 降级）→ 交付** 走完整。对应 Phase 0 PRD 的 Top10 缺口 ①「验收环缺失」——原先只有顺利路径的看板展示，现在补上了验收工作台与不通过三选一的异常路径。每一次状态迁移都写审计链（信任闭环留痕）并给 toast 反馈。

## 2. 入口与角色可见性

- 左导航项：`ListChecks` 图标「工作任务」，`PageKey = 'tasks'`，badge 固定写死 `'8'`（不随真实数量变化）。
- 角色可见性（`shell/LeftNav.tsx` 的 `ROLE_SECTIONS`）：
  - **boss**：可见（「工作」分组第 4 项）
  - **exec**：可见（「工作台」分组）
  - **staff**：可见（「工作台」分组）
  - **expert**：不可见（仅专家门户 + 市场）
  - **auditor**：不可见（仅审计链 / 证据库 / 治理）
- 页面内部**无按角色的权限差异**：任何能进入该页的角色都能执行全部状态机动作与验收判定；差异仅体现在审计条目的操作人（`ROLE_NAMES[currentRole]`，如 boss 记「昆仑 · 老板」、staff 记「小周 · 一线」）。
- 其他入口：EmployeeDrawer 快捷操作「指派新任务」→ `setActivePage('tasks')`（仅跳转，不预填）。

## 3. 界面结构

- WorkspacePage 外壳（标题「工作任务」+ 副标题「目标 → 分派 → … → 一个闭环」）
  - 顶部 actions 区
    - 看板 / 表格视图切换（本地 state `view`）
    - 「筛选」「新建任务」按钮（无 onClick，纯占位）
  - sticky 搜索条
    - 搜索输入框（匹配 title / goal / 负责员工名）
    - 计数 chips：`filtered/total`、`N 待验收`、`N 被阻断`、`N 已超期`（超期>0 才显示）
  - 看板视图 KanbanView
    - 固定 5 列：待分派 / 执行中 / 待验收 / 被阻断 / 已完成；`failed`、`overdue` 两列仅在有任务落入时追加
    - 任务卡：标题 + 目标、优先级 chip、超期 chip、进度条、负责人 + 协作者头像、截止日、底部状态机按钮（FlowButton）
  - 表格视图 TableView：任务 / 负责员工 / 状态 / 优先级 / 进度 / 截止 / 操作 七列
  - TaskDrawer（点击任务卡/行后从右侧滑入，宽 420px）
    - 头部：状态 chip + 优先级 + 超期 chip + 标题
    - 目标 / 范围 / 输入资料 / 输出格式
    - **AcceptancePanel 验收工作台**（内嵌，替代原静态验收标准列表）
    - 协作员工 pills、产出物列表（每条可「去证据库发起出口」）、证据链（hash/时间/责任人）、关联对话/会议/审批/审计四宫格计数、复盘与 SOP 回写提示卡、进度条、最近操作时间线
    - 底部：查看审计 / 打开对话（占位）+ 状态机主按钮或「由上方验收标准判定决定去向」提示

## 4. 操作步骤与逻辑

状态机定义在 `taskFlow.tsx`：`FLOW_ACTION = { pending→in_progress(开始执行), in_progress→waiting_approval(提交验收), blocked→in_progress(解除阻断) }`；`waiting_approval` 之后**没有单向推进按钮**，去向由验收工作台判定。所有迁移经过统一 helper `useTaskTransition()`：`updateTaskStatus(t.id, next)` 写 `store.taskStatuses[t.id]` → `pushAudit({ actor: ROLE_NAMES[currentRole], action, target, result, tags })` → `pushToast`。

**开始执行** — 前置：任务 `status === 'pending'` → 点击卡片底部/表格行/抽屉底部的「开始执行」→ `taskStatuses[id] = 'in_progress'` → 审计 `{ action: '任务启动', target: 任务标题, result: 'ok', tags: ['task','to:in_progress'] }`，toast「<标题> → 执行中」。

**提交验收** — 前置：`in_progress` → 点「提交验收」→ `taskStatuses[id] = 'waiting_approval'` → 审计 `{ action: '提交验收', tags: ['task','to:waiting_approval'] }` + toast。

**解除阻断** — 前置：`blocked` → 点「解除阻断」→ 回 `in_progress` → 审计 `{ action: '解除阻断', tags: ['task','to:in_progress'] }`。无任何校验（如四眼原则），单击即回。

**验收判定（AcceptancePanel，核心分支）** — 前置：`status === 'waiting_approval'`（`interactive` 才渲染判定按钮；其他状态只读并提示「任务提交验收后可在此逐条判定」）。
1. 对 `task.acceptance[]` 每条点「通过 / 不通过」→ 写**本地 state** `verdicts: Record<下标, 'passed'|'failed'>`（不进 store，关抽屉即丢）。判定人显示 `ROLE_NAMES[currentRole]`。
2. **全部通过**（`judged === total && failed === 0`，或 acceptance 为空数组）→ 出现「确认验收 · 任务完成」→ 点击 → `transition(task, 'completed', '确认验收 · 任务完成')`，审计 `{ tags: ['task','acceptance','passed'], target: '<标题> · N 条验收标准全部通过 · 判定人 <角色名>' }`，toast「「<标题>」验收通过 · 任务完成」，关闭抽屉。
3. **任一不通过** → 按钮变「处置不通过项（三选一）」→ 打开 `FailDecisionModal`：
   - **打回重做** — 必须先填打回原因（textarea 为空则按钮 disabled）→ `transition(task, 'in_progress', '验收不通过 · 打回重做', { result: 'warning', tags: ['task','acceptance','rework'], note: '打回原因：<reason>' })`，warning toast 附原因。
   - **转人工处理** — 单击即执行 → `transition(task, 'blocked', '验收不通过 · 转人工处理', { result: 'warning', tags: ['task','acceptance','manual'], note: '已转人工' })`，info toast「任务标记为被阻断，等待人工接管」。
   - **降级交付** — 单击即执行 → `transition(task, 'completed', '验收 · 降级交付', { result: 'warning', tags: ['task','acceptance','degraded'], note: 'N 条未达标 · 降级交付' })`，warning toast「审计已标注 degraded」。
   - 三个出口都会关闭 modal 并回调 `onDone`（关抽屉）。

**去证据库发起出口** — 前置：抽屉产出物列表任一条 → 点「去证据库发起出口」→ `setActivePage('evidence')` + info toast「已切换到证据库，可对「<文件名>」发起交付出口」→ 关抽屉。**仅页面跳转**，不携带该产出物 id，证据库不会定位/高亮到对应条目。

**搜索 / 视图切换** — 纯本地 state（`q`、`view`），无副作用。「筛选」「新建任务」「查看审计」「打开对话」按钮均无处理函数。

**超期判定** — 展示层逻辑：`isTaskOverdue = status ∉ {completed, failed} && dueAt < MOCK_NOW`，其中 `MOCK_NOW = '2026-06-24 14:40'` 为写死的演示时间（字符串比较）。超期只影响红色 chip 与顶部计数，**不写回 store**，任务仍留在原状态列（`overdue` 列只有当某任务的 status 字段本身是 `'overdue'` 时才出现，种子数据里没有）。

## 5. 数据与状态

- **Mock 数据**：`src/data/tasks.ts` 导出 `collabTasks`（8 条种子任务，`CollabTask` 结构：id/title/goal/scope/inputs/outputs/acceptance[]/ownerId/collaboratorIds/dueAt/status/progress/channel/priority/createdAt）与 `initialRiskAlerts`（3 条风险告警，供 store 初始化，与本页无直接渲染关系）。时间线锚定 2026-06-22 ~ 06-30。
- **任务合成**：页面渲染的任务 = `collabTasks`（静态种子）+ `store.extraTasks`（会议行动项 / 一线派活动态新增），再用 `store.taskStatuses[id]` 覆盖状态字段。种子任务的其它字段（progress 等）永远不变。
- **store 字段**（zustand `useAppStore`，persist key `hummer-v6`）：
  - `taskStatuses: Record<taskId, status>` — 状态覆盖层，**持久化**
  - `extraTasks: CollabTask[]` — 动态任务，**持久化（截断前 30 条）**
  - `auditLog`（持久化前 60 条）、`toasts`（不持久化）、`currentRole`（不持久化，刷新回 boss）
- **本地 state**：`verdicts`（验收判定）、`decideOpen`、`selectedId`、`view`、`q` 均为组件内 state，不持久化。
- 类型 `AcceptanceJudgement` 在 `lib/types.ts` 中定义了持久化验收判定的结构，但 store 中**没有对应字段**，实际未使用。

## 6. 模块联动

- **会议室 → 任务**：MeetingRoom 结束会议后行动项转任务，`addTask()` 进 `extraTasks`，出现在本页看板 `pending` 列（详见 `meeting.md`）。
- **一线工作台 → 任务**：StaffWorkspacePage「派活给数字员工」同样走 `addTask()`，任务 id 前缀 `tk-staff-`。
- **任务 → 证据库**：TaskDrawer 产出物条目「去证据库发起出口」跳 `evidence` 页（仅切页 + toast）。
- **任务 → 审计链**：所有 `useTaskTransition` 迁移写 `auditLog`，在审计页（auditor 角色）可见，tags 以 `task` / `acceptance` / `to:<status>` 归类。
- **收件箱**：`tk-legal-review`（待审高危）等任务在收件箱有对应静态条目，但两者数据不互通——收件箱处理不会改任务状态。

## 7. Mock 边界与已知限制

- **假的部分**：「新建任务」「筛选」「查看审计」「打开对话」为死按钮；TaskDrawer 的产出物列表、证据链、消息/会议/审批/审计计数全部是按 taskId 写死的硬编码函数（`taskDeliverables`/`taskEvidence`/`taskMessageCount` 等），与证据库、对话流数据不互通；「最近操作」时间线是写死的 3 条；进度百分比恒定不随状态推进变化。
- **验收判定不持久**：verdicts 是组件本地 state，关抽屉/刷新即丢；打回重做后再次提交验收，判定记录从零开始，且无「第几轮验收」概念。
- **超期是纯展示**：基于写死的 `MOCK_NOW` 字符串比较；会议行动项转来的任务 `dueAt` 是「本周五 18:00」这类中文相对时间，与 `MOCK_NOW` 的字符串比较结果不可靠。
- **无权限控制**：验收判定人 = 当前切换角色，一线员工也能验收老板级任务并降级交付；「解除阻断」无审批门槛（与 `tk-finance-block` 声称的四眼原则不符）。
- **真实落地需替换**：任务 CRUD API 与真实状态机（含服务端校验的状态迁移合法性）、验收记录持久化（落 `AcceptanceJudgement`）、任务-产出物-对话-会议的真实外键关联、按角色的 RBAC、超期由服务端时钟判定并触发提醒、看板拖拽换列。
- **UX 缺陷**：左导航 badge 写死 8；看板列数可到 7 列时卡片过窄；打回原因只进审计 target 字符串，任务卡上看不到打回原因。
