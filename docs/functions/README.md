# 功能板块现状审查（docs/functions）

> 2026-07-05 由 6 个审查 agent 通读源码产出，共 19 个模块，每模块一份文档。
> 统一模板：定位与闭环 / 入口与角色可见性 / 界面结构 / **操作步骤与逻辑链路**（动作→状态变化→审计副作用）/ 数据与状态 / 模块联动 / Mock 边界。
> 状态口径：**真闭环**=动作真实写 store+审计且跨模块生效；**部分闭环**=主链路可走但有断点；**纯展示**=无副作用的静态叙事。

## 模块索引与状态总览

| 模块 | 文档 | 状态 | 一句话评价 |
|---|---|---|---|
| 工作任务（验收工作台） | [tasks.md](./tasks.md) | 真闭环 | 状态机+验收三选一真实可走；验收判定不持久化、超期用写死时钟 |
| 交付物与出口 | [evidence.md](./evidence.md) | 部分闭环 | 出口审批链真实；证据列表硬编码、exitActions 不持久化刷新即丢 |
| 会议室 | [meeting.md](./meeting.md) | 真闭环（带缺陷） | 行动项转任务真实入库；实时纪要被 tick 依赖 bug 卡死基本打不出来 |
| 指挥中心 3D | [office.md](./office.md) | 交互橱窗 | 选人/聚焦/审批真实，场景是布景；目录内 11 个死文件约 3000 行 |
| 老板收件箱 | [inbox.md](./inbox.md) | 真闭环 | Phase 0 闭环最完整页；待办不持久化、三处计数口径不一致 |
| ROI 与账单 | [roi.md](./roi.md) | 纯展示 | 预算硬顶/失败不计费是预算好的结论；缺"设预算/熔断处置"两端 |
| 对话流与频道 | [chat.md](./chat.md) | 真闭环 | 角色过滤/发言身份/成员面板/风险双投生效；ChatPage 与 BottomFlow 双实现漂移、HH:MM 排序跨天必错 |
| 高管工作台 | [execws.md](./execws.md) | 真闭环 | 默许机制落地最完整；页面级 seed 刷新重置且超时结算重复写审计 |
| 我的 AI 同事 | [myagents.md](./myagents.md) | 半闭环 | 派活→任务页→验收可追溯；催办无痕、任务永不推进 |
| 员工市场与生命周期 | [marketplace.md](./marketplace.md) | 真闭环 | 招聘→试岗双达标→转正→授权全链路+审计；入编不落组织架构、三套招聘状态仅收敛主线 |
| 我的员工与详情 | [employees.md](./employees.md) | 部分闭环 | 六 tab/头像/责任链可视化生效；启停只写审计不改状态、权限调整占位 |
| 进化中心 | [evolution.md](./evolution.md) | 纯展示 | 三层视图+因果链完整落地但零写操作；旧飞轮 modal 三入口并存 |
| 技能与工具 | [skills.md](./skills.md) | 真闭环 | 安装/启停持久化+审计+动画；与员工数据脱钩、actor 硬编码 |
| MCP 连接 | [connect.md](./connect.md) | 部分闭环 | 连接开关+审计真实；connected 状态无下游消费（断开后调用照常） |
| 审计链与责任链快照 | [audit.md](./audit.md) | 部分闭环 | 全库 19 类来源真实汇聚+审计员增强；hash 随机数、真人角色会被误标为平台组件 |
| 治理舱 | [governance.md](./governance.md) | 纯展示 | 五张静态卡；与审计/MCP/技能"三套账"互相穿帮 |
| 专家门户 | [expertportal.md](./expertportal.md) | 真闭环 | 两阶段接单（NDA/切片/撤销）与 SOP 上架流可完整走通；收入声誉纯展示 |
| 知识中枢 | [kg.md](./kg.md) | 部分闭环 | 四步骤是可点击布景；图谱 modal 交互完整但零 store 写入，且仍是 v4 暗色风 |
| 全局系统 | [global.md](./global.md) | 真闭环 | 角色切换五路联动、mock 引擎分频驱动；currentRole 不持久与 activePage 持久造成刷新错位 |

## 跨模块共性问题（审查提炼的修复清单，按影响排序）

1. **审计 actor 硬编码**：全库仅 `approveAlert`（ROLE_ACTORS）与 `useTaskTransition`（ROLE_NAMES）随角色，其余组件写死"昆仑（您）"——责任链快照会追责到错误的人。统一收敛到 ROLE_ACTORS。
2. **持久化口径分裂**：auditLog 持久化但 exitActions/inboxDone/riskAlerts 不持久 → 刷新后"审计有记录、状态已复活"账对不上；currentRole 不持久但 activePage 持久 → 刷新后身份/页面错位。
3. **MeetingRoom 纪要 bug**：effect 依赖每秒变化的 tick 导致 interval 反复重建，实时纪要基本不出字。
4. **ExecWorkspace 重复记账**：每次挂载重跑超时结算，向持久化审计链重复写默许/升级条目。
5. **双实现漂移**：ChatPage 与 BottomFlow 两套消息渲染（12 类型差异渲染只在 BottomFlow 侧）；ChannelList 未做角色过滤；HH:MM localeCompare 排序跨天必错。
6. **两套频道体系互不校验**：deriveChannelMembers（成员推导）与 ROLE_CHANNEL_ACCESS（访问矩阵）平行存在，无一致性保证。
7. **跨模块联动停在文案层**："升级老板收件箱""任务进入频道""通过后进交付出口""淘汰建议进收件箱"等均未真正接通。
8. **死代码与旧入口**：office/ 11 个死文件约 3000 行、marketplace 的 myHires、旧 EvolutionFlywheel modal 三入口并存、CommandPalette 残留"HiClaw 治理舱"旧名且不含 Phase 0 新页面。
9. **计数与数据穿帮**：LeftNav badge/页面统计/pendingApprovals 三处口径不一致；governance 与审计/MCP/技能三套账互相矛盾；github 应用挂 gitlab.* 工具名；badge 128 vs 实际 9 条技能。
10. **视觉断层**：KnowledgeGraph modal 与 BootScreen 仍是 v4 暗色赛博风，与 v6 浅色壳冲突（HANDOFF 明令禁止的风格）。
