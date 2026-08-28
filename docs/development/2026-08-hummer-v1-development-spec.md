# HUMMER V1 开发说明书

状态：`草案，等待产品确认`  
版本：0.1  
日期：2026-08-25  
关联：`docs/product/2026-08-hummer-v1-prototype-spec.md`、`docs/plans/mvp-swarm-plan.md`、`docs/architecture/api-contract.yaml`

## 1. 结论：拆包能复用，但不能原样执行

`mvp-swarm-plan.md` 的核心拆分是正确的：领域/API、生命周期与审计、运行时、前端、质量门分别负责，且以冻结契约和测试门为中心。这些内容可直接保留为 V1 的 Backlog 和 Definition of Done。

但其“WorkBuddy 多个隔离 agent 并行开发”的执行假设不成立于当前单控制者工作方式。更重要的是，本地已经出现了候选实现：

| 原拆包 | 当前候选实现 | 判断 |
| --- | --- | --- |
| HUM-A：领域/API 基础 | `apps/api/work-orders/**`、`packages/contracts/**` | 已有内存态服务与测试；还不是 HTTP API，也未纳入生产构建 |
| HUM-B：审批、审计、证据 | `apps/api/audit/**`、`apps/api/work-orders/**` | 已实现事件链、审批和证据候选逻辑；需做契约一致性验收 |
| HUM-C：运行时 | `apps/api/runtime/**` | 已有确定性 MockRuntimeAdapter；仅能运行合成场景 |
| HUM-D：前端可信闭环 | `src/features/work-orders/**` | 已有独立前端 mock 面板；尚未通过 typed API client 接入候选服务 |
| HUM-E：QA/集成 | Vitest 与浏览器 smoke 已存在 | 缺 API HTTP、数据库持久化、重启重建和真实前后端闭环验证 |

因此 V1 采用**串行收敛、持续测试**的实施方式：先统一三个模型和契约，再把现有候选代码提升为可运行控制面。不得另起一套平行领域模型，也不得把 UI mock 当作后端已完成。

## 2. 当前技术基线与首个风险

当前仓库是 Vite + React + TypeScript 产品原型。`apps/api` 与 `packages/contracts` 目前为未提交候选文件；根 `tsconfig.app.json` 仅包含 `src`，所以 API 候选代码不在 `npm run typecheck` 的覆盖范围内。

当前存在三套相近但不完全一致的 WorkOrder 表达：

1. `docs/architecture/domain-model.md` 与 `api-contract.yaml`：指定的共享业务契约。
2. `packages/contracts/src/work-order.ts`：候选共享类型，其中 `WorkOrder.status` 被收窄成 `draft`。
3. `src/features/work-orders/model/workOrder.ts`：前端演示状态机和 UI 类型。

**这不是小问题。** 如果直接继续接接口，状态、命令、版本和审批语义会在不同层发生漂移。V1 的第一项实现工作必须是契约收敛；任何真实 HTTP、数据库或页面接线都在此之后。

## 3. V1 的工程目标

V1 只交付一个可重放的合成 GTM 闭环：

```text
React 前端
  -> HTTP 控制面
  -> PostgreSQL 事实库（WorkOrder / 事件 / 审批 / 证据 / 成果）
  -> MockRuntimeAdapter
  -> 审批暂停 / 恢复
  -> ResultPackage、审计与浏览器验收
```

以下断言必须同时成立：

- 在浏览器刷新或服务重启后，任务、审批、证据、成果与时间线可从数据库恢复；
- 所有状态改变都有 tenant、actor、correlationId、idempotencyKey、expectedVersion 和审计事件；
- 高风险合成写入在审批通过前不可能执行；
- UI 通过 API 客户端读取投影，不能把 Zustand/localStorage 当业务事实；
- 整个演示不调用外网、不读取客户数据、不需要真实账户或密钥。

## 4. V1 技术选型

### 4.1 已选择的最小技术栈

| 层 | 选择 | 原因 | V1 不选 |
| --- | --- | --- | --- |
| 前端 | 现有 React 18 + Vite + TypeScript | 保留已经完成的办公室视觉与页面资产 | 重写框架、引入第二套设计系统 |
| API | Fastify + TypeScript + Zod | 轻量、可用 `inject` 做 HTTP 契约测试，schema 明确 | Nest 全家桶、未验证的 BFF 框架 |
| 共享契约 | OpenAPI 3.1 为规范源，生成/校验 TypeScript 类型 | 防止网页、服务和文档各有一套 WorkOrder | 前端复制后端 interface |
| 事务事实库 | PostgreSQL 16 + `pg` + SQL migration | 事务、乐观并发、唯一幂等、事件顺序和 JSON 审计均可靠 | 浏览器存储、内存 Map 作为交付事实库 |
| 运行时 | `RuntimeAdapter` 接口 + MockRuntimeAdapter | 先证明治理闭环，后替换真实 Agent runtime | 先接真实模型、桌面或浏览器自动化 |
| 文件/证据 | 本地开发对象存储适配器 + SHA-256 引用 | 交付物与原始二进制分离，审计可验证 | 在事件或 prompt 内存原始文件 |
| 观测 | 结构化日志 + correlationId；事件时间线 | 满足首版排错与演示回放 | 先引入完整可观测平台 |
| 测试 | Vitest、Fastify inject、Playwright smoke | 已有栈可复用；无网络、可重复 | 第二测试框架、依赖生产服务的测试 |

依赖安装和数据库容器仅在用户确认本说明书后执行，并以独立、可回滚的提交完成。

### 4.2 延后但预留的技术决策

| 能力 | V1 处理方式 | 触发后续引入的条件 |
| --- | --- | --- |
| DeepSeek Harness、Codex、OpenClaw、EasyClaw、HiClaw | 只实现 `RuntimeAdapter` 和 Tool Gateway 契约，不嵌入任何一个运行时 | MockRuntime 的审批、证据、结果和取消行为被完整验收 |
| 长任务编排 | 数据库状态机与显式恢复命令 | 真实任务出现跨进程等待、重试、补偿和 SLA 后评估 Temporal |
| MCP / 桌面 / 本地文件 | `ToolDefinition`、风险分级和受控 port | 建立租户凭证、沙箱、操作录屏/证据和 kill switch 后 |
| 向量库和知识库 | 仅允许以 `inputRefs` 引用合成材料 | 明确一个知识检索工作流、权限模型和评测集后 |
| Redis、队列 | 不引入 | 多 worker、任务吞吐或分布式锁成为真实需求后 |
| SSO/RBAC/ABAC | 仅开发态 `DemoIdentityAdapter`，明确为合成身份 | 有首个真实企业试点与身份提供商后 |

这意味着开源 Agent 框架可以被组合，但只能作为适配器的候选实现，不能成为 HUMMER 的事实源、审批绕行渠道或权限模型。HUMMER 自己持有组织、任务、审批、证据、成果和审计。

## 5. 目标目录与所有权

```text
apps/
  api/
    src/
      server/              # Fastify 装配、身份适配、路由
      domain/              # WorkOrder、审批、结果状态机和策略
      audit/               # 事件模型、hash chain、投影
      runtime/             # RuntimeAdapter、MockRuntimeAdapter
      repositories/        # Postgres 与内存测试替身
      storage/             # 证据对象存储 port
    tests/
packages/
  contracts/
    src/                   # 从 OpenAPI 映射的公共命令、DTO、错误码
src/
  features/work-orders/    # 视图模型、API adapter、UI 组件和测试
  features/approvals/
  features/results/
  adapters/api/            # 唯一允许 fetch 的前端边界
docs/
  product/
  development/
  architecture/
```

现有 `apps/api/**` 和 `packages/contracts/**` 是待收敛的候选实现。实施时可以移动、拆分或重构这些文件，但必须保留有效测试，并在提交说明中写明与冻结契约的映射。不能删除测试来掩盖不一致。

## 6. 契约收敛规则

### 6.1 真正的规范源

收敛完成后，规范优先级固定为：

1. `docs/decisions/ADR-001-mvp-boundary.md`：范围与禁区。
2. `docs/architecture/mvp-contract.md`、`domain-model.md`：领域不变量。
3. `docs/architecture/api-contract.yaml`：HTTP 和 DTO 契约。
4. `packages/contracts`：从上述契约导出的 TypeScript 公共表达。
5. API 和前端：各自实现与适配，不能反向定义契约。

`WorkOrderStatus`、命令名、事件名、错误码、actor 格式、ID 前缀、版本行为和审批状态必须在第 3/4 层逐项对齐。修改规范源需要 ADR；修改实现不能静默改变规范。

### 6.2 最小 HTTP 表面

保持 `api-contract.yaml` 已定义的资源边界，并补齐以下跨请求元数据：

| 请求类别 | 必带信息 | 服务端行为 |
| --- | --- | --- |
| 创建 | tenant、actor、correlationId、idempotencyKey | 在事务中创建 WorkOrder 和 `work_order.created` 事件；重复键返回原结果 |
| 状态命令 | actor、expectedVersion、idempotencyKey | 版本不符返回 `409 stale_version`，不追加事件 |
| 审批决定 | human actor、审批理由、expectedVersion、idempotencyKey | 决定不可变，`system:*` 被拒绝 |
| 运行启动/恢复 | WorkOrder 版本、runtime runId | 只能经 policy port 调用 adapter |
| 查询 | tenant 和身份上下文 | 仅返回当前 tenant 的投影及允许字段 |

开发态身份只接受合成、白名单化的 `human:*`、`twin:*`、`employee:*` actor。它是 demo adapter，不构成真实认证承诺。

### 6.3 数据库事实模型

第一版至少需要以下表，所有表包含 `tenant_id`：

| 表 | 关键约束 |
| --- | --- |
| `work_orders` | `(tenant_id, id)` 主键；`version` 乐观锁；状态投影 |
| `domain_events` | `(tenant_id, subject_ref, sequence)` 唯一；`previous_event_hash`、`event_hash`；只追加 |
| `command_receipts` | `(tenant_id, idempotency_key)` 唯一；保存原始成功/失败语义所需回放信息 |
| `approvals` | 一次受控动作一个不可变决定；关联 WorkOrder 和证据 |
| `evidence` | hash、source_ref、脱敏摘要、对象引用；不存凭证和客户原文 |
| `result_packages` | 交付物、验收逐项判定、成本、风险、回滚、接受状态 |
| `runtime_jobs` | adapter、runId、状态、trace_ref、成本聚合、安全失败摘要 |

事件 hash 用稳定 JSON canonicalization 计算；写入同一 WorkOrder 时应通过事务、行锁或等效序列化保证顺序。事件流必须能重建 V1 的任务投影，并能检测链条被修改。

## 7. 串行实施计划

每一步都在前一步验收通过后开始。HUM-E 的质量责任转化为每步的连续检查，而不是最后补测试。

| 里程碑 | 原拆包映射 | 工作内容 | 完成定义 |
| --- | --- | --- | --- |
| S0：产品与契约冻结 | G0 | 确认本原型；逐项比对 YAML、领域文档、候选 contracts、前端 mock；形成差异清单和 ADR | 只有一套状态/命令/事件词表；API 用例可生成 fixture |
| S1：可编译控制面 | HUM-A/B 候选收敛 | 建立 API package、TS project reference、共享 contracts；将已有内存服务作为 domain/test double | API/domain 进入 typecheck；契约测试覆盖 create/get/transition/errors |
| S2：持久化与 HTTP | HUM-A/B | Postgres migration、repository、事件链、幂等和 Fastify 路由；开发态身份 | HTTP 通过 OpenAPI fixture；重启后可重建；无跨租户读取 |
| S3：受控运行时 | HUM-C | 将 MockRuntimeAdapter 接到持久化控制面，启动、停顿、审批恢复、取消、结果包 | 批准前写入不执行；拒绝/取消有可审计失败分类 |
| S4：可信前端闭环 | HUM-D | 用 typed API client 替代独立 mock；实现驾驶舱、任务、审批、成果和员工工作台的 V1 状态 | 刷新不丢事实；所有按钮走 API；错误/冲突可理解 |
| S5：验收与发布候选 | HUM-E / G4 | 合成种子、重建测试、浏览器正反流程、a11y 基础检查、性能预算、演示脚本 | 一条命令完成适用测试；五分钟演示可稳定回放 |

### S0 的差异清单必须覆盖

- `packages/contracts` 中收窄为 `status: 'draft'` 的 WorkOrder 与完整状态枚举的矛盾；
- 前端 `request_approval`、`deliver`、`accept` 等命令与 OpenAPI `WorkOrderCommand` 的不同；
- 候选服务的 `synthetic_crm_write`、`synthetic_csv_write`、`synthetic CRM/CSV write-back` 三种动作命名；
- 事件列表和结果/审批返回 DTO 是否完整覆盖 YAML；
- `apps/api` 当前不受 root `typecheck` 覆盖的事实；
- 内存 event store 只能作为测试替身，不能满足服务重启验收。

## 8. 测试驱动开发与质量门

### 8.1 新增脚本的目标形态

在 S1 前不安装任何新依赖；S1/S2 获确认后再以最小变更新增：

```text
npm run test:domain       # 纯状态机、策略、hash、redaction、成本
npm run test:api          # Fastify inject + OpenAPI fixtures
npm run test:integration  # Postgres repository、重启重建、runtime port
npm run test:ui           # React 组件和 client adapter
npm run test:e2e          # 浏览器完整正反流程
npm run typecheck         # 前端、contracts、API 全部纳入 project references
npm run build             # 前端生产包；API 独立 build/typecheck
```

### 8.2 每项业务行为先写的测试

| 行为 | 最低测试 |
| --- | --- |
| 创建 WorkOrder | 必填字段、合法 actor/tenant、draft、create event、重复键回放 |
| 状态变化 | 表驱动合法/非法转换、版本冲突不追加 event |
| 审批 | 仅 human 可决定、决定不可改、拒绝不执行写入 |
| 审计 | sequence 连续、hash chain 完整、敏感键被脱敏、重建一致 |
| 证据与成果 | bytes hash、必需验收项、成本加总、回滚说明 |
| 运行时 | 合成读取、写入暂停、批准恢复、拒绝/取消安全失败 |
| 多租户 | tenant A 永远读取不到 tenant B 的任何投影或事件 |
| UI | pending/approved/rejected/delivered/failed 状态、API 冲突提示、刷新后重新加载 |
| 浏览器 | 创建 -> 运行 -> 审批 -> 接受；拒绝审批；驳回成果；刷新/重启后查询 |

### 8.3 禁止的“通过方式”

- 只运行 `src` 测试而声称 API 已验证；
- 在组件中更新状态以模拟服务端成功；
- 删除失败断言、跳过重启测试或对测试使用真实网络；
- 把 token、客户记录、原始附件、凭证或未脱敏工具输入写进事件、截图、fixture 或日志；
- 用一个超级管理员或 `system:*` 绕开人工审批；
- 因为 UI demo 流畅就声明真实 CRM、桌面或 Codex 已接入。

## 9. 前端迁移原则

现有 `TrustedWorkOrderPanel` 可继续承担合成演示，但迁移方式固定：

1. 首先增加 `src/adapters/api`，所有 `fetch` 在此集中；组件不得直接构造领域事实。
2. 建立 API DTO 到页面 view model 的 mapper，保留当前视觉组件和基础交互。
3. 先接只读任务详情、时间线、成果包；再接命令与审批；最后接驾驶舱投影。
4. 当 API 未启动时可以展示明确的“合成离线演示”状态，但不能假装已持久化。
5. 旧 mock 状态在同一页面完全由 API 替代后删除或限制为 test fixture，避免双事实源。

## 10. 发布前的安全与运营检查

V1 不等于生产可用，但必须达到可信 demo 的最低线：

- 合成资料、合成身份、合成 CRM/CSV 在所有页面和日志中清晰标识；
- 任何写动作都有风险级别、审批记录、actor、证据、成本和回滚说明；
- 提供任务取消、审批拒绝和 runtime failure 的用户可见状态；
- 数据库备份/迁移、重置 demo seed 和密钥环境变量有开发文档；
- 所有依赖升级独立审查。当前开发依赖的安全审计事项不应通过盲目 `npm audit fix` 解决；
- release evidence 包含准确的提交 SHA、命令输出摘要、已知限制和演示数据版本。

## 11. 进入 S0 前的确认清单

开始实质工程开发前，需要产品负责人确认：

1. 接受 `docs/product/2026-08-hummer-v1-prototype-spec.md` 的 V1 页面、流程和合成边界。
2. 接受本说明书以 PostgreSQL + Fastify + Zod + MockRuntimeAdapter 为 V1 技术基线。
3. 接受先收敛候选代码与共享契约，不另开平行实现，也不直接连接真实系统。
4. 接受 V1 的第一交付物是“可重放的合成 GTM 闭环”，而不是全功能的 AI 原生组织平台。

确认后，实施从 S0 的差异清单和红测试开始；S0 输出完成后再进入依赖安装、数据库与 HTTP 服务搭建。
