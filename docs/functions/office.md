# 指挥中心 / 3D 办公室（office）

> 源码：`src/components/office/OfficeStage3D.tsx`（入口，含 L2/L1 平台条）、`Workstations.tsx`（工位 + 体素小人）、`ZonePlatform.tsx`（6 分区平台 + ZONE_SPECS）、`HexPlatform.tsx`（六边形基座）、`CityBackground.tsx`（城市剪影背景）、`CameraRig3D.tsx`（GSAP 相机飞行）、`Lighting.tsx`（灯光）；外围：`shell/AppShell.tsx`（布局槽位）、`shell/RightConsole.tsx`（右侧组织台）、`shell/BottomFlow.tsx`（底部 IM 流）、`drawer/EmployeeDrawer.tsx`（选中员工右侧面板）· 状态：**有交互闭环**（选中/聚焦/审批链路真实写 store，但场景数据全静态）

## 1. 定位与对应闭环

- 产品默认首页（`store.activePage` 初始值 `'office'`），承担「老板巡场」心智：一屏看到 15 位数字员工在 6 个分区的实时状态，配合右侧组织脉搏与底部 IM 流，构成「组织透明 → 发现异常 → 点击介入」的观察-介入闭环。
- 视觉叙事为三层架构：L3 Agent Workforce（3D Canvas，视觉重点）→ L2 Agent OS（透视斜面 DOM 条：调度/路由/A2A/MCP/审批/风险）→ L1 Data OS（更深透视 DOM 条：知识图谱/业务数据/流程/权限/审计/凭证）。L2/L1 仅是装饰性静态条，无任何点击行为。
- 真正的闭环动作（风险审批、发消息）发生在挂靠本页的 BottomFlow，而非 3D 场景本身。

## 2. 入口与角色可见性

- **boss**：LeftNav「工作」组第一项「指挥中心」（`IT.office`），且为角色 home（TopBar `ROLES` 中 boss.home = 'office'，切回 boss 视角自动落到本页）。
- **exec / staff / expert / auditor**：`LeftNav.ROLE_SECTIONS` 中均**没有** office 项，切换角色时 `RoleSwitcher.switchTo` 会 `setActivePage(target.home)` 跳到各自工作台（execws / myagents / expertportal / audit）。
- 页面本身不做角色守卫：`activePage` 被 persist（key `hummer-v6`），若某角色状态下 store 里残留 `activePage==='office'`（例如手动改 localStorage 或未来出现其他入口），任何角色都能渲染本页。
- 布局联动（AppShell）：仅当 `activePage==='office'` 时渲染 RightConsole（右 320px）与 BottomFlow（底 276px / h-72）；选中员工时右槽换成 EmployeeDrawer（380px），中央画布 `right` 随之从 320px 过渡到 380px。

## 3. 界面结构

```
AppShell
├─ TopBar（页面标题「指挥中心」+ 在岗/完成率/成本 LiveChip + 待审批红点 + ⌘K + 角色切换）
├─ LeftNav（240px）
├─ 中央 OfficeStage3D
│   ├─ L3：react-three-fiber <Canvas>（dpr [1,1.6]，ACES tone mapping，背景 #1A1B1E）
│   │   ├─ PerspectiveCamera（初始 [0,22,28]，fov 38）
│   │   ├─ OrbitControls（禁平移，距离 12–45，极角 0.15π–0.45π，阻尼 0.08）
│   │   ├─ CameraRig3D（gsap 飞行，见 §4）
│   │   ├─ CityBackground（背景色/fog #0a0f1e + 8 片程序化城市剪影，每片 14 栋楼 + 随机发光窗）
│   │   ├─ Lighting（ambient 0.45 + 主 directional 0.85 + 紫色补光 0.3 + Environment "night" + ContactShadows，全程不用 castShadow）
│   │   ├─ HexPlatform（半径 16 六边形 ExtrudeGeometry 基座 + 3 根 additive 体积光柱 + 中心光晕）
│   │   ├─ ZonePlatform ×6（ZONE_SPECS：boss 决策中心 / business 业务办公区 / support 行政支持 / meeting 会议室 / rest 休息区 / learn 充电进化区；圆角挤出平台 + Edges 描边 + 可选玻璃墙(meshPhysicalMaterial transmission 0.9) + 可选楼梯(6 级) + 双行 Text 标签 + 地面光圈）
│   │   └─ Workstations（15 个在编工位 EmployeeFigure + 空桌 Instances + 招聘试岗小人 HiredFigures）
│   ├─ L2 PlatformStrip（CSS perspective rotateX(14deg)，6 个静态 pill）
│   └─ L1 PlatformStrip（rotateX(22deg)，6 个静态 pill）
├─ 右槽：RightConsole 或 EmployeeDrawer（互斥）
└─ 底槽：BottomFlow（左 200px 频道列表 / 中消息流+输入框 / 右 240px 频道任务）
```

**ZONE_SPECS 分区配置**（`ZonePlatform.tsx` 导出，被 Workstations / CameraRig3D 复用）：

| id | 中文 | 中心 (x,z) | 尺寸 | 颜色 | 抬高 | 特性 |
|---|---|---|---|---|---|---|
| boss | 决策中心 | (9.5, -7.5) | 7×5.5 | #A855F7 | 1.5 | 玻璃墙 + 楼梯 |
| business | 业务办公区 | (0, -1) | 10.5×6 | #3B82F6 | 0.3 | — |
| support | 行政支持 | (-9, -3) | 5.5×5 | #14B8A6 | 0.4 | — |
| meeting | 会议室 | (6.5, 4) | 5.5×4.5 | #7E22CE | 0.5 | 玻璃墙 |
| rest | 休息区 | (9, 7.5) | 5×4 | #F59E0B | 0.35 | — |
| learn | 充电进化区 | (-6, 5.5) | 7×4.5 | #10B981 | 0.4 | — |

**工位坐标映射**（`getPos3D`）：`data/workstations.ts` 里的工位是基于 1024×558 背景图的百分比坐标（历史遗留自 2D 方案），3D 化时以 `ZONE_2D_CENTERS`（每分区的 2D 中心）为锚点做仿射变换：`x3d = spec.center[0] + (ws.x - c2d.x) × (spec.size[0]×0.35/10)`，z 同理（除数为 8），y = `spec.elevation + 0.02`。

**体素小人**（`Workstations.tsx` 内部 `VoxelHuman`）：
- 上身/双臂 BoxGeometry 按状态色发光：working #0F70B7 蓝 / meeting #7E22CE 紫 / training #0F766E 青 / blocked #C13D3D 红 / idle #6B7280 灰（`STATUS_COLOR`）；
- 颈 + 大头 chibi 比例 + 头发顶盖 + 两个 basicMaterial 眼睛方块；
- 肤色由 `hashCode(employee.id) % 3` 从 `SKIN_TONES` 确定（确定性，不随刷新变）；发色按分区 `ROLE_HAIR` 映射；
- 选中时躯干 emissiveIntensity 0.18→0.7、双臂 0.12→0.5，脚下出现 ringGeometry 选中圈（半径 0.5–0.66）。
- 每个 EmployeeFigure 另含椅子(2 mesh)+桌板桌腿(3)+显示器/支架/屏幕(3)，合计约 15 个独立 mesh + 1 个 drei `<Text>` 名牌（选中时名牌变状态色）。

## 4. 操作步骤与逻辑

### 4.1 拖拽 / 缩放场景
- 前置：进入 office 页。
- 操作：鼠标拖拽旋转、滚轮缩放（OrbitControls；顶部右侧有操作提示文案）。
- 状态变化：无 store 写入，纯相机本地状态。
- 副作用：无。相机飞行动画播放期间 `controls.enabled=false`，结束后恢复。

### 4.2 点击分区平台 → 聚焦分区
- 前置：未选中员工（选中员工的相机目标优先级更高）。
- 操作：点击任一 ZonePlatform 平台面（hover 时 emissive 提亮 + cursor pointer）。
- 状态变化：`store.activeZone = spec.id`；再次点击同一分区 toggle 回 `null`。
- 副作用：CameraRig3D 的 useEffect 监听 `[activeZone, selectedEmployee]`，用 gsap（1.4s，power3.inOut）把相机飞到 `[zx*0.7, 9, zz+10]`、看向分区中心、fov 42；activeZone 清空则飞回 OVERVIEW（[0,22,28]，fov 38）。平台材质变为分区色、地面光圈透明度 0.18→0.5。**不写审计、无 toast**。

### 4.3 点击工位体素小人 → 选中员工 → 右侧 Drawer
- 前置：该工位绑定了 `employeeId`（data/workstations.ts 中 15/25 个工位有绑定）。
- 操作：点击小人（`VoxelHuman.onClick`，stopPropagation 防止穿透触发分区点击）。
- 状态变化：`store.selectedEmployee = employee`（完整 Employee 对象，来自 `data/employees.ts` 静态数据）。
- 副作用链：
  1. AppShell 卸载 RightConsole，`<AnimatePresence>` 挂入 EmployeeDrawer（380px），中央画布右边界动画到 380px；
  2. CameraRig3D 飞近该员工工位（`getEmployeePos3D` 用与 Workstations 相同的 2D→3D 映射公式重复实现了一份），机位 `[ex+2, ey+1.2, ez+2.5]`，fov 35；
  3. 小人 emissive 增强 + 选中圈 ring 出现，名牌变为状态色。
- Drawer 内的后续操作（属员工模块，此处仅列与本页联动的部分）：关闭 Drawer → `setSelectedEmployee(null)` → 相机飞回全景/分区；「发起会议」`pushAudit({actor:'昆仑（您）', action:'发起会议', tags:['meeting']})` + `setShowMeeting(true)`；换头像 `pushAudit(tags:['agent','avatar'])` + toast；启停 Agent `pushAudit(tags:['agent'])`。
- 分支：RightConsole「实时员工状态」列表（前 8 位）点击行同样 `setSelectedEmployee(e)`，效果一致——这是不点 3D 也能选中员工的第二入口。

### 4.4 招聘员工出现在过渡区（localStorage 轮询机制）
- 前置：在员工市场（Marketplace modal）完成「招聘」，Marketplace 把 `{ [marketId]: true }` 写入 `localStorage['hummer-marketplace-hires']`。
- 机制：`Workstations` 挂载时 useEffect ①立即 `read()` 解析该 key；②监听 `storage` 事件（只覆盖**跨 tab** 写入）；③因同 tab 的 `localStorage.setItem` 不触发 storage 事件，额外用 **`setInterval(read, 4000)` 每 4 秒轮询**兜底 —— 即同 tab 招聘后最多延迟 4s 小人才出现。
- 状态变化：组件本地 `hiredIds: string[]`（非 store）。
- 副作用：`HiredFigures` 按 `marketEmployees.filter(id∈hiredIds)` 在坐标 `[3+col*2.2, 0.02, 8+row*2.2]`（休息区/过渡区外侧，3 列网格）渲染简化工位（一张桌 + 体素小人），名牌为琥珀色「{name} · 试岗中」。
- 限制：试岗小人 `onClick` 仅 `stopPropagation()`，**点击无任何效果**（不开 Drawer、不选中）；位置写死不属于任何 ZONE_SPECS 分区；无退租/淘汰后的移除动画（靠轮询读到 false/删除后直接消失）。

### 4.5 RightConsole 交互（office 页专属右栏）
- 点击「高管分身链路」某高管 → `setActiveExecId(ex.id)` → AppShell 挂 ExecutiveDetail 全屏 modal。
- 点击「Hermes 进化飞轮」→ `setShowHermes(true)`；「HiClaw 治理舱」→ `setShowGovernance(true)`。
- 展示数据：4 格组织脉搏由 `employees` 静态数组 filter 统计；`LIVE {92+(tick*7)%8}%`、footer「Agent 调用次数/费用」由 store 心跳 `tick`（5s 自增）驱动的**假波动**。

### 4.6 BottomFlow：消息与高危审批（本页最重的闭环）
- **红色横幅**：`pendingApprovals > 0`（初始 3 条 `initialRiskAlerts` 全 pending）时显示「N 个高危待审批」，点击 → 本地 `openAlertId = 第一条 pending`，弹 RiskAlertModal。消息流中 guardian 的 alert 消息也可点击（启发式按 channel 匹配当前 pending alert 绑定 `riskAlertId`）。
- **审批**：Modal 三个按钮 → `approveAlert(id, 'approve' | 'reject', note?)`（「更安全方式」= reject + note '改为更安全方式'）。store 内一次事务完成：
  - `riskAlerts[i].status` → approved/rejected，`pendingApprovals` 重算；
  - 往源频道 push 一条 approval 类 collabFeed 消息（发言人取 `ROLE_ACTORS[currentRole]`，随角色变化）；若源频道非 `ch-risk` 再**双投**一条【决策记录】到 ch-risk；
  - 写审计：`{actor: 角色名, action: '审批通过'/'拒绝', target: alert.action, result: ok/blocked, tags: ['human-in-loop']}`。
- **发消息**：输入框回车或「发送」→ `pushCollabMessage`，sender **写死「昆仑（您）」**（未接 ROLE_ACTORS，与审批链路不一致）；输入 `@` 弹 MentionPicker，选中把 handle 拼进草稿。含 @ 的消息 type 记为 mention，仅样式差异，**不会真的通知/派活**。
- **切频道**：左栏 ChannelList 点击 → `setActiveChannel(id)`（store，含 extraChannels：#部门·财务、林·决策官 DM）；LeftNav「活跃频道」点击则同时 `setActiveChannel + setActivePage('chat')` 跳全屏对话流，不是留在本页。
- **其他**：「拉入会议室」→ `setShowMeeting(true)`；「拉人入群」、回形针按钮无 onClick（纯摆设）。消息流 = `feishuMessages + hermesNotices + collabExtraMessages`（静态）+ `collabFeed`（动态）按频道过滤、按 ts 字符串排序合并；m2/m9 两条静态消息硬编码附挂 taskCard（tk-sales-q3 / tk-legal-review）。

### 4.7 后台心跳（store 模块级 setInterval，5s 一拍，影响本页观感）
- 每拍：`tick + 1`（驱动 RightConsole LIVE%、footer 调用数、TopBar 完成率假波动）；
- 每 3 拍（≈15s）：从 6 条 `heartbeats` 轮询 push 一条员工消息进 `collabFeed`（保留最近 80 条）；
- 每 2 拍（≈10s）：从 5 条 `auditPool` push 一条审计（auditLog 上限 500）；
- 每 4 拍（≈20s）：从 `a2aHandoffPool` push 一条「A2A 委派」审计 + 对应频道消息（tags: `['a2a', 'intent:…']`）。
- 该 interval 在模块加载时启动、永不清理，离开 office 页仍在跑。

## 5. 数据与状态

| 数据 | 来源 | 性质 |
|---|---|---|
| 员工 15 人（状态/任务/token/成本） | `data/employees.ts` | 静态，状态永不变化 |
| 工位 25 个（15 绑定 + 10 空） | `data/workstations.ts` | 静态，2D 百分比坐标经 `getPos3D` 仿射映射到 3D |
| 分区 6 个 | `ZonePlatform.ZONE_SPECS` | 组件内常量（被 Workstations/CameraRig3D 复用） |
| 招聘名单 | `localStorage['hummer-marketplace-hires']` | 跨模块副通道，不在 zustand 内 |
| `activeZone` / `selectedEmployee` | store（不持久化） | 刷新即回全景 |
| `riskAlerts` / `pendingApprovals` / `collabFeed` | store（不持久化） | 刷新回到初始 3 条 pending |
| `auditLog` | store，persist 前 60 条 | 审批/会议/头像等动作追加 |
| `tick` | store，5s 心跳 | 驱动 RightConsole/TopBar 假数字与 mock 消息 |

**在用 vs 死代码（office/ 目录 18 个文件）**：

- 在用 7 个：`OfficeStage3D.tsx`、`Workstations.tsx`、`ZonePlatform.tsx`、`HexPlatform.tsx`、`CityBackground.tsx`、`CameraRig3D.tsx`、`Lighting.tsx`。
- **死代码 11 个（全部无任何外部引用，约 3000 行）**：
  - 旧 3D 方案簇：`Office3D.tsx`（旧入口，唯一引用下列 5 个）→ `CameraRig.tsx`、`Zone.tsx`、`Workstation.tsx`、`OfficeFloor.tsx`、`FloatingParticles.tsx` —— Office3D 本身无人 import，整簇皆死；
  - 更早的 2D 方案：`OfficeSVG.tsx`（818 行）、`OfficeImage.tsx`（590 行）、`OfficeImageNeon.tsx`（400 行）、`scenePositions.ts`；
  - `VoxelHuman.tsx`（443 行）：独立精细版体素小人，未被引用——当前在用的 VoxelHuman 是 `Workstations.tsx` 内部另写的简化版，两者同名易混淆。

## 6. 模块联动

- → 员工 Drawer：点小人/右栏列表选中，Drawer 动作写审计（详见员工模块文档）。
- → 员工市场：localStorage 招聘名单 → 3D 试岗小人（单向，4s 轮询）。
- → 风险/审批：BottomFlow 与收件箱（InboxPage）共享同一份 `store.riskAlerts`，任一侧审批另一侧同步消失；审批写入 `auditLog` 在审计链页可见，`pendingApprovals` 驱动 TopBar 红点。
- → 高管/治理/进化/会议：RightConsole 与 BottomFlow 按钮打开 ExecutiveDetail、GovernanceCabin、EvolutionFlywheel、MeetingRoom 弹层。
- ← 角色切换：切离 boss 即离开本页；RightConsole/BottomFlow 随本页整体消失。

## 7. Mock 边界与已知限制

1. **场景是静态布景**：员工状态、任务文案永不变化；小人无动画（不打字、不走动）；L2/L1 平台条的所有数字（186/5min、12 已连接等）全部写死在 JSX。
2. **性能风险（无 LOD、无按需渲染）**：Canvas 未设 `frameloop="demand"`，OrbitControls 阻尼 + ContactShadows（默认持续重渲染）导致空闲时也满帧渲染；15 个 EmployeeFigure 各约 15 个独立 mesh + 名牌 Text（troika 逐字建纹理），CityBackground 8 片 × 14 栋楼 + 数百个窗户 plane 均为独立 mesh，仅空桌用了 `<Instances>`，人物/楼宇/窗户没有 instancing 或 merge，也没有任何 LOD/视锥剔除策略；工位增多（招聘）线性加 draw call。中低端机型上叠加 BottomFlow 的 5s setInterval 与 4s localStorage 轮询，掉帧风险明确。
3. **坐标映射逻辑重复**：`ZONE_2D_CENTERS` + 2D→3D 公式在 `Workstations.tsx` 与 `CameraRig3D.tsx` 各复制一份（注释自认「避免循环依赖」），改工位布局需同步两处，否则相机对不准人。
4. 试岗小人不可交互、不进组织统计（RightConsole 4 格仍按静态 15 人算）。
5. 分区聚焦/选中员工**不写审计**，与「一切动作可追溯」的产品叙事不一致。
6. `activeZone` 无 UI 复位按钮（只能再点一次同分区或点员工再关闭）；OrbitControls 用户拖走后没有「回到全景」快捷入口。
7. BottomFlow 的「拉人入群」「附件」为无逻辑按钮；发消息身份写死昆仑，切到其他角色发言身份不变（与 approveAlert 用 ROLE_ACTORS 的行为割裂）。
