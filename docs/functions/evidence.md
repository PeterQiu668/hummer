# 交付物 / 证据库与交付出口（evidence）

> 源码：`src/components/pages/EvidencePage.tsx`、`src/components/work/ExitActionModal.tsx`、`src/components/work/ExitQueue.tsx`、`src/store/useAppStore.ts`（`exitActions` / `requestExit` / `decideExit`） · 状态：**部分闭环**（出口动作「发起 → 审批 → 生效」是真交互闭环；证据列表本身为静态种子，纯展示）

## 1. 定位与对应闭环

证据库回答客户的核心质疑：「Agent 到底交付了什么、依据是什么、谁确认了」。每条产出物带 hash / 时间戳 / 责任 Agent / 审批人 / 资料来源 / 知识引用，属于「②信任闭环」的证据链展示面。其上叠加的**交付出口**（发送客户 / 回写 CRM / 发布）补的是 Top10 缺口 ②「交付物无业务出口」——产出物不能停在库里，要经老板审批后「生效」到外部系统，这段属于「①工作闭环」的最后一公里，全程 `pushAudit` 留痕。

## 2. 入口与角色可见性

- 左导航项：`FileBox` 图标「交付物」，`PageKey = 'evidence'`，badge 写死 `'8'`。
- 角色可见性（`ROLE_SECTIONS`）：
  - **boss**：可见（「工作」分组），且是**唯一能在出口队列直接批准/拒绝**的角色
  - **exec**：可见（「工作台」分组），可发起出口，不能审批（显示「等待老板审批」）
  - **staff**：可见（「资源」分组），同 exec 只能发起
  - **expert**：不可见
  - **auditor**：可见（「审计」分组），同样只能发起不能审批
- 页内权限差异集中在 ExitQueue：`isBoss = currentRole === 'boss'` 决定渲染 批准/拒绝 按钮还是「等待老板审批」文案。发起出口动作（ExitActionModal）对所有可进入页面的角色开放，发起人记 `ROLE_NAMES[currentRole]`。
- 其他入口：TaskDrawer 产出物条目「去证据库发起出口」跳转到本页；收件箱（boss）会把待审批出口动作聚合为审批卡。

## 3. 界面结构

- WorkspacePage 外壳（标题「证据库 · 产出物」）
  - actions：「高级筛选」「批量导出」（占位死按钮）
  - sticky 条：搜索框（匹配产出物名 / 责任 Agent 名）+ 状态筛选 pills（全部/草稿/已审批/已交付/已归档）+ 计数 chip
  - 统计四宫格 Stat：总产出物 / 本周交付（shipped 数）/ 待审批（**统计的是 draft 数**）/ 出口动作（`exitActions.length`）
  - **ExitQueue 交付出口队列**（hum-card）
    - 头部：总条数 + 待审批数 chip + 角色提示文案
    - 列表行：动作图标 → 证据名 → 目标、发起人/时间/审批人、状态 chip（待审批黄 / 已生效绿 / 已拒绝红）、boss 专属 批准/拒绝 按钮
    - 空态：提示对下方 approved/shipped 证据点击动作按钮发起
  - 证据表格（8 列：产出物 / 类型 / 责任 Agent / 审批 / 状态 / Hash / 时间 / 操作）
    - 产出物格下方追加「已生效 → 目标」绿色徽标（由已 executed 的出口动作反查）
    - 操作列：`approved | shipped` 状态才出现三个出口动作小图标（发送客户/回写 CRM/发布）+「详情」
  - EvidenceDrawer 详情抽屉（点行打开，440px）：责任 Agent / 审批人 / 关联任务 / 关联对话、资料来源列表、知识图谱引用 chips、合规凭证卡（SHA-256 / 签名已验证 / 入链时间 / 状态）、底部 预览/打开/下载（占位）
  - ExitActionModal 出口动作弹窗（见下）

## 4. 操作步骤与逻辑

**搜索 / 状态筛选** — 本地 state `q`、`statusFilter`，对静态 `evidenceSeed` 过滤，无副作用。

**查看详情** — 点表格行或「详情」→ 本地 state `detail = ev` → 渲染 EvidenceDrawer。抽屉内全部为展示，预览/打开/下载无处理函数。

**发起交付出口（核心链路第 1 步）** — 前置：证据 `status ∈ {approved, shipped}`（`canExit`，draft/archived 行不渲染动作按钮）。
1. 点操作列三个图标之一（`send_client` 发送客户 / `writeback_crm` 回写 CRM / `publish` 发布，`e.stopPropagation()` 不触发详情）→ 本地 state `exitReq = { ev, action }` → 打开 ExitActionModal。
2. 弹窗内从 `ACTION_META[action].targets` 三个写死目标中单选（如发送客户：「鲲鹏制造 · 王总邮箱 / 云海制药 · 陈总监邮箱 / 飞书外部群」；回写 CRM：「Salesforce 商机 #4471 / 客户档案 / 金蝶 ERP 应收单」；发布：「企业知识库 / 官网博客 / 飞书公告」）。未选目标时「确认发起」disabled。
3. 点「确认发起」→ `store.requestExit({ evidenceId, evidenceName, action, target, requestedBy: ROLE_NAMES[currentRole] })`：
   - store 生成完整记录 `{ id: 'exit-<Date.now()>', ts, status: 'pending_approval' }`，unshift 进 `exitActions`
   - 同步写审计：`{ actor: 发起人, action: '发起交付出口 · <action枚举值>', target: 证据名, result: 'pending', tags: ['exit','evidence'] }`
   - 弹窗侧 `pushToast({ kind: 'info', title: '出口动作已发起 · <动作名>', detail: '「证据名」→ 目标 · 等待老板审批后生效' })`
4. 新记录立即出现在页面上方 ExitQueue（黄色待审批）与 boss 收件箱。

**审批出口动作（核心链路第 2 步，仅 boss）** — 前置：`status === 'pending_approval'` 且当前角色 boss。
- 点「批准」→ `decideExit(a.id, true, ROLE_NAMES.boss)`：`exitActions` 中该条 `status → 'executed'`、`approvedBy = '昆仑 · 老板'`；审计 `{ actor: 审批人, action: '批准交付出口', target: 证据名, result: 'ok', tags: ['exit','human-in-loop'] }`；ExitQueue 侧 success toast「已批准出口动作 · <动作名>」。
- 点「拒绝」→ `decideExit(a.id, false, …)`：`status → 'rejected'`；审计 `action: '拒绝交付出口', result: 'blocked'`；warning toast。
- 注意：审批人参数写死 `ROLE_NAMES.boss`（按钮仅 boss 可见所以结果一致，但代码上不取 currentRole）。

**生效回显（第 3 步）** — `executedByEvidence` useMemo 把 `status === 'executed'` 的动作按 `evidenceId` 分组，在对应证据行名称下渲染「已生效 → 目标」绿色 chip（可多条）。证据本身的 `status` 字段**不变**（仍是 approved/shipped，不会变成 executed——PRD 里「证据状态 executed」实际实现为徽标叠加）。

**从收件箱审批（跨模块路径）** — InboxPage 把 `exitActions` 全量映射为 `kind: 'approval'`、`urgent: true` 的收件卡（id 前缀 `exit-`，detail「<证据名> → <目标>，动作生效前需要您审批」）；boss 点批准/拒绝 → `decideExit(id.replace(/^exit-/, ''), approve, '昆仑（您）')`——注意此路径审批人字符串是「昆仑（您）」，与 ExitQueue 路径的「昆仑 · 老板」不一致。处理后收件卡标记「已批准执行 / 已拒绝」。

## 5. 数据与状态

- **证据种子**：`evidenceSeed` 硬编码在 `EvidencePage.tsx` 内（8 条，非独立 data 文件），结构 `Evidence { id, name, kind(doc/sheet/pdf/memo/sop/report/log), status(draft/approved/shipped/archived), ownerId, approverId?, taskId?, conversation?, sources[], knowledgeRefs[], hash, ts, size }`。approverId 混用员工 id 与人名字符串（'昆仑'、'Hermes'）。
- **store 字段**：
  - `exitActions: DeliverableExitAction[]`（`lib/types.ts`：id/evidenceId/evidenceName/action/target/status/requestedBy/approvedBy?/ts）
  - `requestExit(a)` — 补 id/ts/status 并写审计；`decideExit(id, approve, approver)` — 改 status + approvedBy 并写审计
- **持久化**：`exitActions` **不在** persist 的 `partialize` 白名单里 → **刷新页面后出口队列清空**（含已生效记录与「已生效」徽标）；相关审计条目因 `auditLog` 持久化（前 60 条）而保留。
- 关联映射：`empMap`（employees）、`taskMap`（collabTasks）用于抽屉展示责任人与关联任务标题；`ev-4/ev-5` 的 taskId（tk-ops-q3 / tk-strategy-q3）在 collabTasks 中不存在，抽屉里关联任务一栏不显示。

## 6. 模块联动

- **任务 → 证据库**：TaskDrawer「去证据库发起出口」`setActivePage('evidence')` + toast；仅切页，不定位到具体证据（抽屉里的产出物名与 evidenceSeed 部分同名但无 id 关联）。
- **证据库 → 收件箱**：`exitActions` 中 pending_approval 条目实时聚合进 InboxPage 审批 tab（老板闭环的统一承接面），两处审批操作等价（都调 `decideExit`）。
- **证据库 → 审计链**：发起（result pending）/ 批准（ok）/ 拒绝（blocked）三类动作均入 `auditLog`，tags `['exit','evidence']` 或 `['exit','human-in-loop']`，审计页可按此追溯。
- **角色系统**：发起人 / 审批权限依赖 TopBar 角色切换器写入的 `currentRole`。

## 7. Mock 边界与已知限制

- **假的部分**：证据列表为组件内硬编码，Agent 产出任务时不会真的新增证据（任务完成 / 会议纪要归档都不会落一条新 Evidence）；hash「取自内容 SHA-256」「签名已验证」仅是文案；预览/打开/下载/批量导出/高级筛选全是死按钮；出口目标是每类动作写死的 3 个选项；「批准生效」不触发任何真实外部动作（不发邮件、不写 CRM）。
- **数据一致性问题**：统计卡「待审批」统计的是 draft 证据数而非出口待审批数；`ev-4/ev-5` 引用不存在的 taskId；两条审批路径的审批人字符串不一致（「昆仑 · 老板」vs「昆仑（您）」）；证据 status 与出口生效状态是两套并行状态。
- **持久化缺口**：`exitActions` 不持久化，刷新即丢，演示中途刷新会导致「已生效」徽标消失而审计链仍有记录，两者对不上。
- **真实落地需替换**：证据实体入库（由任务执行 / 会议归档等事件自动生成，含真实内容 hash 与签名）、出口动作对接真实 connector（邮件 / Salesforce / CMS）并回写执行回执、出口审批走统一审批流（与风险审批、收件箱同一模型）、按角色的细粒度出口权限（当前 auditor 也能发起「发送客户」）、evidenceSeed 抽到 `src/data/` 独立文件。
- **UX 缺陷**：发起出口后无「撤回」；被拒绝的动作不能重新发起编辑；同一证据可对同一目标重复发起多条待审批记录，无去重提示。
