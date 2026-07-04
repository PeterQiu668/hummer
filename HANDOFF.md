# Hummer 项目交接文档

> 新对话窗口接手时，先 Read 这个文件一次即可全量接上。

## 一、项目位置 / 启动

```
工作目录: F:\Users\claude code
启动:     npm run dev   →   http://localhost:3000/   (vite.config.ts strictPort)
构建:     npm run build
TS 检查:  npx tsc -b
```

技术栈：**Vite + React 18 + TypeScript + Tailwind 3 + Zustand + @react-three/fiber + framer-motion + lucide-react**。

## 二、产品定位（一句话）

Hummer 是企业级 Agent Workforce 编排系统原型。三层架构：**L1 Data OS / L2 Agent OS / L3 Agent Workforce（数字员工集群）**。

视觉风格：**Notion / Linear / 腾讯云**式克制企业风（warm white + ink + 低饱和蓝青）。**禁止霓虹/赛博朋克/对标产品名（OpenClaw/Hermes/HiClaw/练虾）作为导航或主文案**。

## 三、当前状态（关键）

### ✅ 已经正常的
- 浅色设计系统（`src/styles.css` + `tailwind.config.js`）
- 左导航命名：指挥中心 / 对话流 / 工作任务 / 交付物 / 我的员工 / 员工市场 / 技能与工具 / MCP 连接 / 知识中枢 / 审计与治理 / 质量与复盘
- 三层立体首页（`OfficeStage3D.tsx`：顶部 3D Canvas + 中间 L2 Agent OS 透视斜面 + 底部 L1 Data OS 更深透视）
- 体素小人替换胶囊体（`Workstations.tsx` 的 `VoxelHuman`）
- 招聘合并到 3D 首页（已招聘员工自动出现在过渡区/休息区，橙色「试岗中」名牌）
- Agent 详情 Drawer 替换右栏（不悬浮中间，380px，selectedEmployee 时占用 RightConsole 槽位）
- 高管分身链路（5 位：林·CEO/吴·销售VP/邓·运营VP/宋·产品/万·CFO，点击进 ExecutiveDetail modal）
- A2A 委派事件每 20 秒 mock 推到审计 + 对话
- 9 种消息类型（`MessageStream.tsx`）：msg / translate / decompose / confirm / task / tool_call / approval / deliverable / evidence
- 6 大企业群 channels（老板总控 / 高管分身会议室 / 销售作战 / 市场内容 / 客户交付 / 风险审计）
- 员工市场龙虾化（5 tab：浏览 / 套餐 / 定制 5 步 / 专家保障 / 我的招聘）
- 6 位固定专家（林知远/陈若澜/周明衡/许安琪/梁亦辰/韩书白）—— `src/data/experts.ts`
- 11 经营环节分类
- 4 套餐（初创 7 / 增长 15 / 旗舰 25 / 定制 54）
- 会议室完整 flow（议题→参会人→实时纪要→行动项→结束生成审计）
- 证据库页（左导航「交付物」， `pages/EvidencePage.tsx`，8 mock + hash/timestamp/owner/审批/来源/KG）
- 任务详情接产出物 + 证据链 + 关联对话/会议/审批/审计 + 复盘 SOP 回写
- Cmd+K 命令面板、Toast 系统、localStorage 持久化
- Mock 实时引擎（每 5s tick，推消息 / 审计 / A2A）

### ⚠️ 刚紧急修过 / 简化版
- **`src/components/ui/AgentAvatar.tsx` 是简化版**：彩色 gradient + 首字 + 上传头像支持。之前的 `CharSVG`（参数化 SVG 手绘小人）在浏览器抛错导致整页白屏，已删。要恢复手绘小人需重新实现并单独验证。

### ❌ 还没做 / 已知问题
- 3D Workstations 里的「体素小人」只是 box 拼装，不是手绘 chibi
- `data/marketplace.ts` 还是 36 个旧专家名（陈鹏/吴琳/周伟等），Marketplace.tsx 里通过 `EXPERT_BY_CATEGORY` 映射到 6 位新固定专家，工作正常但 expert/expertTitle 字段没真改
- BottomFlow.tsx 用户/linter 改过几次，目前样式还有 `glass-strong` 等 legacy class，需要 tidy
- 知识中枢 4 步骤页面仍是 mock 占位，没真接数据
- 任务详情 Drawer 右侧抽屉默认弹出在中间偏右（420px），如果同时打开 Agent 详情会重叠

## 四、关键文件地图

| 用途 | 路径 |
|---|---|
| 入口 | `src/App.tsx` `src/main.tsx` `index.html` |
| Shell | `src/components/shell/AppShell.tsx` `TopBar.tsx` `LeftNav.tsx` `RightConsole.tsx` `BottomFlow.tsx` |
| 3D 办公室 | `src/components/office/OfficeStage3D.tsx` `Workstations.tsx` `ZonePlatform.tsx` `HexPlatform.tsx` `CityBackground.tsx` `CameraRig3D.tsx` `Lighting.tsx` |
| 员工 | `src/components/drawer/EmployeeDrawer.tsx` `pages/EmployeesPage.tsx` `ui/AgentAvatar.tsx` |
| 市场 | `src/components/marketplace/Marketplace.tsx` |
| 高管分身 | `src/components/exec/ExecutiveDetail.tsx` |
| 对话流 | `src/components/collab/{MessageStream,ChannelList,MentionPicker,RiskAlertModal,TaskCard}.tsx` `pages/ChatPage.tsx` |
| 任务 | `src/components/pages/TasksPage.tsx` |
| 会议 | `src/components/meeting/MeetingRoom.tsx` |
| 治理 / 复盘 | `src/components/hiclaw/GovernanceCabin.tsx`（标题已改「审计与治理」） `hermes/EvolutionFlywheel.tsx`（标题已改「质量与复盘」） |
| 证据库 | `src/components/pages/EvidencePage.tsx` |
| 知识 | `src/components/pages/KnowledgeHubPage.tsx` `kg/KnowledgeGraph.tsx` |
| 技能 / MCP / 审计 | `src/components/pages/{SkillsPage,MCPAppsPage,AuditPage}.tsx` |
| 全局 | `src/components/global/{CommandPalette,ToastContainer}.tsx` |
| 数据 | `src/data/{employees,workstations,experts,executives,marketplace,skills,tasks,feishu,hermes,kg,douyin}.ts` |
| Store | `src/store/useAppStore.ts`（persist middleware key `hummer-v6`） |
| Types | `src/lib/types.ts` |
| Tokens | `src/styles.css` `tailwind.config.js` |

## 五、最近的 brief（用户最新一轮要求）

1. **首页三层架构要立体不是文字** ✅ 已做
2. **数字员工手绘形象** ⚠️ 临时回退到首字
3. **Agent 详情替换右栏** ✅ 已做
4. **员工市场龙虾化** ✅ 已做（专家保障 / 套餐 / 5 步 wizard / 体验工坊）
5. **不要独立练虾/HiClaw/Hermes 栏目** ✅ 已做（改名「审计与治理」「质量与复盘」）
6. **责任链：老板 → 老板分身 → 高管分身 → 高管 → Agent** ✅ 已做（RightConsole 永久显示，Drawer 顶部贯穿）
7. **对话流/会议/拉人/产出物/证据** ✅ 已做
8. **localStorage 持久化** ✅ 已做（`hummer-v6` + `hummer-avatar-{id}` + `hummer-marketplace-hires`）
9. **去乱码图标 / 浅色统一** ✅ 已做

## 六、常见坑（重要）

1. **Dev server 经常在 turn 切换之间被回收** → 失联时跑 `npm run dev` 重启即可。
2. **PowerShell 跑 sed/awk 会把中文文件乱码** → 用 Bash 的 sed 或者 Edit 工具，**禁止用 PowerShell 处理含中文的源文件**。
3. **Vite host: 'localhost'/'127.0.0.1'** Windows 上会因 IPv4/IPv6 解析问题报 `ERR_CONNECTION_REFUSED`。已经改成 `host: true` 双绑。
4. **strictPort: true, port: 3000**（之前 5174 →  改为 3000，避免任何浏览器 HSTS 缓存）。
5. **SVG 在 React 里的坑**：`<svg>` 里直接放 fragment 包裹的多个 SVG 子元素，有时浏览器会抛 namespace 错误（CharSVG 之前就是这样炸的）。如果要重新做 SVG 手绘头像，建议每个头像直接返回 `<svg>` 而不是返回 fragment。

## 七、新对话第一句话建议

```
读 F:/Users/claude code/HANDOFF.md，启动 dev server（npm run dev，3000 端口），
然后告诉我现在哪里需要继续。
```

或者直接给具体任务：
```
我要继续做 Hummer。先读 HANDOFF.md，然后帮我把 AgentAvatar 升级回手绘 chibi 形象，
但用单一 <svg> 根元素而不是 fragment。
```
