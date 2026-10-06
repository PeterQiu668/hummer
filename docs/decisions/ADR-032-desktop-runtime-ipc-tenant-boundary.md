# ADR-032: Desktop runtime IPC 必须绑定认证租户

- 状态：Accepted
- 日期：2026-10-07
- 范围：Desktop main/preload runtime bridge，Codex/Claude host，execution node kill-all

## 背景与风险证据

原有 Desktop runtime IPC 只用 renderer 提供的 `processId` 定位运行实例。`start`、`replay`、`stop`、`respond-approval`、`steer` 和 Codex `fork` 不要求认证 session token，run state 也没有租户归属。任何能调用 preload bridge 的 renderer 上下文只要获得另一个 process id，就能读取事件或控制该进程。runtime 事件又会直接发送到创建 run 的 `WebContents`，用户切换租户后仍可能继续收到原租户事件。

`hummer:execution-nodes:kill-all` 虽然先验证 token，但随后调用全局 `stopAll`，导致一个租户可以终止其他租户的本地运行实例。

这些都是跨租户访问/控制风险，按 P0 处理。

## 决策

1. Codex 和 Claude 的每个 run 在创建时，用 main 进程从认证 session token 解析出的 `tenantId` 绑定租户。renderer 传入的 tenant id 不作为授权依据。
2. start/replay/stop/approval/steer/fork 的 IPC 调用都必须携带 token。main 进程在每次调用时重新解析 token，并要求当前 tenant 与 run 绑定 tenant 完全相同。
3. preload 与 runtime adapter 的桥接签名显式携带 token。adapter 在每个控制动作发生时重新读取当前 session token；空 token 直接失败，不保留匿名兼容路径。
4. publish 前用 run 创建时的原 token 再次解析当前 tenant。若 session 已切换 tenant、失效或无法解析，立即停止进程并丢弃事件，不写入 replay buffer，也不发送到 renderer。
5. execution node kill-all 在 main 进程解析 token 后，只把解析得到的 tenant id 传给 Codex/Claude `stopAll`；两个 runtime 都只筛选并停止该租户的 run。
6. Claude 尚未实现 checkpoint fork，因此继续保持无 IPC 能力的 fail-closed 状态；不提供未认证兼容入口。

## 验证

行为回归测试统一使用标记 `[TEN-P0-DESKTOP-RUNTIME-IPC]`，覆盖：

- 旧版匿名调用失败关闭；
- 跨租户 replay/stop/approval/steer/fork 被拒绝；
- 原 token 切换租户后，Codex 和 Claude 都停止进程且不再发布事件；
- stop-all 只终止目标 tenant 的 run；
- kill-all 的 tenant 只能由认证 token 解析，不能由 renderer 指定；
- runtime adapter 的后续控制使用最新 session token，而不是复用 start 时的 token。

## 影响

这是有意的 preload bridge 契约变更。旧 renderer 若不传 token 会收到明确错误，不能匿名降级。浏览器 mock runtime 不受影响；Desktop real runtime 必须存在有效登录 session 才能启动和控制。
