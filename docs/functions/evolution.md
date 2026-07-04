# 进化中心（evolution）

> 源码：`src/components/pages/EvolutionCenterPage.tsx` · `src/components/evolution/{OrgOverviewTab,EvolutionProfile,AbilityCurve,CausalChain,MechanismTab}.tsx` · `src/data/evolution.ts` · `src/data/hermes.ts` · `src/data/douyin.ts`（SopVersion）· 关联旧组件 `src/components/hermes/EvolutionFlywheel.tsx` · 状态：**纯展示**（除 tab 切换 / 员工选择 / case 展开外无写操作，不产生审计与 toast）

## 1. 定位与对应闭环

直接实现 `docs/grills/01-growth-loop.md` 的结论：把「成长闭环（个体视角）」与「质量飞轮（版本视角）」合并为一个独立模块，**进化中心 = SOP/技能版本迭代的唯一机制来源**。三层视图对应 grill 的三层设计：

| 层 | Tab | 老板看到什么 |
|---|---|---|
| 组织层 | Tab1 组织层总览 | 「我的数字团队整体在变强」（本月 SOP 升级数 / 平均能力分 / bad case 修复率 / 进化 ROI） |
| **个体层（核心新增）** | Tab2 个体进化档案 | 「这个员工上周错、这周对，因为什么」——能力分曲线 + SOP 版本时间线 + **因果链** |
| 机制层 | Tab3 机制层飞轮 | 「进化是受控的，有沙箱有人审」——5 阶段管道 + 策略配置 + trace |

拟人化作为翻译层保留：淘汰 = 连续 N 次进化失败（Tab1 淘汰建议事件、试岗侧 m-25 退回均按此口径），考核 = 持续在线评测（部门对比卡脚注写明「月度报告仅为快照」）。

## 2. 入口与角色可见性

- **路由页** `activePage === 'evolution'`（AppShell 注册）。LeftNav 仅 **boss** 的「经营与治理」分组有「进化中心」项（`IT.hermes`，key 已从 modal 改为 `'evolution'` 页面，badge 47）；exec / staff / expert / auditor 无导航入口。
- **跨页入口**：EmployeeDrawer 进化档案 tab 的「查看完整因果链」按钮（任何能打开 Drawer 的视角都可跳入，绕过导航限制）。
- **旧 EvolutionFlywheel（质量与复盘 modal）仍并存**：由 `showHermes` 控制，触发点有三处——3D 办公室 learn 区点击（Office3D）、RightConsole 按钮、CommandPalette；LeftNav 的 `highlight === 'hermes'` 分支代码残留但 `IT.hermes` 已不带该 highlight，导航路径已切到新页。见 §7。

五角色差异一览：

| 角色 | 导航入口 | 实际可达路径 | 页面内差异 |
|---|---|---|---|
| boss | 有（经营与治理 · 进化中心） | 直达三层视图 | 无（页面不读 currentRole） |
| exec | 无 | 我的员工 → Drawer 进化档案 → 查看完整因果链 | 与 boss 完全相同 |
| staff | 无 | 理论上任何 setSelectedEmployee 入口（如 3D 工位）→ Drawer 跳转 | 同上 |
| expert | 无 | 同上 | 同上 |
| auditor | 无 | 同上 | 同上 |

## 3. 界面结构

WorkspacePage 壳，sticky 区三个 TabBtn（组织层总览 / 个体进化档案 / 机制层飞轮）。

- **Tab1 OrgOverviewTab**：
  - 四指标卡（`orgOverview`）：本月 SOP 升级 **12**（较上月 +4）· 平均能力分 **76 → 81** · Bad case 修复率 **87%**（47/54）· 进化 ROI **+312 人时**（一次通过率 82%→91% 折算返工人时）。
  - 总览横幅：一句话口号（「7 月数字团队整体在变强…12 次 SOP 升级全部经沙箱回归与人审」）+ 下钻提示（每一分提升都可到个体档案看因果链）。
  - 左 3/5「本月进化事件」时间线：7 条 `evolutionEvents`，四种 kind——`sop` 升级（如「资金调拨 v3→v4，沙箱阻断率 0%→100%」）、`skill` 上架（「BD 邮件 v3.2，回复率 8.2%→26.6%」）、`cert` 重新认证（璇·数据官 GEPA 补样本后 96.1%）、`eliminate` 淘汰建议（「私域销售 v1 连续 3 次进化失败，建议版本下线 · 已进老板收件箱」——落实 grill「淘汰=进化失败 N 次」的口径）。
  - 右 2/5「各部门能力分对比」：5 部门双条形（灰=上月 / 蓝=本月，如业务办公区 76→81），脚注声明能力分口径「持续在线评测（任务通过率 × 验收质量 × 风险事件），月度报告仅为快照」。
- **Tab2 ProfilesTab**：左 240px 员工列表（15 位按 currentScore 降序，行内显示能力分 + 周Δ趋势图标，有因果链的员工带「因果链」徽标）+ 右侧 `EvolutionProfile` 全幅档案。
- **Tab3 MechanismTab**：5 阶段横向管道（detected→optimizing→sandbox→review→shipped，计数来自 `evolutionStats`：23/12/9/6/47）→ 进化策略四卡（`evolutionConfig`：每 6 小时 / $80/天成本上限 / 风险阈值「中」/ 强制人审开启）→ bad case 明细表（按阶段倒序分组，行可展开 trace）。

`EvolutionProfile` 是**双形态复用组件**：进化中心 Tab2 全幅模式（曲线 + 同岗位对比卡 + 因果链卡 + 完整 SOP 时间线）与 EmployeeDrawer 紧凑模式（三格指标 + 小曲线 + 最近 3 条版本 + 因果链入口按钮）。

## 4. 操作步骤与逻辑

### 4.1 focusEmployeeId 跨页定位机制（Drawer → 进化中心）

实现位于 `data/evolution.ts` 顶部——**模块级变量而非 store**：

```
let focusEmployeeId: string | null = null;
setFocusEmployeeId(id)       // 写
consumeFocusEmployeeId()     // 读并清空（一次性消费）
```

链路：
1. EmployeeDrawer 进化档案 tab 点「查看完整因果链（78 → 85）」→ `setFocusEmployeeId(e.id)` → `setActivePage('evolution')` → `setSelectedEmployee(null)`（关抽屉）。
2. AppShell 切到 evolution 页，`EvolutionCenterPage` **重新挂载**，`useState` 惰性初始化中调用 `consumeFocusEmployeeId()`：
   - 有 focus → 初始 `tab='profiles'`、`selectedId=focus`（直达该员工档案）；
   - 无 focus（从 LeftNav 进入）→ 初始 `tab='org'`、`selectedId='emp-sales-1'`。
3. 消费后变量清空，刷新/再次进入不会残留定位。

依赖前提：AppShell 按 `activePage` 条件渲染，页面每次进入都重新挂载，惰性初始化必然执行；该机制不持久化、不进 devtools，是轻量的一次性信道。

### 4.2 Tab 切换与员工选择

| 动作 | 前置 | 状态变化 | 副作用 |
|---|---|---|---|
| 点三个 TabBtn | — | 本地 state `tab` | 无（无审计/toast） |
| Tab2 左列点员工 | — | 本地 state `selectedId`（由页面持有，切 tab 不丢） | 右侧档案切换 |
| Tab3 点 case 行 | — | 本地 state `openCase`（单开互斥，再点收起） | 展开该 case 的改进方案 + trace |

### 4.3 因果链 8 步结构（grills/01 的灵魂）

`CausalChain.steps` 固定 8 步，`CausalChainCard` 以垂直时间线渲染，每步含 kind 图标/配色、时间戳、标题、detail。以 emp-sales-1（BD 邮件链，bc-2，能力分 78→85）为例逐步说明：

| # | kind | 标签 | 该步含义（以 cs-1…cs-8 为例） |
|---|---|---|---|
| 1 | `badcase` | Bad case（红） | 周一 09:14 触发点：BD 邮件 7 天零回复，反馈环判定失败，引用 hermes.ts 的 case bc-2 |
| 2 | `attribution` | 归因（紫） | 周一 09:18 Hermes 定位根因：问候段过于通用被网关识别为营销模板 |
| 3 | `candidate` | 候选版本（蓝） | 周一 10:05 GEPA 生成改进候选：Skill v3.1 → v3.2（问候段引入互动史前 3 件事） |
| 4 | `sandbox` | 沙箱回归（青） | 周二 02:00 重放 5 条历史同类任务 4/5 → 5/5；A/B 回复率 8.2% → 26.6% |
| 5 | `approval` | 人审（橙） | 周二 09:30 昆仑（您）审批：确认不涉敏、无越权外发（财务链为「昆仑 + 律·法务官」双签） |
| 6 | `gray` | 灰度（蓝） | 周二 10:00 v3.2 灰度到该员工：10% 流量观察 2 小时 → 放量 100% |
| 7 | `success` | 任务成功（绿） | 周四 11:20 同类任务验证：鲲鹏制造 BD 邮件 2 小时获回复，验收一次通过 |
| 8 | `score` | 能力分（蓝） | 周四 18:00 周度在线评测重算：能力分 78 → 85，进入岗位前 20% |

即「周一犯错 → 周四变强」的完整可追溯证据链。卡片头显示 `scoreFrom → scoreTo` 徽标，脚注「引用 bad case #bc-x · 全链路入审计账本，可在审计页回放」（仅文案，无跳转实现）。目前仅 2 条链：emp-sales-1（bc-2）与 emp-finance（bc-1，74→82，8 步同构）；其余 13 位员工档案显示「近 4 周无 bad case 触发的完整因果链 · 稳定运行期」占位。

### 4.4 Tab2 档案内容拼装

`EvolutionProfile(employeeId)` 汇集三份数据：
- `getAbilityProfile`（evolution.ts）：8 周能力分 `points`（含 `bump` 版本升级标注）、currentScore/weekDelta/roleAvgScore。`AbilityCurve` 纯 SVG 绘制：折线 + 面积 + 网格，bump 周画紫点 + 虚线 + 版本号文本（紧凑模式省略文本），末点标当前分。
- `getCausalChain`（evolution.ts）→ CausalChainCard。
- `sopVersions.find(s => s.agentId === employeeId)`（**douyin.ts 的 SopVersion**）：当前版本 / 累计训练轮次 / 上次升级时间 + history（round/version/accuracy/cost/note）。accuracy≥90 绿色、accuracy===0 显示红色「失败」（emp-finance 的 v3.0「138w 阈值判断错误」）。仅 5 位员工有记录（emp-ceo/sales-1/finance/legal/data），其余显示「暂无版本记录 · 内置 SOP 基线版本」。
- 同岗位对比卡：本人 vs `roleAvgScore` 双进度条 + gap 提示（「高于岗位平均 N 分 · 岗位口径：平台同类 Agent 在线评测」）。

### 4.5 Tab3 机制层明细

5 阶段管道各格显示：阶段名（发现/优化中/沙箱评测/人审/已上线）+ 英文态 + 全局计数（`evolutionStats`）+「本页示例 N 例」；管道右上角显示累计运行 184 次 / 平均增益 +18.4% / 累计成本 $487.20；底部固定说明「进化是受控的：候选改进必须通过沙箱回归，涉敏/涉资金变更强制人审，上线后灰度放量并持续复测」。

Bad case 明细按阶段**倒序**（shipped 在前）分组列出 5 条 `hermesBadCases`：

| case | 员工 | 阶段 | 增益 |
|---|---|---|---|
| bc-2 BD 邮件被识别为模板 | 雪·销售官 | shipped | 回复率 8.2%→26.6% |
| bc-3 合同条款漏标 | 律·法务官 | review | 召回率 81%→94% |
| bc-1 资金调拨触发风控 | 砚·财务官 | sandbox | 阻断率 0%→100% |
| bc-4 客服情绪误判 | 苓·客服官 | optimizing | 准确率 78%→91%（评测中） |
| bc-5 复盘报告漏指标 | 岚·运营官 | detected | 待评测 |

CaseRow 展开后：改进方案一行 + `traces.find(t => t.caseId === c.id)`（hermes.ts，仅 bc-1/2/3 有）——任务名/耗时/tokens/成本/失败点摘要 + 逐行执行轨迹（kind：REASON 紫 / TOOL 蓝 / OBS 绿 / FAIL 红底高亮，如 bc-1 的「阈值判断错误：SOP v3 未识别 138w > 50w 的强制审批分支」），无 trace 的 case（bc-4/5）显示「尚未生成执行轨迹 · 归因排队中」。trace 与因果链是同一故事的两个视角：trace 是失败现场逐行回放，因果链是失败之后的修复叙事。

## 5. 数据与状态

- `data/evolution.ts`（本模块专属 mock，类型自包含不动 lib/types.ts）：`orgOverview`、`evolutionEvents`(7)、`deptScores`(5)、`abilityProfiles`(15 位全覆盖，8 周分数 + bump 版本标注，`weekDelta` 由最后两周差值派生)、`causalChains`(2) + focusEmployeeId 信道。头注释明确「employeeId/名字与 employees.ts 一致；bad case 引用 hermes.ts；SOP 版本复用 douyin.ts」——三份数据靠 id 约定对齐，无类型层强约束。
- `data/hermes.ts`（与旧 flywheel 共享）：`hermesBadCases`(5)、`evolutionStats`（管道计数 + 累计运行/成本/增益）、`traces`(3)、`evolutionConfig`（策略卡：`evolutionFreqHours: 6` / `costCapPerDay: 80` / `riskThreshold: 'medium'` / `humanReviewRequired: true`）。
- `data/douyin.ts` 的 `SopVersion`（lib/types.ts 定义：agentId / current / trainedRounds / lastBumpAt / history[round, version, accuracy, cost, note]）——SOP 版本时间线唯一来源，同时被 LobsterLab 使用：

| agentId | 当前版本 | 训练轮次 | 档案中的看点 |
|---|---|---|---|
| emp-ceo | v6.1 | 19 | OKR 拆解 96.4% |
| emp-sales-1 | v3.2 | 14 | v2.1(64.2%)→v3.0(78.4%)→v3.2(92.6%)，与因果链 bc-2 呼应 |
| emp-finance | v4.0 | 22 | v3.0 accuracy 0 显示红色「失败」（138w 阈值判断错误），与 bc-1 呼应 |
| emp-legal | v2.7 | 17 | KG 加「合同-法规-行业」边 94% |
| emp-data | v5.1 | 11 | GEPA 补样本 96.1%，对应 Tab1 cert 事件 |

- 本地 state 仅 `tab` / `selectedId` / `openCase`；**不读写 zustand store**（除跳转入口在 Drawer 侧调用 `setActivePage`），不持久化——刷新后回到组织层默认态。

## 6. 模块联动

- **EmployeeDrawer**：进化档案 tab 内嵌 `EvolutionProfile compact`（同源组件保证 Drawer 与中心数据一致），「查看完整因果链」经 focusEmployeeId 信道跳转定位（§4.1）。
- **员工数据**：Tab2 左列直接消费 `data/employees.ts` 的 15 位员工与其 `evolution.level`（档案头部 Lv 徽标来自 employees.ts，而能力分来自 evolution.ts——两套指标并排展示）。
- **审计链 / 收件箱（叙事层联动）**：因果链 approval 步、Tab1 eliminate 事件（「私域销售 v1 连续 3 次进化失败…已进老板收件箱」）在文案上指向审计页与收件箱，但 `data/douyin.ts` 的 inboxItems 中并无对应淘汰建议条目，审计页也无因果链回放——联动未落地。
- **试岗生命周期**：市场侧 m-25「进化失败退回」使用 trial.ts 自己的 `EvolutionRecord`（rounds/consecutiveFails），与本模块 causalChains 是**平行的两套结构**，仅口径（连续 N 轮未达标才淘汰）一致。
- **旧 EvolutionFlywheel**：与 MechanismTab 同吃 `hermesBadCases` + `evolutionStats`，数据同源。

## 7. Mock 边界与已知限制

- **与旧 EvolutionFlywheel 的关系（现状）**：grill 待实现清单①要求「合并/替换 EvolutionFlywheel 入口」——导航入口已替换（LeftNav「进化中心」指向新页），但 modal 本体未下线，仍可从 Office3D learn 区、RightConsole、CommandPalette 打开「质量与复盘」；其 5 阶段内容是 MechanismTab 的子集（无策略卡、无 trace），二者并存造成「进化机制」有两个 UI 表达。LeftNav 中 `highlight:'hermes'` 处理分支是死代码。
- 全模块零写操作：无 pushAudit / pushToast，「审计页回放」「查看轨迹」等承诺仅为文案；旧 flywheel 里的「查看轨迹 / 回写知识中枢」按钮也无 onClick 实现。
- 所有数字静态：能力分曲线、管道计数、部门对比不随 mock runtime tick 变化；store mock runtime 每 ~15s 推送的 Hermes 心跳消息（对话流「SOP 进化 pending」审计条目）与本页数据无关联。
- 因果链仅 2 条、SOP 版本仅 5 位员工、trace 仅 3 条——覆盖演示主路径（销售/财务）之外的员工档案偏空。
- Tab2 员工列表只含 seed 15 人，市场转正入编的员工不会出现（与 marketplace 模块的断点一致）。
- 角色差异未实现：页面本身不区分 currentRole，非 boss 角色经 Drawer 跳入后看到与老板完全相同的视图。
- focusEmployeeId 为模块级可变单例：若未来页面改为 keep-alive（不重新挂载）或并发打开多处入口，一次性消费语义会失效；当前实现依赖 AppShell 的条件渲染成立。
