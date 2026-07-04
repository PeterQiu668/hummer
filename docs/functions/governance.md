# 审计与治理舱（governance）
> 源码：`src/components/hiclaw/GovernanceCabin.tsx` · 挂载于 `src/components/shell/AppShell.tsx`（showGovernance modal）· 入口：`LeftNav.tsx` / `RightConsole.tsx` / `CommandPalette.tsx` · 状态：**纯展示**（唯一交互是打开/关闭 modal，全部数据为组件内静态常量）

## 1. 定位与对应闭环

治理舱是给老板/审计员的「平台治理一屏总览」：多租户与部门配额、模型路由（AI Gateway）、风险热力、Skill/MCP 仓库签名状态、审计账本快照，五块拼成「凭证统一托管 + 模型统一路由 + 工具统一网关 + 风险统一监控 + 账本统一留痕」的治理叙事。文件头注释表明其前身为「HiClaw 治理舱」，按 brief 要求已在文案与视觉上剔除 HiClaw 字样（改名「审计与治理」），但命令面板中仍残留旧名（见 §7）。

它不承载任何操作闭环——没有一个按钮会写 store；它是审计链（可下钻的账本）之上的「仪表盘化」镜像，用于演示治理能力的广度而非深度。

## 2. 入口与角色可见性

| 角色 | 入口 | 说明 |
|------|------|------|
| boss | ✅ LeftNav「经营与治理」分组 →「审计与治理」（`highlight: 'governance'`，点击 `setShowGovernance(true)`，**不切换 activePage**） | 主入口 |
| exec | ❌ 无导航项 | — |
| staff | ❌ | — |
| expert | ❌ | — |
| auditor | ✅ LeftNav「审计」分组第三项「审计与治理」 | 与 boss 看到完全相同内容 |

补充入口：
- **RightConsole**（办公室 3D 页右侧控制台，仅 office 页且未选中员工时渲染）内有按钮 `setShowGovernance(true)`；由于 RightConsole 对所有角色渲染，这实际上给了任何停留在指挥中心页的角色一个入口。
- **命令面板** `p-gov`，label 仍为「HiClaw 治理舱」，`modal: 'governance'`，无角色过滤。

modal 内容对所有角色**完全一致**，无按 `currentRole` 的分支渲染。

## 3. 界面结构

全屏 modal：半透明深色蒙层（`rgba(15,15,14,0.32)` + blur）+ 白色圆角容器（framer-motion 上滑淡入），12 列 grid 布局：

1. **Header**：盾牌图标 + 标题「审计与治理」+ 副标题「多租户 / 凭证统一托管 / 模型路由 / 工具网关 / 风险热力 / 审计账本」+ 绿色「全部正常」chip + 关闭 ×。
2. **租户 · 部门 · 角色**（span 4）：KV 三连（租户「蓝血军团」/ 部门 6 / 员工 `employees.length`——**全组件唯一的动态取值**）+ 6 个部门行（`departments` 静态数组：决策中心 / 业务办公区 / 行政支持中心 / 会议室 / 休息区 / 学习训练区，各带 headcount、绑定模型、日成本 ¥19–¥210）。
3. **模型路由 · AI Gateway**（span 4）：5 条模型通道（`aiGateway`：Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5 / 本地推理 Sandbox / DeepSeek-V3 备用），每条含状态圆点（DeepSeek 为 amber，其余 green）、延迟、TPM 用量进度条（宽度 = `parseFloat(tpm)/parseFloat(上限)` 现算）。底注「凭证统一托管 · Agent 不持密钥」。
4. **风险热力图**（span 4）：5×6 = 30 格 `riskHeat` 静态矩阵（1 格 high、3 格 medium、余 low），色块用 `RISK_COLOR`（绿 #1E8F5C / 黄 #B07706 / 红 #C13D3D）+ 图例；下方红色左边框告警卡「1 起高危 · 财务 138w 调拨 · 已阻断 · 等待昆仑审批」。
5. **Skill / MCP 仓库 · 签名与版本**（span 6）：`skillHub` 4 条（BD 邮件 v3.2 / 618 复盘 v4.1 / 合同审阅 v2.7 / 资金调拨 v3→v4），已签名显示绿色 BadgeCheck，未签名（资金调拨 sandbox）显示脉冲黄色警示；每条带作者（「陈若澜 共创」等）、版本、风险等级 chip（LOW/MEDIUM）。
6. **MCP Servers · 企业接入**（span 6）：`mcpHub` 9 个 server 三列小卡（crm.salesforce / erp.kingdee / feishu.docs / feishu.approval / wework.message / gitlab.repo / bi.warehouse / kg.enterprise / mail.exchange），mail.exchange 为 amber 其余 green。底注「对内：MCP 连接工具/数据/业务系统 · 对外：A2A 协议跨 Agent / 跨组织」。
7. **审计快照 · Append-only**（span 12）：左列 5 条静态审计行（14:35:12 雪·销售官 生成 BD 邮件草稿 → 鲲鹏制造 …），右列「账本完整性」KV（总记录 14,847 / 本周新增 2,310 / 签名验证 ✓100% / 篡改检测 0）+ 说明文案「SQLite WAL + 外键 + 触发器，所有 Agent 操作 / 审批 / 工具调用 / 文件 diff 入链不可篡改」。

## 4. 操作步骤与逻辑

本 modal 可交互点仅有「打开」与「关闭」，内部无任何可点击业务控件（无按钮、无输入、卡片均不可点）。

### 4.1 打开治理舱
- **前置条件**：boss / auditor 有导航入口；或任意角色处于 office 页经 RightConsole；或任意角色经 Cmd+K「HiClaw 治理舱」。
- **操作**：点击入口。
- **状态变化**：`setShowGovernance(true)`（store 布尔，transient，不持久化）。LeftNav 路径会先 `setLeftNav('governance')` 但**不改 activePage**——modal 关闭后回到原页面；因此 LeftNav 高亮逻辑（基于 activePage）不会标亮「审计与治理」项。
- **副作用**：无 pushAudit、无 toast。AppShell 中 `<AnimatePresence>{showGovernance && <GovernanceCabin />}</AnimatePresence>` 挂载，入场动画（蒙层淡入 + 容器 y:24→0，250ms）。

### 4.2 关闭治理舱
- **操作**：三种方式——① 点击蒙层任意处（外层 onClick，内层容器 `stopPropagation` 防误关）；② 点击 Header 右上 ×。（无 Esc 键监听。）
- **状态变化**：`setShowGovernance(false)` → AnimatePresence 播放退场动画后卸载。
- **副作用**：无；组件无内部 state，重开即重挂载，无记忆。

### 4.3 三条打开链路的代码路径

| 入口 | 代码路径 | 附带状态变化 |
|------|---------|-------------|
| LeftNav「审计与治理」 | `LeftNav.onClick(it)` → `setLeftNav('governance')` → `it.highlight === 'governance'` 分支 `return setShowGovernance(true)` | `leftNav` 被写为 'governance'（持久化字段）但 `activePage` 不变 |
| RightConsole 按钮 | `RightConsole.tsx:138` 直接 `setShowGovernance(true)` | 无 |
| 命令面板「HiClaw 治理舱」 | `CommandPalette.tsx:119` `r.modal === 'governance'` 分支 | 面板自身关闭 |

### 4.4 隐含逻辑
- AI Gateway 进度条宽度是唯一的运行时计算：`parseFloat('1.4M / 2M')` 解析出 1.4 与 2（依赖字符串格式，M/K 单位不换算——恰好每行分子分母单位一致所以视觉正确）。
- 「员工」KV 取 `employees.length`（静态数据 import），招聘新员工（Marketplace hire 只写审计不改 employees 数组）不会使该数字变化。
- 风险热力 30 格仅按矩阵值着色（背景 12% 透明度 + 同色边框），格子无 tooltip、无点击，行列无坐标语义。

## 5. 数据与状态

- **store**：仅 `showGovernance: boolean` + `setShowGovernance`（transient UI state，`partialize` 未持久化，刷新后 modal 关闭）。
- **外部数据**：仅 `employees`（取 length）。**不读** `auditLog`、`mcpApps`、`installedSkills`、`riskAlerts` 中任何一项。
- **组件内静态常量**（全部硬编码于 GovernanceCabin.tsx，逐项列出）：

### 5.1 `departments`（租户卡，6 条）

| 部门 | headcount | 绑定模型 | 日成本 |
|------|-----------|---------|--------|
| 决策中心 | 1 | Opus 4.7 | ¥124 |
| 业务办公区 | 5 | Mixed | ¥210 |
| 行政支持中心 | 3 | Haiku 4.5 | ¥78 |
| 会议室 | 1 | Opus 4.7 | ¥43 |
| 休息区 | 1 | Sonnet 4.6 | ¥19 |
| 学习训练区 | 1 | Sandbox | ¥30 |

（headcount 合计 12，与「员工」KV 显示的 `employees.length` 并非同一口径。）

### 5.2 `aiGateway`（模型路由卡，5 条）

| 通道 | TPM 用量/上限 | 延迟 | 状态 |
|------|--------------|------|------|
| Claude Opus 4.7 | 1.4M / 2M | 820ms | green |
| Claude Sonnet 4.6 | 3.1M / 5M | 320ms | green |
| Claude Haiku 4.5 | 4.2M / 8M | 140ms | green |
| 本地推理 (Sandbox) | 380K / 1M | 90ms | green |
| DeepSeek-V3 (备用) | 120K / 1M | 410ms | amber |

### 5.3 `skillHub`（Skill 仓库卡，4 条）

| Skill | 作者 | 签名 | 版本 | hires | 风险 |
|-------|------|------|------|-------|------|
| BD 邮件 v3.2 | 陈若澜 共创 | ✅ | v3.2 | 1284 | low |
| 618 复盘 v4.1 | 韩书白 共创 | ✅ | v4.1 | 1782 | low |
| 合同审阅 v2.7 | 周明衡 共创 | ✅ | v2.7 | 712 | medium |
| 资金调拨 v3 → v4 | 系统自动进化 | ❌（脉冲警示） | v4 (sandbox) | 0 | medium |

### 5.4 `mcpHub`（MCP Servers 卡，9 条）

| server | kind | 状态 |
|--------|------|------|
| crm.salesforce | CRM | green |
| erp.kingdee | ERP | green |
| feishu.docs | 飞书文档 | green |
| feishu.approval | 飞书审批 | green |
| wework.message | 企业微信 | green |
| gitlab.repo | GitLab | green |
| bi.warehouse | 数仓 | green |
| kg.enterprise | 知识图谱 | green |
| mail.exchange | 邮件外发 | amber |

### 5.5 审计快照内联数组（5 行）

| 时间 | who | 动作 → 目标 | 风险 |
|------|-----|------------|------|
| 14:35:12 | 雪·销售官 | 生成 BD 邮件草稿 → 鲲鹏制造 | low |
| 14:33:48 | 系统守护者 | 阻断 → 财务-138w 调拨 | high |
| 14:32:08 | 林·决策官 | A2A 下发 → 销售/运营/财务 | low |
| 14:30:22 | 昆仑（您） | 审批通过 → Q3 客户回访预算 | low |
| 14:28:51 | 系统自动进化 | SOP 改进 → 资金调拨 v3 → v4 | low |

### 5.6 其他

`riskHeat`（5×6 布尔矩阵，30 格中 1 high / 3 medium）· `RISK_COLOR`（low #1E8F5C / medium #B07706 / high #C13D3D）· 账本完整性 KV（总记录 14,847 / 本周新增 2,310 / 签名验证 ✓100% / 篡改检测 0）。

## 6. 模块联动

- **审计链（audit）**：「审计快照」卡与 `seedAudit` 前 5 条同一叙事但独立硬编码，且 actor 措辞不同（「系统守护者」vs seed 的「Exec-Guardian」、「系统自动进化」vs「Hermes」——即治理舱用中文化名，审计链用组件名）；账本 KV（14,847 条）与审计页实际条数（≤500）不一致。
- **技能库（skills）**：skillHub 4 条与 `skillItems` 中同名技能对应（含同一个未签名沙箱项「资金调拨 v3→v4」），但作者体系不同（治理舱「陈若澜/韩书白/周明衡 共创」vs skills.ts 签名人「陈鹏/吴琳/黄律」）。
- **MCP 连接（connect）**：mcpHub 的 server 命名（`crm.salesforce` 等）对应技能 permissionScope 与审计 tags 的工具命名空间，而非 MCPAppsPage 的应用 id；连接/断开操作不影响本卡。
- **风险审批**：热力图下的「财务 138w 调拨 · 已阻断 · 等待昆仑审批」与 `initialRiskAlerts` / seedAudit 的 `阻断高危调拨` 同一故事线，但审批完成后本卡文案不变。
- **RightConsole / CommandPalette / LeftNav**：三个打开入口（见 §2）。

## 7. Mock 边界与已知限制

1. **零写入、零下钻**：所有卡片不可点，看不到任何明细页；与审计链页无跳转关联。
2. **数据三套账**：治理舱 / 审计链 seed / skills.ts 各自维护相似但不一致的静态数据（作者名、actor 名、总条数），演示时切页对照会穿帮。
3. **实时性为假**：「全部正常」「实时守护中」等状态硬编码；TPM/延迟/成本无 tick 驱动；风险热力不随 riskAlerts 变化，高危告警处理后仍显示「等待昆仑审批」。
4. **命令面板残留旧名**「HiClaw 治理舱」，与 brief「剔除 HiClaw 字样」的要求不一致（仅 GovernanceCabin 自身完成了改名）。
5. **角色差异缺失**：auditor 与 boss 看到同一屏，没有审计员专属视图（对比 AuditPage 有 isAuditor 增强）。
6. 无 Esc 关闭、无焦点圈定（focus trap）等 modal 可访问性处理。
7. 部门成本、模型配额等数字与 ROI 页 / 员工数据无任何计算关系，纯装饰。
