# 一线员工「我的 AI 同事」（myagents）

> 源码：`src/components/pages/StaffWorkspacePage.tsx`（主体 + AssignModal + StatusChip）、`src/store/useAppStore.ts`（addTask / extraTasks / pushToast / pushAudit / setActivePage）、`src/data/employees.ts`、`src/lib/types.ts`（CollabTask / TaskStatus） · 状态：部分闭环（派活真实写入 store 并流入任务页；催办纯 toast 无痕；验收为跳转，由 TasksPage 承接）

## 1. 定位与对应闭环

一线真人员工（固定小周·一线销售运营视角）的日常入口，对应 phase0-prd 缺口⑤「多角色入口缺失」的一线侧：让一线员工「像用同事一样用 AI：派活、催办、验收，全程留痕」。

承载「一线派单闭环」的前半程：

1. **派活**（本页）：填任务三要素 → 生成 CollabTask 写 store `extraTasks` + 审计留痕；
2. **执行**（mock）：数字员工不真正接单，任务停在 pending / 0%；
3. **催办**（本页）：canned 话术即时反馈，模拟「同事回你一句」的体感；
4. **验收**（跳转）：去 TasksPage 验收工作台对 acceptance 逐条判定，闭环后半程在彼处完成。

叙事价值：任务不只自上而下（老板 → 分身 → 高管 → Agent），一线真人也能直接驱动数字员工——组织的毛细血管级用法。

派活闭环数据流（实线 = 已实现，虚线 = 仅文案）：

```
AssignModal 提交
  ├─→ store.extraTasks（CollabTask，persist 30 条）──→ TasksPage 看板/表格/验收工作台
  ├─→ store.auditLog（staff/assign/ch-q3）──────────→ AuditPage 可追溯
  ├─→ toast「已派给 …」
  └╌╌→ ch-q3 消息流（弹窗承诺，未实现）
催办 ──→ toast 话术（无任何状态写入，无审计）
去验收 / 查看 ──→ setActivePage('tasks')（无过滤定位）
```

## 2. 入口与角色可见性

| 角色 | 可达性 | 说明 |
|---|---|---|
| staff | 唯一正式入口 | LeftNav ROLE_SECTIONS.staff「工作台」第一项（图标 Bot）；切 staff 角色的默认页（phase0-prd §1） |
| boss | 无入口 | LeftNav 不渲染 myagents 项 |
| exec | 无入口 | 同上（高管有自己的 execws） |
| expert | 无入口 | 同上 |
| auditor | 无入口 | 同上（派活审计经审计链间接可见） |

- 页面不读 `currentRole` 做防卫，身份硬编码 `STAFF_NAME = '小周'`——若经持久化 activePage 残留进入，其他角色也会以小周身份派活留痕。
- 可见的 AI 同事白名单硬编码 `COLLEAGUE_IDS = ['emp-sales-1'（雪·销售官）, 'emp-ops'（岚·运营官）, 'emp-rest-1'（休息区休眠员工）, 'emp-doc'（文档官）]`——**不是按组织结构推导**（对照 Grill 02「成员应由组织结构推导而非手工矩阵」的方向，此处仍是手工名单）。
- 身份口径：本页审计 actor 用字符串「小周（一线员工）」，而 store `ROLE_ACTORS.staff.name` 为「小周」——同一人两种写法，AuditPage 按 actor 精确筛选时会拆成两个主体；对话流里小周的发言身份则取自 ROLE_ACTORS（chat.md §2）。
- staff 角色在对话流侧的配套权限：ch-q3 / ch-618 可写、ch-hermes 只读（完整矩阵见 chat.md §2）——即派活写入的 ch-q3 恰是小周有写权限的作战群，频道归属与角色权限自洽，只是消息侧未真正联动。

## 3. 界面结构

单列滚动（p-6，max-w 1080px）：

1. **页头**：标题「我的 AI 同事」+ 副题「小周 · 一线销售运营 · 像用同事一样用 AI：派活、催办、验收，全程留痕」+ 右侧「N 位 AI 同事在线」brand chip；
2. **AI 同事卡片区**（grid-cols-2，hover 升起阴影）每卡：
   - 头像（渐变底）+ 姓名 + StatusChip（工作中·绿脉冲 / 阻塞·红 / 会议中·蓝 / 训练中·黄 / 空闲）+ 角色·部门；
   - 当前任务软卡：`e.currentTask` + 进度条（`e.progress`，来自静态员工数据）+ 百分比；
   - 三按钮：**派活**（primary）/ **催办** / **去验收**；
3. **我发起的任务**：标题行（ListTodo 图标 + 计数 chip）+ `extraTasks` 列表行（负责人头像、标题、负责人·goal、期限（md 以上显示）、状态 chip、「查看」按钮）；空态 EmptyState 引导「点击任意 AI 同事卡片上的『派活』…」；
4. **AssignModal 派活弹窗**（440px，遮罩模糊）：头部（目标员工头像 + 「派活给 {name}」+ 提示「任务将进入频道 ch-q3 · 全程可追溯」）+ 三字段（任务标题*·autoFocus / 任务说明 textarea 3 行 / 期限，默认 now+3 天）+ 底部取消 / 确认派活。

## 4. 操作步骤与逻辑

### 4.1 派活（核心闭环动作）

- 前置条件：无——任意同事卡均可发起，**不校验目标员工可用性**（休眠 emp-rest-1、阻塞状态同样可派）。
- 操作：点某卡「派活」→ `setAssignTarget(e)` 弹 AssignModal → 填字段 → 点「确认派活」。
  - 标题为空：「确认派活」disabled（`disabled:opacity-40`），`submit()` 亦有 `!title.trim()` return 双保险；
  - 期限自由文本，默认 `defaultDue()` = 当前时间 +3×24h，格式 `YYYY-MM-DD HH:mm`，**无格式校验**；
  - 放弃路径：遮罩 / X / 取消 → `onClose` 关闭，不留任何痕迹。
- 状态变化（store）：`submitAssign` 构造 CollabTask → `addTask` 追加 `extraTasks`（persist partialize 保留 30 条）。字段生成规律：
  - `id: tk-staff-{Date.now()}`、`status: 'pending'`、`progress: 0`、`priority: 'normal'`、`collaboratorIds: []`、`createdAt` = 当前时间；
  - `channel: 'ch-q3'` ——**硬编码**，无论派给谁；
  - `ownerId` = 目标员工 id；`dueAt` = 输入期限 || defaultDue()；
  - `goal` = 说明 || 「由 小周 派发的协作任务」；
  - `scope` = 「一线派单 · 小周 发起」；
  - `inputs` = [说明存在 ? 「小周 提供的说明：{desc}」 : 「小周 口头说明」]；
  - `outputs` = ['交付物 · 与发起人约定']；
  - `acceptance` = ['小周 验收确认']——单条验收标准，供 TasksPage 验收工作台逐条判定。
- 本地状态：`assignTarget` 置 null（关弹窗）。
- 副作用：
  1. pushToast success：「已派给 {target.name}」·「『{title}』· 期限 {dueAt}」；
  2. pushAudit：actor「**小周（一线员工）**」、action「**派活给数字员工**」、target「{target.name} · {title}」、result ok、tags `['staff', 'assign', 'ch-q3']`。
- Mock 边界：任务不会真的出现在 ch-q3 消息流或频道任务栏（弹窗承诺「进入频道」未兑现——ChatPage 右栏读静态 `collabTasks`，不含 extraTasks）；数字员工不会开始执行。

### 4.2 催办

- 前置条件：无。
- 操作：点「催办」→ `nudge(e)`。
- 状态变化：**无任何 store / 本地状态写入**。
- 副作用：仅 pushToast info「{e.name} 回复」+ `NUDGE_REPLY[e.id]` 硬编码话术：
  - 雪·销售官：「BD 邮件草稿 30 分钟内同步给您（当前进度 64%）」；
  - 岚·运营官：「618 复盘图表生成中，预计 1 小时内出 v4.1（当前 48%）」;
  - emp-rest-1：「已从休眠唤醒，10 分钟内接单」；
  - 文档官：「当前空闲，可立即领取新任务」；
  - 未命中兜底：「收到催办 · 稍后同步进展」。
- 已知缺口：**催办不写审计**——与副题「全程留痕」矛盾，是本页唯一无痕的用户动作；被催员工的 status / progress 也不变（话术说「已从休眠唤醒」，卡片仍显示原状态）。

### 4.3 去验收

- 操作：点「去验收」→ `setActivePage('tasks')`。
- 状态变化：store `activePage = 'tasks'`（leftNav 不同步更新）。
- 副作用：无 toast / audit。验收动作本身在 TasksPage 验收工作台完成（对 acceptance 逐条 通过/不通过，不通过三选一），不在本页范围。
- 限制：跳转不携带员工 / 任务过滤参数，落地后需自行定位目标任务。

### 4.4 查看我发起的任务

- 前置条件：`extraTasks` 非空（来源：本页派活，或**会议室行动项转任务**——见 §6）。
- 操作：列表行点「查看」→ 同样 `setActivePage('tasks')`，无过滤定位。
- 渲染逻辑：
  - 负责人经 `empMap.get(t.ownerId)` 反查头像与姓名，查不到兜底显示 ownerId / 'A'；
  - 状态 chip 按 `TASK_STATUS_META` 七态映射：pending 待领取 / in_progress 进行中（蓝）/ waiting_approval 待审批（黄）/ blocked 已阻塞（红）/ completed 已完成（绿）/ failed 验收未过（红）/ overdue 已超期（红）；未知态兜底 pending。

### 4.5 动作 → 状态 → 副作用速查表

| 用户动作 | store / 本地字段 | toast | 审计（action / tags） |
|---|---|---|---|
| 点「派活」开弹窗 | 本地 assignTarget = e | — | — |
| 确认派活 | store extraTasks append；assignTarget = null | success「已派给 {name}」 | 派活给数字员工 / ['staff','assign','ch-q3'] |
| 取消 / 关闭弹窗 | assignTarget = null | — | — |
| 催办 | 无 | info「{name} 回复：{话术}」 | **无**（已知缺口） |
| 去验收 | store activePage = 'tasks' | — | — |
| 我发起的任务「查看」 | store activePage = 'tasks' | — | — |

派活生成的 CollabTask 关键约束：id 前缀 `tk-staff-`、status 恒 pending、progress 恒 0、channel 恒 'ch-q3'、acceptance 恒 ['小周 验收确认']——这些默认值决定了它在 TasksPage 看板中落「待开始」列、验收工作台只有一条判定项。

## 5. 数据与状态

- **store 写入**：
  - `extraTasks: CollabTask[]`——本页唯一业务性写入（persist key `hummer-v6`，partialize 时 slice(0, 30)）；
  - `activePage`（跳转）；`toasts`（transient，不持久化）；`auditLog`（经 pushAudit，persist 前 60 条）。
- **本地 state**：`assignTarget: Employee | null`（弹窗开关兼目标载体）；AssignModal 内 `title / desc / due` 三个受控字段（组件卸载即弃）。
- **只读数据**：`employees`（COLLEAGUE_IDS 过滤出 4 位同事 + empMap 全量反查）；卡片上的 status / currentTask / progress 全部来自静态员工数据，不随本页任何动作变化。
- **状态一致性缺口**：本页状态 chip 读 `t.status` 原始值；TasksPage 展示时则用 `taskStatuses[t.id]` 覆盖（`[...collabTasks, ...extraTasks]` + 状态覆盖层）。若在任务页把某派活任务推进为 in_progress / completed，回到本页仍显示「待领取」——两处口径未统一。

## 6. 模块联动

- **→ TasksPage**：extraTasks 被任务页合并进看板 / 表格；验收工作台可对 acceptance『小周 验收确认』判定——派活闭环的后半程在那里完成；本页「去验收 / 查看」均跳转至此。
- **← MeetingRoom**：会议行动项转任务同样调 `addTask` 写 extraTasks——因此「我发起的任务」列表**会混入会议产生的任务**（并非都是小周发起），列表标题语义与数据源不完全匹配。
- **→ AuditPage**：派活审计（tags staff / assign / ch-q3）进入审计链，可按 tags 追溯到「谁派给谁什么」。
- **→（未接通）ChatPage**：task.channel 写 'ch-q3'，但 ch-q3 消息流与右栏频道任务均感知不到新任务。
- **↔ ExecWorkspacePage（叙事对位）**：同一批数字员工（如雪·销售官）同时出现在高管的「团队绩效」与一线的「AI 同事卡」——高管管绩效与验收、一线管派活与催办，双视角互补但数据只在 employees 静态层共享，互相看不到对方的动作结果。
- **组件重复**：StatusChip 与 ExecWorkspacePage 内的同名组件是两份相同实现，未提为共享组件；渐变头像底色 `linear-gradient(135deg, #0F70B7, #7E22CE)` 亦在两页内联重复。

## 7. Mock 边界与已知限制

1. **执行侧完全 mock**：派活后任务永远停在 pending / 0%，数字员工不接单、不产出、不推进；催办回复是话术表，与真实进度无关。
2. **催办无审计**、无状态变化——「全程留痕」实际只覆盖派活一环。
3. `channel` 硬编码 ch-q3（派给文档官/运营官也进销售作战群）；期限自由文本无校验，填「明天」等非标格式会使 TasksPage 的倒计时解析 NaN 走原文兜底。
4. 同事名单、身份、话术全硬编码；休眠员工 emp-rest-1 可被正常派活，缺「唤醒」前置。
5. 「我发起的」列表混入会议行动项任务（extraTasks 共用）；与 TasksPage 的状态覆盖口径不一致（§5）。
6. 无删除 / 撤回派活能力；`addTask` 内存中无限增长，仅持久化时裁到 30 条——超出部分刷新后静默丢失最早的记录。
7. 派活弹窗的期限字段为纯文本 input（非 date picker），演示脚本依赖默认值才能保证 TaskCard 倒计时正常。
8. 「N 位 AI 同事在线」计数 = COLLEAGUE_IDS 长度，与员工实际 status 无关（休眠员工也计为「在线」）。
9. 与 phase0-prd 验收标准 6「切到一线员工 → 给 AI 同事派活」对齐：该演示步骤可一遍跑通；但 PRD 中「催办/验收」在本页仅为半实现（催办无痕、验收靠跳转）。
