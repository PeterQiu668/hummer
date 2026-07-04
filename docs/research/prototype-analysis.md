# Hummer 原型分析汇总（三个探索 agent 的核心发现）

Hummer = 企业级 Agent Workforce（数字员工集群）编排系统的纯前端原型。三层架构叙事：L1 Data OS / L2 Agent OS / L3 Agent Workforce。技术栈 Vite + React 18 + TS + Tailwind 3 + Zustand + R3F。全部数据 mock（src/data/*.ts + setInterval 假实时引擎 + localStorage）。

## A. 领域实体（18 个，来自 src/lib/types.ts + src/data/*.ts）

1. **Employee（数字员工）**：状态机 idle→working→(blocked|meeting|training)；内嵌 skills/permissions/auditEntries（非规范化）；tokensToday/costToday 成本字段
2. **ExecutiveTwin（高管分身）**：managesEmployeeIds 管辖关系；责任链 = 真人老板→老板数字分身→高管分身→真人高管→数字员工（产品核心叙事）
3. **A2AHandoff（A2A 委派）**：单向 fire-and-forget 事件，无接受/拒绝/完成回执状态机，无权限校验
4. **CollabTask（任务）**：pending→in_progress→waiting_approval→blocked→completed；有 goal/scope/inputs/outputs/acceptance（验收标准）；关联产出物/证据/对话/会议/审批/审计全是 mock 硬编码函数
5. **RiskAlert（风险熔断审批）**：pending→approved/rejected/safer，**全原型唯一真实闭环的 human-in-the-loop**（approveAlert 同时写 collabFeed + auditLog）；四眼原则等风控规则是写死字符串
6. **AuditEntry（审计）**：两套定义并存；宣称 "Append-only SQLite WAL" 但实为内存数组；hash 是随机数非真实 SHA-256，无 hash chain
7. **Evidence（证据/交付物）**：draft→approved→shipped→archived；hash/owner/approver/sources/knowledgeRefs；与 TasksPage 的 taskDeliverables 是两套割裂的 mock；approverId 弱类型（有时 Agent id 有时人名字符串）→ 需统一 actorRef {type: agent|human|system, id}
8. **Skill（技能）**：两套定义（员工内嵌简化版 vs 技能库完整版含 inputSchema/outputSchema/permissionScope/signed/recentCalls）；有沙箱未签名 vs 已签名生产版本概念 → 应落地为 Tool/Capability Registry
9. **Permission**：内嵌布尔 approvalRequired，无版本化/授予人/时间窗 → 需独立 RBAC/ABAC
10. **Expert（真人专家）**+ **BusinessStage（11 经营环节）**+ **MarketEmployee（市场候选）**+ **TeamPackage（4 套餐）**：市场供给侧
11. **招聘生命周期三套不一致模型**：localStorage 布尔 / MyHire 三态 / LifecycleCandidate 五阶段（market→trial→scoring→authorizing→onboarded，最完整但未接 UI）→ 需收敛为一个状态机
12. **FeishuMessage（9+3 种消息类型）**：msg/translate/decompose/confirm/task/tool_call/approval/deliverable/evidence(+alert/evolution/mention)；senderRole: human/manager/worker/hermes/guardian；松散联合类型（可选字段塞载荷）→ 需强类型 discriminated union；ts 是 'HH:MM' 字符串无真实时间戳/序列号
13. **HermesBadCase（质量飞轮）**：detected→optimizing→sandbox→review→shipped 5 阶段；HermesTrace（推理/工具调用/观察/失败点四类日志行）**最接近真实 Agent observability schema，值得直接复用**
14. **SopVersion**：Agent SOP 版本/训练轮次管理（孤儿类型未接 UI）
15. **InboxItem（老板待办收件箱）**：approval/block/stuck/accept/anomaly 五类，已建模完全未实现（P0 缺失）
16. **KGNode/KGEdge（知识图谱）**：7 类节点手工 40 条边 → 真实产品需从业务系统自动抽取
17. **EliminatedAgent（末位淘汰）**：未接 UI
18. **MCP 连接**：toggleMCP 只是布尔开关，无 OAuth/凭证托管/动态 tools/list 发现

## B. 核心业务流程（7 条）

1. 责任链下发（Boss→Twin→ExecTwin→HumanExec→Agent），mock 每 20s 剧本回放
2. 意图转译→拆解→确认→执行→工具调用→产出→证据→审批（9 类消息全流程，feishu.ts b1-b9）
3. 任务分解→执行→交付物→证据链→审计→复盘 SOP 回写（系统级闭环意图，四环节数据未打通）
4. 风险熔断 + 人在环审批（唯一真实闭环，应作为权限网关设计范本）
5. 会议流（议题→参会→纪要→行动项→审计；行动项未真正转成 CollabTask）
6. 招聘/试岗/转正（三套模型需收敛）
7. Bad Case→SOP 进化→沙箱→人审→发布（质量飞轮，全静态）

## C. 落地必须由后端/Agent Runtime 提供的能力（mock 清单）

1. Agent 执行引擎本身（LLM Agent 跑任务/调工具/产出）— 建议 Claude Agent SDK 或同类
2. 实时事件总线（WS/SSE + 全局单调序列号，替代 setInterval + 'HH:MM'）
3. 审计账本密码学完整性（真实 SHA-256 内容哈希 + hash chain + append-only 存储 + 完整性校验）
4. 审批工作流引擎（多级审批/委托/超时升级/策略引擎驱动风控规则：金额阈值、四眼原则、涉敏词）
5. MCP 真实连接（OAuth/凭证托管 KMS/tools list 动态发现，Agent 不持密钥）
6. Skill 签名与沙箱评测（Sigstore 类签名验证 + 沙箱 A/B）
7. 知识图谱自动构建（从 CRM/合同/任务/执行记录抽取）
8. 质量飞轮自动化（失败归因→SOP 候选→回归测试→灰度）
9. 组织架构可配置化（目前 5 高管+1 老板硬编码）
10. 招聘试岗评测服务（试岗任务分配、自动打分、转正决策）
11. Token/成本计量与归因（按 Agent/任务/部门）
12. 多租户 + KMS 凭证托管 + 配额计费
13. 收件箱事件聚合服务（InboxItem P0）
14. 任务状态机业务规则（回退/依赖/前置检查）
15. A2A 委派双向状态机 + 基于管辖关系的权限校验
16. 会议服务（转写/纪要生成/行动项→任务联动）
17. 证据/产出物对象存储 + 内容寻址

## D. 前端资产评估结论

- **建议演进式改造，不重写**
- 可保留：Shell 骨架（AppShell 槽位逻辑）、设计 token（styles.css/tailwind.config）、types.ts 领域类型（作为前端契约起点）、3D 性能手法（Instances/useMemo）
- 必须替换：useAppStore 427 行单体（UI 状态与领域状态与 mock runtime 混合）→ 拆分为 Zustand UI slice + TanStack Query server state + WS 推送；29 个组件直接 import data/*.ts → 数据 hook 层；无路由（store activePage 手写 switch）→ react-router；5 处 localStorage 影子状态 + 轮询 → 统一数据源
- 直接删除：9 个死文件约 2520 行（占代码库 18%）
- 从零建：鉴权/RBAC、测试基建（当前 0 测试 0 ESLint）、CI
- 代码规模：64 文件约 13.7k 行；TS strict 开启
- 风险点：3D Workstations 无 LOD/剔除，员工规模大时需压测；SVG 头像层曾导致白屏

## E. 已知产品约束（HANDOFF.md）

- 视觉：Notion/Linear/腾讯云式克制企业风（warm white + ink + 低饱和蓝青），禁止霓虹/赛博朋克
- 禁止对标产品名（OpenClaw/Hermes/HiClaw/练虾）出现在导航或主文案
- 左导航 11 项：指挥中心/对话流/工作任务/交付物/我的员工/员工市场/技能与工具/MCP 连接/知识中枢/审计与治理/质量与复盘
