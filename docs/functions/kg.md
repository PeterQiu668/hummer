# 知识中枢（kg）
> 源码：src/components/pages/KnowledgeHubPage.tsx · src/components/kg/KnowledgeGraph.tsx · src/data/kg.ts · 状态：部分闭环（四步流程可点击走通、图谱 modal 有真实力导向交互；但接入/整理/归档三步内容全为静态数据，无任何 store 写入）

## 1. 定位与对应闭环

知识中枢承载「企业长期记忆」叙事：**上传资料 → 系统清洗归档 → 形成企业长期记忆 → Agent 执行任务时调用**（页面副标题原文）。它是 Agent 能力可信度的支撑面——图谱步骤末尾明确点出「雪·销售官起草 BD 邮件前，会先查询客户实体 + 互动史 + 法务条款」。本模块分两层：

1. **KnowledgeHubPage**（页面，`activePage === 'kg'`）：四步骤引导式工作流，演示知识如何进入系统。
2. **KnowledgeGraph**（全屏 modal，`showKG === true`）：最终沉淀结果的可视化，自写力导向图（无 d3 依赖）。

## 2. 入口与角色可见性

- **LeftNav**：boss 角色「经营与治理」组（badge `9.6k`）、staff 角色「资源」组均有「知识中枢」入口 → `setActivePage('kg')`。exec / expert / auditor 导航无入口。
- **CommandPalette**（⌘K）：「企业知识中枢」条目跳 `page: 'kg'`。注意 palette 里**没有**直接打开图谱 modal 的条目（CmdResult 类型定义了 `modal: 'kg'` 但 PAGES 未使用）。
- **图谱 modal**：唯一 UI 入口是本页第 4 步的「打开企业知识图谱」按钮 → `setShowKG(true)`；由 AppShell 顶层 `<AnimatePresence>{showKG && <KnowledgeGraph />}</AnimatePresence>` 渲染，盖在一切页面之上（z-50）。

## 3. 界面结构

- 页面用 `WorkspacePage` 壳（标题 + sticky 插槽 + 滚动 body）。
- sticky 区为 4 个步骤按钮（编号 01–04，带图标与箭头）：知识接入 / 知识整理 / 知识归档 / 图谱可视化。当前步骤高亮（primary-50 底）。
- body 按 `step` 渲染四个子组件：IngestStep / ProcessStep / ArchiveStep / GraphStep。
- 图谱 modal：深色玻璃全屏层，顶部（标题 + 节点/边计数 + 搜索框 + 关闭）、类型筛选工具条、主画布（SVG 900×600 viewBox）、右侧 288px 节点详情面板。

## 4. 操作步骤与逻辑

### 4.1 步骤导航

- 前置：进入 kg 页，`step` 初始为 `'ingest'`（组件本地 `useState`，**不入 store、不持久化**，离开页面即重置）。
- 操作 A：点 sticky 区任一步骤按钮 → `setStep(s.id)`，可任意跳步，无顺序校验。
- 操作 B：点每步底部「进入下一步：xxx」按钮 → `setStep` 到下一步（ingest→process→archive→graph）。
- 状态变化：仅本地 `step`；无副作用（无 pushAudit / toast）。
- 分支：ProcessStep / ArchiveStep 各有一个「返回」按钮，**无 onClick，点击无效**（见 §7）。

### 4.2 Step 1 · 知识接入（IngestStep）

- 「上传企业资料」拖拽区 + 「选择文件」按钮：纯展示，**无 onClick / 无 input[type=file]**，配额文案（已上传 142 / 还可 858）写死。
- 「外部知识源」6 张卡（飞书 1428 文档同步中 / 企业微信 / Notion / Salesforce / 公司官网 warning「失败·重试中」/ Google Drive 未连接）：函数内静态数组，卡片不可点，与 MCP 连接页的 `mcpApps` store **无数据关联**（数字对得上是手工对齐：飞书 2 分钟前、Salesforce 24 分钟前与 defaultMCPApps 一致）。
- 唯一有效交互：「进入下一步」。

### 4.3 Step 2 · 知识整理（ProcessStep）

- 「抽取进度」4 条进度条（文档分块 100% / 实体抽取 86% / 关系构建 58% / 冲突检测 34%）：静态百分比，**不动画、不推进**。
- 「自动分类结果」8 张类别卡（销售话术 421 条、FAQ 314 条等，含「N 条待确认」warning 文案）：渲染为 `<button>` 且副标题写「点击类别查看待人工确认的条目」，但**无 onClick**——冲突确认流未实现。
- 有效交互：「进入下一步」。

### 4.4 Step 3 · 知识归档（ArchiveStep）

- 5 条知识条目卡（企业介绍 / 报价单 v3.2 / 鲲鹏主合同 v4 / 618 复盘 v4.1 / 客服 FAQ），每条含来源、部门、引用次数、可信度%：静态数组，不可点。条目与其他模块的实体（如证据库的 618 复盘、KG 图谱的鲲鹏合同）仅命名呼应。
- 有效交互：「进入下一步」。

### 4.5 Step 4 · 图谱入口（GraphStep）

- 中央大卡显示「9,632 条边 · 2,108 个实体」（写死的"全量"口径，与实际 mock 数据 26 节点/40 边不同，modal 底部用「9.6k nodes (full)」自圆其说）。
- 操作：点「打开企业知识图谱」→ `setShowKG(true)`（store）→ AppShell 挂出 modal。

### 4.6 图谱 modal（KnowledgeGraph）交互全集

数据：`kgNodes` 26 个节点 + `kgEdges` 40 条边。

| 节点类型 | 数量 | 代表节点 | props 示例 |
|---|---|---|---|
| 客户 | 5 | 鲲鹏制造、北辰金融 | ARR / 行业 / 等级 |
| 项目 | 4 | 鲲鹏数字化升级 | 阶段 / 金额 / PM |
| 合同 | 4 | 鲲鹏 SaaS-2026 | 类型 / 期 / 金额 |
| 员工 | 5 | 雪·销售官、林·决策官 | 模型 / 部门 |
| SOP | 3 | BD 邮件 v3.2、资金调拨 v4 | 版本 / 签名 / 招聘数 |
| 决策 | 2 | Q3 回访预算、138w 调拨阻断 | 状态 / 审批人 / 风险 |
| 部门 | 2 | 业务办公区、决策中心 | 人数 / 模型 |

边标签覆盖：发起 / 签订 / 签约方 / PM / 参与 / 法务 / 使用 / 审阅 / 发起人 / 关联 / 触发 / 隶属 / 对接 / 审批 / 阻断 / 触达，构成「客户-项目-合同-员工-SOP-决策-部门」七域互联的小型企业本体。

- **力导向模拟**（挂载时启动，手写实现、零依赖）：初始布局为按类型分层半径的圆环（`r = 140 + typeIdx*18`）；每帧叠加四种力后积分，`requestAnimationFrame` 驱动，最多 600 步后冻结；每步 `setTick` 触发 React 重渲染。节点位置存 `nodesRef`（ref，不进 React state）。参数：

| 参数 | 值 | 作用 |
|---|---|---|
| REPULSION | 6500 | 两两库仑斥力 |
| SPRING / SPRING_LEN | 0.012 / 120 | 边弹簧刚度与自然长 |
| CENTER | 0.002 | 向心力（防漂移出画布） |
| DAMP | 0.86 | 速度阻尼 |
| MAX_STEPS | 600 | 模拟步数上限（性能保护） |
| 边界 | clamp 30px | 节点不出 900×600 画布 |
- **拖拽节点**：pointerdown 设置 `fx/fy` 钉住 → pointermove 按 SVG CTM 逆变换更新 → pointerup 释放（`fx/fy = null`）。注意模拟 600 步后停止，此时拖拽仍改坐标（move 里手动 setTick）但松手后其他节点不再回弹。
- **hover 节点**：本地 `hover` → 无 selected 时在节点旁显示属性 tooltip（label/type/props）。
- **点击节点**：`setSelected(id)`（再点同一节点取消）；点空白画布 `setSelected(null)`。选中/悬停统一为 `focus = selected ?? hover`：
  - 相邻节点集 `neighborIds`（按全量 kgEdges 计算，含 focus 自身）；
  - 非邻居节点 opacity 淡化到 0.25、非关联边淡化到 0.12；
  - focus 节点半径 10→14 并加外发光圈；关联边加粗高亮并在中点显示边 label（如「签订」「阻断」）。
- **右侧详情面板**：
  - 未选中时显示操作说明（点击看属性 / 拖动重布局 / hover 出 tooltip）；
  - 选中后显示节点色点 + label + `type · id`、props 键值行、以及「邻居 (N)」列表——每行含邻居色点、名称、连接边的关系标签；
  - **点邻居行 `setSelected(id)` 跳转选中**，实现图上逐跳漫游；
  - 面板底部固定装饰文案「KG-CYPHER · sqlite + 图视图 / MCP: kg.enterprise · 9.6k nodes (full)」。
- **搜索框**：`query` 对 label / type 做 includes 过滤可见节点。
- **类型筛选**：7 个类型 chip toggle（`typeFilter` Set）；`visibleEdges` 只保留两端都可见的边；工具条右侧实时显示「x/26 节点 · y 边」。
- **关闭**：右上 X → `setShowKG(false)`。**无 ESC 监听、点遮罩不关闭**（modal 本体即全屏）。
- 副作用：整个 modal 生命周期**零 store 写入**（除 showKG 开关）、零 pushAudit/toast。

## 5. 数据与状态

| 数据/状态 | 位置 | 说明 |
|---|---|---|
| `step` | KnowledgeHubPage 本地 state | 四步导航，不持久化 |
| 接入源/进度/分类/归档条目 | 各 Step 函数内静态数组 | 纯展示 |
| `showKG` | zustand store（transient，不在 partialize） | modal 开关 |
| `kgNodes: KGNode[]` | data/kg.ts | `{ id, label, type: 7 类中文枚举, props: Record<string,string> }` |
| `kgEdges: KGEdge[]` | data/kg.ts | `{ id, source, target, label }`，无向渲染 |
| `kgTypeColors` | data/kg.ts | 类型→色值（克制版 v5 调色板，注释明言 not neon） |
| `nodesRef`（SimNode: x/y/vx/vy/fx/fy）、`tick`、`hover`、`selected`、`query`、`typeFilter` | KnowledgeGraph 本地 | 全部随 modal 卸载销毁，重开重新布点 |

节点 props 是自由键值（如客户带 ARR/行业/等级，SOP 带版本/签名/招聘数，决策带审批人/风险级），详情面板与 tooltip 直接遍历渲染，无 schema。

## 6. 模块联动

- **← LeftNav / CommandPalette**：页面入口（boss、staff 可见）。
- **→ AppShell**：`setShowKG` 是页面与 modal 的唯一桥；modal 也可被其他模块打开（当前仅本页第 4 步调用）。
- **叙事级联动（无代码打通）**：
  - KG 节点复用全局人物/客户设定（雪·销售官、鲲鹏制造、资金调拨 v4 SOP、「财务 138w 调拨已阻断」决策与审计 seed `au-2` 呼应）。
  - TopBar kg 页副标题、GraphStep 底部说明将图谱定位成 Agent 取数来源；实际无任何 Agent 执行路径读取 kgNodes。
  - 接入步骤的外部源与 MCP 连接页数据形似而不同源。
- KnowledgeGraph modal 视觉仍是 v4 暗色赛博风（glass/neon class），与页面本体的 Notion 风浅色系不一致——modal 是早期版本遗留。

## 7. Mock 边界与已知限制

- **前三步是纯布景**：上传按钮、外部源卡、8 张分类卡（虽是 button 且文案许诺可点）、归档条目均无 onClick；「返回」按钮无 handler，点了没反应。
- 抽取进度静态；「冲突检测 34%」「N 条待确认」没有后续确认流。
- 步骤状态不持久化，无「完成度」概念，四步可乱序点。
- 图谱数据 26/40 与宣称的 2,108/9,632 相差两个数量级（演示口径），搜索/筛选只作用于 mock 小图。
- 力导向 600 步后冻结（性能保护），长时间拖拽体验会退化为静态摆放。
- 图谱无缩放/平移（viewBox 固定），节点多了会挤；边按全量 kgEdges 算邻居，被类型筛选隐藏的邻居仍计入「邻居 (N)」计数但列表项渲染（可点后 selected 指向被过滤节点，详情可看但画布上看不到该点）。
- 整个模块零审计、零 toast、零持久化——是五官俱全但不落库的展示舱。
