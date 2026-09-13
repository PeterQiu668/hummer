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

计划正文通过 stdin 发送。自 M5-D 起，L1/L2/L3 全部映射为 `read-only`；代码绝不自动选择 `workspace-write` 或 `danger-full-access`。文件变更必须经 Codex app-server 的原生 file-change approval，或经 HUMMER 主进程受控工具执行。

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
- 双 Electron 进程重启验收通过：同一 SQLite 目录中的 8 条轨迹、审批与成果包完整恢复，重开前后 hash chain 均为 `valid: true, checked: 9`；证据在 `spikes/m2-persistence/restart-evidence.json`；
- Codex 启动失败时显式回落 Mock，节点条显示“演示运行时”和失败原因；
- 映射、JSONL 拆行、app-server 翻译、桌面边界与前端替换性的自动测试。

未完成且未伪装完成：

- WindowsApps 版本的 `codex.exe` 仍被 `Access is denied` 阻断；实际运行使用 npm CLI；
- 2026-08-28 21:54（Asia/Shanghai）的 approval E2E 已重新通过；远端 plugin catalog 通过 `--disable plugins` 确定性降级，不再阻断审批；
- pause/resume 没有可用的 app-server 产品语义，前端不应把它声称为已接通；
- 正式 schema 版本协商与兼容矩阵；
- Codex thread checkpoint 到 HUMMER sequence 的精确 fork 映射；
- 2026-08-28 21:54 的真实审批运行获得 `23,022` total tokens 与 `62.19s` wall-clock；价格表仍为空，因此 `costCny=null`；
- `runtime-pricing.json` 尚无经当前账号计费路径核实的 CNY 模型价格，因此真实 Codex `costCny` 继续为 `null`，UI 显示“价格未配置”或“该 runtime 未提供用量”。

M1.5 的协议闭环与 M2 本地事实源已经完成；当前仍不是云端多租户或生产审计系统。React 继续不得接触 Node `child_process`、Electron 或 SQLite 类型，也不得为“看起来连通”制造假事件。

## 12. M3 多引擎与审批复核（2026-08-28）

### 12.1 Codex 供应商配置事实

本机版本仍为 npm 安装的 `codex-cli 0.150.1`。本轮实测结论：

- DeepSeek 档使用 dotted `-c` 路径、`wire_api="responses"` 与 `requires_openai_auth=false` 后，`codex doctor --json` 的 `config.load=ok`；因为 `DEEPSEEK_API_KEY` 不存在，`auth.credentials=fail`，没有发送模型任务。
- Codex 0.150.1 已不接受 chat-completions provider。智谱当前档明确标为 blocked，不把配置失败伪装成 runtime 回落。
- OpenAI API 档使用非保留 provider id `openai_hummer`；当前没有 `OPENAI_API_KEY`。用现有 Codex 登录令牌直连 `api.openai.com/v1/responses` 实测得到 401 `api.responses.write` scope 缺失，不能算旗舰档 E2E。
- 内部 `openai-codex-validation` 档只用于验证 Codex 外壳，走 Codex 已登录通道，审计域名为 `chatgpt.com`，不在产品档位选择中出现，也不计入 OpenAI API 档 benchmark。
- argv 只出现环境变量名称，绝不出现值；`WireLog` 在写入前再次按所有已知 key 值脱敏。对应断言在 `apps/desktop/src/engine-profiles.test.ts`、`wire-log.test.ts` 与 `claude-host-contract.test.ts`。

### 12.2 远端 plugin catalog 降级与审批报文

先后进行了两个受控命令：

1. 只加 `--disable remote_plugin --disable recommended_plugins`：stderr 仍出现 `/ps/plugins/installed`、featured plugin 与 `plugins.git` 请求，证明两个细粒度 flag 不足。
2. 再加 `--disable plugins`：同类 catalog 请求为 0。HUMMER Codex host 现在对每一档都注入这三个 flag，确定性牺牲 Codex plugin 加载以保证企业任务启动；MCP 是独立能力通道，不由该结论冒充已关闭。

2026-08-28 21:53:46 至 21:54:48（Asia/Shanghai）运行：

```text
npm run test:desktop:codex:approval
```

真实通过。完整报文位于 `spikes/codex-runtime/app-server-approval-wire.jsonl`（481 行、200,971 bytes），同一次运行包含：

```json
{"method":"item/commandExecution/requestApproval","id":0,"params":{"availableDecisions":["accept",{"acceptWithExecpolicyAmendment":{}},"cancel"]}}
{"id":0,"result":{"decision":"accept"}}
{"method":"turn/completed","params":{"turn":{"status":"completed","durationMs":37556}}}
```

wire 中 request 与 decision 之间约 231ms，批准后出现写文件 command、回读 command 和 `turn/completed`。trajectory 证据为 `spikes/codex-runtime/app-server-approval-trajectory.json`，关键序号为 7 approval_required、8 人工批准、9 后续 tool、17 result。

这次证据继续排除两个协议嫌疑：server 接受不带 `jsonrpc:"2.0"` 的响应，接受的 decision 是 `accept`。对历史 120 秒挂起，当前最强结论是“远端 plugin catalog 是疑似启动干扰源，而非已证明的唯一根因”：关闭 plugins 后 catalog 请求消失且审批闭环通过，但该对比同时发生在不同运行，不能做单变量因果宣称。审批 watchdog 继续保留。

### 12.3 第二个外壳

`ClaudeRuntimeAdapter` 是独立实现，`apps/desktop/src/claude-host.ts` 独立 spawn `claude` 并通过 preload IPC 转发 stream-json。React 没有 import Node/Electron 类型。接入过程中不需要修改 `RuntimeAdapter` 的方法集合；通用 `RuntimeHandle.engine` 用于供应商、模型、域名和沙箱审计披露。

本机 `claude 2.1.248` 可启动并返回真实 session，但 `claude auth status` 为 `loggedIn:false`。2026-08-28 14:10 的真实尝试在任何工具事件前返回 `authentication_failed`，因此审批 E2E 未通过；证据在 `spikes/claude-runtime/2026-08-28-auth-blocked.jsonl`。host 的 approval IPC 会明确抛出“external permission-prompt MCP tool 未连接”，不会制造 approval 事件。

DeepSeek Harness 本轮只做源码 spike，不写 adapter；四问、源码行号、工作量和有限 GO 建议见 `docs/research/deepseek-harness-spike.md`。

### 12.4 基准状态

固定 3 任务 x 5 次 x 4 档的矩阵已写入 `spikes/engine-benchmark/benchmark-plan.json`。当前产品档凭据与 wire 兼容性未满足，真实计分运行是 0/60；原始 preflight 在 `attempts.jsonl`。不得用内部 Codex 登录验证档的成功数据替代 DeepSeek、智谱、OpenAI API 或 Claude Code 的完成率。

### 12.5 MCP 连接事实

2026-08-28 21:53:46 至 21:54:48 的真实审批运行同时提供了 MCP client 证据。app-server-approval-wire.jsonl 中 node_repl 在 21:53:46.315 为 starting，21:53:46.393 为 ready；codex_apps 在 21:53:46.314 为 starting，21:53:48.766 为 ready。

M5-D 之前，桌面主进程只接收 `mcpServer/startupStatus/updated`。M5-D 主动向 Codex 注入本地 `hummer_local` stdio server，并处理 `mcpServer/elicitation/request`。只有租户注册表中已验证、低风险且精确匹配 `hummer_local/fs_read` 的请求会被接受；其余请求默认拒绝。能力页可以执行真实握手，只有成功后才显示“已验证连接”。飞书、钉钉等应用目录没有真实 OAuth/握手，统一显示“待接入”。

真实调用证据位于 `spikes/m5d-tool-registry/`：2026-09-11T04:31:27.294Z 的运行包含 MCP ready、`fs_read` 调用、elicitation accept、内容寻址证据、工具账本和有效哈希链。官方协议依据：https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

### 12.6 真会话重启语义

npm run test:desktop:codex:restart 在 2026-08-28 22:00:23 完成真实复验。关闭 App 前，session codex_hkzqk0_1 / native thread 01a048aa-c3bb-7473-8933-acbe938f1cd9 已落库 7 条真实事件，包含已完成的 shell.command。重开后：

- 原 7 条事件和 native session ID 全部保留；
- 主进程追加 sequence 8、status=interrupted，不声称恢复已经死亡的子进程；
- stop 与 steer 控件禁用，不向失效 RuntimeHandle 静默发送命令；
- hash chain 为 valid: true, checked: 8。

证据在 spikes/m3-real-restart/restart-evidence.json、codex-restart-wire.jsonl 与 dist/hummer-m3-real-restart.png。当前确定行为是“保留并标记中断”，不是自动续跑；真正 resume 仍需独立协议设计。

### 12.7 M3 组织与责任链

迁移 version 2 新增 human_users、departments、digital_twins、digital_employees、approval_policies 和 execution_nodes，没有修改 version 1。雇佣通过 Electron 组织端口写 SQLite；团队页和工作台读取同一 durable employee ID。审批策略默认拒绝未匹配动作，当前高危规则覆盖文件写入、shell 命令、外发、CRM 写回、付款、权限变化和数据删除，并要求指定 human:owner。

apps/desktop/src/persistence/m3-responsibility-chain.test.ts 验证同一 employee ID 贯穿雇佣、派活、审批、工具结果和成果包，六条 domain event 的 hash chain 有效。执行节点页读取主进程真实节点记录、当前会话与权限范围，kill switch 调用 Codex/Claude host 的 stop-all。

必须区分两种证据：

1. 组织、审批策略和成果包责任链是本地 SQLite 集成测试事实。
2. 真实 shell 审批、MCP 握手和重启中断是 openai-codex-validation 外壳验证事实。

默认 DeepSeek 产品档因为本机没有 DEEPSEEK_API_KEY，尚未完成“雇员工后用默认 DeepSeek 派真任务”的整链验收，不能把上述两种证据拼接成已完成声明。完整状态见 spikes/m3-organization/acceptance-status.md。

## 13. M3.5 DeepSeek checkpoint 分叉复验（2026-08-29）

本节取代 11、12 节中“DeepSeek key 缺失”“checkpoint fork 尚未核实”和“价格表为空”的旧状态描述。

- 运行结束：2026-08-29 00:28:52（Asia/Shanghai）。档位 `deepseek-standard`，模型 `deepseek-v4-flash`，数据域 `api.deepseek.com`。
- source 原生 thread `01a04933-50fc-7793-96cb-759f42c6fbda`，fork thread `01a04933-a2c5-71d0-aa86-a61356401614`，审计检查点 sequence 16。Codex 实际恢复粒度仍是原生 thread，不承诺回滚其内部状态到任意单条事件。
- 两条分支产生不同文本产物，均经过真实 command approval；持久化会话数 2，hash chain `valid=true, checked=50`。证据位于 `spikes/deepseek-standard/`。
- app-server approval request id 会在不同原生 thread 内从 0 重新计数。宿主现以原生 thread id 命名空间化 HUMMER approvalId，再映射回 server 原始 request id，避免 source 已批准 id 遮蔽 fork 待批 id。
- `runtime-pricing.json` 已按 DeepSeek 官方人民币价配置 `deepseek-v4-flash` 工作日高峰/空闲时段；来源 `https://api-docs.deepseek.com/zh-cn/quick_start/pricing/`，核实日 2026-08-29。未知模型或缺失 usage 继续返回 `null`。
- 兼容性边界：本次仍观察到 Codex model manager 无法解析 DeepSeek `/models` 返回形状，以及 PowerShell shell snapshot 不支持。任务实际完成，但不证明所有辅助网络请求都只访问 DeepSeek 域。

## 14. W1 Codex CLI 0.153.4 升级复验（2026-09-10）

- 升级前基线：npm Codex CLI `0.150.1`，运行 `npm run test:desktop:codex:app-server`，于 2026-09-10 02:02:22（Asia/Shanghai）完成。真实 trajectory 包含 `shell.command` 和 `workspace.patch`，最终 `turn/completed`；证据为 `spikes/codex-runtime/app-server-jsonrpc-wire-0.150.1.jsonl` 和 `app-server-trajectory-0.150.1.json`。
- 升级后复验：npm Codex CLI `0.153.4`，同一脚本在加入主进程版本校验后于 2026-09-10 02:22:31（Asia/Shanghai）完成。证据为 `spikes/codex-runtime/app-server-jsonrpc-wire-0.153.4.jsonl` 和 `app-server-trajectory-0.153.4.json`。
- 两次 wire 的方法集一致，都包含 `initialize`、`thread/start`、`turn/start`、`item/started`、`item/completed`、`thread/tokenUsage/updated` 和 `turn/completed`；item 类型都包含 `userMessage`、`reasoning`、`commandExecution`、`fileChange` 和 `agentMessage`。本次不需要修改 `CodexRuntimeAdapter` 的映射。
- npm registry 在下载 134 MB Windows 平台包时多次 `ECONNRESET`；最终使用官方 tarball 的可续传下载完成安装。`npm ls -g --depth=0` 显示主包 `@openai/codex@0.153.4` 与平台包 `@openai/codex-win32-x64@0.153.4-win32-x64`，平台包不再指向临时目录。

## 15. M5-B 规划层复用 RuntimeAdapter（2026-09-10）

`Planner` 是产品域契约，`RuntimePlanner` 通过现有 `RuntimeAdapter.startSession / subscribe / stop` 发起只读规划轮。接入没有新增 RuntimeAdapter 方法，也没有让产品域 import Codex、Electron、SQLite 或任何模型 SDK 类型。`TemplatePlanner` 与 `RuntimePlanner` 通过同一套契约测试。

规划轮新增运行时中立的 `SessionPlan.responseSchema`。Codex adapter 将其映射为 app-server `turn/start.outputSchema`；其他 runtime 可以映射到自己的结构化输出能力，不能支持时应明确失败并触发带来源标识的模板降级。规划轮使用 `L1`，Codex host 映射为 `read-only`。UI 收到任何 tool、approval_required、blocked、cancelled、interrupted 或超时事件都会拒绝该轮结果，因此规划不能借机执行文件或外部动作。

2026-09-10 03:55:57（Asia/Shanghai）的内部真实运行生成 5 份不同计划。`spikes/m5b-planner/openai-codex-validation-wire.jsonl` 包含 5 个带 `outputSchema` 的 `turn/start`，并且 command execution、file change、approval request 均为 0。结果见 `openai-codex-validation-evidence.json`。此前同日一次失败运行证明仅靠 prompt 会被模型忽略 schema，故最终采用协议字段而非延长等待时间。

模型返回的 `humanGates` 不进入产品决策。HUMMER 用模型工具候选和输入语义推导动作，再查询当前租户的 7 条审批策略；high/critical 规则形成关口，策略不可用则对受保护动作默认禁止。有效规划作为 `planning.session-plan` outcome 入账，规划成本以 `pricing_source=planning` 关联该 outcome，沿用 M5-A receipt。

当前未闭合项：`DEEPSEEK_API_KEY` 在本轮进程环境中不存在，因此默认 DeepSeek 档未运行，真实人民币规划成本与带成本 receipt 尚未获得外部证据。内部验证模型没有已核实的 CNY 价格，保持 `null`/未提供，没有估算或伪造。DeepSeek 验收命令为 `npm run test:desktop:planner:deepseek`。

规划接入后的早期复跑曾把 `apply_patch` 与审批先后出现解释为“file-change approval”。M5-D 的完整对照探针给出了确定边界：`workspace-write` 下直接完成 `fileChange` 且零审批；`read-only` 下同类变更先发 `item/fileChange/requestApproval`，拒绝后状态为 declined 且磁盘无目标文件。因此 HUMMER 强制所有 Codex 计划使用 `read-only`，并把原生请求映射为 `file.write.patch` 后交给租户审批策略。完整证据与结论见 ADR-009 和 `spikes/m5d-write-gate/`。
- 升级前首次复跑暴露了两个 E2E 脚本债务：M4 身份门禁未处理，以及新的持久化查询未传 session token。脚本已使用独立 Electron profile、真实登录 token 修复，不改变生产协议。

## 16. M5-C 桌面默认运行时与沙箱复核（2026-09-11）

- 浏览器没有桌面 host 时仍使用明确标识的 Mock；Electron renderer 未显式配置时根据 `window.hummerDesktop.runtime` 选择真实外壳，不再依赖构建期 `VITE_HUMMER_RUNTIME_ADAPTER` 才能通电。显式配置仍优先。
- Codex 的桌面默认协议是 `app-server-jsonrpc`；`exec-jsonl` 只用于显式诊断。运行时不可用时仍经 `FailoverRuntimeAdapter` 显式回落并展示原因。
- 沙箱只由结构化控制平面决定。模型生成的工作区说明即使包含“只读”等自然语言，也不能降低或提高执行权限。M5-G 已废除 `HUMMER_CODEX_SANDBOX` 写权限覆盖；初始 thread、fork 和 exec-jsonl 兼容路径均强制 `read-only`。
- 2026-09-10 18:32:49 至 18:33:46 UTC 的真实内部验证运行位于 `spikes/codex-runtime/app-server-approval-wire.jsonl` 与 `app-server-approval-trajectory.json`。trajectory sequence 9 为 `approval_required(shell.command)`，10 为真人批准，11 为后续命令工具事件，16 为结果；完整 turn 正常完成。
- 2026-09-10 18:37:25 至 18:38:54 UTC 的真会话重启证据位于 `spikes/m3-real-restart/`。已完成事件恢复后追加明确的 `interrupted`，不把失效子进程伪装为运行中。
- 2026-09-11 的打包验收暴露并修复了两个发布缺陷：Vite 绝对 `/assets` 路径导致 `file://` 空白页，以及打包命令未先重建 renderer。`npm run test:desktop:packaged` 现要求可见 UI、真实 runtime 标识、原生 SQLite、身份写入和环境自检同时通过。
- 默认 `deepseek-standard` 的结构化规划仍受本轮进程缺少 `DEEPSEEK_API_KEY` 阻塞；本节的真实 runtime 证据来自内部 `openai-codex-validation`，两者不得合并宣称。

## 17. M5-E embedded-runtime isolation and order intake (2026-09-12)

M5-E keeps `RuntimeAdapter` unchanged. The new `doc.extract` capability is exposed by the trusted `hummer_local` stdio MCP server and arrives through the existing MCP tool-event mapping. It is authorized only when the tenant registry contains the exact verified, low-risk endpoint. The product domain imports no Electron, SQLite, Codex, or MCP implementation types.

The embedded Codex process now disables `memories` and `apps`, in addition to remote plugins. A failed order-planning run produced a complete wire/stderr record showing a planning-only turn attempting to patch the operator's global `MEMORY.md` before its stream disconnected. The local command `codex features list` verified the exact feature names `memories` and `apps`; after applying those protocol flags, the same order E2E completed without timeout or retry changes. This is runtime isolation, not prompt guidance.

Migration v8 adds a runtime-neutral intake boundary. Folder and form sources call the same `intake(source, externalRef, payload)` operation. A pending intake is persisted and content-addressed but cannot start a session. Confirmation creates the existing work-order projection, after which the existing Planner and RuntimeAdapter paths remain unchanged. A future ChannelAdapter may call this intake operation, but M5-E contains no channel implementation.

Evidence boundaries:

- `spikes/m5e-doc-extract/` proves a real Codex MCP call and local XLSX extraction. DOCX/PDF support is local integration-test evidence.
- `spikes/m5e-intake/` proves folder detection, zero execution before confirmation, real Codex planning and document extraction, plus local HUMMER approval/outcome/receipt/restart behavior.
- Neither evidence set proves the default DeepSeek profile or external delivery.

## 18. M5-G HUMMER-owned execution boundary (2026-09-13)

M5-G does not change the `RuntimeAdapter` method set. Codex remains a read-only reasoning and orchestration runtime with its built-in shell disabled. The adapter maps the verified `hummer_local/workspace_exec` MCP call to the runtime-neutral capability ID `workspace.exec`; it does not import container, Electron, or SQLite types.

The other side of the boundary is owned by the desktop host. A session-bound, random lease authorizes one `workOrderId`; the main process then stages validated files into a unique container volume, runs a non-root image with a read-only root filesystem and no network, validates and hashes the returned snapshot, records `tool_invocations`, and removes the volume. User-configured MCP servers are explicitly disabled for embedded execution, so a runtime cannot bypass the HUMMER registry through inherited tools.

The five-probe startup self-check is a control-plane prerequisite, not an advisory health badge. Missing container support, duplicate or incomplete probe output, or any successful network/DNS/raw-socket probe disables `workspace.exec` before the broker can execute it. Evidence and the packaging limits are recorded in `docs/decisions/ADR-012-m5g-hummer-owned-execution-sandbox.md`.
