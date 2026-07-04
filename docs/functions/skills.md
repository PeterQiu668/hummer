# 技能与工具（skills）
> 源码：`src/components/pages/SkillsPage.tsx` · `src/data/skills.ts` · `src/store/useAppStore.ts`（installedSkills / toggleSkill / installSkill / slotIn）· `src/components/lobster/SkillSlotIn.tsx` · 状态：**有交互闭环**（安装/启停真实写 store 并持久化，其余按钮为纯展示）

## 1. 定位与对应闭环

技能库是「数字员工能力供给」侧的核心页面：企业老板浏览专家共创的 Skill / SOP 目录，安装到企业、启停控制，并通过「技能插盘动画」把安装动作可视化为员工上岗仪式。对应 PRD 中「专家把 Know-how 封装为签名 Skill → 企业采购 → Agent 装备使用 → 审计链留痕」的供给闭环。

闭环链路（原型内已跑通的部分）：
浏览/搜索 → 查看详情（权限范围 / IO Schema / 调用日志）→ 安装（写 `installedSkills` + 审计 + toast + 插盘动画）→ 启用/禁用（写 `enabled` + 审计 + toast）。**未跑通的部分**：安装后并不会真正改变任何 Agent 的技能列表（`employees.ts` 中的 `skills` 是静态数据），也没有「分配给特定 Agent」的后续界面。

## 2. 入口与角色可见性

| 角色 | 左侧导航 | 说明 |
|------|---------|------|
| boss | ✅「员工」分组 →「技能与工具」（badge 128） | 主入口 |
| exec | ✅「团队」分组 →「技能与工具」 | 与 boss 看到完全相同的页面，无差异化 |
| staff | ❌ | 无导航入口 |
| expert | ❌ | 专家通过「专家门户」的 SopStudio 生产技能，不走本页 |
| auditor | ❌ | 无导航入口 |

补充入口：
- 命令面板（Cmd+K）`p-skills`「技能库」，且技能条目本身可被搜索（命中后 `setActivePage('skills')`）。命令面板**不做角色过滤**，因此任何角色都可以经 Cmd+K 打开本页。
- 导航 badge「128」为写死文案，与实际 `skillItems.length = 9` 不符。

注意：页面内所有审计 actor 硬编码为 `'昆仑（您）'`，即使以 exec 角色进入并操作，审计链也记为老板操作（未接 `ROLE_ACTORS[currentRole]`，属已知不一致）。

## 3. 界面结构

`WorkspacePage` 布局（标题 + actions + sticky 工具条 + 滚动内容区）：

1. **标题区**：`技能库` · 副标题 `9 个可调用 Skill / SOP · 全部经专家共创 + Hermes 沙箱评测`；右侧 actions：「筛选」「上传技能」两个按钮（均无 onClick，纯展示）。
2. **sticky 工具条**：搜索框（按名称 / desc 匹配）+ 分类 Chip（`全部` + 8 个 `skillCategories`：销售增长/内容创作/数据分析/客户服务/知识管理/审批自动化/风控合规/研发工程）+ 右侧计数 chip。
3. **卡片网格**（1/2/3 列响应式）：每张卡包含
   - 名称 + 签名标识：`signed=true` 显示绿色 `BadgeCheck`（title 为签名人，如 `陈鹏 / sha256:8f3a…d471`）；`signed=false` 显示黄色 `AlertCircle`，title「沙箱中 · 未签名」。目录中唯一未签名项是 `sk-fund-transfer`「资金调拨 v3 → v4 (沙箱中)」，version `v4-sandbox`，呼应 Hermes 进化 → 沙箱评测 → 签名上架的版本概念。
   - 分类 · 版本（font-mono）；两行截断的 desc；三个 Metric（调用量 / 成功率 / 最近调用）；适用员工 chips（前 2 + `+N`）。
   - 底部操作条：「详情」+ 「安装」或「启用/禁用」（取决于 `installedSkills[s.id]`）。
4. **详情抽屉**（`SkillDetail`，页面内右侧 460px 绝对定位面板）：签名状态 chip、说明、三 Metric、`permissionScope`（如 `crm.salesforce:read` / `mail.exchange:send`）、输入/输出 Schema（字段名+类型+必填标记）、最近调用日志（ts/caller/result chip）。全部只读。
5. **插盘动画**（`SkillSlotIn`，全局挂载于 AppShell，z-60 全屏 overlay）：Matrix 数字雨 canvas 背景 + 中心卡片（旋转 Zap 图标、扫描线、技能名、来源、目标员工、2.6s 进度条、2.8s 后出现「上岗完成」），3.2 秒后自动 `clearSlotIn()`。

## 4. 操作步骤与逻辑

### 4.1 搜索 / 分类筛选
- **前置条件**：无。
- **操作**：在搜索框输入关键字；点击分类 Chip。
- **状态变化**：本地 state `q: string`、`cat: SkillCategory | '全部'`；`filtered` 为 `useMemo` 派生（`category` 匹配 && `name.includes(q) || desc.includes(q)`）。
- **副作用**：无（不写 store、不写审计）。

### 4.2 查看详情
- **前置条件**：无。
- **操作**：点击卡片「详情」。
- **状态变化**：本地 state `detail: SkillItem | null`；点抽屉右上 `×` 置回 null。
- **副作用**：无。

### 4.3 安装技能（核心动作）
- **前置条件**：`!installedSkills[s.id]`（未安装时卡片显示「安装」主按钮）。
- **操作**：点击「安装」。
- **状态变化**（store，一次点击三个 action + 两个副作用调用）：
  1. `installSkill(s.id)` → `installedSkills[s.id] = { id, enabled: true, installedAt: HH:MM:SS }`（安装即默认启用）；
  2. `triggerSlotIn({...})` → `slotIn = { id: 'slot-{ts}', startedAt, agentName, skillName, skillSource }`。
- **副作用**：
  - `pushAudit({ actor: '昆仑（您）', action: '安装技能', target: s.name, result: 'ok', tags: ['skill:install'] })` — 审计链新增一条（随机 hash，队首插入，截断 500）；
  - `pushToast({ kind: 'success', title: '{name} 已安装', detail: '可在「我的员工」中分配给特定 Agent' })`（提示的「分配」动作在原型中不存在）；
  - 全屏插盘动画：`agentName = s.applicable[0] ?? 'Agent'`（取第一个适用角色名，如「销售 Worker」，并非真实员工名），`skillSource = s.signer ?? '专家共创'`；3.2s 后 `clearSlotIn()` 自动收场。
- **分支**：无失败分支；安装不可撤销（没有「卸载」入口，只能禁用）。

### 4.4 启用 / 禁用技能
- **前置条件**：已安装（`installedSkills[s.id]` 存在）。按钮文案随 `enabled` 切换：启用态显示「⏸ 禁用」，禁用态显示「▶ 启用」（is-primary 样式）。
- **操作**：点击该按钮。
- **状态变化**：`toggleSkill(s.id)` → `installedSkills[s.id].enabled = !enabled`（不传第二参时取反；store 亦支持显式 `enabled` 入参，页面未用）。
- **副作用**：
  - `pushAudit({ actor: '昆仑（您）', action: enabled ? '禁用技能' : '启用技能', target: s.name, result: 'ok', tags: ['skill:toggle'] })`；
  - `pushToast({ kind: 'info', title: '{name} 已禁用/已启用' })`。
- **分支**：`toggleSkill` 对不存在的 id 直接返回原 state（防御性 no-op）。

### 4.5 纯展示按钮（无逻辑）
- 「筛选」「上传技能」（页头 actions）、详情抽屉内所有内容：无 onClick / 只读。

### 4.6 插盘动画（SkillSlotIn）时间线与触发方

`triggerSlotIn` 共 3 处调用：本页安装、`Marketplace.tsx:88` 招聘数字员工（以 `m.tags[0] ?? '岗位 SOP'` 作技能名、`m.expert` 作来源）、`LobsterLab.tsx:102` SkillView 的 `onSlot`。动画组件挂载在 AppShell 全局层，只消费 `slotIn` 字段：

| 时间点 | 表现 |
|--------|------|
| t=0 | overlay 淡入（0.3s）；MatrixRain canvas 启动（rAF 循环，片假名+hex 字符雨，DPR 适配） |
| t=0.2s | 中心卡片 spring 弹入；扫描线开始 1.4s 循环下扫；Zap 图标 2s/圈旋转 |
| t=0 → 2.6s | 进度条 0% → 100%（easeOut） |
| t=2.8s | 「✓ 上岗完成」淡入 |
| t=3.2s | `clearSlotIn()` 定时触发，AnimatePresence 播放退场并卸载（组件卸载时 cancelAnimationFrame 清理 canvas 循环） |

动画期间无任何交互（无跳过按钮）；若连续快速安装两个技能，后一次 `triggerSlotIn` 会覆盖 `slotIn`（id 变化导致重挂载重播）。

## 5. 数据与状态

- **静态目录**：`data/skills.ts` 导出 `skillItems`（9 项）与 `skillCategories`（8 类）。`SkillItem` 字段：`id/name/category/desc/version/signed/signer?/callCount/successRate/applicable[]/lastUsed?/permissionScope[]/inputSchema[]/outputSchema[]/recentCalls[]`。签名格式统一为 `人名 / sha256:xxxx…yyyy`。

### 9 项技能目录一览

| id | 名称 | 分类 | 版本 | 签名 | 调用量 | 成功率 | 适用员工 | 权限范围（permissionScope） |
|----|------|------|------|------|--------|--------|---------|---------------------------|
| sk-bd-email-v32 | BD 邮件 v3.2 | 销售增长 | v3.2 | 陈鹏 | 1,284 | 93% | 销售 Worker / 客户成功 | crm.salesforce:read · mail.exchange:send · kg.enterprise:read |
| sk-doc-summary | 会议纪要 v2.2 | 知识管理 | v2.2 | 言溪 | 928 | 97% | 文档 Worker / 会议主持 | feishu.docs:write · feishu.calendar:read |
| sk-contract-review | 合同审阅 v2.7 | 风控合规 | v2.7 | 黄律 | 712 | 89% | 法务 Worker | kg.enterprise:read · feishu.docs:write · pdf.parse:exec |
| sk-bi-report | 618 复盘报告 v4.1 | 数据分析 | v4.1 | 吴琳 | 1,782 | 95% | 运营 / 数据 Worker | bi.warehouse:query · feishu.docs:write |
| sk-mood-detect | 客服情绪识别 v3 | 客户服务 | v3.0 | 柳菲 | 95,200 | 91% | 客服 Worker | ticket:read · chat:read |
| sk-fund-transfer | 资金调拨 v3 → v4 (沙箱中) | 审批自动化 | v4-sandbox | **未签名** | 0 | 100% | 财务 Worker | erp.kingdee:write · feishu.approval:create |
| sk-private-sop | 私域 SOP v2 | 销售增长 | v2.0 | 李婷 | 942 | 86% | 销售 / 运营 Worker | wechat:read · wechat:write |
| sk-resume-screen | 简历筛选 v1.4 | 审批自动化 | v1.4 | 苏娜 | 412 | 88% | HR Worker | feishu.hr:read |
| sk-figma-poster | 海报设计 v2.0 | 内容创作 | v2.0 | 安琪 | 1,124 | 92% | 设计 Worker | figma:write |
| sk-api-gen | API 接口生成 v3.1 | 研发工程 | v3.1 | 冯铭 | 924 | 94% | 研发 Worker | gitlab.repo:write |

（sk-fund-transfer 即 Hermes 进化叙事的载体：desc「Hermes 自动进化版：> 50w 强制生成飞书审批单」，recentCalls 仅一条 sandbox 记录「A/B +14.8% 阻断率」，与审计 seed 的「SOP 自动进化 · 资金调拨 v3 → v4 (pending)」和治理舱 skillHub 的沙箱条目同一条故事线。）
- **store 字段与 action 语义**：

| 字段 / action | 类型与行为 |
|--------------|-----------|
| `installedSkills` | `Record<string, { id, enabled, installedAt }>`，初始 `{}`；键为 skill id |
| `installSkill(id)` | 覆盖写入 `{ id, enabled: true, installedAt: HH:MM:SS }`（重复安装会刷新 installedAt——UI 上不会发生，因已安装时按钮变为启停） |
| `toggleSkill(id, enabled?)` | id 不存在 → no-op；`enabled` 缺省时取反，显式传值时直接赋值（UI 只用缺省形态） |
| `slotIn` | `SkillSlotInEvent \| null`（`{ id, startedAt, agentName, skillName, skillSource }`），transient |
| `triggerSlotIn(e)` / `clearSlotIn()` | 设置 / 清空 slotIn；清空由动画组件 3.2s 定时器驱动 |

- **单卡状态机**：`未安装 --安装--> 已安装+启用 <--启用/禁用--> 已安装+禁用`（无「卸载」回边）。
- **持久化**：`installedSkills` 在 zustand `persist`（key `hummer-v6`，version 1）的 `partialize` 白名单内，刷新后保留；`slotIn` 不持久化。
- **本地 state**：`q / cat / detail`（不进 URL，不跨页保留；切走再切回页面组件重挂载即重置）。

## 6. 模块联动

- **审计链（audit）**：安装/启停各写一条审计（tags `skill:install` / `skill:toggle`）；此外 `ChainSnapshot.deriveSop` 直接 import `skillItems`，把审计条目的 `skill:` 标签、`recentCalls.caller`、`applicable` 反查为责任链快照里的「依据 SOP 版本」行。
- **治理舱（governance）**：GovernanceCabin 的「Skill / MCP 仓库 · 签名与版本」卡片展示与本页同主题的签名/沙箱概念，但用的是**独立静态数组** `skillHub`（作者名与 skills.ts 的 signer 不一致，如「陈若澜 共创」vs「陈鹏」）。
- **员工市场 / 练虾系统**：共用 `triggerSlotIn` 插盘动画。
- **mock runtime**：`useAppStore.ts` 底部的定时器持续产生带 `skill` tag 的审计条目（如「调用 BD 邮件 v3.2」），让技能「被调用」的感觉持续存在，但与 `installedSkills` 状态完全无关。
- **命令面板**：技能条目可被全局搜索。

## 7. Mock 边界与已知限制

1. **安装不影响 Agent**：`installedSkills` 与员工数据（`employees[].skills`）互不相通；toast 提示的「在我的员工中分配」无对应功能。
2. **卡片 Metric 静态**：调用量/成功率/最近调用来自静态数据，禁用技能后 mock runtime 依旧推送该技能的「调用」审计。
3. **actor 未随角色切换**：审计恒记 `昆仑（您）`。
4. **无卸载**：只能禁用；`installedSkills` 无 remove action。
5. **「筛选」「上传技能」为空壳**；导航 badge 128 与实际 9 条目录不符。
6. **签名/沙箱是纯字段展示**：`signed/signer` 无校验逻辑；沙箱版 `sk-fund-transfer` 同样可被「安装 + 启用」，没有阻断或加签流程。
7. 详情抽屉的权限范围 / Schema / 调用日志均为静态 mock，无真实 MCP 权限联动。
