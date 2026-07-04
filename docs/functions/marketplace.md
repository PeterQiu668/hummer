# 员工市场与招聘生命周期（marketplace）

> 源码：`src/components/marketplace/Marketplace.tsx`（含 BrowseTab / PackagesTab / WizardTab / ExpertsTab / TrialDrawer）· `src/components/onboarding/LifecycleBoard.tsx` · `src/components/onboarding/TrialReportCard.tsx` · `src/components/onboarding/AuthorizationCeremony.tsx` · `src/data/marketplace.ts` · `src/data/experts.ts` · `src/data/trial.ts` · 状态：**有交互闭环**（浏览→招聘→试岗决策→授权签署完整可走通，但入编后不落到组织架构）

## 1. 定位与对应闭环

对应 Phase 0 PRD 缺口⑥「试岗-转正断头路」与缺口⑩「授权仪式缺失」（docs/phase0-prd.md §2），以及 grills/01 待实现清单③④（试岗双达标、进化失败退回）。核心叙事：数字员工不是「买了就用」，而是走一条 **市场浏览 → 招聘入沙箱 → 7 天试岗 → 双达标判定 → 转正三选一 → 授权仪式签署 → 入工区** 的信任建立链路；淘汰语义从「末位/低分」改为「连续 2 轮 SOP 改进仍未达标（进化失败）」。

## 2. 入口与角色可见性

- 市场是 **全屏 modal**（非路由页）：`AppShell.tsx` 以 `showMarketplace` 渲染 `<Marketplace />`。
- 打开途径：① LeftNav「员工市场」项（`highlight: 'market'` → `setShowMarketplace(true)`，不改 `activePage`）；② 我的员工页右上「招聘新员工」按钮；③ CommandPalette。
- 角色可见性（LeftNav `ROLE_SECTIONS`）：**boss**（员工分组）与 **expert**（市场分组）可见市场导航；**exec / staff / auditor** 无入口。modal 内部不做角色判断，所有写操作 actor 均硬编码为 `'昆仑（您）'`（TrialReportCard / AuthorizationCeremony 中 `SIGNER` 常量），即专家视角打开市场做决策也会以老板身份留痕——已知不一致。

## 3. 界面结构

Header（标题 + 36 位员工 / 11 环节 / 7 天试岗副标）→ 五 tab → Footer（专家兜底口号 + 联系顾问按钮，无动作）：

| Tab | key | 内容 |
|---|---|---|
| 浏览员工 | browse | 搜索框 + 11 经营环节 chip 过滤（`CATEGORY_TO_STAGE` 把员工 category 映射到 `businessStages`）+ 员工卡网格（36 位 `marketEmployees`，色带头、专家认证徽标、`EXPERT_BY_CATEGORY` 映射到 6 位固定专家、体验工坊 / 招聘按钮） |
| 团队套餐 | packages | 4 个 `teamPackages`（初创 ¥8.8k / 标准增长 ¥18.8k 推荐 / 旗舰 ¥32.8k / 定制面议），一键部署 |
| 定制 5 步 | wizard | 企业画像→业务目标→选经营环节→推荐团队（按 stages 重叠度排序取第一）→预览部署 |
| 专家保障 | experts | 6 位固定专家卡（`experts`），纯展示 |
| 我的招聘 | mine | `LifecycleBoard`（生命周期看板），count = `buildCandidates(installed).length` |

TrialDrawer（体验工坊）是 browse 卡片触发的居中弹层；TrialReportCard 是看板卡片触发的右侧抽屉（z-70）；AuthorizationCeremony 是全屏签署弹层（z-80）。

**LifecycleBoard 看板结构**：顶部横幅一句话讲清规则（「招聘 → 沙箱试岗 7 天 → 评分 → 转正需双达标 → 授权仪式签署后入工区 · 连续 2 轮 SOP 改进仍未达标将建议退回市场」）；候选按**有效阶段**分组，分组顺序为 `STAGE_ORDER` 反转——已入工区在最上、「已退回市场」殿后；空分组隐藏；零候选时显示空态卡（引导去浏览员工/团队套餐）。五阶段元数据 `STAGE_META`（trial.ts）：

| stage | label | 颜色 | 进度条段位 |
|---|---|---|---|
| market | 在市场（分组标题显示「已退回市场」） | `#737373` | 1/5 |
| trial | 沙箱试岗 | `#B07706` | 2/5 |
| scoring | 评分中 | `#7E22CE` | 3/5 |
| authorizing | 授权配置 | `#0F70B7` | 4/5 |
| onboarded | 已入工区 | `#1E8F5C` | 5/5 |

候选卡（CandidateCard）要素：头像色块 + 试岗评分大数字（≥85 绿 / ≥70 墨 / 其余橙）+ 五段 `LifecycleProgress` 进度条 + chips 行：试岗第 N/deadline 天、完成/质量、风险数（>0 红）、进化失败徽标（`evolution.verdictLabel`，仅未决策时显示）、`DecisionBadge` 终态徽标（已转正 / 待授权签署 / 试岗延长 +3 天 / 进化失败·已退回市场）、`needDecision` 时的脉冲徽标（allMet →「第 7 天 · 双达标可转正」绿，否则「第 7 天 · 待决策」橙）、试岗中未达标显示「转正缺口 N 项」。`needDecision = !decision && trialDay≥7 && stage∉{onboarded, authorizing}`，命中时卡片边框变警告色。

## 4. 操作步骤与逻辑

### 4.1 全链路步骤流（招聘 → 入编）

```
浏览员工 tab
  │ [体验工坊]（可选）──► TrialDrawer：编辑任务 → 生成模拟产出（硬编码 BD 邮件文案）→ 满意·一键招聘
  ▼
[招聘] onHire(m)
  ├─ 本地 state installed[m.id]=true + 写 localStorage 'hummer-marketplace-hires'
  ├─ pushAudit：actor 昆仑（您）· action 招聘数字员工 · target 员工名 · ok · tags [marketplace, hire]
  ├─ pushToast success「已进入沙箱试岗 · 第 1 天」
  └─ triggerSlotIn（黑客帝国技能插盘动画，store.slotIn）
  ▼
我的招聘 tab（LifecycleBoard）
  buildCandidateViews(installed, store.trialDecisions, store.grants)
  = seed 6 位（trial.ts trialCandidates）+ 新招聘（stage trial · trialDay 1 · defaultPromotionCriteria）
  ▼
点卡片 → TrialReportCard（试岗报告卡）
  转正双达标判定 buildPromotionStatus(day, criteria)：
    daysMet   = 试岗天数 ≥ requiredDays(7)
    tasksMet  = completedTasks ≥ requiredTasks
    passRateMet = actualPassRate ≥ requiredPassRate(85%)
    allMet = 三项全达标；gaps[] 输出缺口文案
  ▼
第 7 天三选一（mustDecide = !decision && day≥7 && stage≠onboarded）
  ├─ 转正并授权（仅 allMet 可点，否则置灰 opacity 0.45 + title/底部显示 gaps）
  │    decideTrial(promote) → audit「试岗决策 · 转正并授权（双达标）」ok · tags [trial, promote, human-in-loop]
  │    → 关报告卡，开 AuthorizationCeremony
  ├─ 延长试岗 3 天
  │    decideTrial(extend) → audit「试岗决策 · 延长试岗 3 天」pending · tags [trial, extend, human-in-loop]
  │    → 有效阶段回 trial，deadlineDays 7→10，期满需再次决策
  └─ 退回市场
       decideTrial(return) → audit blocked · tags [trial, return, human-in-loop]
       （进化失败候选 action 变为「退回市场（连续 2 轮进化失败）」，toast detail 用 evolution.recommendation）
       → 有效阶段 = market，看板分组显示「已退回市场」
  ▼
AuthorizationCeremony（授权仪式）
  四区：①权限清单（6 项 grantPermissionOptions，4 项默认勾选，0 项时签署按钮禁用）
        ②数据范围（grantDataScopes 4 条静态展示，含「财务凭证·无权限」）
        ③月度额度 slider（¥10k–200k，步长 5k，默认 ¥50k，超限熔断转人工文案）
        ④有效期（30/90/180/365 天，默认 90）
  [确认签署] handleSign：
    addGrant({employeeId, employeeName, permissions, dataScope, quotaMonthly, validUntil, signedBy: 昆仑（您）})
      → store 内生成 grant-{ts}、status active，并写 audit「签署授权仪式」ok · tags [grant, human-in-loop]
    读回 useAppStore.getState() 的 grants[0].id 与 auditLog[0].hash 渲染成功态（授权编号 + 审计 hash）
    pushToast success「已正式入职」
  ▼
关闭 → 看板卡片有效阶段 = onboarded（grant 存在），DecisionBadge「已转正」
```

### 4.2 四种转正情形 + 进化失败分支（seed 数据即演示脚本）

| 候选 | seed 阶段 | 双达标状态 | 演示点 |
|---|---|---|---|
| m-13 合同审阅专家 | onboarded, D7 | 24/20 任务 · 95%/85%（全达标） | 闭环样板，报告卡底部显示「已转正并完成授权签署」 |
| m-7 资深 CFO | authorizing, D7 | 30/25 · 96%（全达标） | **主路径**：转正按钮亮 → 走授权仪式 |
| m-1 高客单 BD 顾问 | scoring, D7 | 18/24 任务不够 | 天数够、任务缺 6 个 → 转正置灰 + 缺口文案 |
| m-16 7×24 客服官 | trial, D5 | 96/60 任务超额但天数 5/7 | 任务够、天数不够 → 「延长/退回随时可用」态 |
| m-4 618 大促运营 | trial, D3 | 11/15 · 67%（双不达标） | 三项全缺口 |
| m-25 小红书爆文官 | scoring, D7 | 9/12 · 58% + `evolutionByCandidate` 2 轮失败 | **进化失败**：卡片红徽标「改进轮次 2 · 连续 2 轮未达标」，报告卡显示进化历史时间线（v1.1 → v1.2 回归退化 62%→58%）+ 系统建议退回；退回 = 进化机制输出而非低分淘汰 |

### 4.3 试岗报告卡的信息分区（TrialReportCard 自上而下）

1. **Header**：头像 + 员工名 + 有效阶段 chip（取 STAGE_META 配色）+「{category} · {expert} 共创认证」。
2. **评分区**：40px 大数字（同卡片配色阈值）+ 建议文案 `advice`——优先级为 进化失败（红，`evolution.recommendation`）> 双达标·建议转正（绿）> 未双达标·建议延长观察（橙）。右侧 D1–D7（延长后 D1–D10）逐日进度格，超出 7 天的格子橙色；已延长时显示「已延长 3 天（{ts} 由 {decidedBy} 决定）」。
3. **转正条件区**：三条 `CriterionRow`（天数 / 任务量 / 验收通过率），每条含达标勾或叉、`current / target`、进度条、缺口文案（如「还差 6 个任务」）；顶部「N/3 项达标」chip。
4. **四维指标**：完成任务 / 质量均分（/5.0）/ 试岗成本（沙箱累计）/ 风险事件（>0 红色 +「已拦截」）。
5. **进化历史**（仅 `evolutionByCandidate` 命中的候选，当前只有 m-25）：逐轮时间线——轮次圆点（passed 绿/红）、SOP 版本、时间窗、改进项列表、回归结果、底部红底「系统建议：连续 2 轮 SOP 改进后仍未达标，建议退回」。
6. **试岗任务明细**：表格（天 / 任务与结果与评语 / 评分 / verdict 图标 pass✓ warn− fail✕），数据来自 `trialTasksByCandidate`，新招聘用 `defaultTrialTasks`（3 条 D1 基线任务）。
7. **底部决策区**：按 `grant/decision` 状态四分支渲染（已签署 / 待授权 / 已退回 / 可决策三按钮），见 4.1。

### 4.4 其余可点交互

- **搜索/环节过滤**（browse）：本地 state `q` / `stageFilter`，纯前端过滤，无副作用。
- **一键部署套餐 / 向导一键部署** `onInstallPackage`：audit「一键部署团队套餐」pending · tags [marketplace, package] + toast「部署中 · 预计 3 分钟」，**无任何状态落库**——套餐员工不会出现在我的招聘/我的员工，纯演示。
- **体验工坊生成模拟产出**：写本地 state `mockOutput`（硬编码邮件），无 audit。
- **已招聘员工**：browse 卡片按钮变「已招聘」禁用，体验工坊按钮同时禁用。
- **报告卡「继续授权仪式」**：decision=promote 但未签署时的续签入口（延长/退回不再可用，`canDecide=false`）。

## 5. 数据与状态

- **静态 mock**：`marketplace.ts` 36 位 `marketEmployees`（含 `marketExtras` 评价/训练史——当前无 UI 消费）；`experts.ts` 6 专家 + 11 环节 + 4 套餐；`trial.ts` seed 候选 / 转正阈值 `promotionCriteriaByCandidate` / 试岗任务明细 `trialTasksByCandidate` / 进化失败记录 `evolutionByCandidate` / 授权选项常量。
- **localStorage**：`hummer-marketplace-hires`（`Record<marketId, boolean>`），由 Marketplace 本地 state `installed` 镜像。
- **store（zustand，persist）**：`trialDecisions: Record<candidateId, TrialDecision>`（persist）、`grants: AuthorizationGrant[]`（persist 前 30 条）、`auditLog`、`toasts`、`slotIn`。
- **派生**：`CandidateView.stage` 为叠加决策/授权后的**有效阶段**（return→market；promote→有 grant 则 onboarded 否则 authorizing；extend→trial）；seed 里写死的 `cand.stage` 只是初始值。

## 6. 模块联动

- **审计链**：hire / 套餐 / 三选一决策 / 签署授权共 5 类事件写 `pushAudit`，可在审计页按 tags（marketplace / trial / grant / human-in-loop）检索。
- **我的员工页**：读同一份 localStorage，展示「新招聘 · 沙箱试岗中」区块（但显示固定「试岗 1/7 天」，不读生命周期真实阶段）。
- **首页工位** `office/Workstations.tsx`：同样监听 `hummer-marketplace-hires` 的 storage 事件，新招聘出现在 3D 工位。
- **SkillSlotIn**：招聘触发全局技能插盘动画。
- **进化语义**：LifecycleBoard 顶部横幅与 TrialReportCard 的「进化失败」文案与进化中心（grills/01）口径对齐，但数据结构独立（trial.ts 的 `EvolutionRecord` ≠ data/evolution.ts）。

## 7. Mock 边界与已知限制

**三套招聘状态残留（收敛现状）**：trial.ts 头注释声明「把三套割裂状态收敛为一套」，实际收敛程度：

1. **localStorage `hummer-marketplace-hires`** —— 仍是「是否招聘」的事实源，被 Marketplace / EmployeesPage / Workstations 三处直接读写；退回市场后该 key **不清除**，员工页仍显示其试岗卡。
2. **`data/marketplace.ts` 的 `MyHire`/`myHires`** —— 旧「我的招聘」列表，**已无任何 UI 引用（死代码）**，仅类型与数据残留。
3. **`data/douyin.ts` 的 `lifecycleCandidates` + `LIFECYCLE_STAGES`** —— 旧四阶段数据，仍被 `lobster/LobsterLab.tsx` 消费（练虾系统 modal 里有另一份不联动的生命周期看板），与 trial.ts 的 `trialCandidates`/`STAGE_META` 平行存在、阶段颜色也不一致。

即：**LifecycleBoard 路线已收敛到 trial.ts + store**，但另两套并未删除，同一员工在「我的招聘」「练虾系统」「我的员工」三处可能显示三种不同状态。

其他限制：
- 转正入编不落库：签署后员工不会真正加入 `data/employees.ts` 组织架构，也拿不到进化档案；「入工区」只是徽标。
- 试岗天数 `trialDay` 是静态 seed，不随时间推进；延长 3 天后不会有 D8–D10 数据，永远停在原天数。
- 新招聘员工使用 `defaultPromotionCriteria`（3/12 任务、67% 通过率、D1），永远达不到双达标，只能延长或退回。
- 套餐/向导部署、体验工坊均无状态写入；Footer「联系顾问」无动作。
- actor 恒为「昆仑（您）」，未接 `ROLE_ACTORS[currentRole]`。
