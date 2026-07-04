# 对话流与频道体系（chat）

> 源码：`src/components/pages/ChatPage.tsx`、`src/components/shell/BottomFlow.tsx`、`src/components/collab/{MessageStream,ChannelList,MemberPanel,MentionPicker,RiskAlertModal,TaskCard}.tsx`、`src/data/feishu.ts`、`src/store/useAppStore.ts`（collabFeed / approveAlert / ROLE_ACTORS） · 状态：有交互闭环（发消息 / 风险审批 / 成员面板可用；拉人入群、附件、@ 等为半 mock）

## 1. 定位与对应闭环

对话流是「企业 = 群聊集合」这一叙事的主承载面，对应 Grill 02「频道规则 v2」的责任链闭环：

- 老板意图入口（ch-boss：msg → translate）
- 分身预拆解与真人确认（ch-twin-sales：decompose → confirm/打回 → decompose v2）
- 高管分身 A2A 协调（ch-exec：decompose + 真人 confirm）
- 业务作战群执行（ch-q3/ch-mkt/ch-delivery/ch-618：task/tool_call/deliverable/evidence）
- 风险通道留痕（ch-risk：alert/approval/evidence）
- 系统通告复盘（ch-hermes：evolution 单向）

它同时是风险审批闭环的消息侧出口：`approveAlert` 的决策结果以 approval 消息回投业务群并双投 ch-risk（见 §4.5）。

同一套数据有两个 UI 入口：

| 入口 | 触发条件 | 消息渲染 | 功能差异 |
|---|---|---|---|
| ChatPage（全屏页） | `activePage === 'chat'` | 页内简化版 `MessageRow` | 有角色权限过滤、成员面板、confirm 语义提示；无 @ 选人、无风险弹窗 |
| BottomFlow（3D 办公室底部悬浮 IM） | boss 视角 office 页常驻 | `MessageStream`（12 类型全量差异渲染） | 有 MentionPicker、RiskAlertModal、TaskCard 内嵌、高危横幅；无角色过滤（写死昆仑身份） |

## 2. 入口与角色可见性

- 导航入口：LeftNav「对话流」项存在于 boss / exec / staff 三角色的 ROLE_SECTIONS。
- 旁路入口：LeftNav 底部「活跃频道」分组对**所有有频道访问权的角色**渲染，点击即 `setActiveChannel + setActivePage('chat')`——expert / auditor 虽无「对话流」导航项，仍可经此进入 chat 页。

角色 × 频道访问矩阵（`ROLE_CHANNEL_ACCESS`，无条目 = 该角色完全不可见该频道；note 会作为 chip 显示在输入区/LeftNav）：

| 频道 | boss | exec（吴帆） | staff（小周） | expert（林知远） | auditor |
|---|---|---|---|---|---|
| ch-boss 老板总控群 | rw | — | — | — | r（审计只读） |
| ch-exec 高管分身会议室 | rw | rw（仅确认/仲裁） | — | — | r（审计只读） |
| ch-twin-sales 吴帆⇄销售VP分身 | r（合规可见） | rw（确认/打回） | — | — | — |
| ch-q3 销售增长作战群 | rw | rw | rw | rw（工单期临时入群） | r（审计只读） |
| ch-mkt 市场内容群 | rw | — | — | — | r（审计只读） |
| ch-delivery 客户交付群 | rw | rw | — | — | r（审计只读） |
| ch-618 618 复盘 | rw | rw | rw | — | r（审计只读） |
| ch-risk 风险审计群 | rw | rw（审批会签） | — | — | r（审计只读） |
| ch-hermes 质量复盘通告 | rw | r | r（只读） | — | r（审计只读） |

与 Grill 02 结论的已知偏差：

- auditor 看不到 ch-twin-sales（其余 8 群全只读）；
- boss 在 ch-hermes 为 rw，而 v2 生成规则表定义系统通告应「全员只读、Hermes 单向」；
- 吴帆（exec）看不到 ch-mkt——grill 文档明确指出这恰是「按管辖关系推导」应得的结果，属有意设计。

发言身份跟随角色（`ROLE_ACTORS`）：

| 角色 | 发言者 | 头像 | senderRole |
|---|---|---|---|
| boss | 昆仑（您） | 昆 | human |
| exec | 吴帆·销售VP | 吴 | human |
| staff | 小周 | 周 | human |
| expert | 林知远·专家 | 林 | expert |
| auditor | 审计员 | 审 | human |

## 3. 界面结构

ChatPage 三栏 `grid-cols-[220px_1fr_280px]`：

- **左栏 频道列表**：按 `CHANNEL_GROUPS` 顺序渲染——责任链群（ch-boss/ch-exec）→ 分身管理（ch-twin-sales）→ 业务作战群（ch-q3/ch-mkt/ch-delivery/ch-618）→ 风险通道（ch-risk）→ 系统通告（ch-hermes），先经角色矩阵过滤，空分组隐藏。每项含类型色点（incident 红 / system 紫 / dm 黄 / boss·exec 蓝 / 其余绿）、只读徽标（`!acc.write`）、静态 unread 角标。
- **中栏 消息区**：频道头（频道名 + 「N 位成员」按钮 + 前 5 名成员头像叠 + 「拉人入群」按钮 + MemberPanel 弹层锚点）→ 消息流（scrollRef，随消息数变化平滑滚底）→ 输入区（confirm 语义提示条 + 发言身份行 + 附件/@按钮 + 输入框 + 发送按钮）。
- **右栏 本频道任务**：`collabTasks.filter(t => t.channel === activeChannel)` 的摘要卡（标题 / goal / 进度条），空态斜体提示。

BottomFlow 亦为三栏（200px ChannelList / 消息流 / 240px 频道任务），顶部多一条「注意 · N 个高危待审批」红色横幅（点击打开第一条 pending 风险的弹窗）。

## 4. 操作步骤与逻辑

### 4.1 切换角色引起的频道回退
- 前置条件：当前 `activeChannel` 对新角色无访问条目。
- 操作：TopBar 切角色（`setCurrentRole`）。
- 状态变化：ChatPage useEffect 检测 `!access[activeChannel]` → `setActiveChannel(firstVisibleId)`（该角色可见分组中的第一个频道）。
- 副作用：无审计、无 toast。

### 4.2 切换频道
- 操作：点击左栏频道项，或 LeftNav 活跃频道项。
- 状态变化：store `activeChannel` 更新；本地 `showMembers` 经 useEffect 重置为 false；消息 memo 按新频道重算过滤。
- 副作用：LeftNav 路径下额外 `setActivePage('chat')` + `setLeftNav('chat')`；无审计。

### 4.3 发送消息
- 前置条件：`canWrite = Boolean(access[activeChannel]?.write)` 且 `draft.trim()` 非空。只读时输入框/附件/@/发送全部 disabled，placeholder 与身份行显示「只读频道 · 无发言权限」+ Lock 图标。
- 操作：输入 → Enter 或点「发送」→ `handleSend`。
- 状态变化：`pushCollabMessage` 向 store `collabFeed` 追加一条：`id = cm-{Date.now()}`、`ts` = 当前 HH:MM、`channel = activeChannel`、sender/avatar/senderRole 取 `ROLE_ACTORS[currentRole]`、`type` 恒为 `'msg'`；本地 `draft` 清空。
- 副作用：**无 pushAudit、无 toast**——用户发言不留审计痕。
- 分支（confirm 语义提示，Grill 02 决策相关）：`isExecConfirmOnly = currentRole==='exec' && activeChannel==='ch-exec'` 时——
  - 输入区上方出现黄色提示条「此群为分身间 A2A 协调 · 您的发言仅限确认/仲裁」（Scale 图标）；
  - placeholder 变为「输入确认 / 打回 / 仲裁意见（日常协调由分身完成）」；
  - 发送按钮文案变「发送确认/仲裁」。
  - **仅提示语义**：不校验内容，消息仍以 type 'msg' 发出——与 grill 文档「demo 可先用输入框提示表达」一致。

### 4.4 查看群成员（MemberPanel，Grill 02 待实现清单 #4）
- 操作：点频道头「N 位成员」chip → 本地 `showMembers` 翻转；再点或点面板 X 关闭。
- 数据：`deriveChannelMembers(activeChannel)` 纯函数推导（useMemo，不入 store）。
- 渲染：按 kind 分组排序——老板(0) → 老板分身(1) → 高管分身(2) → 真人高管(3) → 数字员工(4) → 一线真人(5) → 守护者(6) → 系统(7) → 外部专家(8)；每人展示身份徽标 + `reason` 文案（"为什么我在这个群"可解释）；`muted` 成员挂「免打扰 · 仅合规可见」徽标；底部脚注「静态透明 · 动态沉默——成员名单永远可查，永不显示正在查看/已读」（决策③的直接落地）。
- 成员推导规则（`data/feishu.ts` deriveChannelMembers）：
  - ch-boss：昆仑（责任链起点）+ 昆仑·数字分身（责任链第一跳）；
  - ch-exec：5 高管分身（A2A 协调主体）+ 5 真人高管（列席观察 · 仅 confirm/仲裁两类写动作）+ 老板（muted）；
  - ch-risk：Exec-Guardian + 老板（风险主动触达 · 免打扰例外，muted=false）+ 万·CFO 分身/真人（四眼会签）+ 戟·安全官 + 审计员；
  - ch-hermes：Hermes（唯一发布方）+ 老板/全部高管/全部数字员工/小周（全员只读）；
  - ch-twin-sales：吴帆真人（通道主人）+ 吴·销售 VP 分身 + 老板（合规可见 muted）；
  - 业务群走 `deriveBusinessMembers`：`BUSINESS_UNITS` 按 `matchZone`（ch-q3 = zone 'business' 全部 9 名数字员工）或 `matchEmployeeIds`（ch-mkt/ch-delivery/ch-618）选单元数字员工 + humanStaff 一线真人 + **沿 `executiveTwins.managesEmployeeIds` 反查直属上级分身与真人高管**（可见性沿汇报线向上，不向下不横向）+ extras（ch-delivery 的林知远·专家「工单 #ET-3 临时入群 · 关单即退」）+ 老板（muted），Set 去重。
- 注意：频道头「N 位成员」用推导结果长度，与 `channels[].members` 静态数字是两套口径（BottomFlow 用后者）。

### 4.5 风险审批（BottomFlow 路径；风险双投机制）
- 前置条件：`riskAlerts` 存在 status 'pending' 项（种子 3 条：138w 调拨 critical / 合同外发 high / 群发涉敏 medium）。
- 操作：点顶部红色横幅，或消息流中 alert 气泡（MessageStream 按「同频道 + pending」启发式挂 `riskAlertId`，显示「点击审批」角标）→ RiskAlertModal 展示触发员工/动作/涉及数据/阻断原因/建议 → 三选一：批准 / 拒绝 / 改为更安全方式（= reject + note '改为更安全方式'）。
- 状态变化（store `approveAlert`）：目标 alert status → approved/rejected；`pendingApprovals` 重算。
- 副作用（**风险双投**）：
  1. 向 `target.channel` 推 approval 消息「[OK] {actor}批准了 · {action}」或「[X] {actor}拒绝了 · {action}」；
  2. 若 `target.channel !== 'ch-risk'`，再向 ch-risk 推「【决策记录】{action} · 决策：批准/拒绝 · 决策人：{actor} · 源频道：{channel}」；
  3. 写审计：actor = `ROLE_ACTORS[currentRole].name`、action 审批通过/拒绝、result ok/blocked、tags `['human-in-loop']`。
- ChatPage 内无风险审批入口，仅页头「N 个高危待审批」徽标（不可点）。

### 4.6 @ 提及（仅 BottomFlow）
- 操作：输入 `@` 或点 @ 按钮 → MentionPicker 按 zone 分组（决策中心/业务办公区/支撑办公区/会议室/休息区/学习区）过滤 employees（名字/角色/头像模糊匹配）→ 点选回填 `@名字 `。
- 发送时 content 含 @ 则 type 记 'mention'；MessageStream `renderMentions` 高亮 @token。ChatPage 的 @ 按钮无 handler。

### 4.7 无功能的可点元素
「拉人入群」（ChatPage 与 BottomFlow 各一处）、附件回形针（两处）、ChatPage 的 @ 按钮：纯展示。

## 5. 数据与状态

消息 **4 路合并来源**（ChatPage 与 BottomFlow 各自重复实现一份合并逻辑）：

1. `feishuMessages`——m1~m8，ch-q3 主演示剧本（含阻断/进化/拉会）；
2. `hermesNotices`——h1~h3，ch-hermes 进化通告；
3. `collabExtraMessages`——v5.3/v8/v9/v2 各期种子：m9~m13（合同线）、b1~b9（九类型示范剧本，横跨 ch-boss/ch-exec/ch-q3）、mkt1~4 / dlv1~4 / rsk1~5（空壳群补种）、tw1~4（分身 1v1 剧本）；
4. store `collabFeed`——用户发言 + approveAlert 回投 + mock runtime（每 15s 心跳消息、每 20s A2A 委派消息，slice 保留 80/100 条），不持久化，刷新丢失。

- **排序缺陷**：合并后按 `ts`（HH:MM 字符串）`localeCompare` 排序。ts 无日期位——跨天/跨来源无法正确排序（运行到次日 09:00 发的消息会排到种子 14:3x 之前）；同一分钟内多条消息顺序取决于排序稳定性而非真实先后；ChatPage 用 `(a.ts ?? '')` 容错而 BottomFlow 不容错，两份实现已漂移。
- ChannelList 的最近消息摘要 `latestSnippet` 只合并 feishuMessages + collabExtraMessages（漏 hermesNotices 与 collabFeed），与消息流不一致。

**12 种消息类型**（`FeishuMessage['type']` = 9 种 v8 类型 + 3 种 legacy；MessageStream 完整差异渲染，ChatPage MessageRow 只区分 alert/evolution/task 三种图标、其余按纯文本渲染——同一数据两处渲染档次不同）：

| type | 语义 | 典型产生者 | MessageStream 渲染差异 |
|---|---|---|---|
| msg | 普通发言 / 老板原始输入 | 各角色、用户发送 | 纯文本，@token 高亮 |
| translate | 老板意图转译 | 昆仑·数字分身 | 蓝框气泡 + 「昆仑转译」标签 |
| decompose | 高管分身预拆解 | 吴·销售 VP 分身 | 紫框气泡 + 「高管拆解」+ Workflow 图标 |
| confirm | 真人高管确认/打回 | 吴帆（真人）、吴 VP | 青框气泡 + 「高管确认」+ 对勾 |
| task | Agent 执行进展 | worker Agent | Workflow 图标，可挂 TaskCard（m2/m9） |
| tool_call | MCP 工具调用 | worker Agent | 等宽字体蓝框 `tool(args) →` + 扳手图标 |
| approval | 审批请求 / 决策记录 | 人类决策者、approveAlert 回投 | 绿框 + 「审批」标签 |
| deliverable | 产出物生成（含 sha256） | worker Agent | 绿框 + 「产出」+ FileText |
| evidence | 证据归档上链 | 系统审计 | 灰底等宽 + 「证据归档」 |
| alert（legacy） | 守护者阻断 | Exec-Guardian | 红框可点击（riskAlertId → 审批弹窗）+ 「阻断」 |
| evolution（legacy） | Hermes 进化通告 | Hermes | 紫底 + 「复盘」+ Sparkles |
| mention（legacy） | @ 提及 | 含 @ 的发言 | @ 图标，@token 高亮 |

senderRole 6 类（human/manager/worker/hermes/guardian/expert）决定头像配色；guardian 附加「守护者」chip、human 附加「老板」chip——后者对 exec/staff 的 human 发言也会错误显示「老板」（BottomFlow/MessageStream 硬编码假设 human = 老板）。

其他状态：`activeChannel`（store，不在 persist partialize 内）、`draft/showMembers`（ChatPage 本地）、`mentionOpen/mentionQuery/openAlertId`（BottomFlow 本地）；`channels[].unread/members` 为静态假数据，永不清零。

## 6. 模块联动

- **← 风险闭环**：ExecWorkspacePage「待我处理的风险」与 BottomFlow 弹窗共用 `approveAlert`——任一端处理，另一端同步消失；决策消息双投业务群 + ch-risk；同一条审计写入 AuditPage。
- **← 任务**：右栏任务摘要引用静态 `collabTasks`（不含 extraTasks、不叠加 taskStatuses 覆盖——一线派活声称进 ch-q3 但此处看不到）；MessageStream 给 m2/m9 内嵌 TaskCard 展示合同任务卡六要素。
- **← LeftNav**：活跃频道分组与 ChatPage 共用 CHANNEL_GROUPS + ROLE_CHANNEL_ACCESS（注释宣称三处统一消费，实际 ChannelList 未消费，见 §7.1）。
- **← mock runtime**：store 心跳持续向 ch-q3/ch-618/ch-mkt/ch-delivery/ch-hermes 注入消息与 A2A 委派，使频道「活着」。
- **→ 收件箱**：Grill 02 决策「老板免打扰、收件箱唯一主动触达」目前只体现在成员面板 muted 文案，未与 InboxPage 打通。

## 7. Mock 边界与已知限制

1. **ChannelList 不做角色过滤**：BottomFlow 里全部频道 + extraChannels（#部门·财务、林·决策官 dm）全量显示，未消费 ROLE_CHANNEL_ACCESS——boss 全 rw 所以演示无碍，是巧合而非设计。
2. **排序缺陷**：HH:MM localeCompare 跨天错序、同分钟无序（§5）。
3. **双实现漂移**：消息合并、频道头、发送逻辑在 ChatPage/BottomFlow 各一份；ChatPage 缺 12 类型差异渲染、@ 选人、风险弹窗；BottomFlow 发言写死「昆仑（您）」不随 ROLE_ACTORS。
4. **exec confirm 收紧仅是文案**：不校验内容，发出的也不是 confirm 类型。
5. **成员推导与访问矩阵是两套体系**：推导说「专家关单即退」「审计员在 ch-risk」，矩阵却让 expert 常驻 ch-q3、auditor 看不到 ch-twin-sales；互不校验（grill 待实现清单 #1「矩阵降级为覆盖层」尚未完成收敛）。
6. 发消息不写审计；unread/members 静态；拉人入群/附件无功能；分身 1v1 通道仅销售 VP 一条（其余 4 位高管无 `ch-twin-{execId}`）；collabFeed 不持久化，刷新丢失用户发言与决策回投消息。
