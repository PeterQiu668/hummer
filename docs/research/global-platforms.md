# 海外数字员工平台调研（2026-07，精简存档，13 家）

## 厂商要点
- Salesforce Agentforce：按消耗（Action/Flex Credits ≈$0.10、$2/对话、$550/席）+ 预置角色；agent user 独立身份默认零权限；Testing Center 合成对话回放。短板：仅 31% 实施 6 个月后仍活跃，真实 TCO 高（Data Cloud 绑定）。
- ServiceNow：从任务型转向按角色卖 "AI Specialist"；三层 HITL（上线前审批→执行前计划审批→运行时阈值升级）；Machine Identity Console；MCP+A2A 双协议。短板：定价黑箱、自主 agent 锁最贵档。
- Microsoft：Agent 365 控制平面（agent 有邮箱/组织架构位置的完整用户身份）+ Entra Agent ID；1400+ 连接器业界最多；治理最完整。短板：计费复杂"账单休克"、采用率低。
- Google：A2A 发起者；Agent Gateway + Model Armor；短板：份额劣势、改名反复、计费碎片化（15+ 项）。
- OpenAI Frontier：agent = 有入职流程+绩效评估循环的 "AI coworker"；短板：工具链 8 个月弃用（Agent Builder 关停）、Consultingware 质疑。
- Sierra：outcome-based 定价首创（解决才收费）；supervisor 模型分层防御；合规矩阵最全。年费 $150K-1.5M。短板：高锁定、FDE 利润结构存疑。
- Decagon：AOP（自然语言 SOP 编译为可执行代码）；最完整 test-driven（批量模拟+定时回归+Watchtower 100% QA）；~$0.50/解决。短板：实施重 4-12 周。
- Lindy：Agent Swarms 同质并行；默认发送前人审；短板：credits 黑箱、复杂任务不可靠。
- Relevance AI：Workforce 可视化画布（handoff/路由/升级路径）；MCP 双向；创业公司中评测最全。
- Artisan：最纯粹按角色卖具名员工（Ava $250-600/月）；Copilot/Autopilot 渐进信任最清晰。短板："AI slop" 差评。
- 11x：按角色卖数字工人 $50-60k/年；supervisor+4 子 agent。丑闻：虚列客户、churn 70-80%、CEO 更替。
- Dust：横向平台 30 万 agent；工具级 stake 分级审批；MCP 双向。
- Glean：源系统 ACL 逐文档实时继承（最强权限模型）；AI Evaluator（LLM-judge 产品化）。
- Devin：按角色卖 AI 工程师；MultiDevin（1 manager+10 worker）；Interactive Planning（计划先审，成功率+83% 内部口径）；ACU 计费。短板：Answer.AI 实测成功率 ~15%、失败也烧 ACU。

## 行业共识能力（7 条）
1. MCP 事实标准（11/13 家支持，头部双向 + 企业管控）
2. Agent 独立身份 + 最小权限成治理标配（不借用人的账号）
3. HITL 前移到计划期/动作分级（按风险分级授权、渐进信任），而非只在对话末端转人工
4. supervisor/manager 多 agent 分层编排普遍产品化；但类"高管分身/责任链"的深层组织建模尚无人做全
5. 上线前模拟评测 + 运行时可观测成大厂标配
6. 定价向"席位+消耗"混合制收敛；outcome-based 在 CX 垂直成差异化武器
7. Agent 拟人化叙事全面升级（入职/考核/组织位置）；竞争焦点转向"agent 控制平面"（身份+注册表+治理+市场）

## 行业空白（差异化机会 5 条）
1. **成本可预测性**：全行业头号抱怨。"事前报价、失败不收费、预算硬顶"的确定性成本模型是空白。
2. **bad case→改进自动化闭环**：监控已普及，但失败→修正全靠人肉改 prompt。"自学习自修复（自动归因→自动回归用例→自动修正供人审批）"无人做成产品。
3. **跨厂商 agent 治理与责任链**：控制平面互相割裂；A2A 只解决通信不解决问责。"出错谁负责、如何追溯到人类 owner 与审批记录"的责任链/问责模型是空白。
4. **可靠性透明度**：没人敢公布真实成功率（Devin 实测 15%）。"任务级置信度预估 + 成功率 SLA + 按可靠性分级接单"是空白。
5. **中型市场供给断层**：巨头绑生态且贵（100/150 席起）、Sierra/Decagon 靠 FDE 驻场服务超大客户、SMB 工具治理不达标。"自助上线 + 企业级治理评测"的 mid-market 方案是结构性空白。

（来源 URL 见任务原始输出）
