# Hummer 产品需求文档 (PRD)

**版本**：v6 (原型)
**最后更新**：2026-07-04
**文档所有者**：产品团队
**状态**：Prototype / 内部演示

---

## 1. 产品概述

### 1.1 一句话定义

Hummer 是**企业级 Agent Workforce 编排系统**，让企业主可以像管理真实员工一样，招募、部署、协同和治理数字员工（AI Agent）集群，完成端到端的业务流程。

### 1.2 核心价值主张

| 对谁 | 提供什么 | 区别于什么 |
|---|---|---|
| **企业主 / CEO** | 一个"数字公司"控制台：看得见的组织架构、责任链、产出物 | 区别于"一堆 AI 工具"——Hummer 提供**员工**语义 |
| **业务负责人（高管）** | 用自己的分身指挥数字员工完成部门任务，可复盘、可审计 | 区别于人工手动 prompt——Hummer 提供**分工** |
| **执行者 / 员工** | 数字员工承担重复性和高杠杆工作，人聚焦在决策和创造 | 区别于 workflow 工具——Hummer 提供**责任** |

### 1.3 三层架构

```
L3  Agent Workforce   数字员工集群       —— 面向业务的可交付单元
       ↑
L2  Agent OS          智能体运行时       —— 记忆 / 工具 / 编排 / 治理
       ↑
L1  Data OS           数据基座与知识中枢  —— 结构化 / 非结构化 / 实时事件
```

首页用 3D 立体透视呈现这三层（`OfficeStage3D.tsx`），而不是文字堆叠，让"分层"从字面变成空间。

---

## 2. 目标用户与场景

### 2.1 用户角色

| 角色 | 在系统里做什么 |
|---|---|
| **老板 / CEO** | 通过"老板分身"下达战略指令；查看全公司经营看板；审批高风险动作 |
| **高管分身**（5 位）| 林·CEO 分身 / 吴·销售 VP / 邓·运营 VP / 宋·产品 / 万·CFO。承接老板指令并拆分给下属 Agent |
| **业务负责人** | 使用自己的高管分身指挥数字员工，参与会议室决策，审批交付物 |
| **数字员工（Agent）** | 承担具体职能：文案、外呼、数据分析、招募筛选、内容运营… |
| **专家保障团**（6 位固定）| 林知远/陈若澜/周明衡/许安琪/梁亦辰/韩书白——负责数字员工上岗培训、异常介入、质量保障 |
| **审计员 / 合规员** | 查看审计与治理日志，追溯任何 A2A 委派与产出证据链 |

### 2.2 责任链模型

```
老板  →  老板分身  →  高管分身  →  真实高管  →  Agent
```

任何一个决策/委派事件都会在这条链上留痕，可回溯、可复盘、可审计。

### 2.3 核心场景

1. **组建团队**：老板在员工市场浏览岗位包，选套餐（初创 7 人 / 增长 15 人 / 旗舰 25 人 / 定制 54 人），或用 5 步 wizard 定制岗位组合。
2. **上岗试用**：新招员工出现在 3D 首页"过渡区/休息区"，橙色"试岗中"名牌。
3. **下达任务**：老板/高管在对话流 @ 相应员工或群，触发任务卡；系统自动分解到具体 Agent。
4. **协同执行**：Agent 通过 A2A（Agent-to-Agent）委派协同，每 20 秒 mock 事件推送到审计和对话；6 大企业群频道分工。
5. **会议决策**：拉起会议室（议题→参会人→实时纪要→行动项→结束生成审计），会议产物自动进证据库。
6. **交付审批**：产出物进入"交付物"页，附证据链（hash / timestamp / owner / KG 关联），高管审批后闭环。
7. **复盘迭代**：质量与复盘板块回写 SOP，反哺员工技能与工具库。

---

## 3. 产品结构（左导航 11 项）

| # | 模块 | 用途 | 关键组件 |
|---|---|---|---|
| 1 | 指挥中心 | 3D 首页：立体呈现 L1/L2/L3，看得见全公司 | `OfficeStage3D.tsx` |
| 2 | 对话流 | 6 大企业群 + 直接消息，9 种消息类型 | `pages/ChatPage.tsx`, `collab/MessageStream.tsx` |
| 3 | 工作任务 | 任务卡 / 详情 / SOP / 关联对话·会议·审批·审计 | `pages/TasksPage.tsx` |
| 4 | 交付物 | 证据库：hash / timestamp / owner / 审批 / 来源 / KG | `pages/EvidencePage.tsx` |
| 5 | 我的员工 | 员工列表、Agent 详情 Drawer | `pages/EmployeesPage.tsx`, `drawer/EmployeeDrawer.tsx` |
| 6 | 员工市场 | 浏览 / 套餐 / 5 步定制 / 专家保障 / 我的招聘 | `marketplace/Marketplace.tsx` |
| 7 | 技能与工具 | Agent 可用的能力清单 | `pages/SkillsPage.tsx` |
| 8 | MCP 连接 | 外部工具接入（Slack / 飞书 / 抖音等） | `pages/MCPAppsPage.tsx` |
| 9 | 知识中枢 | 4 步骤知识管理（当前 mock 占位） | `pages/KnowledgeHubPage.tsx`, `kg/KnowledgeGraph.tsx` |
| 10 | 审计与治理 | 责任链、异常拦截、合规日志 | `hiclaw/GovernanceCabin.tsx` |
| 11 | 质量与复盘 | SOP 演化、经验回写 | `hermes/EvolutionFlywheel.tsx` |

---

## 4. 关键功能规格

### 4.1 3D 立体首页（指挥中心）

- **顶部 3D Canvas**（`@react-three/fiber`）：办公空间俯视/斜视，体素小人（VoxelHuman）代表员工。
- **中段 L2 Agent OS 透视斜面**：呈现运行时状态（编排、记忆、工具调用密度）。
- **底部 L1 Data OS 更深透视**：数据流、事件、知识索引。
- **交互**：点击体素小人 → 打开 Agent 详情 Drawer（替代右栏）。
- **状态映射**：在职员工在工位，"试岗中"在过渡区（橙色名牌）。

### 4.2 员工市场（"龙虾化"）

5 个 tab：
1. **浏览**：11 个经营环节分类，按需求筛选
2. **套餐**：初创 7 / 增长 15 / 旗舰 25 / 定制 54
3. **5 步定制 Wizard**：目标 → 岗位 → 技能包 → 交付节奏 → 预算
4. **专家保障**：6 位固定专家（`data/experts.ts`），可绑定到岗位
5. **我的招聘**：追踪招聘中 / 试岗中 / 已上岗，localStorage 持久化

### 4.3 对话流

- **9 种消息类型**：`msg / translate / decompose / confirm / task / tool_call / approval / deliverable / evidence`
- **6 大企业群**：老板总控 / 高管分身会议室 / 销售作战 / 市场内容 / 客户交付 / 风险审计
- **@ 提及**：MentionPicker 支持提及员工、高管分身、群
- **风险拦截**：RiskAlertModal 在敏感 tool_call 前弹窗审批

### 4.4 会议室

完整 flow：**议题设置 → 参会人拉取 → 实时纪要（Agent 自动记录）→ 行动项分派 → 结束生成审计记录**。会议产物自动进证据库并关联到相关任务。

### 4.5 任务详情

单一任务视图汇聚：产出物、证据链、关联对话/会议/审批/审计记录、复盘 SOP 回写。是所有责任链事件的"结账页"。

### 4.6 证据库（交付物）

8+ 条 mock 证据，每条含：
- `hash` — 内容指纹
- `timestamp` — 生成时间
- `owner` — 产出 Agent / 员工
- `approval` — 审批状态
- `source` — 来源任务 / 会议 / 对话
- `kg_refs` — 关联知识节点

### 4.7 Agent 详情 Drawer

**替换 RightConsole**（不悬浮居中，380px 宽），展示：档案、当前任务、技能包、审计记录、最近对话、可绑定的高管分身。

### 4.8 高管分身

5 位（`data/executives.ts`）：
- 林·CEO 分身
- 吴·销售 VP
- 邓·运营 VP
- 宋·产品
- 万·CFO

点击进入 `ExecutiveDetail` modal，可授权分身代为决策、参会、审批。

### 4.9 A2A 委派 + 实时引擎

- 每 5 秒 tick，推送消息 / 审计 / A2A 事件
- 每 20 秒推一个 A2A 委派事件到审计和对话
- 全局 Toast 系统提示重要事件
- Cmd+K 命令面板全局跳转

---

## 5. 视觉与交互原则

### 5.1 风格基调

**Notion / Linear / 腾讯云** 式克制企业风：
- 主色：warm white 底 + ink 字 + 低饱和蓝青点缀
- **禁止**：霓虹 / 赛博朋克 / 深色炫技配色
- **禁止**：把对标产品名（OpenClaw / Hermes / HiClaw / 练虾）作为导航或主文案

### 5.2 布局

- 左：LeftNav（11 项）
- 中：主内容区
- 右：RightConsole（默认责任链概览；打开 Agent 详情时替换为 Drawer）
- 底：BottomFlow（当前有 legacy class，待 tidy）
- 顶：TopBar

### 5.3 持久化

- Zustand persist middleware key：`hummer-v6`
- 用户头像：`hummer-avatar-{id}`
- 招聘状态：`hummer-marketplace-hires`

---

## 6. 数据模型概览

| 数据文件 | 内容 |
|---|---|
| `data/employees.ts` | 员工基础档案 |
| `data/workstations.ts` | 3D 工位坐标与状态 |
| `data/experts.ts` | 6 位专家保障团 |
| `data/executives.ts` | 5 位高管分身 |
| `data/marketplace.ts` | 岗位库、套餐、旧专家名（待清理） |
| `data/skills.ts` | 技能包 |
| `data/tasks.ts` | 任务与产出物 |
| `data/feishu.ts` | 飞书接入 mock |
| `data/hermes.ts` | 质量与复盘 mock |
| `data/kg.ts` | 知识图谱 mock |
| `data/douyin.ts` | 抖音接入 mock |

类型定义统一在 `src/lib/types.ts`。

---

## 7. 当前状态与路线图

### 7.1 已完成 (v6)

- ✅ 浅色设计系统 + 11 项左导航
- ✅ 3D 三层立体首页 + 体素小人
- ✅ 招聘合并到 3D 首页（试岗中橙色名牌）
- ✅ Agent Drawer 替换右栏
- ✅ 5 位高管分身 + ExecutiveDetail modal
- ✅ 6 大企业群 + 9 种消息类型
- ✅ 员工市场龙虾化（5 tab）
- ✅ 会议室完整 flow
- ✅ 证据库 + 任务详情证据链
- ✅ Cmd+K / Toast / localStorage 持久化
- ✅ Mock 实时引擎（5s tick + 20s A2A）

### 7.2 已知遗留

- ⚠️ `AgentAvatar` 是简化版（首字 + gradient）——原 CharSVG 手绘 chibi 因 SVG namespace 报错炸过，待重做（每个头像返回单一 `<svg>` 根，不用 fragment）
- ⚠️ `data/marketplace.ts` 里旧专家名（陈鹏/吴琳/周伟等 36 人）未真改，通过 `EXPERT_BY_CATEGORY` 映射到 6 位新固定专家
- ⚠️ `BottomFlow.tsx` 有 `glass-strong` 等 legacy class，待 tidy
- ⚠️ 知识中枢 4 步骤仍为 mock 占位，未接真实数据
- ⚠️ 同时打开任务详情 + Agent 详情会重叠（420px vs 380px）

### 7.3 下一步方向（建议）

| 优先级 | 事项 | 说明 |
|---|---|---|
| P0 | AgentAvatar 手绘 chibi 重做 | 单一 `<svg>` 根，参数化五官 |
| P0 | `data/marketplace.ts` 专家名清理 | 直接用 6 位专家真实字段，去掉映射 |
| P1 | 知识中枢接真数据 | 4 步骤（采集 → 结构化 → 图谱 → 应用）落地 |
| P1 | BottomFlow tidy | 移除 legacy class，统一 warm-white token |
| P2 | 多 Drawer 层叠管理 | 任务详情 + Agent 详情不重叠 |
| P2 | 真实后端接入 | 目前全 mock，需要接 Agent OS 运行时 |

---

## 8. 技术栈与关键约束

- **Vite + React 18 + TypeScript + Tailwind 3 + Zustand + @react-three/fiber + framer-motion + lucide-react**
- 端口 `3000`（`strictPort: true`），`host: true` 双绑（Windows IPv4/IPv6 兼容）
- **禁止**：PowerShell 处理含中文的源文件（乱码）；SVG 里返回 fragment（namespace 报错）
- Dev server 频繁在 turn 切换间被回收 → 失联即 `npm run dev` 重启

---

## 9. 文档索引

- **HANDOFF.md** — 项目交接说明（本 PRD 的技术侧对应文档）
- **CLAUDE.md**（如后续新增）— Agent 协作约定
- **docs/PRD.md** — 本文件

---

*Hummer 的野心不是"能对话的 AI 工具"，而是"能长期共事的数字同事"。每一个交互都要能追溯、可复盘、可交付——因为它承担的是**责任**，不是**响应**。*
