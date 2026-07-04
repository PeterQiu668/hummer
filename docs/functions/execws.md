# 高管工作台（execws）

> 源码：`src/components/pages/ExecWorkspacePage.tsx`（主体，含全部 seed 数据与 modal）、`src/store/useAppStore.ts`（pushAudit / pushToast / riskAlerts / approveAlert / ROLE_ACTORS）、`src/data/executives.ts`（exec-sales 分身）、`src/data/employees.ts`、`src/data/tasks.ts` · 状态：有交互闭环（确认/打回/补确认/撤回/验收/风控审批均改状态并留痕，但拆解与验收数据为页面级 seed，刷新即重置）

## 1. 定位与对应闭环

真人高管（固定为吴帆·销售 VP 视角）的决策收口页，对应 phase0-prd 缺口⑤「多角色入口缺失」，并落地 Grill 02 二轮 grill 决策①「分级超时 + 默许记账 + 预授权」。承载四段闭环：

1. **拆解确认环**：分身预拆解（对应 ch-twin-sales 的 decompose 消息叙事）→ 本页确认授权 / 打回重拆 → 确认后才下发数字员工执行；
2. **默许治理环**：低风险超时自动放行但记「默许（超时未审）」账，默许率成为高管自身的治理指标（倒逼认真看或做预授权），默许项可补确认 / 撤回冲销；
3. **部门验收环**：部门数字员工的交付 → 高管验收通过（叙事上进交付出口）/ 打回返工；
4. **风险处置环**：与守护者共用 store `riskAlerts`，高管批准放行或拒绝改走更安全方式。

Grill 02 对分身会议室的写权限收紧（「日常的确认分身拆解更应发生在真人高管 ↔ 分身 1v1 通道或高管工作台」）——本页即那个「已实现后者」。

## 2. 入口与角色可见性

| 角色 | 可达性 | 说明 |
|---|---|---|
| exec | 唯一正式入口 | LeftNav ROLE_SECTIONS.exec「工作台」第一项；切 exec 角色时的默认页（phase0-prd §1） |
| boss | 无入口 | LeftNav 不渲染 execws 项 |
| staff | 无入口 | 同上 |
| expert | 无入口 | 同上 |
| auditor | 无入口 | 同上（高管动作经审计链间接可见） |

- 页面本身不读 `currentRole` 做防卫：若经持久化的 activePage 残留进入，其他角色也能以吴帆身份操作。唯 `decideRisk` 经 store `approveAlert` 用 `ROLE_ACTORS[currentRole]` 记审计 actor，此时会出现「审计 actor 与页面身份不一致」。
- 页面身份硬编码：`EXEC_NAME = '吴帆·销售 VP'`；`SALES_TWIN = executiveTwins.find(id === 'exec-sales')`（吴·销售 VP 分身，`managesEmployeeIds = ['emp-sales-1']` 即雪·销售官）。

## 3. 界面结构

单列滚动（p-6，max-w 1080px），页头副题「分身『吴·销售 VP 分身』为您预处理了部门事务，关键决策仍由您签字」：

1. **概览 5 卡**（grid-cols-5）：拆解待确认（黄）/ 待验收交付（蓝）/ 待处理风险（>0 红）/ 本周 bad case / **默许率**（>0 黄；卡内右上角「预授权规则」链接开 modal；脚注「默许 X / 总确认 Y · 默许率进入您的治理指标」）；
2. **区块 1 分身拆解待确认**：DECOMP_SEED 4 张卡——标题 + 状态徽标（已确认授权 / 已打回重拆 / 已默许（超时未审）土黄自定义色 / 已升级收件箱红）、detail、风险级 chip（高危红/中危黄/低危灰）、倒计时 chip（「已超时…」黄）、拟派对象、来源（老板目标）、按 status 切换的按钮组、风险相关脚注；
3. **区块 2 部门验收队列**：DELIVERY_SEED 4 行——FileText 图标 + 交付名 + 责任 Agent·关联任务·备注·时间 + 验收按钮组或结果徽标；
4. **区块 3 团队绩效**：管辖数字员工卡（头像、姓名、StatusChip、currentTask、今日完成/今日成本/本周 bad case 三个 MiniStat）+ 「本周部门 bad case 小计」软卡（脚注「已全部进入 Hermes 改进队列 · 改进上线前不重复计费」）；
5. **区块 4 待我处理的风险**：`riskAlerts` pending 项卡片（等级 chip、Agent·时间、拦截原因、建议、批准/拒绝按钮），空则 EmptyState「守护者未发现需要您人工介入的高危动作」；
6. **预授权规则 modal**：规则列表（对勾 + 规则文 + 适用范围·已生效）+ 新增输入框 + 底部免责文案「预授权是显式、有记录、可计量的授权形态——免确认 ≠ 免责任」。

## 4. 操作步骤与逻辑

### 4.0 挂载时超时结算（默许机制核心，非用户动作）

- 前置条件：`DECOMP_SEED` 中 `overdueSeed: true` 且 status 'pending' 的项——dc-2（高管陪访排期，低风险，已超时 26 分钟）、dc-3（折扣上调 8%→10%，高风险，已超时 1 小时 05 分）；`timeoutSettled` useRef 保证只结算一次（防 React StrictMode 双执行重复写审计）。
- 分级超时规则（决策①完整落地）：
  - `risk === 'low'` → status 'tacit'。pushAudit：actor「系统（超时策略）」、action「**默许放行（超时未审）**」、result warning、tags `['exec', 'tacit', 'decompose']`。审计记「默许」而非「已确认」——默许是显式、有记录、可计量的授权形态。
  - `risk === 'medium' | 'high'` → status 'escalated'。pushAudit：action「{中/高}风险拆解超时未审 · 升级老板收件箱」、result warning、tags `['exec', 'escalate', 'decompose']`。**中高风险永不自动确认**；卡片脚注「{中/高}风险拆解不自动确认 · 超时将升级老板收件箱」。
- Mock 边界：升级只写审计 + 换徽标，**不在 InboxPage 生成条目**；deadline（「剩余 42 分钟」等）是静态字符串，运行期不流逝，pending 项永不再触发超时。

### 4.1 确认授权（pending 项）

- 操作：点「确认授权」→ `confirmDecomp`。
- 状态变化：本地 `decomps` 该项 status → 'confirmed'（不可变 map）；派生值 `pendingDecomps`↓、`confirmedCount`↑、`tacitRate` 重算（分母变大 → 默许率被稀释）。
- 副作用：pushAudit（actor 吴帆·销售 VP、action「确认授权分身拆解」、target 拆解标题、result ok、tags `['exec', 'decompose']`）+ toast success「已确认授权 ·『{title}』将派给 {assignee}」。
- Mock 边界：不产生真实任务、不给分身回消息。

### 4.2 打回重拆（pending 项）

- 操作：点「打回重拆」→ 卡内展开内联输入框（autoFocus；再点同按钮收起并清空）→ 填打回意见（placeholder 示例「折扣上调需先给出 ROI 测算」）→ 点「提交打回」→ `rejectDecomp`。
- 状态变化：意见为空兜底 '请补充依据后重拆'；status → 'rejected'；`rejectingId`/`rejectNote` 复位。
- 副作用：pushAudit（action「打回重拆 · {note}」——意见进审计正文、result warning、tags `['exec', 'decompose', 'reject']`）+ toast warning「已打回重拆 · 意见已回传分身：{note}」。
- Mock 边界：「回传分身」是文案，分身不会真的重拆（对照 ch-twin-sales 种子 tw3 打回 → tw4 修正 v2 的剧本演示）。

### 4.3 补确认（tacit 项 → 默许转正式确认）

- 前置条件：status 'tacit'（卡片脚注「低风险超时已自动放行并计入默许记账 · 您仍可补确认或撤回」）。
- 操作：点「补确认」→ `lateConfirm`。
- 状态变化：status → 'confirmed'。**默许率随之下降**：tacitCount−1、confirmedCount+1——冲销记账的计量体现。
- 副作用：pushAudit（action「补确认（默许转正式确认）」、result ok、tags `['exec', 'tacit', 'confirm']`）+ toast success「默许记账已转正式确认」。
- 审计语义：原「默许放行」条目不删除——链上留双记录，可追溯「先默许、后补签」全过程。

### 4.4 撤回默许（tacit 项）

- 操作：点「撤回」（is-danger 红按钮）→ `revokeTacit`。
- 状态变化：status → 'rejected'（等同打回重拆）。
- 副作用：pushAudit（action「撤回默许放行 · 打回重拆」、result warning、tags `['exec', 'tacit', 'revoke']`）+ toast warning「已打回分身重拆，执行中动作回滚」。
- Mock 边界：无真实执行态可回滚，回滚为文案。

### 4.5 默许率指标（决策①「默许率进治理指标」）

- 计算：`tacitRate = Math.round(tacitCount / (tacitCount + confirmedCount) × 100)`，分母为 0 时取 0。
- 口径：分母只含 tacit + confirmed，**不含 pending / rejected / escalated**——语义为「所有已放行的授权中，有多大比例是默许出去的」。补确认会同时动分子分母（−1/+0 净效果），确认会稀释分母。
- 展示：概览第 5 卡，>0 时数字黄色警示。仅本页展示，未上报老板侧 / 治理舱 / ROI 页。

### 4.6 预授权规则（授权仪式的高管版，决策①「支持预授权」）

- 打开：概览默许率卡点「预授权规则」→ `preauthOpen` = true，modal 遮罩点击或 X 关闭。
- 种子 2 条（PREAUTH_SEED）：「单笔 <5w 的部门内资源调配免确认」「SOP 灰度推广（已认证版本）免确认」，scope 均为「销售增长部门 · 低风险拆解」。
- 新增：输入规则文案 → 点「新增预授权」→ `addPreauth`：
  - 空输入分支：toast warning「请先填写规则内容」+ return，不写任何状态；
  - 非空分支：本地 `preauthRules` append（id `pa-{Date.now()}`，scope 固定「销售增长部门 · 低风险拆解」）、`preauthDraft` 清空、pushAudit（action「配置预授权规则」、**target 为规则原文**、result ok、tags `['exec', 'preauth']`）+ toast success「预授权规则已生效 · 命中该规则的低风险拆解将免确认」。
- 语义边界：modal 文案承诺「命中规则免确认 · 不计默许 · 全部写入审计链」，但**规则从不与 DECOMP_SEED 做命中匹配**——不影响超时结算，纯展示 + 留痕。

### 4.7 部门验收（区块 2）

- 前置条件：该行尚无判定（`verdicts[d.id]` 为空）。
- 操作：点「验收通过」或「打回」→ `acceptDelivery(d, passed)`。
- 状态变化：本地 `verdicts[d.id]` = 'passed' | 'returned'；按钮组替换为「已验收 / 已打回」徽标；概览 `pendingDeliveries` 重算。
- 副作用：pushAudit（action「部门验收通过 / 部门验收打回」、target 交付物名、result ok/warning、tags `['exec', 'accept', 'task:{taskId}']`——**tags 携带任务归因**，如 task:tk-sales-q3 / task:tk-legal-review）+ toast（打回时 detail「已通知 {empMap 反查的责任 Agent 名} 返工」）。
- Mock 边界：不改 `collabTasks` / store `taskStatuses`，任务页看不到返工；「通过后进入交付出口」仅区块副题文案，不调 `requestExit`。

### 4.8 风险处置（区块 4）

- 前置条件：store `riskAlerts` 有 pending（种子 3 条，与老板端 BottomFlow 共享同一份数据）。
- 操作：点「批准」或「拒绝」→ `decideRisk(id, approve, action)` → `approveAlert(id, 'approve'|'reject', '由 吴帆·销售 VP 处理')`。
- 状态变化（store 全局）：alert status → approved/rejected；`pendingApprovals` 重算；概览「待处理风险」卡与 EmptyState 联动。
- 副作用：
  1. approval 消息回投源频道 + **双投 ch-risk 决策记录**（store 逻辑，见 chat.md §4.5），note 带「由 吴帆·销售 VP 处理」；
  2. store 内写审计（actor = `ROLE_ACTORS[currentRole].name`、action 审批通过/拒绝、result ok/blocked、tags `['human-in-loop']`）；
  3. 本页 toast「风险已批准放行 / 已拒绝 · 改走更安全方式」。
- 联动语义：与老板在 BottomFlow 的处理是同一份数据——任一端处理完，另一端即消失（四眼原则在 demo 里退化为「谁先点谁算」）。

## 5. 数据与状态

- 页面级本地 state（不持久化，刷新重置）：
  - `decomps`：DECOMP_SEED 4 项，状态机 pending → confirmed | rejected | tacit | escalated；tacit 可再转 confirmed（补确认）/ rejected（撤回）；escalated 为终态（无老板处理入口）；
  - `verdicts: Record<id, 'passed'|'returned'>`、`preauthRules/preauthDraft/preauthOpen`、`rejectingId/rejectNote`、`timeoutSettled` ref。
- store（跨页共享）：`riskAlerts/pendingApprovals`、`auditLog`（persist 前 60 条）、`toasts`、`collabFeed`（风险决策回投消息）。
- 只读数据：`employees`（teamMembers 经 SALES_TWIN.managesEmployeeIds 过滤，当前仅雪·销售官一人）、`collabTasks`（taskMap 供验收行显示任务标题）、`TODAY_DONE` mock（{'emp-sales-1': 6}）、`weeklyBadCases` = 团队 `evolution.badCases` 求和。

## 6. 模块联动

- **← ch-twin-sales（chat）**：分身 1v1 通道的 decompose → confirm → 打回 → 修正剧本是本页区块 1 的消息侧镜像，但两者数据不同源、互不驱动（本页操作不产生 twin 频道消息，反之亦然）。
- **↔ 风险闭环**：与 BottomFlow / RiskAlertModal 共用 riskAlerts + approveAlert；决策双投 ch-risk。
- **→ 审计链**：本页 8 类动作全部写 `auditLog`，AuditPage 可按 tags（exec / tacit / escalate / preauth / accept / task:* / human-in-loop）过滤追溯。
- **→（未接通）收件箱**：escalated 声称升级老板收件箱，InboxPage 无对应条目产生。
- **← 员工数据**：团队绩效卡直接读 employees 的 status / currentTask / costToday / evolution.badCases。

### 4.9 动作 → 状态 → 审计速查表

| 用户/系统动作 | 状态变化（字段） | 审计 action | result | tags |
|---|---|---|---|---|
| 挂载超时结算（低风险） | decomps[i].status → tacit | 默许放行（超时未审） | warning | exec, tacit, decompose |
| 挂载超时结算（中/高风险） | decomps[i].status → escalated | {中/高}风险拆解超时未审 · 升级老板收件箱 | warning | exec, escalate, decompose |
| 确认授权 | decomps[i].status → confirmed | 确认授权分身拆解 | ok | exec, decompose |
| 打回重拆 | decomps[i].status → rejected | 打回重拆 · {意见} | warning | exec, decompose, reject |
| 补确认 | tacit → confirmed（默许率↓） | 补确认（默许转正式确认） | ok | exec, tacit, confirm |
| 撤回默许 | tacit → rejected | 撤回默许放行 · 打回重拆 | warning | exec, tacit, revoke |
| 新增预授权 | preauthRules append | 配置预授权规则 | ok | exec, preauth |
| 验收通过 / 打回 | verdicts[id] = passed/returned | 部门验收通过 / 部门验收打回 | ok / warning | exec, accept, task:{taskId} |
| 风险批准 / 拒绝 | riskAlerts[i].status（store） | 审批通过 / 拒绝 | ok / blocked | human-in-loop |

拆解项状态机：

```
pending ──确认──→ confirmed
pending ──打回──→ rejected
pending ──超时(low)──→ tacit ──补确认──→ confirmed
                        └──撤回──→ rejected
pending ──超时(mid/high)──→ escalated（终态，无老板处理入口）
```

## 7. Mock 边界与已知限制

1. 拆解 / 验收 / 预授权全是组件内 seed + useState：**刷新即回初始态并重跑一次超时结算**——auditLog 因 persist 保留，历史「默许放行/升级」条目会随每次刷新累积重复。
2. 倒计时静态、超时仅挂载时结算一次；运行中的 pending 项（dc-1 剩 42 分钟、dc-4 剩 3 小时）永不真正超时。
3. 四处「闭环」实为单侧留痕：预授权不参与命中判定、打回意见不回传分身、验收结果不改任务状态、escalated 不进收件箱。
4. 视角硬编码吴帆 / 销售部门：其余 4 位高管（CEO/运营/产品/CFO 分身）无工作台实例；团队绩效实际只有 1 名员工，「今日完成」为假数据。
5. `decideRisk` 审计 actor 取 `ROLE_ACTORS[currentRole]` 而非 EXEC_NAME——正常 exec 视角一致，异常路径（非 exec 角色进入本页）下身份错位。
6. 默许率只在本页可见，未如 grill 决策所述「进治理指标」被老板 / 治理舱消费。
