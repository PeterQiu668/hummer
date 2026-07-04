# ROI 经营与账单（roi）

> 源码：`src/components/pages/RoiPage.tsx`（页面 + 两个 tab，约 350 行）、`src/data/roi.ts`（全部数据与计费推导逻辑，约 215 行）、依赖 `src/data/employees.ts`（tokensToday / costToday / department / model 同源）· 状态：**纯展示**（唯一写操作是「导出月报」的 toast，无审计、无跨模块状态变更）

## 1. 定位与对应闭环

- Phase 0 的「老板经营视角」：回答两个问题——**AI 团队到底值不值（ROI 月报）**、**钱花在哪、有没有失控（账单中心）**。
- 对应叙事闭环是「用量 → 成本归因（部门→员工→任务） → 预算硬顶 → 超限熔断转人工 → 失败不计费」，即成本治理链路。当前实现中该链路**只有展示层**：熔断、免计费都是数据里预先算好的结论，页面不产生任何决策动作。
- 卖点级机制两条：
  - **预算硬顶**：每位员工设月度预算上限（budgetCap），进度条 + 三档状态（预算内/接近上限/已超限），超限即标记「已熔断转人工」；
  - **失败任务不计费**：被阻断/验收不通过/异常终止的任务 token 消耗全额免除，账单里划线展示 + 绿色「失败 · 免计费」chip，页头绿色横幅汇总本月免计费总额。

## 2. 入口与角色可见性

- **boss**：LeftNav「经营与治理」组第一项「ROI 经营」（无 badge）；TopBar 标题「ROI 经营 · 月度经营报告 · 成本归因 · 预算硬顶」。
- **exec / staff / expert / auditor**：`ROLE_SECTIONS` 均无 roi 入口。页面本身无角色守卫（与其他页一致，靠导航裁剪实现可见性）。

| 角色 | 导航入口 | 说明 |
|---|---|---|
| boss | 有（经营与治理组） | 唯一目标用户，看全公司口径 |
| exec | 无 | 高管绩效数字在 ExecWorkspacePage 自带，不复用本页 |
| staff | 无 | — |
| expert | 无 | 专家收入分成在 ExpertPortal 的 RevenuePanel，另一套数据 |
| auditor | 无 | 审计员看不到成本账单（可讨论是否应开放只读） |

- 页面对所有进入者展示同一数据，无按部门/角色的数据过滤（例如 exec 看不到「只看自己部门账单」的版本）。

## 3. 界面结构

```
WorkspacePage 框架
├─ 标题区 actions：[导出月报] 按钮（is-primary）
├─ sticky：TabBtn ×2 —— 「经营 ROI 月报」 | 「账单中心」
├─ tab1 RoiReport（max-w-5xl）
│   ├─ 4 指标卡 StatCard：本月完成任务 1,284（+14.6%）/ 验收通过交付物 342（一次通过率 87%）
│   │   / 等效人时节省 412 人时（≈ ¥8.6 万）/ 专家介入 9 次（平均响应 1.8h）
│   ├─ ROI 总览横幅：总投入 {billingTotal} vs 等效产出 ¥8.6 万 → 「ROI {x.x}x」chip
│   ├─ 按部门 ROI：5 张卡（roiX 大数字 + 完成任务/节省人时/AI 成本/人力等效）
│   ├─ 月度完成任务趋势：2–7 月纯 div 条形图（当月高亮品牌色，条上任务数、条下节省人时）
│   └─ 对比同岗位人力成本：6 行表（岗位 / AI 员工 / 人力月成本 / AI 月成本 / 节省 -N% chip）
└─ tab2 BillingCenter（max-w-5xl）
    ├─ 本月账单总额卡（{billingTotal}，N 部门 · N 位 AI 员工）
    ├─ 失败任务不计费横幅（绿，ShieldOff 图标，右侧本月已免计费 {waivedTotal}）
    ├─ 成本归因三级表：部门行（可折叠）→ 员工行（预算硬顶进度条，可展开）→ 任务级表格
    └─ 口径脚注：token 用量 × 模型单价 × 工作日折算，与员工页同源 · 超预算硬顶自动熔断并转人工
```

## 4. 操作步骤与逻辑

本页交互极少，全部状态为组件本地 useState，唯一 store 调用是 `pushToast`。

### 4.1 切换 tab
- 操作：点「经营 ROI 月报」/「账单中心」。
- 状态变化：本地 `tab: 'roi' | 'billing'`；切换会卸载重挂对应子组件（BillingCenter 的折叠状态随之重置为默认）。
- 副作用：无。

### 4.2 导出月报
- 前置：任意 tab。
- 操作：点标题区「导出月报」。
- 状态变化：无（不写任何 store 业务字段）。
- 副作用：仅 `pushToast({kind: 'success', title: '月报已导出', detail: '7 月经营 ROI 月报.pdf 已生成'})`。**没有真实文件生成，也没有 pushAudit**——「导出」这类对外动作未走审计链，是与产品叙事（一切动作可追溯）的偏差点。

### 4.3 折叠 / 展开部门行（账单中心）
- 前置：tab2。初始 `openDepts` 由 `billingDepts` 生成、**全部默认展开**。
- 操作：点部门行。
- 状态变化：本地 `openDepts[dept]` toggle（不可变展开写法 `{...s, [dept]: !s[dept]}`）。
- 副作用：无。收起时该部门下员工行整组隐藏。

### 4.4 展开员工行 → 任务级归因
- 操作：点员工行。
- 状态变化：本地 `openEmp: string | null`，**单开互斥**（再点收起，点别人切换）。
- 副作用：无。展开后渲染该员工 `tasks[]` 表：任务 / Tokens / 成本 / 计费列；`status==='failed'` 的行标题与成本划线置灰，计费列绿色 chip「失败 · 免计费」，正常行灰 chip「正常计费」。
- 员工行本体展示逻辑：
  - 左：姓名 + 模型（Cpu 图标）；中：`fmtTokens(tokensToday)` tok/日 + `$costTodayUsd/日`；
  - 预算硬顶进度条：`ratio = monthCost / budgetCap`，条宽 `min(ratio, 1) × 100%`，颜色随 `budgetStatus` —— ok 绿「预算内」/ near 黄「接近上限」/ exceeded 红「已超限」；
  - `fused === true` 时状态文案追加「· 已熔断转人工」，行尾再加红色 chip「已熔断转人工」（无任何可点的「恢复/调预算」操作）；
  - 行尾 `fmtYuan(monthCost)`。

### 4.5 tab1 的全部内容
- 无任何可点交互（纯渲染）。条形图高度 `max(tasks/maxTasks × 100%, 6%)`，当月（数组末位）高亮品牌色；节省百分比 = `round((1 - agentCost/humanCost) × 100)`，恒为绿色 chip（数据保证 AI 成本低于人力，无负值分支处理）。

**交互与副作用速查**（对齐其他模块文档的表格口径）：

| 用户动作 | 状态变化 | store 写入 | 审计 |
|---|---|---|---|
| 切 tab | 本地 `tab` | 无 | 无 |
| 导出月报 | 无 | `pushToast`（success） | **无** |
| 折叠/展开部门 | 本地 `openDepts[dept]` | 无 | 无 |
| 展开员工行 | 本地 `openEmp`（单开） | 无 | 无 |

## 5. 数据与状态

**关键类型（data/roi.ts）**：

```ts
BillingTask     { id, title, tokens, cost, status: 'ok' | 'failed' }   // failed 的 cost 即免计费金额
BillingEmployee { id, name, role, dept, model, tokensToday, costTodayUsd,
                  monthCost, budgetCap, budgetStatus: 'ok'|'near'|'exceeded', fused, tasks[] }
BillingDept     { dept, monthCost, employees[] }
RoiSummary      { monthLabel, tasksDone, deliverablesAccepted, savedHours, savedValue, expertInterventions }
DeptRoi         { dept, tasksDone, savedHours, humanCost, aiCost, roiX }
HumanCompareRow { position, agentName, agentCost, humanCost }
```

`data/roi.ts` 是本模块的实质逻辑层，模块加载时一次性执行 `buildBilling()` 推导出所有导出常量：

- **口径常量**：`USD_TO_CNY = 7.2`，`WORKDAYS = 22`。
- **月成本推导**：`monthCost = round(emp.costToday × 7.2 × 22)`——直接复用 `data/employees.ts` 每位员工的 `costToday`（USD/日），保证与「员工页今日成本」同源（脚注声明的口径）。
- **预算硬顶**：`budgetCaps` 手工写死 15 位员工的上限（缺省 fallback `monthCost × 1.5`）；`ratio > 1 → 'exceeded'`，`ratio ≥ 0.8（NEAR_THRESHOLD）→ 'near'`，否则 `'ok'`；**`fused = (status === 'exceeded')`**——熔断是纯派生标记，没有对应的运行时行为（该员工在任务页/办公室仍照常「工作中」）。
- **任务归因**：`taskSeeds` 每员工手写若干 ok 任务（share 份额，员工 monthCost × share 得任务成本、tokensToday × 22 × share 得任务 token）与可选 failed 任务（`waived` 直接给定免计费金额 ¥，token 反推 `waived / 7.2 × 26_000`）。
- **失败不计费的账务实现**：`total`（= `billingTotal`）**只累加 monthCost**，failed 任务成本从一开始就不在 total 内；`waived`（= `waivedTotal`）单独累计仅用于展示「已免计费」。即「免除」不是从账单里减出来的，而是从未计入——仅 3 位员工有 failed 种子（岚·运营官 ¥52 / 砚·财务官 ¥86 / 苓·客服官 ¥37，合计 ¥175）。
- **部门聚合**：按 `emp.department` 归组（保持 employees 出现顺序），5 个部门（决策中心/业务办公区/行政支持中心/会议室/休息区）与 `deptRoiSeeds` 名称完全对齐；`deptRoiCards.roiX = round(humanCost / aiCost × 10) / 10`，aiCost 取账单同名部门月成本（找不到时 fallback 1，当前不会触发）。
- **人力对比**：`humanCompare` 6 行，agentCost 用 `findMonthCost(empId)` 从账单取，humanCost 写死。
- **月报汇总**：`roiSummary`（1,284 任务 / 342 交付物 / 412 人时 / ¥86,000 / 9 次专家介入）与 `monthlyTrend`（2 月 310 → 7 月 1,284，单调上升的增长曲线）纯手写，与账单数据**无推导关系**。
- **部门 ROI 种子**（`deptRoiSeeds`，humanCost 手写）：决策中心 96 任务/¥16k、业务办公区 684/¥40k、行政支持中心 402/¥19k、会议室 62/¥6k、休息区 40/¥5k；roiX 的分母 aiCost 来自账单聚合，分子 humanCost 手写——两边混合口径。
- **失败任务清单（全部 3 条）**：

| 员工 | failed 任务 | 免计费 ¥ | 呼应的其他模块事实 |
|---|---|---|---|
| 岚·运营官 | 跨渠道归因重跑（BI 数据缺失） | 52 | 收件箱 in-3「运营复盘数据缺失」 |
| 砚·财务官 | 138w 调拨复核（Guardian 阻断） | 86 | riskAlerts ra-fin-138w / 收件箱 in-1 |
| 苓·客服官 | 中英混合情绪分类批次（准确率不达标） | 37 | 收件箱 in-5 / Hermes 队列 |

- **页面状态**：`tab`、`openDepts`、`openEmp` 全部本地、不持久化；对 store 的依赖仅 `pushToast` 一个写入口，无任何读订阅（employees 经 roi.ts 在模块层引用）。

## 6. 模块联动

- **← 员工数据（data/employees.ts）**：员工名单、部门、模型、tokensToday、costToday 全部同源；员工页/EmployeeDrawer 上看到的「今日 token/成本」乘 7.2 × 22 即为本页月账单，口径可互验。
- **← 叙事联动（数据层面写死，非运行时）**：failed 任务文案与其他模块呼应——「138w 调拨复核（Guardian 阻断）」对应 riskAlerts 的 `ra-fin-138w`、「跨渠道归因重跑（BI 数据缺失）」对应收件箱 in-3、「中英混合情绪分类批次」对应收件箱 in-5 / Hermes 队列。但**运行时零联动**：在收件箱批准/拒绝 138w、验收不通过某任务，都不会让账单多一条 failed 或改变 waivedTotal。
- **→ Toast 系统**：导出月报走全局 ToastContainer。
- **无审计联动**：本页不调用 pushAudit，审计链页看不到任何 ROI/账单相关操作记录。
- **无预算联动**：授权仪式（AuthorizationGrant.quotaMonthly）里签署的月度额度与本页 budgetCaps 是两套互不相通的数据。

## 7. Mock 边界与已知限制

1. **全静态推导**：所有数字在模块加载时一次算完，会话期间永不变化；5s 心跳 tick 对本页无影响；月份写死「7 月」。
2. **熔断无行为**：`fused` 只是展示标记，被「熔断转人工」的员工（衍·产品经理等 exceeded 者）在其他模块状态不变，也没有任何解除熔断/调整预算的入口——预算硬顶闭环缺「设置预算」「熔断处置」两端。
3. **失败不计费是预写结论**：免计费任务是 taskSeeds 手写的 3 条，与真实任务流（taskStatuses、验收判定、riskAlerts 处理结果）完全脱钩；免计费金额也未参与任何对账（total 从未包含它）。
4. **导出月报是假动作**：无文件、无审计（见 §4.2）。
5. **roiSummary / monthlyTrend 与账单口径不自洽可能**：月报的「等效产出 ¥86,000」「1,284 任务」为手写值，若未来 employees 数据调整，billingTotal 会变而 ROI 分子不变，ROI 倍数展示（`savedValue / billingTotal`）会静默漂移。
6. **无按角色/部门的数据裁剪**：不存在 exec 只看本部门账单的视图；也没有时间范围切换（仅当月）。
7. tab 切换重置账单折叠状态（组件卸载重建），轻微体验问题。
8. `fmtYuan` 万元以上保留一位小数，部门/员工行合计与任务行求和可能出现四舍五入级别的展示误差（数据层是精确整数，仅展示取整）。
