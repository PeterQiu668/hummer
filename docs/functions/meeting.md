# 会议室（meeting）

> 源码：`src/components/meeting/MeetingRoom.tsx`（挂载于 `shell/AppShell.tsx`；入口分布在 `office/Office3D.tsx`、`drawer/EmployeeDrawer.tsx`、`shell/BottomFlow.tsx`） · 状态：**有交互闭环**（发起 → 开会 → 结束 → 行动项转任务真正落到任务看板；实时纪要部分存在缺陷，见 §7）

## 1. 定位与对应闭环

会议室演示「人机混合会议」的完整 flow：选议题拉参会人 → 开会（实时纪要 + 行动项）→ 结束生成纪要 → **行动项一键转 CollabTask 并指派**。它是「①工作闭环」的任务生产入口之一（会议产出直接变成可执行、可验收的任务），也承担「⑥组织闭环」里人与数字员工同场协作的叙事。对应 Phase 0 PRD 页面清单最后一项「会议行动项转任务：结束会议时行动项一键转 CollabTask（addTask）并指派，出现在任务页」。发起 / 结束 / 转任务三类动作全部 `pushAudit` 留痕。

## 2. 入口与角色可见性

会议室是**全屏 modal**（`store.showMeeting`），左导航没有独立菜单项，入口全部是场景内按钮：

1. **3D 办公室**（Office3D.tsx）：双击「会议区」zone → `setShowMeeting(true)`。office 页仅 boss 导航可达。
2. **员工抽屉**（EmployeeDrawer.tsx）：快捷操作「发起会议」→ `setShowMeeting(true)` 并额外写一条审计 `{ actor: '昆仑（您）', action: '发起会议', target: 员工名, tags: ['meeting'] }`（注意：这条在会议真正开始前就写了，与 startMeeting 的审计会重复）。
3. **对话流底部工具条**（BottomFlow.tsx）：「拉入会议室」按钮 → `setShowMeeting(true)`。chat 页 boss/exec/staff 均可见。

角色差异：**组件内部完全没有角色分支**——无论当前切到哪个角色，审计操作人一律写死「昆仑（您）」（不像任务模块用 `ROLE_NAMES[currentRole]`）；expert / auditor 因缺少 office/chat 入口，实际接触不到会议室。modal 由 AppShell 顶层 `<AnimatePresence>{showMeeting && <MeetingRoom />}</AnimatePresence>` 渲染，点遮罩或右上角 X 直接关闭（任何步骤都可关，无确认）。

## 3. 界面结构

- 遮罩层（rgba 黑 + blur，点击关闭）
  - 会议窗体（1080×680，三步向导，本地 state `step: 'setup' | 'live' | 'finished'`）
    - Header：会议室名「青莲」+ 按 step 变化的副标题；live 时显示「录制中 · mm:ss」计时 chip；关闭按钮
    - **setup 步**
      - 议题区：5 个预置议题 radio（Q3 增长策略评审 / 618 复盘 / 高危合同风险消减 / 招聘决策 / 客服异常应急）+ 自定义议题输入行
      - 参会人区：全体 `employees` 的 checkbox 网格（头像 + 名字 + 角色），默认勾选 emp-ceo / emp-sales-1 / emp-meeting-1，底部已选计数
      - 底部：取消 / 「开始会议」
    - **live 步**（12 栅格）
      - 左 7 列：参会人视频瓦片（渐变头像浮动动画 + 名字 chip + 每 3 个一个麦克风闪烁）+ 虚线「拉人」占位块
      - 右 5 列：
        - 实时纪要卡（LIVE chip，逐行 时间/发言人/内容；空态「▋ 准备记录…」）
        - 行动项卡（默认 2 条：雪·销售官 BD 清单、岚·运营官 投放调整；完成计数、+ 新增、checkbox 勾选、hover 删除）
      - Footer：共享白板 / 暂停录制（占位）+ 「结束 · 生成纪要」
    - **finished 步**
      - 结束摘要卡（议题 / 参会人数 / 时长 / 行动项数）
      - 纪要摘要（notes 逐条列出）
      - **行动项 · 转为任务**区：已转计数 + 「全部转为任务」；每行 = 行动项内容 + 期限 chip + 负责人下拉（全体 employees）+ 「转为任务」按钮或「已转任务 ✓」chip
      - Footer：「纪要 + 行动项已写入审计链」提示 + 完成（关 modal）

## 4. 操作步骤与逻辑

**开始会议** — 前置：setup 步。若 `attendees.length === 0` → 仅 warning toast「请先选择参会人」并拦截。否则：`step → 'live'`、`notes` 清空、`tick` 归零 → `pushAudit({ actor: '昆仑（您）', action: '发起会议', target: 议题, result: 'ok', tags: ['meeting','start'] })`。无 toast。

**会中计时与实时纪要** — 两个 effect：① 计时器每 1s `setTick(x => x + 1)`，驱动 Header 的 mm:ss；② 纪要 effect 以 2.2s 间隔从 5 条写死台词（林·决策官 / 吴·销售 VP 分身 / 雪·销售官 / Hermes / 万·CFO 分身）逐条 push 进 `notes`。**缺陷**：纪要 effect 的依赖数组含 `tick`，而 tick 每 1s 变一次，导致 2.2s 的 interval 在触发前就被 cleanup 重建——实际运行中纪要行基本不会出现，live 步长期停留在「▋ 准备记录…」，finished 步的纪要摘要也随之为空（详见 §7）。

**行动项编辑（会中）** — 全部本地 state `actions: ActionItem[]`：
- 「+」新增：`{ id: 'a-<Date.now()>', owner: employees[attendees.length % employees.length].name, what: '新增行动项 · 待编辑', due: '本周内', done: false }`——owner 取模逻辑与参会人无实际关系，且**内容不可编辑**（占位文案「待编辑」没有编辑入口）。
- checkbox 切换 done（划线样式）；hover 行尾垃圾桶删除。无审计/toast。

**结束会议** — 前置：live 步 → 点「结束 · 生成纪要」→ `step → 'finished'` → `pushAudit({ actor: '昆仑（您）', action: '会议结束 · 生成纪要', target: 议题, result: 'ok', tags: ['meeting','finish','actions:<N>'] })` → success toast「会议「<议题>」已结束 · 生成 N 个行动项 · 纪要已归档」。「归档」仅是文案，纪要不落任何 store/证据库。

**逐条转任务（核心链路）** — 前置：finished 步、该行动项未转过（`converted[a.id]` 为 falsy）。
1. 可先在下拉框改负责人 → 本地 state `taskOwners[a.id] = 员工id`；默认负责人 = 按行动项 owner 名匹配 employees → 匹配不到则取第一个参会人 → 再兜底 `'emp-doc'`。
2. 点「转为任务」→ `buildTask` 组装 CollabTask：`{ id: 'tk-meeting-<行动项id>-<Date.now()>', title: 行动项内容, goal: 议题, scope: '会议「<议题>」行动项', inputs: ['会议纪要','行动项上下文'], outputs: ['交付物 · 按行动项约定'], acceptance: ['发起人验收确认'], ownerId, collaboratorIds: [], dueAt: a.due（如「本周五 18:00」）, status: 'pending', progress: 0, channel: 'ch-q3', priority: 'normal', createdAt: 当前真实时间 }`。
3. `store.addTask(task)` → 追加进 `extraTasks`（持久化，截 30 条）→ 本地 `converted[a.id] = true`（按钮变「已转任务 ✓」、下拉禁用）。
4. 副作用：success toast「已转任务 · 派给 <员工名>」+ 审计 `{ actor: '昆仑（您）', action: '会议行动项转任务', target: '<员工名> · <行动项内容>', result: 'ok', tags: ['meeting','task','ch-q3'] }`。
5. 任务立即出现在 TasksPage 看板「待分派」列，可走完整任务状态机（开始执行 → 提交验收 → 验收判定）。

**全部转为任务** — 前置：finished 步。若全部已转 → info toast「所有行动项都已转为任务」。否则对剩余项逐个 `addTask(buildTask(a, ownerOf(a)))`、批量标记 converted → success toast「已将 N 个行动项转为任务 · 任务已进入任务看板 · 频道 ch-q3」→ **单条汇总审计** `{ action: '会议行动项批量转任务', target: '<议题> · N 项', tags: ['meeting','task','batch'] }`（不逐条写审计）。按钮在全转后 disabled。

**关闭 / 完成** — 任意步点 X 或遮罩、finished 步点「完成」→ `setShowMeeting(false)`。组件卸载后 step/notes/actions/converted 全部丢失；下次打开从 setup 重新开始（默认行动项恢复为初始 2 条，可能再次转成重复任务）。

## 5. 数据与状态

- **组件内 mock**：`PRESET_AGENDA` 5 条预置议题；live 台词 5 条硬编码在 effect 内；默认行动项 2 条硬编码在 `useState` 初值。参会人候选 = `src/data/employees.ts` 全量。
- **本地 state**（全部不持久化，关 modal 即毁）：`step`、`agenda`、`attendees: string[]`、`tick`、`notes: NoteLine[]`、`actions: ActionItem[]`、`converted: Record<id, boolean>`、`taskOwners: Record<id, empId>`。
- **写入 store 的只有三样**：`extraTasks`（addTask，**持久化** localStorage `hummer-v6`，截 30 条）、`auditLog`（pushAudit，持久化前 60 条）、`toasts`（瞬态）。`showMeeting` 本身是瞬态 UI state。
- 会议实体（议题 / 参会人 / 纪要 / 时长）**没有任何持久化**——「纪要已归档」后无处可查（证据库的 `ev-5` 会议纪要是无关的静态种子）。

## 6. 模块联动

- **会议 → 任务**：唯一实质联动。`addTask` 产生的任务进入 TasksPage（合并渲染 `collabTasks + extraTasks`）与 StaffWorkspacePage「我发起的任务」列表；acceptance 只有一条「发起人验收确认」，可被验收工作台判定。
- **会议 → 审计链**：发起 / 结束 / 转任务（单条或批量）四类审计条目，tags 均含 `meeting`，审计页可过滤追溯。
- **入口联动**：EmployeeDrawer「发起会议」、BottomFlow「拉入会议室」、Office3D 会议区双击——三处都只是打开 modal，**不携带上下文**（从某员工抽屉发起不会预选该员工为参会人；从某频道发起不会把任务 channel 设为该频道，转任务永远写死 `ch-q3`）。
- **TaskDrawer 的「关联会议」计数**是按 taskId 写死的 mock，与真实会议记录无关。

## 7. Mock 边界与已知限制

- **实时纪要疑似不工作（代码级缺陷）**：纪要 effect `useEffect(..., [step, tick])` 依赖每秒变化的 `tick`，interval（2200ms）在每次 tick 更新时被 clear 重建，永远到不了触发时刻；即使触发，`setNotes` 回调里 `lines[i]` 的闭包索引也会因 effect 重建而反复归零。结果是纪要区常驻空态、finished 步纪要摘要为空。修复方向：计时与打字分离，打字 effect 只依赖 `step`，用 ref 记录进度。
- **假的部分**：参会人视频瓦片 / 麦克风状态 / 「录制中」纯动画；共享白板、暂停录制、「拉人」为死按钮；台词与默认行动项写死；「纪要已归档」无归档实体；行动项文本不可编辑。
- **重复与身份问题**：重新开会会把同样 2 条默认行动项再次转成新任务（id 含时间戳不去重）；审计操作人写死「昆仑（您）」，切到 exec/staff 发起会议审计仍记老板，与任务模块的 `ROLE_NAMES[currentRole]` 口径不一致；EmployeeDrawer 入口在会议未开始时就预写一条「发起会议」审计。
- **数据格式问题**：转任务的 `dueAt` 是「本周五 18:00」「下周三 12:00」等中文相对时间，进入任务页后与 `MOCK_NOW`（`2026-06-24 14:40`）做字符串比较，超期判定结果不可靠；也无法排序。
- **真实落地需替换**：真实音视频 / 转写服务（ASR + 说话人分离）驱动纪要；会议实体持久化（议程/参会/纪要/行动项落库），纪要归档自动生成证据库条目；行动项支持编辑、负责人建议来自纪要 NLP；转任务携带会议 id 建立任务↔会议双向关联（替换 TaskDrawer 的 mock 计数）；发起入口携带上下文（预选参会人、继承频道）；按角色的发起/结束权限与真实操作人身份。
