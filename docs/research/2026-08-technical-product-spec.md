# Hummer 2026-08 技术选择与产品开发说明书

> 日期：2026-08-23  
> 目标：回答 Hummer 能否借鉴 OpenClaw、Hermes、Codex、WorkBuddy、EasyClaw、HiClaw/AgentTeams、DeepSeek Harness 等近期技术发展，组合成适应未来 AI 原生组织的管理系统。  
> 结论先行：可以组合，但不能把任何单一开源项目直接当作 Hummer 内核。Hummer 的核心 IP 应是“企业组织语义 + 权限责任链 + 任务验收 + 审计结算 + 进化评测”，开源框架只承担运行时、插件、编排、工具和自动化能力。

---

## 1. 产品技术总定位

Hummer 应采用三层架构：

```text
L3 Agent Workforce：组织与产品层
  老板驾驶舱 / 员工小天地 / 数字分身 / 数字员工市场 / 任务军令状 / 交付验收 / ROI / 进化

L2 Agent OS：编排与治理层
  Agent Registry / Identity / Permission / Policy / Runtime Adapter / Tool Gateway / Workflow / Evaluation / Trace

L1 Data OS：数据与证据层
  企业知识 / 文件与业务系统连接 / 凭证托管 / 审计账本 / 事件日志 / 成本计量 / 向量索引
```

当前 Hummer 原型已经很好地验证了 L3 的产品叙事和前端形态：员工市场、任务验收、交付出口、收件箱、审计、技能/MCP、专家门户、驾驶舱都有雏形。真正缺的是 L2/L1 的真实底座。

开发原则：

1. **Hummer 不做模型公司**：接入 OpenAI、DeepSeek、国产备案模型、本地模型，多模型路由。
2. **Hummer 不重写所有工具生态**：MCP + browser/RPA + existing SaaS connectors。
3. **Hummer 不做另一个 IM**：钉钉/企微/飞书是入口，Hummer 是编制和治理事实源。
4. **Hummer 不押单一 harness**：运行时可插拔，关键状态、权限、审计和任务事实源留在 Hummer。
5. **Hummer 不把聊天当事实源**：任务军令状、事件日志、成果包、验收记录才是事实源。

---

## 2. 开源与外部技术可移植性判断

### 2.1 DeepSeek Harness

状态：有公开仓库 `deepseek-ai/deepseek-harness`，MIT，官方定位为 developer preview，核心思想是 Everything is a plugin。官方说明插件覆盖 models、tools、skills、sessions、sandboxes、storage、loops、scheduling、UI，并强调 append-only session log、trajectory view、resume/fork/replay。

可借鉴：

- 插件化 runtime：模型、工具、skill、session、sandbox、storage、loop 都可替换；
- append-only session log：适合 Hummer 的审计和轨迹回放；
- trajectory view：适合任务验收、评测和 bad case 复盘；
- multiple runtime modes：适合定义不同自治等级和岗位执行模式。

不可直接押注：

- 仍处 developer preview，API 可能 breaking；
- 它是 agent harness，不是企业组织管理系统；
- 多租户、企业权限、合规、组织责任链仍需 Hummer 自研。

建议：

> 把 DeepSeek Harness 作为 Hummer Runtime Adapter 的重要参考，优先吸收“插件模型、事件日志、轨迹回放、sandbox 插件”设计。早期可做 PoC 接入，但不要让业务数据库和任务状态依赖其内部 schema。

### 2.2 OpenAI Codex / Codex CLI / Codex App

状态：`openai/codex` 是 Apache-2.0 的本地 coding agent。Codex 的优势是本地文件、代码、命令、补丁、测试、长任务与审查体验。Codex App / Computer Use 等部分能力属于产品/API 服务边界，不是可复制的开源 runtime。

可借鉴：

- AGENTS.md：把项目规则和岗位 SOP 变成可执行上下文；
- Skills：把可复用工作方法封装成版本化技能包；
- Subagents：把复杂任务拆给不同角色执行；
- 工作区隔离：每个任务有文件、日志、变更和验证；
- 进度播报和最终交付：非常适合 Hummer 的结果工作区；
- MCP server：Codex 可作为某些软件工程岗位数字员工的执行节点。

不可直接照搬：

- Codex 是代码工作核心，Hummer 面向全企业经营；
- Git diff、PR、测试等术语不能直接暴露给业务老板；
- Codex Desktop/Computer Use 不是可直接嵌入的开源桌面控制底座。

建议：

> 将 Codex 抽象为“高可信本地执行节点”和“技能工程参考”。Hummer 的软件开发室可以直接集成 Codex CLI/MCP；其他部门只吸收其任务隔离、证据、技能和复盘机制。

### 2.3 OpenAI Agents SDK

状态：`openai/openai-agents-python` 为 MIT，定位轻量多 agent workflow 框架，提供 agent、handoffs、guardrails、sessions、tracing、MCP 等能力。

可借鉴/采用：

- 快速实现 agent、handoff、guardrail；
- 适合作为 Python 服务内的执行编排；
- tracing 能力适合进入 Hummer 审计链；
- MCP 支持适合工具接入。

边界：

- 企业级长任务恢复、补偿、审批等待、并发调度仍需要 Temporal/LangGraph 等 durable 层；
- 多租户隔离、组织权限、成本归因不是 SDK 自带职责。

建议：

> 用于 Phase 1 快速跑通单岗位闭环；进入 Phase 2 后放入 Runtime Adapter，与 LangGraph/Temporal 共同承载。

### 2.4 OpenClaw

状态：`openclaw/openclaw` 定位个人 AI assistant，本地 Gateway、Control UI/CLI/TUI、消息渠道、工具、skills、plugins。许可证文件为 MIT，但 GitHub API 识别为非标准 `NOASSERTION`，商业使用前需再次确认 `THIRD_PARTY_NOTICES.md` 和依赖许可证。

可借鉴：

- 本地 Gateway；
- 多渠道消息入口；
- 本地工具和个人设备能力；
- skill/plugin 生态；
- “助手常驻运行”的产品心智。

不可直接照搬：

- 个人助手默认高权限，与企业最小权限冲突；
- 缺少多租户、审批、审计、组织责任链；
- 其“单操作者”心智不适合 Hummer 的组织级分身/员工层级。

建议：

> OpenClaw 可以成为 Hummer 的本地执行节点参考，尤其是桌面常驻、渠道接入和插件加载。但企业核心控制面必须在 Hummer 自己的 Agent OS 中实现。

### 2.5 EasyClaw

状态：`needsbuilder/easyclaw` 是 OpenClaw 一键安装器，Electron + React + TypeScript，MIT。

可借鉴：

- Windows/macOS 一键安装；
- 环境检测；
- Node/WSL/OpenClaw 自动配置；
- onboarding 引导。

不可直接照搬：

- 它是安装器，不是 runtime；
- 不解决组织、权限、审计、任务编排。

建议：

> 用于 Hummer Desktop Worker 的安装器参考。Hummer 若要支持“每个员工电脑上的本地执行节点”，必须有类似 EasyClaw 的低摩擦安装和健康检查体验。

### 2.6 HiClaw / AgentTeams

状态：公开路径 `higress-group/hiclaw` 已指向 `agentscope-ai/AgentTeams`。AgentTeams 是 Apache-2.0，定位 collaborative multi-agent runtime platform，基于 Matrix room 做透明、人类在环的任务协作，含 Manager-Workers 架构、MinIO、Higress AI Gateway、Kubernetes/Helm 等。

可借鉴：

- 用 room/channel 承载人机协作；
- Manager-Workers 多 agent 组织模式；
- human-in-the-loop；
- 可审计协作记录；
- 网关、对象存储、K8s 部署思路。

不可直接照搬：

- 技术组件较重；
- Matrix room 适合透明协作，但不一定适合 Hummer 的业务对象模型；
- Hummer 需要“任务军令状 + 组织责任链 + 成果包”的业务视图，而不是只看 room。

建议：

> AgentTeams 是最值得参考的企业协作型运行时，但建议吸收“房间式协作日志 + Manager-Workers + 人在环”模式，而不是原样嵌入整个系统。

### 2.7 Dify

状态：Dify 是生产级 agentic workflow/RAG 平台，许可证为修改版 Apache 2.0，多租户商业使用触发授权风险。

可借鉴：

- 工作流画布；
- RAG/知识库产品化；
- 模型供应商管理；
- 工具和插件市场；
- 企业部署形态。

风险：

- 多租户服务、白标、嵌入式售卖需核商业授权；
- Dify 更像 Agent 应用生产线，不是组织管理层。

建议：

> 不建议把 Dify 作为 Hummer 内核直接嵌入。可作为外部集成、客户已有 Dify 应用纳管对象，或参考其知识/工作流产品体验。

### 2.8 LangGraph / CrewAI / AutoGen

| 框架 | 用法建议 | 风险 |
|---|---|---|
| LangGraph | 核心编排候选。适合持久执行、human-in-the-loop、状态恢复、复杂图。 | 需要工程团队掌握底层状态模型；不是完整企业平台。 |
| CrewAI | 适合快速做岗位型 crew、demo 和轻量业务流。 | 深度治理、长期状态、复杂审批弱于 LangGraph/Temporal 组合。 |
| AutoGen | 可参考多 agent conversation 模型。 | 新项目不宜押主线，Microsoft 已转向 Agent Framework。 |

建议：

> Phase 1 可以 Agents SDK / CrewAI 快速试；Phase 2 核心编排应收敛到 LangGraph + Temporal 或自研状态机。

### 2.9 Temporal / n8n / Playwright / RPA

| 技术 | 用法 |
|---|---|
| Temporal | 长任务、重试、补偿、超时、人工等待、审批恢复。适合承载“任务军令状生命周期”。 |
| n8n | 参考节点生态和 SaaS connector。许可证限制较多，不建议白标嵌入商业产品。 |
| Playwright | 浏览器自动化首选，用于网页系统执行和回归验证。 |
| RPA Framework / 影刀 / 实在智能路线 | 参考桌面、Excel、Office、ERP、无 API 系统执行。 |

---

## 3. 推荐技术架构

### 3.1 总体架构

```text
前端体验层
  Web App：老板驾驶舱 / 员工小天地 / 公司全景 / 任务工作区 / 能力中心
  IM Bot：钉钉 / 飞书 / 企微消息入口
  Desktop Worker：本地文件 / 浏览器 / 桌面动作 / 安装器

业务服务层
  Org Service：组织、真人、数字分身、数字员工、部门、岗位
  Task Service：任务军令状、状态机、SLA、验收、交付出口
  Capability Service：技能、工具、MCP、知识包、运行时适配器
  Governance Service：身份、权限、策略、审批、预算、kill switch
  Evidence Service：成果包、证据、hash、来源、版本、回滚
  Evaluation Service：试岗、岗位评测、trajectory 评分、bad case 回归
  Billing/ROI Service：成本归因、预算、月报、结果计费

Agent OS 层
  Runtime Adapter：OpenAI Agents SDK / LangGraph / DeepSeek Harness / Codex / OpenClaw worker
  Tool Gateway：MCP Gateway / browser tools / RPA tools / SaaS API tools
  Workflow Engine：Temporal / durable state machine
  Policy Engine：OpenFGA / Casbin / OPA-style guardrails
  Observability：OpenTelemetry / traces / replay

Data OS 层
  PostgreSQL：业务事实源、多租户、RLS
  Redis：短期状态、队列、锁
  Object Storage：成果、附件、截图、证据
  Vector DB：pgvector / Milvus / Qdrant
  Audit Ledger：append-only event log + hash chain
  KMS/Vault：密钥、OAuth token、短期凭证
```

### 3.2 核心对象模型

#### HumanUser

真人员工。字段：

- `id`
- `tenant_id`
- `name`
- `role`
- `department_id`
- `manager_id`
- `identity_provider_ref`
- `approval_limits`
- `delegation_policy`

#### DigitalTwin

真人的数字分身。字段：

- `id`
- `owner_human_id`
- `scope`
- `autonomy_level`
- `allowed_actions`
- `silent_hours`
- `approval_policy`
- `memory_policy`
- `active_goals`
- `audit_profile`

#### DigitalEmployee

岗位数字员工。字段：

- `id`
- `job_title`
- `department_id`
- `human_owner_id`
- `manager_twin_id`
- `agent_package_id`
- `runtime_profile_id`
- `status`
- `certification_level`
- `skills`
- `tools`
- `mcp_servers`
- `knowledge_packs`
- `permissions`
- `budget`
- `kpi_profile`
- `risk_level`

#### AgentPackage

员工市场和龙虾工坊输出的标准包。字段：

- 岗位说明书；
- 结果承诺；
- 输入输出；
- 技能依赖；
- 工具/MCP 依赖；
- 知识包；
- 评测集；
- 权限要求；
- 价格；
- 专家保障；
- 版本；
- 许可证/来源。

#### WorkOrder

任务军令状。字段：

- `goal`
- `business_context`
- `acceptance_criteria`
- `owner`
- `assignees`
- `required_capabilities`
- `data_scope`
- `budget_limit`
- `deadline`
- `autonomy_level`
- `human_gates`
- `exit_actions`
- `rollback_plan`

#### ResultPackage

成果包。字段：

- 交付物；
- 验收逐项判定；
- 数据来源；
- 工具调用摘要；
- 版本差异；
- 风险和假设；
- 成本和耗时；
- 业务价值估算；
- 可回滚方式；
- 审计引用。

---

## 4. 产品功能说明书

### 4.1 老板综合驾驶舱

目标：30 秒看懂公司由人和 AI 共同推进的经营状态。

模块：

- 经营指标：收入、线索、交付、满意度、成本、风险；
- 人机组织状态：在线真人、数字分身、数字员工、部门负荷；
- 今日重点：最重要 3-5 件事；
- 待审批：高危动作、预算超限、交付出口、转正/淘汰；
- 风险雷达：任务超期、权限异常、成本异常、质量下降；
- ROI：本周节省人时、已验收成果、被采纳输出、失败成本；
- 公司全景入口：进入部门房间和员工小天地。

验收标准：

- 老板不需要打开多个聊天窗口；
- 所有待处理事项都能落到一个 Inbox；
- 任一指标可追溯到任务和成果包。

### 4.2 员工小天地

目标：每个真人能看到自己的数字分身和数字员工团队。

模块：

- 我的分身：当前目标、自动化等级、可代表我做什么、必须问我的事项；
- 我的数字员工：岗位、任务、状态、风险、成本、能力；
- 我的任务：待审批、待验收、被 @ 的协作；
- 我的知识与记忆：个人偏好、项目记忆、组织规则；
- 我的成果：最近交付、采纳率、反馈；
- 我的授权：我给了谁什么权限、何时过期。

验收标准：

- 员工能像管理同事一样管理 AI；
- 所有自动行动都有可见边界；
- 分身可被暂停、降权、接管。

### 4.3 人机组织全景

目标：把组织架构、部门房间、任务流和能力图统一为一个数字孪生。

视图：

- 组织视图：汇报关系、责任链、授权关系；
- 作战视图：房间、人员、任务流、阻塞、异常；
- 能力视图：员工、技能、MCP、知识、缺口；
- 成本视图：部门预算、员工成本、模型消耗、ROI。

验收标准：

- 同一个数字员工在组织、任务、能力、审计中引用同一 ID；
- 点击任意节点进入档案；
- 任务流不是动画，而来自事件日志。

### 4.4 数字员工市场

目标：让企业像招聘员工一样招聘数字员工。

模块：

- 按经营结果找人；
- 按岗位找人；
- 按部门包招聘；
- 从龙虾工坊定制；
- 员工详情：结果承诺、技能、MCP、知识、权限、评测、价格、风险；
- 试岗任务；
- 7 天试岗报告；
- 转正 / 延长 / 退回；
- 授权仪式；
- 上岗证书。

验收标准：

- 每个员工都有 AgentPackage；
- 招聘后进入组织全景、员工档案、任务系统、审计系统；
- 招聘不是 toast，而是状态迁移。

### 4.5 工作中枢

目标：让 AI 任务从聊天变成可验收工作。

模块：

- 任务军令状；
- 三栏结果工作区：计划 / 执行事件 / 成果包；
- 人在环关口：批准、驳回、改派、接管；
- 多 agent 协作；
- 交付出口：发送、回写、发布、归档；
- 失败处理：打回、转人工、降级、暂停；
- 会议行动项转任务；
- IM 同步卡片。

验收标准：

- 每个任务有唯一事实源；
- 每次高危动作先过策略网关；
- 验收失败进入 bad case。

### 4.6 能力中心

目标：统一管理技能、工具、MCP、知识、模型和运行时。

模块：

- Skill Registry；
- Tool Registry；
- MCP Gateway；
- Knowledge Pack；
- Runtime Profile；
- 权限 diff；
- 版本管理；
- 沙箱评测；
- 灰度发布；
- 调用统计和成本。

验收标准：

- 从任务能看到缺什么能力；
- 从员工能看到装了什么能力；
- 从能力能看到被谁使用、是否合规、效果如何。

### 4.7 治理与审计

目标：让企业敢把执行权交给 AI。

模块：

- Agent Registry；
- Identity / owner / sponsor；
- RBAC/ABAC/ReBAC；
- 凭证托管；
- 策略引擎；
- 审批工作流；
- kill switch；
- append-only 审计；
- trace 回放；
- 合规导出。

验收标准：

- 每个 agent 有身份、有 owner、有生命周期；
- 每个写动作有授权、证据和回滚方式；
- 审计记录不可随意修改。

### 4.8 智慧进化中心

目标：让失败变成组织能力。

模块：

- bad case 收集；
- trajectory 回放；
- 根因分类；
- SOP/技能/知识修订候选；
- 沙箱评测；
- 人审发布；
- 灰度；
- 回滚；
- 效果复测。

验收标准：

- 每次进化可追溯到失败案例；
- 每次发布有评测分和审批；
- 进化结果能影响同岗位员工。

---

## 5. 开发路线图

### Phase 0：前端产品叙事升级，2-3 周

范围：

- 基于现有 React 原型，不重写；
- 调整主叙事为“AI 原生组织”；
- 增强老板驾驶舱、员工小天地、公司全景；
- 做完整 demo story；
- 保留 mock，但统一对象 ID 和状态流。

输出：

- 可演示产品；
- 两个客户场景：GTM 部门包 / 招聘部门包；
- 产品介绍页和演示脚本；
- 新信息架构。

### Phase 1：可信 MVP，6-8 周

范围：

- 后端基础：PostgreSQL + API + auth；
- 单一 WorkOrder 状态机；
- 一个 Runtime Adapter；
- 一个真实 MCP 或 Playwright 工具；
- 一个审批网关；
- 一个 ResultPackage；
- 一个真实 hash evidence；
- 一个简单 ROI 报告。

建议技术：

- Frontend：继续 React/Vite；
- Backend：NestJS/FastAPI 二选一；
- DB：PostgreSQL + pgvector；
- Runtime：OpenAI Agents SDK 或 LangGraph；
- Workflow：先自研状态机，复杂后接 Temporal；
- Tools：MCP + Playwright；
- Trace：OpenTelemetry + Langfuse/Phoenix 可选。

### Phase 2：AI 部门包，3-4 个月

范围：

- DigitalTwin；
- DigitalEmployee；
- AgentPackage；
- 部门工作台；
- 多 agent 协作；
- 能力中心；
- 试岗评测；
- 权限策略；
- IM bot 接入一个平台；
- 桌面 Worker Alpha；
- 账单和预算。

建议技术：

- 引入 Temporal；
- 引入 OpenFGA/Casbin；
- 引入 Vault/KMS；
- Runtime Adapter 支持多后端；
- 任务事件日志标准化；
- 评测集和 trajectory 评分服务。

### Phase 3：组织 OS，6-12 个月

范围：

- 多租户；
- 私有化部署；
- 完整审计链；
- MCP Gateway；
- 专家市场；
- 技能认证；
- 组织同步；
- 多 IM 接入；
- 多部门 ROI；
- 合规体系。

建议技术：

- Kubernetes / Helm；
- MinIO / S3；
- SIEM 导出；
- OIDC/SAML SSO；
- ABAC/ReBAC；
- 多模型路由；
- 评测 CI。

---

## 6. 组件选型建议

| 层级 | 推荐 | 备选 | 不建议 |
|---|---|---|---|
| 前端 | React + Vite + TS + Tailwind + Zustand/TanStack Query | Next.js | 现在重写全栈框架 |
| 3D/全景 | React Three Fiber + 现有资产 | 2D Canvas / SVG fallback | 纯装饰大屏 |
| 后端 | FastAPI 或 NestJS | Go for infra services | 纯 serverless 拼接核心状态机 |
| DB | PostgreSQL + RLS + pgvector | Supabase 自托管 | 只用向量库当事实源 |
| 编排 | LangGraph + Temporal | OpenAI Agents SDK 快速 MVP | 只靠 prompt 串流程 |
| Harness | Runtime Adapter 接 DeepSeek Harness/Codex/OpenClaw | 自研 lightweight worker | 单一 harness 绑死 |
| 工具协议 | MCP Gateway | REST connector | 每个工具单独硬编码 |
| 浏览器自动化 | Playwright | Browser Use | 无审计的个人浏览器插件 |
| 桌面自动化 | Desktop Worker + RPA Framework/系统 API | 商业 RPA 集成 | 直接把用户账号密钥给 Agent |
| 权限 | OpenFGA + Casbin | OPA | 只做前端按钮隐藏 |
| 审计 | Append-only event log + hash chain + OTel | Langfuse/Phoenix | 普通 application log |
| 凭证 | Vault/KMS + 短期 token | 云厂商 KMS | prompt/env 存密钥 |

---

## 7. MVP 数据流

### 7.1 从一句话到任务

```text
老板输入目标
-> Intent Parser 生成 WorkOrder 草案
-> 能力检查：员工 / 技能 / MCP / 数据 / 预算
-> 风险评估：是否需要人审
-> 老板确认军令状
-> Task Service 创建正式 WorkOrder
-> Event Log 写入 work_order.created
```

### 7.2 从任务到执行

```text
WorkOrder 分派给部门分身
-> 部门分身选择数字员工
-> Runtime Adapter 启动 agent session
-> Tool Gateway 发放短期工具 token
-> Agent 执行工具调用
-> 每步写入 trace/event
-> 高危动作触发 approval.required
-> 人审后继续或终止
```

### 7.3 从执行到成果

```text
Agent 产出 ResultPackage
-> Evidence Service 内容寻址
-> 验收人逐项判定
-> 通过：可执行出口动作
-> 驳回：生成 bad_case
-> ROI Service 归因成本与价值
-> Evolution Service 生成改进候选
```

---

## 8. 权限与自治等级

建议定义 L0-L4：

| 等级 | 含义 | 默认动作 |
|---|---|---|
| L0 | 只建议 | 只能生成建议，不调用外部写工具 |
| L1 | 只读执行 | 可读文件/系统，可生成草稿 |
| L2 | 审批执行 | 可准备写动作，必须人审 |
| L3 | 限额自主 | 在预算、白名单、低风险范围内自主执行 |
| L4 | 高信任自主 | 仅限内部成熟岗位，仍保留审计和 kill switch |

默认策略：

- 新员工从 L0/L1 开始；
- 试岗通过才能到 L2；
- 连续稳定和评测通过才能 L3；
- 金钱、合同、客户外发、删除、权限变更默认 require approval；
- 所有凭证短期化、任务作用域化。

---

## 9. 许可证与商业风险

| 项目 | 当前判断 | 商业使用建议 |
|---|---|---|
| PeterQiu668/hummer | 未发现 LICENSE | 自有项目可继续；对外商业需补 LICENSE/版权说明 |
| DeepSeek Harness | MIT，developer preview | 可 PoC 和参考，谨慎依赖稳定 API |
| OpenAI Codex CLI | Apache-2.0 | 可作为开发/软件岗位执行节点，保留 NOTICE |
| OpenAI Agents SDK | MIT | 可直接采用 |
| OpenClaw | LICENSE 为 MIT，但 GitHub API 标识非标准 | 商用前核 THIRD_PARTY_NOTICES 和依赖 |
| EasyClaw | MIT | 可参考安装器 |
| AgentTeams | Apache-2.0 | 可参考/局部采用 |
| Dify | 修改版 Apache 2.0 | 多租户/白标/嵌入需商业授权核验 |
| n8n | Sustainable Use / Enterprise | 不建议作为内嵌售卖底座 |
| LangGraph | MIT | 可采用 |
| CrewAI | MIT | 可采用 |
| Temporal | MIT | 可采用 |
| Playwright | Apache-2.0 | 可采用 |

---

## 10. 当前原型改造建议

### 10.1 保留

- React/Vite 前端；
- 老板驾驶舱和公司全景；
- 员工市场；
- 任务验收；
- 交付出口；
- 收件箱；
- 审计与治理；
- 技能/MCP；
- 专家门户；
- 进化中心；
- 视觉上的房间和员工小天地。

### 10.2 立即补齐

- 统一 `Employee / MarketEmployee / LifecycleCandidate`；
- 统一 `Task / Evidence / ExitAction / AuditEntry`；
- 引入真实 `actorRef`：human/twin/employee/system/expert；
- 把 store 拆成 UI state 和 domain state；
- 将 mock data 包一层 repository/hook，便于替换后端；
- 明确 WorkOrder 和 ResultPackage 类型；
- 增加 DigitalTwin 类型；
- 在 UI 上强调权限、验收、ROI，而不是只强调“AI 很忙”。

### 10.3 后端第一批表

```text
tenants
human_users
departments
digital_twins
digital_employees
agent_packages
skills
tools
mcp_servers
knowledge_packs
work_orders
work_order_events
approval_requests
result_packages
evidence_objects
audit_events
runtime_sessions
tool_calls
cost_entries
bad_cases
evaluations
```

---

## 11. 验收标准

### 产品验收

- 老板能从驾驶舱看到真实待办、成本和成果；
- 员工能看到自己的分身和数字员工；
- 一个数字员工能完成真实任务；
- 一个任务能从军令状到成果包闭环；
- 一次高危动作必须经过审批；
- 一次失败能进入 bad case；
- 一份 ROI 报告能自动生成。

### 技术验收

- 每个 agent session 有唯一 ID；
- 每个 tool call 有 trace；
- 每个写动作有 approval 或 policy decision；
- 每个成果包有 hash 和来源；
- 每个权限有作用域和有效期；
- 每个任务有状态机和事件日志；
- 断线/重启后任务可恢复；
- 成本能按任务、员工、部门归因。

---

## 12. 最终技术建议

Hummer 最优路线不是“移植某个开源项目”，而是做一个**企业 Agent 控制平面**，同时接入多个开源执行内核：

```text
Hummer 自研：
  组织语义 / 数字分身 / 数字员工生命周期 / 权限责任链 / 任务军令状 / 验收 / 审计 / ROI / 进化

开源组合：
  DeepSeek Harness 思路：插件化和轨迹回放
  OpenAI Agents SDK：轻量 agent/handoff/guardrail/tracing
  LangGraph：持久 agent graph
  Temporal：长任务可靠执行
  MCP：工具协议和连接器
  Codex：软件岗位和本地执行节点
  OpenClaw：个人设备常驻 gateway 参考
  AgentTeams：协作 room 和 manager-workers 参考
  Playwright/RPA：网页和桌面执行
  OpenFGA/Casbin/OTel：权限、策略、审计
```

如果只做一个 Demo，先证明“老板分身指挥一个部门完成一件真实工作”。如果做产品，先把“数字员工编制管理 + 任务验收 + 权限审计 + ROI”做成铁三角。只要这三角稳，外部 harness 和模型都可以换；如果这三角不稳，换再强的模型也只是更快地产生不可控输出。

---

## 13. 主要来源

- [DeepSeek Harness 官方页](https://deepseek.com/harness/en/)
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- [openai/codex](https://github.com/openai/codex)
- [openai/openai-agents-python](https://github.com/openai/openai-agents-python)
- [OpenAI Agents SDK 文档](https://openai.github.io/openai-agents-python/)
- [OpenAI Codex MCP Server](https://developers.openai.com/codex/mcp-server)
- [OpenAI Codex AGENTS.md](https://developers.openai.com/codex/agent-configuration/agents-md)
- [OpenAI Codex Skills](https://developers.openai.com/codex/build-skills)
- [OpenAI Computer Use](https://developers.openai.com/api/docs/guides/tools-computer-use)
- [openclaw/openclaw](https://github.com/openclaw/openclaw)
- [needsbuilder/easyclaw](https://github.com/needsbuilder/easyclaw)
- [agentscope-ai/AgentTeams](https://github.com/agentscope-ai/AgentTeams)
- [Dify](https://dify.ai/)
- [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)
- [LangGraph 文档](https://docs.langchain.com/oss/python/langgraph/overview)
- [CrewAI](https://github.com/crewAIInc/crewAI)
- [Temporal](https://github.com/temporalio/temporal)
- [Playwright](https://github.com/microsoft/playwright)
- [OpenFGA](https://openfga.dev/)
- [OpenTelemetry](https://opentelemetry.io/)
- [Microsoft Entra Agent ID](https://www.microsoft.com/en-us/security/business/identity-access/microsoft-entra-agent-id)
- [Microsoft Agent 365](https://www.microsoft.com/en-us/microsoft-agent-365)
- [ServiceNow AI Control Tower](https://www.servicenow.com/products/ai-control-tower.html)
- [飞书 aily 自定义智能体](https://www.feishu.cn/content/article/7631864469689240764)
- [钉钉数字员工应用能力介绍](https://dingtalk.apifox.cn/doc-3520251)
- [百度智能云数字员工](https://www2.xinhuanet.com/tech/20250806/03b6fbbed63e495a80080d7d4c69f35f/c.html)
- [火山引擎 HiAgent](https://www.volcengine.com/product/hiagent)
