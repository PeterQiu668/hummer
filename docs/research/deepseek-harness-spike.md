# DeepSeek Harness 执行外壳 Spike

状态：完成源码审查，不接 UI，不实现适配器
核实日期：2026-08-28（Asia/Shanghai）
核实版本：`deepseek-ai/deepseek-harness@cd5ef8148158c3a752a658978873241fdf8e2bbc`，根包 `0.1.2-alpha.1`
本地只读检出：`C:\tmp\deepseek-harness`

## 1. 结论摘要

**建议：有限 GO，仅进入隔离的技术验证，不进入 HUMMER 生产执行层。**

这次 spike 的核心问题可以给出肯定答案：DeepSeek Harness 已经具有“高危动作前暂停、等待外部决定、批准后续跑”的一等能力，不需要 HUMMER 从零发明审批机制。其 `dsh-user-approval` 服务以单次授权方式暂停敏感工具，默认 `ask`，缺少回答者或回答异常时 fail closed；ACP 桥可以把请求交给外部进程，并只接受 `allow-once` 或 `reject-once`。

但是，它仍是 `0.1.2-alpha.1`，会拒绝不兼容的 session format，且未提供迁移。HUMMER 现阶段应保留 `RuntimeAdapter`，只做独立进程/隔离工作区的兼容性验证，不把 Harness 类型导入产品域，也不让 Harness session store 取代 HUMMER 的业务审计账本。

## 2. 四问逐条结论

### 2.1 是否已有 approval / permission / confirmation / hook 机制？

**结论：有，且不是文档层设想，是已实现的运行时服务。**

- `packages/interaction/user-approval/README.md:10-12`：敏感工具动作调用 `ctx.approval.request(req)` 后暂停，等待一次性允许或拒绝；结果集合为 `allowed-once`、`rejected`、`cancelled`、`unavailable`。
- `packages/interaction/user-approval/README.md:28-36`：工具链与 sandboxed bash 会走该服务；无 terminal answerer 时返回 `unavailable` 并 fail closed；默认策略为 `ask`，`never` 会确定性拒绝。
- `packages/interaction/user-approval/src/index.ts:157-180`：`ApprovalService` 及 `ask | never` 策略的真实实现。
- `packages/interaction/user-approval/src/index.ts:204-240`：审批只能发生在 open turn 内；先 append `approval/asked`，await 外部决定，再 append `approval/decided`。只有 `allowed-once` 是授权，审计写入失败时拒绝返回未记录的决定。

因此本问题在第 1 步已经是“是”，无需进入“从零设计插件中断机制”的补救路径。

### 2.2 若无现成机制，能否以插件实现？

**结论：不适用；现成机制本身就是可组合插件。**

仍有一个 HUMMER 集成点需要实现：为 `approval/request` 提供终端 answerer，把请求映射为 HUMMER `approval_required`，并等待责任链返回。该工作不是改 Harness 核心循环，而是编写边界插件或使用 ACP 桥：

- `packages/acp/acp/src/index.ts:151-171`：ACP 监听 `approval/request`，通过 `session/requestPermission` 向外部客户端发出请求，只提供 `allow_once` 和 `reject_once`，再将回答映射回 Harness outcome。
- `packages/acp/README.md:10-12`：ACP 支持持久会话、恢复、permission prompt 回答和取消。

**量级估计：**

| 工作 | 量级 | 说明 |
|---|---:|---|
| 只用 ACP 做审批桥 PoC | 2-4 天 | 启动进程、映射事件、批准/拒绝、取消、异常关闭 |
| 完成独立 `HarnessRuntimeAdapter` spike | 1-2 周 | 再含 resume/fork、evidence、错误分类和契约测试 |
| 达到生产级责任链与升级兼容 | 4-8 周 | 含版本钉死、迁移策略、负载/故障测试、安全评审 |

这些是工程量级，不是承诺排期；没有真实 E2E 前不得将其降为“已接入”。

### 2.3 能否作为库嵌入 Electron 主进程，而不是只能起 Web Server？

**结论：技术上可以；生产建议先采用 Electron 主进程管理的子进程，不直接同进程加载。**

- `packages/sdk/client/src/index.ts:1-19`：官方 TypeScript client 是纯库，负责 spawn 同版本 `dsh --profile sdk` 子进程并通过 stdio JSON-RPC 驱动。
- `packages/sdk/server/src/index.ts:24-33`：server 配置允许注入 `Readable`、`Writable` 和退出回调，不绑定 Web Server。
- `packages/sdk/server/src/index.ts:40-62`：`apply(ctx, config)` 在给定流上创建 `JsonRpcLineTransport` 与 `HarnessSdkJsonRpcServer`。

所以“只能起 web server”可以排除。同进程嵌入 Electron 在类型和 stream 层可行，但其同步 SQLite、插件依赖和 root lifecycle 会扩大 Electron 主进程故障半径。第一阶段使用官方 client 的子进程模式更符合隔离原则，也更容易 kill、升级和回滚。

### 2.4 storage 与 sessions 插件能否替换为 HUMMER SQLite + 哈希链？

**结论：session storage 可替换；不能直接等同于 HUMMER 的业务哈希链。**

- `packages/session/session-persistence/README.md:10-12`：持久化是 backend-neutral service，保存现有 `SessionEvent`，语义包括 append-only、连续序号、崩溃恢复与 durable append。
- `packages/session/session-persistence/README.md:25-32`：JSONL 和 SQLite 是可互换 backend，第三方可直接实现同一服务。
- `packages/session/session-persistence/README.md:66-75`：backend 只需实现读取、append、repair、listing 等 durable primitives，并遵守 append-only、连续 `seq` 与 durability 约束。
- `packages/session/session-persistence-sqlite/README.md:10-12,28-32`：内置 SQLite provider 已能重启恢复，但同步 Node SQLite 会阻塞 JavaScript 线程，高并发采用前需压测。

可以编写 HUMMER backend，把 Harness session event 存入现有 SQLite；但 HUMMER `domain_events` 的 hash chain 是业务事实与责任审计，Harness session log 是执行轨迹。两者必须保持双层：先持久化 runtime event，再由受控映射追加 HUMMER domain event。不得把 Harness 的 append-only 宣称为 HUMMER 哈希链等价物。

## 3. 安全续跑的建议形状

```text
Harness sensitive tool
  -> approval/request
  -> ACP requestPermission
  -> HUMMER host maps approval_required
  -> HUMMER policy selects approver and records decision
  -> allow-once / reject-once
  -> Harness appends approval/decided
  -> tool continues or fails closed
  -> RuntimeEvent lands before UI projection
```

边界要求：

1. HUMMER 仍拥有租户、员工、责任链、审批策略、预算和结果包。
2. Harness 只拥有单次执行中的模型循环、工具和 session trajectory。
3. 每次允许只能绑定 `sessionId + toolCallId + approvalId`，不得转成永久授权。
4. 子进程断开、answerer 不可用、超时或 hash-chain append 失败时一律拒绝。
5. 产品域不得 import DeepSeek Harness 类型；映射只在 adapter/desktop host 内。

## 4. 兼容性与许可证风险

- `packages/core/session/src/types.ts:33-56`：当前 on-disk format 为 `0`，不承诺兼容，不兼容日志直接拒绝且没有迁移。这是“不进入生产”的主要理由。
- `packages/session/session-persistence-sqlite/README.md:10-12`：SQLite provider 也是 pre-release，会拒绝不属于它的数据库，且同步驱动可能阻塞事件循环。
- 根 `LICENSE:1-13`：MIT；分发修改版或包含其实质代码时保留版权与许可文本。HUMMER 仍需在 `THIRD_PARTY_NOTICES` 中记录版本、来源、许可证和修改情况。

## 5. Go / No-Go 决策

| 选项 | 决策 | 条件 |
|---|---|---|
| 继续 5 日内 ACP 审批 E2E | GO | 固定 commit，独立子进程，不接产品 UI，不导入域类型 |
| 编写生产 `HarnessRuntimeAdapter` | NO-GO（当前） | 等审批 E2E、取消/崩溃恢复和升级兼容测试通过后重新决策 |
| 替换 HUMMER SQLite/哈希链 | NO-GO | 只能接为 runtime session backend，不能取代业务事实源 |
| 把 Harness 与 Codex 逻辑合并进同一 adapter | NO-GO | 必须是独立实现，以检验 `RuntimeAdapter` 公约数 |

## 6. 下一次 spike 的停止线

只做一个真实场景：读文件 → 请求写文件 → 外部批准 → 写入 → 完成。以下任一发生即停止并记录 NO-GO：

- 工具写入发生在 `approval/request` 之前；
- 外部客户端断线后动作仍继续；
- 批准无法绑定一次性 tool call；
- 进程重启后把失效批准恢复为有效；
- 需要修改 Harness 核心循环而不是通过公开 service/ACP 完成；
- 事件无法在投影 UI 前先落入 HUMMER 事实源。
