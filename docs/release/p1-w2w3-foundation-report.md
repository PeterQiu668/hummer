# ROUND P1-W2W3-foundation | 2026-10-07 | 分支 `codex/phase0-fleet` | tested commit `c4065bbcd28bdc2f271cddcc2400fee6f552fd78` | 工作树 `phase0-fleet`

## 1. 本轮目标（引用 AC 编号）

- AC-P1-01：Fleet 契约冻结 v1.0，新增共享 `CapabilityGrant`，旧契约与旧回执语义不变。
- AC-P1-03/04/06：工牌令牌最小权限、明文不进日志/证据/诊断包、撤销在下一个 Relay 授权检查点生效。
- AC-P1-05/07：审批超时 fail-closed；真实 Node 子进程在 `executing` 阶段被强杀后，新进程只进入 `recovery_required`，不自动重放。
- AC-P0-10：增加白名单式脱敏诊断包核心。
- §13.2：增加不可覆盖、可串联上一轮 root hash 的证据封存。

本轮是 W2/W3 的本地可证明底座，不声称已完成真实双机、生产 IdP、多租户 W4 或内测发布。

## 2. 改动清单

相对 `2881b30549a2b72ea931831f855ffdff498aa823`：40 个文件，`+3196/-21`，16 个原子提交。

- 新增/修改：`packages/contracts/src/fleet/*`、`scripts/test-contract.mjs`、`docs/architecture/fleet-contract.md`（共享 CapabilityGrant 契约与 50 断言/33 负例）。
- 新增/修改：`apps/relay/src/badge-auth.ts`、`apps/relay/src/fastify-transport.ts`、两份 Relay 测试（签发、最小权限、TTL、maxUses、轮换、撤销、摘要快照、通用错误）。
- 新增/修改：`apps/node-agent/src/{node-agent,execution-journal}.mjs`、`apps/node-agent/test/recovery.test.mjs`（人工 abandon/retry-authorize，不改写日志、不自动重试）。
- 新增：`apps/desktop/src/diagnostic-pack.ts` 及测试（白名单字段、身份哈希、密钥脱敏、危险路径拒绝、create-only 写入）。
- 新增：`scripts/test-{fleet,security,chaos,gates}.mjs`、`scripts/test-process-kill.mjs` 与真实强杀 worker。
- 新增：`scripts/evidence-seal.mjs`、封存测试与两轮 evidence manifest。
- 新增：ADR-025（契约）、ADR-026（令牌生命周期）、ADR-027（恢复裁决）及操作手册。
- 删除：0。
- 未触碰：`m3-verify` 主工作树、8 个继承改动、历史证据字节、生成配置、废弃仓库根工作树的 Git 状态；未 push、未部署、未接真实支付、未删除数据。

## 3. 门禁运行记录（原始退出码）

固定解释器：Node `v22.22.2`。原始 stdout/stderr 全量保存在本轮 gates evidence。

- `npm run typecheck` → exit 0。
- `npm run build` → exit 0；Vite 构建成功，保留既有大 chunk 警告。
- `npm test` → exit 0；单元 63 文件/323 用例，UI 16 文件/53 用例；门禁自测 28 断言，证据封存 9 断言/2 负例。
- `npm run test:contract` → exit 0；50 断言、33 负例。
- `npm run test -w @hummer/relay` → exit 0；5 文件/97 用例。
- `npm run test -w @hummer/node-agent` → exit 0；48/48。
- `npm run test:fleet -- --idempotency` → exit 0；10 个顶层用例、4 类负例。
- `npm run test:security -- --grants` → exit 0；33 个顶层用例、47 类负例。
- `npm run test:security -- --token-leak` → exit 0；4 个顶层用例、6 类负例。
- `npm run test:chaos -- --approval-timeout` → exit 0；2 个顶层用例、2 类负例。
- `npm run test:chaos -- --revoke` → exit 0；Registry 与 Fastify 两个授权检查点均拒绝旧令牌。
- `npm run test:chaos -- --process-kill` → exit 0；真实子进程强杀，新进程约 0.4 秒恢复为 fail-closed，executor 调用 0。
- `npm run test:fleet -- --soak=100` → exit 2（pending）；本机 Memory/SQLite 前置通过，但没有第二台真实设备，拒绝报告为通过。

## 4. 证据

- `evidence/round-p1-w2w3-foundation/gates.json`：sha256 `e26fa79d9acf2fa772c4f7d603b905aa2bf20f755bc41bcaabe4ac7d4d6b9eb0`，52,883 bytes。
- `evidence/round-p1-w2w3-foundation/manifest.json`：rootHash `bf45d1d43f5724c2fc620b055d62ee50e1f58d4a0efaef3fd7f7daecfe7856e0`。
- `evidence/round-p1-w3-process-kill/gates.json`：sha256 `e66bdc85c672094e2ebee769144d379e365f64fec902e7fdd7d2fa0d2b070ff2`，2,017 bytes。
- `evidence/round-p1-w3-process-kill/manifest.json`：rootHash `d3c6777edcf1e0853e4eb8305569bd1f6c106be0ca9aed8792b93cdbdec7864f`，其 `prevManifestRootHash` 正确指向上一轮。
- 截图：本轮无新增 UI，因此无截图，不以人工观察作为验收。

## 5. 未完成 / 失败 / 降级项

| 项 | 原因 | 影响面 | 计划 |
|---|---|---|---|
| 真实双机 100 任务 soak | 当前只有本机节点，没有第二台已登记物理设备 | AC-P0-03/04、AC-P1-02 仍未通过 | 第二台设备可用后运行真实 Relay + 两节点门禁，保留 exit 2 到那时 |
| 执行中长任务的主动撤销检查点 | 当前撤销在下一次 Relay HTTP/SSE 授权时生效，单次长 executor 内无回调 | AC-P1-06 只完成 Relay 检查点，不覆盖长调用中段 | 在 runtime adapter 增加 abort/checkpoint 端口，注入 revoked signal |
| grant 快照持久化宿主 | Registry 已有安全 snapshot/restore，但未接事务性 DB/原子文件 | Relay 重启后的生产令牌恢复未闭合 | W2 后续接独立 Relay store，保持明文 token 永不持久化 |
| 生产 IdP | 仍由静态开发注册表或显式 Registry 构造 | 不可对外发布 | 保留 provider seam；内测身份方案拍板后接入 |
| 完整七类 chaos | process kill、超时、撤销已做；断网、磁盘满、DB 锁、时钟跳变、版本不匹配尚未统一进 `test:chaos` | AC-P1-07 未完成 | W3 后续逐项加入且必须显式失败/恢复 |

本轮没有未解释的失败；`skipped=0`。真实双机 gate 的 exit 2 是有意的 pending，不是绿色。

## 6. 契约影响

- 触碰 `packages/contracts`：是。
- 新增：`hummer.capability-grant` version 1；文档冻结为 Fleet Contract v1.0（对 Phase 0 仅增加，不删除、不改义）。
- ADR：025、026、027。
- 迁移：本轮没有修改 `apps/desktop/src/persistence/migrations.ts`；v1–v10 零改动，v11–v13 也未改。
- `api-contract.yaml`：未触碰。

## 7. 本轮触及的选型假设

不需要更新主提示词 §5.2 复审表。TypeBox + Ajv + Standard Schema、Fastify 薄传输层、Node 22 独立代理、JSONL 脱敏诊断与 SQLite 单主方向均保持。新增实现验证了“令牌原文不持久化”和“恢复必须人工裁决”两项既定假设。

## 8. 下一轮第一件事

实现 W4 的 `test:tenancy` 21 条穿越矩阵、每租户链头锚定、配额拒绝入链与单租户审计导出；同时保持真实双机 gate 为 pending。

## 9. 阻塞与需要丘总决定的事

- 真实双机验收需要一台第二物理设备或远程主机。推荐：优先用现有 Mac/Linux/家里电脑作为第二节点，不为此购买新机器；设备可用时再完成登记与跨机证据。
- 生产 IdP 方案尚未拍板，但当前不阻塞 W4。本轮不猜选型；到 W5 内测发布前再在“沿用 HUMMER 账号会话”与“接企业身份提供方”之间做决策，推荐先沿用现有账号会话以缩短内测路径。
