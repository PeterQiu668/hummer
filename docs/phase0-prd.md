# Phase 0 PRD — 原型补全：演示即闭环（多角色 UX 原型）

> 依据：`docs/hummer-product-architecture.md` §3 闭环审计 Top10、§5 顶层产品架构、§6 Phase 0、附录 A。
> 原则：纯前端 mock（不接后端、不做真实 agent），把 Top 10 闭环缺口和五个角色端在 UI 层全部闭合。
> 视觉：延续 Notion/Linear 克制企业风（styles.css 的 hum-* 工具类 + neutral 色板 + 低饱和蓝青），禁止霓虹风。

## 1. 角色体系（顶栏切换，mock 身份）

| RoleKey | 身份 | 默认页 | 可见导航 |
|---|---|---|---|
| boss | 昆仑 · 老板 | office | 指挥中心/收件箱/对话流/任务/交付物/员工/市场/技能/MCP/ROI 经营/知识/治理/复盘 |
| exec | 吴帆 · 销售 VP（真人高管） | execws | 高管工作台/对话流/任务/交付物/我的员工/技能 |
| staff | 小周 · 一线员工 | myagents | 我的 AI 同事/对话流/任务/交付物/知识 |
| expert | 林知远 · 入驻专家 | expertportal | 专家门户（含共创工作台/工单/收入） |
| auditor | 合规审计员 | audit | 审计链/证据库/审计与治理 |

## 2. 新增/改造页面清单（对应闭环缺口）

| # | 缺口 | 页面/组件 | 要点 |
|---|---|---|---|
| ① | 验收环缺失 | TasksPage 内验收工作台 | acceptance 逐条 通过/不通过；不通过三选一（打回重做/转人工/降级交付）；TaskStatus 增加 failed/overdue；看板增加对应列/标记；dueAt 超期红标 |
| ② | 交付物无出口 | EvidencePage 出口动作 | 每条证据「生效动作」：发送客户/回写 CRM/发布；动作创建 → 待审批 → 收件箱/审批通过 → 状态 executed；全程写审计 |
| ⑦ | 收件箱未实现 | InboxPage（新） | 五类事件聚合（approval/block/stuck/accept/anomaly，复用 douyin.ts 数据 + store 实时事件）；逐条处理动作；处理即写审计+toast |
| ④ | ROI/账单缺失 | RoiPage（新） | 两 tab：经营 ROI 月报（完成任务/验收通过/等效人时/人力成本对比/专家介入）+ 账单中心（部门/员工/任务三级归因、预算硬顶进度条、失败不计费标注） |
| ⑥ | 试岗-转正断头 | Marketplace 我的招聘改造 | 试岗报告卡（7 天进度、四维指标、任务明细）→ 第 7 天强制三选一：转正并授权/延长试岗/退回；转正进入授权仪式 |
| ⑩ | 授权仪式缺失 | AuthorizationCeremony（新组件） | 签署页：权限清单/数据范围/月度额度/有效期 → 确认签署 → 写审计 + grant 入 store |
| ③ | 专家保障无兑现 | ExpertPortalPage（新） | 专家视角四 tab：介入工单（SLA 倒计时/时间线/处置）/共创工作台（SOP 编辑→沙箱试跑→提交认证→上架）/我的 Agent 与收入分成/声誉等级 |
| ⑤ | 多角色入口缺失 | ExecWorkspacePage + StaffWorkspacePage（新） | 高管：待确认拆解队列/部门验收队列/部门绩效卡；一线：「我的 AI 同事」卡片（派活/催办/验收）+ 我发起的任务 |
| — | 责任链快照 | AuditPage 增强 | 高风险审计条目可展开快照：动作→授权人→SOP 版本→命中策略→专家认证链 |
| — | 会议行动项转任务 | MeetingRoom 改造 | 结束会议时行动项一键转 CollabTask（addTask）并指派，出现在任务页 |

## 3. 共享契约（已由地基提供，feature agent 不得改动 shared 文件）

- `lib/types.ts`：RoleKey、TaskStatus(+failed/overdue)、AcceptanceJudgement、DeliverableExitAction、AuthorizationGrant、TrialDecision、ExpertTicket
- `store/useAppStore.ts`：currentRole/setCurrentRole、inboxDone/resolveInbox、extraTasks/addTask、exitActions/requestExit/decideExit、trialDecisions/decideTrial、grants/addGrant、expertTickets/pushExpertTicket/updateExpertTicket；PageKey 增加 inbox/roi/execws/myagents/expertportal
- `shell/TopBar.tsx`：角色切换器；`shell/LeftNav.tsx`：按角色过滤导航；`shell/AppShell.tsx`：新页面路由已注册

## 4. 文件归属（并行开发防冲突，越界即冲突）

| Agent | 独占文件 |
|---|---|
| A 老板闭环 | pages/InboxPage.tsx、pages/RoiPage.tsx、data/roi.ts（新建） |
| B 工作闭环 | pages/TasksPage.tsx、pages/EvidencePage.tsx、components/work/*（新建） |
| C 生命周期 | marketplace/Marketplace.tsx、components/onboarding/*（新建）、data/trial.ts（新建） |
| D 多角色 | pages/ExecWorkspacePage.tsx、pages/StaffWorkspacePage.tsx、meeting/MeetingRoom.tsx |
| E 专家端 | pages/ExpertPortalPage.tsx、components/expert/*（新建）、data/expertops.ts（新建） |
| F 审计链 | pages/AuditPage.tsx、components/audit/*（新建） |

共同规则：中文 UI；复用 hum-* 工具类与现有色板；文件 <500 行；所有用户动作有 pushToast 反馈、关键动作 pushAudit 留痕；改完必须 `npx tsc -b --noEmit` 零错误。

## 5. 验收标准（演示脚本能一遍跑通）

1. 顶栏切到老板 → 收件箱处理一条审批 → 审计链出现记录
2. 任务页打开任务 → 验收标准逐条判定 → 不通过打回 → 任务回到进行中；另一任务超期显示 overdue
3. 证据库对一条 approved 证据发起「回写 CRM」→ 收件箱出现待审批 → 批准 → 证据状态 executed
4. 市场「我的招聘」→ 试岗报告卡 → 转正 → 授权仪式签署 → 我的员工可见 + 审计留痕
5. 切到专家 → 看到介入工单响应 → 共创工作台走一遍 SOP→沙箱→提交认证
6. 切到高管 → 确认一条拆解、验收一条部门交付；切到一线员工 → 给 AI 同事派活
7. 会议室结束会议 → 行动项出现在任务页
8. ROI 页展示月报与账单、预算硬顶进度
