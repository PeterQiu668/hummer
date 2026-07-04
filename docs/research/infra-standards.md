# Agent 基础设施与行业标准调研（2026-07，agent 原文精简存档）

## 1. 协议层
- MCP：已捐 Linux Foundation 旗下 Agentic AI Foundation（AAIF，Anthropic/Block/OpenAI 联合创始，170 家组织）。41% 软件组织已生产使用；Registry 9600+ server。2026 路线图：OAuth 2.1 企业授权、审计接 SIEM、MCP Gateway 模式。安全事故频发（30+ CVE、Asana 跨租户泄漏、tool poisoning）→ MCP 网关+安全扫描是企业部署前置条件。
- A2A：Google 发布后捐 AAIF，v1.2（签名 Agent Card）。150+ 组织，MS/AWS/Salesforce/SAP/ServiceNow 生产运行。共识分工：MCP 管工具集成、A2A 管跨 agent 协作。
- AGNTCY（Cisco 系，agent 目录/身份/SLIM 消息层）观察项；LOKA 学术阶段可忽略。
- 建议：工具接入押 MCP + 第一天规划 MCP Gateway（鉴权、白名单、审计、限流）；对外暴露数字员工能力用签名 Agent Card；跟踪 AAIF。

## 2. 编排/运行时
- LangGraph Platform：持久化最强（checkpoint/durable execution）、HITL 一等公民（interrupt/resume）、Cloud/Hybrid/自托管。
- Claude Agent SDK：hooks/subagents/Skills、原生 MCP、Session 可恢复（SessionStore：Redis/PG/S3）、PreToolUse hooks 做审批门。生命周期控制最细，与"数字员工"（长时运行、受控、可审计）心智最匹配。
- OpenAI AgentKit：托管，但 Agent Builder 上线约一年即宣布 2026-11 关停 → 平台层波动大，勿绑死厂商可视化编排，编排定义要代码化可导出。
- Microsoft Agent Framework 1.0 GA（2026-04）：AutoGen/SK 合并后继者，原生 OTel/Entra ID/A2A+MCP。AutoGen 进维护模式，勿新建。
- CrewAI：原型快，深度编排弱。
- 共性：六大框架全部支持 MCP。多租户是所有开源框架短板 → 租户隔离必须自己在平台层做。
- 建议：Claude 模型为主 → Claude Agent SDK 执行体；复杂可恢复编排 → LangGraph 式 durable execution；两者组合（编排层 + 执行体）是常见架构。

## 3. 治理与可观测
- OTel GenAI semantic conventions 是事实标准方向（LLM 调用/agent 编排/MCP 工具调用/内容捕获/质量评估六层），Datadog/New Relic/Honeycomb 原生支持。现在按 OTel 发 trace = 未来可换观测厂商。
- AgentOps 产品：LangSmith / Langfuse（自托管开源）/ Braintrust（CI 门禁）/ Arize Phoenix。observability+evals 一体化是主流。
- 治理三件套：NIST AI RMF（运营风险）+ ISO 42001（可认证管理体系）+ EU AI Act（2026-08-02 高风险全面适用）。均非为 agentic 设计，需自行扩展级联故障/权限蔓延/归责缺口。为每个数字员工维护风险登记（用途、权限、数据面、人类监督点）。
- 硬指标：每个 agent 行为可回放到具体 trace + 审批记录。

## 4. 评测
- Trajectory（轨迹级）评测成共识：只看最终输出会高估 20-40% 通过率；评工具调用序列、状态转移、审批门行为、预算遵守。
- 沙箱基准：τ-bench/τ²-bench（模拟用户+领域工具+政策遵守度，最贴近受监管行业）、Terminal-Bench、SWE-bench 等。
- 工程三件套：离线评测回归 + CI 评测门禁（低于阈值阻断发布）+ 在线评测抽检。
- "数字员工上岗认证"无统一标准但雏形清晰：岗位沙箱任务集 → 轨迹级评分（政策遵守/预算/危险动作零容忍）→ 达标发证绑定权限等级（只读→审批执行→有限自主）→ 版本变更重新认证。评测资产（数据集/rubric/判分器）是平台核心 IP。

## 5. 安全
- Agent 身份/NHI 爆发：88% 组织报告 agent 安全事件，仅 22% 把 agent 当独立身份。Okta for AI Agents GA（2026-04）；Auth0 for AI Agents：FGA + Token Vault（凭证托管，agent 不持长期凭证）+ 异步授权人审。
- 最佳实践收敛：短期任务作用域 token（OAuth 2.1 + token exchange）、凭证入 vault 不进 prompt/env、每租户/会话/任务最小权限。
- Prompt injection 三年居 OWASP LLM01 榜首无银弹 → 架构性防御：指令层级、CaMeL 式确定性护栏、工具输出视为数据、gVisor/Firecracker 沙箱、高危动作强制 HITL（公认单点最有效）、网关双向 guardrails。设计前提=注入不可根除，靠限权+审批+可回滚兜底。
- 核心建议：每个数字员工 = IdP 里的一等身份（有 owner、有生命周期、入职/转岗/离职即吊销）——这本身是"数字员工"叙事的最强企业卖点。

## 6. 分析师视角
- Gartner：40%+ agentic 项目 2027 年底前将被取消（成本失控/价值不清/风控不足，"agent washing"泛滥）；同时 2026 年底 40% 企业应用内嵌 agent（最陡采用曲线）；2026 趋势重点：Multiagent Systems、agentic 治理/安全、FinOps for agentic AI、领域专用模型。
- Forrester 2026：下一跳是跨系统"角色型 agent = 数字员工"；头部五大 HCM 平台将提供"数字员工管理"能力；仅 15% AI 决策者报告 EBITDA 提升。
- 逆向设计卖点（针对 40% 取消率三大死因）：成本可观测（Agent FinOps）、价值可度量（任务级 ROI 报表）、风控内建（治理/审计/HITL 开箱即用）。能证明这三点的平台就是幸存者。避开 agent washing 的方式是可验证性（公开评测分数/政策遵守率/审计能力）。

## 参考能力栈（六层）
1. 协议层：MCP + A2A v1.2 + MCP Gateway/Registry
2. 身份与凭证：Agent 一等身份（IdP）、NHI 生命周期、Token Vault、最小权限
3. 运行时与编排：Claude Agent SDK 执行体 / LangGraph 式 durable execution、持久化 PG/Redis/S3、SaaS/Hybrid/自托管
4. 安全防线：指令层级+确定性护栏、沙箱执行、网关 guardrails、高危 HITL+可回滚
5. 可观测与治理：OTel GenAI semconv、trace 回放+SIEM 审计、NIST/ISO42001/EU AI Act 映射、Agent FinOps
6. 评测与上岗认证：岗位沙箱任务集、trajectory 评分、CI 门禁+在线评测、认证绑定权限分级

一句话：协议押 MCP+A2A、遥测押 OTel、身份把 agent 当一等 NHI、评测做 trajectory+沙箱认证、治理对齐三件套；差异化在「上岗认证+权限分级+Agent FinOps」——把 40% 失败率死因变成产品能力。

（来源 URL 略，见任务原始输出）
