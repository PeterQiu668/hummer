# HUMMER RuntimeAdapter 架构说明

> 版本：M2  
> 核实日期：2026-08-28  
> 范围：前端契约、合成 Mock、Codex CLI 桌面宿主与本地 SQLite 事实源；不含云端后端、多租户服务或 Temporal

## 1. 决策摘要

HUMMER 把运行时视为可替换执行器，不把 Codex、DeepSeek Harness、MCP 或浏览器工具的类型变成产品事实。

```text
SessionPlan
   -> RuntimeAdapter
      -> append-only RuntimeEvent
         -> Electron persistence host
            -> SQLite domain_events + projections + evidence blobs
               -> projectRuntimeSession()
                  -> Workbench UI / ExecutionSession projection
```

V4 默认使用 `MockRuntimeAdapter`。它异步逐条产出事件，工作台不读取预制会话数组，也不直接调用 `createDemoSession()`。将 Mock 换成其他实现时，页面组件不需要修改。

Codex 入口受 `VITE_HUMMER_RUNTIME_ADAPTER=codex` 控制，默认关闭。即使打开，浏览器还必须由桌面宿主注入 `window.hummerCodexCliHost`；没有宿主桥时仍回退到 Mock，不声称接入了真实文件、桌面、CRM 或 MCP。

## 2. RuntimeAdapter 契约

源码：`src/features/sessions/runtime/adapter.ts`

| 方法 | 语义 | 必须满足的行为 |
|---|---|---|
| `startSession(plan)` | 从已确认计划启动运行 | 返回不泄漏底层类型的 `RuntimeHandle` |
| `subscribe(handle, cb)` | 订阅并回放事件 | 先回放已有日志，再流式发送新增事件；返回取消订阅函数 |
| `respondToApproval(handle, id, approved)` | 回应一等审批事件 | 只能回应当前 runtime 实际提出的审批 |
| `sendHumanMessage(handle, text)` | 在同一会话插入人的指令 | 使用与 AI 相同的 `step` 事件，只由 `actorRef` 区分 |
| `pause/resume/stop(handle)` | 控制运行 | 状态变化也进入 append-only 日志；停止必须撤销后续工作 |
| `forkFromCheckpoint(handle, sequence, sop?)` | 从检查点创建隔离分支 | 原分支不变；新分支保留检查点前事件并使用可选 SOP |

`RuntimeHandle` 只暴露 HUMMER `sessionId`、adapter `runtimeId` 和可选的 `nativeSessionId`。产品域不得假设 `nativeSessionId` 是 Codex thread、Harness session 或某一种 Worker job。

## 3. RuntimeEvent 字段

所有事件共享：

| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | `string` | HUMMER 会话标识 |
| `sequence` | `number` | 会话内从 1 开始单调递增；事件日志 append-only |
| `occurredAt` | ISO 8601 `string` | runtime 没有源时间戳时，由 adapter 在接收边界盖章 |
| `actorRef` | `string` | `human:*`、`employee:*` 或其他企业主体引用；不用不同 schema 区分人和 AI |
| `type` | 判别联合 | `step`、`tool`、`approval_required`、`approval_resolved`、`status`、`result` |

事件特有字段：

| 类型 | 必填字段 | 用途 |
|---|---|---|
| `step` | `category/status/title/result/evidenceRefs` | 委派、消息、交接、系统步骤；人和 AI 共用 |
| `tool` | `tool/args/result/durationMs/costCny/evidenceRefs` | 文件、命令、浏览器、MCP 等工具结果 |
| `approval_required` | `approvalId/message/tool/args/result/durationMs/costCny/evidenceRefs` | 可恢复的策略关口，不当作 error |
| `approval_resolved` | `approvalId/approved/result/evidenceRefs` | 人的决定进入同一事件日志 |
| `status` | `status/evidenceRefs` | 暂停、恢复、阻断、停止 |
| `result` | `summary/deliverables/evidenceRefs/durationMs/costCny/rollback` | 交付投影的 runtime 输入，不替代 HUMMER `ResultPackage` |

`durationMs` 和 `costCny` 字段始终存在于工具、审批和结果事件，但允许为 `null`。`null` 表示底层 runtime 未报告，不能伪装成零成本或零耗时。结果事件还可带 runtime-neutral `usage`（输入、缓存输入、输出、推理输出和总 token）。Mock 使用合成数值；Codex 的 CNY 成本只在价格配置中存在已核实模型时计算。

## 4. MockRuntimeAdapter

源码：`src/features/sessions/runtime/mockRuntimeAdapter.ts`

Mock 的职责不是提供一次性 fixture 数组，而是模拟真实 runtime 生命周期：

1. `startSession()` 返回 handle 后才开始计时。
2. 每个步骤通过独立异步 tick 发出。
3. 运行到 `approval_required` 后停止排队，等待真人决定。
4. 插话立即生成 `step`，`actorRef=human:operator`。
5. 批准后继续工具调用并发出 `result`；拒绝后发出 `blocked`。
6. `stop()` 清除计时器和剩余队列，只追加一个 `cancelled` 状态事件。
7. `forkFromCheckpoint()` 复制检查点前的事件到新 session，并在隔离分支继续。
8. L1 计划只产出只读中间结果，遇到外部写入直接 `blocked`，不会伪造审批后可写语义。

Mock 的所有工作区、浏览器、CRM、文件和证据 URI 都是 `fixture://`、`evi://` 或 `.example.test` 合成资源。

## 5. Codex CLI 事实核实

### 5.1 已核实

官方来源：

- [Codex 非交互模式](https://developers.openai.com/codex/noninteractive)
- [Codex CLI 命令参考](https://developers.openai.com/codex/cli/reference)
- [openai/codex app-server 协议](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [openai/codex exec CLI 源码](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs)

截至 2026-08-28，已核实：

| 事实 | 结论 |
|---|---|
| 非交互入口 | `codex exec PROMPT`；传 `-` 时从 stdin 读取 prompt |
| 结构化输出 | `codex exec --json` 输出 JSONL；公开事件族含 `thread.started`、`turn.started`、`item.*`、`turn.completed`、`turn.failed`、`error` |
| 沙箱参数 | `--sandbox read-only | workspace-write | danger-full-access` |
| 审批参数 | 全局 `--ask-for-approval/-a` 的公开值为 `untrusted | on-request | never`；非交互文档要求预先设定审批与沙箱策略 |
| 恢复 | `codex exec resume [SESSION_ID]`，支持 `--last` |
| 结果约束 | `--output-schema <path>`；最终消息可用 `--output-last-message/-o` |
| App Server | `codex app-server --listen stdio://`（或 `--stdio`）通过 stdin/stdout 传 newline-delimited JSON-RPC |
| App Server 审批 | `item/commandExecution/requestApproval` 是 server request，客户端回传 decision 后 turn 继续 |
| App Server 成熟度 | 官方标记为 Experimental，协议可能变化；应在宿主桥做版本适配 |
| 许可证 | `openai/codex` 仓库根 LICENSE 为 Apache-2.0 |

### 5.2 本机核实结果

Windows App 内的入口仍会被执行别名权限阻断：

```text
C:\Program Files\WindowsApps\OpenAI.Codex_26.727.6591.0_x64__2p2nqsd0c76g0\app\resources\codex.exe
Access is denied
```

本轮没有绕过该文件，而是改用官方 npm 包安装独立 CLI。第一次安装没有带齐平台可选依赖，报错为 `Missing optional dependency @openai/codex-win32-x64`；随后执行：

```powershell
npm install --global @openai/codex@latest --include=optional --force
codex --version
# codex-cli 0.150.1
```

当前命令来自 `C:\Users\Administrator\AppData\Local\hermes\node\codex.ps1` / 同目录 `codex.cmd`，不是 WindowsApps 执行别名。`codex --help`、`codex exec --help`、`codex app-server --help` 均已在 2026-08-28 实测通过。

最小非交互实测在 `spikes/codex-runtime` 目录执行，stdin 提示 Codex 读取 `input.txt` 并给出摘要：

```powershell
codex exec --json --sandbox read-only -
```

真实 JSONL 节选：

```jsonl
{"type":"thread.started","thread_id":"01a04407-0357-7ac1-b90f-0d6e1a2ac2e2"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"Get-Content ...\\input.txt","aggregated_output":"HUMMER is a human-AI collaboration workspace...","exit_code":0,"status":"completed"}}
{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0}}
```

Electron 真实链路还验证了 `command_execution` 与 `file_change` 两类事件，并在磁盘生成 `spikes/codex-runtime/summary.md`。完整 UI 投影片段保存在 `spikes/codex-runtime/desktop-trajectory.json`。

本机 `codex app-server generate-json-schema --out <TEMP>` 和 `generate-ts --out <TEMP>` 也已通过；生成物只用于核对 0.150.1 的方法和字段，没有复制进产品域。已核实的方法包括 `initialize`、`thread/start`、`turn/start`、`turn/steer`、`turn/interrupt`，审批结果值为 `accept | decline`。

M1.5 对审批 wire 做了逐行复验。成功 E2E 的实际审批响应是：

```json
{"id":0,"result":{"decision":"accept"}}
```

它没有 `jsonrpc:"2.0"`，server 仍接受并继续产生工具事件直到 `turn.completed`；`accept` 也是 CLI 0.150.1 的实际可用变体。因此此前 120 秒挂起的根因不是这两个协议嫌疑。成功轨迹保存在 `spikes/codex-runtime/app-server-approval-trajectory.json`。

2026-08-28 的隔离复验没有到达审批请求：stderr 原文为 `failed to parse remote plugin catalog response ...: EOF while parsing a value at line 1 column 0`，随后上游流停止。该失败属于当前 Codex 远端插件目录/流可用性，不能改写此前已经完成的协议验收，也不能算本轮复验通过。

仍未核实：Windows App 打包内 CLI 的版本与 schema；npm CLI 登录态在其他 Windows 账户上的继承行为；任意 HUMMER checkpoint 到 Codex thread fork 的精确对应关系。

上述成功只证明当前机器、当前账户和固定测试目录中的 M1 链路，不等于多租户、生产部署或企业审计已完成。

## 6. 两条 Codex 接入路径

### 6.1 只读证明链路：`exec --json`

当前构造器生成：

```text
codex exec --json --sandbox read-only -
```

计划正文通过 stdin 发送。L2/L3 且工作区允许写时映射为 `workspace-write`；代码绝不自动选择 `danger-full-access`。

这条路径适合 V5 的最小证明：“在一个明确工作区内读取文件，输出摘要”。它能流式返回执行事件，但 `codex exec` 面向预设策略、无人工交互的运行，不能被假定为支持 HUMMER 页面里的实时审批回传、插话、暂停或任意检查点 fork。

### 6.2 完整交互路径：`app-server` host bridge

完整 HUMMER 契约更适合：

```text
codex app-server --listen stdio://
```

本轮桌面宿主已经负责：

1. 启动受控子进程并完成 `initialize`。
2. 用 `thread/start`、`turn/start` 发送 `initialPrompt`。
3. 将 item 生命周期通知映射为 `RuntimeEvent`。
4. 将审批 server request 转成 `approval_required`，再把 HUMMER 决定回传 JSON-RPC。
5. 用 `turn/steer` 接收插话，用 `turn/interrupt` 停止当前 turn。

尚未完成的是 pause/resume、thread fork 与 HUMMER 任意 sequence 的精确映射，以及正式的 schema 版本协商。当前开发验证通过 CLI 自带生成器在临时目录核对 0.150.1 schema，代码没有直接依赖 main 分支类型。

`CodexCliHost` 是唯一允许接触进程与原生协议的端口。React 页面和产品域不会 import Codex 类型。

## 7. Codex 到 RuntimeEvent 映射

源码：`src/features/sessions/runtime/codexRuntimeAdapter.ts`

| Codex 消息 | RuntimeEvent | 已覆盖 | 未覆盖或降级 |
|---|---|---:|---|
| `thread.started` | 只更新 `nativeSessionId` | 部分 | 不生成业务步骤；源事件没有可靠发生时间 |
| `turn.started` | `step(system,running)` | 是 | 只表示开始，不含计划明细 |
| `item.completed: agent_message` | `step(message)` | 是 | actor 固定映射为 `employee:codex` |
| `item.completed: command_execution` | `tool(shell.command)` | 是 | `durationMs/costCny` 缺失时为 `null` |
| `item.completed: mcp_tool_call` | `tool(mcp.server.tool)` | 是 | 连接器业务归属需由 HUMMER 能力目录补齐 |
| `item.completed: file_change` | `tool(workspace.patch)` | 是 | diff 结构按宿主接收的版本做防御性映射 |
| `item/commandExecution/requestApproval` / `item/fileChange/requestApproval` | `approval_required` | 是 | 仅 app-server；文件审批在 host 内归一化，exec JSONL 不能回传互动审批 |
| approval response | host 回传 `accept | decline` | 是 | 真实 E2E 已证明批准后继续产生工具事件并完成；30 秒无后续事件时 host 显式上报失败 |
| `turn.completed` | `result` | 是 | runtime result 仍需 HUMMER 投影为正式 `ResultPackage` |
| `turn.failed` / `error` | `status(blocked)` | 是 | 错误分类与重试建议待扩充 |
| `thread/tokenUsage/updated` / `turn.completed.usage` | `RuntimeTokenUsage` | 是 | app-server 读取 `tokenUsage.last`；exec 读取 `usage`；价格表无匹配模型时 `costCny=null` |
| resume | `resume()` | 宿主待实现 | `exec resume` 已核实；活动 turn 的恢复语义需 app-server 验证 |
| fork | `forkFromCheckpoint()` | 宿主待实现 | Codex thread fork 不天然等于 HUMMER 任意 event sequence |

## 8. 第二个 adapter 怎么写

### 8.1 DeepSeek Harness

只借其 append-only session log、trajectory、resume/fork/replay 和插件化设计，不 import 或复制 developer-preview schema。

实现者需要：

1. 将 Harness session ID 放入 `RuntimeHandle.nativeSessionId`。
2. 把其日志顺序转换为 HUMMER 单调 `sequence`。
3. 把工具事件补齐 `tool/args/result/durationMs/costCny/evidenceRefs`；上游没有的值用 `null`。
4. 将 approval/pause/resume/fork 映射到对应插件能力；不支持时显式抛出 capability error。
5. 只通过 `RuntimeEvent` 向产品层输出，不让 Harness session schema 成为审计事实源。

DeepSeek Harness 官方当前明确标记 developer preview，存在兼容性破坏；MIT 许可证要求随复制或实质分发保留版权和许可文本，并应同步检查其 `THIRD_PARTY_NOTICES.md`。

### 8.2 自研 Worker

自研 Worker 至少需要：

- 事件 append-only、会话内严格排序、断线重放；
- 可撤销的运行句柄和真正停止工具的能力；
- 一等审批中断，不能把等待审批编码成异常；
- 人与 AI 共用事件 schema；
- 工具输入输出脱敏、证据引用、耗时与成本遥测；
- checkpoint 到原生状态的可验证映射；
- 只执行 HUMMER 下发的 tenant-scoped capability token，不直接写产品数据库。

## 9. 自研与开源边界

| 能力 | 选择 | 边界 |
|---|---|---|
| 本地文件、命令、沙箱、基础审批、skills | Codex CLI | 放在 `CodexCliHost` 后，不做组织事实源 |
| 工具连接协议 | MCP | 作为工具协议；凭证、租户授权和审计仍由 HUMMER 管 |
| 浏览器执行 | Playwright | 由受控 Worker 调用，页面前端不直接拥有真实浏览器令牌 |
| session/fork/replay 插件化设计 | DeepSeek Harness | 借设计，不绑定 developer-preview schema |
| 节点安装与环境检测 | EasyClaw 思路 | 采用前重新核具体版本、许可证和依赖清单 |
| 租户、账号、组织语义 | HUMMER 自研 | 企业身份、隔离、成员关系是产品核心 |
| 责任链与审批策略 | HUMMER 自研 | runtime 的“允许执行”不等于企业批准事实 |
| 审计账本与证据规则 | HUMMER 自研 | 事件完整性、证据资格、保留策略不能外包给 runtime 日志 |
| ResultPackage、验收、回滚责任 | HUMMER 自研 | runtime result 只是输入，不是正式交付事实 |
| ROI、评测、坏例与进化 | HUMMER 自研 | 这是跨模型、跨 runtime 的组织学习资产 |

## 10. 许可证与 NOTICE

本节与 `docs/research/2026-08-technical-product-spec.md` §9 对齐：

| 项目 | 当前判断 | V4/V5 义务 |
|---|---|---|
| OpenAI Codex CLI | Apache-2.0 | 若分发二进制或衍生代码，附许可证、保留适用归属和修改说明；若上游分发含 NOTICE，随分发保留可读 NOTICE。仅调用用户已安装 CLI 也要在依赖清单说明集成边界 |
| DeepSeek Harness | MIT，developer preview | 复制或打包时保留 copyright 与 MIT 文本；同步其 third-party notices；避免造成官方背书的品牌表达 |
| Playwright | Apache-2.0 | 打包时纳入第三方依赖清单、许可证和适用 NOTICE |
| EasyClaw | 技术说明书当前判断为 MIT | 真正采用前固定版本并重新核 LICENSE、NOTICE 与完整依赖闭包 |
| HUMMER 当前仓库 | 技术说明书记录为未发现根 LICENSE | 对外发布或商业交付前补项目 LICENSE、版权归属和 `THIRD_PARTY_NOTICES` 流程 |

许可证结论是工程合规清单，不替代正式法律意见。CI 最终应从锁定版本生成依赖清单，不依赖文档里的静态判断。

## 11. 当前完成与卡点

已完成：

- runtime-neutral 接口与事件联合类型；
- 异步 Mock、审批、插话、暂停/恢复/停止、fork；
- RuntimeEvent 到 ExecutionSession/ResultPackage 的投影；
- npm 安装的 Codex CLI 0.150.1，可从普通子进程执行；
- `apps/desktop` Electron 主进程、preload `contextBridge` 与 IPC `CodexCliHost`；
- `codex exec --json` 的真实 `command_execution`、`file_change`、磁盘产物与 UI trajectory；
- app-server 的 `initialize`、`thread/start`、`turn/start` 与完整非审批 turn；
- stderr 与每条出站/入站 JSON 的逐行诊断日志；日志只在显式设置 `HUMMER_CODEX_WIRE_LOG_PATH` 时落盘；
- app-server 审批 request → 真人批准 → 后续工具 → `turn.completed` 的真实闭环；实际可用响应是无 `jsonrpc` 字段的 `{"id":0,"result":{"decision":"accept"}}`，两个协议嫌疑均被排除；
- 审批回传 watchdog：30 秒内没有任何 runtime 后续事件时，UI 明确显示“审批回传未被 runtime 接受”，可用 `HUMMER_CODEX_APPROVAL_TIMEOUT_MS` 调整；
- `turn/steer` 与 `turn/interrupt` 独立真实 E2E，证据分别为 `app-server-steer-trajectory.json` 和 `app-server-interrupt-trajectory.json`；
- Electron 主进程内的 `better-sqlite3` 事实源，迁移包含 `domain_events/work_orders/sessions/steps/approvals/evidence/result_packages`；
- `domain_events` 全局 append-only SHA-256 hash chain，重复事件幂等、冲突 sequence 拒绝，手工 SQL 篡改可被完整性校验定位；
- RuntimeEvent 严格先经 IPC 落库，再返回 renderer 投影；重启后从 SQLite 回放，React 不接触 SQL/Electron 类型；
- 文件产物存入 `blobs/sha256/<digest>`，事件使用 `evidence://sha256/<digest>`；旧 `evi://` 与 `fixture://` 不再作为持久化证据；
- Codex token usage 映射为 runtime-neutral 字段，结果耗时使用 turn wall-clock；`runtime-pricing.json` 价格表默认空，不猜价格；
- 双 Electron 进程重启验收通过：同一 SQLite 目录中的 8 条轨迹、审批与成果包完整恢复，重开前后 hash chain 均为 `valid: true, checked: 8`；证据在 `spikes/m2-persistence/restart-evidence.json`；
- Codex 启动失败时显式回落 Mock，节点条显示“演示运行时”和失败原因；
- 映射、JSONL 拆行、app-server 翻译、桌面边界与前端替换性的自动测试。

未完成且未伪装完成：

- WindowsApps 版本的 `codex.exe` 仍被 `Access is denied` 阻断；实际运行使用 npm CLI；
- 2026-08-28 的最新 `exec --json` 与 approval 复验均被 Codex 远端插件目录请求的 EOF/连接错误阻断；历史真实 E2E 证据仍有效，但本轮网络复验不能报告为绿色；
- pause/resume 没有可用的 app-server 产品语义，前端不应把它声称为已接通；
- 正式 schema 版本协商与兼容矩阵；
- Codex thread checkpoint 到 HUMMER sequence 的精确 fork 映射；
- 当前实测成功样例只拿到 token usage 字段且数值为 0；尚未获得可用于计费验证的非零 usage；
- `runtime-pricing.json` 尚无经当前账号计费路径核实的 CNY 模型价格，因此真实 Codex `costCny` 继续为 `null`，UI 显示“价格未配置”或“该 runtime 未提供用量”。

M1.5 的协议闭环与 M2 本地事实源已经完成；当前仍不是云端多租户或生产审计系统。React 继续不得接触 Node `child_process`、Electron 或 SQLite 类型，也不得为“看起来连通”制造假事件。
