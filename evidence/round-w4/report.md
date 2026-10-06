# W4 tenancy governance evidence report

ROUND W4 | 2026-10-06 | branch codex/w4-evidence | source commit 8daab47776a7d77389f5346926f3286d1f044512 | worktree w4-evidence

1. 本轮目标（AC-P1-08 / AC-P1-09 / AC-P1-10 / AC-P1-12）
   - 复核 21 条可执行租户穿越矩阵、独立租户链头、配额拒绝入链、租户显式审计导出及离线投影验证。
2. 改动清单
   - 新增：`scripts/capture-w4-evidence.mjs`、`evidence/round-w4/*`。
   - 未触碰：production/tests、历史证据、生成配置、F:\agent-hub、仓库根工作树。
3. 门禁运行记录（原始命令、stdout/stderr、JSON 与退出码见 `gates.json`）
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:tenancy` → exit 0 (tail: status=passed, assertions=25, negativeCases=21)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:tenancy -- --chain-heads` → exit 0 (tail: status=passed, assertions=2, negativeCases=1)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:tenancy -- --quota` → exit 0 (tail: status=passed, assertions=6, negativeCases=3)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:tenancy -- --export` → exit 0 (tail: status=passed, assertions=4, negativeCases=3)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:tenant-export` → exit 0 (tail: # duration_ms 904.9134)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run typecheck` → exit 0 (tail: > tsc -b --noEmit)
   - `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run build` → exit 0 (tail: ✓ built in 9.26s)
4. 证据
   - `evidence/round-w4/gates.json`
   - `evidence/round-w4/report.md`
   - `evidence/round-w4/manifest.json`（封存后提供逐文件 SHA-256 与 rootHash）
5. 未完成 / 失败 / 降级项
   - Postgres/RLS：pending；没有配置可执行测试环境，不计为通过。
   - 21/27 口径：主提示词称 21 条，但其 read/write/surface/side 名词列表含 27 项；本轮只声明门禁实际报告的 21 条不重复攻击用例通过，不把 27 写成已通过。
   - 外部 agent-hub 归档投递不在本轮；本轮未写 F:\agent-hub。
6. 契约影响
   - api-contract.yaml / packages/contracts：否；ADR：无；迁移：无，v1-v10 零改动。
7. 本轮触及的选型假设
   - 不需要更新 §5.2；Postgres/RLS 仍是待验证选型。
8. 下一轮第一件事
   - 配置隔离的 PostgreSQL/RLS spike 环境并把结果作为新的独立证据轮次。
9. 阻塞与需要丘总决定的事
   - 若进入 Postgres/RLS spike：选择 A）提供本机隔离实例/容器（推荐），或 B）继续保持 pending；不得把未运行项标绿。

安全声明：本轮没有真实删除、部署或推送，也没有写入 agent-hub。
