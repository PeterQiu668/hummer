# 审计链与责任链快照（audit）
> 源码：`src/components/pages/AuditPage.tsx` · `src/components/audit/ChainSnapshot.tsx` · `src/components/audit/LedgerIntegrityCard.tsx` · `src/store/useAppStore.ts`（auditLog / pushAudit / seedAudit / mock runtime）· 状态：**部分闭环**（全库真实写入审计并可筛选/展开责任链；hash 链、完整性校验、导出均为 mock 展示）

## 1. 定位与对应闭环

审计链是整个原型的「可监管、可追责、可合规」承诺的落点：全系统几乎所有用户动作与 mock 运行时事件都通过 `pushAudit` 汇入同一条 Append-only 账本，审计页提供检索、筛选，并对每条记录展开「五级责任链快照」——从真人老板一路推导到执行动作的数字员工，附带 SOP 版本 / 策略规则 / 专家认证三行依据。对应 PRD 中「每个 Agent 动作可追责到人」的治理闭环。

真实闭环部分：其他模块的写入 → auditLog（持久化前 60 条）→ 本页筛选/展开。Mock 部分：hash 为随机数、链式校验恒通过、责任链为前端确定性推导、导出仅弹 toast。

## 2. 入口与角色可见性

| 角色 | 左侧导航 | 页面内差异 |
|------|---------|-----------|
| boss | ❌ 无「审计链」导航项（boss 的治理入口是「审计与治理」modal） | — |
| exec | ❌ | — |
| staff | ❌ | — |
| expert | ❌ | — |
| auditor | ✅「审计」分组第一项「审计链」 | 独享三项增强（见 §4.6） |

补充入口：命令面板 `p-audit`「审计链」不做角色过滤，任何角色可打开本页；此时 `isAuditor = currentRole === 'auditor'` 为 false，看不到审计员增强，但基础筛选、展开责任链、「导出审计报告」按钮对所有角色可用。

**审计员角色增强**（`isAuditor` 分支）：① 页头多一个「导出合规报告」按钮；② sticky 工具条多一行「审计员筛选」：操作者下拉 + 标签下拉 + 「高风险置顶」开关 + 高风险条目计数；③ 其余（高风险 chip、账本完整性卡）所有角色均可见。

## 3. 界面结构

1. **标题区**：`审计链` · 副标题 `Append-only · 已记录 {N} 条 · 全部签名入链 · 可监管、可追责、可合规`；actions：[auditor]「导出合规报告」·「高级筛选」（无 onClick）·「导出审计报告」。
2. **sticky 工具条**：搜索框 + 结果筛选段（全部/通过/阻断/待审/告警）+ 计数 chip；[auditor] 第二行审计员筛选。
3. **账本完整性状态卡**（`LedgerIntegrityCard`）：绿色盾牌 + 「账本完整性 · 校验通过」+「实时守护中」chip；进度条恒 100%（`创世块 0x0000 → 最新块 {auditLog[0].hash}` · `{N}/{N} 条通过`）；三个统计位：最近校验时间（= 最新一条的 ts）/ 校验通过 N 条 / 篡改检测 0。
4. **四张 SummaryCard**：今日记录（= auditLog.length）/ 阻断次数 / 待审 / 签名验证 100%（硬编码）。
5. **Timeline 列表**：每行 = 展开箭头 + 结果图标 + `actor action → target` + 结果 chip + [高风险] chip（`isHighRisk`：blocked / warning / 任一 tag 以 `risk` 开头）+ 元信息行（ts / `hash 0x…` / tags / 「点击展开责任链快照」）。整行是 button，点击切换 `expandedId`。
6. **展开区**（`ChainSnapshot`）：责任链快照头（prev hash → entry hash + 「链式校验通过」chip）+ 五级责任链节点轨道 + 三行关键信息（依据 SOP 版本 / 命中策略规则 / 专家认证状态）。
7. 底部脚注：「所有记录采用 Append-only 模式（SQLite WAL + 外键 + 触发器），逐条链式签名，无法篡改」——纯文案。

## 4. 操作步骤与逻辑

### 4.1 搜索 / 结果筛选
- **前置条件**：无。
- **操作**：输入关键字 / 点结果段按钮。
- **状态变化**：本地 `q`、`resultFilter: 'all'|'ok'|'blocked'|'pending'|'warning'`；`filtered` useMemo 过滤（actor/action/target 三字段 includes）。
- **副作用**：无。

### 4.2 展开 / 收起责任链快照
- **前置条件**：无。
- **操作**：点击任一时间线行。
- **状态变化**：本地 `expandedId: string | null`（单开互斥，再点收起）。
- **副作用**：无写入；ChainSnapshot 每次渲染即时推导（确定性 seed，结果稳定）。

### 4.3 导出审计报告（所有角色）
- **操作**：点击页头「导出审计报告」。
- **状态变化**：无。
- **副作用**：仅 `pushToast({ kind: 'success', title: '审计报告已导出', detail: 'audit-2026-07-04.pdf · 含数字签名' })`。无文件生成。

### 4.4 导出合规报告（仅 auditor）
- **前置条件**：`currentRole === 'auditor'`。
- **副作用**：仅 toast：`compliance-2026-07.pdf · 含 {N} 条记录责任链快照 + 审计员签名`。

### 4.5 高级筛选按钮
无 onClick，纯展示。

### 4.6 审计员筛选（仅 auditor）
- **操作者下拉**：`actorFilter`，选项 = `auditLog` 中去重 actor；**标签下拉**：`tagFilter`，选项 = 全部 tags 去重；均为本地 state，参与 `filtered` 计算。
- **高风险置顶**：`riskFirst` 布尔开关，开启后 `filtered` 以 `isHighRisk` 降序稳定排序（不改变过滤，只重排）。
- 右侧展示 `高风险条目 {N} 条（阻断 / 告警 / risk 标签）`。
- **副作用**：均无写入。

### 4.7 审计条目的产生（写入侧，全库汇总）

`pushAudit(entry)`：补 `id: au-{Date.now()}`、`ts: HH:MM:SS`、`hash: makeHash()`（随机 `0x` + ≤6 位 hex），**队首插入**，截断 500。以下为全部产生来源（grep 全库汇总）：

**A. 种子数据（seedAudit，8 条，逐条）**
| id | actor | action → target | result | tags |
|----|-------|----------------|--------|------|
| au-1 | 雪·销售官 | 生成 BD 邮件草稿 → 鲲鹏制造 | ok | `['skill:bd_email_v3.2']` |
| au-2 | Exec-Guardian | 阻断高危调拨 → 财务 138w | blocked | `['risk:high']` |
| au-3 | 林·决策官 | 战略 A2A 下发 → 销售/运营/财务 | ok | `['protocol:a2a']` |
| au-4 | 昆仑（您） | 审批通过 → Q3 客户回访预算 | ok | `['human-in-loop']` |
| au-5 | Hermes | SOP 自动进化 → 资金调拨 v3 → v4 | pending | `['evolution']` |
| au-6 | 炅·研发官 | 创建 worktree → fix/order-p1 | ok | `['mcp:gitlab.repo']` |
| au-7 | 岚·运营官 | BI 查询 → gmv_618.sql | ok | `['mcp:bi.warehouse']` |
| au-8 | 律·法务官 | 调用 KG → contract.risk_v3 | ok | `['kg']` |

**A'. mock runtime（setInterval 5s tick，持续注水）**
| 节律 | actor | action | tags | result |
|------|-------|--------|------|--------|
| 每 2 tick（≈10s，auditPool×5 轮播） | 雪/苓/岚/律·各官、Hermes | 调用 BD 邮件 v3.2 / 调用情绪识别 / BI 查询 / 合同条款匹配 / SOP 进化 | `['skill','mcp:crm.salesforce']` `['skill','mcp:ticket']` `['mcp:bi.warehouse']` `['skill','kg']` `['evolution']` | ok/warning/pending |
| 每 4 tick（≈20s，a2aHandoffPool） | `h.fromLabel`（老板分身/高管分身） | A2A 委派 → `h.toLabel` | `['a2a', 'intent:{意图前18字}']` | ok |

**B. store action 内部写入（不经组件 pushAudit）**
| action | actor | 审计 action / tags |
|--------|-------|-------------------|
| `approveAlert`（风险审批，RiskAlertModal / InboxPage / ExecWorkspacePage 调用） | `ROLE_ACTORS[currentRole].name`（唯一随角色走的写入点） | `审批通过`/`拒绝` · `['human-in-loop']` · ok/blocked |
| `toggleMCP` | 昆仑（您） | `连接/断开 MCP 应用` · `['mcp:{id}']` |
| `requestExit`（ExitActionModal） | `a.requestedBy` | `发起交付出口 · {action}` · `['exit','evidence']` · pending |
| `decideExit`（ExitQueue / InboxPage） | approver 入参 | `批准/拒绝交付出口` · `['exit','human-in-loop']` |
| `addGrant`（AuthorizationCeremony） | `g.signedBy` | `签署授权仪式` · `['grant','human-in-loop']` |

**C. 组件直接 pushAudit**
| 模块 | action → tags |
|------|--------------|
| SkillsPage | 安装技能 → `['skill:install']`；启用/禁用技能 → `['skill:toggle']`（actor 恒昆仑） |
| EmployeeDrawer | 更换 Agent 头像 → `['agent','avatar']`；发起会议 → `['meeting']`；启动/暂停 Agent → `['agent']` |
| Marketplace | 招聘数字员工 → `['marketplace','hire']`；一键部署团队套餐 → `['marketplace','package']`（pending） |
| MeetingRoom | 发起会议 → `['meeting','start']`；会议结束·生成纪要 → `['meeting','finish','actions:{N}']`；会议行动项转任务 → `['meeting','task','ch-q3']`；批量转任务 → `['meeting','task','batch']` |
| taskFlow `useTaskTransition`（TasksPage / TaskDrawer / AcceptancePanel 共用，actor = `ROLE_NAMES[currentRole]`） | 任务启动/提交验收/解除阻断 → 默认 `['task','to:{next}']`；确认验收·任务完成 → `['task','acceptance','passed']`；验收不通过·打回重做 → `['task','acceptance','rework']`（warning）；验收不通过·转人工处理 → `['task','acceptance','manual']`（warning）；验收·降级交付 → `['task','acceptance','degraded']`（warning） |
| InboxPage | 收件箱审批通过/拒绝 → `['inbox','human-in-loop']`（ok/blocked）；收件箱处理 → `['inbox']` |
| ExecWorkspacePage（actor = 吴帆·销售VP 或 系统（超时策略）） | 默许放行（超时未审）→ `['exec','tacit','decompose']`；拆解超时未审·升级老板收件箱 → `['exec','escalate','decompose']`；确认授权分身拆解 → `['exec','decompose']`；打回重拆·{note} → `['exec','decompose','reject']`；补确认（默许转正式确认）→ `['exec','tacit','confirm']`；撤回默许放行·打回重拆 → `['exec','tacit','revoke']`；配置预授权规则 → `['exec','preauth']`；部门验收通过/打回 → `['exec','accept','task:{id}']` |
| StaffWorkspacePage（actor = 小周（一线员工）） | 派活给数字员工 → `['staff','assign','ch-q3']` |
| SopStudio（专家门户） | SOP 提交签名认证 → `['expert','sop','certify']`（pending）；[3s 后] 平台认证委员会 · SOP 认证通过并上架 → `['expert','sop','listed']` |
| TicketBoard（专家门户） | 签署临时保密与责任协议·接单开始响应 → `['expert','sla','expert-nda']`；关闭介入工单 → `['expert','sla','resolve']`；系统 · 关单撤销专家上下文访问权·处置记录归档 → `['expert','access-revoked']` |
| TrialReportCard | 试岗决策·转正并授权（双达标）→ `['trial','promote','human-in-loop']`；延长试岗 → `['trial','extend','human-in-loop']`（pending）；退回市场 → `['trial','return','human-in-loop']`（blocked） |

## 5. 数据与状态

- `auditLog: AuditEntry[]`，`AuditEntry = { id, ts, actor, action, target, result: 'ok'|'blocked'|'pending'|'warning', hash, tags? }`。初始 `seedAudit`（8 条）；内存上限 500；持久化仅前 60 条（`partialize`）。`clearAudit()`（重置回 seed）在 store 定义但无 UI 调用方。
- **hash 与链的 mock 方式**：`hash = makeHash()` 完全随机，与记录内容无关；**prev_hash 不入库**，由 AuditPage 的 `prevHashOf` useMemo 现算：`auditLog` 新→旧排列，`prev_hash(e[i]) = auditLog[i+1].hash ?? GENESIS_HASH('0x0000')`。即「链」只是把相邻两条的随机 hash 摆在一起展示，ChainSnapshot 头部的「链式校验通过」chip 恒显示，没有任何校验计算。持久化截断到 60 条后，第 60 条的 prev 变为创世块，链会「静默重锚」。
- 本地 state：`q / resultFilter / actorFilter / tagFilter / riskFirst / expandedId`。

## 6. 模块联动（ChainSnapshot 推导规则全量文档化）

ChainSnapshot 只输入 `AuditEntry + prevHash`，从静态数据（`employees` / `executiveTwins` / `HUMAN_BOSS` / `BOSS_TWIN` / `skillItems`）**纯前端确定性推导**责任链：

**(a) 确定性随机**：`seed(entry.id + entry.hash)` 做 31 进制滚动 hash（mod 99991）得 `n`；同一条记录每次展开结果一致。所有编号由 n 派生：授权仪式号 `GRANT-2026-{100+(n%880)}`、A2A 委派号 `A2A-{1000+((n*7)%8999)}`、策略号 `POL-{001..009}`（`1+(n%9)`）、grant 子号 `-S{1+(n%4)}`。

**(b) actor 匹配 → 三种链形**：
1. **老板短链**：`entry.actor.includes('昆仑')` → 仅 L1 一级：`昆仑 · 真人老板`，依据「本人操作 · 企业根权限（无需上游授权）」。注意 taskFlow 的 `昆仑 · 老板` 也命中此分支。
2. **系统组件短链**：`findEmployee(actor)` 失败（匹配规则：`actor === e.name || actor.includes(e.name) || e.name.includes(actor)` 对 `employees` 逐个尝试）→ 三级链：L1 真人老板（昆仑，基于 `HUMAN_BOSS`）→ L2 老板数字分身（`BOSS_TWIN`，依据「授权仪式 {grantNo} · 有效期至 2026-12-31」）→ L3「平台治理组件」（name = 原 actor，依据「策略引擎根授权 POL-ROOT-001 · 部署签名 sha256:{entry.hash 去 0x}…」）。命中者包括 Exec-Guardian、Hermes、系统、平台认证委员会、审计员，也包括本应是真人的 `吴帆·销售VP`、`小周（一线员工）`、`林知远（专家）`——**真人角色被误标为平台组件是已知局限**。
3. **数字员工五级全链**：`findEmployee` 命中（如 雪·销售官 / 律·法务官）→
   - L1 真人老板：依据「企业根权限 · 授权仪式 {grantNo} 创始签署」；
   - L2 老板数字分身：依据「授权仪式 {grantNo} · 签署有效」；
   - L3 高管分身：`findExecFor(emp)` —— 先查 `executiveTwins[].managesEmployeeIds.includes(emp.id)` 直属；未命中则按 `emp.role + emp.department` 关键字路由：含「销售」→ exec-sales；含「运营/设计/客服/营销」→ exec-ops；含「产品/研发/数据」→ exec-product；含「财务/法务」→ exec-finance；最终兜底 `executiveTwins[0]`。依据「A2A 委派记录 A2A-xxxx · 目标下发已确认」；
   - L4 真人高管：取该 exec 的 `humanName / humanTitle`（如 吴 VP / 销售副总裁），依据「策略规则 POL-00x · 人签确认边界内代理」；
   - L5 数字员工：emp 本人（标「本条记录执行者」chip），依据「权限 grant {grantNo}-S{1..4} · 技能签名校验通过」。

**(c) 三行关键信息的推导来源**：
- **依据 SOP 版本** `deriveSop`，四级 fallback：① tags 中首个 `skill:` 前缀标签 → 去前缀得 raw，在 `skillItems` 找 `raw.includes(sk.version) || sk.name.includes(raw)`，命中输出 `{name}（{version} · 已签名）`，未命中输出 `{raw}（市场签名 Skill）`；② 某 skill 的 `recentCalls` 有 `caller === entry.actor`；③ emp 存在时找 `applicable.includes(emp.role)` 的 skill；再退到 emp 首个 `equipped` 技能 → `{name} SOP（v{level}.0 · 内置基线）`；④ 兜底「平台基线 SOP（v1.0 · 内置）」。
- **命中策略规则** `derivePolicy`，优先级：blocked 或含 `risk:high` → 「单笔 > 50w 四眼原则 · POL-004」；含 `human-in-loop` → 「人工在环强制审批 · POL-002」；warning 或任一 `risk*` tag → 「敏感动作外发扫描 · POL-007（DLP）」；否则「常规动作 · 未命中风控规则」（灰显）。
- **专家认证状态** `deriveExpert`：emp 存在且 `emp.expert` 非空 → 「林知远 认证 · 签名有效」+ 副文案「背书专家：{emp.expert}」（注意认证人硬编码林知远，与 expert 字段的「前阿里 P10」等描述并存）；否则「平台内置组件 · 免专家认证」。

其他联动：全库各模块写入见 §4.7；治理舱的「审计快照」卡是独立静态数据，不读 auditLog。

## 7. Mock 边界与已知限制

1. **hash 链是展示层拼装**：hash 随机、prev_hash 现算、校验恒绿；「SQLite WAL / 触发器 / 篡改检测三重比对」全为文案。
2. **责任链是推导不是记录**：授权仪式号 / A2A 号 / POL 号由 seed 生成，与 `grants`、真实 A2A 事件、风控规则均无关联；真人角色（exec/staff/expert）actor 会被归为「平台治理组件」。
3. **导出两个按钮只弹 toast**，无文件；「高级筛选」空壳。
4. **SummaryCard 口径粗糙**：「今日记录」实为全量条数；「签名验证 100%」硬编码。
5. **持久化截断**：账本只存 60 条，内存 500 条，超出即静默丢弃——与 Append-only 叙事矛盾。
6. mock runtime 持续注水（每 10s / 20s 一条），审计员筛选下拉的选项集合会随时间膨胀。
7. `ts` 只有时分秒无日期，跨天记录无法区分；排序完全依赖数组插入顺序。
