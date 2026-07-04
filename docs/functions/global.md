# 全局系统（global）
> 源码：src/components/shell/{TopBar,AppShell}.tsx · src/components/global/{CommandPalette,ToastContainer}.tsx · src/components/boot/BootScreen.tsx · src/store/useAppStore.ts · src/App.tsx · src/data/feishu.ts（ROLE_CHANNEL_ACCESS）· 状态：有交互闭环（角色切换/导航/命令面板/Toast/持久化/mock 实时引擎全部可用）

## 1. 定位与对应闭环

全局系统是原型的「操作系统层」，承载三件事：

1. **多角色演示框架**（Phase 0 核心）：一套 UI 通过 `currentRole` 切五个身份视角（老板/高管/一线/专家/审计），导航、频道可见性、发言与审批身份全部随角色重算——这是 PRD「多角色闭环」的落地骨架。
2. **单页应用壳**：Boot → AppShell 三明治布局（TopBar / LeftNav / 中央 page 槽 / 右侧槽 / 底部流）+ 七个全屏 modal + 全局 overlay（⌘K、Toast、SkillSlotIn）。
3. **mock 实时引擎 + 持久化**：`setInterval` 心跳让系统"活着"，zustand persist 让用户操作跨刷新留存。

## 2. 入口与角色可见性

- App.tsx：`bootDone === false` → BootScreen（打字机 10 行 ×180ms + 700ms 收尾后 `setBootDone(true)` + `setScreen('office')`）；之后渲染 AppShell。`bootDone` **在 persist 内**，故 Boot 动画整个浏览器只看一次，清 localStorage 才重放。
- TopBar / LeftNav / CommandPalette / ToastContainer 对所有角色恒常渲染；差异全部由 `ROLE_SECTIONS`（导航）与 `ROLE_CHANNEL_ACCESS`（频道）数据驱动。

## 3. 界面结构

- **TopBar**（h-12 固定顶栏）：品牌 → 面包屑（`PAGE_LABEL[activePage]` 的 title/sub，20 个页面 key 全映射）→ 实时 chip（在岗 x/15、今日完成率 `56 + (tick*3)%12` 滚动模拟、模型成本 ¥1,283 写死、待审批数 `pendingApprovals` >0 时红色脉冲）→ ⌘K 触发按钮（按 `navigator.platform` 显示 ⌘/Ctrl）→ RoleSwitcher。
- **AppShell 槽位互斥规则**（全部由 `activePage`/`selectedEmployee` 推导）：
  - 右侧槽：`office` 页且未选中员工 → RightConsole（320px）；选中员工 → EmployeeDrawer（380px），二者互斥；**非 office 页右侧槽整体隐藏**（代码中 `rightSlotVisible` 的两个分支都要求 isOffice，等价于 isOffice）。
  - 底部槽：BottomFlow（IM 流，276px）仅 office 页显示。
  - 中央区绝对定位 `top-12 left-60`，right/bottom 按上述槽位动态收缩（transition 300ms）。
  - 七个 modal 走 AnimatePresence：Marketplace / GovernanceCabin / EvolutionFlywheel(Hermes) / MeetingRoom / KnowledgeGraph / LobsterLab / ExecutiveDetail（由 `activeExecId` 驱动），互相不排斥（理论可叠加，实践入口互斥）。
- **全局 overlay**：SkillSlotIn（技能装配动画）、CommandPalette（z-200）、ToastContainer（z-300，右上）。

## 4. 操作步骤与逻辑

### 4.1 角色切换（一等功能）

**入口**：TopBar 最右 RoleSwitcher。ROLES 五身份（TopBar.tsx 常量）：

| key | 姓名 | 头衔 | home 页 |
|---|---|---|---|
| boss | 昆仑 | 老板 · 总控 | office |
| exec | 吴帆 | 销售 VP · 真人高管 | execws |
| staff | 小周 | 一线员工 | myagents |
| expert | 林知远 | 入驻专家 | expertportal |
| auditor | 审计员 | 合规审计 | audit |

**操作**：点头像 → 本地 `open` 弹「切换演示视角」下拉（fixed 遮罩点击关闭）→ 点某角色 → `switchTo(key)`。

**切换时同步发生的事**：
1. `setCurrentRole(key)` —— store.currentRole 变更（不持久化，刷新回 boss）。
2. `setActivePage(target.home)` + `setLeftNav(target.home)` —— 强制跳到该角色默认页（这两个字段**在 persist 内**）。
3. **导航重算**：LeftNav 读 `ROLE_SECTIONS[currentRole]` 渲染完全不同的分组——boss 3 组 13 项（含员工市场/治理/进化中心）、exec 2 组 6 项、staff 2 组 5 项、expert 2 组 2 项、auditor 1 组 3 项。
4. **频道可见性重算**：LeftNav「活跃频道」区与 ChatPage 左栏都按 `ROLE_CHANNEL_ACCESS[currentRole]` × `CHANNEL_GROUPS`（责任链群/分身管理/业务作战群/风险通道/系统通告 五组定序）过滤，无条目即整组不可见：

| 角色 | 可见频道 | 写权限特例 |
|---|---|---|
| boss | 全部 9 个 | ch-twin-sales 只读，注记「合规可见」 |
| exec | 7 个（无 ch-boss / ch-mkt） | ch-exec「仅确认/仲裁」、ch-twin-sales「确认/打回」、ch-risk「审批会签」、ch-hermes 只读 |
| staff | 3 个（ch-q3 / ch-618 / ch-hermes） | ch-hermes 只读 |
| expert | 仅 ch-q3 | 注记「工单期临时入群」 |
| auditor | 8 个（无 ch-twin-sales） | 全部只读，注记「审计只读」 |
5. **发言身份变化**：`ROLE_ACTORS[currentRole]`（store 导出常量）决定发消息/审批的 sender 名、头像字、senderRole（expert 角色为 'expert'，其余 'human'）。ChatPage `handleSend`、`approveAlert` 的审批记录与「风险双投」到 ch-risk 的决策记录均用它落款。
6. **activeChannel fallback**：ChatPage 的 `useEffect` 检测 `!access[activeChannel]` 时自动 `setActiveChannel(firstVisibleId)`（该角色第一个可见频道）——例如 boss 停在 ch-boss 后切到 staff，进入对话流自动回退到 ch-q3。注意 fallback 写在 ChatPage 内，**切角色瞬间若不在 chat 页则延迟到下次进入 chat 时才修正**。
7. 写权限重算：ChatPage `canWrite = access[activeChannel].write`，false 时输入框禁用并显示 note（如「只读」「审批会签」）。

### 4.2 左侧导航点击

- 前置：任意角色。操作：点导航项 → `onClick(it)`：先 `setLeftNav(it.key)`；若 item 带 `highlight`（market/governance/hermes）则**只开 modal 不换页**（`setShowMarketplace/Governance/Hermes(true)`，activePage 不变）；否则 `setActivePage(it.key)`。
- 点「活跃频道」某频道 → `setActiveChannel(id)` + `setActivePage('chat')` + `setLeftNav('chat')` 三连。
- 副作用：无 audit/toast。badge（收件箱 9、任务 8 等）全部写死在 IT 常量。

### 4.3 命令面板（⌘K）

- 打开：全局 keydown 监听 `meta/ctrl + K` toggle `cmdkOpen`；TopBar 搜索按钮同效；ESC 或点遮罩关闭。打开时清空 query、focus 输入框。
- 数据源：12 个 PAGES 条目（8 个 page 跳转 + 4 个 modal：员工市场/Hermes/治理舱/练虾系统）+ 员工（≤6，按名/角色/当前任务匹配）+ 任务（≤4）+ 技能（≤4），关键词大小写不敏感 includes。
- 键盘：↑↓ 移动 `idx`（在 modal 容器 onKeyDown 捕获）、Enter 选中、底栏显示计数。
- `onPick` 分支：page → `setActivePage`；modal → 对应 `setShowX(true)`；employee → `setSelectedEmployee(emp)`（office 页右侧变 Drawer）；task/skill → 只跳到 tasks/skills 列表页（不定位具体条目）。选完 `setOpen(false)`。
- 限制：结果不含 Phase 0 新页面（inbox/roi/execws/myagents/expertportal/evolution），也**不按 currentRole 过滤**——staff 视角也能经 ⌘K 跳进老板的 office/audit 等页。

### 4.4 Toast

- `pushToast({kind,title,detail})` → 追加 `toasts`（id 带随机后缀防同毫秒冲突）；ToastContainer effect 对每条起 4s 定时器自动 `dismissToast`，也可点 X 手关。四种 kind（success/info/warning/error）映射图标与左边框色。transient，不持久化。
- 已知小瑕疵：effect 依赖整个 `toasts` 数组，每新增一条会对旧条目**重建定时器**（等效延长旧 toast 存活）。

### 4.5 审批动作（全局 store 逻辑，多个页面复用）

`approveAlert(id, decision, note)`：
- 状态变化：`riskAlerts` 中目标置 approved/rejected、`pendingApprovals` 重算（TopBar 红 chip 随动）。
- 副作用：① 以 `ROLE_ACTORS[currentRole]` 身份向源频道 push 一条 approval 消息；② 若源频道非 ch-risk，再向 ch-risk **双投**一条「【决策记录】…决策人…源频道…」；③ pushAudit（action 审批通过/拒绝，tags human-in-loop）。
- 其余全局 action（requestExit/decideExit/addGrant/toggleMCP）同模式：改状态 + 头插 auditLog（cap 500）。

## 5. 数据与状态

### 5.1 mock 实时引擎（store 模块底部，window 环境即启动）

单个 `setInterval` **5000ms** 主循环，`beat` 计数分频：

| 节奏 | 条件 | 动作 |
|---|---|---|
| 每 5s | 每 tick | `tick + 1`（驱动 TopBar 完成率滚动、TicketBoard SLA 倒计时等订阅方） |
| ≈15s | `beat % 3 === 0` | 从 6 条 `heartbeats` 轮询取一条 push 进 `collabFeed`（雪/岚/Hermes/苓/炅 的例行播报，cap 尾部 80） |
| ≈10s | `beat % 2 === 0` | 从 5 条 `auditPool` 轮询取一条头插 `auditLog`（cap 500） |
| ≈20s | `beat % 4 === 0` | 从 `a2aHandoffPool`（data/executives）取一条 A2A 委派，**同时**写 auditLog（tags a2a + intent 截断 18 字）和 collabFeed（`[A2A] 委派给 xxx：intent`，feed cap 100） |

引擎直接 `useAppStore.setState`，绕过 action；模块级启动意味着 HMR 下可能叠加多个 interval（生产构建无此问题）。

### 5.2 persist 持久化（key `hummer-v6`，version 1）

`partialize` 白名单（仅这些字段落盘）：

| 字段 | 说明 |
|---|---|
| `activePage` / `leftNav` | 刷新后回到上次页面 |
| `mcpApps` | MCP 连接开关状态 |
| `installedSkills` | 已安装技能 |
| `taskStatuses` | 任务看板拖动结果 |
| `auditLog.slice(0, 60)` | 审计链磁盘上限 60 条（内存 500） |
| `bootDone` | Boot 动画只播一次 |
| `extraTasks.slice(0, 30)` | 会议行动项/派活新任务 |
| `trialDecisions` | 试岗决策 |
| `grants.slice(0, 30)` | 授权仪式记录 |

**不持久化**（刷新重置）：`currentRole`（回 boss）、`activeChannel`（回 ch-q3）、`collabFeed`、`riskAlerts`/`pendingApprovals`、`expertTickets`、`exitActions`、`inboxDone`、toasts/modals/slotIn/drawer/cmdkOpen 等 transient UI。

### 5.3 localStorage 全部 key 清单

| key | 写入方 | 读取方 |
|---|---|---|
| `hummer-v6` | zustand persist | store 启动 rehydrate |
| `hummer-avatar-<员工id>` | EmployeeDrawer.tsx:86（上传头像存 dataURL） | AgentAvatar.tsx:56、EmployeeDrawer.tsx:53 |
| `hummer-marketplace-hires` | Marketplace.tsx:85（雇佣映射 JSON） | Marketplace.tsx:67、Workstations.tsx:280、EmployeesPage.tsx:40/43、data/trial.ts:207（候选合并） |

后两类是**绕过 store 的影子状态**：直接读写 localStorage、无跨组件订阅，写入后其它读取方要等各自重新挂载/主动重读才可见（trial.ts 注释自述曾有三套割裂的招聘状态，现以此 key 收敛）。

### 5.4 ROLE_ACTORS 发言身份机制

`ROLE_ACTORS: Record<RoleKey, { name, avatar, senderRole }>`（useAppStore.ts 导出）：boss=昆仑（您）/ exec=吴帆·销售VP / staff=小周 / expert=林知远·专家（senderRole 'expert'，气泡样式区别于 human）/ auditor=审计员。所有「以我身份发生」的写路径（ChatPage 发言、approveAlert 审批与双投、收件箱处理等）统一取此表，注释明言「不再写死昆仑」。遗留例外：`toggleMCP` 的审计 actor 仍硬编码「昆仑（您）」。

## 6. 模块联动

- **tick** 是全局节拍器：TopBar 完成率、专家工单 SLA 倒计时、任意订阅 tick 的组件每 5s 重渲染。
- **collabFeed** 是消息总线：mock 引擎、审批双投、专家关单通报、各页派活/催办都 push 进来，ChatPage / BottomFlow 按 channel 过滤消费。
- **auditLog** 是事件溯源账本：全局 action + mock 引擎 + 各页面 pushAudit 汇聚，AuditPage / 审计员视角消费；hash 为随机 4 位十六进制装饰。
- **pendingApprovals** 联动 TopBar 红 chip 与收件箱。
- 角色切换是最大的跨模块开关：一次 `switchTo` 触发导航、频道、发言身份、默认页四路重算（见 §4.1）。

## 7. Mock 边界与已知限制

- TopBar 三个实时 chip 中仅「在岗」「待审批」有真数据来源；完成率是 tick 伪随机滚动，模型成本写死。
- ⌘K 不按角色过滤结果、不含 Phase 0 新页，`modal:'kg'` 分支定义了但无条目使用；task/skill 结果只跳列表不定位。
- 角色切换无鉴权概念，仅是视角开关；`currentRole` 不持久化导致刷新后「activePage 还留在专家门户但身份回到 boss」的错位组合（persist 了 activePage 却没 persist currentRole）。
- activeChannel fallback 逻辑寄生在 ChatPage，不在 chat 页时切角色不会即时修正。
- mock 引擎轮询固定文案池，长开页面会看到重复消息；HMR 下 interval 可能叠加。
- BootScreen 仍是 v4 赛博风（LOBSTER FACTORY 霓虹字），与 v6 Notion 风壳视觉断层；文案「12 位数字员工」与 TopBar 的 15 位口径不一致。
- 影子 localStorage（头像/雇佣）无版本号、无清理入口，与 `hummer-v6` 的 persist 生命周期脱节。
