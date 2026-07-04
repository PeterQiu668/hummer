# 我的员工与员工详情（employees）

> 源码：`src/components/pages/EmployeesPage.tsx` · `src/components/drawer/EmployeeDrawer.tsx` · `src/components/ui/AgentAvatar.tsx` · `src/data/employees.ts` · `src/components/exec/ExecutiveDetail.tsx` · `src/data/executives.ts` · 状态：**部分闭环**（详情抽屉跳转/头像上传/审计留痕真实生效；启停、权限调整、分组筛选等为装饰或 toast 占位）

## 1. 定位与对应闭环

「我的员工」是数字员工的**组织架构视图**（按部门 zone 分组的在岗状态），EmployeeDrawer 是单个员工的**全息详情**（身份/任务/技能/权限/审计/进化档案六 tab），ExecutiveDetail 是**高管分身**详情（责任链可视化 + 管辖员工 + A2A 历史）。三者共同支撑「老板巡场：谁在干什么、凭什么权限、干得怎么样、在怎么变强」的信任叙事，并作为进化中心（grills/01 待实现清单②：Drawer 增加进化档案 tab）的个体入口。

## 2. 入口与角色可见性

- **EmployeesPage**：路由页 `activePage === 'employees'`。LeftNav 中 **boss**（员工分组，badge 15）与 **exec**（团队分组）可见；staff / expert / auditor 无入口。
- **EmployeeDrawer**：非路由，`AppShell` 在 `selectedEmployee` 非空时渲染（`AnimatePresence`），**任何页面都会弹出**（右侧固定 380px 面板，替换 office 页的 RightConsole 槽位）。触发源：员工页卡片、3D 办公室工位、ExecutiveDetail 管辖员工列表等所有调用 `setSelectedEmployee(e)` 的地方——因此 staff 等角色也能间接看到。
- **ExecutiveDetail**：modal，`activeExecId` 非空时渲染；目前唯一入口是 office 页 RightConsole 的高管分身列表（`setActiveExecId(ex.id)`），故实际仅 boss 视角可达。

五角色差异一览：

| 角色 | 我的员工页 | EmployeeDrawer | ExecutiveDetail |
|---|---|---|---|
| boss | 有（badge 15） | 可达 | 可达（office 页 RightConsole） |
| exec | 有（团队分组，看到全部 15 人，无部门收窄） | 可达 | 不可达（无 office 导航） |
| staff | 无（用「我的 AI 同事」页替代） | 间接可达 | 不可达 |
| expert | 无 | 间接可达 | 不可达 |
| auditor | 无 | 间接可达 | 不可达 |

## 3. 界面结构

**EmployeesPage**（套 WorkspacePage 壳）：
- 顶部动作区：分组视图 / 筛选（无 onClick，纯装饰）/「招聘新员工」（打开市场 modal）。
- sticky 区：搜索框 + 部门过滤 chips（`ZONE_META` 六区）+ 计数 chip `filtered/total`。
- 正文：①「新招聘 · 沙箱试岗中」区块（读 localStorage `hummer-marketplace-hires` 的市场员工卡）；② 按 zone 分组的员工卡网格（15 位 seed 员工），卡片含 AgentAvatar、状态 chip、当前任务、今日 Token/成本/模型，hover 显示快捷按钮。

部门与状态元数据（页面内定义，非 shared）：

| zone | 中文 | 副题 | 在册员工 |
|---|---|---|---|
| boss | 决策中心 | Boss Office | 林·决策官 |
| business | 业务办公区 | Business Floor | 雪·销售官、岚·运营官、砚·财务官、炅·研发官、璇·数据官、芸·文档官、染·设计师、衍·产品经理、戟·安全官 |
| support | 行政支持中心 | Public Office Zone | 荷·人事官、律·法务官、苓·客服官 |
| meeting | 项目会议室 | Conference Hub | Manager·会议主持 |
| rest | 休息区 | Lounge | 默·营销官 |
| learn | 进化训练区 | Learning | （无在册，仅过滤 chip） |

`STATUS_META`：working 工作中（brand）/ blocked 已阻断（error）/ meeting 会议中（warning）/ training 训练中 / idle 待命（muted）。

**EmployeeDrawer**：Header（可上传头像 + 状态 + 责任链路面包屑）→ 六 tab（身份 overview / 任务 task / 技能 skills / 权限 permissions / 审计 audit / **进化档案 evolution**）→ 滚动 body。

**ExecutiveDetail**：Header（分身名 + 真实高管名衔 + 待回传 badge）→ 责任链路五节点 → 责任边界 → 管辖数字员工 grid → A2A 委派历史 → Footer 两按钮。

## 4. 操作步骤与逻辑

### 4.1 EmployeesPage

| 动作 | 前置 | 状态变化 | 副作用 |
|---|---|---|---|
| 输入搜索 / 点部门 chip | — | 本地 state `q` / `zoneFilter`，`useMemo` 过滤（匹配 name/role/currentTask） | 无 |
| 点「招聘新员工」 | — | `setShowMarketplace(true)` | 打开市场 modal |
| 点员工卡 | — | `setSelectedEmployee(e)` | 右侧弹出 EmployeeDrawer |
| 点试岗员工卡（新招聘区块） | localStorage 有 hires | 无 | 仅 `pushToast` info「沙箱试岗中 · 第 1/7 天 · 完成 5 任务 · 评分 88/100」——**硬编码文案，与 trial.ts 生命周期数据不联动** |
| hover 快捷按钮 Play/Pause、Shield | — | 无（handler 只 `stopPropagation`） | 无——纯装饰 |
| 分组视图 / 筛选按钮 | — | 无 onClick | 无 |

新招聘区块的数据同步：mount 时读 localStorage，并监听 `storage` 事件（配合 Drawer 上传头像时手动派发的 StorageEvent 机制同源）。

### 4.2 EmployeeDrawer

选中员工切换时（`useEffect [e?.id]`）重置 `tab='overview'`、清空打字机 lines、从 localStorage 读该员工头像。

**Header · 上传头像**：点头像 → 隐藏 file input → `onUploadAvatar`：
1. 前置：文件 ≤ 2MB，否则 `pushToast` error「头像过大」。
2. FileReader 转 dataURL → 本地 state `avatarUrl` + 写 localStorage `hummer-avatar-{id}`。
3. 手动 `window.dispatchEvent(new StorageEvent(...))`（同 tab 内 storage 事件不会自发，用于让页面上所有 AgentAvatar 实例即时刷新）。
4. `pushAudit`：actor 昆仑（您）· action 更换 Agent 头像 · ok · tags `[agent, avatar]`；`pushToast` success「已同步到员工列表、首页、对话流、任务 owner」。

**Header · 责任链路**：`executiveTwins.find(x => x.managesEmployeeIds.includes(e.id))` 命中才显示，四节点面包屑：昆仑（老板）→ 昆仑分身（意图入口）→ 高管分身 → 当前执行 Agent（高亮）。未被任何分身管辖的员工（如 emp-hr、emp-doc 等）不显示。

**overview tab 快捷操作（6 个）**：
| 按钮 | 状态变化 | 副作用 |
|---|---|---|
| 指派新任务 | `setActivePage('tasks')` + `setSelectedEmployee(null)` | 跳任务页并关抽屉 |
| 打开对话 | `setActivePage('chat')` + 关抽屉 | 跳对话流 |
| 发起会议 | `setShowMeeting(true)` | `pushAudit`「发起会议」ok · tags `[meeting]`；打开会议室 modal |
| 调整权限 | 无 | `pushToast` info「即将上线 · 当前为占位」 |
| 启动/暂停 Agent | 无（**不改 e.status**） | `pushAudit`「启动/暂停 Agent」ok · tags `[agent]` + toast |
| 回滚最近变更 | 无 | `pushToast` warning「回滚需四眼原则 · 请在审计页提交回滚请求」 |

**overview tab 其余面板**：当前任务 + 进度条（`e.progress`，颜色随状态）；「今日交付」硬编码 3 条（BD 邮件草稿 x3 / Q3 客户清单 / 回访纪要）；运行指标三格（模型 / 今日 Token / 今日成本）。

**task tab**：打字机效果——`setInterval` 700ms 循环追加 `e.taskLines`（模拟员工屏幕数据流，最多 ~11 行后停），`⚠` 开头行标红；LIVE 徽标。纯本地 state，切 tab 或换员工即重置。

**skills tab**：静态渲染 `e.skills`——技能名 + 来源 chip（expert 专家 / marketplace 市场 / builtin 内置）+ 5 格等级条（Lv.1–5）+ 已装备标记。无启停交互。

**permissions tab**：`e.permissions` 权限矩阵——scope + level chip（READ/WRITE/ADMIN/EXTERNAL）+ `approvalRequired` 决定图标与文案（警告△「需人审批准（四眼原则）」vs 绿勾「在授权边界内自动」）；底部固定说明「所有凭证由 HiClaw AI Gateway 统一托管，Agent 不持任何凭证」。

**audit tab**：`e.auditEntries`（员工内嵌审计，非全局 auditLog）——序号 + 时间 + 动作 + 目标 + 审批人，risk==='high' 加红色警告图标；空态「今日暂无审计事件」。

**evolution tab（进化档案）**：
1. 「Hermes 进化指标」四格：`e.evolution` 的 level/badCases/improved/pending。
2. `<EvolutionProfile employeeId={e.id} compact />`：能力分三格（当前/本周Δ/vs 岗位均值）+ 8 周曲线（AbilityCurve compact）+ 最近 3 条 SOP 版本。
3. **「查看完整因果链」按钮**（compact 模式的 `onOpenCenter`）：`setFocusEmployeeId(e.id)`（写 data/evolution.ts 的模块级变量，非 store）→ `setActivePage('evolution')` → `setSelectedEmployee(null)`。进化中心挂载时消费该 id，直接落在 Tab2 并选中该员工——这是 Drawer 与进化中心的跨页定位联动（详见 evolution.md）。

### 4.3 ExecutiveDetail（高管分身详情）

- 打开：RightConsole 高管列表 → `setActiveExecId(id)`；`executiveTwins` 共 5 位：

| 分身 | 真实高管 | 责任边界（摘要） | 管辖员工 | 待回传 |
|---|---|---|---|---|
| 林·CEO 分身 | 林总 · 集团 CEO | 目标拆 OKR，高风险回传老板审批 | emp-ceo | 0 |
| 吴·销售 VP 分身 | 吴 VP · 销售副总裁 | BD 节奏 / 客户分层 / 配额 | emp-sales-1 | 1 |
| 邓·运营 VP 分身 | 邓 VP · 运营副总裁 | 复盘 / 投放 / 内容产线，推 SOP 进化 | emp-ops、emp-design | 0 |
| 宋·产品负责人分身 | 宋 PM | 战略拆需求 + 研发优先级，A2A 派发 | emp-pm、emp-dev | 2 |
| 万·CFO 分身 | 万 CFO | 资金 / 合规 / 合同；>50w 强制四眼回传 | emp-finance、emp-legal | 1 |
- **责任链可视化**：五节点横排——`HUMAN_BOSS`（昆仑·老板）→ `BOSS_TWIN`（昆仑·数字分身）→ 当前高管分身（高亮，用 ex.color）→ 真实高管（如「吴 VP · 销售副总裁」）→ 「数字员工 · N 位执行 Agent」。体现「老板→分身→高管分身→真人高管→执行 Agent」的双人机责任链。
- **管辖员工**：`employees.filter(e => ex.managesEmployeeIds.includes(e.id))`，点某员工 → `setActiveExecId(null)` + `setSelectedEmployee(e)`：关 modal、开 Drawer（模块间接力）。
- **A2A 委派历史**：`a2aHandoffPool.filter(h => h.toId===ex.id || h.fromId===ex.id)`，静态展示 from→to + intent + channel。同一池子被 store 的 mock runtime 每 ~20s 推一条进审计链（tags `[a2a, intent:…]`）与对话流。
- Footer：「打开高管分身会议室」→ `setActivePage('chat')` + 关 modal；「调整责任边界」无 onClick。

### 4.4 AgentAvatar（全局头像组件）

- 底色：`pickShirtColor` 对 id 做 FNV hash 取 6 色盘之一（可被 `shirtColor` 覆盖），渐变填充 + 首字（`defaultInitial` 剥离 `emp-` 类前缀取首字符大写，可传 `initial`）。
- 上传头像：mount 读 localStorage `hummer-avatar-{id}` 并监听 storage 事件 → 有则以图片覆盖底色。
- 状态：`status` 映射颜色环（boxShadow ring，`ringWidth` 可调）+ 右下角状态点。

## 5. 数据与状态

- `data/employees.ts`：15 位 seed 员工（emp-ceo/sales-1/ops/finance/hr/legal/cs/dev/data/doc/meeting-1/design/pm/sec/rest-1），`Employee` 字段一览：

| 字段组 | 字段 | 消费位置 |
|---|---|---|
| 身份 | id / name / role / department / zone / avatar / twin / expert | 卡片、Drawer header、3D 工位 |
| 运行 | status / currentTask / taskLines / progress / model / tokensToday / costToday | 状态 chip、task tab 打字机、运行指标 |
| 能力 | skills[]（level/equipped/source）/ permissions[]（level/approvalRequired）| skills / permissions tab |
| 治理 | auditEntries[]（含 approver/risk）/ risk | audit tab |
| 进化 | evolution（level/badCases/improved/pending/lastUpdate）| Drawer evolution tab 四格、进化中心 Tab2 头部 Lv |
| 空间 | position: [x,y,z] | Office3D 工位坐标 |

  **纯静态**——页面所有指标不随 mock runtime tick 变化；store 心跳推送的对话流/审计事件虽然以「雪·销售官」等同名员工为主角，但不会回写这些字段。
- `data/executives.ts`：5 位 `executiveTwins` + `HUMAN_BOSS`/`BOSS_TWIN` + `a2aHandoffPool`（8 条委派事件，同时被 store mock runtime 消费）。
- store：`selectedEmployee`（transient，不持久化）、`activeExecId`、`auditLog`/`toasts`。
- localStorage：`hummer-marketplace-hires`（试岗区块）、`hummer-avatar-{id}`（头像）。

## 6. 模块联动

- **→ 员工市场**：招聘新员工按钮；试岗区块消费市场的 localStorage hires。
- **→ 进化中心**：Drawer 进化档案 tab 复用 `EvolutionProfile`（与进化中心 Tab2 同源组件），并通过 `setFocusEmployeeId` 实现跨页定位。
- **→ 任务 / 对话 / 会议**：快捷操作跳转 `tasks`/`chat` 页、打开 MeetingRoom。
- **→ 审计链**：头像更换、发起会议、启停 Agent 写入全局 auditLog（tags agent/meeting/avatar）。
- **→ 3D 办公室**：同一批员工渲染在 OfficeStage3D 工位，点击工位同样 `setSelectedEmployee` 打开本 Drawer；Drawer 的 `top-12 bottom-[276px]` 定位是按 office 页（底部 276px IM 流）设计的。
- **ExecutiveDetail ↔ Drawer**：管辖员工列表点击接力打开员工详情。

## 7. Mock 边界与已知限制

- 启动/暂停 Agent 只写审计 + toast，**不改变员工 status**；调整权限、回滚、调整责任边界均为占位。
- 分组视图/筛选按钮、Card hover 的 Play/Shield 无实现。
- 试岗区块与生命周期看板脱节：固定显示「试岗 1/7 天 · 评分 88」，退回市场/已转正的候选仍出现在这里（localStorage 不清理）；转正员工也不会进入 15 人组织架构。
- 今日交付列表（overview tab）是硬编码 3 条，与任务/证据模块无关联。
- Drawer 在非 office 页打开时布局仍预留底部 276px（BottomFlow 只在 office 显示），存在空档。
- 员工内嵌 auditEntries 与全局审计链是两套数据，不互通。
- exec 角色能看到全部 15 位员工而非仅本部门（页面无按 currentRole 过滤）。
