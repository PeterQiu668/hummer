# HUMMER Fleet Phase 0 集成回执

- 日期：2026-10-07
- 集成分支：`codex/phase0-fleet`
- 产品血缘：`24b726f745139d57f64f3413946740afc0754cf1`
- 状态：技术底座已集成；真实双机封闭 Alpha 尚未验收

## 本轮已经落地

1. 冻结五个 fleet 契约：`NodeManifest`、`TaskEnvelope`、`RunEvent`、`ApprovalRequest`、`ApprovalDecision`。TypeBox 为单一来源，Ajv 严格校验，未知字段 fail-closed。
2. 新增 `hummer-node` 骨架、运行时探测、MCP 门面和 HTTP/SSE Relay client。任务先进入本地 pending gate，确认前不执行；tenant、node 和任务时效不匹配时拒绝。
3. 新增专用 Relay DB、Fastify API、SSE、opaque badge 指纹认证、tenant/node/scope/expiry 绑定、租约回收和 stop 控制。
4. Relay 强制心跳运行数与活跃租约一致；离线边界为 `>=60s`；持久化接收时钟高水位，回拨 fail-closed；同 key 100 次重投的单进程/单库测试只产生一次完成。
5. Workbench 接入“开始做”：展示 2–5 步、建议节点、七类风险和成本；默认 pending；明确人类确认后只形成一个待派发 intent，拒绝或 adapter 失败均不执行。
6. 联合回执保留 v1 父回执，并绑定子回执、节点、运行时、chain head 和真实 artifact 字节。无关文件即使 hash 正确且重算 manifest 也会被拒绝。
7. 追加 desktop migration v11；Relay 自有 schema 独立演进，不复用 desktop `hummer.sqlite3`。
8. 落实 ADR-021：移除 `@react-three/drei`、`@react-three/fiber`、`three`、`@types/three`，并加入防回归审计。安装图减少 59 个包，既有前端 bundle 字节不变。
9. Relay 专用 schema 13 持久化 append-only ApprovalRequest、immutable ApprovalDecision 和一次性 consumption；node badge 只能提交绑定当前 lease 的请求，human/account control badge 才能决策，节点只能从认证 Relay 原子消费后执行。SSE 不携带审批权。
10. Node 新增 append-only、hash-chained、逐次 fsync 的 execution journal。在 executor 副作用前持久化 `executing`；重启遇到 terminal 时保持去重，遇到未完成状态时只返回 `recovery_required`，绝不自动重放。
11. Electron main 新增受信任 Relay 控制桥；badge 不进入 renderer，桌面本地 account 与 Relay badge tenant/actor 每次调用前双重绑定。
12. Workbench 不进入设置页即可显式派活、批准、拒绝与停止；拒绝在 Memory/SQLite 中原子终态化并由 Node 一次消费为 `rejected`，执行器保持零调用。

## 当前机器证据

- D0：隔离运行 Node `22.22.2` 与 Codex `0.153.4`；受信任 `24b726f` 基线的 config/typecheck/build/test 全通过；合法旧回执 exit 0，篡改旧回执 exit 1。
- 契约：43 条断言，28 条负例。
- Node agent：41 条测试通过。
- Relay：71 条测试通过，包含真实本地 HTTP/SSE client 和审批持久化集成。
- Fleet receipt：16 条测试通过，其中 15 条负例；合法 fixture 检查 2 个 child、2 个 artifact、42 个 fleet 字段。
- 最近一次完整集成证据位于 `evidence/round-p0-integration/gates.json`；最终轮在审批控制面合入后刷新。
- 同一 Relay 本地 HITL 最终证据位于 `evidence/round-p1-desktop-web-hitl-final/`；21 条断言通过，链根 `eb4e523dcd5accf8418aaf5c5b16830cbff967c90aa9e042dac19e122a5b7626`。
- Web 权威门禁 `test:web-e2e` 37 条断言和 7 条负例通过；整库 unit 102/693、UI 23/90、typecheck、build 全通过。

## 尚未达到的验收

下列项目仍是 blocker，不能用现有绿色测试替代：

1. Journal 只保证完整、单写者本机文件上的 durable at-most-once；`executing` 已落盘但 terminal receipt 未落盘时，系统无法判断外部副作用是否完成，只能人工处理 `recovery_required`。
2. 当前 human/account control badge 是开发期静态替身；生产身份签发、撤销与真实 account control-plane 尚未实现，因此仍不能宣称生产级身份认证。
3. RunEvent v1 没有 attempt token；Relay 已用当前租约时间窗拒绝明显迟到事件，但同一受控节点重写时间仍是残余风险。
4. 尚无两台真实 Windows 机器的断网、重连、时钟偏差、并发 claim 和 100-task 重投证据。
5. TLS 部署、SSE durable replay、打包安装和真实 Codex/Claude 执行尚未验收。
6. 当前 fleet receipt 是合成夹具，不是实际双机任务的联合回执。

## 守住的边界

- 没有自动审批、自动提权、真实付款或静默重试高风险动作。
- 没有把 token、API key 或密码写入仓库、日志和回执。
- 没有修改废弃根工作树 `F:\Users\claude code`。
- 没有 push、部署或连接生产系统。
- v1–v10 desktop migrations 未被改写；所有新增迁移均 append-only 或属于独立 Relay DB。

## 下一验收门

1. 接入生产身份签发/撤销边界或至少一个可替换的 authenticated account provider seam。
2. 定义 `recovery_required` 的人工裁决流程，但不自动重试或改写 journal。
3. 在两台真实 Windows 机器运行 100-task、断线 60 秒、重连和篡改演练。
4. 用该真实运行生成 `evidence/round-d2`、`round-d3`、`round-d5`，再决定是否进入外部用户封闭测试。
