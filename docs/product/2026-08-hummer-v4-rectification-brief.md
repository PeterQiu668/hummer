# HUMMER V4 整改意见：给工作台装上「输入框」

> 日期：2026-08-26
> 对象：V4 可交互原型
> 关联：`2026-08-hummer-v3-rectification-brief.md`、`2026-08-hummer-v3-prototype-spec.md`
> 一句话：**V3 做对了「看」，完全没做「做」。V4 只干一件事——把工作台从观察面改成命令面。**

---

## 1. 诊断：为什么用户打开 V3 不会用

不是导航问题（V3 已经砍到 4 项，这一步做对了）。是**工作台没有入口**。

### 1.1 代码层面的证据

| 位置 | 现状 | 后果 |
|---|---|---|
| `WorkbenchPage.tsx:52` | `useState(() => createDemoSession())` | 会话在页面挂载时凭空出现，用户无法创建 |
| `features/sessions/model/session.ts:62` | 唯一的构造函数是 `createDemoSession()` | 模型层就没有「从一句话生成会话」的路径 |
| `WorkbenchPage.tsx:45-49` | `taskGroups` 是 6 个硬编码字符串 | 任务列表是装饰 |
| `WorkbenchPage.tsx:252` | 任务按钮没有 `onClick` | 点了没反应 |
| `WorkbenchPage.tsx:333` | 全页唯一的文本输入是 SOP `textarea` | 用户唯一能打字的地方是改 SOP |

用户打开后看到的是**别人的一个任务正在跑**，他能做的只有推进一个写死的剧本：
`requestProtectedWrite → decideProtectedWrite → forkSession → completeForkedSession`。

**他是观众，不是操作者。**

### 1.2 第二层问题：没有渐进披露

即使装上输入框，现在的工作台仍是 3 栏 × 7 区块同时全量渲染：任务栏 / 会话头 / 沙箱条 / 轨迹 / 桌面关键帧 / ResultPackage / 右栏 3 tab。

首屏就把预算、检查点、沙箱路径、自主等级、SOP 全部推到脸上——**在用户还没说要干什么之前，这些信息一个都不该出现。**

「复杂」的第二个来源不是内容多，是**该藏的时候没藏**。

---

## 2. 参照系：全球顶尖 AI 原生产品的共同骨架

Codex、Claude Code、Devin、Manus、OpenAI Operator、WorkBuddy、豆包企业版——形态差别很大，骨架完全一致，五拍：

```
①  Composer      一个输入框：「今天要做什么？」
②  Plan          一张可编辑的计划卡：我理解你要 A→B→C，用这些工具
③  Stream        一条边跑边出的执行流
④  Artifact      右侧实时产物：文件 / diff / 清单同步变化
⑤  Accept        一次验收：通过 / 打回
```

**没有任何一个产品要求用户先逛五个页面再回来派活。**

企业级产品（Microsoft Agent 365、ServiceNow AI Control Tower）加的东西也不是加页面，而是往这五拍里塞：②里加「谁批准的作用域」，③里加「策略关口」，⑤里加「责任人和回滚」。

### HUMMER 的差异化落点

不要换骨架。在骨架里塞三个企业专属环节，**并且藏在自然交互里，不许变成表单**：

- **②计划卡里多一行**：派给哪个数字员工（系统先推荐，用户可改）
- **③执行流里多一个关口**：高危动作停下来问你
- **⑤交付里多两个字段**：谁担责、怎么回滚

V3 已经把 ③④⑤ 做好了（`session.ts` 是纯函数 + 有测试，`TrajectoryRow` / `DesktopKeyframe` / `ResultPanel` 都可用）。**V4 缺的只有 ①②，而 ①② 恰恰是用户唯一的入口。**

---

## 3. V4 设计规格

### 3.1 首屏：空态就是一个输入框

打开工作台，**没有正在跑的会话**。整屏只有三块，垂直居中：

```
                    今天要交给团队做什么？

   ┌──────────────────────────────────────────────────────┐
   │  比如：把这周的线索整理成跟进清单，写回 CRM 前先给我看     │
   │                                                      │
   │  @派给谁 ▾   ⚙ L2 工作区自主 ▾   📎 给点资料           ⏎ │
   └──────────────────────────────────────────────────────┘

   试试这些：
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │ 整理本周线索 │ │ 做一份竞对   │ │ 把这批合同   │ │ 上周复盘     │
   │ 生成跟进清单 │ │ 对比报告     │ │ 提取关键条款 │ │ 出一页纸     │
   │ 雪·销售官   │ │ 岚·分析官    │ │ 苓·法务官    │ │ 璇·数据官    │
   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘

   最近： 华东目标账户研究 · 执行中     Q3 复盘素材 · 待你审  →
```

规则：

1. **三个内联控件不是三个页面。** `@派给谁` 是一个下拉（默认「自动推荐」），`⚙自主等级` 是 L1/L2/L3 下拉（默认 L2），`📎给点资料` 是文件选择。全部可以不碰就回车。
2. **示例卡一点即填入输入框**，让用户零成本试第一次。这是新用户能不能留下来的唯一关口。
3. **空态不显示**：预算、检查点、沙箱徽章、SOP、桌面帧、ResultPackage 一律不渲染。
4. 「最近」是一行折叠的会话入口，不是左侧 220px 的常驻任务栏。

### 3.2 回车后：一张计划卡（不是表单）

输入回车 → 输入框上方 1.5 秒内长出一张卡。**长得像一条确认消息，不像一个配置面板**：

```
┌────────────────────────────────────────────────────────┐
│  我理解你要做的是：                                       │
│                                                        │
│    1. 从 ~/GTM-2026Q3 读本周线索表                        │
│    2. 在受控浏览器核验公司信息和联系人                      │
│    3. 按客户分层规则 v2.3 排优先级                         │
│    4. 生成 CRM 写回差异 —— 写回前停下来问你                 │
│                                                        │
│  派给   雪·销售官 + 璇·数据官            [换人]           │
│  要用   受控浏览器 · 表格 · CRM(只读)     [+ 工具]         │
│  会碰   ~/GTM-2026Q3  (可读写)           [改范围]         │
│  停下来问你   写回 CRM 之前               [改关口]         │
│  预计   约 8 分钟 · ¥3 以内                              │
│                                                        │
│                        [ 改一下 ]    [ 开始干 ]  ⏎       │
└────────────────────────────────────────────────────────┘
```

关键点：

- **这张卡就是「军令状」（WorkOrder），但绝不叫这个名字，也绝不长成表单。** 企业语义藏在自然语言里。
- 五行元信息每行右侧一个轻量修改入口，点开是就地的小浮层，**不跳页**。
- 「改一下」= 回到输入框继续说，卡重新生成。这是最自然的修正方式。
- 默认全部填好，用户什么都不改直接回车就能跑——**零配置可用**是及格线。

### 3.3 点「开始干」：就地展开成 V3 已有的执行流

**不跳页、不换路由。** 计划卡收成一行摘要固定在顶部，下面长出 V3 已经做好的 trajectory。

V3 已有的组件全部保留复用：`TrajectoryRow`、审批条、暂停/恢复、fork、`DesktopKeyframe`、`ResultPanel`、右栏能力/SOP tab。

但改成**按阶段出现**：

| 阶段 | 屏幕上有什么 |
|---|---|
| 空态 | 输入框 + 示例卡 + 最近 |
| 已提交，计划中 | 输入框 + 计划卡 |
| 执行中 | 顶部计划摘要条 + 沙箱状态条 + trajectory（逐条长出）+ 底部输入框 |
| 有桌面动作时 | 上面 + 桌面关键帧（**只在这时出现**） |
| 等待审批 | 上面 + 审批条（含 diff 预览）+ 醒目高亮 |
| 已交付 | 上面 + ResultPackage + 通过/打回 |

右栏（协作/能力/SOP）**默认收起**，顶部一个图标展开。

### 3.4 执行中：输入框缩到底部，永远在

会话跑起来后，输入框不消失，**缩到页面底部常驻**：

```
┌────────────────────────────────────────────────────────┐
│ 等一下，先只做华东的                              ⏎     │
└────────────────────────────────────────────────────────┘
```

用户随时插一句话 → 作为一个 `human_to_ai` step 进入同一条 trajectory，AI 后续步骤读得到。

**这才是「人机协同」的实际形态**：不是一个「接管」按钮，是我随时能插嘴。

### 3.5 「我来接管」保留，但要有下文

V3 的 `onTakeover` 只是 `setTakeover(true)` 显示一条横幅。V4 要让接管有实际后果：

- 接管后，trajectory 里插入一条 `human_to_ai` 占位步骤，标注「真人操作中」
- 横幅上给一个「我做完了，你继续」按钮 → 让用户填一句「我把 3 家排除了，因为已经在谈」→ 这句话成为 step 内容 → AI 从这里继续

人和 AI 的步骤在同一条轨迹里**混排、同等公民**。这是 Codex 和 WorkBuddy 都没做透的地方，是 HUMMER 真正的差异化。

---

## 4. 模型层要补的东西

`features/sessions/model/session.ts` 目前只有 `createDemoSession()`。V4 需要补三个纯函数（继续保持纯函数 + 单测的风格）：

```ts
// 1. 从一句话生成计划草稿（关键词匹配即可，不需要真 LLM）
export function draftPlanFromPrompt(prompt: string, opts?: {
  assignee?: string; approvalMode?: ApprovalMode;
}): SessionPlan;

// 2. 计划确认后生成真正的会话（替代 createDemoSession 作为主路径）
export function createSessionFromPlan(plan: SessionPlan): ExecutionSession;

// 3. 执行中插入真人的一句话
export function injectHumanMessage(
  session: ExecutionSession, text: string
): ExecutionSession;
```

`SessionPlan` 的字段直接对应 3.2 那张卡：`understanding: string[]`、`assignees`、`tools`、`workspaceScope`、`humanGates`、`estimate`。

**`draftPlanFromPrompt` 用关键词表匹配到 4-6 个预置剧本就够了**（线索/竞对/合同/复盘/招聘…），匹配不上给一个通用兜底计划。V4 是原型，不需要真意图识别，但**必须让用户感觉到「我打的字被听懂了」**——所以计划卡里要把用户原话里的关键词回显出来。

同时保留 `createDemoSession()` 供「最近」里的历史会话使用，但它**不再是首屏路径**。

---

## 5. 明确的删改清单

| 动作 | 对象 |
|---|---|
| **新建** | `WorkbenchComposer.tsx`（输入框 + 内联控件 + 示例卡） |
| **新建** | `SessionPlanCard.tsx`（计划卡，五行元信息 + 就地修改） |
| **新建** | `session.ts` 补 `draftPlanFromPrompt` / `createSessionFromPlan` / `injectHumanMessage` + 对应单测 |
| **改** | `WorkbenchPage.tsx` 顶层状态改为 `session: ExecutionSession \| null`，`null` 时渲染空态 |
| **删** | `WorkbenchPage.tsx:45-49` 的 `taskGroups` 常量 |
| **改** | `TaskRail` 从左侧 220px 常驻栏 → 空态里的一行「最近」+ 执行态里顶部的会话切换器 |
| **改** | `DesktopKeyframe` / `ResultPanel` / 右栏 改为条件渲染，按 3.3 的阶段表 |
| **改** | `DesktopKeyframe` 的接管加上「我做完了，你继续」回路 |
| **不动** | `TrajectoryRow`、审批条、fork、`session.ts` 现有的状态迁移函数、`work-orders` model |

---

## 6. V4 验收清单

- [ ] 打开工作台，屏幕中央是一个空输入框和四张示例卡，**没有任何正在跑的会话**
- [ ] 什么都不配置，输入一句话回车 → 出现计划卡 → 点开始 → trajectory 逐条长出
- [ ] 点任一示例卡，文字填入输入框，回车即可跑通全程
- [ ] 计划卡里能看到自己输入的关键词被回显（「听懂了」）
- [ ] 计划卡五行元信息每行可就地修改，不跳页
- [ ] 空态屏幕上不出现：预算、检查点、沙箱路径、SOP、桌面帧、ResultPackage
- [ ] 执行中输入框在底部常驻，插一句话会进入 trajectory
- [ ] 「我来接管」后能「我做完了，你继续」，人的步骤和 AI 步骤在同一条轨迹里
- [ ] 「最近」里能切回上一个会话，V3 的审批/fork/复跑剧本仍能走通
- [ ] `npm run typecheck`、`npm run build`、`npm test` 全绿

---

## 7. 一句话原则

> **在用户告诉你他要做什么之前，屏幕上不该有任何东西；在他说完之后，屏幕上不该缺任何东西。**

---

## 8. 底座：不要写后端，要先切出 RuntimeAdapter 这道缝

### 8.1 问题的正确表述

「前端很轻 → 后端一定很重」这个推论是错的。正确的表述是：

> **前端薄在错误的地方是债，薄在正确的地方是资产。**

- 薄在错误的地方 = 纯 mock 的漂亮原型，将来接真 runtime 要推倒重写。
- 薄在正确的地方 = 前端从第一天就说**真实 runtime 的事件语言**，接底座只需写一个 adapter，UI 一行不用改。

所以 V4 的底座工作**不是写后端**，是**先把缝切出来，并且让缝的形状照着真实 runtime 长**。

### 8.2 一个被低估的事实：Codex CLI 就是 Desktop Worker

V3/V4 里已经做的这些东西——审批三档（L1/L2/L3）、沙箱三档、AGENTS.md 岗位说明书、trajectory、fork 重跑——**不是巧合，这就是 Codex CLI 的模型**（V3 整改意见就是照着它提的）。

Codex CLI 是 Apache-2.0，已经实现了本地文件读写、命令执行、沙箱隔离、审批中断、MCP 接入、skills，并提供可被程序驱动的 headless 模式。

> **HUMMER 的前端几乎可以 1:1 包在 Codex CLI 外面。**
> 不重复造轮子的最高形式不是「参考它的设计」，是「直接把轮子装上」。

### 8.3 底座选型：只有一行必须自研

| 层 | 用什么 | 许可证判断（见技术说明书 §9） |
|---|---|---|
| 本地执行 / 沙箱 / 审批中断 / 命令 / 文件 | **Codex CLI** | Apache-2.0，可商用，保留 NOTICE |
| 工具协议 / 连接器 | **MCP** | 事实标准 |
| session / resume / fork / replay / 插件化 | **DeepSeek Harness 的设计** | MIT，但仍是 developer preview——**只借设计，不绑它的 schema** |
| 桌面节点安装器 / 环境检测 / onboarding | **EasyClaw** | MIT，参考实现 |
| 浏览器执行 | **Playwright** | Apache-2.0 |
| 长任务 / 重试 / 补偿 / 审批等待 | Temporal（Phase 2 再上） | MIT |
| **租户 / 组织语义 / 责任链 / 审批策略 / 审计账本 / ResultPackage / ROI / 进化** | **只有这些必须自研** | **这是 HUMMER 唯一的 IP** |

前六行别人已经写好了。**人力有限就该把全部预算押在最后一行。**

OpenClaw 暂不作为依赖：其 LICENSE 被 GitHub API 标识为非标准 `NOASSERTION`，商用前需核 `THIRD_PARTY_NOTICES`（技术说明书 §2.4 已有此结论）。只借「常驻 + 多渠道触达」的产品心智。

### 8.4 V4 要交付的底座产物

**不是后端服务。** 是三样东西：

1. **`RuntimeAdapter` 接口定义**（`src/features/sessions/runtime/adapter.ts`）
   一个 runtime 只需实现：启动会话、流式吐事件、响应审批决定、暂停/停止、从检查点 fork。

2. **`MockRuntimeAdapter`**（把现有 `session.ts` 的剧本包进去）
   V4 的 UI 全部通过 adapter 拿数据，**不再直接 import `createDemoSession`**。

3. **`CodexRuntimeAdapter` 骨架**（feature flag 默认关闭）
   真的去调 Codex CLI 的 headless 模式，把它的事件流映射成 `TrajectoryStep`。哪怕只跑通「读一个文件」这一条，也证明了整条缝是通的。

### 8.5 事件形状的设计纪律

`RuntimeEvent` 的字段必须是**多个 runtime 的公约数**，不能只照着 mock 长：

- 每个事件有 `sessionId` + 单调递增 `sequence` + `occurredAt`（append-only，可回放）
- 工具调用事件必须携带 `tool` / `args` / `result` / `durationMs` / `costCny` / `evidenceRefs`
- 审批中断是一类**一等事件**（`approval_required`），不是错误
- 人的动作（接管、插话、批准）和 AI 的动作用**同一个事件类型体系**，只靠 `actorRef` 区分

> **禁止让任何产品域类型 import Codex / Harness / MCP 的具体类型**（`AGENTS.md` 第 4 条已规定）。映射只发生在 adapter 内部。

### 8.6 分期，别想一次做完

| 期 | 做什么 | 能验证什么 |
|---|---|---|
| **V4（现在）** | 前端五拍 + adapter 接口 + Mock 实现 + Codex adapter 骨架 | 产品形态成立；缝是通的 |
| V5 | `CodexRuntimeAdapter` 真跑通一条本地任务（读文件 → 出报告 → 审批 → 交付） | 「真的在我电脑上干活」 |
| V6 | Desktop Worker 安装器（参考 EasyClaw）+ 一个真实 MCP | 触达比龙虾方便 |
| V7 | 自研那一行：租户、责任链、审批策略、审计账本、ResultPackage 落库 | 这才是产品 |

**V4 不要碰数据库、不要起后端服务、不要引 Temporal。**
